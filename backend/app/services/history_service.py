"""History/Analytics 조회 (읽기 전용). 기존 테이블만 사용한다."""
from datetime import datetime, timedelta

from sqlalchemy import Select, case, func, literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.enums import SensorStatus
from app.core.time import utcnow
from app.models import DeviceCommand, SensorLog


async def _page(session: AsyncSession, stmt: Select, order_col, order: str, limit: int, offset: int):
    total = await session.scalar(select(func.count()).select_from(stmt.subquery()))
    ordering = order_col.asc() if order == "asc" else order_col.desc()
    rows = list(await session.scalars(stmt.order_by(ordering).limit(limit).offset(offset)))
    return rows, total or 0


async def measurements(
    session: AsyncSession,
    *,
    device_id: str | None,
    bin_id: str | None,
    sensor_status: str | None,
    source: str | None,
    start: datetime | None,
    end: datetime | None,
    order: str,
    limit: int,
    offset: int,
):
    stmt = select(SensorLog)
    if device_id:
        stmt = stmt.where(SensorLog.device_id == device_id)
    if bin_id:
        stmt = stmt.where(SensorLog.bin_id == bin_id)
    if sensor_status:
        stmt = stmt.where(SensorLog.sensor_status == sensor_status)
    if source:
        stmt = stmt.where(SensorLog.source == source)
    if start:
        stmt = stmt.where(SensorLog.measured_at >= start)
    if end:
        stmt = stmt.where(SensorLog.measured_at <= end)
    return await _page(session, stmt, SensorLog.measured_at, order, limit, offset)


async def commands(
    session: AsyncSession,
    *,
    device_id: str | None,
    status: str | None,
    command: str | None,
    bin_id: str | None = None,
    start: datetime | None,
    end: datetime | None,
    order: str,
    limit: int,
    offset: int,
):
    stmt = select(DeviceCommand)
    if device_id:
        stmt = stmt.where(DeviceCommand.device_id == device_id)
    if status:
        stmt = stmt.where(DeviceCommand.status == status)
    if command:
        stmt = stmt.where(DeviceCommand.command == command)
    if bin_id:
        stmt = stmt.where(DeviceCommand.bin_id == bin_id)
    if start:
        stmt = stmt.where(DeviceCommand.requested_at >= start)
    if end:
        stmt = stmt.where(DeviceCommand.requested_at <= end)
    return await _page(session, stmt, DeviceCommand.requested_at, order, limit, offset)


async def fill_trend(session: AsyncSession, hours: int, bucket_minutes: int) -> list[tuple]:
    """bin별 시간 버킷 집계 (PostgreSQL date_bin). 측정이 없는 버킷은 반환하지 않는다."""
    since = utcnow() - timedelta(hours=hours)
    bucket = func.date_bin(
        literal(timedelta(minutes=bucket_minutes)), SensorLog.measured_at, literal(datetime(2000, 1, 1))
    ).label("bucket_start")
    stmt = (
        select(
            bucket,
            SensorLog.bin_id,
            func.avg(SensorLog.fill_percent),
            func.max(SensorLog.fill_percent),
            func.count(SensorLog.id),
            func.count(case((SensorLog.sensor_status != SensorStatus.NORMAL, 1))),
        )
        .where(SensorLog.measured_at >= since)
        .group_by(bucket, SensorLog.bin_id)
        .order_by(bucket, SensorLog.bin_id)
    )
    return list(await session.execute(stmt))
