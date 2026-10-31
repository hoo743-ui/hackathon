from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.enums import IN_FLIGHT_STATUSES
from app.models import Bin, DetectionLog, Device, DeviceCommand
from app.schemas.api import BinOut, CommandOut, DetectionOut, DeviceOut
from app.services.fill_level import is_full


def bin_out(b: Bin) -> BinOut:
    return BinOut(
        bin_id=b.bin_id,
        device_id=b.device_id,
        waste_type=b.waste_type,
        current_distance_cm=b.current_distance_cm,
        current_fill_percent=b.current_fill_percent,
        sensor_status=b.sensor_status,
        is_full=is_full(b.current_fill_percent, settings.bin_full_threshold_percent),
        calibrated=b.empty_distance_cm is not None and b.full_distance_cm is not None,
        last_valid_at=b.last_valid_at,
        updated_at=b.updated_at,
    )


async def busy_device_ids(session: AsyncSession) -> set[str]:
    rows = await session.scalars(
        select(DeviceCommand.device_id).where(DeviceCommand.status.in_(IN_FLIGHT_STATUSES)).distinct()
    )
    return set(rows)


def device_out(d: Device, busy: bool) -> DeviceOut:
    return DeviceOut(
        device_id=d.device_id,
        device_name=d.device_name,
        connection_status=d.connection_status,
        operating_mode=d.operating_mode,
        estop_active=d.estop_active,
        data_source=d.data_source,
        firmware_version=d.firmware_version,
        error_code=d.error_code,
        last_seen=d.last_seen,
        busy=busy,
    )


async def device_out_with_busy(session: AsyncSession, d: Device) -> DeviceOut:
    count = await session.scalar(
        select(func.count())
        .select_from(DeviceCommand)
        .where(DeviceCommand.device_id == d.device_id, DeviceCommand.status.in_(IN_FLIGHT_STATUSES))
    )
    return device_out(d, bool(count))


def command_out(c: DeviceCommand) -> CommandOut:
    return CommandOut.model_validate(c)


def detection_out(d: DetectionLog) -> DetectionOut:
    return DetectionOut.model_validate(d)


async def broadcast_detection(d: DetectionLog, created: bool = False) -> None:
    from app.websocket.manager import ws_manager

    data = detection_out(d).model_dump(mode="json")
    await ws_manager.broadcast("detection.updated", data)
    if created:
        # 외부 소비자용 명시적 신규 이벤트 (웹·앱은 detection.updated 하나로 처리)
        await ws_manager.broadcast("new_detection", data)
