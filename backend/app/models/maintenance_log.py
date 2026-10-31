from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database.session import Base


class MaintenanceLog(Base):
    """현장 점검·테스트 기록 (관리자가 직접 남기는 기록. 자동 생성하지 않는다)."""

    __tablename__ = "maintenance_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    device_id: Mapped[str] = mapped_column(String(32), ForeignKey("devices.device_id", ondelete="CASCADE"), index=True)
    bin_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("bins.bin_id", ondelete="SET NULL"))
    kind: Mapped[str] = mapped_column(String(16))
    result: Mapped[str] = mapped_column(String(8))  # ok | issue
    note: Mapped[str | None] = mapped_column(Text)
    related_command_id: Mapped[str | None] = mapped_column(Uuid)
    created_by: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
