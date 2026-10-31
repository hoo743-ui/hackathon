"""AI 분류 수신 → 자동 배출 → ACK → 처리 결과, 점검 기록."""
import json
import uuid
from datetime import timedelta

from sqlalchemy import update

from app.core.time import utcnow
from app.models import Device, DeviceCommand
from app.mqtt.handlers import handle_ack
from app.services.command_service import expire_timed_out_commands

AI = {"Authorization": "Bearer test-ai-token"}


async def device(session, **values):
    await session.execute(update(Device).values(**values))
    await session.commit()


async def detect(client, **body):
    return await client.post("/api/detections", json={"waste_type": "plastic", "confidence": 0.9, **body}, headers=AI)


async def ack(cid, success=True, code=None):
    await handle_ack("DEVICE_001", json.dumps({"message_type": "ack", "command_id": cid, "device_id": "DEVICE_001",
                                               "status": "SUCCEEDED" if success else "FAILED", "error_code": code,
                                               "message": "BIN_OPENED" if success else code}).encode())


async def test_ai_token_required(client, auth):
    assert (await client.post("/api/detections", json={"waste_type": "metal", "confidence": 0.9})).status_code == 401
    # 제어 토큰으로는 분류를 보낼 수 없다 (권한 분리)
    assert (await client.post("/api/detections", json={"waste_type": "metal", "confidence": 0.9}, headers=auth)).status_code == 403


async def test_auto_mode_sorts_and_completes_on_ack(client, session, publisher, events):
    await device(session, connection_status="online", operating_mode="AUTO")
    r = await detect(client, model="yolo-test")
    assert r.status_code == 201
    d = r.json()
    assert d["outcome"] == "SORTING" and d["bin_id"] == "BIN_001" and d["command_id"]
    msg = publisher.messages[0][1]
    assert msg["command"] == "OPEN_BIN" and msg["origin"] == "auto" and msg["bin_id"] == "BIN_001"

    await ack(d["command_id"])
    got = (await client.get("/api/detections?limit=1")).json()["items"][0]
    assert got["outcome"] == "SORTED" and got["outcome_detail"] == "BIN_OPENED"
    assert "detection.updated" in events.types()


async def test_auto_sort_failure_and_timeout(client, session, publisher):
    await device(session, connection_status="online", operating_mode="AUTO")
    d1 = (await detect(client)).json()
    await ack(d1["command_id"], success=False, code="MOTION_TIMEOUT")
    got = (await client.get("/api/detections?outcome=SORT_FAILED")).json()
    assert got["total"] == 1 and got["items"][0]["outcome_detail"] == "MOTION_TIMEOUT"

    d2 = (await detect(client, waste_type="metal")).json()
    await session.execute(update(DeviceCommand).values(requested_at=utcnow() - timedelta(seconds=60)))
    await session.commit()
    await expire_timed_out_commands(session)
    got = (await client.get(f"/api/detections?waste_type=metal")).json()["items"][0]
    assert got["command_id"] == d2["command_id"] and got["outcome"] == "SORT_FAILED" and got["outcome_detail"] == "ACK_TIMEOUT"


async def test_no_actuation_cases(client, session, publisher):
    await device(session, connection_status="online", operating_mode="AUTO")
    assert (await detect(client, confidence=0.3)).json()["outcome"] == "LOW_CONFIDENCE"
    assert (await detect(client, waste_type="battery")).json()["outcome"] == "UNRECOGNIZED"
    await device(session, operating_mode="MANUAL")
    assert (await detect(client)).json()["outcome"] == "MANUAL_MODE"
    await device(session, operating_mode="AUTO", connection_status="offline")
    r = (await detect(client)).json()
    assert r["outcome"] == "DEVICE_UNAVAILABLE" and r["outcome_detail"] == "DEVICE_OFFLINE"
    assert publisher.messages == []  # 어느 경우에도 모터 명령 없음


async def test_mode_origin_rule(client, auth, session):
    await device(session, connection_status="online", operating_mode="AUTO")
    r = await client.post("/api/commands", json={"device_id": "DEVICE_001", "command": "OPEN_BIN", "target": "metal"}, headers=auth)
    assert r.status_code == 409 and r.json()["error"]["code"] == "MODE_CONFLICT"


async def test_detection_idempotent_and_summary(client, session):
    did = str(uuid.uuid4())
    r1 = await detect(client, detection_id=did, confidence=0.75)
    r2 = await detect(client, detection_id=did, confidence=0.75)
    assert r1.status_code == 201 and r2.status_code == 200 and r1.json()["id"] == r2.json()["id"]
    await detect(client, waste_type="paper", confidence=0.95)
    since = (utcnow() - timedelta(hours=1)).isoformat()
    s = (await client.get("/api/detections/summary", params={"since": since})).json()
    assert s["total"] == 2 and s["by_waste_type"] == {"plastic": 1, "paper": 1}
    assert s["by_outcome"]["MANUAL_MODE"] == 2 and s["avg_confidence"] == 0.85


async def test_simulator_detection_rejected_in_real_mode(client, publisher):
    from app.hardware.interfaces import HardwareMode

    publisher.mode = HardwareMode.ESP32_REAL
    r = await detect(client, source="simulator")
    assert r.status_code == 409 and r.json()["error"]["code"] == "SOURCE_MODE_MISMATCH"


async def test_maintenance_log(client, auth):
    body = {"kind": "sensor_test", "result": "issue", "bin_id": "BIN_002", "note": "센서 각도 틀어짐"}
    assert (await client.post("/api/maintenance", json=body)).status_code == 401
    r = await client.post("/api/maintenance", json=body, headers=auth)
    assert r.status_code == 201 and r.json()["created_by"] == "api-token"
    assert (await client.post("/api/maintenance", json={**body, "bin_id": "BIN_999"}, headers=auth)).status_code == 422
    assert (await client.post("/api/maintenance", json={**body, "kind": "party"}, headers=auth)).status_code == 422
    page = (await client.get("/api/maintenance?kind=sensor_test")).json()
    assert page["total"] == 1 and page["items"][0]["note"] == "센서 각도 틀어짐"
