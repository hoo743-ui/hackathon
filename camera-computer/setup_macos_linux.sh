#!/usr/bin/env bash
# SMART RECYCLE - 카메라 컴퓨터 환경 설치 (macOS / Ubuntu·Linux)
# 실행: cd camera-computer && bash setup_macos_linux.sh      (Python 지정: PYTHON=python3.11 bash setup_macos_linux.sh)
set -euo pipefail
cd "$(dirname "$0")"

echo "[1/5] Python 확인"
PY="${PYTHON:-}"
if [[ -z "$PY" ]]; then
  for c in python3.11 python3.10 python3.12 python3; do command -v "$c" >/dev/null 2>&1 && { PY="$c"; break; }; done
fi
if [[ -z "$PY" ]]; then
  echo "Python 3 이 없습니다."
  echo "  macOS : brew install python@3.11"
  echo "  Ubuntu: sudo apt install python3.11 python3.11-venv   (또는 python3 python3-venv)"
  exit 1
fi
"$PY" --version
"$PY" - <<'PYCHK' || { echo "Ubuntu: sudo apt install python3-venv 필요"; exit 1; }
import venv, sys
assert sys.version_info >= (3, 9), "Python 3.9 이상 필요"
PYCHK

echo "[2/5] 가상환경 .venv 생성"
[[ -d .venv ]] || "$PY" -m venv .venv

echo "[3/5] pip 업데이트"
.venv/bin/python -m pip install --upgrade pip

echo "[4/5] 라이브러리 설치 (torch 포함, 수 분 소요)"
# NVIDIA GPU(Linux) 를 쓰려면 이 단계 전에 pytorch.org 안내대로 CUDA 버전 torch 를 먼저 설치한다.
.venv/bin/pip install -r requirements.txt

echo "[5/5] 설정 파일"
[[ -f .env ]] || { cp .env.example .env; echo ".env 생성됨 - SERIAL_PORT / CAMERA_INDEX 를 확인하세요"; }
if [[ "$(uname)" == "Linux" ]] && ! id -nG | grep -qw dialout; then
  echo "참고: 시리얼 포트 권한 → sudo usermod -aG dialout $USER 후 재로그인"
fi

.venv/bin/python check_environment.py || true
cat <<MSG

다음 단계:
  source .venv/bin/activate
  python test_camera.py --scan
  python test_yolo.py --image <쓰레기사진.jpg>
  python check_serial.py --open
MSG
