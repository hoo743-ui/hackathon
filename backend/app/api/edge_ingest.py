"""multipart 분류 수신: metadata(JSON) + image(JPEG/PNG).

순서: 검증 → (중복이면 기존 기록 반환) → 이미지 파일 저장 → DB 기록 → WebSocket 발행.
이미지 저장이 끝나기 전에는 이벤트를 발행하지 않는다.
"""
from fastapi import Request
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.datastructures import UploadFile

from app.core.config import settings
from app.core.errors import APIError
from app.core.time import utcnow
from app.hardware.interfaces import HardwareAdapter
from app.models import DetectionLog
from app.schemas.api import DetectionCreate, EdgeDetectionMeta
from app.services import detection_service, image_store


async def ingest_multipart(request: Request, session: AsyncSession, hardware: HardwareAdapter):
    form = await request.form(max_files=1, max_fields=4)
    raw_meta = form.get("metadata")
    image = form.get("image")
    if not isinstance(raw_meta, str):
        raise APIError(422, "METADATA_REQUIRED", "multipart field 'metadata' (JSON string) is required")
    if not isinstance(image, UploadFile):
        raise APIError(422, "IMAGE_REQUIRED", "multipart file field 'image' is required")
    try:
        meta = EdgeDetectionMeta.model_validate_json(raw_meta)
    except ValidationError as exc:
        raise RequestValidationError(exc.errors()) from exc

    existing = await session.scalar(select(DetectionLog).where(DetectionLog.detection_id == meta.detection_id))
    if existing is not None:  # 재전송 → 이미지 다시 쓰지 않음
        return existing, False

    data = await image.read(settings.max_image_bytes + 1)
    ext = image_store.validate(data, image.content_type)
    captured = meta.captured_at or utcnow()
    rel = image_store.save(meta.detection_id, data, ext, captured.strftime("%Y%m%d"))

    req = DetectionCreate(
        device_id=settings.edge_bin_device_id,
        waste_type=meta.waste_type,
        confidence=meta.confidence,
        detected_at=captured,
        model=meta.model_name,
        source=meta.source,
        detection_id=meta.detection_id,
        camera_id=meta.device_id,
        class_id=meta.class_id,
        bounding_box=meta.bounding_box,
        hardware_status=meta.hardware_status,
    )
    try:
        return await detection_service.ingest(session, hardware, req, image_path=rel)
    except Exception:
        image_store.discard(rel)  # DB 기록 실패 시 고아 파일 제거
        raise
