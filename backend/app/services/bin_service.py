from datetime import datetime, timedelta

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.enums import SensorStatus
from app.core.errors import APIError
from app.core.time import utcnow
from app.models import Bin, DeviceCommand, SensorLog
from app.schemas.api import BinStatisticsOut, CalibrationIn, StatisticsOut
from app.services.fill_level import compute_fill_percent
from app.services.serializers import bin_out
from app.websocket.manager import ws_manager


async def list_bins(session: AsyncSession) -> list[Bin]:
    return list(await session.scalars(select(Bin).order_by(Bin.bin_id)))


async def get_bin(session: AsyncSession, bin_id: str) -> Bin:
    b = await session.scalar(select(Bin).where(Bin.bin_id == bin_id))
    if b is None:
        raise APIError(404, "BIN_NOT_FOUND", f"bin {bin_id} not found")
    return b


async def history(
    session: AsyncSession, bin_id: str, start: datetime | None, end: datetime | None, limit: int
) -> list[SensorLog]:
    await get_bin(session, bin_id)
    stmt = select(SensorLog).where(SensorLog.bin_id == bin_id)
    if start:
        stmt = stmt.where(SensorLog.measured_at >= start)
    if end:
        stmt = stmt.where(SensorLog.measured_at <= end)
    rows = list(await session.scalars(stmt.order_by(SensorLog.measured_at.desc()).limit(limit)))
    rows.reverse()  # 그래프용 시간 오름차순
    return rows


async def update_calibration(session: AsyncSession, bin_id: str, data: CalibrationIn) -> Bin:
    b = await get_bin(session, bin_id)
    b.empty_distance_cm = data.empty_distance_cm
    b.full_distance_cm = data.full_distance_cm
    b.current_fill_percent = compute_fill_percent(b.current_distance_cm, b.empty_distance_cm, b.full_distance_cm)
    b.updated_at = utcnow()
    await session.commit()
    await ws_manager.broadcast("bins.updated", [bin_out(b).model_dump(mode="json")])
    return b


async def statistics(session: AsyncSession, hours: int) -> StatisticsOut:
    since = utcnow() - timedelta(hours=hours)
    rows = await session.execute(
        select(
            Bin.bin_id,
            Bin.waste_type,
            func.avg(SensorLog.fill_percent),
            func.max(SensorLog.fill_percent),
            func.count(SensorLog.id),
            func.count(case((SensorLog.sensor_status != SensorStatus.NORMAL, 1))),
        )
        .outerjoin(SensorLog, (SensorLog.bin_id == Bin.bin_id) & (SensorLog.measured_at >= since))
        .group_by(Bin.bin_id, Bin.waste_type)
        .order_by(Bin.bin_id)
    )
    bins = [
        BinStatisticsOut(
            bin_id=r[0],
            waste_type=r[1],
            avg_fill_percent=round(r[2], 1) if r[2] is not None else None,
            max_fill_percent=r[3],
            sample_count=r[4],
            error_count=r[5],
        )
        for r in rows
    ]
    counts = await session.execute(
        select(DeviceCommand.status, func.count())
        .where(DeviceCommand.requested_at >= since)
        .group_by(DeviceCommand.status)
    )
    return StatisticsOut(period_hours=hours, bins=bins, command_counts={s: c for s, c in counts})
