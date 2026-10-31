"""MQTT telemetry/status 수신 처리."""
import logging
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.enums import ConnectionStatus, SensorStatus
from app.core.time import utcnow
from app.models import Bin, Device, SensorLog
from app.schemas.mqtt import StatusPayload, TelemetryPayload
from app.services.fill_level import compute_fill_percent
from app.services.serializers import bin_out, device_out_with_busy
from app.websocket.manager import ws_manager

logger = logging.getLogger(__name__)


class TelemetryRejected(Exception):
    pass


def resolve_measured_at(device_ts: datetime | None, received_at: datetime) -> datetime:
    """장치 시각이 없거나 서버 시각과 크게 어긋나면 수신 시각을 사용 (ARCHITECTURE D2)."""
    if device_ts is None:
        return received_at
    if abs(device_ts - received_at) > timedelta(seconds=settings.clock_skew_tolerance_sec):
        return received_at
    return device_ts


def classify(status: SensorStatus, distance: float | None) -> tuple[SensorStatus, float | None]:
    """장치가 normal로 보냈더라도 물리적으로 불가능한 값은 out_of_range로 재분류."""
    if status != SensorStatus.NORMAL:
        return status, None
    if distance is None or not (settings.sensor_min_distance_cm <= distance <= settings.sensor_max_distance_cm):
        return SensorStatus.OUT_OF_RANGE, None
    return status, distance


async def ingest_telemetry(session: AsyncSession, payload: TelemetryPayload) -> None:
    received_at = utcnow()
    device = await session.scalar(select(Device).where(Device.device_id == payload.device_id))
    if device is None:
        raise TelemetryRejected(f"unknown device {payload.device_id}")

    bins = {b.bin_id: b for b in await session.scalars(select(Bin).where(Bin.device_id == device.device_id))}
    payload_ids = {b.bin_id for b in payload.bins}
    if payload_ids != set(bins):
        raise TelemetryRejected(
            f"bin set mismatch: expected {sorted(bins)}, got {sorted(payload_ids)}"
        )

    mismatched = [
        r.bin_id for r in payload.bins if r.waste_type is not None and r.waste_type != bins[r.bin_id].waste_type
    ]
    if mismatched:
        # 장치 설정(config.h)과 서버 bin 설정이 다름 → 잘못된 칸에 기록되지 않도록 전체 폐기
        raise TelemetryRejected(f"waste_type mismatch for {mismatched}")

    measured_at = resolve_measured_at(payload.timestamp, received_at)
    for reading in payload.bins:
        b = bins[reading.bin_id]
        status, distance = classify(reading.sensor_status, reading.distance_cm)
        fill = compute_fill_percent(distance, b.empty_distance_cm, b.full_distance_cm)
        session.add(
            SensorLog(
                device_id=device.device_id,
                bin_id=b.bin_id,
                distance_cm=distance,
                fill_percent=fill,
                sensor_status=status,
                source=payload.source,
                measured_at=measured_at,
                received_at=received_at,
            )
        )
        b.sensor_status = status
        b.updated_at = received_at
        # 측정 실패 시 마지막 정상값을 덮어쓰지 않는다.
        if status == SensorStatus.NORMAL:
            b.current_distance_cm = distance
            b.current_fill_percent = fill
            b.last_valid_at = measured_at

    went_online = device.connection_status != ConnectionStatus.ONLINE
    device.connection_status = ConnectionStatus.ONLINE
    device.last_seen = received_at
    device.data_source = payload.source
    await session.commit()

    await ws_manager.broadcast(
        "bins.updated",
        [bin_out(b).model_dump(mode="json") for b in sorted(bins.values(), key=lambda x: x.bin_id)],
    )
    if went_online:
        await ws_manager.broadcast("device.status", (await device_out_with_busy(session, device)).model_dump(mode="json"))


async def ingest_status(session: AsyncSession, payload: StatusPayload) -> None:
    device = await session.scalar(select(Device).where(Device.device_id == payload.device_id))
    if device is None:
        raise TelemetryRejected(f"unknown device {payload.device_id}")

    now = utcnow()
    device.connection_status = payload.state
    if payload.state == "online":
        device.last_seen = now
    if payload.source is not None:
        device.data_source = payload.source
    if payload.operating_mode is not None:
        device.operating_mode = payload.operating_mode
    if payload.estop_active is not None:
        device.estop_active = payload.estop_active
    if payload.firmware_version is not None:
        device.firmware_version = payload.firmware_version
    if payload.state == "online" and (payload.message_type is not None or payload.error_code is not None):
        # v1.1 status는 error_code를 항상 포함 (null = 정상)
        device.error_code = payload.error_code
    await session.commit()
    await ws_manager.broadcast("device.status", (await device_out_with_busy(session, device)).model_dump(mode="json"))


async def mark_stale_devices_offline(session: AsyncSession) -> None:
    cutoff = utcnow() - timedelta(seconds=settings.device_offline_after_sec)
    stale = list(
        await session.scalars(
            select(Device).where(Device.connection_status == ConnectionStatus.ONLINE, Device.last_seen < cutoff)
        )
    )
    if not stale:
        return
    for d in stale:
        d.connection_status = ConnectionStatus.OFFLINE
        logger.warning("device %s marked offline (no data since %s)", d.device_id, d.last_seen)
    await session.commit()
    for d in stale:
        await ws_manager.broadcast("device.status", (await device_out_with_busy(session, d)).model_dump(mode="json"))
