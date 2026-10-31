#!/usr/bin/env bash
# 전체 자동 테스트: 백엔드(pytest, 인프라 필요) + 웹(vitest/build) + 모바일(tsc) + 펌웨어(빌드)
source "$(dirname "$0")/_common.sh"
FAIL=0
run() { echo; echo "▶ $1"; shift; if "$@"; then echo "✅ 통과"; else echo "❌ 실패"; FAIL=1; fi; }
run "contracts up-to-date" "$ROOT/scripts/export_contracts.sh" --check
run "backend pytest" bash -c "cd '$ROOT/backend' && .venv/bin/pytest -q"
[[ -f "$ROOT/frontend/web/package.json" ]] && run "web test" bash -c "cd '$ROOT/frontend/web' && npm test --silent && npm run build --silent"
[[ -f "$ROOT/mobile/app/package.json" ]] && run "mobile typecheck + test" bash -c "cd '$ROOT/mobile/app' && npx tsc --noEmit && npm test --silent"
command -v pio >/dev/null && run "firmware build" bash -c "cd '$ROOT/firmware/esp32' && pio run -s"
exit $FAIL
