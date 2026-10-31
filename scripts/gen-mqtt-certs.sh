#!/usr/bin/env bash
# MQTT TLS용 자체 서명 CA + 브로커 인증서 생성 (개발·LAN 운영용). 인터넷 운영에서는 공인 인증서 사용 권장.
# 사용: scripts/gen-mqtt-certs.sh [추가 호스트명/IP ...]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/infrastructure/mosquitto/certs"
mkdir -p "$OUT"
cd "$OUT"
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
SAN="DNS:localhost,DNS:mosquitto,IP:127.0.0.1"
[[ -n "$LAN_IP" ]] && SAN="$SAN,IP:$LAN_IP"
for extra in "$@"; do
  if [[ "$extra" =~ ^[0-9.]+$ ]]; then SAN="$SAN,IP:$extra"; else SAN="$SAN,DNS:$extra"; fi
done
[[ -f ca.key ]] || openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=SmartRecycle Local CA" -keyout ca.key -out ca.crt 2>/dev/null
openssl req -newkey rsa:2048 -nodes -subj "/CN=smartrecycle-mqtt" -keyout server.key -out server.csr 2>/dev/null
printf "subjectAltName=%s\nextendedKeyUsage=serverAuth\n" "$SAN" > server.ext
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 825 -extfile server.ext -out server.crt 2>/dev/null
rm -f server.csr server.ext ca.srl
chmod 644 ca.crt server.crt server.key
echo "✅ $OUT (SAN: $SAN)"
echo "   장치/클라이언트에는 ca.crt 만 배포한다. ca.key 는 외부로 복사하지 않는다."
