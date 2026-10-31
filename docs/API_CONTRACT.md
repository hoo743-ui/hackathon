# API 계약 (웹·모바일 공통)

- **기계 판독 계약**: `docs/openapi.json` (FastAPI에서 자동 생성, `scripts/export_contracts.sh`) · 실행 중 http://localhost:8000/docs
- **클라이언트 타입**: `shared/src/types.ts` (웹·앱이 같은 파일 사용) · 클라이언트 `shared/src/api.ts`
- **호환성 규칙**: 필드·엔드포인트는 추가만 한다. 제거·의미 변경 시 새 경로/버전을 만들고 문서·`shared/` 동시 갱신. 새 응답 필드는 TS에서 optional로 시작

## 요구 API ↔ 구현 매핑
| 요구 | 구현 | 비고 |
|---|---|---|
| `GET /api/devices` | ✅ 동일 | |
| `GET /api/bins` | ✅ 동일 | |
| `GET /api/bins/{bin_id}` | ✅ 동일 | |
| `GET /api/dashboard` | ✅ 동일 | `hardware_mode` 포함 |
| `POST /api/commands` | ✅ 본문에 `device_id` | `/api/devices/{id}/commands`와 같은 서비스 |
| `GET /api/commands/{command_id}` | ✅ | |
| `WS /ws/dashboard` | ✅ | |

## 환경별 주소
API·WS 주소는 하드코딩하지 않는다. 웹 `VITE_API_BASE_URL`/`VITE_WS_URL`, 앱 `EXPO_PUBLIC_API_BASE_URL`/`EXPO_PUBLIC_WS_URL` (프로필: `config/env/*.env`, `docs/DEPLOYMENT.md`). 모바일 실기기는 `localhost`가 아닌 서버 LAN IP/도메인.

## `GET /health`
`{ "status": "ok|degraded", "database": bool, "mqtt": bool, "hardware_mode": "SIMULATOR|ESP32_REAL", "simulator_running": bool }`
- `mqtt`는 **서버↔브로커** 연결. 장치 연결은 `devices[].connection_status`

## 명령 본문
```json
POST /api/commands
{ "device_id": "DEVICE_001", "command": "OPEN_BIN", "bin_id": "BIN_001", "command_id": "<선택 UUID>" }
```
- `OPEN_BIN` 대상은 `target`(waste_type) 또는 `bin_id`로 지정, 둘 다 주면 일치해야 함 (불일치 422 `INVALID_TARGET`)
- 응답 `Command`의 `status`가 `SUCCEEDED`가 되기 전에는 UI에서 실행 완료로 표시하지 않는다
- 실패 사유: `error_message` = 장치 ACK `error_code` (또는 `ACK_TIMEOUT`, `MQTT_PUBLISH_FAILED`, `LATE_ACK:*`). 한국어 문구: `shared/src/health.ts` `COMMAND_ERROR_LABELS`

Base URL: `http://<host>:8000`. 응답은 Pydantic 스키마로 정의하며 오류는 공통 형식을 사용한다.

```json
{ "error": { "code": "INVALID_TARGET", "message": "target must be one of plastic, can, paper, general" } }
```

## 인증
- 조회(GET): 초기 버전은 LAN 내 무인증 (추후 결정)
- 제어(POST commands, PUT calibration): `Authorization: Bearer <API_CONTROL_TOKEN>` 필수 → 없으면 401, 불일치 403

## 엔드포인트
| Method | Path | 설명 | PHASE |
|---|---|---|---|
| GET | `/health` | 서버·DB·MQTT 연결 상태 | 1 |
| GET | `/api/devices` | 장치 목록 | 1 |
| GET | `/api/devices/{device_id}` | 장치 상세 | 1 |
| GET | `/api/devices/{device_id}/status` | 연결/모드/E-STOP/busy | 1 |
| GET | `/api/bins` | 전체 bin 현재 상태 | 1 |
| GET | `/api/bins/{bin_id}` | bin 상세 | 1 |
| GET | `/api/bins/{bin_id}/history?from=&to=&limit=` | 측정 이력 | 2 |
| GET | `/api/bins/{bin_id}/calibration` | 보정값 | 1 |
| PUT | `/api/bins/{bin_id}/calibration` | 보정값 변경 (empty > full 검증) | 1 |
| GET | `/api/dashboard` | 장치 + bins + 최근 명령 스냅샷 | 2 |
| GET | `/api/statistics` | 기간별 평균/최대 적재율 등 | 3 |
| POST | `/api/devices/{device_id}/commands` | 명령 생성 → 202 | 2 |
| GET | `/api/devices/{device_id}/commands/{command_id}` | 명령 상태 | 2 |
| GET | `/api/devices/{device_id}/commands?limit=` | 최근 명령 목록 | 2 |
| GET | `/api/measurements` | 전체 측정 이력 (필터·정렬·페이지) | 재디자인 |
| GET | `/api/commands` | 전체 명령 이력 (필터·정렬·페이지) | 재디자인 |
| GET | `/api/statistics/trend?hours=&bucket_minutes=` | bin별 시간 버킷 적재율 추이 | 재디자인 |
| WS | `/ws/dashboard` | 실시간 이벤트 | 3 |

### 이력·분석 API (읽기 전용, 2026-10-31 추가 — 기존 계약 변경 없음)
- `GET /api/measurements?device_id&bin_id&sensor_status&source&from&to&order=asc|desc&limit(1–500, 기본 50)&offset`
- `GET /api/commands?device_id&status&command&bin_id&from&to&order&limit&offset`
- 응답: `{ "items": [...], "total": 123, "limit": 50, "offset": 0 }`
- `GET /api/statistics/trend?hours(1–720)&bucket_minutes(1–1440)` → `{ period_hours, bucket_minutes, buckets: [{ bucket_start, bin_id, avg_fill_percent, max_fill_percent, sample_count, error_count }] }`
  - 측정이 없는 버킷은 포함하지 않는다 (0으로 채우지 않음). 미보정 bin의 평균은 `null`
  - 버킷 수가 2000을 넘으면 422 `TOO_MANY_BUCKETS`

### POST commands
요청: `{"command": "OPEN_BIN", "target": "plastic", "command_id": "<선택 UUID>"}`
- 신규 → **202** + 상태 `SENT` (장치 실행 완료가 아님. ACK 후 `SUCCEEDED`)
- 같은 `command_id` 재요청 → **200** + 기존 명령 (멱등, 재발행 없음)

### POST commands 오류 매핑
| 상황 | HTTP | code |
|---|---|---|
| 허용되지 않은 target | 422 | `INVALID_TARGET` |
| 알 수 없는 command / 형식 오류 | 422 | `VALIDATION_ERROR` |
| 장치 없음 | 404 | `DEVICE_NOT_FOUND` |
| 장치 offline | 409 | `DEVICE_OFFLINE` |
| 진행 중 명령 있음 | 409 | `DEVICE_BUSY` |
| AUTO 모드에서 수동 OPEN_BIN | 409 | `MODE_CONFLICT` |
| E-STOP 활성 | 409 | `ESTOP_ACTIVE` |
| 브로커 미연결 | 503 | `MQTT_UNAVAILABLE` (명령은 FAILED로 기록) |
| 토큰 없음 / 불일치 | 401 / 403 | `UNAUTHORIZED` / `FORBIDDEN` |
※ `EMERGENCY_STOP`은 offline 외 모든 409 조건을 무시하고 우선 처리.

## WebSocket 이벤트
```json
{ "type": "connected", "data": { "clients": 1 } }
{ "type": "bins.updated", "data": [ /* Bin[] — 변경된 bin 전체 객체 */ ], "sent_at": "..." }
{ "type": "device.status", "data": { /* Device 전체 객체 */ }, "sent_at": "..." }
{ "type": "command.updated", "data": { /* Command 전체 객체 (GET command 응답과 동일) */ }, "sent_at": "..." }
```
모든 이벤트의 `data`는 해당 REST 응답 스키마와 동일한 **전체 객체**다 (부분 객체를 보내지 않음). 타입: `shared/src/types.ts`.
클라이언트가 텍스트 `ping`을 보내면 서버는 `pong`으로 응답한다. 클라이언트는 재연결 후 반드시 `GET /api/dashboard`로 재동기화한다.

대화형 문서: 백엔드 실행 후 http://localhost:8000/docs (Swagger UI, FastAPI 내장·무료)
