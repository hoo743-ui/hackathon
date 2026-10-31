#!/usr/bin/env bash
# [SIM] 통합 검증: 실행 중인 백엔드 + 시뮬레이터로 MQTT→DB→REST/WS→명령/ACK 전체 경로 확인
source "$(dirname "$0")/_common.sh"
exec "$ROOT/backend/.venv/bin/python" "$ROOT/scripts/e2e_check.py" "$@"
