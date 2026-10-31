"""카메라 노트북(EDGE) 상태·센서 이벤트.

- heartbeat: 메모리에 보관 (재시작하면 다음 heartbeat 5초 안에 복구). 시리얼 연결 시 분리수거함 장치를 online으로 갱신
- telemetry: DB(edge_telemetry)에 저장. AI 분류와 분리
"""
import logging
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.enums import ConnectionStatus, DataSource
from app.core.time import utcnow
from app.models import Device, EdgeTelemetry
from app.schemas.api import EdgeHeartbeatIn, EdgeStatusOut, TelemetryIn, TelemetryOut
from app.services.serializers import device_out_with_busy
from app.websocket.manager import ws_manager

logger = logging.getLogger(__name__)

_edges: dict[str, tuple[EdgeHeartbeatIn, datetime]] = {}


def edge_statuses() -> list[EdgeStatusOut]:
    now = utcnow()
    out = []
    for hb, seen in _edges.values():
        online = (now - seen).total_seconds() < settings.edge_offline_after_sec
        out.append(EdgeStatusOut(**hb.model_dump(), online=online, last_seen=seen))
    return sorted(out, key=lambda e: e.device_id)


async def heartbeat(session: AsyncSession, hb: EdgeHeartbeatIn) -> EdgeStatusOut:
    now = utcnow()
    prev = _edges.get(hb.device_id)
    _edges[hb.device_id] = (hb, now)
    status = next(e for e in edge_statuses() if e.device_id == hb.device_id)

    # 시리얼이 실제로 열려 있을 때만 분리수거함 장치를 online으로 본다 (카메라만 켜진 것은 장치 연결이 아님)
    device = await session.scalar(select(Device).where(Device.device_id == settings.edge_bin_device_id))
    if device is not None and hb.serial_connected:
        changed = device.connection_status != ConnectionStatus.ONLINE or device.data_source != DataSource.HARDWARE
        device.connection_status = ConnectionStatus.ONLINE
        device.data_source = DataSource.HARDWARE
        device.last_seen = now
        device.firmware_version = device.firmware_version or "trush.ino (serial)"
        await session.commit()
        if changed:
            await ws_manager.broadcast("device.status", (await device_out_with_busy(session, device)).model_dump(mode="json"))

    if prev is None or _summary(prev[0]) != _summary(hb):
        await ws_manager.broadcast("edge.status", status.model_dump(mode="json"))
    return status


def _summary(hb: EdgeHeartbeatIn) -> tuple:
    return (hb.camera_ok, hb.model_loaded, hb.serial_connected, hb.esp32_connected, hb.upload_queue > 0, hb.last_error)


async def broadcast_stale_edges() -> None:
    """offline으로 바뀐 카메라 노트북을 한 번 알린다 (supervisor가 1초마다 호출)."""
    for e in edge_statuses():
        key = e.device_id
        if not e.online and key not in _announced_offline:
            _announced_offline.add(key)
            await ws_manager.broadcast("edge.status", e.model_dump(mode="json"))
        elif e.online:
            _announced_offline.discard(key)


_announced_offline: set[str] = set()


async def record_telemetry(session: AsyncSession, t: TelemetryIn) -> EdgeTelemetry:
    row = EdgeTelemetry(
        device_id=t.device_id,
        kind=t.kind,
        sensor_id=t.sensor_id,
        payload=t.payload,
        raw=t.raw,
        source=t.source,
        measured_at=t.measured_at or utcnow(),
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    await ws_manager.broadcast("telemetry", TelemetryOut.model_validate(row).model_dump(mode="json"))
    return row


async def latest_full_alert(session: AsyncSession) -> TelemetryOut | None:
    row = await session.scalar(
        select(EdgeTelemetry).where(EdgeTelemetry.kind == "bin_full_alert").order_by(EdgeTelemetry.measured_at.desc()).limit(1)
    )
    return TelemetryOut.model_validate(row) if row else None
