"""초기 장치/쓰레기통 등록. 여러 번 실행해도 안전하다(이미 있으면 건너뜀).

보정값(empty/full distance)은 실측 전이므로 NULL로 둔다.
"""
import asyncio
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.enums import WasteType
from app.database.session import SessionLocal
from app.models import Bin, Device

logger = logging.getLogger(__name__)

SEED_DEVICES = [{"device_id": "DEVICE_001", "device_name": "스마트 분리수거함 1호"}]
SEED_BINS = [
    {"bin_id": "BIN_001", "device_id": "DEVICE_001", "waste_type": WasteType.PLASTIC},
    {"bin_id": "BIN_002", "device_id": "DEVICE_001", "waste_type": WasteType.METAL},
    {"bin_id": "BIN_003", "device_id": "DEVICE_001", "waste_type": WasteType.PAPER},
    {"bin_id": "BIN_004", "device_id": "DEVICE_001", "waste_type": WasteType.GLASS},
]


async def seed(session: AsyncSession) -> None:
    existing_devices = set(await session.scalars(select(Device.device_id)))
    for d in SEED_DEVICES:
        if d["device_id"] not in existing_devices:
            session.add(Device(**d))
    await session.flush()
    existing_bins = set(await session.scalars(select(Bin.bin_id)))
    for b in SEED_BINS:
        if b["bin_id"] not in existing_bins:
            session.add(Bin(**b))
    await session.commit()


async def main() -> None:
    async with SessionLocal() as session:
        await seed(session)
    logger.info("seed complete")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
