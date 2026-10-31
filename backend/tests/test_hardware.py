"""HAL · 프로토콜 v1.1 · 하드웨어 모드 테스트."""
import json
import uuid

import pytest
from sqlalchemy import func, select, update

from app.hardware import device_manager
from app.hardware.interfaces import HardwareMode
from app.models import Device, DeviceCommand, SensorLog
from app.mqtt import handlers
from app.mqtt.handlers import handle_ack, handle_status, handle_telemetry
from app.schemas.mqtt import AckPayload, CommandMessage
from tests.test_telemetry import ALL_NORMAL, telemetry

WASTE = {"BIN_001": "plastic", "BIN_002": "metal", "BIN_003": "paper", "BIN_004": "glass"}


def telemetry_v11(message_id=None, source="simulator", waste=WASTE) -> bytes:
    return json.dumps({
        "schema_version": 1, "message_type": "telemetry", "message_id": str(message_id or uuid.uuid4()),
        "device_id": "DEVICE_001", "source": source, "timestamp": None,
        "bins": [{"bin_id": b, "waste_type": waste[b], "distance_cm": d, "fill_percent": 99.0, "sensor_status": s}
                 for b, (d, s) in ALL_NORMAL.items()],
    }).encode()


async def count_logs(session) -> int:
    return await session.scalar(select(func.count()).select_from(SensorLog))


async def test_v11_telemetry_accepted_and_device_fill_ignored(session, events):
    await handle_telemetry("DEVICE_001", telemetry_v11())
    rows = list(await session.scalars(select(SensorLog)))
    assert len(rows) == 4 and all(r.fill_percent is None for r in rows)  # 미보정 → 장치 값 99 무시


async def test_duplicate_message_id_processed_once(session, events):
    mid = uuid.uuid4()
    await handle_telemetry("DEVICE_001", telemetry_v11(mid))
    await handle_telemetry("DEVICE_001", telemetry_v11(mid))
    assert await count_logs(session) == 4


async def test_waste_type_mismatch_rejected(session, events):
    await handle_telemetry("DEVICE_001", telemetry_v11(waste={**WASTE, "BIN_002": "paper"}))
    assert await count_logs(session) == 0


async def test_simulator_mode_rejects_hardware_source(session, events):
    await handle_telemetry("DEVICE_001", telemetry_v11(source="hardware"))
    assert await count_logs(session) == 0


async def test_real_mode_rejects_simulator_source(session, events, monkeypatch):
    monkeypatch.setattr(handlers, "_MODE", HardwareMode.ESP32_REAL)
    await handle_telemetry("DEVICE_001", telemetry_v11(source="simulator"))
    assert await count_logs(session) == 0
    await handle_telemetry("DEVICE_001", telemetry_v11(source="hardware"))
    assert await count_logs(session) == 4
    # LWT(출처 없음)는 모드와 무관하게 수락
    await handle_status("DEVICE_001", json.dumps({"device_id": "DEVICE_001", "state": "offline"}).encode())
    assert (await session.scalar(select(Device))).connection_status == "offline"


async def test_status_error_code_stored_and_cleared(session, events):
    base = {"message_type": "status", "device_id": "DEVICE_001", "state": "online", "source": "simulator"}
    await handle_status("DEVICE_001", json.dumps({**base, "error_code": "SENSOR_FAULT"}).encode())
    assert (await session.scalar(select(Device))).error_code == "SENSOR_FAULT"
    await handle_status("DEVICE_001", json.dumps({**base, "error_code": None}).encode())
    session.expire_all()
    assert (await session.scalar(select(Device))).error_code is None


def test_ack_v1_and_v11_normalize():
    cid = str(uuid.uuid4())
    v1 = AckPayload.model_validate({"command_id": cid, "device_id": "DEVICE_001", "success": False, "message": "BUSY"})
    assert v1.status == "FAILED" and v1.error_code == "BUSY"
    v11 = AckPayload.model_validate({"command_id": cid, "device_id": "DEVICE_001", "status": "SUCCEEDED",
                                     "error_code": None, "completed_at": "2026-10-31T10:00:01Z"})
    assert v11.success is True and v11.message == "OK" and v11.completed_at is not None
    with pytest.raises(ValueError):
        AckPayload.model_validate({"command_id": cid, "device_id": "DEVICE_001", "status": "SUCCEEDED", "success": False})
    with pytest.raises(ValueError):
        AckPayload.model_validate({"command_id": cid, "device_id": "DEVICE_001"})


def test_command_message_has_v1_and_v11_fields():
    from datetime import UTC, datetime

    now = datetime.now(UTC)
    m = CommandMessage(command_id=uuid.uuid4(), device_id="DEVICE_001", command="OPEN_BIN", target="plastic",
                       bin_id="BIN_001", requested_at=now, expires_at=now).model_dump(mode="json")
    assert m["message_type"] == "command" and m["message_id"] == m["command_id"]
    assert m["action"] == m["command"] == "OPEN_BIN" and m["issued_at"] == m["requested_at"] and m["bin_id"] == "BIN_001"


async def set_online(session):
    await session.execute(update(Device).values(connection_status="online"))
    await session.commit()


async def test_global_command_api_with_bin_id(client, auth, session, publisher):
    await set_online(session)
    r = await client.post("/api/commands", json={"device_id": "DEVICE_001", "command": "OPEN_BIN", "bin_id": "BIN_003"}, headers=auth)
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["target"] == "paper" and body["bin_id"] == "BIN_003"
    assert publisher.messages[0][1]["bin_id"] == "BIN_003"
    got = (await client.get(f"/api/commands/{body['command_id']}")).json()
    assert got["status"] == "SENT"
    assert (await client.get(f"/api/commands/{uuid.uuid4()}")).status_code == 404


async def test_bin_id_target_conflict_rejected(client, auth, session):
    await set_online(session)
    r = await client.post("/api/commands", json={"device_id": "DEVICE_001", "command": "OPEN_BIN", "target": "metal", "bin_id": "BIN_001"}, headers=auth)
    assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_TARGET"
    r = await client.post("/api/commands", json={"device_id": "DEVICE_001", "command": "GET_STATUS", "bin_id": "BIN_001"}, headers=auth)
    assert r.status_code == 422


async def test_v11_ack_completes_command(client, auth, session):
    await set_online(session)
    cmd = (await client.post("/api/commands", json={"device_id": "DEVICE_001", "command": "OPEN_BIN", "target": "metal"}, headers=auth)).json()
    ack = {"message_type": "ack", "command_id": cmd["command_id"], "device_id": "DEVICE_001",
           "status": "FAILED", "error_code": "PINMAP_UNCONFIRMED"}
    await handle_ack("DEVICE_001", json.dumps(ack).encode())
    got = (await client.get(f"/api/commands/{cmd['command_id']}")).json()
    assert got["status"] == "FAILED" and got["error_message"] == "PINMAP_UNCONFIRMED"


async def test_health_reports_mode(client):
    h = (await client.get("/health")).json()
    assert h["hardware_mode"] == "SIMULATOR" and h["simulator_running"] is False
    assert (await client.get("/api/dashboard")).json()["hardware_mode"] == "SIMULATOR"


def test_adapter_factory():
    from app.core.config import settings

    assert device_manager.create_adapter(settings.model_copy(update={"hardware_mode": "SIMULATOR"})).mode == HardwareMode.SIMULATOR
    real = device_manager.create_adapter(settings.model_copy(update={"hardware_mode": "ESP32_REAL"}))
    assert real.mode == HardwareMode.ESP32_REAL and not real.simulator_running
    assert real.accepts_source("hardware") and not real.accepts_source("simulator") and real.accepts_source(None)
