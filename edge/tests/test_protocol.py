"""uno_controller 프로토콜: ACK 기반 성공 판정, 타임아웃, BUSY, 비상 정지, 초음파 필터·끊김. [SIM: pty 가짜 장치]"""
import sys
import time

import pytest

from smartrecycle_edge.hardware import HardwareController, SensorMonitor

pytestmark = pytest.mark.skipif(sys.platform.startswith("win"), reason="pty 는 POSIX 전용")


def wait(cond, sec=3.0):
    end = time.time() + sec
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.02)
    return False


def make(fake, **kw):
    results = []
    hw = HardwareController(True, fake.port, 9600, busy_sec=1.0, on_line=lambda *_: None,
                            on_result=lambda d, s, r: results.append((d, s, r)), hello_wait=0.5, **kw)
    hw.link.reset_wait = 0
    hw.start()
    assert wait(lambda: hw.connected)
    return hw, results


def test_ack_done_is_success():
    from tests.fake_uno import FakeUno

    fake = FakeUno(motion_sec=0.3)
    hw, results = make(fake)
    try:
        assert wait(lambda: hw.firmware == "uno_controller")
        assert hw.send("L", "det-1") == "command_sent"
        assert hw.busy and hw.send("G", "det-2") == "skipped_busy"  # 동작 중 추가 입력 제한
        assert wait(lambda: results)
        assert results == [("det-1", "L", "completed")] and hw.servo_state == "idle" and not hw.busy
        assert fake.received.count("L") == 1 and "G" not in fake.received
    finally:
        hw.close(); fake.close()


def test_no_ack_times_out_as_failure():
    from tests.fake_uno import FakeUno

    fake = FakeUno(ack=False, hello=True)
    hw, results = make(fake, ack_timeout=0.5, start_timeout=0.3)
    try:
        assert wait(lambda: hw.firmware == "uno_controller")
        hw.send("M", "det-3")
        assert wait(lambda: (hw.tick() or results))
        assert results == [("det-3", "M", "ack_timeout")] and hw.servo_state == "error"
    finally:
        hw.close(); fake.close()


def test_legacy_firmware_never_reports_success():
    from tests.fake_uno import FakeUno

    fake = FakeUno(ack=False, hello=False)
    hw, results = make(fake)
    try:
        assert wait(lambda: (hw.tick() or hw.firmware == "legacy"))
        assert hw.send("P", "det-4") == "command_sent" and hw.servo_state == "unverified"
        time.sleep(0.3); hw.tick()
        assert results == []  # 성공으로 바꾸지 않음
    finally:
        hw.close(); fake.close()


def test_emergency_stop():
    from tests.fake_uno import FakeUno

    fake = FakeUno(motion_sec=5)
    hw, results = make(fake)
    try:
        assert wait(lambda: hw.firmware == "uno_controller")
        hw.send("G", "det-5")
        assert hw.emergency_stop()
        assert results == [("det-5", "G", "aborted")] and not hw.busy
        assert wait(lambda: "S" in fake.received)
    finally:
        hw.close(); fake.close()


def test_sensor_median_fill_and_disconnect():
    s = SensorMonitor(empty_cm=30.0, timeout_sec=1.0)
    assert s.status(0) == "unknown" and s.fill_percent(0) is None
    for i, v in enumerate(["15.0", "15.2", "80.0", "14.8", "15.1"]):  # 80 은 튀는 값
        s.feed(v, now=i * 0.1)
    assert s.status(0.5) == "normal" and s.distance(0.5) == 15.1
    assert s.fill_percent(0.5) == pytest.approx((1 - 15.1 / 30) * 100, abs=0.1)
    for i in range(3):
        s.feed("ERR", now=0.6 + i * 0.1)
    assert s.status(0.9) == "error" and s.fill_percent(0.9) is None
    assert s.status(5.0) == "disconnected"  # SENSOR_DISCONNECTED
    s2 = SensorMonitor(empty_cm=0)
    s2.feed("10", now=0)
    assert s2.distance(0) == 10.0 and s2.fill_percent(0) is None  # 빈통 거리 없으면 적재율 없음
