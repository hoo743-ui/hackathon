# 통합 감사 (INTEGRATION AUDIT) — 2026-10-31

해커톤 저장소(`hackathon`)의 입력 파일 3개와 맥북의 기존 프로젝트(`~/smart-recycling-system`)를 **코드를 직접 읽고** 분석한 결과다.

## 1. 조사 대상과 실제 상태

| 대상 | 위치 | 상태 |
|---|---|---|
| `yolo_arduino.py` | 저장소 루트 | 존재. OpenCV + Ultralytics + pyserial, `COM4` 하드코딩 (Windows 가정) |
| `trush.ino` | 저장소 루트 | 존재. **Arduino UNO** 펌웨어 (`Servo.h`, `SoftwareSerial`) |
| `esp32.ino` | 저장소 루트 | 존재. ESP32 Wi-Fi HTTP 브리지 (SSID·서버 주소 자리표시자) |
| `best_model.pt` | — | **없음.** 저장소·맥북 홈 디렉터리 어디에도 없다 → 카메라 노트북에서 직접 넣어야 함 |
| 기존 통합 프로젝트 | `~/smart-recycling-system` (Git 커밋 0개, 원격 없음) | FastAPI + PostgreSQL + Mosquitto(MQTT) + React 웹 + Expo 앱 + ESP32(PlatformIO) 펌웨어. 맥북 8000 포트에서 실행 중이었음 |

→ 기존 프로젝트를 이 저장소로 가져와(`feature/smart-recycle-integration`) 재사용했다. 원래 폴더는 건드리지 않았다.

## 2. 입력 코드가 실제로 하는 일 (코드 기준)

### yolo_arduino.py
- `VideoCapture(0)` → `YOLO("best_model.pt")` → `model(frame, conf=0.5, classes=[0,1,2,3])`
- `boxes[0]`(최고 신뢰도) 클래스 → `{0:'G', 1:'M', 2:'P', 3:'L'}` → 시리얼 1바이트 전송, 2초 cooldown
- 이어서 `"C:{signal}:{count}\n"` 카운트 메시지 전송, `r` 키에 `"C:RESET\n"` 전송
- 시리얼 연결이 없으면 카운트·전송을 모두 건너뜀

### trush.ino (Arduino UNO)
- `Serial`(USB, 9600)에서 **한 글자씩** 읽어 `G/M/P/L` → `processDrop(각도)` : X서보 회전 → 4000ms → Y1/Y2 기울임 → 2000ms → 복귀 (약 6.1초 블로킹)
- 서보: X=D9, Y1=D10, Y2=D11 / 초음파 1개: TRIG=D4, ECHO=D5
- 3초마다 거리 측정, 5cm 이내면 `espSerial.println("FULL:TRASH")`(D3 TX → ESP32)와 `Serial.println("[ALERT] 쓰레기통 만차 감지!")`(USB → PC)
- 명령에 대한 **ACK/응답 없음**

### esp32.ino (ESP32 DevKitC)
- `Serial2.begin(9600, SERIAL_8N1, 16, 17)` — 주석: "아두이노 D3(TX) → ESP32 RX2(16)"
- `"DATA:"`로 시작하는 줄만 처리 → JSON `{"raw_data": ...}` 를 `serverName`에 POST
- **USB `Serial`로 명령을 받지 않는다.** 서보·센서 제어 없음

## 3. 발견한 문제 (중요도 순)

| # | 문제 | 영향 | 조치 |
|---|---|---|---|
| 1 | **ESP32가 아니라 Arduino UNO가 USB 시리얼 명령을 받는다.** 요구사항의 "ESP32 USB로 하드웨어 제어"와 코드가 다름 | 시리얼 포트를 ESP32로 잡으면 모터가 절대 움직이지 않음 | 카메라 노트북은 **Arduino UNO USB 포트**로 `G/M/P/L` 전송. ESP32 USB는 선택적 읽기 전용 로그 모니터 |
| 2 | `"C:L:3\n"` 카운트 메시지의 `L`·`G`·`M`·`P` 글자를 `trush.ino`가 다시 명령으로 읽음 (예: `C:G:1` → 유리 동작 1회 추가) | 투입 1회에 모터 2회 동작 | 새 클라이언트는 **명령 1글자만** 전송 (`C:` 메시지 제거). 펌웨어는 수정하지 않음 |
| 3 | Arduino는 `FULL:TRASH`를 보내는데 ESP32는 `DATA:`만 처리 | ESP32 → 서버 센서 경로가 현재 동작하지 않음 | 같은 정보가 Arduino USB(`[ALERT]`)로도 나오므로 카메라 노트북이 읽어 `/api/telemetry`로 전송 |
| 4 | Arduino D3 TX(5V) → ESP32 GPIO16(3.3V) 직결 주석 | ESP32 GPIO 손상 위험 | 분압(1kΩ/2kΩ) 또는 레벨 시프터 필수 — `HARDWARE_WIRING.md` |
| 5 | 초음파 센서 **1개**, 거리값을 보내지 않고 5cm 임계 알림만 | 4칸 적재율(%)을 실제로 계산할 근거 없음 | 4칸 적재율은 `unavailable`(null)로 표시. 만차 알림만 실데이터로 표시. 값을 만들어내지 않음 |
| 6 | 기존 프로젝트의 분류 체계 `plastic/can/paper/general` ≠ 모델·하드웨어 `Glass/Metal/Paper/Plastic` | 유리가 "인식 불가"로 기록됨 | `can→metal`, `general→glass` 로 전 계층 변경 + Alembic 마이그레이션 |
| 7 | 기존 백엔드는 서버가 MQTT로 ESP32 서보를 구동하는 설계 | 실제 장비와 맞지 않음 (서보는 Arduino에 있고 PC가 직접 구동) | 새 `HARDWARE_MODE=EDGE_SERIAL`: 서버는 명령을 보내지 않고 카메라 노트북의 보고만 기록 |
| 8 | 기존 `POST /api/detections`는 JSON만, 이미지 저장 없음 | 이미지 시연 불가 | multipart(metadata + image) 지원, 파일 저장, 이미지 조회 API |
| 9 | `best_model.pt` 없음 | 실제 클래스 검증 불가 | 실행 시 모델 `names`를 기존 ID 매핑과 대조, 불일치 시 경고 후 이름 기준 매핑 |
| 10 | `COM4` 하드코딩 | 다른 PC/OS에서 실패 | `HW_SERIAL_PORT` 설정 + VID 기반 자동 탐색(후보 1개일 때만) |

## 4. REUSE / MODIFY / ADD / REMOVE

### REUSE (그대로)
- 기존 백엔드 구조 전체: 명령 파이프라인·MQTT·HAL·이력·통계·점검 기록 API, PostgreSQL + Alembic, WebSocket 매니저, Docker Compose(PostgreSQL·Mosquitto)
- `shared/src` 재연결 WebSocket 클라이언트(지수 백오프 + 재연결 시 REST 재동기화), 리듀서(id 기준 병합 → 중복 이벤트 방지)
- 관리자 웹(React+Vite) 5메뉴, 관리자 앱(Expo+expo-router) 4탭
- `trush.ino`, `esp32.ino` — **수정하지 않음** (프로토콜 유지)
- `yolo_arduino.py` — 참조용으로 그대로 둠

### MODIFY
| 파일 | 변경 |
|---|---|
| `backend/app/core/enums.py` 외 전 계층 | 분류 `can→metal`, `general→glass`; `DetectionOutcome.SORT_SENT/NO_HARDWARE`; `HardwareStatus` |
| `backend/app/core/config.py` | `EDGE_SERIAL` 모드, `UPLOAD_DIR`, `MAX_IMAGE_BYTES`, `EDGE_BIN_DEVICE_ID`, `CORS_ORIGIN_REGEX` |
| `backend/app/api/routes.py` | `POST /api/detections` JSON + multipart, `/api/health` 별칭, 대시보드에 `edges`·`latest_full_alert` |
| `backend/app/services/detection_service.py` | EDGE 분기(명령 없이 보고값 기록), 신규 시 `new_detection` 이벤트 |
| `backend/app/websocket/*` | `/ws` 별칭, 메시지에 `event` 키 추가 (`type` 유지) |
| `backend/app/models/detection_log.py` | `camera_id, class_id, bounding_box, image_path, hardware_status` |
| `shared/src/types.ts·state.ts·labels.ts·health.ts` | 새 필드·이벤트·라벨·이미지 URL 헬퍼 |
| `frontend/web/src/config.ts` | API 주소 미설정 시 **웹을 연 호스트**로 자동 (localhost 하드코딩 제거) |
| 웹 `OverviewPage`, `SortingPage` | 실시간 인식(이미지) 패널, 카메라 노트북 상태, 이력 썸네일 |
| 앱 `(tabs)/index.tsx` | 실시간 인식 카드, 카메라 노트북 상태, 만차 알림 |
| 테스트 | 분류 체계 변경 반영 |

### ADD
| 파일 | 내용 |
|---|---|
| `backend/alembic/versions/…e1d9e0a7c001…` | 컬럼·`edge_telemetry` 테이블·분류값 변환 |
| `backend/app/api/edge_ingest.py`, `edge_routes.py` | multipart 수신, 상세/이미지/telemetry/heartbeat/devices status |
| `backend/app/services/image_store.py`, `edge_service.py`, `models/edge_telemetry.py` | 이미지 파일 저장(원자적), 카메라 노트북 상태·센서 이벤트 |
| `backend/tests/test_edge.py` | 13개 통합 시험 |
| `edge/` | 카메라 노트북 프로그램: `smart_recycle_ai.py`(GUI) · `start_camera_system.py`(CLI) · `check_system.py` · `smartrecycle_edge/` · 빌드 스크립트 · 시험 |
| `start_server.sh`, `stop_server.sh`, `config/env/edge-serial.env`, `scripts/ws_consistency_check.py` | 맥북 실행·검증 |
| 문서 | 이 문서, `NETWORK_SETUP`, `DEMO_GUIDE`, `DEMO_END_TO_END_TEST`, `edge/README` |

### REMOVE
- 없음. (`firmware/esp32/` PlatformIO MQTT 펌웨어는 실제 배선과 맞지 않아 **이번 시연에 사용하지 않지만** 삭제하지 않음)

## 5. 2차 반영 — 확정 하드웨어 (UNO ×1 · ESP32 ×1 · HC-SR04 ×1 · SG90 ×3)
| 요구 | 기존 상태 | 조치 |
|---|---|---|
| 서보 3개 | trush.ino 가 이미 3개(X D9·Y1 D10·Y2 D11) | 그대로. 4클래스 = X 의 4개 각도 (`HARDWARE_WIRING.md` 1절) |
| 초음파 1개로 적재율 | trush.ino 는 5cm 임계 알림만, 거리값 없음 | **ADD** `firmware/uno_controller` — 같은 핀·각도·시간 + `DIST:<cm>` + ACK + 비상정지 (원본 유지) |
| 실제 응답이 있을 때만 성공 | trush.ino 는 응답 없음 | `ACK:<c>:DONE` → `completed` → 서버 `SORTED`. 구 펌웨어는 끝까지 "미확인" |
| ESP32 활용 | esp32.ino 는 `DATA:` 만 처리(실제로는 아무것도 안 보냄) | **ADD** `firmware/esp32_bridge` — UNO 줄 중계(USB) + (선택) Wi-Fi 로 거리 전송. 명령은 받지 않음 |
| SENSOR_DISCONNECTED | 없음 | 카메라 PC 5초 무응답 → `disconnected`, 서버 `SensorStatus.DISCONNECTED` |
| 기존 4센서·4서보 설정 | `firmware/esp32/` (MQTT 설계) | 시연에 **사용하지 않음** 명시. 삭제하지 않음. 서버 4칸은 4클래스 칸으로 유지, 센서 없는 3칸은 "수신 없음" |
| Windows 배포 | — | 설정 화면(서버 IP·COM·카메라·모델), 첫 실행 검사, 로그 파일, `WINDOWS_DEPLOY.md` |
| 추론 전용 | 기존도 학습 없음 | 모델 경로 우선순위, 손상 검사, CPU/GPU 자동·폴백, IMG_SIZE, GUI "INFERENCE ONLY" |
