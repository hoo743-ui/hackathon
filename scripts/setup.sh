#!/usr/bin/env bash
# 최초 1회: .env 생성(무작위 비밀번호), 백엔드 venv, 웹/모바일 의존성 설치
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  cp .env.example .env
  for key in POSTGRES_PASSWORD MQTT_BACKEND_PASSWORD MQTT_SIMULATOR_PASSWORD MQTT_DEVICE_PASSWORD API_CONTROL_TOKEN AI_API_TOKEN; do
    value="$(openssl rand -hex 24)"
    sed -i '' "s|^${key}=.*|${key}=${value}|" .env
  done
  LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  if [[ -z "$LAN_IP" ]]; then
    LAN_IP=127.0.0.1
    echo "⚠️  LAN IP를 찾지 못했습니다. 휴대폰 접속 시 .env 의 EXPO_PUBLIC_* 를 Mac IP로 직접 수정하세요."
  fi
  sed -i '' "s|192.168.0.10|${LAN_IP}|g" .env
  # LAN IP로 웹을 열어도 CORS가 통과하도록 추가
  sed -i '' "s|^CORS_ORIGINS=.*|CORS_ORIGINS=http://localhost:5173,http://${LAN_IP}:5173,http://localhost:8081|" .env
  echo "✅ .env 생성 (비밀번호 무작위 생성, 모바일 주소=${LAN_IP})"
else
  echo "ℹ️  .env 이미 존재 — 건너뜀"
fi

PY="$(command -v python3.12 || true)"
[[ -z "$PY" ]] && { echo "❌ python3.12 필요: brew install python@3.12" >&2; exit 1; }
[[ -d backend/.venv ]] || "$PY" -m venv backend/.venv
backend/.venv/bin/pip install -q --upgrade pip
backend/.venv/bin/pip install -q -r backend/requirements-dev.txt
echo "✅ backend venv"

[[ -f frontend/web/package.json ]] && (cd frontend/web && npm install --no-fund --no-audit) && echo "✅ web deps"
[[ -f mobile/app/package.json ]] && (cd mobile/app && npm install --no-fund --no-audit) && echo "✅ mobile deps"
if [[ -d mobile/app ]]; then
  grep '^EXPO_PUBLIC_' .env > mobile/app/.env
  echo "✅ mobile/app/.env 동기화"
fi
echo "다음: scripts/infra-up.sh"
