import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, String, Text, Uuid, text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.session import Base


class DeviceCommand(Base):
    __tablename__ = "device_commands"
    __table_args__ = (
        Index("ix_device_commands_device_requested", "device_id", "requested_at"),
        Index(
            "ix_device_commands_inflight",
            "device_id",
            postgresql_where=text("status IN ('PENDING', 'SENT')"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    command_id: Mapped[uuid.UUID] = mapped_column(Uuid, unique=True)
    device_id: Mapped[str] = mapped_column(String(32), ForeignKey("devices.device_id", ondelete="CASCADE"))
    command: Mapped[str] = mapped_column(String(32))
    target: Mapped[str | None] = mapped_column(String(16))
    # OPEN_BIN이 가리키는 칸 (그 외 명령은 NULL)
    bin_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("bins.bin_id", ondelete="SET NULL"))
    # manual = 관리자 조작, auto = AI 분류에 따른 자동 동작
    origin: Mapped[str] = mapped_column(String(8), server_default="manual")
    status: Mapped[str] = mapped_column(String(16))
    requested_by: Mapped[str | None] = mapped_column(String(64))
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    executed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    result_message: Mapped[str | None] = mapped_column(String(64))
    error_message: Mapped[str | None] = mapped_column(Text)
