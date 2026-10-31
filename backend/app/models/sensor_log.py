from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Float, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database.session import Base


class SensorLog(Base):
    __tablename__ = "sensor_logs"
    __table_args__ = (Index("ix_sensor_logs_bin_measured", "bin_id", "measured_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    device_id: Mapped[str] = mapped_column(String(32), ForeignKey("devices.device_id", ondelete="CASCADE"))
    bin_id: Mapped[str] = mapped_column(String(32), ForeignKey("bins.bin_id", ondelete="CASCADE"))
    distance_cm: Mapped[float | None] = mapped_column(Float)
    fill_percent: Mapped[float | None] = mapped_column(Float)
    sensor_status: Mapped[str] = mapped_column(String(16))
    source: Mapped[str] = mapped_column(String(16))
    measured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
