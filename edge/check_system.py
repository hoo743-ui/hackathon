"""카메라 노트북 사전 점검. 결과를 PASS / FAIL / NOT TESTED 로 구분해 출력한다.

python check_system.py                # 전체 (설정·패키지·모델·카메라·시리얼 목록·백엔드)
python check_system.py --cameras      # 카메라 번호 0~5 탐색
python check_system.py --serial-open  # HW_SERIAL_PORT 를 실제로 열어 본다 (start_camera_system.py 실행 중이면 하지 말 것)
python check_system.py --upload-test image.jpg   # 실제 이미지 1장을 YOLO로 추론해 백엔드로 전송
"""
from __future__ import annotations

import argparse
import importlib
import json
import platform
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

RESULTS: list[tuple[str, str, str]] = []


def record(name: str, status: str, detail: str = "") -> None:
    if len(detail) > 220:
        detail = detail[:217] + "..."
    RESULTS.append((name, status, detail))
    mark = {"PASS": "✅", "FAIL": "❌", "NOT TESTED": "⏭️ ", "WARN": "⚠️ "}.get(status, "  ")
    print(f"{mark} {status:<10} {name:<28} {detail}")


def check_python() -> None:
    v = sys.version_info
    ok = (3, 9) <= (v.major, v.minor) <= (3, 13)
    record("Python", "PASS" if ok else "WARN", f"{platform.python_version()} ({platform.system()} {platform.machine()})")


def check_packages() -> bool:
    ok = True
    for mod, pkg in [("cv2", "opencv-python"), ("ultralytics", "ultralytics"), ("torch", "torch"),
                     ("serial", "pyserial"), ("requests", "requests"), ("dotenv", "python-dotenv")]:
        try:
            m = importlib.import_module(mod)
            record(f"import {pkg}", "PASS", getattr(m, "__version__", ""))
        except Exception as exc:
            ok = False
            record(f"import {pkg}", "FAIL", f"{exc} → pip install -r requirements.txt")
    try:
        import torch

        if torch.cuda.is_available():
            record("GPU (CUDA)", "PASS", torch.cuda.get_device_name(0))
        elif getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            record("GPU (Apple MPS)", "PASS", "사용 가능")
        else:
            record("GPU", "NOT TESTED", "GPU 없음 → CPU로 추론 (동작에는 문제 없음)")
    except Exception:
        pass
    return ok


def check_config(settings) -> None:
    probs = settings.problems()
    record("edge/.env", "FAIL" if probs else "PASS", "; ".join(probs) or f"BACKEND_URL={settings.backend_url} DEVICE_ID={settings.device_id}")


def model_path(settings) -> Path:
    from smartrecycle_edge.config import EDGE_DIR

    p = Path(settings.model_path)
    if not p.is_absolute() and (EDGE_DIR / p).exists():
        p = EDGE_DIR / p
    return p


def check_model(settings, image: str | None):
    p = model_path(settings)
    if not p.exists():
        record("best_model.pt", "FAIL", f"파일 없음: {p} (edge/models/ 에 두고 MODEL_PATH 설정)")
        return None
    record("best_model.pt 존재", "PASS", f"{p} ({p.stat().st_size / 1e6:.1f} MB)")
    try:
        from smartrecycle_edge.detector import YoloRunner

        t = time.time()
        y = YoloRunner(str(p), settings.confidence_threshold)
        record("모델 로드", "PASS", f"{time.time() - t:.1f}s · names={y.names}")
    except Exception as exc:
        record("모델 로드", "FAIL", str(exc)[:200])
        return None
    expected = {0: "glass", 1: "metal", 2: "paper", 3: "plastic"}
    got = {k: v.lower() for k, v in y.names.items()}
    if got == expected:
        record("클래스 매핑 (기존 G/M/P/L)", "PASS", "0 Glass→G · 1 Metal→M · 2 Paper→P · 3 Plastic→L")
    else:
        record("클래스 매핑 (기존 G/M/P/L)", "WARN", f"기존 코드 가정 {expected} ≠ 모델 {got} → 실행 시 이름 기준 매핑 사용")
    import numpy as np

    frame = None
    if image:
        import cv2

        frame = cv2.imread(image)
        if frame is None:
            record("단일 이미지 추론", "FAIL", f"이미지를 읽을 수 없음: {image}")
            return y
    try:
        r = y(frame if frame is not None else np.zeros((480, 640, 3), dtype=np.uint8))
        n = 0 if r.boxes is None else len(r.boxes)
        what = f"{image}: 검출 {n}개" if image else f"빈 프레임 추론 OK (검출 {n}개)"
        if image and n:
            b = r.boxes[0]
            what += f" · top={y.names[int(b.cls[0])]} {float(b.conf[0]):.2f}"
        record("단일 이미지 추론", "PASS", what)
    except Exception as exc:
        record("단일 이미지 추론", "FAIL", str(exc)[:200])
    return y


def check_cameras(settings, scan: bool) -> None:
    import cv2

    idxs = range(6) if scan else [settings.camera_index]
    found = []
    for i in idxs:
        src = int(i) if str(i).isdigit() else i
        backend = cv2.CAP_DSHOW if sys.platform.startswith("win") and isinstance(src, int) else cv2.CAP_ANY
        cap = cv2.VideoCapture(src, backend)
        ok, frame = (cap.read() if cap.isOpened() else (False, None))
        if ok and frame is not None:
            found.append(f"{i}({frame.shape[1]}x{frame.shape[0]})")
        cap.release()
    if found:
        record("카메라", "PASS", "프레임 수신: " + ", ".join(found))
    else:
        hint = " (macOS: 시스템 설정 › 개인정보 보호 › 카메라에서 터미널 허용)" if sys.platform == "darwin" else ""
        record("카메라", "FAIL", f"CAMERA_INDEX={settings.camera_index} 프레임 없음{hint}")


def check_serial(settings, try_open: bool) -> None:
    from smartrecycle_edge.serial_ports import list_serial_ports, resolve_hw_port

    ports = list_serial_ports()
    if not ports:
        record("USB 시리얼 장치", "NOT TESTED", "연결된 장치 없음 (Arduino/ESP32 USB 케이블 확인)")
    for p in ports:
        print("     ", p.label())
    if ports:
        record("USB 시리얼 장치", "PASS", f"{len(ports)}개 발견")
    port, note = resolve_hw_port(settings.hw_serial_port, {settings.esp32_serial_port})
    if not settings.hw_enabled:
        record("하드웨어 포트", "NOT TESTED", "HW_ENABLED=false")
        return
    if port is None:
        record("하드웨어 포트", "NOT TESTED" if not ports else "FAIL", note)
        return
    record("하드웨어 포트 선택", "PASS", f"{port} · {note}")
    if not try_open:
        record("하드웨어 포트 열기", "NOT TESTED", "--serial-open 으로 실제 열기 시험")
        return
    import serial

    try:
        with serial.Serial(port, settings.hw_baud, timeout=1) as s:
            time.sleep(2.0)
            lines = s.read(256)
        record("하드웨어 포트 열기", "PASS", f"{port} @ {settings.hw_baud} 수신 {len(lines)}바이트 (명령은 보내지 않음)")
    except Exception as exc:
        record("하드웨어 포트 열기", "FAIL", f"{exc} (다른 프로그램—Arduino IDE 시리얼 모니터 등—이 포트를 쓰는지 확인)")


def check_backend(settings) -> bool:
    import requests

    if settings.problems():
        record("백엔드", "NOT TESTED", "설정 오류")
        return False
    try:
        r = requests.get(f"{settings.backend_url}/api/health", timeout=5)
        h = r.json()
        record("백엔드 /api/health", "PASS" if r.ok else "FAIL", json.dumps(h, ensure_ascii=False))
        if h.get("hardware_mode") != "EDGE_SERIAL":
            record("백엔드 HARDWARE_MODE", "WARN", f"{h.get('hardware_mode')} — 맥북 .env 를 EDGE_SERIAL 로 (scripts/env-profile.sh edge-serial)")
    except Exception as exc:
        record("백엔드 /api/health", "FAIL", f"{exc} → 맥북 IP/방화벽/같은 Wi-Fi 확인")
        return False
    try:
        body = {"device_id": settings.device_id, "camera_ok": False, "model_loaded": False, "version": "check"}
        r = requests.post(f"{settings.backend_url}/api/edge/heartbeat", json=body,
                          headers={"Authorization": f"Bearer {settings.ai_api_token}"}, timeout=5)
        record("백엔드 인증 (AI_API_TOKEN)", "PASS" if r.ok else "FAIL", f"HTTP {r.status_code}")
        return r.ok
    except Exception as exc:
        record("백엔드 인증 (AI_API_TOKEN)", "FAIL", str(exc))
        return False


def upload_test(settings, yolo, image: str) -> None:
    """실제 이미지 1장 → 실제 YOLO 추론 → 백엔드 전송 (하드웨어 명령 없음, hardware_status=disabled)."""
    import cv2
    import requests

    from smartrecycle_edge.detector import top_detection

    frame = cv2.imread(image)
    if frame is None or yolo is None:
        record("업로드 시험", "FAIL", "이미지 또는 모델 없음")
        return
    r = yolo(frame)
    det = top_detection(r, yolo.names)
    if det is None:
        record("업로드 시험", "FAIL", f"{image} 에서 검출된 객체가 없어 전송하지 않음 (임의 결과를 만들지 않음)")
        return
    ok, buf = cv2.imencode(".jpg", r.plot())
    meta = {
        "detection_id": str(uuid.uuid4()), "device_id": settings.device_id, "waste_type": det.name.lower(),
        "class_id": det.class_id, "confidence": round(det.confidence, 4), "model_name": Path(settings.model_path).name,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "bounding_box": dict(zip(("x1", "y1", "x2", "y2"), det.box)), "hardware_status": "disabled",
    }
    resp = requests.post(f"{settings.backend_url}/api/detections", data={"metadata": json.dumps(meta)},
                         files={"image": ("t.jpg", buf.tobytes(), "image/jpeg")},
                         headers={"Authorization": f"Bearer {settings.ai_api_token}"}, timeout=10)
    if resp.status_code in (200, 201):
        d = resp.json()
        img = requests.get(settings.backend_url + d["image_url"], timeout=5)
        record("업로드 시험", "PASS" if img.ok else "FAIL",
               f"{det.name} {det.confidence:.2f} → id={d['detection_id']} 이미지 조회 HTTP {img.status_code}")
    else:
        record("업로드 시험", "FAIL", f"HTTP {resp.status_code} {resp.text[:200]}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cameras", action="store_true", help="카메라 번호 0~5 탐색")
    ap.add_argument("--serial-open", action="store_true", help="하드웨어 포트를 실제로 열어 봄")
    ap.add_argument("--image", help="단일 이미지 추론 시험용 이미지")
    ap.add_argument("--upload-test", metavar="IMAGE", help="이미지 1장 추론 결과를 백엔드로 전송")
    ap.add_argument("--skip-camera", action="store_true")
    args = ap.parse_args()

    print("== SMART RECYCLE 카메라 노트북 점검 ==")
    check_python()
    if not check_packages():
        return 1
    from smartrecycle_edge.config import settings

    check_config(settings)
    yolo = check_model(settings, args.image or args.upload_test)
    if args.skip_camera:
        record("카메라", "NOT TESTED", "--skip-camera")
    else:
        check_cameras(settings, args.cameras)
    check_serial(settings, args.serial_open)
    if check_backend(settings) and args.upload_test:
        upload_test(settings, yolo, args.upload_test)

    fails = [r for r in RESULTS if r[1] == "FAIL"]
    print(f"\n결과: PASS {sum(r[1] == 'PASS' for r in RESULTS)} · FAIL {len(fails)} · "
          f"NOT TESTED {sum(r[1] == 'NOT TESTED' for r in RESULTS)} · WARN {sum(r[1] == 'WARN' for r in RESULTS)}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
