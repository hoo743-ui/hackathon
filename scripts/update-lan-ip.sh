#!/usr/bin/env bash
# Mac의 LAN IP가 바뀌면(DHCP) 앱 접속 주소·CORS를 현재 IP로 갱신한다. 도메인(운영) 주소는 건드리지 않는다.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV="$ROOT/.env"
NEW="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
[[ -z "$NEW" ]] && { echo "⚠️  LAN IP를 찾지 못했습니다 (Wi-Fi 연결 확인)"; exit 0; }
CUR="$(grep '^EXPO_PUBLIC_API_BASE_URL=' "$ENV" | sed -E 's#^[^/]*//([^:/]+).*#\1#')"
if [[ ! "$CUR" =~ ^[0-9.]+$ && "$CUR" != "localhost" ]]; then exit 0; fi   # 도메인이면 유지
if [[ "$CUR" != "$NEW" ]]; then
  sed -i '' -E "s#^(EXPO_PUBLIC_(API_BASE_URL|WS_URL)=[a-z]+://)[^:/]+#\1${NEW}#" "$ENV"
  sed -i '' -E "s#http://${CUR}:5173#http://${NEW}:5173#" "$ENV"
  echo "ℹ️  LAN IP 변경 반영: ${CUR} → ${NEW} (백엔드를 재시작해야 CORS에 반영)"
fi
[[ -d "$ROOT/mobile/app" ]] && grep '^EXPO_PUBLIC_' "$ENV" > "$ROOT/mobile/app/.env"
