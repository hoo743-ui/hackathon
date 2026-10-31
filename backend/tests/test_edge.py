"""EDGE_SERIAL: 카메라 노트북 multipart 분류(이미지) · 센서 이벤트 · heartbeat · 장치 상태."""
import io
import json
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import settings
from app.hardware.interfaces import HardwareMode
from app.main import app
from app.models import Device

AI = {"Authorization": "Bearer test-ai-token"}
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 200 + b"\xff\xd9"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@pytest.fixture(autouse=True)
def edge_mode(publisher, tmp_path, monkeypatch):
    publisher.mode = HardwareMode.EDGE_SERIAL
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path))
    from app.services import edge_service
    edge_service._edges.clear()
    return publisher


def meta(**over):
    m = {
        "detection_id": str(uuid.uuid4()),
        "device_id": "CAMERA_001",
        "waste_type": "plastic",
        "class_id": 3,
        "confidence": 0.91,
        "model_name": "best_model.pt",
        "captured_at": "2026-10-31T11:00:00+09:00",
        "bounding_box": {"x1": 10, "y1": 20, "x2": 110, "y2": 220},
        "hardware_status": "command_sent",
    }
    m.update(over)
    return m


async def upload(client, m, data=JPEG, ctype="image/jpeg", headers=AI):
    return await client.post(
        "/api/detections",
        data={"metadata": json.dumps(m)},
        files={"image": ("frame.jpg", io.BytesIO(data), ctype)},
        headers=headers,
    )


async def test_multipart_upload_store_and_fetch(client, events, tmp_path):
    m = meta()
    r = await upload(client, m)
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["detection_id"] == m["detection_id"] and d["camera_id"] == "CAMERA_001" and d["device_id"] == "DEVICE_001"
    assert d["class_id"] == 3 and d["bounding_box"]["x2"] == 110 and d["hardware_status"] == "command_sent"
    # 아두이노는 ACK를 보내지 않는다 → '전송됨'이지 '완료'가 아니다
    assert d["outcome"] == "SORT_SENT" and d["outcome_detail"] == "NO_DEVICE_ACK"
    assert d["image_url"] == f"/api/detections/{m['detection_id']}/image" and "image_path" not in d
    assert d["captured_at"] == d["detected_at"]
    # 파일이 실제로 저장됨
    assert list(tmp_path.rglob(f"{m['detection_id']}.jpg"))
    # 이벤트는 저장 이후 발행, 신규 이벤트 포함
    assert events.types() == ["detection.updated", "new_detection"]
    assert events.events[1][1]["detection_id"] == m["detection_id"]

    img = await client.get(d["image_url"])
    assert img.status_code == 200 and img.headers["content-type"] == "image/jpeg" and img.content == JPEG
    one = await client.get(f"/api/detections/{m['detection_id']}")
    assert one.status_code == 200 and one.json()["id"] == d["id"]
    # summary 경로가 상세 경로에 가려지지 않음
    assert (await client.get("/api/detections/summary?since=2026-01-01T00:00:00Z")).status_code == 200


async def test_retry_is_idempotent(client, events, tmp_path):
    m = meta()
    assert (await upload(client, m)).status_code == 201
    again = await upload(client, m, data=PNG, ctype="image/png")
    assert again.status_code == 200
    assert len(list(tmp_path.rglob("*.*"))) == 1  # 두 번째 이미지는 저장하지 않음
    assert (await client.get("/api/detections")).json()["total"] == 1


@pytest.mark.parametrize(
    "data,ctype,status",
    [(b"not an image", "image/jpeg", 415), (JPEG, "application/pdf", 415), (b"", "image/jpeg", 422)],
)
async def test_invalid_images_rejected(client, tmp_path, data, ctype, status):
    r = await upload(client, meta(), data=data, ctype=ctype)
    assert r.status_code == status
    assert not list(tmp_path.rglob("*.*"))
    assert (await client.get("/api/detections")).json()["total"] == 0


async def test_too_large_rejected(client, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "max_image_bytes", 100)
    r = await upload(client, meta())
    assert r.status_code == 413


async def test_auth_and_metadata_validation(client):
    assert (await upload(client, meta(), headers={})).status_code == 401
    assert (await upload(client, meta(confidence=1.5))).status_code == 422
    r = await client.post("/api/detections", data={"metadata": json.dumps(meta())}, headers=AI)
    assert r.status_code == 422 and r.json()["error"]["code"] == "IMAGE_REQUIRED"


async def test_hardware_status_mapping(client):
    cases = {
        "not_connected": ("DEVICE_UNAVAILABLE", "SERIAL_NOT_CONNECTED"),
        "serial_failed": ("SORT_FAILED", "SERIAL_WRITE_FAILED"),
        "disabled": ("NO_HARDWARE", "HARDWARE_DISABLED"),
        "pending": ("SORTING", None),
    }
    for hw, (outcome, detail) in cases.items():
        d = (await upload(client, meta(hardware_status=hw))).json()
        assert (d["outcome"], d["outcome_detail"]) == (outcome, detail), hw
    d = (await upload(client, meta(waste_type="battery"))).json()
    assert d["outcome"] == "UNRECOGNIZED"


async def test_no_mqtt_command_in_edge_mode(client, publisher):
    await upload(client, meta())
    assert publisher.messages == []


async def test_telemetry_and_heartbeat(client, events, session):
    r = await client.post(
        "/api/telemetry",
        json={"device_id": "CAMERA_001", "kind": "bin_full_alert", "sensor_id": "TRASH", "raw": "[ALERT] full"},
        headers=AI,
    )
    assert r.status_code == 201 and r.json()["source"] == "hardware"
    assert "telemetry" in events.types()
    assert (await client.post("/api/telemetry", json={"device_id": "X", "kind": "k"})).status_code == 401

    hb = {"device_id": "CAMERA_001", "camera_ok": True, "model_loaded": True, "serial_enabled": True,
          "serial_connected": True, "serial_port": "COM5"}
    st = (await client.post("/api/edge/heartbeat", json=hb, headers=AI)).json()
    assert st["online"] is True
    dev = await session.scalar(select(Device).where(Device.device_id == "DEVICE_001"))
    await session.refresh(dev)
    assert dev.connection_status == "online" and dev.data_source == "hardware"

    s = (await client.get("/api/devices/status")).json()
    assert s["hardware_mode"] == "EDGE_SERIAL" and s["edges"][0]["serial_port"] == "COM5"
    assert s["latest_full_alert"]["sensor_id"] == "TRASH"
    dash = (await client.get("/api/dashboard")).json()
    assert dash["edges"][0]["device_id"] == "CAMERA_001" and dash["latest_full_alert"]["kind"] == "bin_full_alert"
    # 기존 /api/devices/{id} 경로도 그대로
    assert (await client.get("/api/devices/DEVICE_001")).status_code == 200


async def test_camera_only_heartbeat_does_not_mark_device_online(client, session):
    hb = {"device_id": "CAMERA_001", "camera_ok": True, "model_loaded": True, "serial_connected": False}
    await client.post("/api/edge/heartbeat", json=hb, headers=AI)
    dev = await session.scalar(select(Device).where(Device.device_id == "DEVICE_001"))
    assert dev.connection_status != "online"


async def test_api_health_alias(client):
    r = await client.get("/api/health")
    assert r.status_code == 200 and r.json()["hardware_mode"] == "EDGE_SERIAL"


def test_ws_alias_path():
    with TestClient(app).websocket_connect("/ws") as ws:
        hello = ws.receive_json()
        assert hello["type"] == "connected" and hello["event"] == "connected"


async def test_ack_updates_outcome(client, events):
    m = meta(hardware_status="command_sent")
    await upload(client, m)
    r = await client.post(f"/api/detections/{m['detection_id']}/hardware", json={"hardware_status": "completed"}, headers=AI)
    assert r.status_code == 200
    d = r.json()
    assert d["hardware_status"] == "completed" and d["outcome"] == "SORTED" and d["outcome_detail"] == "ACK_DONE"
    m2 = meta()
    await upload(client, m2)
    d2 = (await client.post(f"/api/detections/{m2['detection_id']}/hardware", json={"hardware_status": "ack_timeout"}, headers=AI)).json()
    assert d2["outcome"] == "SORT_FAILED" and d2["outcome_detail"] == "ACK_TIMEOUT"
    missing = await client.post(f"/api/detections/{uuid.uuid4()}/hardware", json={"hardware_status": "completed"}, headers=AI)
    assert missing.status_code == 404
    assert (await client.post(f"/api/detections/{m['detection_id']}/hardware", json={"hardware_status": "completed"})).status_code == 401


async def dist(client, **payload):
    return await client.post("/api/telemetry", json={"device_id": "CAMERA_001", "kind": "distance", "payload": payload}, headers=AI)


async def test_distance_to_fill_percent(client, events):
    # (1 - 측정거리/빈통거리) × 100 = (1 - 15/30) × 100 = 50
    assert (await dist(client, bin_id="BIN_001", distance_cm=15.0, empty_distance_cm=30.0, sensor_status="normal")).status_code == 201
    b = (await client.get("/api/bins/BIN_001")).json()
    assert b["current_distance_cm"] == 15.0 and b["current_fill_percent"] == 50.0 and b["sensor_status"] == "normal"
    assert "bins.updated" in events.types()
    # 끊김 → 상태만 바뀌고 마지막 정상값 유지 (값을 만들지 않음)
    await dist(client, bin_id="BIN_001", sensor_status="disconnected")
    b = (await client.get("/api/bins/BIN_001")).json()
    assert b["sensor_status"] == "disconnected" and b["current_fill_percent"] == 50.0
    # 범위 밖 값 → out_of_range
    await dist(client, bin_id="BIN_001", distance_cm=999, empty_distance_cm=30.0, sensor_status="normal")
    assert (await client.get("/api/bins/BIN_001")).json()["sensor_status"] == "out_of_range"
    # 빈통 거리 없으면 적재율 계산 안 함
    await dist(client, bin_id="BIN_002", distance_cm=10.0, sensor_status="normal")
    b2 = (await client.get("/api/bins/BIN_002")).json()
    assert b2["current_distance_cm"] == 10.0 and b2["current_fill_percent"] is None
    s = (await client.get("/api/devices/status")).json()
    assert s["latest_distance"]["payload"]["bin_id"] == "BIN_002"


async def test_distance_without_bin_is_only_logged(client):
    await dist(client, distance_cm=12.0, sensor_status="normal")
    bins = (await client.get("/api/bins")).json()
    assert all(b["current_distance_cm"] is None for b in bins)
