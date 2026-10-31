"""MQTT 메시지 → 검증 → 서비스 호출. 검증 실패 메시지는 로그 후 폐기한다."""
import json
import logging
from collections import OrderedDict
from uuid import UUID

from pydantic import ValidationError

from app.core.config import settings
from app.database.session import SessionLocal
from app.hardware.interfaces import ACCEPTED_SOURCE, HardwareMode
from app.schemas.mqtt import AckPayload, StatusPayload, TelemetryPayload
from app.services import command_service, telemetry_service

logger = logging.getLogger(__name__)

_MODE = HardwareMode(settings.hardware_mode)
_seen_message_ids: OrderedDict[UUID, None] = OrderedDict()
_SEEN_MAX = 1024


def _is_duplicate(message_id: UUID | None) -> bool:
    """QoS 1 재전송으로 같은 telemetry/status가 두 번 오면 한 번만 처리한다."""
    if message_id is None:
        return False
    if message_id in _seen_message_ids:
        return True
    _seen_message_ids[message_id] = None
    if len(_seen_message_ids) > _SEEN_MAX:
        _seen_message_ids.popitem(last=False)
    return False


def _accepts(source, device_id: str) -> bool:
    if source is None or source == ACCEPTED_SOURCE[_MODE]:
        return True
    logger.warning("dropping %s data from %s: HARDWARE_MODE=%s", source, device_id, _MODE)
    return False


def _parse(model, topic_device_id: str, raw: bytes):
    try:
        data = model.model_validate(json.loads(raw))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        logger.warning("invalid JSON from %s: %s", topic_device_id, exc)
        return None
    except ValidationError as exc:
        logger.warning("rejected %s from %s: %s", model.__name__, topic_device_id, exc.errors(include_url=False))
        return None
    if data.device_id != topic_device_id:
        logger.warning("device_id mismatch: topic=%s payload=%s", topic_device_id, data.device_id)
        return None
    return data


async def handle_telemetry(device_id: str, raw: bytes) -> None:
    payload = _parse(TelemetryPayload, device_id, raw)
    if payload is None or not _accepts(payload.source, device_id) or _is_duplicate(payload.message_id):
        return
    async with SessionLocal() as session:
        try:
            await telemetry_service.ingest_telemetry(session, payload)
        except telemetry_service.TelemetryRejected as exc:
            logger.warning("telemetry rejected: %s", exc)


async def handle_status(device_id: str, raw: bytes) -> None:
    payload = _parse(StatusPayload, device_id, raw)
    if payload is None or not _accepts(payload.source, device_id) or _is_duplicate(payload.message_id):
        return
    async with SessionLocal() as session:
        try:
            await telemetry_service.ingest_status(session, payload)
        except telemetry_service.TelemetryRejected as exc:
            logger.warning("status rejected: %s", exc)


async def handle_ack(device_id: str, raw: bytes) -> None:
    payload = _parse(AckPayload, device_id, raw)
    if payload is None:
        return
    async with SessionLocal() as session:
        await command_service.handle_ack(session, payload)


HANDLERS = {"telemetry": handle_telemetry, "status": handle_status, "ack": handle_ack}
