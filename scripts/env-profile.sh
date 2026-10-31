#!/usr/bin/env bash
# 환경 프로필 적용: config/env/<프로필>.env 의 값을 .env 에 덮어쓴다 (비밀번호·토큰은 그대로 유지).
# 사용: scripts/env-profile.sh local|simulator|esp32-real|edge-serial|production
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${1:-}"
SRC="$ROOT/config/env/$PROFILE.env"
[[ -f "$SRC" ]] || { echo "사용: $0 local|simulator|esp32-real|edge-serial|production" >&2; exit 1; }
[[ -f "$ROOT/.env" ]] || { echo "❌ .env 없음 — scripts/setup.sh 먼저" >&2; exit 1; }
cp "$ROOT/.env" "$ROOT/.env.bak"
while IFS='=' read -r key value; do
  [[ -z "$key" || "$key" == \#* ]] && continue
  if grep -q "^${key}=" "$ROOT/.env"; then
    sed -i '' "s|^${key}=.*|${key}=${value}|" "$ROOT/.env"
  else
    echo "${key}=${value}" >> "$ROOT/.env"
  fi
done < "$SRC"
sed -i '' '/^ENV_PROFILE=/d' "$ROOT/.env"; echo "ENV_PROFILE=$PROFILE" >> "$ROOT/.env"
[[ -d "$ROOT/mobile/app" ]] && grep '^EXPO_PUBLIC_' "$ROOT/.env" > "$ROOT/mobile/app/.env"
echo "✅ 프로필 '$PROFILE' 적용 (이전 값: .env.bak). 변경 사항 반영: scripts/infra-up.sh 후 백엔드·웹·앱 재시작"
grep -E '^(HARDWARE_MODE|SIMULATOR_AUTOSTART|MQTT_BIND_ADDRESS|MQTT_TLS_BIND_ADDRESS|API_HOST)=' "$ROOT/.env"
