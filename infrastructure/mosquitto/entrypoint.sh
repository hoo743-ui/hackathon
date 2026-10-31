#!/bin/sh
# 환경변수로부터 비밀번호 파일과 ACL을 매 기동 시 생성한다 (비밀번호를 저장소에 두지 않기 위함).
set -eu

DATA=/mosquitto/data
PASSWD="$DATA/passwd"
ACL="$DATA/acl"

rm -f "$PASSWD"
touch "$PASSWD"
mosquitto_passwd -b "$PASSWD" "$MQTT_BACKEND_USERNAME" "$MQTT_BACKEND_PASSWORD"
mosquitto_passwd -b "$PASSWD" "$MQTT_SIMULATOR_USERNAME" "$MQTT_SIMULATOR_PASSWORD"
mosquitto_passwd -b "$PASSWD" "$MQTT_DEVICE_USERNAME" "$MQTT_DEVICE_PASSWORD"

cat > "$ACL" <<EOF
# backend: 장치 데이터 구독, 명령 발행
user $MQTT_BACKEND_USERNAME
topic read smartbin/+/telemetry
topic read smartbin/+/status
topic read smartbin/+/ack
topic write smartbin/+/command

# 시뮬레이터: DEVICE_001 역할만 수행
user $MQTT_SIMULATOR_USERNAME
topic write smartbin/DEVICE_001/telemetry
topic readwrite smartbin/DEVICE_001/status
topic write smartbin/DEVICE_001/ack
topic read smartbin/DEVICE_001/command

# 실제 ESP32 (DEVICE_001)
user $MQTT_DEVICE_USERNAME
topic write smartbin/DEVICE_001/telemetry
topic readwrite smartbin/DEVICE_001/status
topic write smartbin/DEVICE_001/ack
topic read smartbin/DEVICE_001/command
EOF

mkdir -p "$DATA/conf.d"
rm -f "$DATA/conf.d/"*.conf
if [ -f /mosquitto/certs/server.crt ] && [ -f /mosquitto/certs/server.key ]; then
  cat > "$DATA/conf.d/tls.conf" <<TLS
listener 8883
cafile /mosquitto/certs/ca.crt
certfile /mosquitto/certs/server.crt
keyfile /mosquitto/certs/server.key
tls_version tlsv1.2
TLS
  echo "TLS listener enabled on 8883"
fi
# 운영 모드: 평문 1883을 컨테이너 내부(백엔드)에서만 쓰도록 외부 포트 바인딩은 compose에서 제어한다

chown mosquitto:mosquitto "$PASSWD" "$ACL"
chmod 0700 "$PASSWD" "$ACL"

exec mosquitto -c /mosquitto/config/mosquitto.conf
