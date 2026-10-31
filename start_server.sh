#!/usr/bin/env bash
# SMART RECYCLE — 맥북(중앙 서버) 한 번에 실행: DB·MQTT → 마이그레이션 → 백엔드(0.0.0.0:8000) → 관리자 웹(5173) → Health Check
#   ./start_server.sh            백엔드 + 웹
#   ./start_server.sh --mobile   + Expo 개발 서버(휴대폰 Expo Go로 QR 스캔)  ※ 터미널을 점유
#   ./stop_server.sh             종료
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
source "$ROOT/scripts/_common.sh"
LOGS="$ROOT/logs"; mkdir -p "$LOGS"
PORT="$(grep -E '^API_PORT=' "$ROOT/.env" | cut -d= -f2)"; PORT="${PORT:-8000}"

"$ROOT/scripts/update-lan-ip.sh" || true
IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo '?')"

busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | tail -n +2; }
if [[ -n "$(busy "$PORT")" ]]; then
  if [[ -f "$LOGS/backend.pid" ]] && kill -0 "$(cat "$LOGS/backend.pid")" 2>/dev/null; then
    echo "ℹ️  백엔드가 이미 실행 중입니다 (pid $(cat "$LOGS/backend.pid"))."
  else
    echo "❌ 포트 $PORT 를 다른 프로그램이 사용 중입니다:"; busy "$PORT"
    echo "   이전에 실행한 서버라면 해당 터미널에서 Ctrl+C 하거나 'kill <PID>' 후 다시 실행하세요."; exit 1
  fi
else
  echo "▶ 1/4 인프라 (PostgreSQL · Mosquitto)"
  ensure_docker
  compose up -d --wait --no-recreate postgres mosquitto
  (cd "$ROOT/backend" && .venv/bin/alembic upgrade head && .venv/bin/python -m app.database.seed) > "$LOGS/migrate.log" 2>&1 \
    || { echo "❌ 마이그레이션 실패: $LOGS/migrate.log"; exit 1; }
  echo "▶ 2/4 백엔드 → $LOGS/backend.log"
  nohup "$ROOT/scripts/backend.sh" > "$LOGS/backend.log" 2>&1 &
  echo $! > "$LOGS/backend.pid"
fi

if [[ -z "$(busy 5173)" ]]; then
  echo "▶ 3/4 관리자 웹 → $LOGS/web.log"
  nohup "$ROOT/scripts/web.sh" > "$LOGS/web.log" 2>&1 &
  echo $! > "$LOGS/web.pid"
else
  echo "ℹ️  5173 포트 사용 중 → 웹 서버가 이미 실행 중이라고 보고 건너뜀"
fi

echo "▶ 4/4 Health Check"
for _ in $(seq 1 30); do
  if H="$(curl -fsS -m 2 "http://$IP:$PORT/api/health" 2>/dev/null)"; then break; fi; sleep 1; H=""
done
if [[ -z "$H" ]]; then echo "❌ 백엔드 응답 없음 — $LOGS/backend.log 확인"; exit 1; fi
echo "   $H"
echo "$H" | grep -q '"EDGE_SERIAL"' || echo "⚠️  HARDWARE_MODE 가 EDGE_SERIAL 이 아닙니다 → scripts/env-profile.sh edge-serial 후 재시작"

cat <<MSG

✅ 서버 준비 완료 (맥북 LAN IP: $IP)
   관리자 웹        http://$IP:5173        (맥북에서는 http://localhost:5173)
   API / Health     http://$IP:$PORT/api/health
   WebSocket        ws://$IP:$PORT/ws
   카메라 노트북    edge/.env → BACKEND_URL=http://$IP:$PORT   (AI_API_TOKEN 은 이 맥북 .env 와 동일)
   모바일 앱        ./start_server.sh --mobile  또는  scripts/mobile.sh  → Expo Go 로 QR 스캔
MSG

if [[ "${1:-}" == "--mobile" ]]; then exec "$ROOT/scripts/mobile.sh"; fi
