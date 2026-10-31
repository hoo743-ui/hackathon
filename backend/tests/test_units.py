from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from app.core.enums import SensorStatus
from app.schemas.api import CalibrationIn
from app.schemas.mqtt import AckPayload, TelemetryPayload
from app.services.fill_level import compute_fill_percent, is_full
from app.services.telemetry_service import classify, resolve_measured_at


@pytest.mark.parametrize(
    "distance,expected",
    [(40, 0.0), (5, 100.0), (22.5, 50.0), (50, 0.0), (1, 100.0), (33, 20.0)],
)
def test_fill_percent_clamped(distance, expected):
    assert compute_fill_percent(distance, 40, 5) == expected


def test_fill_percent_none_when_uncalibrated_or_no_reading():
    assert compute_fill_percent(None, 40, 5) is None
    assert compute_fill_percent(20, None, 5) is None
    assert compute_fill_percent(20, 40, None) is None


def test_fill_percent_rejects_inverted_calibration():
    with pytest.raises(ValueError):
        compute_fill_percent(20, 5, 40)


def test_is_full():
    assert is_full(95, 95) and not is_full(94.9, 95) and not is_full(None, 95)


def test_calibration_order_validated():
    with pytest.raises(ValidationError):
        CalibrationIn(empty_distance_cm=10, full_distance_cm=20)


def _telemetry(**overrides):
    base = {
        "device_id": "DEVICE_001",
        "source": "simulator",
        "bins": [{"bin_id": "BIN_001", "distance_cm": 10, "sensor_status": "normal"}],
    }
    base.update(overrides)
    return base


def test_telemetry_schema_valid_and_ignores_device_fill_percent():
    p = TelemetryPayload.model_validate(
        _telemetry(bins=[{"bin_id": "BIN_001", "distance_cm": 10, "sensor_status": "normal", "fill_percent": 99}])
    )
    assert not hasattr(p.bins[0], "fill_percent")


@pytest.mark.parametrize(
    "bad",
    [
        _telemetry(device_id="dev1"),
        _telemetry(source="unknown"),
        _telemetry(bins=[]),
        _telemetry(bins=[{"bin_id": "BIN_001", "distance_cm": None, "sensor_status": "normal"}]),
        _telemetry(bins=[{"bin_id": "BIN_001", "distance_cm": 1, "sensor_status": "bogus"}]),
        _telemetry(bins=[{"bin_id": "BIN_001", "distance_cm": 1, "sensor_status": "normal"}] * 2),
        _telemetry(bins=[{"bin_id": "BIN_001", "distance_cm": float("nan"), "sensor_status": "normal"}]),
    ],
)
def test_telemetry_schema_rejects_invalid(bad):
    with pytest.raises(ValidationError):
        TelemetryPayload.model_validate(bad)


def test_error_reading_drops_distance():
    p = TelemetryPayload.model_validate(
        _telemetry(bins=[{"bin_id": "BIN_001", "distance_cm": 12, "sensor_status": "timeout"}])
    )
    assert p.bins[0].distance_cm is None


def test_naive_timestamp_treated_as_utc():
    p = TelemetryPayload.model_validate(_telemetry(timestamp="2026-10-31T10:00:00"))
    assert p.timestamp.tzinfo is not None


def test_ack_requires_uuid():
    with pytest.raises(ValidationError):
        AckPayload.model_validate({"command_id": "x", "device_id": "DEVICE_001", "success": True, "message": "ok"})


def test_classify_reclassifies_impossible_values():
    assert classify(SensorStatus.NORMAL, 950) == (SensorStatus.OUT_OF_RANGE, None)
    assert classify(SensorStatus.NORMAL, 0.5) == (SensorStatus.OUT_OF_RANGE, None)
    assert classify(SensorStatus.NORMAL, 20) == (SensorStatus.NORMAL, 20)
    assert classify(SensorStatus.TIMEOUT, None) == (SensorStatus.TIMEOUT, None)


def test_measured_at_falls_back_on_clock_skew():
    now = datetime.now(UTC)
    assert resolve_measured_at(None, now) == now
    assert resolve_measured_at(now - timedelta(hours=3), now) == now
    near = now - timedelta(seconds=5)
    assert resolve_measured_at(near, now) == near
