# 실제 하드웨어 연동 절차 (ESP32_REAL)

> **상태: 실제 하드웨어로는 한 번도 시험하지 않았다 (NOT TESTED).** 아래 절차의 모든 [HW] 항목은 조립 후 수행해야 한다.
> 서버·MQTT·데이터 계약은 시뮬레이터와 동일한 경로로 검증됐다 ([SIM], `docs/TEST_REPORT.md`). 시뮬레이터 통과는 하드웨어 검증이 아니다.

## 1. 구조 — 무엇이 바뀌고 무엇이 그대로인가
```
                 HARDWARE_MODE=SIMULATOR                    HARDWARE_MODE=ESP32_REAL
 백엔드 내장 VirtualDevice ─┐                           ESP32 (firmware/esp32) ─┐
                           ├─ MQTT (같은 토픽·같은 JSON 계약) ─┤
                           └────────────▶ Mosquitto ◀───────┘
                                              │
                    FastAPI: app/hardware/ (HAL) → services → PostgreSQL → REST/WS → 웹·앱 (변경 없음)
```
| 계층 | 시뮬레이터 → 실기 전환 시 |
|---|---|
| 웹·모바일 | **변경 없음** (같은 API·WS) |
| 서비스·DB·API | 변경 없음 |
| HAL (`backend/app/hardware/`) | `HARDWARE_MODE`만 변경 → `MqttHardwareAdapter`, `source=hardware`만 수락 |
| 브로커 | LAN 공개(`MQTT_BIND_ADDRESS=0.0.0.0`) 또는 TLS 8883 |
| 펌웨어 | Wi-Fi·브로커 주소·계정(`secrets.h`), 핀맵 확정(`config.h`) |
| DB | **bin 보정값을 실측값으로 다시 설정** (시뮬레이터용 40/5cm 덮어쓰기) |

HAL 인터페이스 (`backend/app/hardware/interfaces.py`): `get_device_status()`, `get_sensor_data()`, `execute_servo_command()`, `get_command_status()`, `disconnect()`, `reconnect()` (+ `start()`). 두 모드가 같은 구현(`MqttHardwareAdapter`)으로 명령을 전송한다.

## 2. 준비물 체크
- [ ] ESP32 DevKitC V4, HC-SR04 ×4, SG90 ×4, 브레드보드, 저항(1kΩ·2kΩ ×4), **서보용 별도 5V ≥3A 전원**, 470–1000µF 커패시터, 멀티미터
- [ ] Mac과 ESP32가 같은 **2.4GHz** Wi-Fi
- [ ] `docs/HARDWARE_WIRING.md` 전기 안전 항목 숙지

## 3. 핀맵 확정 (필수, 펌웨어가 강제)
`firmware/esp32/include/config.h`의 `PINMAP_CONFIRMED = false` 동안 펌웨어는 센서·통신은 동작하지만 **서보 동작을 거부**한다 (ACK `FAILED`, `PINMAP_UNCONFIRMED`). 아래를 모두 확인한 뒤에만 `true`로 바꾼다.
1. 모듈 각인 확인: WROOM-32E면 후보 핀 사용 가능 / **WROVER면 GPIO16·17 사용 불가** → TRIG 핀 변경
2. 스트랩 핀(0, 2, 5, 12, 15)·플래시 핀(6–11)을 쓰지 않는지 확인
3. 각 ECHO 분압 출력 전압을 멀티미터로 측정 **≤ 3.3V** (ESP32에 연결하기 전에)
4. 서보 전원이 ESP32 5V/VIN·MB102가 아닌 **별도 5V**이고 모든 GND가 공통인지 확인
5. 확인 결과를 `docs/HARDWARE_WIRING.md` §5 체크리스트에 날짜와 함께 기록

## 4. 서버를 실기 모드로
```bash
scripts/env-profile.sh esp32-real     # HARDWARE_MODE=ESP32_REAL, 브로커 LAN 공개, 내장 시뮬레이터 끔
scripts/infra-up.sh                   # 브로커 재기동 (LAN 바인딩 반영)
scripts/backend.sh                    # 로그에 HARDWARE_MODE=ESP32_REAL
curl -s localhost:8000/health         # "hardware_mode":"ESP32_REAL","simulator_running":false
```
macOS 방화벽이 수신 허용을 물으면 허용. 외부 시뮬레이터(`scripts/simulate.sh`)는 이 모드에서 실행이 거부된다.

## 5. 펌웨어 설정·업로드
```bash
cd firmware/esp32
cp include/secrets.example.h include/secrets.h
#   WIFI_SSID / WIFI_PASSWORD
#   MQTT_HOST = Mac LAN IP  (ipconfig getifaddr en0)
#   MQTT_PORT = 1883 (LAN) — 인터넷 경유 시 TLS 8883은 펌웨어 미구현 (§9)
#   MQTT_USERNAME / MQTT_PASSWORD = .env 의 MQTT_DEVICE_USERNAME / MQTT_DEVICE_PASSWORD
pio run                         # 빌드
# ↓ 서보 혼(horn)을 기구에서 분리한 상태에서
pio run -t upload && pio device monitor
```
시리얼에서 기대하는 순서: 핀맵 경고 배너(미확정 시) → Wi-Fi 연결 → NTP 동기화 → MQTT 연결 → `[TEL]` 5초 주기.

## 6. 단계별 연결 시험 [HW] — 모두 NOT TESTED
| # | 시험 | 방법 | 통과 기준 |
|---|---|---|---|
| H1 | 브로커 접속 | `mosquitto_sub -h <LAN IP> -u $MQTT_BACKEND_USERNAME -P … -t 'smartbin/#' -v` | status(online, `source:"hardware"`)와 telemetry 수신 |
| H2 | 계약 적합성 | H1에서 받은 JSON을 `docs/mqtt-schemas/*.schema.json`으로 검증 | 스키마 통과 |
| H3 | 서버 수신 | 웹 헤더 | "시뮬레이터 데이터" 표시 없음, 장치 `hardware`, 4칸 거리값 갱신 |
| H4 | 센서 개별 | 각 센서 앞에 손/판 → 해당 bin만 변화 | 다른 칸 간섭 없음 (`waste_type` 매핑 일치) |
| H5 | 센서 고장 | 센서 1개 ECHO 분리 | 해당 bin `timeout`, 이전 정상값 유지, 장치 `SENSOR_FAULT` |
| H6 | 보정 | §7 | 빈 통 ≈0%, 기준 높이 ≈100% |
| H7 | 핀맵 미확정 거부 | `PINMAP_CONFIRMED=false`로 배출구 명령 | `FAILED · 핀맵 미확정`, 서보 정지 |
| H8 | 서보 단독 | 확정 후, **혼 분리** 상태로 앱에서 배출구 1개 | 닫힘→열림→닫힘, ACK 후에만 "실행 완료" |
| H9 | 각도 조정 | `config.h` closed/open 각도·hard limit 실측 조정 | 기구 간섭 없음 |
| H10 | 동시 제한 | 동작 중 다른 배출구 | `DEVICE_BUSY` (서버) |
| H11 | 긴급정지 | 동작 중 긴급정지 | 즉시 닫힘 위치 후 정지, 래치, 재부팅 후에도 유지, 해제 명령 전 모든 동작 거부 |
| H12 | 연결 끊김 | 동작 중 Wi-Fi 공유기 끔 | 닫힘 마무리, 서버 15초 후 TIMEOUT, LWT → offline |
| H13 | 재연결 | 공유기 복구 | 자동 재접속, online, 데이터 재개 |
| H14 | 전원 | 서보 1개 동작 시 전류·전압 강하 측정 | 5V 레일 4.75V 이상, ESP32 리셋 없음 |
| H15 | 장시간 | 1시간 연속 | 메모리 누수·재부팅 없음, telemetry 누락률 기록 |

결과는 `docs/TEST_REPORT.md`의 [HW] 표에 날짜·측정값과 함께 기록한다.

## 7. 보정 (실측)
1. 통을 비우고 telemetry 5회 이상의 `distance_cm` 중앙값 → `empty_distance_cm`
2. "가득"으로 볼 높이에 판을 대고 같은 방법 → `full_distance_cm` (HC-SR04 최소거리 2cm보다 충분히 크게)
3. 웹 **설정 › 센서 & 보정** 또는 `PUT /api/bins/{bin_id}/calibration` (토큰 필요). `empty > full` 검증
4. 4칸 모두 반복

## 8. 시뮬레이터로 되돌리기
```bash
scripts/env-profile.sh simulator && scripts/infra-up.sh && scripts/backend.sh
```
실기 보정값은 DB에 남는다. 시뮬레이터 `--calibrate`·`scripts/e2e.sh`는 보정값을 덮어쓰므로 실기 보정 후에는 실행하지 않는다.

## 9. 남은 하드웨어 관련 작업 (현재 미구현·미검증)
| 항목 | 상태 |
|---|---|
| §6 H1–H15 전체 | NOT TESTED |
| 핀맵·서보 각도·정착 시간(700ms)·echo 타임아웃 실측 | 자리표시값 |
| 펌웨어 MQTT TLS (WiFiClientSecure + CA) | **미구현** — LAN 평문만. 인터넷 경유 시 필요 (플래시 82% 사용 중 → 파티션 조정 검토) |
| 펌웨어 발행 QoS 1 | PubSubClient 제약으로 QoS 0 |
| 다중 장치 | DEVICE_001 고정 (시드·ACL·앱 제어 화면) |
