"""USB 시리얼 하드웨어 제어 — 이 프로세스가 포트를 '혼자' 소유한다.

시연 구성: Arduino UNO R3 ×1 · ESP32 DevKitC V4 ×1 · SG90 ×3 · HC-SR04 ×1

  카메라 PC --USB 9600--> Arduino UNO   'G' 유리 · 'M' 금속 · 'P' 종이 · 'L' 플라스틱 · 'S' 비상정지 · '?' 펌웨어 확인
      서보 X(D9)=분류 방향 회전, Y1(D10)·Y2(D11)=뚜껑 기울여 투하 (trush.ino 와 같은 핀·각도·순서)
  UNO --USB--> 카메라 PC
      uno_controller 펌웨어: HELLO:UNO_CTRL:1 · ACK:<c>:START/DONE/BUSY/ABORTED · DIST:<cm> · DIST:ERR
      trush.ino(구 펌웨어):  "[ALERT] 쓰레기통 만차 감지!" 만 (ACK·거리 없음)
  UNO D3 --(분압)--> ESP32 GPIO16 ;  ESP32 --USB 115200--> 카메라 PC : "UNO>…", "ESP32:WIFI:…", "ESP32:UNO_LINK:OK"

성공 표시 규칙: ACK:<c>:DONE 을 받았을 때만 'completed'. 구 펌웨어는 응답이 없으므로 'command_sent'(미확인)로 남긴다.
'C:L:3' 같은 카운트 메시지는 보내지 않는다 (trush.ino 가 그 안의 글자를 명령으로 오인).
"""
from __future__ import annotations

import logging
import statistics
import threading
import time
from collections import deque
from typing import Callable

try:
    import serial
except ImportError:  # pragma: no cover
    serial = None

from .serial_ports import resolve_hw_port

log = logging.getLogger("edge.hw")

# 모델 클래스 '이름' → 명령 문자 (기존 yolo_arduino.py CLASS_SIGNAL_MAP 과 같은 의미)
NAME_TO_SIGNAL = {"glass": "G", "metal": "M", "paper": "P", "plastic": "L"}
# 기존 yolo_arduino.py 의 클래스 ID 매핑 (모델 names 와 대조용, 변경하지 않음)
LEGACY_ID_TO_SIGNAL = {0: "G", 1: "M", 2: "P", 3: "L"}
# trush.ino 서보 X 각도 (표시용)
SIGNAL_ANGLE = {"L": 30, "M": 145, "G": 160, "P": 180}
SERVOS = "X(D9) 회전 · Y1(D10)/Y2(D11) 투하"


class SerialLink:
    """하나의 시리얼 포트를 소유하고, 줄 단위로 읽어 콜백에 넘긴다."""

    def __init__(self, name: str, port: str | None, baud: int, on_line: Callable[[str, str], None],
                 reset_wait: float = 2.0, max_reconnects: int = 30, on_open: Callable[[], None] | None = None):
        self.name = name
        self.port = port
        self.baud = baud
        self.on_line = on_line
        self.on_open = on_open
        self.reset_wait = reset_wait
        self.max_reconnects = max_reconnects
        self._ser = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._reconnects = 0
        self.last_error: str | None = None
        self.last_line_at = 0.0
        self._thread = threading.Thread(target=self._read_loop, name=f"serial-{name}", daemon=True)

    @property
    def connected(self) -> bool:
        return self._ser is not None and self._ser.is_open

    def open(self) -> bool:
        if serial is None:
            self.last_error = "pyserial 미설치"
            return False
        if not self.port:
            return False
        try:
            kwargs = {"timeout": 0.5, "write_timeout": 1.0}
            if "://" in self.port:  # 시험용 가상 포트 (loop:// 등)
                ser = serial.serial_for_url(self.port, self.baud, **kwargs)
            else:
                try:  # POSIX: 다른 프로세스가 같은 포트를 열지 못하게 잠근다 (Windows는 기본 독점)
                    ser = serial.Serial(self.port, self.baud, exclusive=True, **kwargs)
                except (TypeError, ValueError):
                    ser = serial.Serial(self.port, self.baud, **kwargs)
        except Exception as exc:  # SerialException, PermissionError …
            msg = str(exc)
            busy = any(w in msg for w in ("denied", "거부", "PermissionError", "busy", "Busy"))
            hint = (" — 다른 프로그램이 포트를 사용 중: Arduino IDE 시리얼 모니터를 닫거나, 이 프로그램이 두 번 켜져 있는지 확인"
                    if busy else "")
            self.last_error = f"{self.port} 열기 실패: {msg}{hint}"
            log.warning("[%s] %s", self.name, self.last_error)
            return False
        # UNO는 포트를 열 때 DTR로 리셋된다 → 부팅 대기 (기존 코드의 time.sleep(2)와 동일)
        time.sleep(self.reset_wait)
        with self._lock:
            self._ser = ser
        self.last_error = None
        self._reconnects = 0
        log.info("[%s] 연결: %s @ %d", self.name, self.port, self.baud)
        if self.on_open:
            self.on_open()
        return True

    def start(self) -> None:
        self.open()
        self._thread.start()

    def write(self, data: bytes) -> bool:
        with self._lock:
            ser = self._ser
            if ser is None:
                return False
            try:
                ser.write(data)
                ser.flush()
                return True
            except Exception as exc:
                self.last_error = f"write 실패: {exc}"
                log.error("[%s] %s", self.name, self.last_error)
                self._close_locked()
                return False

    def _close_locked(self) -> None:
        try:
            if self._ser is not None:
                self._ser.close()
        except Exception:
            pass
        self._ser = None

    def _read_loop(self) -> None:
        buf = b""
        while not self._stop.is_set():
            ser = self._ser
            if ser is None:
                if not self.port:
                    time.sleep(1)
                    continue
                # 처음 max_reconnects 회는 3초 간격, 그 뒤에는 10초 간격으로 계속 시도한다
                # (포트를 잡고 있던 프로그램을 닫거나 케이블을 다시 꽂으면 손대지 않아도 자동 복구)
                slow = self._reconnects >= self.max_reconnects
                if self.stop_wait(10 if slow else 3):
                    break
                self._reconnects += 1
                if not self.open() and self._reconnects == self.max_reconnects:
                    log.warning("[%s] 재연결 %d회 실패 → 10초 간격으로 계속 시도 (%s)", self.name, self.max_reconnects, self.last_error)
                continue
            try:
                chunk = ser.readline()
            except Exception as exc:
                self.last_error = f"read 실패(케이블 분리?): {exc}"
                log.error("[%s] %s", self.name, self.last_error)
                with self._lock:
                    self._close_locked()
                continue
            if not chunk:
                continue
            buf += chunk
            if not buf.endswith(b"\n"):
                continue
            line = buf.decode("utf-8", errors="replace").strip()
            buf = b""
            if line:
                self.last_line_at = time.monotonic()
                try:
                    self.on_line(self.name, line)
                except Exception:
                    log.exception("line handler error")

    def stop_wait(self, sec: float) -> bool:
        return self._stop.wait(sec)

    def retry(self) -> None:
        self._reconnects = 0
        if not self.connected:
            threading.Thread(target=self.open, daemon=True).start()

    def close(self) -> None:
        self._stop.set()
        with self._lock:
            self._close_locked()


class SensorMonitor:
    """HC-SR04 1개: DIST 줄 → 중앙값 필터 → 상태(normal/error/disconnected) → 적재율(표시용).

    적재율(%) = (1 - 측정거리 / 빈통거리) × 100  (0~100 으로 제한). 서버도 같은 식으로 다시 계산한다.
    값이 오지 않으면 적재율을 만들지 않는다.
    """

    def __init__(self, empty_cm: float, window: int = 5, timeout_sec: float = 5.0, err_limit: int = 3,
                 min_cm: float = 2.0, max_cm: float = 400.0):
        self.empty_cm = empty_cm
        self.samples: deque[float] = deque(maxlen=max(1, window))
        self.timeout_sec = timeout_sec
        self.err_limit = err_limit
        self.min_cm, self.max_cm = min_cm, max_cm
        self.errors = 0
        self.last_at = 0.0
        self.last_raw: float | None = None
        self.ever = False

    def feed(self, raw: str, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        self.ever = True
        self.last_at = now
        try:
            v = float(raw)
        except ValueError:
            v = None
        if v is None or not (self.min_cm <= v <= self.max_cm):
            self.errors += 1
            self.last_raw = None
            return
        self.errors = 0
        self.last_raw = v
        self.samples.append(v)

    def status(self, now: float | None = None) -> str:
        now = time.monotonic() if now is None else now
        if not self.ever:
            return "unknown"
        if now - self.last_at > self.timeout_sec:
            return "disconnected"  # SENSOR_DISCONNECTED
        if self.errors >= self.err_limit or not self.samples:
            return "error"
        return "normal"

    def distance(self, now: float | None = None) -> float | None:
        if self.status(now) != "normal":
            return None
        return round(statistics.median(self.samples), 1)

    def fill_percent(self, now: float | None = None) -> float | None:
        d = self.distance(now)
        if d is None or self.empty_cm <= 0:
            return None
        return round(min(100.0, max(0.0, (1 - d / self.empty_cm) * 100)), 1)


class HardwareController:
    """분류 결과 → 명령 문자 전송 + ACK 추적. 동작 중에는 새 명령을 보내지 않는다."""

    def __init__(self, enabled: bool, port_setting: str, baud: int, busy_sec: float,
                 on_line: Callable[[str, str], None], exclude_ports: set[str] | None = None,
                 ack_timeout: float = 10.0, start_timeout: float = 1.5,
                 on_result: Callable[[str, str, str], None] | None = None, hello_wait: float = 3.0):
        self.enabled = enabled
        self.busy_sec = busy_sec
        self.ack_timeout = ack_timeout
        self.start_timeout = start_timeout
        self.hello_wait = hello_wait
        self.on_result = on_result  # (detection_id, signal, status)
        self.port_note = ""
        self.firmware = "unknown"  # uno_controller | legacy | unknown
        self.servo_state = "idle"  # idle | moving | unverified | error | stopped
        self._opened_at = 0.0
        self._pending: dict | None = None
        self._busy_until = 0.0
        self._lock = threading.Lock()
        self._extra_line = on_line
        self.link: SerialLink | None = None
        if enabled:
            port, note = resolve_hw_port(port_setting, exclude_ports)
            self.port_note = note
            log.info("하드웨어 포트: %s (%s)", port, note)
            self.link = SerialLink("arduino", port, baud, self._on_line, on_open=self._on_open)

    # --- 연결 ---
    def start(self) -> None:
        if self.link:
            self.link.start()

    def _on_open(self) -> None:
        self._opened_at = time.monotonic()
        self.firmware = "unknown"
        self.link.write(b"?\n")  # uno_controller 는 HELLO 로 응답, trush.ino 는 무시

    @property
    def port(self) -> str | None:
        return self.link.port if self.link else None

    @property
    def connected(self) -> bool:
        return bool(self.link and self.link.connected)

    @property
    def ack_capable(self) -> bool:
        return self.firmware == "uno_controller"

    @property
    def busy(self) -> bool:
        with self._lock:
            return self._pending is not None or time.monotonic() < self._busy_until

    @property
    def last_error(self) -> str | None:
        if self.link and self.link.last_error:
            return self.link.last_error
        if self.enabled and self.link and not self.link.port:
            return self.port_note
        return None

    # --- 수신 ---
    def _on_line(self, who: str, line: str) -> None:
        if line.startswith("HELLO:UNO_CTRL"):
            self.firmware = "uno_controller"
            log.info("UNO 펌웨어: uno_controller (ACK·거리 지원)")
        elif line.startswith("ACK:"):
            self._on_ack(line)
        self._extra_line(who, line)

    def _on_ack(self, line: str) -> None:
        parts = line.split(":")
        if len(parts) < 3:
            return
        sig, what = parts[1], parts[2]
        result = None
        with self._lock:
            p = self._pending
            if sig == "S" and what == "DONE":
                self.servo_state = "stopped"
                return
            if p is None or p["signal"] != sig:
                return
            if what == "START":
                p["started"] = True
                self.servo_state = "moving"
            elif what == "DONE":
                result = "completed"
            elif what == "BUSY":
                result = "rejected_busy"
            elif what == "ABORTED":
                result = "aborted"
            if result:
                self._pending = None
                self.servo_state = "idle" if result == "completed" else "error"
        if result:
            log.info("[ACK] %s → %s (%s)", sig, result, p["detection_id"])
            if self.on_result:
                self.on_result(p["detection_id"], sig, result)

    def tick(self) -> None:
        """ACK 타임아웃 검사 + 펌웨어 판별 (메인 루프/하트비트에서 주기 호출)."""
        if self.connected and self.firmware == "unknown" and time.monotonic() - self._opened_at > self.hello_wait:
            self.firmware = "legacy"
            log.warning("UNO 펌웨어 응답(HELLO) 없음 → 구 펌웨어(trush.ino)로 간주: 동작 성공을 확인할 수 없음")
        timed_out = None
        with self._lock:
            p = self._pending
            if p:
                age = time.monotonic() - p["at"]
                if (not p["started"] and age > self.start_timeout) or age > self.ack_timeout:
                    timed_out = p
                    self._pending = None
                    self.servo_state = "error"
        if timed_out:
            log.error("[ACK] %s 응답 없음 → ack_timeout (%s)", timed_out["signal"], timed_out["detection_id"])
            if self.on_result:
                self.on_result(timed_out["detection_id"], timed_out["signal"], "ack_timeout")
        if self.servo_state == "unverified" and time.monotonic() >= self._busy_until:
            self.servo_state = "idle"

    # --- 송신 ---
    def send(self, signal: str | None, detection_id: str = "") -> str:
        """반환: backend HardwareStatus 값 (전송 직후 상태)."""
        if not self.enabled or signal is None:
            return "disabled"
        if not self.connected:
            return "not_connected"
        if self.busy:
            return "skipped_busy"
        if not self.link.write(signal.encode("ascii") + b"\n"):
            self.servo_state = "error"
            return "serial_failed"
        with self._lock:
            if self.ack_capable:
                self._pending = {"signal": signal, "detection_id": detection_id, "at": time.monotonic(), "started": False}
                self.servo_state = "moving"
            else:
                self._busy_until = time.monotonic() + self.busy_sec
                self.servo_state = "unverified"
        return "command_sent"

    def emergency_stop(self) -> bool:
        """'S' 전송 (uno_controller: 즉시 대기 자세). 구 펌웨어는 'S'를 처리하지 않는다."""
        ok = bool(self.link and self.link.write(b"S\n"))
        with self._lock:
            p, self._pending = self._pending, None
            self._busy_until = 0.0
            self.servo_state = "stopped"
        if p and self.on_result:
            self.on_result(p["detection_id"], p["signal"], "aborted")
        return ok

    def close(self) -> None:
        if self.link:
            self.link.close()
