#!/usr/bin/env bash
# 웹 대시보드 (Mock 모드: VITE_DATA_MODE=mock scripts/web.sh)
source "$(dirname "$0")/_common.sh"
cd "$ROOT/frontend/web"
exec npm run dev -- --host "$@"
