"""YOLO 모델 로딩·클래스·단일 이미지 추론 시험.

python test_yolo.py                      # 로딩 + 클래스 + 빈 프레임 추론
python test_yolo.py --image trash.jpg    # 이미지 1장 추론 (결과 이미지는 captures/ 에 저장)
python test_yolo.py --model 다른경로.pt
모델 파일은 읽기만 한다 (재학습·수정 없음).
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from _common import FAIL, HERE, NOT_TESTED, PASS, WARN, env, model_path, report, summary

# 기존 yolo_arduino.py 의 CLASS_SIGNAL_MAP (대조용, 변경하지 않음)
LEGACY = {0: ("glass", "G"), 1: ("metal", "M"), 2: ("paper", "P"), 3: ("plastic", "L")}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", help="모델 경로 (기본: .env MODEL_PATH)")
    ap.add_argument("--image", help="추론할 이미지 파일")
    ap.add_argument("--conf", type=float, default=float(env("CONFIDENCE_THRESHOLD", "0.5")))
    a = ap.parse_args()
    print("== YOLO 모델 시험 ==")

    p = Path(a.model) if a.model else model_path()
    if not p.exists():
        report("모델 파일", FAIL, f"{p} 없음 → models/README.md 참고")
        return summary()
    report("모델 파일", PASS, f"{p} ({p.stat().st_size / 1e6:.1f} MB)")

    try:
        from ultralytics import YOLO

        t = time.time()
        model = YOLO(str(p))
        names = {int(k): str(v) for k, v in model.names.items()}
        report("모델 로딩", PASS, f"{time.time() - t:.1f}초 · 클래스 {len(names)}개")
    except Exception as exc:
        report("모델 로딩", FAIL, f"{type(exc).__name__}: {exc}")
        return summary()

    for k, v in names.items():
        print(f"         class {k}: {v}")
    mismatch = [k for k, (n, _) in LEGACY.items() if names.get(k, "").lower() != n]
    if not mismatch and len(names) == 4:
        report("기존 매핑 대조", PASS, "0 Glass→G · 1 Metal→M · 2 Paper→P · 3 Plastic→L (yolo_arduino.py 와 일치)")
    else:
        report("기존 매핑 대조", WARN, f"yolo_arduino.py 가정과 다른 class id: {mismatch} — 하드웨어 신호가 엉뚱한 칸으로 갈 수 있음, 팀 확인 필요")

    import numpy as np

    if a.image:
        import cv2

        frame = cv2.imread(a.image)
        if frame is None:
            report("단일 이미지 추론", FAIL, f"이미지를 읽을 수 없음: {a.image}")
            return summary()
    else:
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
    try:
        t = time.time()
        r = model(frame, conf=a.conf, verbose=False)[0]
        dt = time.time() - t
        n = 0 if r.boxes is None else len(r.boxes)
        detail = f"{dt * 1000:.0f} ms · 검출 {n}개"
        for b in (r.boxes or [])[:5]:
            c = int(b.cls[0])
            x1, y1, x2, y2 = (round(float(v)) for v in b.xyxy[0].tolist())
            print(f"         {names.get(c, c)} conf={float(b.conf[0]):.2f} box=({x1},{y1},{x2},{y2})")
        if a.image:
            import cv2

            out = HERE / "captures"
            out.mkdir(exist_ok=True)
            dest = out / f"yolo_{Path(a.image).stem}.jpg"
            cv2.imwrite(str(dest), r.plot())
            detail += f" · 결과 이미지 {dest}"
        report("단일 이미지 추론", PASS, detail + ("" if a.image else " (빈 프레임 — 실제 이미지는 --image)"))
        if not a.image:
            report("실제 이미지 추론", NOT_TESTED, "--image 로 쓰레기 사진을 지정해 확인")
    except Exception as exc:
        report("단일 이미지 추론", FAIL, f"{type(exc).__name__}: {exc}")
    return summary()


if __name__ == "__main__":
    sys.exit(main())
