#!/usr/bin/env bash
# FastAPI 로컬 실행 (0.0.0.0 바인딩 → 같은 Wi-Fi의 휴대폰에서도 접속 가능)
source "$(dirname "$0")/_common.sh"
cd "$ROOT/backend"
# 기본 0.0.0.0 (같은 Wi-Fi의 휴대폰 접속용). 로컬 전용: .env 에 API_HOST=127.0.0.1
# 주의: LAN에서는 HTTP 평문이므로 제어 토큰이 같은 네트워크에서 노출될 수 있다 (신뢰하는 네트워크에서만 사용).
HOST="$(grep -E '^API_HOST=' "$ROOT/.env" | cut -d= -f2)"
PORT="$(grep -E '^API_PORT=' "$ROOT/.env" | cut -d= -f2)"
exec .venv/bin/uvicorn app.main:app --host "${HOST:-0.0.0.0}" --port "${PORT:-8000}" --workers 1 "$@"
