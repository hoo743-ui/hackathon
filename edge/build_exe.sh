#!/usr/bin/env bash
# SMART RECYCLE AI - macOS/Linux 실행 패키지 빌드 → dist/SMART_RECYCLE_AI/SMART_RECYCLE_AI
set -euo pipefail
cd "$(dirname "$0")"
PY="${PYTHON:-python3}"
[[ -d .venv ]] || "$PY" -m venv .venv
.venv/bin/python -m pip install -q --upgrade pip
.venv/bin/pip install -q -r requirements.txt pyinstaller
.venv/bin/pyinstaller --noconfirm --clean --name SMART_RECYCLE_AI \
  --collect-all ultralytics --collect-all torchvision --hidden-import start_camera_system smart_recycle_ai.py
OUT=dist/SMART_RECYCLE_AI
if [[ -f .env ]]; then cp .env "$OUT/.env"; else cp .env.example "$OUT/.env"; fi
mkdir -p "$OUT/models"; [[ -f models/best_model.pt ]] && cp models/best_model.pt "$OUT/models/" || true
echo "완료: $OUT/SMART_RECYCLE_AI  (.env 와 models/best_model.pt 확인)"
