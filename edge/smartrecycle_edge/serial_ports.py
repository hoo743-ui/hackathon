"""시리얼 포트 탐색 (Windows COMx / macOS /dev/cu.* / Linux /dev/ttyUSB*·ttyACM*).

USB VID로 보드 종류를 '추정'만 한다. 클론 보드(CH340)는 Arduino·ESP32 모두에 쓰이므로
여러 후보가 있으면 자동 선택하지 않고 HW_SERIAL_PORT 를 직접 지정하게 한다.
"""
from __future__ import annotations

from dataclasses import dataclass

try:
    from serial.tools import list_ports
except ImportError:  # pragma: no cover
    list_ports = None

ARDUINO_VIDS = {0x2341: "Arduino", 0x2A03: "Arduino (.org)"}
CH340_VID = 0x1A86  # 클론 UNO 또는 일부 ESP32 보드
ESP32_VIDS = {0x10C4: "Silicon Labs CP210x (ESP32 DevKitC 기본)", 0x303A: "Espressif USB"}
FTDI_VID = 0x0403


@dataclass
class PortInfo:
    device: str
    description: str
    vid: int | None
    pid: int | None
    serial_number: str | None
    guess: str  # arduino | esp32 | ch340 | ftdi | unknown

    def label(self) -> str:
        ids = f"{self.vid:04X}:{self.pid:04X}" if self.vid is not None and self.pid is not None else "----:----"
        return f"{self.device:<22} [{ids}] {self.guess:<8} {self.description}"


def _guess(vid: int | None) -> str:
    if vid in ARDUINO_VIDS:
        return "arduino"
    if vid in ESP32_VIDS:
        return "esp32"
    if vid == CH340_VID:
        return "ch340"
    if vid == FTDI_VID:
        return "ftdi"
    return "unknown"


def list_serial_ports() -> list[PortInfo]:
    if list_ports is None:
        return []
    out = []
    for p in list_ports.comports():
        # macOS: /dev/tty.* 와 /dev/cu.* 가 쌍으로 보인다. 송신 측은 cu.* 를 쓴다.
        if p.device.startswith("/dev/tty.") and not p.device.startswith("/dev/tty.usb"):
            continue
        if p.device.startswith("/dev/tty.usb"):
            continue
        if p.vid is None and ("Bluetooth" in p.device or "Bluetooth" in (p.description or "") or "debug-console" in p.device):
            continue
        out.append(PortInfo(p.device, p.description or "", p.vid, p.pid, p.serial_number, _guess(p.vid)))
    return sorted(out, key=lambda x: x.device)


def resolve_hw_port(configured: str, exclude: set[str] | None = None) -> tuple[str | None, str]:
    """HW_SERIAL_PORT 값을 실제 포트로. 반환: (포트 또는 None, 설명)."""
    exclude = {e for e in (exclude or set()) if e}
    if configured and configured.lower() != "auto":
        return configured, "설정값 사용"
    ports = [p for p in list_serial_ports() if p.device not in exclude]
    arduinos = [p for p in ports if p.guess == "arduino"]
    if len(arduinos) == 1:
        return arduinos[0].device, f"자동 선택: Arduino VID ({arduinos[0].description})"
    clones = [p for p in ports if p.guess == "ch340"]
    if not arduinos and len(clones) == 1 and not [p for p in ports if p.guess == "esp32"]:
        return clones[0].device, "자동 선택: CH340 1개 (클론 UNO로 추정 — 확인 필요)"
    if not ports:
        return None, "연결된 USB 시리얼 장치 없음 — UNO USB 케이블(데이터용)·장치 관리자 포트(COM) 확인, 꽂으면 5초 안에 자동 연결"
    return None, "후보가 여러 개이거나 Arduino를 특정할 수 없음 → HW_SERIAL_PORT 를 직접 지정하세요: " + ", ".join(
        f"{p.device}({p.guess})" for p in ports
    )
