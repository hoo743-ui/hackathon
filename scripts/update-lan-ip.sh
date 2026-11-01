#!/usr/bin/env bash
# 맥북 LAN IP가 바뀌면(DHCP · Wi-Fi 변경 · 휴대폰 핫스팟 전환) 아래를 현재 IP로 갱신한다.
#   - 앱 접속 주소 (.env / mobile/app/.env 의 EXPO_PUBLIC_*)  → Expo 재시작 필요
#   - CORS 허용 출처 (웹 5173)                               → CORS_ORIGIN_REGEX 가 사설 IP 대역을 모두 허용하므로 보통 재시작 불필요
#   - 이 맥북의 카메라 클라이언트 설정 edge/.env BACKEND_URL (있을 때만)
# 웹은 VITE_API_BASE_URL 이 비어 있으면 접속한 주소를 자동으로 따라가므로 수정할 필요 없다.
# 도메인(운영) 주소는 건드리지 않는다.
#   사용: scripts/update-lan-ip.sh            (변경 시에만 출력)
#         scripts/update-lan-ip.sh --print    (카메라 컴퓨터에 넣을 주소를 항상 출력)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV="$ROOT/.env"
NEW="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
[[ -z "$NEW" ]] && { echo "⚠️  LAN IP를 찾지 못했습니다 (Wi-Fi/핫스팟 연결 확인)"; exit 0; }
PORT="$(grep -E '^API_PORT=' "$ENV" 2>/dev/null | cut -d= -f2)"; PORT="${PORT:-8000}"
CUR="$(grep '^EXPO_PUBLIC_API_BASE_URL=' "$ENV" | sed -E 's#^EXPO_PUBLIC_API_BASE_URL=##; s#^[a-z]+://([^:/]+).*#\1#')"
CHANGED=0
# auto(기본): 앱이 Expo 개발 서버 주소에서 서버 IP 를 스스로 찾는다 → .env 수정 불필요
# 도메인(운영)이면 건드리지 않는다
if [[ "$CUR" =~ ^[0-9.]+$ || "$CUR" == "localhost" ]] && [[ "$CUR" != "$NEW" ]]; then
  sed -i '' -E "s#^(EXPO_PUBLIC_(API_BASE_URL|WS_URL)=[a-z]+://)[^:/]+#\1${NEW}#" "$ENV"
  # CORS_ORIGINS 의 이전 IP 항목 교체, 없으면 추가
  if grep -q "http://${CUR}:5173" "$ENV"; then
    sed -i '' -E "s#http://${CUR}:5173#http://${NEW}:5173#" "$ENV"
  elif ! grep -q "http://${NEW}:5173" "$ENV"; then
    sed -i '' -E "s#^(CORS_ORIGINS=.*)#\1,http://${NEW}:5173#" "$ENV"
  fi
  echo "ℹ️  LAN IP 변경 반영: ${CUR} → ${NEW}  — 앱(Expo)을 다시 시작하세요 (scripts/mobile.sh)"
  CHANGED=1
fi
[[ -d "$ROOT/mobile/app" ]] && grep '^EXPO_PUBLIC_' "$ENV" > "$ROOT/mobile/app/.env"
# 이 맥북에서 카메라 클라이언트를 시험할 때 쓰는 edge/.env (IP 주소일 때만 교체)
EDGE_ENV="$ROOT/edge/.env"
if [[ -f "$EDGE_ENV" ]] && grep -qE '^BACKEND_URL=http://[0-9.]+:' "$EDGE_ENV"; then
  sed -i '' -E "s#^BACKEND_URL=http://[0-9.]+:#BACKEND_URL=http://${NEW}:#" "$EDGE_ENV"
fi
if [[ "$CHANGED" == 1 || "${1:-}" == "--print" ]]; then
  echo "📷 카메라 컴퓨터 설정 › 맥북 서버 주소:  http://${NEW}:${PORT}"
  echo "📱 폰 Expo Go:                          exp://${NEW}:8081"
fi
