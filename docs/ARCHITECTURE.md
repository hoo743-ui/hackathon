# 아키텍처

## 0. 해커톤 시연 구성 (EDGE_SERIAL) — 현재 기본값

```
 [노트북 A: 카메라 컴퓨터]  SMART_RECYCLE_AI(.exe)  ← 이 프로그램 하나가 시리얼 포트를 단독 소유
   카메라 ─▶ OpenCV ─▶ YOLO(best_model.pt, conf 0.5) ─▶ 안정 검출 1회(StableTrigger)
                                                   ├─① USB Serial 9600 ─▶ Arduino UNO (trush.ino) ─▶ 서보 3개
                                                   │      'G' 유리 · 'M' 금속 · 'P' 종이 · 'L' 플라스틱  (ACK 없음)
                                                   └─② 전송 큐(스레드) ─HTTP multipart─▶ 맥북
   Arduino USB ◀─ "[ALERT] 만차" ─ 초음파 1개(D4/D5) ──▶ POST /api/telemetry
   5초마다 POST /api/edge/heartbeat (카메라·모델·시리얼·전송 대기 상태)
   (선택) ESP32 USB ─ 로그 읽기 전용

 [노트북 B: MacBook 중앙 서버]  ./start_server.sh
   FastAPI(0.0.0.0:8000) ─ 검증 → 이미지 파일 저장(backend/data/images) → PostgreSQL 기록 → WebSocket 발행
   Docker: PostgreSQL 16 · Mosquitto(기존 기능 유지용)

 [클라이언트]  같은 REST + 같은 WebSocket 이벤트
   관리자 웹  http://<맥북IP>:5173  ─ ws://<맥북IP>:8000/ws/dashboard
   관리자 앱  Expo Go (실기기)        ─ ws://<맥북IP>:8000/ws
```

설계 원칙
- **하드웨어 우선·네트워크 독립**: 분류 즉시 시리얼 명령 → 그다음 전송 큐. 서버가 끊겨도 모터는 동작하고, 못 보낸 분류는 `edge/outbox/`에 저장 후 복구 시 재전송 (같은 `detection_id` → 서버가 중복 저장하지 않음).
- **성공을 꾸미지 않음**: Arduino는 ACK가 없으므로 결과는 `command_sent`(명령 전송됨 · 동작 미확인). `not_connected`/`serial_failed`/`skipped_busy`/`disabled`는 그대로 표시.
- **저장 후 발행**: 이미지 파일(임시 파일→rename) → DB commit → `detection.updated` + `new_detection` 이벤트. 실패 시 고아 파일 삭제.
- **같은 데이터**: 웹·앱 모두 `GET /api/dashboard` 스냅샷 + 같은 이벤트를 같은 리듀서(`shared/src/state.ts`, id 기준 병합)로 반영. 재연결 시 스냅샷으로 재동기화.
- **실데이터만**: 센서는 초음파 1개의 만차 알림뿐 → 4칸 적재율은 null(“미보정/수신 없음”)로 표시.

### 주요 API (EDGE 추가분)
| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/detections` | multipart: `metadata`(JSON) + `image`(JPEG/PNG ≤5MB). AI 토큰 필요. 신규 201 / 재전송 200 |
| GET | `/api/detections`, `/api/detections/{detection_id}` | 이력(최신순) / 상세 |
| GET | `/api/detections/{detection_id}/image` | 이미지 파일 |
| POST/GET | `/api/telemetry` | 센서·하드웨어 이벤트 (`bin_full_alert` 등) |
| POST | `/api/edge/heartbeat` | 카메라 노트북 상태 |
| GET | `/api/devices/status` | 카메라 노트북·장치 상태, 최근 만차 알림 |
| GET | `/api/bins`, `/api/health` (`/health`) | 칸 상태 / 서버 상태 |
| WS | `/ws`, `/ws/dashboard` | `{"type","event","data","sent_at"}` |

`metadata` 예: `{"detection_id":"<uuid>","device_id":"CAMERA_001","waste_type":"plastic","class_id":3,"confidence":0.91,"model_name":"best_model.pt","captured_at":"2026-10-31T11:00:00+09:00","bounding_box":{"x1":10,"y1":20,"x2":110,"y2":220},"hardware_status":"command_sent"}`

---

## (참고) 원래 설계 — 서버가 MQTT로 ESP32 서보를 구동 (`HARDWARE_MODE=SIMULATOR|ESP32_REAL`)

아래는 기존 프로젝트의 설계이며 코드에 그대로 남아 있다. 실제 해커톤 장비(서보가 Arduino에 연결)와 맞지 않아 시연에는 쓰지 않는다.


> 상태: PHASE 0 설계안 (2026-10-31). 구현 진행에 따라 갱신한다.
> 하드웨어 관련 항목은 **실물 미검증** 상태다.

## 1. 구성 요소

```
┌──────────────┐  MQTT (LAN, 인증)   ┌──────────────┐
│ ESP32        │ ──telemetry/status──▶│ Mosquitto    │
│ HC-SR04 x4   │ ◀──── command ────── │ (broker)     │
│ SG90 x4      │ ────── ack ────────▶ │              │
└──────────────┘                      └──────┬───────┘
   또는 Mock Simulator (Python)              │ MQTT
                                             ▼
                                ┌────────────────────────┐
                                │ FastAPI (단일 프로세스) │
                                │  mqtt/      수신·발행   │
                                │  services/  적재율 계산 │──▶ PostgreSQL
                                │             명령 상태   │
                                │  api/       REST        │
                                │  websocket/ 브로드캐스트│
                                └──────┬──────────┬──────┘
                                  REST │          │ WS /ws/dashboard
                              ┌────────▼───┐  ┌───▼────────┐
                              │ React 웹    │  │ Expo 앱     │
                              │ (모니터링)  │  │ (모니터링+제어)│
                              └────────────┘  └────────────┘

 (PHASE 7) 웹캠 → OpenCV → YOLO ──HTTP POST──▶ FastAPI
```

| 계층 | 책임 | 하지 않는 일 |
|---|---|---|
| ESP32 펌웨어 | 센서 순차 측정, 중앙값 필터, 원시 거리 + 센서 상태 발행, 명령 검증·실행·ACK | 적재율의 최종 판단, DB 접근 |
| Mosquitto | 메시지 중계, 인증/ACL, LWT | 비즈니스 로직 |
| FastAPI | **유일한 진실 공급원**: 적재율 계산, 상태 저장, 명령 생명주기, 권한 검증, 실시간 전파 | 하드웨어 직접 제어 |
| PostgreSQL | 현재 상태(devices, bins) + 이력(sensor_logs, device_commands, detection_logs) | — |
| 웹 / 앱 | 표시, 사용자 입력 | 적재율 계산, 상태 보관(캐시 외) |
| AI 모듈 | 분류 결과를 FastAPI로 전달 | ESP32/MQTT 직접 접근 |

## 2. 핵심 데이터 흐름

### 2.1 센서 데이터 (상향)
1. ESP32가 BIN_001→004 순서로 센서를 하나씩 측정 (센서당 N회, 측정 간 ≥60ms).
2. 유효 샘플의 중앙값 → `distance_cm`, 유효 샘플 부족 시 `sensor_status=error|timeout`, `distance_cm=null`.
3. `smartbin/DEVICE_001/telemetry` 발행 (QoS 1, retain 없음).
4. FastAPI가 Pydantic으로 검증 → 실패 시 로그 후 폐기.
5. `services/fill_level.py` 가 DB의 bin별 보정값으로 `fill_percent` 계산 (0~100 클램프).
6. 트랜잭션: `sensor_logs` INSERT + `bins` 현재값 UPDATE (오류 측정은 이력만 남기고, 현재 적재율은 덮어쓰지 않음, `sensor_status`만 갱신).
7. 커밋 이후 WebSocket으로 `bins.updated` 이벤트 브로드캐스트.

### 2.2 제어 명령 (하향)
1. 앱 → `POST /api/devices/{id}/commands` (API 토큰).
2. 서버 검증: target 화이트리스트, 장치 online 여부, 모드(AUTO/MANUAL) 충돌, 진행 중 명령 존재 여부, E-STOP 상태.
3. `device_commands`에 `PENDING` 저장 → MQTT `command` 발행 (QoS 1, **retain 금지**) → `SENT`.
4. ESP32: command_id 중복 확인 → 만료(`expires_at`) 확인 → 실행 → `ack` 발행.
5. 서버: ACK 수신 시 `SUCCEEDED|FAILED`, 제한시간 초과 시 `TIMEOUT`. 각 전이를 WebSocket으로 전파.
6. 앱은 ACK 기반 상태만 "실행 완료"로 표시.

### 2.3 클라이언트 동기화
- 최초 진입: `GET /api/dashboard` 로 전체 스냅샷.
- 이후: `/ws/dashboard` 이벤트로 증분 반영.
- 끊김: 지수 백오프 재연결 → 재연결 직후 REST 스냅샷 재조회 (누락 이벤트 보정).

## 3. PHASE 0 기술 검토 — 원 명세의 문제점과 결정 사항

| # | 문제 | 결정 |
|---|---|---|
| D1 | 명세는 ESP32가 `fill_percent`를 계산해 보내면서, 동시에 보정값을 서버 API(`PUT /calibration`)로 관리하고 "계산 로직 중복 금지"를 요구함 → 보정값 이중 관리, 불일치 발생 | **서버가 적재율을 계산**한다. ESP32는 원시 `distance_cm`과 `sensor_status`만 보낸다. telemetry의 `fill_percent`는 선택 필드이며 서버는 이를 신뢰하지 않는다. |
| D2 | ESP32에는 RTC가 없어 `timestamp`를 신뢰할 수 없음 | ESP32는 NTP 동기화 후에만 `timestamp`를 채운다. 서버는 `received_at`을 별도 저장하고, 장치 시각이 없거나 ±5분 이상 어긋나면 `received_at`을 측정 시각으로 사용한다. |
| D3 | 명령 메시지가 retain되거나 재연결 시 지연 전달되면 **오래된 명령으로 모터가 움직임** (안전 위반) | command 토픽은 retain 금지. 명령에 `expires_at` 포함, ESP32는 만료·시각 미동기화 명령을 거부. ESP32는 최근 command_id 링버퍼로 중복 실행 차단. |
| D4 | devices 테이블에 운전 모드 컬럼이 없음 | `devices.operating_mode (AUTO/MANUAL)`, `devices.estop_active` 추가. |
| D5 | "명령 권한 검증" 요구에 비해 인증 체계가 정의되지 않음 | 1단계: 환경변수 기반 정적 API 토큰(`Authorization: Bearer`). 추후 사용자 계정/JWT로 확장. |
| D6 | Mock 데이터와 실제 데이터 구분 수단 없음 | telemetry/status에 `source: "hardware" \| "simulator"` 필수. DB에 저장, UI에 `SIMULATED` 배지 표시. |
| D7 | 브로커를 "외부에 공개하지 않음" vs ESP32는 Wi-Fi로 접속해야 함 | 1883은 개발 PC의 LAN에만 노출, 익명 접속 금지(password_file + ACL). 인터넷 포트포워딩 금지. TLS(8883)는 후속 과제. |
| D8 | WebSocket 브로드캐스트는 프로세스 메모리 기반 → uvicorn 다중 워커 시 이벤트 누락 | 초기 버전은 **단일 워커** 고정. 확장 시 Redis pub/sub 도입 검토. |
| D9 | 명세의 `target`은 waste_type(plastic)인데 DB는 bin_id 중심 | 서버가 `target`(waste_type) → bin_id 매핑. 화이트리스트: plastic, can, paper, general. |
| D10 | 긴급정지 이후 복귀 절차 미정의 | E-STOP은 래치(latch)형. `RESET_ESTOP` 명령 전까지 모든 모터 명령 거부. |
| D11 | sensor_logs 무한 증가 | (bin_id, measured_at) 인덱스, 보존 정책은 PHASE 6에서 결정(예: 30일 원본 + 집계). |

## 4. 기술 위험 요소

### 하드웨어 (실물 미검증)
- **서보 전원 부족**: SG90 정지 토크 전류는 개당 수백 mA ~ 약 0.7A 수준으로 알려져 있어 4개 동시 구동 시 2A 이상이 될 수 있다. MB102의 5V 레귤레이터(일반적으로 AMS1117 계열, 최대 약 0.8A)로는 부족할 가능성이 높다. → 별도 5V 고전류 전원 + 벌크 커패시터, 그리고 **소프트웨어에서 서보 동시 구동 금지**(한 번에 1개).
- **HC-SR04 Echo 5V**: 전압 분배 필수 (HARDWARE_WIRING.md 참조).
- **부팅 시 서보 튐**: GPIO14 등 일부 핀은 부팅 중 신호가 출력될 수 있다. 실물 확인 필요.
- **측정 품질**: 초음파 빔 폭으로 인한 벽면 반사, 종이·비닐 등 흡음 재질, 최소 측정거리(약 2cm). 실제 통에서 보정 필요.
- **센서 간 간섭**: 순차 측정 + 간격으로 완화.

### 소프트웨어 / 환경
- ~~Docker 미설치~~ → Colima(무료)로 해결.
- ~~Python 3.15만 설치됨~~ → 백엔드는 Python 3.12로 고정 (Docker 이미지 + 로컬 venv).
- **모바일 실기기 접속**: 폰에서는 `localhost`가 동작하지 않음 → Mac의 LAN IP를 환경변수로 주입.
- **MQTT ↔ asyncio 통합**: 비동기 MQTT 클라이언트(aiomqtt) 사용, FastAPI lifespan에서 수명 관리.

## 5. AI 확장 지점
AI 모듈은 `ai/` 아래 독립 프로세스로 실행하고, 결과를 `POST /api/detections`(PHASE 7에서 추가)로 전송한다. 서버는 `detection_logs` 저장 후, **AUTO 모드일 때만** 동일한 명령 파이프라인(2.2)으로 명령을 생성한다.

> **PHASE 7 미해결 설계**: 현재 장치·서버는 AUTO 모드의 `OPEN_BIN`을 `MODE_CONFLICT`로 거부한다(수동 조작 차단 목적). 자동 분류를 연결할 때 명령에 `origin: "manual" | "auto"` 필드(또는 별도 `AUTO_SORT` 명령)를 추가해 "AUTO 모드에서는 auto 출처만 허용, MANUAL 모드에서는 manual만 허용"으로 바꾼다. 프로토콜 변경이므로 펌웨어·시뮬레이터·서버·문서를 함께 수정해야 한다.
