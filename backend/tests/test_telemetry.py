import json

from sqlalchemy import func, select

from app.models import Bin, Device, SensorLog
from app.mqtt.handlers import handle_ack, handle_status, handle_telemetry


def telemetry(readings: dict[str, tuple[float | None, str]], device="DEVICE_001", source="simulator") -> bytes:
    return json.dumps(
        {
            "schema_version": 1,
            "device_id": device,
            "source": source,
            "timestamp": None,
            "bins": [
                {"bin_id": b, "distance_cm": d, "sensor_status": s} for b, (d, s) in readings.items()
            ],
        }
    ).encode()


ALL_NORMAL = {"BIN_001": (30.0, "normal"), "BIN_002": (20.0, "normal"), "BIN_003": (10.0, "normal"), "BIN_004": (6.0, "normal")}


async def calibrate_all(session, empty=40.0, full=5.0):
    for b in await session.scalars(select(Bin)):
        b.empty_distance_cm, b.full_distance_cm = empty, full
    await session.commit()


async def test_telemetry_stored_and_bins_updated(session, events):
    await calibrate_all(session)
    await handle_telemetry("DEVICE_001", telemetry(ALL_NORMAL))
    session.expire_all()  # 핸들러는 별도 세션에서 커밋한다

    assert await session.scalar(select(func.count()).select_from(SensorLog)) == 4
    b1 = await session.scalar(select(Bin).where(Bin.bin_id == "BIN_001"))
    assert b1.current_distance_cm == 30.0
    assert b1.current_fill_percent == round((40 - 30) / 35 * 100, 1)
    device = await session.scalar(select(Device))
    assert device.connection_status == "online" and device.data_source == "simulator"
    assert "bins.updated" in events.types() and "device.status" in events.types()


async def test_uncalibrated_bins_have_null_fill(session, events):
    await handle_telemetry("DEVICE_001", telemetry(ALL_NORMAL))
    b1 = await session.scalar(select(Bin).where(Bin.bin_id == "BIN_001"))
    assert b1.current_distance_cm == 30.0 and b1.current_fill_percent is None


async def test_sensor_error_keeps_last_valid_value(session, events):
    await calibrate_all(session)
    await handle_telemetry("DEVICE_001", telemetry(ALL_NORMAL))
    failing = dict(ALL_NORMAL, BIN_002=(None, "timeout"), BIN_003=(950.0, "normal"))
    await handle_telemetry("DEVICE_001", telemetry(failing))

    session.expire_all()
    b2 = await session.scalar(select(Bin).where(Bin.bin_id == "BIN_002"))
    b3 = await session.scalar(select(Bin).where(Bin.bin_id == "BIN_003"))
    assert b2.sensor_status == "timeout" and b2.current_distance_cm == 20.0
    assert b3.sensor_status == "out_of_range" and b3.current_distance_cm == 10.0
    last = await session.scalar(
        select(SensorLog).where(SensorLog.bin_id == "BIN_003").order_by(SensorLog.id.desc()).limit(1)
    )
    assert last.distance_cm is None and last.fill_percent is None


async def test_invalid_messages_are_rejected_without_writes(session, events):
    await handle_telemetry("DEVICE_001", b"not json")
    await handle_telemetry("DEVICE_001", telemetry({"BIN_001": (10.0, "normal")}))  # 4개 중 1개만
    await handle_telemetry("DEVICE_002", telemetry(ALL_NORMAL, device="DEVICE_002"))  # 미등록 장치
    await handle_telemetry("DEVICE_001", telemetry(ALL_NORMAL, device="DEVICE_009"))  # 토픽 불일치
    assert await session.scalar(select(func.count()).select_from(SensorLog)) == 0


async def test_status_and_lwt_update_device(session, events):
    online = {"device_id": "DEVICE_001", "state": "online",
              "operating_mode": "AUTO", "estop_active": False, "firmware_version": "0.1.0",
              "source": "simulator"}
    await handle_status("DEVICE_001", json.dumps(online).encode())
    d = await session.scalar(select(Device))
    assert d.connection_status == "online" and d.operating_mode == "AUTO" and d.data_source == "simulator"

    await handle_status("DEVICE_001", json.dumps({"device_id": "DEVICE_001", "state": "offline"}).encode())
    session.expire_all()
    d = await session.scalar(select(Device))
    assert d.connection_status == "offline" and d.operating_mode == "AUTO"


async def test_ack_for_unknown_command_is_ignored(events):
    ack = {"command_id": "6f1c2b8e-1d0a-4c5e-9f0b-1a2b3c4d5e6f", "device_id": "DEVICE_001",
           "success": True, "message": "BIN_OPENED"}
    await handle_ack("DEVICE_001", json.dumps(ack).encode())
    assert events.types() == []
