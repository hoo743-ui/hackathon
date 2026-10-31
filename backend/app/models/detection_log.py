import uuid
from datetime import datetime

from sqlalchemy import JSON, BigInteger, CheckConstraint, DateTime, Float, ForeignKey, Integer, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database.session import Base


class DetectionLog(Base):
    """AI 분류 결과. 외부 AI 프로그램(다른 노트북)이 POST /api/detections 로 보낸다."""

    __tablename__ = "detection_logs"
    __table_args__ = (CheckConstraint("confidence >= 0 AND confidence <= 1", name="ck_detection_confidence"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    device_id: Mapped[str] = mapped_column(String(32), ForeignKey("devices.device_id", ondelete="CASCADE"))
    bin_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("bins.bin_id", ondelete="SET NULL"))
    waste_type: Mapped[str] = mapped_column(String(16))
    confidence: Mapped[float] = mapped_column(Float)
    image_reference: Mapped[str | None] = mapped_column(Text)
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    # 재디자인 v2 추가 컬럼 (모두 기존 행과 호환)
    detection_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, unique=True)  # 송신측 멱등 키
    source: Mapped[str] = mapped_column(String(16), server_default="model")
    model_name: Mapped[str | None] = mapped_column(String(64))
    outcome: Mapped[str | None] = mapped_column(String(24), index=True)
    outcome_detail: Mapped[str | None] = mapped_column(String(64))
    command_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("device_commands.command_id", ondelete="SET NULL"), index=True
    )
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # 카메라 노트북 연동 (EDGE_SERIAL) 추가 컬럼
    camera_id: Mapped[str | None] = mapped_column(String(64))  # 촬영한 카메라 노트북 (예: CAMERA_001)
    class_id: Mapped[int | None] = mapped_column(Integer)  # YOLO 클래스 번호 (모델 names 기준)
    bounding_box: Mapped[dict | None] = mapped_column(JSON)  # {"x1","y1","x2","y2"} 픽셀
    image_path: Mapped[str | None] = mapped_column(Text)  # UPLOAD_DIR 기준 상대 경로
    hardware_status: Mapped[str | None] = mapped_column(String(24))  # HardwareStatus
