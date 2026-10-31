"""USB 시리얼 하드웨어 제어 — 이 프로세스가 포트를 '혼자' 소유한다.

실제 통신 경로 (trush.ino / esp32.ino 코드 기준):
  카메라 노트북 --USB Serial 9600--> Arduino UNO (trush.ino `Serial`)
      'G' 유리 / 'M' 금속 / 'P' 종이 / 'L' 플라스틱 → processDrop() 서보 3개 구동 (약 6.1초 블로킹)
  Arduino --USB Serial--> 카메라 노트북 : "[ALERT] 쓰레기통 만차 감지!" (초음파 1개, 5cm 이내)
  Arduino D3(SoftwareSerial TX) --> ESP32 GPIO16(RX2) : "FULL:TRASH" (esp32.ino는 "DATA:"만 처리 → 현재 무시됨)

주의: trush.ino 는 수신 바이트를 한 글자씩 switch 한다. 기존 yolo_arduino.py 가 보내던 "C:L:3\\n" 같은
카운트 메시지는 그 안의 'L','G','M','P' 글자 때문에 서보를 한 번 더 움직인다 → 여기서는 보내지 않는다.

아두이노는 명령에 대한 응답(ACK)을 보내지 않는다. 따라서 write 성공은 'command_sent' 이지 '동작 완료'가 아니다.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Callable

try:
    import serial
except ImportError:  # pragma: no cover
    serial = None

from .serial_ports import resolve_hw_port

log = logging.getLogger("edge.hw")

# 모델 클래스 '이름' → trush.ino 명령 문자 (기존 yolo_arduino.py CLASS_SIGNAL_MAP 과 동일한 의미)
NAME_TO_SIGNAL = {"glass": "G", "metal": "M", "paper": "P", "plastic": "L"}
# 기존 yolo_arduino.py 의 클래스 ID 매핑 (모델 names 와 대조용)
LEGACY_ID_TO_SIGNAL = {0: "G", 1: "M", 2: "P", 3: "L"}


class SerialLink:
    """하나의 시리얼 포트를 소유하고, 줄 단위로 읽어 콜백에 넘긴다."""

    def __init__(self, name: str, port: str | None, baud: int, on_line: Callable[[str, str], None],
                 reset_wait: float = 2.0, max_reconnects: int = 30):
        self.name = name
        self.port = port
        self.baud = baud
        self.on_line = on_line
        self.reset_wait = reset_wait
        self.max_reconnects = max_reconnects
        self._ser = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._reconnects = 0
        self.last_error: str | None = None
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
            self.last_error = f"{self.port} 열기 실패: {exc}"
            log.warning("[%s] %s", self.name, self.last_error)
            return False
        # UNO는 포트를 열 때 DTR로 리셋된다 → 부팅 대기 (기존 코드의 time.sleep(2)와 동일)
        time.sleep(self.reset_wait)
        ser.reset_input_buffer()
        with self._lock:
            self._ser = ser
        self.last_error = None
        log.info("[%s] 연결: %s @ %d", self.name, self.port, self.baud)
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
                if not self.port or self._reconnects >= self.max_reconnects:
                    time.sleep(1)
                    continue
                time.sleep(3)  # 재연결 간격
                self._reconnects += 1
                if self.open():
                    self._reconnects = 0
                elif self._reconnects >= self.max_reconnects:
                    log.error("[%s] 재연결 %d회 실패 → 중단 (프로그램 재시작 필요)", self.name, self.max_reconnects)
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
                try:
                    self.on_line(self.name, line)
                except Exception:
                    log.exception("line handler error")

    def close(self) -> None:
        self._stop.set()
        with self._lock:
            self._close_locked()


class HardwareController:
    """분류 결과 → 명령 문자 전송. 모터 동작 시간 동안은 새 명령을 보내지 않는다."""

    def __init__(self, enabled: bool, port_setting: str, baud: int, busy_sec: float,
                 on_line: Callable[[str, str], None], exclude_ports: set[str] | None = None):
        self.enabled = enabled
        self.busy_sec = busy_sec
        self.port_note = ""
        self.link: SerialLink | None = None
        if enabled:
            port, note = resolve_hw_port(port_setting, exclude_ports)
            self.port_note = note
            log.info("하드웨어 포트: %s (%s)", port, note)
            self.link = SerialLink("arduino", port, baud, on_line)
        self._busy_until = 0.0

    def start(self) -> None:
        if self.link:
            self.link.start()

    @property
    def port(self) -> str | None:
        return self.link.port if self.link else None

    @property
    def connected(self) -> bool:
        return bool(self.link and self.link.connected)

    @property
    def busy(self) -> bool:
        return time.monotonic() < self._busy_until

    @property
    def last_error(self) -> str | None:
        if self.link and self.link.last_error:
            return self.link.last_error
        if self.enabled and self.link and not self.link.port:
            return self.port_note
        return None

    def send(self, signal: str | None) -> str:
        """반환: backend HardwareStatus 값."""
        if not self.enabled:
            return "disabled"
        if signal is None:
            return "disabled"
        if not self.connected:
            return "not_connected"
        if self.busy:
            return "skipped_busy"
        if self.link.write(signal.encode("ascii")):
            self._busy_until = time.monotonic() + self.busy_sec
            return "command_sent"
        return "serial_failed"

    def close(self) -> None:
        if self.link:
            self.link.close()
