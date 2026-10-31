#!/usr/bin/env bash
# 가상 AI 분류 발생기 (source=simulator). 사용: scripts/simulate-detection.sh [--once] [--waste-type can] [--confidence 0.9]
source "$(dirname "$0")/_common.sh"
exec "$ROOT/backend/.venv/bin/python" "$ROOT/scripts/simulate-detection.py" "$@"
