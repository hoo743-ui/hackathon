from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_hardware
from app.core.errors import APIError
from app.core.security import require_control_token
from app.core.time import utcnow
from app.database.session import get_session
from app.models import Device, DeviceCommand
from app.schemas.api import (
    BinHistoryOut,
    BinOut,
    CalibrationIn,
    CalibrationOut,
    CommandCreate,
    CommandOut,
    GlobalCommandCreate,
    CommandPage,
    DetectionCreate,
    DetectionOut,
    DetectionPage,
    DetectionSummaryOut,
    MaintenanceCreate,
    MaintenanceOut,
    MaintenancePage,
    MeasurementOut,
    MeasurementPage,
    TrendBucketOut,
    TrendOut,
    DashboardOut,
    DeviceOut,
    HealthOut,
    SensorLogOut,
    StatisticsOut,
)
from app.core.security_ai import require_ai_token
from app.models import Bin, MaintenanceLog
from app.services import bin_service, command_service, detection_service, edge_service, history_service
from app.api import edge_ingest
from app.services.serializers import detection_out
from app.hardware.interfaces import HardwareAdapter
from app.services.serializers import bin_out, busy_device_ids, command_out, device_out

health_router = APIRouter()
router = APIRouter(prefix="/api")


@health_router.get("/health", response_model=HealthOut)
@router.get("/health", response_model=HealthOut)
async def health(request: Request, session: AsyncSession = Depends(get_session)) -> HealthOut:
    try:
        await session.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False
    hw = request.app.state.hardware
    mqtt_ok = bool(getattr(hw, "connected", False))
    return HealthOut(
        # EDGE_SERIAL 모드는 MQTT 없이도 동작 (하드웨어는 카메라 노트북이 시리얼로 구동)
        status="ok" if db_ok and (mqtt_ok or hw.mode == "EDGE_SERIAL") else "degraded",
        database=db_ok,
        mqtt=mqtt_ok,
        hardware_mode=hw.mode,
        simulator_running=hw.simulator_running,
    )


# --- devices ---

async def _get_device(session: AsyncSession, device_id: str) -> Device:
    d = await session.scalar(select(Device).where(Device.device_id == device_id))
    if d is None:
        raise APIError(404, "DEVICE_NOT_FOUND", f"device {device_id} not found")
    return d


@router.get("/devices", response_model=list[DeviceOut])
async def list_devices(session: AsyncSession = Depends(get_session)):
    busy = await busy_device_ids(session)
    devices = await session.scalars(select(Device).order_by(Device.device_id))
    return [device_out(d, d.device_id in busy) for d in devices]


@router.get("/devices/{device_id}", response_model=DeviceOut)
async def get_device(device_id: str, session: AsyncSession = Depends(get_session)):
    d = await _get_device(session, device_id)
    return device_out(d, d.device_id in await busy_device_ids(session))


@router.get("/devices/{device_id}/status", response_model=DeviceOut)
async def get_device_status(device_id: str, session: AsyncSession = Depends(get_session)):
    return await get_device(device_id, session)


# --- commands ---

@router.post("/devices/{device_id}/commands", response_model=CommandOut, status_code=202)
async def create_command(
    device_id: str,
    req: CommandCreate,
    response: Response,
    session: AsyncSession = Depends(get_session),
    hardware: HardwareAdapter = Depends(get_hardware),
    requested_by: str = Depends(require_control_token),
):
    cmd, created = await command_service.create_command(session, hardware, device_id, req, requested_by)
    if not created:
        response.status_code = 200
    return command_out(cmd)


@router.get("/devices/{device_id}/commands/{command_id}", response_model=CommandOut)
async def get_command(device_id: str, command_id: UUID, session: AsyncSession = Depends(get_session)):
    return command_out(await command_service.get_command(session, device_id, command_id))


@router.get("/devices/{device_id}/commands", response_model=list[CommandOut])
async def list_commands(
    device_id: str, limit: int = Query(20, ge=1, le=200), session: AsyncSession = Depends(get_session)
):
    await _get_device(session, device_id)
    return [command_out(c) for c in await command_service.recent_commands(session, limit, device_id)]


# --- bins ---

@router.get("/bins", response_model=list[BinOut])
async def list_bins(session: AsyncSession = Depends(get_session)):
    return [bin_out(b) for b in await bin_service.list_bins(session)]


@router.get("/bins/{bin_id}", response_model=BinOut)
async def get_bin(bin_id: str, session: AsyncSession = Depends(get_session)):
    return bin_out(await bin_service.get_bin(session, bin_id))


@router.get("/bins/{bin_id}/history", response_model=BinHistoryOut)
async def bin_history(
    bin_id: str,
    start: datetime | None = Query(None, alias="from"),
    end: datetime | None = Query(None, alias="to"),
    limit: int = Query(200, ge=1, le=5000),
    session: AsyncSession = Depends(get_session),
):
    rows = await bin_service.history(session, bin_id, start, end, limit)
    return BinHistoryOut(bin_id=bin_id, items=[SensorLogOut.model_validate(r) for r in rows])


def _calibration_out(b) -> CalibrationOut:
    return CalibrationOut(
        bin_id=b.bin_id,
        empty_distance_cm=b.empty_distance_cm,
        full_distance_cm=b.full_distance_cm,
        calibrated=b.empty_distance_cm is not None and b.full_distance_cm is not None,
    )


@router.get("/bins/{bin_id}/calibration", response_model=CalibrationOut)
async def get_calibration(bin_id: str, session: AsyncSession = Depends(get_session)):
    return _calibration_out(await bin_service.get_bin(session, bin_id))


@router.put("/bins/{bin_id}/calibration", response_model=CalibrationOut)
async def put_calibration(
    bin_id: str,
    data: CalibrationIn,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_control_token),
):
    return _calibration_out(await bin_service.update_calibration(session, bin_id, data))


# --- dashboard / statistics ---

@router.get("/dashboard", response_model=DashboardOut)
async def dashboard(request: Request, session: AsyncSession = Depends(get_session)):
    busy = await busy_device_ids(session)
    devices = await session.scalars(select(Device).order_by(Device.device_id))
    return DashboardOut(
        devices=[device_out(d, d.device_id in busy) for d in devices],
        bins=[bin_out(b) for b in await bin_service.list_bins(session)],
        recent_commands=[command_out(c) for c in await command_service.recent_commands(session, 10)],
        recent_detections=[
            detection_out(d)
            for d in (await detection_service.page(
                session, device_id=None, waste_type=None, outcome=None, source=None,
                start=None, end=None, order="desc", limit=10, offset=0,
            ))[0]
        ],
        server_time=utcnow(),
        hardware_mode=request.app.state.hardware.mode,
        edges=edge_service.edge_statuses(),
        latest_full_alert=await edge_service.latest_full_alert(session),
    )


@router.get("/statistics", response_model=StatisticsOut)
async def statistics(hours: int = Query(24, ge=1, le=24 * 30), session: AsyncSession = Depends(get_session)):
    return await bin_service.statistics(session, hours)


# --- history / analytics (읽기 전용, 추가 API) ---

@router.get("/measurements", response_model=MeasurementPage)
async def list_measurements(
    device_id: str | None = None,
    bin_id: str | None = None,
    sensor_status: str | None = None,
    source: str | None = None,
    start: datetime | None = Query(None, alias="from"),
    end: datetime | None = Query(None, alias="to"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
):
    rows, total = await history_service.measurements(
        session, device_id=device_id, bin_id=bin_id, sensor_status=sensor_status, source=source,
        start=start, end=end, order=order, limit=limit, offset=offset,
    )
    return MeasurementPage(
        items=[MeasurementOut.model_validate(r) for r in rows], total=total, limit=limit, offset=offset
    )


@router.get("/commands", response_model=CommandPage)
async def list_all_commands(
    device_id: str | None = None,
    status: str | None = None,
    command: str | None = None,
    bin_id: str | None = None,
    start: datetime | None = Query(None, alias="from"),
    end: datetime | None = Query(None, alias="to"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
):
    rows, total = await history_service.commands(
        session, device_id=device_id, status=status, command=command, bin_id=bin_id,
        start=start, end=end, order=order, limit=limit, offset=offset,
    )
    return CommandPage(items=[command_out(c) for c in rows], total=total, limit=limit, offset=offset)


@router.get("/statistics/trend", response_model=TrendOut)
async def statistics_trend(
    hours: int = Query(24, ge=1, le=24 * 30),
    bucket_minutes: int = Query(60, ge=1, le=24 * 60),
    session: AsyncSession = Depends(get_session),
):
    if hours * 60 / bucket_minutes > 2000:
        raise APIError(422, "TOO_MANY_BUCKETS", "increase bucket_minutes or reduce hours")
    rows = await history_service.fill_trend(session, hours, bucket_minutes)
    return TrendOut(
        period_hours=hours,
        bucket_minutes=bucket_minutes,
        buckets=[
            TrendBucketOut(
                bucket_start=r[0], bin_id=r[1],
                avg_fill_percent=round(r[2], 1) if r[2] is not None else None,
                max_fill_percent=r[3], sample_count=r[4], error_count=r[5],
            )
            for r in rows
        ],
    )


# --- 장치 경로 없는 명령 API (웹·앱 공통 계약 별칭. 기존 /api/devices/{id}/commands 와 동일 동작) ---

@router.post("/commands", response_model=CommandOut, status_code=202)
async def create_command_global(
    req: GlobalCommandCreate,
    response: Response,
    session: AsyncSession = Depends(get_session),
    hardware: HardwareAdapter = Depends(get_hardware),
    requested_by: str = Depends(require_control_token),
):
    body = CommandCreate(command=req.command, target=req.target, bin_id=req.bin_id, command_id=req.command_id)
    cmd, created = await command_service.create_command(session, hardware, req.device_id, body, requested_by)
    if not created:
        response.status_code = 200
    return command_out(cmd)


@router.get("/commands/{command_id}", response_model=CommandOut)
async def get_command_global(command_id: UUID, session: AsyncSession = Depends(get_session)):
    cmd = await session.scalar(select(DeviceCommand).where(DeviceCommand.command_id == command_id))
    if cmd is None:
        raise APIError(404, "COMMAND_NOT_FOUND", "command not found")
    return command_out(cmd)


# --- AI 분류 (외부 AI 프로그램 → 서버) ---

@router.post(
    "/detections",
    response_model=DetectionOut,
    status_code=201,
    openapi_extra={
        "requestBody": {
            "content": {
                "application/json": {"schema": {"$ref": "#/components/schemas/DetectionCreate"}},
                "multipart/form-data": {
                    "schema": {
                        "type": "object",
                        "required": ["metadata", "image"],
                        "properties": {
                            "metadata": {"type": "string", "description": "EdgeDetectionMeta JSON"},
                            "image": {"type": "string", "format": "binary"},
                        },
                    }
                },
            }
        }
    },
)
async def create_detection(
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_session),
    hardware: HardwareAdapter = Depends(get_hardware),
    _: str = Depends(require_ai_token),
):
    """JSON(기존 계약) 또는 multipart(metadata JSON + image 파일, 카메라 노트북)."""
    ctype = request.headers.get("content-type", "")
    if ctype.startswith(("multipart/form-data", "application/x-www-form-urlencoded")):
        det, created = await edge_ingest.ingest_multipart(request, session, hardware)
    else:
        try:
            req = DetectionCreate.model_validate_json(await request.body())
        except ValidationError as exc:
            raise RequestValidationError(exc.errors()) from exc
        det, created = await detection_service.ingest(session, hardware, req)
    if not created:
        response.status_code = 200
    return detection_out(det)


@router.get("/detections", response_model=DetectionPage)
async def list_detections(
    device_id: str | None = None,
    waste_type: str | None = None,
    outcome: str | None = None,
    source: str | None = None,
    start: datetime | None = Query(None, alias="from"),
    end: datetime | None = Query(None, alias="to"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
):
    rows, total = await detection_service.page(
        session, device_id=device_id, waste_type=waste_type, outcome=outcome, source=source,
        start=start, end=end, order=order, limit=limit, offset=offset,
    )
    return DetectionPage(items=[detection_out(r) for r in rows], total=total, limit=limit, offset=offset)


@router.get("/detections/summary", response_model=DetectionSummaryOut)
async def detection_summary(
    since: datetime = Query(..., description="집계 시작 시각 (예: 클라이언트 기준 오늘 0시, ISO-8601)"),
    source: str | None = None,
    session: AsyncSession = Depends(get_session),
):
    total, by_type, by_outcome, avg = await detection_service.summary(session, since, source)
    return DetectionSummaryOut(since=since, total=total, by_waste_type=by_type, by_outcome=by_outcome, avg_confidence=avg)


# --- 점검 기록 ---

@router.post("/maintenance", response_model=MaintenanceOut, status_code=201)
async def create_maintenance(
    req: MaintenanceCreate,
    session: AsyncSession = Depends(get_session),
    requested_by: str = Depends(require_control_token),
):
    await _get_device(session, req.device_id)
    if req.bin_id is not None:
        b = await session.scalar(select(Bin).where(Bin.bin_id == req.bin_id, Bin.device_id == req.device_id))
        if b is None:
            raise APIError(422, "INVALID_TARGET", f"bin {req.bin_id} does not belong to {req.device_id}")
    log = MaintenanceLog(**req.model_dump(), created_by=requested_by)
    session.add(log)
    await session.commit()
    await session.refresh(log)
    out = MaintenanceOut.model_validate(log)
    from app.websocket.manager import ws_manager

    await ws_manager.broadcast("maintenance.created", out.model_dump(mode="json"))
    return out


@router.get("/maintenance", response_model=MaintenancePage)
async def list_maintenance(
    device_id: str | None = None,
    kind: str | None = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
):
    stmt = select(MaintenanceLog)
    if device_id:
        stmt = stmt.where(MaintenanceLog.device_id == device_id)
    if kind:
        stmt = stmt.where(MaintenanceLog.kind == kind)
    total = await session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = await session.scalars(stmt.order_by(MaintenanceLog.created_at.desc()).limit(limit).offset(offset))
    return MaintenancePage(items=[MaintenanceOut.model_validate(r) for r in rows], total=total, limit=limit, offset=offset)
