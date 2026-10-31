#!/usr/bin/env bash
# MQTT JSON Schema + OpenAPI 계약 파일 생성 (--check: 최신 여부만 검사)
source "$(dirname "$0")/_common.sh"
cd "$ROOT/backend"
exec .venv/bin/python "$ROOT/scripts/export_contracts.py" "$@"
