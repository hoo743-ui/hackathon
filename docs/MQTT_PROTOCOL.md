# MQTT 프로토콜 계약 v1.1 (고정)

- 기계 판독용 JSON Schema: `docs/mqtt-schemas/*.schema.json` — 백엔드 Pydantic 모델에서 자동 생성 (`scripts/export_contracts.sh`). **문서와 스키마가 다르면 스키마가 기준.**
- v1.1은 v1에 필드를 **추가만** 했다. v1 메시지(추가 필드 없음)도 계속 수락한다.
- 구현: 서버 `backend/app/schemas/mqtt.py` · 펌웨어 `firmware/esp32/src/mqtt_client.cpp`, `commands.cpp` · 시뮬레이터 `backend/app/hardware/simulator.py`

## 1. 토픽 · QoS · Retain
| 토픽 | 방향 | QoS | Retain | 내용 |
|---|---|---|---|---|
| `smartbin/{device_id}/telemetry` | 장치→서버 | 1 (펌웨어 0*) | ✗ | 4개 칸 측정값 |
| `smartbin/{device_id}/status` | 장치→서버 | 1 (펌웨어 0*) | **✓** | 연결·모드·긴급정지. **LWT** = offline |
| `smartbin/{device_id}/command` | 서버→장치 | 1 | **✗ 금지** | 제어 명령 |
| `smartbin/{device_id}/ack` | 장치→서버 | 1 (펌웨어 0*) | ✗ | 명령 실행 결과 |

\* ESP32 PubSubClient는 QoS 0 발행만 지원. 유실 시: telemetry는 다음 주기(5초)에 보정, status는 15초 heartbeat, ACK는 서버 타임아웃(15초) → `TIMEOUT`.

`device_id` 형식 `DEVICE_\d{3}`, `bin_id` 형식 `BIN_\d{3}`. 토픽의 device_id와 페이로드 device_id가 다르면 폐기.

## 2. 공통 필드
| 필드 | 필수 | 설명 |
|---|---|---|
| `message_type` | v1.1 권장 | `telemetry` \| `status` \| `command` \| `ack` (토픽과 다르면 폐기) |
| `message_id` | v1.1 권장 | telemetry/status: 장치가 만든 UUID (서버 중복 제거 키). command/ack: `command_id`와 동일 |
| `device_id` | 필수 | |
| `timestamp` | 선택 | ISO-8601 UTC. NTP 미동기화 장치는 `null` → 서버 수신 시각 사용 (±5분 넘게 어긋나도 수신 시각) |
| `source` | telemetry 필수 | `hardware` \| `simulator`. 서버 `HARDWARE_MODE`와 다르면 폐기 (§5) |
| `error_code` / `status` | status·ack | 아래 각 메시지 참조 |

메시지 본문(payload)은 별도 래퍼 없이 같은 객체에 둔다 (v1 호환).

## 3. 메시지

### 3.1 telemetry (장치 → 서버)
```json
{
  "schema_version": 1,
  "message_type": "telemetry",
  "message_id": "1f0c6c1e-6a5b-4d7e-9b51-2c3e4f5a6b7c",
  "device_id": "DEVICE_001",
  "source": "hardware",
  "timestamp": "2026-10-31T10:00:00Z",
  "bins": [
    { "bin_id": "BIN_001", "waste_type": "plastic", "distance_cm": 12.5, "fill_percent": null, "sensor_status": "normal",  "samples_valid": 5 },
    { "bin_id": "BIN_002", "waste_type": "can",     "distance_cm": null, "fill_percent": null, "sensor_status": "timeout", "samples_valid": 0 },
    { "bin_id": "BIN_003", "waste_type": "paper",   "distance_cm": 30.1, "fill_percent": null, "sensor_status": "normal",  "samples_valid": 4 },
    { "bin_id": "BIN_004", "waste_type": "general", "distance_cm": 3.2,  "fill_percent": null, "sensor_status": "normal",  "samples_valid": 5 }
  ]
}
```
- 장치에 등록된 **모든 bin**을 한 메시지에 포함 (일부 누락·중복 → 메시지 전체 폐기)
- `waste_type`: 선택. 보내면 서버 DB의 bin 설정과 일치해야 함 (배선/설정 오류 검출) — 불일치 시 폐기
- `fill_percent`: 선택·참고용. **서버가 보정값으로 다시 계산**하며 장치 값은 저장하지 않는다 (보정값의 단일 출처 = 서버 DB)
- `sensor_status`: `normal` \| `out_of_range` \| `timeout` \| `error`. `normal`이 아니면 `distance_cm = null`
- 서버는 `normal`이라도 2–400cm 밖이면 `out_of_range`로 재분류, 이전 정상값을 덮어쓰지 않음

### 3.2 status (장치 → 서버, retain)
```json
{ "message_type": "status", "message_id": "…uuid…", "device_id": "DEVICE_001", "source": "hardware",
  "state": "online", "operating_mode": "MANUAL", "estop_active": false, "busy": false,
  "firmware_version": "0.2.0", "error_code": null, "timestamp": "2026-10-31T10:00:00Z" }
```
- 발행: 연결 직후 · 상태 변경 시 · heartbeat 15초
- LWT(브로커가 대신 발행): `{"message_type":"status","device_id":"DEVICE_001","state":"offline"}` retain
- `error_code`(선택): `SENSOR_FAULT` (센서 1개 이상 비정상) \| `TIME_NOT_SYNCED` \| `null`

### 3.3 command (서버 → 장치, retain 금지)
```json
{ "message_type": "command", "message_id": "6f1c…", "command_id": "6f1c…",
  "device_id": "DEVICE_001",
  "command": "OPEN_BIN", "action": "OPEN_BIN",
  "target": "plastic", "bin_id": "BIN_001", "origin": "manual",
  "requested_at": "2026-10-31T10:00:00Z", "issued_at": "2026-10-31T10:00:00Z",
  "expires_at": "2026-10-31T10:00:03Z" }
```
| command (= action) | target | bin_id | 동작 |
|---|---|---|---|
| `OPEN_BIN` | `plastic`\|`can`\|`paper`\|`general` | 해당 bin | 열기 → 대기 → 닫기 |
| `SET_MODE` | `AUTO`\|`MANUAL` | null | 운전 모드 |
| `EMERGENCY_STOP` | null | null | 즉시 정지 + 래치 |
| `RESET_ESTOP` | null | null | 래치 해제 |
| `GET_STATUS` | null | null | status 재발행 |

- `command`/`requested_at`(v1)과 `action`/`issued_at`(v1.1)은 같은 값. 장치는 어느 쪽이든 읽을 수 있다
- 장치는 `bin_id`와 `target`이 자신의 설정상 일치하지 않으면 `INVALID_TARGET`으로 거부
- `origin`: `manual`(관리자 웹·앱) \| `auto`(AI 분류에 따른 자동 동작). 없으면 `manual`(v1 호환)
  - `OPEN_BIN`은 **운전 모드와 출처가 맞을 때만** 실행: AUTO 모드 ↔ `auto`, MANUAL 모드 ↔ `manual`. 아니면 `MODE_CONFLICT`
  - 서버도 같은 규칙으로 먼저 거부한다 (장치 검사는 이중 안전장치)

### 3.4 ack (장치 → 서버)
```json
{ "message_type": "ack", "message_id": "6f1c…", "command_id": "6f1c…", "device_id": "DEVICE_001",
  "status": "SUCCEEDED", "error_code": null, "message": "BIN_OPENED",
  "success": true, "completed_at": "2026-10-31T10:00:01Z", "executed_at": "2026-10-31T10:00:01Z" }
```
- `status`: `SUCCEEDED` \| `FAILED` (v1.1). v1 `success`(bool)도 수락 — 둘 다 있으면 일치해야 함
- `error_code`: 실패 시 필수 코드, 성공 시 `null`
- `message`: 사람이 읽는 결과 코드 (성공: `BIN_OPENED`, `MODE_SET`, `ESTOP_ACTIVATED`, `ESTOP_RESET`, `STATUS_SENT`)
- `completed_at` = `executed_at`

| error_code | 의미 |
|---|---|
| `DUPLICATE` | 최근 16개 내 같은 command_id — 재실행 안 함 |
| `EXPIRED` | `expires_at` 경과 |
| `TIME_NOT_SYNCED` | NTP 미동기화 → 만료 검사 불가, OPEN_BIN·RESET_ESTOP 거부 |
| `INVALID_DEVICE` · `INVALID_COMMAND` · `INVALID_TARGET` | 형식·대상 오류 |
| `BUSY` · `ESTOP_ACTIVE` · `MODE_CONFLICT` | 상태 충돌 |
| `ABORTED_BY_ESTOP` · `ABORTED_CONNECTION_LOST` · `MOTION_TIMEOUT` | OPEN_BIN 중단 (닫힘 위치로 복귀) |
| `PINMAP_UNCONFIRMED` | 펌웨어 `PINMAP_CONFIRMED=false` — 핀맵 실물 확인 전이므로 서보 동작 거부 (`docs/HARDWARE_INTEGRATION.md` §3) |

### 3.5 해석 규칙 (확정)
- `command_id`가 명령의 유일한 식별자다. `message_id`는 참고용이며 `command_id` 없이 `message_id`만 있는 명령은 무효 (ACK 불가 → 서버 TIMEOUT)
- `command`와 `action`이 둘 다 있고 값이 다르면 `INVALID_COMMAND`. 단 어느 한쪽이라도 `EMERGENCY_STOP`이면 정지를 실행 (정지는 항상 안전 방향)
- `message_type`이 있는데 토픽과 다르면 폐기하고 ACK하지 않는다 (서버는 TIMEOUT 기록)
- `bin_id`는 `OPEN_BIN`에서만 의미가 있다. 서버는 다른 명령에 `bin_id`를 붙인 요청을 422로 거부하고, 장치는 무시한다
- status `error_code` 우선순위: `TIME_NOT_SYNCED` > `SENSOR_FAULT` > `null`. `SENSOR_FAULT`는 첫 전체 측정 이후부터 판단. `PINMAP_UNCONFIRMED`는 status에 넣지 않는다 (명령 ACK로만 보고)

## 4. 중복·재시도·안전 규칙
- **명령 중복**: 서버 — `command_id` 고유 제약 + 멱등 재요청(200). 장치 — 최근 16개 command_id 링버퍼, 중복 시 재실행 없이 `DUPLICATE`
- **telemetry/status 중복**(QoS 1 재전송): 서버가 `message_id` 최근 1024개를 기억하고 중복 폐기. `message_id` 없는 v1 메시지는 중복 제거 불가(측정 1건 중복 저장 가능 — 허용)
- **긴급정지**: 서버는 장치 offline 추정과 무관하게 발행, 진행 중 명령이 있어도 접수. 장치는 중복·만료 검사 전에 실행, 항상 `ESTOP_ACTIVATED`. 래치는 NVS 저장, `RESET_ESTOP`으로만 해제
- **타이밍**: `expires_at` = 요청 + 3초, 서버 ACK 제한 15초. `유효시간 + 최대 동작(≈9초) < ACK 제한`을 서버 기동 시·펌웨어 컴파일 시 강제 → 서버가 TIMEOUT 기록 후 모터가 움직이는 일 없음. TIMEOUT 뒤 도착한 ACK는 `LATE_ACK:<message>`로 기록만
- **연결 재시도**: 장치 Wi-Fi·MQTT 지수 백오프(최대 30초), clean session, keepalive 15초. 서버 aiomqtt 1→30초 백오프. MQTT가 끊기면 장치는 진행 중 동작을 닫힘으로 마무리하고 새 동작 금지
- **부팅**: 서보 미부착(움직임 없음), 운전 모드 MANUAL, 긴급정지 래치는 유지

## 5. 하드웨어 모드와 출처 검사 (서버)
| `HARDWARE_MODE` | 수락하는 `source` | 내장 가상 장치 |
|---|---|---|
| `SIMULATOR` | `simulator` | `SIMULATOR_AUTOSTART=true`면 백엔드가 가상 장치 실행 |
| `ESP32_REAL` | `hardware` | 없음 |

다른 출처의 telemetry/status는 경고 로그 후 폐기한다 → 시뮬레이터 데이터가 실제 장치 데이터로 기록·표시될 수 없다. (LWT offline 메시지는 `source`가 없으므로 항상 수락)

## 6. 브로커 보안
- 익명 접속 금지, 계정 3개(backend / simulator / device_001) + ACL로 토픽 권한 분리 (`infrastructure/mosquitto/entrypoint.sh`)
- 개발: 1883 평문, 기본 `127.0.0.1` 바인딩. 실기 연결 시 LAN만 (`MQTT_BIND_ADDRESS=0.0.0.0`)
- 운영(인터넷 경유): **8883 TLS 필수** — `docs/DEPLOYMENT.md` §4
