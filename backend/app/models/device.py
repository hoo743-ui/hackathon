from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, String, false, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database.session import Base


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    device_id: Mapped[str] = mapped_column(String(32), unique=True)
    device_name: Mapped[str | None] = mapped_column(String(100))
    connection_status: Mapped[str] = mapped_column(String(16), server_default="unknown")
    operating_mode: Mapped[str] = mapped_column(String(16), server_default="MANUAL")
    estop_active: Mapped[bool] = mapped_column(Boolean, server_default=false())
    data_source: Mapped[str | None] = mapped_column(String(16))
    firmware_version: Mapped[str | None] = mapped_column(String(32))
    # 장치가 status 메시지로 보고한 오류 코드 (SENSOR_FAULT 등). 정상이면 NULL
    error_code: Mapped[str | None] = mapped_column(String(32))
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
