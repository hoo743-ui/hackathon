"""어댑터 공통 구현: 상태 조회는 모드와 무관하게 DB(서버의 단일 진실 공급원)에서 읽는다."""
from uuid import UUID

from sqlalchemy import select

from app.core.enums import DataSource
from app.database.session import SessionLocal
from app.hardware.interfaces import ACCEPTED_SOURCE, HardwareMode
from app.models import Bin, Device, DeviceCommand
from app.schemas.api import BinOut, CommandOut, DeviceOut
from app.services.serializers import bin_out, command_out, device_out_with_busy


class BaseHardwareAdapter:
    mode: HardwareMode

    def __init__(self, mode: HardwareMode):
        self.mode = mode

    @property
    def simulator_running(self) -> bool:
        return False

    def accepts_source(self, source: DataSource | str | None) -> bool:
        # LWT(offline)처럼 source가 없는 메시지는 항상 수락
        return source is None or source == ACCEPTED_SOURCE[self.mode]

    async def get_device_status(self, device_id: str) -> DeviceOut | None:
        async with SessionLocal() as session:
            d = await session.scalar(select(Device).where(Device.device_id == device_id))
            return await device_out_with_busy(session, d) if d else None

    async def get_sensor_data(self, device_id: str) -> list[BinOut]:
        async with SessionLocal() as session:
            rows = await session.scalars(select(Bin).where(Bin.device_id == device_id).order_by(Bin.bin_id))
            return [bin_out(b) for b in rows]

    async def get_command_status(self, command_id: UUID) -> CommandOut | None:
        async with SessionLocal() as session:
            c = await session.scalar(select(DeviceCommand).where(DeviceCommand.command_id == command_id))
            return command_out(c) if c else None
