"""MQTT 계약 검사: 가상 장치가 실제로 보내는 메시지가 docs/mqtt-schemas 를 만족하고, 계약 파일이 코드와 일치하는지."""
import json
import subprocess
import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import jsonschema
import pytest

from app.hardware.simulator import VirtualDevice, VirtualDeviceConfig

ROOT = Path(__file__).resolve().parents[2]
SCHEMAS = {n: json.loads((ROOT / f"docs/mqtt-schemas/{n}.schema.json").read_text())
           for n in ("telemetry", "status", "ack", "command")}


def test_contract_files_up_to_date():
    r = subprocess.run([sys.executable, str(ROOT / "scripts/export_contracts.py"), "--check"],
                       cwd=ROOT / "backend", capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


@pytest.fixture
def device():
    dev = VirtualDevice(VirtualDeviceConfig(mqtt_host="x", mqtt_port=1, username=None, password=None, scenario="sensor-fail"))
    dev.sent = []

    async def capture(kind, payload, retain=False):
        dev.sent.append((kind, payload))

    dev.publish = capture
    dev.connected = True
    return dev


async def test_simulator_messages_match_schemas(device):
    await device.publish_telemetry()
    await device.publish_telemetry()  # sensor-fail → SENSOR_FAULT status 발생
    now = datetime.now(UTC)
    cmd = {"message_type": "command", "command_id": str(uuid.uuid4()), "device_id": "DEVICE_001",
           "command": "SET_MODE", "target": "MANUAL", "expires_at": (now + timedelta(seconds=3)).isoformat()}
    await device.handle_command(json.dumps(cmd).encode())
    await device.handle_command(json.dumps(cmd).encode())  # DUPLICATE → FAILED ack
    kinds = [k for k, _ in device.sent]
    assert {"telemetry", "status", "ack"} <= set(kinds)
    for kind, payload in device.sent:
        jsonschema.validate(payload, SCHEMAS[kind])
    acks = [p for k, p in device.sent if k == "ack"]
    assert acks[0]["status"] == "SUCCEEDED" and acks[-1]["error_code"] == "DUPLICATE"


def test_server_command_message_matches_schema():
    from app.schemas.mqtt import CommandMessage

    now = datetime.now(UTC)
    m = CommandMessage(command_id=uuid.uuid4(), device_id="DEVICE_001", command="OPEN_BIN", target="metal",
                       bin_id="BIN_002", requested_at=now, expires_at=now).model_dump(mode="json")
    jsonschema.validate(m, SCHEMAS["command"])
