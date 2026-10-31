from tests.test_telemetry import ALL_NORMAL, telemetry

from app.mqtt.handlers import handle_telemetry


async def test_health(client):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json()["database"] is True


async def test_devices_and_bins(client):
    r = await client.get("/api/devices")
    assert r.status_code == 200
    assert [d["device_id"] for d in r.json()] == ["DEVICE_001"]
    assert r.json()[0]["busy"] is False

    r = await client.get("/api/bins")
    assert [(b["bin_id"], b["waste_type"]) for b in r.json()] == [
        ("BIN_001", "plastic"), ("BIN_002", "metal"), ("BIN_003", "paper"), ("BIN_004", "glass")
    ]
    assert all(b["calibrated"] is False and b["current_fill_percent"] is None for b in r.json())


async def test_not_found_errors_have_consistent_shape(client):
    for path in ["/api/devices/NOPE", "/api/bins/NOPE", "/api/bins/NOPE/history"]:
        r = await client.get(path)
        assert r.status_code == 404
        assert set(r.json()["error"]) >= {"code", "message"}


async def test_calibration_requires_token_and_validates(client, auth):
    body = {"empty_distance_cm": 40, "full_distance_cm": 5}
    assert (await client.put("/api/bins/BIN_001/calibration", json=body)).status_code == 401
    bad = {"Authorization": "Bearer wrong"}
    assert (await client.put("/api/bins/BIN_001/calibration", json=body, headers=bad)).status_code == 403
    r = await client.put("/api/bins/BIN_001/calibration", json={"empty_distance_cm": 5, "full_distance_cm": 40}, headers=auth)
    assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_ERROR"

    r = await client.put("/api/bins/BIN_001/calibration", json=body, headers=auth)
    assert r.status_code == 200 and r.json()["calibrated"] is True
    r = await client.get("/api/bins/BIN_001/calibration")
    assert r.json() == {"bin_id": "BIN_001", "empty_distance_cm": 40.0, "full_distance_cm": 5.0, "calibrated": True}


async def test_calibration_recomputes_current_fill(client, auth):
    await handle_telemetry("DEVICE_001", telemetry(ALL_NORMAL))
    await client.put("/api/bins/BIN_001/calibration", json={"empty_distance_cm": 40, "full_distance_cm": 5}, headers=auth)
    b = (await client.get("/api/bins/BIN_001")).json()
    assert b["current_fill_percent"] == 28.6 and b["is_full"] is False


async def test_history_dashboard_statistics(client, auth):
    await client.put("/api/bins/BIN_004/calibration", json={"empty_distance_cm": 40, "full_distance_cm": 5}, headers=auth)
    await handle_telemetry("DEVICE_001", telemetry(ALL_NORMAL))
    await handle_telemetry("DEVICE_001", telemetry(dict(ALL_NORMAL, BIN_004=(None, "error"))))

    h = (await client.get("/api/bins/BIN_004/history?limit=10")).json()
    assert len(h["items"]) == 2
    assert h["items"][0]["sensor_status"] == "normal" and h["items"][1]["sensor_status"] == "error"
    assert h["items"][0]["source"] == "simulator"

    d = (await client.get("/api/dashboard")).json()
    assert len(d["bins"]) == 4 and d["devices"][0]["connection_status"] == "online"
    bin4 = next(b for b in d["bins"] if b["bin_id"] == "BIN_004")
    assert bin4["is_full"] is True and bin4["sensor_status"] == "error"

    s = (await client.get("/api/statistics?hours=24")).json()
    st4 = next(b for b in s["bins"] if b["bin_id"] == "BIN_004")
    assert st4["sample_count"] == 2 and st4["error_count"] == 1


async def test_history_limit_validation(client):
    r = await client.get("/api/bins/BIN_001/history?limit=0")
    assert r.status_code == 422
