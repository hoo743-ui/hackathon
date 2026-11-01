# SMART RECYCLE

AI 카메라로 쓰레기(유리·금속·종이·플라스틱)를 분류해 서보로 해당 칸에 넣고, 결과·이미지를 관리자 웹과 모바일 앱에 실시간으로 보여 주는 스마트 분리수거 시스템.

## 해커톤 시연 구성 (EDGE_SERIAL)
```
[노트북 A 카메라] SMART_RECYCLE_AI ─USB 시리얼─▶ Arduino UNO(trush.ino) ─▶ 서보 3 · 초음파 1
        │ 이미지+결과(HTTP multipart) · 센서 이벤트 · heartbeat
        ▼
[노트북 B MacBook] FastAPI + PostgreSQL + 이미지 저장 + WebSocket ─▶ 관리자 웹 · 관리자 앱(Expo)
```

| 어디서 | 무엇을 | 명령 |
|---|---|---|
| MacBook | 서버 + 웹 (+ 앱 개발 서버) | `./start_server.sh` (앱까지: `./start_server.sh --mobile`) · 종료 `./stop_server.sh` |
| 카메라 노트북 | 카메라·YOLO·하드웨어·전송 (단일 프로그램) | **`edge\START_SMART_RECYCLE.bat`** (git pull → 설치 확인 → 실행, 팀 설정은 `edge/settings.env` 로 자동 적용) · EXE: `edge\build_exe.bat` · 점검 `python edge/check_system.py` |
| 스마트폰 | 관리자 앱 | Expo Go 로 맥북 터미널의 QR 스캔 |

문서: [PRESENTATION](docs/PRESENTATION.md) · [DEMO_GUIDE](docs/DEMO_GUIDE.md) · [FIRMWARE_UPLOAD](docs/FIRMWARE_UPLOAD.md) · [NETWORK_SETUP](docs/NETWORK_SETUP.md) · [HARDWARE_WIRING](docs/HARDWARE_WIRING.md) · [ARCHITECTURE](docs/ARCHITECTURE.md) · [INTEGRATION_AUDIT](docs/INTEGRATION_AUDIT.md) · [DEMO_END_TO_END_TEST](docs/DEMO_END_TO_END_TEST.md) · [edge/README](edge/README.md)

원본 입력 코드 `yolo_arduino.py`, `trush.ino`, `esp32.ino` 는 저장소 루트에 그대로 있다. `best_model.pt` 는 Git에 없으므로 카메라 노트북의 `edge/models/` 에 직접 넣는다.

---

## (기존 프로젝트 설명)

공공장소용 스마트 분리수거 시스템 (단일 장치 · 4칸 MVP).
투입된 쓰레기를 AI가 분류하면 서보가 해당 칸으로 보내고, 관리자는 웹과 모바일 앱에서 상태를 확인·제어한다.
전부 무료·오픈소스, 인터넷 없이 같은 LAN에서 동작.

```
투입 → (AI 노트북) 촬영·분류 ─POST /api/detections─▶ FastAPI ─MQTT(origin=auto)─▶ ESP32/시뮬레이터 → 서보
                                                         ▲            ◀── ACK · 적재 측정 ──┘
                                                 PostgreSQL · WebSocket ──▶ 관리자 웹 · 관리자 앱
```

## 빠른 시작
```bash
scripts/setup.sh                         # 최초 1회 (.env 무작위 비밀번호, 의존성)
scripts/infra-up.sh && scripts/backend.sh  # PostgreSQL·Mosquitto + API (내장 가상 장치 포함)
scripts/web.sh                           # 관리자 웹  → http://localhost:5173
scripts/mobile.sh                        # 관리자 앱  → 휴대폰 Expo Go로 QR 스캔
scripts/simulate-detection.sh            # (선택) AI 노트북 없이 가상 분류
```
사용법: **[docs/USER_GUIDE.md](docs/USER_GUIDE.md)** · AI 연동: **[docs/AI_INTEGRATION.md](docs/AI_INTEGRATION.md)** · 실기 연결: **[docs/HARDWARE_INTEGRATION.md](docs/HARDWARE_INTEGRATION.md)**

## 메뉴
| 관리자 웹 (5) | 관리자 앱 (4 탭) |
|---|---|
| 개요 · 수거함 · 분류 기록 · 장치 · 운영 | 홈 · 수거함 · 알림 · 제어 (+ 홈 ⚙ 설정) |

## 상태
| 영역 | 상태 |
|---|---|
| 백엔드·DB·MQTT·WebSocket·HAL(`HARDWARE_MODE`) | ✅ [SIM] 검증 |
| AI 분류 수신 → 자동 배출 → ACK | ✅ [SIM] 검증 (가상 분류) · 실제 모델 연결 **NOT TESTED** |
| 관리자 웹 / 앱 | ✅ [SIM] 검증 · 앱 실기기 실행은 사용자 확인 필요 |
| ESP32 펌웨어 | 빌드만 ✅ · 실물 **NOT TESTED** (핀맵 미확정 시 서보 잠금) |
| MQTT TLS | 브로커·백엔드 ✅ · 펌웨어 미구현 |

`[SIM]` = 시뮬레이터 검증. 실제 하드웨어 검증이 아니다. 상세: [docs/TEST_REPORT.md](docs/TEST_REPORT.md)

## 디렉터리
```
backend/app/        api · core · models · schemas · services · mqtt · websocket · hardware(HAL) · database
shared/src/         웹·앱 공용 TS: 타입 · API · 실시간 · 상태 · 알림 · 라벨
frontend/web/       관리자 웹 (React · Vite)
mobile/app/         관리자 앱 (Expo · expo-router)
firmware/esp32/     ESP32 펌웨어 (PlatformIO) — include/config.h 핀·각도
scripts/            setup · infra-up/down · backend · web · mobile · simulate(-detection) · test · e2e · env-profile · …
config/env/         환경 프로필 local · simulator · esp32-real · production
infrastructure/     docker-compose · mosquitto (인증·ACL·TLS)
docs/               문서 · mqtt-schemas · openapi.json
```

## 문서
| 문서 | 내용 |
|---|---|
| [USER_GUIDE](docs/USER_GUIDE.md) | 설치·실행·화면 사용·문제 해결 |
| [AI_INTEGRATION](docs/AI_INTEGRATION.md) | 다른 노트북 AI 코드 연동 (HTTP 1회) |
| [HARDWARE_INTEGRATION](docs/HARDWARE_INTEGRATION.md) · [HARDWARE_WIRING](docs/HARDWARE_WIRING.md) | 실기 연결 절차 · 배선·전원 |
| [MQTT_PROTOCOL](docs/MQTT_PROTOCOL.md) · [API_CONTRACT](docs/API_CONTRACT.md) · [DATABASE_SCHEMA](docs/DATABASE_SCHEMA.md) | 통신·API·DB 계약 |
| [DEPLOYMENT](docs/DEPLOYMENT.md) | 환경 프로필·TLS·운영 배포·APK |
| [TEST_REPORT](docs/TEST_REPORT.md) · [TEST_PLAN](docs/TEST_PLAN.md) | 테스트 결과·계획 |
| [ARCHITECTURE](docs/ARCHITECTURE.md) · [PRESENTATION_ARCHITECTURE](docs/PRESENTATION_ARCHITECTURE.md) | 구조·설계 결정 · 발표용 요약 |
| [design/](docs/design/) | 디자인 감사·시스템(Material Ledger)·서비스 구조 v2 |
| [CODE_REVIEW](docs/CODE_REVIEW.md) · [AI_WORKFLOW](docs/AI_WORKFLOW.md) | 코드 리뷰 · Claude 활용·라이선스 |
