import json
import uuid
from datetime import timedelta

from sqlalchemy import select, update

from app.core.time import utcnow
from app.models import Device, DeviceCommand
from app.mqtt.handlers import handle_ack
from app.services.command_service import expire_timed_out_commands

URL = "/api/devices/DEVICE_001/commands"


async def set_device(session, **values):
    await session.execute(update(Device).where(Device.device_id == "DEVICE_001").values(**values))
    await session.commit()


async def ack(command_id: str, success=True, message="BIN_OPENED"):
    payload = {"command_id": command_id, "device_id": "DEVICE_001", "success": success,
               "message": message, "executed_at": utcnow().isoformat()}
    await handle_ack("DEVICE_001", json.dumps(payload).encode())


async def test_requires_token(client):
    assert (await client.post(URL, json={"command": "GET_STATUS"})).status_code == 401


async def test_offline_device_rejected(client, auth):
    r = await client.post(URL, json={"command": "OPEN_BIN", "target": "plastic"}, headers=auth)
    assert r.status_code == 409 and r.json()["error"]["code"] == "DEVICE_OFFLINE"


async def test_invalid_target_and_command(client, auth, session):
    await set_device(session, connection_status="online")
    r = await client.post(URL, json={"command": "OPEN_BIN", "target": "battery"}, headers=auth)
    assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_TARGET"
    r = await client.post(URL, json={"command": "SELF_DESTRUCT"}, headers=auth)
    assert r.status_code == 422
    r = await client.post(URL, json={"command": "EMERGENCY_STOP", "target": "plastic"}, headers=auth)
    assert r.status_code == 422
    r = await client.post("/api/devices/DEVICE_404/commands", json={"command": "GET_STATUS"}, headers=auth)
    assert r.status_code == 404


async def test_open_bin_lifecycle_until_ack(client, auth, session, publisher, events):
    await set_device(session, connection_status="online")
    r = await client.post(URL, json={"command": "OPEN_BIN", "target": "plastic"}, headers=auth)
    assert r.status_code == 202
    cmd = r.json()
    assert cmd["status"] == "SENT"  # 전송만 됨 — 실행 완료 아님

    topic, payload = publisher.messages[0]
    assert topic == "smartbin/DEVICE_001/command"
    assert payload["command"] == "OPEN_BIN" and payload["target"] == "plastic"
    assert payload["command_id"] == cmd["command_id"] and "expires_at" in payload

    # 진행 중에는 추가 명령 거부
    r = await client.post(URL, json={"command": "OPEN_BIN", "target": "metal"}, headers=auth)
    assert r.status_code == 409 and r.json()["error"]["code"] == "DEVICE_BUSY"
    assert (await client.get("/api/devices/DEVICE_001")).json()["busy"] is True

    await ack(cmd["command_id"])
    r = await client.get(f"{URL}/{cmd['command_id']}")
    assert r.json()["status"] == "SUCCEEDED" and r.json()["result_message"] == "BIN_OPENED"
    assert "command.updated" in events.types()

    # 중복 ACK는 상태를 바꾸지 않음
    await ack(cmd["command_id"], success=False, message="LATE")
    assert (await client.get(f"{URL}/{cmd['command_id']}")).json()["status"] == "SUCCEEDED"


async def test_failed_ack(client, auth, session):
    await set_device(session, connection_status="online")
    cmd = (await client.post(URL, json={"command": "OPEN_BIN", "target": "metal"}, headers=auth)).json()
    await ack(cmd["command_id"], success=False, message="BUSY")
    r = (await client.get(f"{URL}/{cmd['command_id']}")).json()
    assert r["status"] == "FAILED" and r["error_message"] == "BUSY"


async def test_mode_conflict_and_set_mode(client, auth, session):
    await set_device(session, connection_status="online", operating_mode="AUTO")
    r = await client.post(URL, json={"command": "OPEN_BIN", "target": "paper"}, headers=auth)
    assert r.status_code == 409 and r.json()["error"]["code"] == "MODE_CONFLICT"

    cmd = (await client.post(URL, json={"command": "SET_MODE", "target": "MANUAL"}, headers=auth)).json()
    await ack(cmd["command_id"], message="MODE_SET")
    assert (await client.get("/api/devices/DEVICE_001")).json()["operating_mode"] == "MANUAL"


async def test_emergency_stop_priority_and_latch(client, auth, session):
    await set_device(session, connection_status="online")
    open_cmd = (await client.post(URL, json={"command": "OPEN_BIN", "target": "plastic"}, headers=auth)).json()

    # 진행 중 명령이 있어도 긴급정지는 즉시 접수
    r = await client.post(URL, json={"command": "EMERGENCY_STOP"}, headers=auth)
    assert r.status_code == 202
    await ack(r.json()["command_id"], message="ESTOP_ACTIVATED")
    await ack(open_cmd["command_id"], success=False, message="ABORTED_BY_ESTOP")
    assert (await client.get("/api/devices/DEVICE_001")).json()["estop_active"] is True

    r = await client.post(URL, json={"command": "OPEN_BIN", "target": "plastic"}, headers=auth)
    assert r.status_code == 409 and r.json()["error"]["code"] == "ESTOP_ACTIVE"

    reset = (await client.post(URL, json={"command": "RESET_ESTOP"}, headers=auth)).json()
    await ack(reset["command_id"], message="ESTOP_RESET")
    assert (await client.get("/api/devices/DEVICE_001")).json()["estop_active"] is False


async def test_idempotent_command_id(client, auth, session, publisher):
    await set_device(session, connection_status="online")
    cid = str(uuid.uuid4())
    r1 = await client.post(URL, json={"command": "GET_STATUS", "command_id": cid}, headers=auth)
    r2 = await client.post(URL, json={"command": "GET_STATUS", "command_id": cid}, headers=auth)
    assert r1.status_code == 202 and r2.status_code == 200
    assert r1.json()["command_id"] == r2.json()["command_id"] == cid
    assert len(publisher.messages) == 1


async def test_ack_timeout(client, auth, session):
    await set_device(session, connection_status="online")
    cmd = (await client.post(URL, json={"command": "OPEN_BIN", "target": "plastic"}, headers=auth)).json()
    await session.execute(
        update(DeviceCommand).values(requested_at=utcnow() - timedelta(seconds=60))
    )
    await session.commit()
    expired = await expire_timed_out_commands(session)
    assert [str(c.command_id) for c in expired] == [cmd["command_id"]]
    r = (await client.get(f"{URL}/{cmd['command_id']}")).json()
    assert r["status"] == "TIMEOUT" and r["error_message"] == "ACK_TIMEOUT"
    # 타임아웃 후에는 다시 명령 가능
    r = await client.post(URL, json={"command": "OPEN_BIN", "target": "plastic"}, headers=auth)
    assert r.status_code == 202


async def test_broker_down_returns_503_and_marks_failed(client, auth, session, publisher):
    await set_device(session, connection_status="online")
    publisher.fail = True
    r = await client.post(URL, json={"command": "OPEN_BIN", "target": "plastic"}, headers=auth)
    assert r.status_code == 503 and r.json()["error"]["code"] == "MQTT_UNAVAILABLE"
    cmd = await session.scalar(select(DeviceCommand))
    assert cmd.status == "FAILED"


async def test_emergency_stop_sent_even_when_server_thinks_offline(client, auth, publisher):
    r = await client.post(URL, json={"command": "EMERGENCY_STOP"}, headers=auth)
    assert r.status_code == 202 and publisher.messages[0][1]["command"] == "EMERGENCY_STOP"


async def test_late_ack_after_timeout_is_recorded(client, auth, session):
    await set_device(session, connection_status="online")
    cmd = (await client.post(URL, json={"command": "OPEN_BIN", "target": "plastic"}, headers=auth)).json()
    await session.execute(update(DeviceCommand).values(requested_at=utcnow() - timedelta(seconds=60)))
    await session.commit()
    await expire_timed_out_commands(session)
    await ack(cmd["command_id"])
    r = (await client.get(f"{URL}/{cmd['command_id']}")).json()
    assert r["status"] == "TIMEOUT" and r["error_message"] == "LATE_ACK:BIN_OPENED"


async def test_concurrent_same_command_id_is_idempotent(client, auth, session):
    import asyncio

    cid = str(uuid.uuid4())
    body = {"command": "EMERGENCY_STOP", "command_id": cid}
    r1, r2 = await asyncio.gather(client.post(URL, json=body, headers=auth), client.post(URL, json=body, headers=auth))
    assert sorted([r1.status_code, r2.status_code]) == [200, 202]
    assert r1.json()["command_id"] == r2.json()["command_id"] == cid


def test_command_timing_invariant():
    from app.core.config import MAX_DEVICE_MOTION_SEC, settings

    assert settings.command_expires_sec + MAX_DEVICE_MOTION_SEC < settings.command_ack_timeout_sec
