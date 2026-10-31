#!/usr/bin/env bash
# Expo 개발 서버. 휴대폰 Expo Go 앱으로 QR 스캔.
source "$(dirname "$0")/_common.sh"
"$ROOT/scripts/update-lan-ip.sh"
cd "$ROOT/mobile/app"
exec npx expo start "$@"
