from datetime import datetime

from sqlalchemy import JSON, BigInteger, DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database.session import Base


class EdgeTelemetry(Base):
    """카메라 노트북(또는 ESP32 브리지)이 보낸 센서/하드웨어 이벤트. AI 분류(detection_logs)와 분리 저장."""

    __tablename__ = "edge_telemetry"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    device_id: Mapped[str] = mapped_column(String(64), index=True)  # 보낸 쪽 (CAMERA_001, ESP32_BRIDGE …)
    kind: Mapped[str] = mapped_column(String(32), index=True)  # bin_full_alert | serial_line | distance …
    sensor_id: Mapped[str | None] = mapped_column(String(32))
    payload: Mapped[dict | None] = mapped_column(JSON)
    raw: Mapped[str | None] = mapped_column(Text)  # 시리얼 원문 그대로
    source: Mapped[str] = mapped_column(String(16))  # hardware | simulator
    measured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
