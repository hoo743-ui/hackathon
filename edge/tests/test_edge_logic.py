"""카메라 노트북 로직 단위 시험 (하드웨어·네트워크 없이)."""
import time

from smartrecycle_edge.detector import Detection, StableTrigger
from smartrecycle_edge.hardware import HardwareController, SerialLink
from smartrecycle_edge.serial_ports import resolve_hw_port


def det(cid=3, conf=0.9):
    return Detection(cid, "Plastic", conf, (0, 0, 10, 10))


def test_stable_trigger_fires_once_per_object():
    t = StableTrigger(frames=3, min_sec=0.2, clear_sec=1.0, cooldown=2.0)
    fired = [t.update(det(), now=0.1 * i) for i in range(30)]  # 같은 물체 3초간 계속 보임
    assert fired.count(True) == 1


def test_flicker_does_not_fire():
    t = StableTrigger(frames=3, min_sec=0.2, clear_sec=1.0, cooldown=2.0)
    seq = [det(3), det(1), det(3), None, det(3), det(1)]
    assert not any(t.update(d, now=0.1 * i) for i, d in enumerate(seq))


def test_next_item_after_clear_and_cooldown():
    t = StableTrigger(frames=2, min_sec=0.1, clear_sec=1.0, cooldown=2.0)
    now, fires = 0.0, 0
    for _ in range(5):
        fires += t.update(det(), now=now); now += 0.1
    for _ in range(15):  # 1.5초 동안 아무것도 없음 → 잠금 해제
        t.update(None, now=now); now += 0.1
    now = max(now, 2.5)
    for _ in range(5):
        fires += t.update(det(), now=now); now += 0.1
    assert fires == 2


def test_cooldown_blocks_fast_repeat():
    t = StableTrigger(frames=1, min_sec=0.0, clear_sec=0.1, cooldown=2.0)
    assert t.update(det(3), now=0.0)
    t.update(None, now=0.5)
    assert not t.update(det(3), now=0.6)  # 2초 이내
    assert t.update(det(3), now=2.1)


def test_hw_blocked_while_busy():
    t = StableTrigger(frames=1, min_sec=0.0, clear_sec=0.1, cooldown=0.0)
    assert not t.update(det(), now=0.0, can_fire=False)
    assert t.update(det(), now=0.1, can_fire=True)


def test_hardware_controller_sends_single_char_and_busy():
    lines = []
    hw = HardwareController(True, "loop://", 9600, busy_sec=0.5, on_line=lambda w, l: lines.append(l))
    hw.link.reset_wait = 0
    hw.start()
    assert hw.connected
    assert hw.send("L") == "command_sent"
    assert hw.send("G") == "skipped_busy"  # 모터 동작 중에는 보내지 않음
    time.sleep(0.6)
    assert hw.send("G") == "command_sent"
    hw.close()


def test_loop_echo_no_count_messages():
    """trush.ino 는 'C:L:3' 의 'L'을 다시 명령으로 읽는다 → 한 글자만 보내는지 확인."""
    link = SerialLink("t", "loop://", 9600, on_line=lambda *_: None, reset_wait=0)
    assert link.open()
    hw = HardwareController(True, "loop://", 9600, busy_sec=0, on_line=lambda *_: None)
    hw.link = link
    assert hw.send("P") == "command_sent"
    assert link._ser.read(10) == b"P"
    link.close()


def test_status_values():
    assert HardwareController(False, "auto", 9600, 1, lambda *_: None).send("L") == "disabled"
    hw = HardwareController(True, "loop://", 9600, 1, lambda *_: None)
    assert hw.send("L") == "not_connected"  # 아직 열지 않음
    assert hw.send(None) == "disabled"


def test_explicit_port_respected():
    assert resolve_hw_port("COM5") == ("COM5", "설정값 사용")
