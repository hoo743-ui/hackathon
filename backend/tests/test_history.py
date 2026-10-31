from tests.test_telemetry import ALL_NORMAL, telemetry

from app.mqtt.handlers import handle_telemetry


async def test_measurements_filter_paginate(client, auth):
    await client.put("/api/bins/BIN_001/calibration", json={"empty_distance_cm": 40, "full_distance_cm": 5}, headers=auth)
    for _ in range(3):
        await handle_telemetry("DEVICE_001", telemetry(ALL_NORMAL))
    await handle_telemetry("DEVICE_001", telemetry(dict(ALL_NORMAL, BIN_002=(None, "timeout"))))

    r = (await client.get("/api/measurements?limit=5")).json()
    assert r["total"] == 16 and len(r["items"]) == 5 and r["offset"] == 0
    r = (await client.get("/api/measurements?bin_id=BIN_002&sensor_status=timeout")).json()
    assert r["total"] == 1 and r["items"][0]["distance_cm"] is None
    r = (await client.get("/api/measurements?bin_id=BIN_001&order=asc&limit=2&offset=2")).json()
    assert r["total"] == 4 and len(r["items"]) == 2
    assert (await client.get("/api/measurements?order=sideways")).status_code == 422


async def test_commands_page(client, auth, session):
    from tests.test_commands import set_device

    await set_device(session, connection_status="online")
    await client.post("/api/devices/DEVICE_001/commands", json={"command": "GET_STATUS"}, headers=auth)
    r = (await client.get("/api/commands?status=SENT")).json()
    assert r["total"] == 1 and r["items"][0]["command"] == "GET_STATUS"
    assert (await client.get("/api/commands?status=SUCCEEDED")).json()["total"] == 0
    from sqlalchemy import update

    from app.models import DeviceCommand

    await session.execute(update(DeviceCommand).values(status="SUCCEEDED"))  # 진행 중 명령이 있으면 DEVICE_BUSY
    await session.commit()
    r = await client.post("/api/commands", json={"device_id": "DEVICE_001", "command": "OPEN_BIN", "bin_id": "BIN_002"}, headers=auth)
    assert r.status_code == 202, r.text
    r = (await client.get("/api/commands?bin_id=BIN_002")).json()
    assert r["total"] == 1 and r["items"][0]["bin_id"] == "BIN_002"


async def test_trend_buckets(client, auth):
    await client.put("/api/bins/BIN_001/calibration", json={"empty_distance_cm": 40, "full_distance_cm": 5}, headers=auth)
    await handle_telemetry("DEVICE_001", telemetry(ALL_NORMAL))
    r = (await client.get("/api/statistics/trend?hours=1&bucket_minutes=15")).json()
    b1 = [b for b in r["buckets"] if b["bin_id"] == "BIN_001"]
    assert len(b1) == 1 and b1[0]["sample_count"] == 1 and b1[0]["avg_fill_percent"] == 28.6
    uncal = [b for b in r["buckets"] if b["bin_id"] == "BIN_002"]
    assert uncal[0]["avg_fill_percent"] is None  # 미보정은 0이 아니라 null
    assert (await client.get("/api/statistics/trend?hours=720&bucket_minutes=1")).status_code == 422
