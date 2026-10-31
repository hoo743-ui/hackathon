"""OpenCV 카메라 시험.

python test_camera.py            # .env CAMERA_INDEX 로 실시간 영상 (q 또는 ESC 종료)
python test_camera.py --scan     # 0~5 번 카메라 탐색
python test_camera.py --index 1 --frames 60 --no-window   # 창 없이 60프레임 수신 확인
기존 YOLO 코드를 사용하지 않는 순수 카메라 시험이다.
"""
from __future__ import annotations

import argparse
import sys
import time

from _common import FAIL, NOT_TESTED, PASS, env, report, summary


def open_cam(index: int):
    import cv2

    # Windows 는 DirectShow 가 열기가 빠르고 안정적
    backend = cv2.CAP_DSHOW if sys.platform.startswith("win") else cv2.CAP_ANY
    return cv2.VideoCapture(index, backend)


def hint() -> str:
    if sys.platform == "darwin":
        return " (macOS: 시스템 설정 › 개인정보 보호 및 보안 › 카메라 › 터미널/VS Code 허용)"
    if sys.platform.startswith("linux"):
        return " (Linux: ls /dev/video* 확인, 사용자를 video 그룹에 추가)"
    return " (Windows: 설정 › 개인 정보 › 카메라 › 데스크톱 앱 허용, Zoom/Teams 등 종료)"


def scan() -> int:
    found = []
    for i in range(6):
        cap = open_cam(i)
        ok, frame = cap.read() if cap.isOpened() else (False, None)
        cap.release()
        if ok and frame is not None:
            found.append(f"{i} ({frame.shape[1]}x{frame.shape[0]})")
    if found:
        report("카메라 탐색", PASS, "사용 가능: " + ", ".join(found))
    else:
        report("카메라 탐색", FAIL, "프레임을 주는 카메라 없음" + hint())
    return summary()


def live(index: int, frames: int, window: bool) -> int:
    import cv2

    cap = open_cam(index)
    if not cap.isOpened():
        report("카메라 열기", FAIL, f"CAMERA_INDEX={index} 열 수 없음" + hint())
        return summary()
    report("카메라 열기", PASS, f"CAMERA_INDEX={index}")
    got, fail, t0 = 0, 0, time.time()
    shape = None
    try:
        while True:
            ok, frame = cap.read()
            if not ok or frame is None:
                fail += 1
                if fail >= 30:
                    report("프레임 수신", FAIL, "30회 연속 실패 — 케이블/다른 프로그램 점유 확인")
                    break
                continue
            fail = 0
            got += 1
            shape = frame.shape
            if window:
                fps = got / max(time.time() - t0, 1e-3)
                cv2.putText(frame, f"index {index}  {fps:.1f} fps  (q: quit)", (10, 30),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
                cv2.imshow("camera test", frame)
                if (cv2.waitKey(1) & 0xFF) in (ord("q"), 27):
                    break
            if frames and got >= frames:
                break
    except KeyboardInterrupt:
        pass
    finally:
        cap.release()  # 리소스 해제
        if window:
            cv2.destroyAllWindows()
    if got:
        dt = max(time.time() - t0, 1e-3)
        report("프레임 수신", PASS, f"{got}프레임 · {got / dt:.1f} fps · {shape[1]}x{shape[0]}")
    report("카메라 해제", PASS, "release() 완료")
    return summary()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scan", action="store_true")
    ap.add_argument("--index", type=int, default=None)
    ap.add_argument("--frames", type=int, default=0, help="N프레임 받으면 종료 (0=키 입력까지)")
    ap.add_argument("--no-window", action="store_true")
    a = ap.parse_args()
    try:
        import cv2  # noqa: F401
    except ImportError as exc:
        report("OpenCV", FAIL, f"{exc} → pip install -r requirements.txt")
        return summary()
    print("== 카메라 시험 ==")
    if a.scan:
        return scan()
    index = a.index if a.index is not None else int(env("CAMERA_INDEX", "0"))
    frames = a.frames or (60 if a.no_window else 0)
    return live(index, frames, not a.no_window)


if __name__ == "__main__":
    sys.exit(main())
