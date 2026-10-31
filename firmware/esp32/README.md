> ⚠️ **해커톤 시연에는 사용하지 않는다.** 이 펌웨어는 ESP32 가 서보 4개·초음파 4개를 직접 제어하는 원래(MQTT) 설계다. 실제 장비는 `firmware/uno_controller` (UNO: 서보 3개·초음파 1개) + `firmware/esp32_bridge` 를 쓴다 — `docs/HARDWARE_WIRING.md`.

# ESP32 펌웨어 (DEVICE_001)

> ⚠️ **실제 하드웨어에서 한 번도 테스트하지 않았다.** `pio run` 빌드(컴파일)만 확인했다.
> 핀 번호, 서보 각도, 전원, 측정 품질 모두 **미검증 [HW 미확인]** 상태다.
> 아래 "전원 투입 전 체크리스트"를 끝내기 전에는 업로드/전원 투입을 하지 않는다.
> `config.h`의 GPIO 번호는 **후보값이며 최종 핀맵이 아니다.** `PINMAP_CONFIRMED`(기본 `false`)가
> `false`인 동안 펌웨어는 센서만 동작시키고 **서보 동작을 모두 거부**한다 (5절).

PlatformIO + Arduino framework (espressif32 8.0.0 → Arduino-ESP32 core 3.3.x).
보드: ESP32 DevKitC V4, HC-SR04 ×4 (Echo 1k/2k 분배), SG90 ×4 (별도 5V 전원).

## 1. 구조

| 파일 | 역할 |
|---|---|
| `include/config.h` | 핀(후보값), `PINMAP_CONFIRMED` 게이트, bin↔waste_type 매핑, 서보 닫힘/열림 각도·하드 리밋, 시간값(static_assert), 측정 파라미터, 토픽 prefix, 펌웨어 버전. **유일한 하드웨어 설정 위치** |
| `include/secrets.example.h` | Wi-Fi/MQTT 계정 템플릿 (`secrets.h`는 Git 제외) |
| `include/secrets_loader.h` | `secrets.h`가 없으면 example로 대체하고 `#warning` (빌드는 되지만 접속 불가) |
| `src/sensor_manager.*` | (구 `sensors.*`, 클래스 `SensorScanner`) BIN_001→004 엄격한 순차 측정, 핑 간격 ≥60ms, 유효 샘플 중앙값, 부족하면 `distance_cm=null` |
| `src/servo_controller.*` | (구 `actuators.*`, 클래스 `Actuators`) 논블로킹 서보 상태머신, 한 번에 1개만, 동작 중에만 attach, 각도 클램프, E-STOP 래치(NVS 저장), `PINMAP_CONFIRMED=false`면 attach 자체를 하지 않음 |
| `src/mqtt_client.*` | (구 `mqtt_link.*`, 네임스페이스 `net`) Wi-Fi/MQTT 재연결(지수 백오프), LWT, 토픽, 토픽별 최대 페이로드 계산 |
| `src/commands.*` | 명령 검증(v1/v1.1 별칭)·중복 차단·만료 확인·실행·ACK(v1+v1.1 필드) |
| `src/time_utils.*` | NTP(UTC), ISO-8601 파싱/포맷 |
| `src/uuid.*` | telemetry/status `message_id`용 UUID v4 (`esp_random()`) |
| `src/app.h` | 공유 상태(운전 모드), status 발행 훅 |
| `src/main.cpp` | 부팅 배너, 루프: 연결, 텔레메트리, status(하트비트·`error_code`) |

> 참고: `src/`는 PlatformIO 빌드에서 `-Isrc`로 ESP-IDF include 경로보다 앞에 온다. 따라서 `src/mqtt_client.h`는
> ESP-IDF esp-mqtt의 같은 이름 헤더를 가린다. 현재 빌드에는 영향이 없지만, esp-mqtt를 쓰는 라이브러리를 추가하면 충돌한다.

펌웨어는 원시 `distance_cm` + `sensor_status`만 보낸다. 적재율은 서버가 계산한다 (ARCHITECTURE D1).

## 2. 빌드 / 업로드 / 모니터

```bash
cd firmware/esp32
cp include/secrets.example.h include/secrets.h   # 값 채우기 (아래 3절)
pio run                      # 빌드
pio run -t upload            # 업로드 — 체크리스트(5절) 완료 후에만!
pio device monitor           # 시리얼 115200
```

라이브러리(고정): `knolleary/PubSubClient@2.8`, `bblanchon/ArduinoJson@7.2.1`, `madhephaestus/ESP32Servo@3.0.6`.

## 3. Secrets

`include/secrets.h` (루트 `.gitignore`에 등록됨):

```c
#define WIFI_SSID "..."
#define WIFI_PASSWORD "..."
#define MQTT_HOST "192.168.x.x"   // Mosquitto가 도는 PC의 LAN IP
#define MQTT_PORT 1883
#define MQTT_USERNAME "device_001" // 장치 전용 계정 (ACL)
#define MQTT_PASSWORD "..."
```

ESP32는 2.4GHz Wi-Fi만 지원한다.

## 4. 동작 요약

프로토콜: `docs/MQTT_PROTOCOL.md` **v1.1** (v1 필드는 모두 유지, v1.1 필드는 추가만). 펌웨어 버전 `0.2.0`.

### MQTT
- Client ID = `DEVICE_001`, clean session, keepalive 15s, 버퍼 1024B.
- LWT: `smartbin/DEVICE_001/status` ← `{"message_type":"status","device_id":"DEVICE_001","state":"offline"}` (retain, QoS 1).
- 접속 직후 / 상태 변경 시(`error_code` 변화 포함) / 15초마다 retain status 발행:
  `message_type:"status", message_id(UUID v4), device_id, source:"hardware", state, operating_mode, estop_active, busy,
  firmware_version, error_code, timestamp`.
  - `error_code` 우선순위: **`TIME_NOT_SYNCED`** (NTP 미동기화 — 장치 전체 영향: OPEN_BIN·RESET_ESTOP 거부, status로만 보임)
    → **`SENSOR_FAULT`** (마지막 완료 스캔에서 1개 이상 bin이 `normal` 아님 — telemetry에도 bin별로 보임) → `null`.
    부팅 후 첫 스캔 완료 전에는 `SENSOR_FAULT`를 보내지 않는다.
  - `PINMAP_UNCONFIRMED`는 status `error_code`에 넣지 않는다 (프로토콜 3.2의 허용 값이 아님). 시리얼 배너와 ACK로만 알린다.
- 텔레메트리 5초 주기, 필드:
  `schema_version:1, message_type:"telemetry", message_id(UUID v4), device_id, source:"hardware", timestamp(NTP 미동기화 시 null),
  bins[] = {bin_id, waste_type(config BINS[]), distance_cm, fill_percent:null, sensor_status, samples_valid}`.
  `fill_percent`는 항상 `null` — 적재율은 서버가 보정값으로 계산한다.
- `message_id`는 메시지마다 새 UUID v4 (`esp_random()`; 무선이 켜져 있을 때 하드웨어 RNG). 서버 중복 제거 키.
- 명령 토픽은 QoS 1로 구독.

**페이로드 크기 (호스트에서 ArduinoJson 7.2.1로 측정한 최악값):** telemetry 714B (4개 bin 모두 `out_of_range`·`399.9`),
status 292B, ACK 391B (`command_id` 64자). PubSubClient 1024B 버퍼에서 telemetry 토픽의 최대 페이로드는
1024 − 5(고정 헤더) − 2 − 29(토픽) = 988B. 발행 전 `measureJson()`으로 검사해 넘으면 보내지 않고 로그를 남긴다.
ArduinoJson 7은 힙 기반 가변 용량이라 고정 capacity 설정은 없다.

> **알려진 제한:** PubSubClient는 **QoS 0으로만 발행**한다. 프로토콜 문서는 telemetry/status/ack를 QoS 1로
> 정의하지만, 이 펌웨어의 발행 메시지는 링크가 불안정하면 유실될 수 있다. ACK 유실은 서버의 ACK 제한시간
> (`COMMAND_ACK_TIMEOUT_SEC`, 15s → `TIMEOUT`)으로 처리된다. 연결이 끊긴 동안 생긴 마지막 ACK 1개는
> 재접속 후 재전송을 시도한다(서버가 이미 TIMEOUT 처리했을 수 있음).

### 명령 처리 순서
1. JSON 파싱, `command_id` 필수 (없으면 ACK 불가 → 로그 후 폐기).
   `message_type`이 있는데 `"command"`가 아니면 폐기(ACK 없음, 프로토콜 §2 "토픽과 다르면 폐기")
2. `device_id` 불일치 → `INVALID_DEVICE`
3. **`EMERGENCY_STOP`은 무조건 먼저 실행** (중복/만료/BUSY 무관, 항상 `ESTOP_ACTIVATED` 성공 ACK).
   `command`/`action` 중 하나라도 `EMERGENCY_STOP`이면 실행한다 (두 값이 달라도 — 정지는 항상 안전)
4. 최근 16개 command_id 중복 → `DUPLICATE` (재실행 없음)
5. 알 수 없는 command → `INVALID_COMMAND`. `command`(v1)와 `action`(v1.1)은 별칭 — 둘 중 하나만 있어도 되고,
   둘 다 있는데 값이 다르면 `INVALID_COMMAND`. `requested_at`(v1)/`issued_at`(v1.1)도 같은 규칙(로그용으로만 읽음).
   `origin`이 있는데 `"manual"`/`"auto"`가 아니면(문자열 아님 포함) → `INVALID_COMMAND` (없거나 `null`이면 `"manual"`, v1 호환).
   `expires_at` 없음/파싱 불가 → `INVALID_COMMAND`
6. NTP 미동기화 상태에서 `OPEN_BIN`/`RESET_ESTOP` → `TIME_NOT_SYNCED` (만료 검사를 할 수 없으므로 거부)
7. `expires_at` 경과 → `EXPIRED`
8. 명령별:
   - `OPEN_BIN`: `target` 미등록 → `INVALID_TARGET`; `bin_id`가 null이 아니고 `config.h`에서 그 `target`에 매핑된
     bin과 다르면 → `INVALID_TARGET`; `PINMAP_CONFIRMED=false` → **`PINMAP_UNCONFIRMED`**; 이어서
     `ESTOP_ACTIVE`, `MODE_CONFLICT`(운전 모드 ≠ `origin`: AUTO 모드는 `origin:"auto"`(AI 자동 분류)만,
     MANUAL 모드는 `origin:"manual"`만 실행), `BUSY`
   - `SET_MODE`: `INVALID_TARGET`, `ESTOP_ACTIVE`, `BUSY`
   - `RESET_ESTOP`: `target`이 null 아님 → `INVALID_TARGET`, 서보 안전 닫힘 중 → `BUSY`
   - 다른 명령의 `bin_id`는 검사하지 않는다.

### ACK 필드 (v1 + v1.1)
`message_type:"ack"`, `message_id`(= `command_id`), `command_id`, `device_id`, `status`(`SUCCEEDED`|`FAILED`),
`error_code`(성공 시 `null`, 실패 시 코드), `message`, `success`(v1 bool, `status`와 항상 일치),
`completed_at` = `executed_at` (NTP 미동기화 시 둘 다 `null`).

성공 `message`: `BIN_OPENED`(열기→대기→닫기 **완료 후**), `MODE_SET`, `ESTOP_RESET`, `ESTOP_ACTIVATED`, `STATUS_SENT`.
실패 시 `message`와 `error_code`는 같은 코드:

| error_code | 의미 |
|---|---|
| `DUPLICATE` | 최근 16개 내 같은 command_id — 재실행 안 함 |
| `EXPIRED` | `expires_at` 경과 |
| `TIME_NOT_SYNCED` | NTP 미동기화 → OPEN_BIN·RESET_ESTOP 거부 |
| `INVALID_DEVICE` · `INVALID_COMMAND` · `INVALID_TARGET` | 형식·대상 오류 (bin_id↔target 불일치 포함) |
| `BUSY` · `ESTOP_ACTIVE` · `MODE_CONFLICT` | 상태 충돌 (`MODE_CONFLICT` = OPEN_BIN의 `origin`이 운전 모드와 다름) |
| `PINMAP_UNCONFIRMED` | `config.h`의 `PINMAP_CONFIRMED=false` — 검증 안 된 핀맵에서는 서보를 움직이지 않음 (5절) |
| `ABORTED_BY_ESTOP` · `ABORTED_CONNECTION_LOST` · `MOTION_TIMEOUT` | OPEN_BIN 중단 (닫힘 위치로 복귀) |

### 안전 동작
- 부팅 시 서보를 attach하지 않음, 신호선 LOW → 부팅 중 움직임 없음 (GPIO14 부팅 글리치는 실물 확인 필요).
- 서보 객체 1개만 사용 → 동시에 두 서보 구동 불가. 사이클 사이 300ms 쿨다운.
- 모든 각도는 `SERVO_HARD_MIN_ANGLE..SERVO_HARD_MAX_ANGLE`로 클램프 (빌드 시 static_assert로도 검사).
- MQTT/Wi-Fi가 끊기면 진행 중인 사이클을 즉시 닫힘 각도로 마무리(`abortToSafe`), 새 동작은 시작하지 않음.
- E-STOP: 동작 중 서보를 닫힘 각도로 보내고 정착 시간(700ms) 후 detach, **래치**. NVS에 저장되어
  재부팅해도 유지되며 `RESET_ESTOP`으로만 해제 (ARCHITECTURE D10).
- 부팅 시 운전 모드는 `MANUAL` (저장하지 않음). 서버는 모드를 자동 재지정하지 않는다 — 재부팅 후 AUTO가 필요하면 앱에서 다시 `SET_MODE`.
- 서보 동작 중에는 초음파 측정을 일시 정지 (`PAUSE_SENSING_DURING_MOTION`).

## 5. `PINMAP_CONFIRMED` 절차 / 전원 투입 전 체크리스트 (`docs/HARDWARE_WIRING.md` 5절과 함께)

`include/config.h`의 `BINS[]` 핀 번호는 **후보값**이다. `PINMAP_CONFIRMED`는 기본 `false`이며 이때:
- 부팅 시 시리얼에 경고 배너 출력 (`PINMAP_CONFIRMED = false ... ALL SERVO MOTION IS REFUSED`)
- 초음파 센서·텔레메트리·status·명령 처리는 정상 동작
- `OPEN_BIN` → ACK `FAILED`, `error_code:"PINMAP_UNCONFIRMED"`. 서보 컨트롤러도 별도로 거부하고 attach/PWM을 하지 않는다
  (이중 방어). 서보 신호 핀은 부팅 시 기존처럼 OUTPUT LOW로 둔다.
- `EMERGENCY_STOP`/`RESET_ESTOP`/`SET_MODE`/`GET_STATUS`는 그대로 처리 (움직임 없음)

**`true`로 바꾸기 전에 실제 보드에서 아래를 모두 확인하고 `docs/HARDWARE_WIRING.md`에 날짜와 함께 기록한다:**

1. **모듈 확인**: 금속 캔 각인이 ESP32-**WROOM**-32(E)인지 **WROVER**인지. WROVER는 GPIO16/17이 PSRAM에 연결되어
   **사용 불가** → TRIG 핀(16/17)을 다른 핀으로 옮긴다.
2. **GPIO16/17**: WROOM이라도 보드 실크/회로도에서 16/17이 헤더에 실제로 나와 있고 다른 부품에 연결되지 않았는지 확인.
3. **스트랩 핀**: `BINS[]`에 GPIO0, 2, 5, 12, 15가 없어야 한다 (특히 GPIO12 = 플래시 전압 선택, 부팅 시 HIGH면 부팅 실패).
   GPIO6–11(내부 플래시)은 절대 사용 금지. GPIO34–39는 입력 전용 → ECHO에만. 부팅 중 펄스가 나오는 핀(GPIO14 등)에
   연결된 서보가 튀는지 혼 분리 상태로 확인.
4. **ECHO 분배기**: 각 HC-SR04 ECHO 분배(1k/2k) 출력을 멀티미터로 측정해 **≤ 3.3 V**인지 확인한 **후에** ESP32에 연결.
5. **서보 전원**: 서보는 **별도 5V(≥3A)** 전원 + 470~1000µF 커패시터. ESP32 5V/VIN·MB102로 구동 금지.
   서보 전원 GND, ESP32 GND, 센서 GND를 **공통 접지**.
6. 보드 실크 핀맵과 `BINS[]` 표를 1:1 대조.
7. 위가 모두 끝나면 `constexpr bool PINMAP_CONFIRMED = true;`로 바꾸고 다시 빌드. 이후에도 아래 체크리스트(혼 분리 상태 첫
   동작, 각도 실측)를 따른다.

### 전원 투입 전 체크리스트

- [ ] 위 `PINMAP_CONFIRMED` 절차 1–6 완료
- [ ] ESP32 모듈 각인 확인: **WROVER면 GPIO16/17 사용 불가** → `config.h` TRIG 핀 변경
- [ ] 보드 실크 핀맵과 `config.h`의 `BINS[]` 표 대조
- [ ] HC-SR04 ECHO 분배 출력 전압을 멀티미터로 측정 (≤3.3V) **후에** ESP32에 연결
- [ ] 서보 전원은 별도 5V(≥3A) + 470~1000µF 커패시터, **ESP32 5V/VIN·MB102로 서보 구동 금지**
- [ ] 모든 GND 공통 접지 (서보 전원, MB102, ESP32)
- [ ] 서보 혼을 기구(뚜껑)에서 **분리한 상태로** 첫 업로드 → 부팅 시 튐 여부 확인
- [ ] 분리 상태에서 OPEN_BIN으로 닫힘/열림 각도 확인 → `config.h`의 `closedAngle/openAngle` 및
      `SERVO_HARD_MIN/MAX_ANGLE` 실측값으로 조정 → 그 후 기구 결합
- [ ] 서보 1개 구동 시 전류 측정, 전원 공급기 정격 확인
- [ ] E-STOP 시 서보가 **닫힘 방향**으로 움직인다. 손 끼임 위험이 있는 기구라면 닫힘 각도/속도를 재검토
- [ ] 확인한 항목은 `docs/HARDWARE_WIRING.md` 체크리스트에 날짜와 함께 기록

## 6. 보정(Calibration) 절차

펌웨어는 거리만 보내므로 보정값은 서버에만 저장한다.

1. 펌웨어 업로드 후 `pio device monitor`에서 `[TEL]` 로그(또는 서버 sensor_logs)로 bin별 `distance_cm` 확인.
2. **빈 상태**: 통을 비우고 여러 주기(≥5회) 값을 기록 → 중앙값을 `empty_distance_cm`로.
3. **가득 찬 상태**: "가득 참"으로 볼 높이까지 채우고(또는 그 높이에 판을 대고) 같은 방법으로 `full_distance_cm` 측정.
   HC-SR04 최소 측정거리(~2cm)보다 충분히 커야 한다.
4. 서버에 등록 (`empty > full` 이어야 함):
   ```bash
   curl -X PUT http://<host>:8000/api/bins/BIN_001/calibration \
     -H "Authorization: Bearer $API_CONTROL_TOKEN" -H "Content-Type: application/json" \
     -d '{"empty_distance_cm": 40.0, "full_distance_cm": 8.0}'
   ```
   (요청 필드명은 `docs/API_CONTRACT.md`/백엔드 스키마 기준으로 확인)
5. `sensor_status`가 자주 `timeout`/`out_of_range`면 센서 각도·높이, 통 벽 반사, 흡음 재질(비닐/종이)을 점검.

## 7. 미검증 가정 (실물 확인 필요)

- 핀 배정 전체(`PINMAP_CONFIRMED=false`), WROOM-32E 모듈 여부, HC-SR04 5V 모듈의 TRIG 3.3V 인식
- 서보 각도(0°/90° 자리표시값), 펄스폭 500–2400µs, 정착 시간 700ms(무부하 기준 추정)
- 음속 0.0343cm/µs(약 20°C, 온도 보정 없음), Echo 타임아웃 30ms
- 서보 detach 후 SG90이 위치를 유지하는지(무토크 상태에서 뚜껑 무게로 처지는지)
- 한 번의 ping이 최대 ~60ms 블로킹(pulseIn) — 루프 지연 허용 범위
- v1.1 필드는 서버 스키마(`docs/mqtt-schemas/`)와의 실제 MQTT 왕복으로 확인하지 않았다 (컴파일만 확인)
