"""Python·라이브러리 환경 점검.  python check_environment.py"""
from __future__ import annotations

import importlib
import platform
import sys

from _common import FAIL, NOT_TESTED, PASS, WARN, model_path, report, summary

PACKAGES = [
    ("cv2", "opencv-python"),
    ("ultralytics", "ultralytics"),
    ("torch", "torch"),
    ("torchvision", "torchvision"),
    ("serial", "pyserial"),
    ("requests", "requests"),
    ("dotenv", "python-dotenv"),
    ("numpy", "numpy"),
]


def main() -> int:
    print("== 카메라 컴퓨터 환경 점검 ==")
    v = sys.version_info
    detail = f"{platform.python_version()} · {platform.system()} {platform.release()} {platform.machine()}"
    if (3, 10) <= (v.major, v.minor) <= (3, 11):
        report("Python 버전", PASS, detail + " (권장 버전)")
    elif (3, 9) <= (v.major, v.minor) <= (3, 12):
        report("Python 버전", WARN, detail + " (동작 가능, 권장 3.10/3.11)")
    else:
        report("Python 버전", FAIL, detail + " → Python 3.10 또는 3.11 설치 권장")

    in_venv = sys.prefix != getattr(sys, "base_prefix", sys.prefix)
    report("가상환경(venv)", PASS if in_venv else WARN, sys.prefix if in_venv else "가상환경 밖에서 실행 중 — .venv 활성화 권장")

    for mod, pkg in PACKAGES:
        try:
            m = importlib.import_module(mod)
            report(f"import {pkg}", PASS, str(getattr(m, "__version__", "")))
        except Exception as exc:
            report(f"import {pkg}", FAIL, f"{type(exc).__name__}: {exc} → pip install -r requirements.txt")

    try:
        import torch

        if torch.cuda.is_available():
            report("NVIDIA GPU (CUDA)", PASS, f"{torch.cuda.get_device_name(0)} · torch CUDA {torch.version.cuda}")
        else:
            mps = getattr(torch.backends, "mps", None)
            if mps is not None and mps.is_available():
                report("GPU (Apple MPS)", PASS, "사용 가능")
            else:
                report("GPU", NOT_TESTED, f"GPU 미검출 → CPU 추론 (torch {torch.__version__}, 정상 동작)")
    except Exception:
        report("GPU", NOT_TESTED, "torch import 실패")

    p = model_path()
    report("모델 파일", PASS if p.exists() else FAIL, f"{p}" + (f" ({p.stat().st_size / 1e6:.1f} MB)" if p.exists() else " 없음 → models/README.md"))
    return summary()


if __name__ == "__main__":
    sys.exit(main())
