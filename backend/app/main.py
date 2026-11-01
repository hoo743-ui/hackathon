import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from app.api import edge_routes
from app.api.routes import health_router, router
from app.core.config import settings
from app.core.errors import APIError, api_error_handler, validation_error_handler
from app.database.session import SessionLocal
from app.hardware.device_manager import create_adapter
from app.services import command_service, discovery, edge_service, telemetry_service
from app.websocket.routes import router as ws_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("smartbin")


async def supervisor_loop() -> None:
    """ACK 타임아웃 및 무응답 장치 offline 처리."""
    while True:
        try:
            async with SessionLocal() as session:
                await command_service.expire_timed_out_commands(session)
                await telemetry_service.mark_stale_devices_offline(session)
            await edge_service.broadcast_stale_edges()
        except Exception:
            logger.exception("supervisor loop error")
        await asyncio.sleep(1)


@asynccontextmanager
async def lifespan(app: FastAPI):
    hardware = create_adapter(settings)
    app.state.hardware = hardware
    logger.info("HARDWARE_MODE=%s", hardware.mode)
    supervisor = asyncio.create_task(supervisor_loop())
    beacon = asyncio.create_task(discovery.beacon_loop()) if settings.discovery_enabled else None
    if settings.mqtt_enabled:
        await hardware.start()
    yield
    await hardware.disconnect()
    if beacon:
        beacon.cancel()
    supervisor.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await supervisor


app = FastAPI(title="Smart Recycling API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=settings.cors_origin_regex or None,
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["Authorization", "Content-Type"],
)
app.add_exception_handler(APIError, api_error_handler)
app.add_exception_handler(RequestValidationError, validation_error_handler)
app.include_router(health_router)
app.include_router(edge_routes.pre_router)
app.include_router(router)
app.include_router(edge_routes.router)
app.include_router(ws_router)
