"""AI 분류 결과 수신 → 기록 → (자동 모드면) 배출구 자동 동작.

처리 흐름: 투입 → (외부 AI 프로그램) 촬영·분류 → POST /api/detections → 여기서 판단
→ 자동 모드 + 신뢰도 충족 → OPEN_BIN(origin=auto) → 장치 ACK → outcome SORTED/SORT_FAILED (command_service가 갱신)
"""
import logging
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.enums import (
    CommandOrigin,
    CommandType,
    DetectionOutcome,
    DetectionSource,
    HardwareStatus,
    OperatingMode,
    WasteType,
)
from app.core.errors import APIError
from app.core.time import utcnow
from app.hardware.interfaces import HardwareAdapter, HardwareMode
from app.models import Bin, DetectionLog, Device
from app.schemas.api import CommandCreate, DetectionCreate
from app.services import command_service
from app.services.serializers import broadcast_detection

logger = logging.getLogger(__name__)


# EDGE_SERIAL: 카메라 노트북이 보고한 시리얼 결과 → 분류 처리 결과
EDGE_OUTCOME: dict[str, tuple[str, str | None]] = {
    HardwareStatus.PENDING: (DetectionOutcome.SORTING, None),
    HardwareStatus.COMMAND_SENT: (DetectionOutcome.SORT_SENT, "NO_DEVICE_ACK"),
    HardwareStatus.SERIAL_FAILED: (DetectionOutcome.SORT_FAILED, "SERIAL_WRITE_FAILED"),
    HardwareStatus.NOT_CONNECTED: (DetectionOutcome.DEVICE_UNAVAILABLE, "SERIAL_NOT_CONNECTED"),
    HardwareStatus.DISABLED: (DetectionOutcome.NO_HARDWARE, "HARDWARE_DISABLED"),
    HardwareStatus.SKIPPED_BUSY: (DetectionOutcome.DEVICE_UNAVAILABLE, "HARDWARE_BUSY"),
    HardwareStatus.COMPLETED: (DetectionOutcome.SORTED, "ACK_DONE"),
    HardwareStatus.ACK_TIMEOUT: (DetectionOutcome.SORT_FAILED, "ACK_TIMEOUT"),
    HardwareStatus.REJECTED_BUSY: (DetectionOutcome.DEVICE_UNAVAILABLE, "HARDWARE_BUSY"),
    HardwareStatus.ABORTED: (DetectionOutcome.SORT_FAILED, "EMERGENCY_STOP"),
}


async def update_hardware_status(session: AsyncSession, detection_id, status: HardwareStatus) -> DetectionLog:
    """카메라 노트북이 장치 ACK(또는 타임아웃)를 받은 뒤 결과를 갱신한다 (EDGE_SERIAL)."""
    det = await session.scalar(select(DetectionLog).where(DetectionLog.detection_id == detection_id))
    if det is None:
        raise APIError(404, "DETECTION_NOT_FOUND", "detection not found")
    det.hardware_status = status
    if det.outcome != DetectionOutcome.UNRECOGNIZED:
        det.outcome, det.outcome_detail = EDGE_OUTCOME[status]
    await session.commit()
    await session.refresh(det)
    await broadcast_detection(det)
    return det


async def ingest(
    session: AsyncSession, hardware: HardwareAdapter, req: DetectionCreate, image_path: str | None = None
) -> tuple[DetectionLog, bool]:
    """반환: (분류 기록, 새로 생성 여부). image_path는 이미 저장이 끝난 파일 (UPLOAD_DIR 기준)."""
    if req.detection_id is not None:
        existing = await session.scalar(select(DetectionLog).where(DetectionLog.detection_id == req.detection_id))
        if existing is not None:
            return existing, False

    # 시뮬레이터 분류는 시뮬레이터 모드에서만 (실제 장치 이력에 섞이지 않게)
    if req.source == DetectionSource.SIMULATOR and hardware.mode != HardwareMode.SIMULATOR:
        raise APIError(409, "SOURCE_MODE_MISMATCH", "simulator detections are only accepted in SIMULATOR mode")

    device = await session.scalar(select(Device).where(Device.device_id == req.device_id))
    if device is None:
        raise APIError(404, "DEVICE_NOT_FOUND", f"device {req.device_id} not found")

    waste = req.waste_type.strip().lower()
    known = waste in {w.value for w in WasteType}
    bin_ = (
        await session.scalar(select(Bin).where(Bin.device_id == device.device_id, Bin.waste_type == waste))
        if known
        else None
    )
    det = DetectionLog(
        detection_id=req.detection_id,
        device_id=device.device_id,
        bin_id=bin_.bin_id if bin_ else None,
        waste_type=waste,
        confidence=req.confidence,
        image_reference=req.image_reference,
        model_name=req.model,
        source=req.source,
        detected_at=req.detected_at or utcnow(),
        camera_id=req.camera_id,
        class_id=req.class_id,
        bounding_box=req.bounding_box.model_dump() if req.bounding_box else None,
        image_path=image_path,
        hardware_status=req.hardware_status,
    )

    if hardware.mode == HardwareMode.EDGE_SERIAL:
        # 하드웨어는 카메라 노트북이 직접 구동했다. 서버는 보고된 결과만 기록한다 (명령 전송 없음).
        if not known or bin_ is None:
            det.outcome = DetectionOutcome.UNRECOGNIZED
        else:
            det.outcome, det.outcome_detail = EDGE_OUTCOME[req.hardware_status or HardwareStatus.PENDING]
        session.add(det)
        await session.commit()
        await session.refresh(det)
        await broadcast_detection(det, created=True)
        logger.info("edge detection %s %.2f hw=%s → %s", waste, req.confidence, det.hardware_status, det.outcome)
        return det, True

    if not known or bin_ is None:
        det.outcome = DetectionOutcome.UNRECOGNIZED
    elif req.confidence < settings.ai_confidence_threshold:
        det.outcome = DetectionOutcome.LOW_CONFIDENCE
        det.outcome_detail = f"< {settings.ai_confidence_threshold:.2f}"
    elif device.operating_mode != OperatingMode.AUTO:
        det.outcome = DetectionOutcome.MANUAL_MODE

    session.add(det)
    await session.commit()

    if det.outcome is None:
        # 자동 모드 → 기존 명령 파이프라인(검증·ACK·타임아웃·긴급정지)을 그대로 사용
        try:
            cmd, _ = await command_service.create_command(
                session,
                hardware,
                device.device_id,
                CommandCreate(command=CommandType.OPEN_BIN, target=waste, bin_id=bin_.bin_id),
                requested_by=f"ai:{req.model or 'model'}",
                origin=CommandOrigin.AUTO,
            )
        except APIError as exc:
            det.outcome, det.outcome_detail = DetectionOutcome.DEVICE_UNAVAILABLE, exc.code
        else:
            det.command_id = cmd.command_id
            det.outcome = DetectionOutcome.SORTING
            # 장치 ACK가 이 연결보다 먼저 도착했을 수 있다 → 명령이 이미 끝났으면 지금 반영
            await session.refresh(cmd)
            await command_service.sync_detection_outcome(session, cmd)
        await session.commit()

    await session.refresh(det)
    await broadcast_detection(det, created=True)
    logger.info("detection %s %.2f → %s", waste, req.confidence, det.outcome)
    return det, True


async def page(
    session: AsyncSession,
    *,
    device_id: str | None,
    waste_type: str | None,
    outcome: str | None,
    source: str | None,
    start: datetime | None,
    end: datetime | None,
    order: str,
    limit: int,
    offset: int,
):
    stmt = select(DetectionLog)
    if device_id:
        stmt = stmt.where(DetectionLog.device_id == device_id)
    if waste_type:
        stmt = stmt.where(DetectionLog.waste_type == waste_type)
    if outcome:
        stmt = stmt.where(DetectionLog.outcome == outcome)
    if source:
        stmt = stmt.where(DetectionLog.source == source)
    if start:
        stmt = stmt.where(DetectionLog.detected_at >= start)
    if end:
        stmt = stmt.where(DetectionLog.detected_at <= end)
    total = await session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    col = DetectionLog.detected_at
    rows = list(await session.scalars(stmt.order_by(col.asc() if order == "asc" else col.desc()).limit(limit).offset(offset)))
    return rows, total


async def summary(session: AsyncSession, since: datetime, source: str | None):
    base = select(DetectionLog).where(DetectionLog.detected_at >= since)
    if source:
        base = base.where(DetectionLog.source == source)
    sub = base.subquery()
    total = await session.scalar(select(func.count()).select_from(sub)) or 0
    by_type = dict((await session.execute(select(sub.c.waste_type, func.count()).group_by(sub.c.waste_type))).all())
    by_outcome = dict((await session.execute(select(sub.c.outcome, func.count()).group_by(sub.c.outcome))).all())
    avg = await session.scalar(select(func.avg(sub.c.confidence)))
    return total, by_type, {k or "UNKNOWN": v for k, v in by_outcome.items()}, (round(avg, 3) if avg is not None else None)
