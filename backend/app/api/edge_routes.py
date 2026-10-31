"""카메라 노트북 연동 REST: 분류 상세·이미지, 센서 이벤트, heartbeat, 장치 상태."""
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.core.security_ai import require_ai_token
from app.core.time import utcnow
from app.database.session import get_session
from app.models import DetectionLog, Device, EdgeTelemetry
from app.schemas.api import (
    DetectionOut,
    DevicesStatusOut,
    EdgeHeartbeatIn,
    EdgeStatusOut,
    TelemetryIn,
    TelemetryOut,
)
from app.services import edge_service, image_store
from app.services.serializers import busy_device_ids, detection_out, device_out

# /api/devices/{device_id} 보다 먼저 등록해야 하는 경로
pre_router = APIRouter(prefix="/api")
router = APIRouter(prefix="/api")


@pre_router.get("/devices/status", response_model=DevicesStatusOut)
async def devices_status(request: Request, session: AsyncSession = Depends(get_session)):
    busy = await busy_device_ids(session)
    devices = await session.scalars(select(Device).order_by(Device.device_id))
    return DevicesStatusOut(
        hardware_mode=request.app.state.hardware.mode,
        edges=edge_service.edge_statuses(),
        devices=[device_out(d, d.device_id in busy) for d in devices],
        latest_full_alert=await edge_service.latest_full_alert(session),
        server_time=utcnow(),
    )


async def _get_detection(session: AsyncSession, detection_id: UUID) -> DetectionLog:
    det = await session.scalar(select(DetectionLog).where(DetectionLog.detection_id == detection_id))
    if det is None:
        raise APIError(404, "DETECTION_NOT_FOUND", "detection not found")
    return det


@router.get("/detections/{detection_id}", response_model=DetectionOut)
async def get_detection(detection_id: UUID, session: AsyncSession = Depends(get_session)):
    return detection_out(await _get_detection(session, detection_id))


@router.get("/detections/{detection_id}/image")
async def get_detection_image(detection_id: UUID, session: AsyncSession = Depends(get_session)):
    det = await _get_detection(session, detection_id)
    if not det.image_path:
        raise APIError(404, "IMAGE_NOT_FOUND", "this detection has no image")
    path = image_store.resolve(det.image_path)
    if not path.is_file():
        raise APIError(404, "IMAGE_NOT_FOUND", "image file missing")
    media = "image/png" if path.suffix == ".png" else "image/jpeg"
    # detection_id별 파일은 바뀌지 않는다 → 클라이언트 캐시 허용
    return FileResponse(path, media_type=media, headers={"Cache-Control": "public, max-age=86400, immutable"})


@router.post("/telemetry", response_model=TelemetryOut, status_code=201)
async def post_telemetry(t: TelemetryIn, session: AsyncSession = Depends(get_session), _: str = Depends(require_ai_token)):
    return TelemetryOut.model_validate(await edge_service.record_telemetry(session, t))


@router.get("/telemetry", response_model=list[TelemetryOut])
async def list_telemetry(
    kind: str | None = None,
    limit: int = Query(50, ge=1, le=500),
    session: AsyncSession = Depends(get_session),
):
    stmt = select(EdgeTelemetry)
    if kind:
        stmt = stmt.where(EdgeTelemetry.kind == kind)
    rows = await session.scalars(stmt.order_by(EdgeTelemetry.measured_at.desc()).limit(limit))
    return [TelemetryOut.model_validate(r) for r in rows]


@router.post("/edge/heartbeat", response_model=EdgeStatusOut)
async def post_heartbeat(hb: EdgeHeartbeatIn, session: AsyncSession = Depends(get_session), _: str = Depends(require_ai_token)):
    return await edge_service.heartbeat(session, hb)
