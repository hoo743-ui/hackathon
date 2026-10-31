from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, Float, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database.session import Base


class Bin(Base):
    """쓰레기통 현재 상태. current_* 는 마지막 '정상' 측정값만 반영한다."""

    __tablename__ = "bins"
    __table_args__ = (
        UniqueConstraint("device_id", "waste_type", name="uq_bins_device_waste_type"),
        CheckConstraint(
            "empty_distance_cm IS NULL OR full_distance_cm IS NULL OR full_distance_cm < empty_distance_cm",
            name="ck_bins_calibration_order",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    bin_id: Mapped[str] = mapped_column(String(32), unique=True)
    device_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("devices.device_id", ondelete="CASCADE"), index=True
    )
    waste_type: Mapped[str] = mapped_column(String(16))
    empty_distance_cm: Mapped[float | None] = mapped_column(Float)
    full_distance_cm: Mapped[float | None] = mapped_column(Float)
    current_distance_cm: Mapped[float | None] = mapped_column(Float)
    current_fill_percent: Mapped[float | None] = mapped_column(Float)
    sensor_status: Mapped[str | None] = mapped_column(String(16))
    last_valid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
