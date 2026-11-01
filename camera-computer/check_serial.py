"""USB 시리얼 포트 확인 (ESP32 DevKitC V4 · Arduino UNO).

python check_serial.py                 # 포트 목록 + 보드 추정 + 설정 포트 결정
python check_serial.py --open          # 설정 포트를 실제로 열어 2초간 수신만 (명령은 보내지 않음)
python check_serial.py --open --port COM6 --baud 115200
주의: 포트는 한 프로그램만 열 수 있다. Arduino IDE 시리얼 모니터나 YOLO 프로그램이 실행 중이면 끄고 시험한다.
이 도구는 어떤 데이터도 보내지 않는다 (펌웨어 프로토콜 변경 없음).
"""
from __future__ import annotations

import argparse
import sys
import time

from _common import FAIL, NOT_TESTED, PASS, SKIPPED, WARN, env, report, summary

# USB VID → 보드 '추정' (클론 보드는 같은 칩을 쓰므로 확정이 아님)
VIDS = {
    0x2341: "arduino",  # Arduino 정품
    0x2A03: "arduino",
    0x10C4: "esp32",  # Silicon Labs CP210x — ESP32 DevKitC V4 기본 USB-UART
    0x303A: "esp32",  # Espressif 내장 USB
    0x1A86: "ch340",  # 클론 UNO 또는 일부 ESP32 보드
    0x0403: "ftdi",
}


def ports():
    from serial.tools import list_ports

    out = []
    for p in list_ports.comports():
        if p.vid is None and ("Bluetooth" in p.device or "Bluetooth" in (p.description or "") or "debug" in p.device):
            continue
        if p.device.startswith("/dev/tty.") :  # macOS: cu.* 만 사용
            continue
        out.append((p.device, VIDS.get(p.vid, "unknown"), p.vid, p.pid, p.description or ""))
    return sorted(out)


def how_to_find() -> str:
    if sys.platform.startswith("win"):
        return "장치 관리자 › 포트(COM & LPT) 에서 'Arduino Uno (COMx)' / 'Silicon Labs CP210x (COMy)' 확인"
    if sys.platform == "darwin":
        return "터미널: ls /dev/cu.*  (Arduino: cu.usbmodem*, ESP32 CP2102: cu.usbserial-* / cu.SLAB_USBtoUART)"
    return "터미널: ls /dev/ttyACM* /dev/ttyUSB*  (권한: sudo usermod -aG dialout $USER 후 재로그인)"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--open", action="store_true", help="포트를 실제로 열어 본다")
    ap.add_argument("--port", help="시험할 포트 (기본: .env SERIAL_PORT)")
    ap.add_argument("--baud", type=int, help="기본: .env BAUD_RATE")
    a = ap.parse_args()
    print("== USB 시리얼 확인 ==")
    try:
        import serial  # noqa: F401
    except ImportError as exc:
        report("pyserial", FAIL, f"{exc} → pip install pyserial")
        return summary()

    found = ports()
    print(f"OS: {sys.platform} · 찾는 방법: {how_to_find()}")
    for dev, kind, vid, pid, desc in found:
        ids = f"{vid:04X}:{pid:04X}" if vid is not None else "----:----"
        print(f"         {dev:<24} [{ids}] {kind:<8} {desc}")
    if not found:
        report("USB 시리얼 장치", NOT_TESTED, "연결된 장치 없음 — USB 케이블(데이터 지원)·드라이버(CP210x/CH340) 확인")
    else:
        report("USB 시리얼 장치", PASS, f"{len(found)}개 · arduino {sum(k == 'arduino' for _, k, *_ in found)} · esp32 {sum(k == 'esp32' for _, k, *_ in found)}")

    port = a.port or env("SERIAL_PORT", "auto")
    baud = a.baud or int(env("BAUD_RATE", "9600"))
    if port.lower() == "auto":
        arduinos = [d for d, k, *_ in found if k == "arduino"]
        if len(arduinos) == 1:
            port = arduinos[0]
            report("포트 자동 선택", PASS, f"{port} (Arduino VID)")
        else:
            report("포트 자동 선택", NOT_TESTED if not found else WARN,
                   "Arduino 를 하나로 특정할 수 없음 → .env SERIAL_PORT 직접 지정")
            port = ""
    else:
        exists = any(d == port for d, *_ in found)
        report("설정 포트", PASS if exists else WARN, f"{port}" + ("" if exists else " — 현재 목록에 없음"))

    esp = env("ESP32_SERIAL_PORT")
    if esp:
        report("ESP32 포트 설정", PASS if any(d == esp for d, *_ in found) else WARN, esp)

    if not a.open:
        report("포트 열기 시험", SKIPPED, "--open 옵션으로 실행 (다른 프로그램이 포트를 쓰지 않을 때)")
        return summary()
    if not port:
        report("포트 열기 시험", NOT_TESTED, "시험할 포트 없음")
        return summary()

    import serial

    try:
        with serial.Serial(port, baud, timeout=0.5) as s:
            report("포트 열기", PASS, f"{port} @ {baud}")
            time.sleep(2.0)  # UNO 는 포트를 열면 리셋됨 → 부팅 대기
            data = s.read(512)
        text = data.decode("utf-8", errors="replace").strip()
        report("수신 확인", PASS if data else NOT_TESTED,
               f"{len(data)}바이트" + (f": {text[:120]!r}" if text else " (보드가 아무것도 출력하지 않음 — 정상일 수 있음)"))
    except serial.SerialException as exc:
        msg = str(exc)
        reason = ("다른 프로그램이 포트를 사용 중 (Arduino IDE 시리얼 모니터, YOLO 프로그램 등)"
                  if any(w in msg for w in ("Access is denied", "PermissionError", "busy", "Resource busy"))
                  else "포트 이름 / 케이블 / 드라이버 확인")
        report("포트 열기", FAIL, f"{msg} → {reason}")
    except PermissionError as exc:
        report("포트 열기", FAIL, f"{exc} → Linux: dialout 그룹, macOS: 다른 프로그램 종료")
    return summary()


if __name__ == "__main__":
    sys.exit(main())
