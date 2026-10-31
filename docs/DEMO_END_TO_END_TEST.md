# 최종 시연 End-to-End 시험 기록

- 기록일: 2026-10-31 (해커톤 전날)
- 표기: **PASS** 실제 실행 성공 · **FAIL** 실패 · **NOT TESTED** 장비/다른 컴퓨터가 없어 실행하지 못함 · **SKIPPED** 이유 있는 생략
- **[SIM]** = 실제 보드 대신 pty 가짜 `uno_controller`(edge/tests/fake_uno.py)로 실행한 시험. 프로토콜·스레드·서버 경로만 확인하며 **하드웨어 시험이 아니다.**
- **[SUBST]** = 실제 `best_model.pt` 대신 공개 COCO 모델(`yolov8n.pt`)·Ultralytics 예제 사진(bus.jpg, zidane.jpg)으로 돌린 시험. 추론은 실제로 수행했지만 **쓰레기 분류 시험이 아니다.**

## 1. 시험 환경 (이 기록을 만든 환경)
| 항목 | 값 |
|---|---|
| 맥북 (노트북 B) | MacBook Air, macOS 27.2, arm64, Wi-Fi IP 172.16.236.252, 방화벽 비활성 |
| 서버 | FastAPI(Python 3.12) + PostgreSQL 16 + Mosquitto (Docker), `HARDWARE_MODE=EDGE_SERIAL`, DB `smartbin_demo` |
| 시험용 서버 포트 | **8001** — 8000 포트를 예전 `~/smart-recycling-system` 백엔드가 사용 중이었고 그 프로세스를 종료할 권한이 없어 별도 포트로 시험 |
| 카메라 클라이언트 | 같은 맥북에서 `edge/` 를 실행 (Python 3.12 venv, ultralytics 8.4, torch 2.15 CPU/MPS) — LAN IP로 접속 |
| 카메라 노트북 A · Arduino · ESP32 · 스마트폰 | **이 시험에는 없음** |

## 2. 결과 요약
| 시험 | 합격 기준 | 결과 | 근거 |
|---|---|---|---|
| 백엔드 단위·통합 시험 | 전부 통과 | **PASS** | `pytest` 92 passed (신규 `test_edge.py` 13건 포함: multipart 저장, 이미지 조회, 멱등 재전송, 잘못된 이미지 415/413/422, 인증 401, 하드웨어 결과 매핑, MQTT 명령 미발행, telemetry, heartbeat, `/api/devices/status`, `/api/health`, `/ws`) |
| 웹 시험 | 전부 통과 | **PASS** | `vitest` 67 passed, `tsc` OK |
| 앱 시험 | 전부 통과 | **PASS** | `jest` 54 passed, `tsc` OK |
| 카메라 클라이언트 단위 시험 | 전부 통과 | **PASS** | `pytest edge/tests` 9 passed (투입 1회=1건, 깜빡임 무시, cooldown, 모터 동작 중 차단, 시리얼 1바이트만 전송 — `loop://` 가상 포트) |
| 서버 실행·LAN 접속 | 맥북 LAN IP로 health | **PASS** | `http://172.16.236.252:8001/api/health` → `status ok, EDGE_SERIAL` |
| 마이그레이션 | 새 컬럼·분류값 변환 | **PASS** | `alembic upgrade head` (smartbin_test, smartbin_demo) |
| EXE/패키지 실행 | 프로그램 시작 | **PASS (macOS 빌드)** / **NOT TESTED (Windows .exe)** | macOS PyInstaller 빌드 `dist/SMART_RECYCLE_AI` 실행 → 모델 로드·추론·전송 성공 [SUBST]. 첫 빌드는 `torchvision::nms` 누락으로 추론 실패 → `--collect-all torchvision` 추가 후 해결. Windows .exe 는 Windows에서만 빌드 가능 |
| GUI | 상태·영상·분류 표시 | **PASS (기능)** | GUI 실행 중 추론·전송 로그 확인 [SUBST]. 화면 모양은 사람이 직접 확인하지 않음 |
| 카메라 | 실시간 영상 | **NOT TESTED** | 맥북 내장 카메라는 터미널에 카메라 권한이 없어 열리지 않음 (카메라 노트북에서 시험 필요) |
| YOLO (best_model.pt) | 실제 쓰레기 인식 | **NOT TESTED** | 모델 파일이 이 저장소·맥북에 없음 |
| 분류 매핑 | 모델 names = Glass/Metal/Paper/Plastic | **NOT TESTED** | 실행 시 자동 대조 로직은 구현·[SUBST]로 경고 동작 확인 |
| 이미지 전송·저장 | 파일+DB, 같은 ID | **PASS [SUBST]** | multipart 전송 → `backend/data/images/YYYYMMDD/<id>.jpg` 저장 → `GET …/image` 200 |
| 서버 장애 → 재전송 | 중복 없이 복구 | **PASS [SUBST]** | 없는 포트로 2회 실패 → `edge/outbox/` 저장 → 정상 서버로 재실행 시 heartbeat 성공 후 자동 재전송 (DB에 1건씩) |
| 웹 실시간 표시 | 이미지·종류·신뢰도·시각·ID | **PASS [SUBST]** | 스크린샷 1440px/390px — 실시간 인식 패널, 카메라 노트북 상태, 최근 이미지 띠, 가로 넘침·콘솔 오류 없음 |
| 앱 화면 | 같은 결과 | **PASS (Expo 웹 렌더링)** / **NOT TESTED (실기기)** | 같은 앱 코드를 `expo start --web` 으로 390px 렌더링 → 같은 이미지·ID 표시. 실제 스마트폰 Expo Go 는 시험하지 못함 |
| 웹·앱 이벤트 일치 | 같은 detection_id | **PASS [SUBST]** | `scripts/ws_consistency_check.py`: `/ws/dashboard`(웹) · `/ws`(앱) 두 연결 모두 2건 수신, 종류·신뢰도·이미지 URL 일치, DB·이미지 200 |
| ESP32 통신 | 실제 통신 | **NOT TESTED** | 장비 없음. 코드 분석상 ESP32는 명령을 받지 않음 (`INTEGRATION_AUDIT.md`) |
| Arduino 시리얼·서보 | 실제 동작 | **NOT TESTED** | 장비 없음 |
| 센서 | 실제 측정값 수신 | **NOT TESTED** | 장비 없음. 서버 telemetry 경로는 시험 통과 |
| 백엔드 재시작 → WS 재연결 | 자동 재연결·재동기화 | **NOT TESTED (실기)** | 기존 `RealtimeClient` 지수 백오프 + 재연결 시 스냅샷 재조회 로직은 기존 단위 시험 범위 |
| 실제 투입 횟수 = 서버 기록 | 일치 | **NOT TESTED** | 판정 로직 단위 시험만 통과 |

## 2-1. 2차 (확정 하드웨어: UNO·ESP32·HC-SR04 ×1·SG90 ×3, Windows 배포, 추론 전용)
| 시험 | 결과 | 근거 |
|---|---|---|
| 백엔드 시험 | **PASS** | 95 passed (+ ACK 결과 갱신, 거리→적재율 50.0%, 끊김 시 마지막 정상값 유지, 범위 밖 out_of_range, 빈통 거리 없으면 미계산) |
| 카메라 클라이언트 시험 | **PASS [SIM]** | 14 passed: ACK DONE 일 때만 `completed`, START/DONE 없으면 `ack_timeout`, 구 펌웨어는 성공으로 안 바뀜, 동작 중 추가 명령 차단, 비상정지 `aborted`, 중앙값 필터·error·SENSOR_DISCONNECTED |
| 웹 / 앱 시험 | **PASS** | vitest 67 · jest 54 · tsc OK |
| 거리→서버 적재율 E2E | **PASS [SIM][SUBST]** | 가짜 UNO `DIST:15.0` · 빈통 30cm → 서버 BIN_001 `15.0cm / 50.0% / normal`; DIST 중단 5초 → `disconnected` |
| UNO 펌웨어 판별 | **PASS [SIM]** | `?` → `HELLO:UNO_CTRL:1` → "uno_controller (ACK·거리 지원)" |
| GUI 실행 | **PASS (macOS) [SIM][SUBST]** | 새 상태 줄(모델·INFERENCE ONLY·장치·FPS·UNO·서보×3·HC-SR04·ESP32·서버) 표시 중 예외 없음 |
| esp32_bridge 컴파일 | **PASS** | PlatformIO `esp32dev` 빌드 성공 (Flash 84%) |
| uno_controller 컴파일 | **NOT TESTED** | 이 맥에서 AVR 툴체인 실행 불가(Error 126). Arduino API 스텁으로 문법·타입 검사만 PASS → 카메라 PC 의 Arduino IDE 에서 업로드 시 확인 |
| 실제 서보 3개 / HC-SR04 / ESP32 UART | **NOT TESTED** | 장비 없음 |
| Windows EXE 빌드·실행 | **NOT TESTED** | Windows 기기 없음 (macOS 빌드는 PASS) |
| best_model.pt 클래스 확인 | **NOT TESTED** | 모델 파일 없음 |

## 3. 실패·수정한 항목
| 항목 | 원인 | 해결 |
|---|---|---|
| 기존 시험 5건 실패 | `glass`를 "4종 외 값" 예시로 쓰던 시험, 계약 파일 | 시험을 `battery`로, `scripts/export_contracts.sh` 재생성 |
| Alembic 다중 head | 새 리비전의 부모를 잘못 지정 | `down_revision=bbe2ecfec0d9` |
| `request.form(max_part_size)` 오류 | 설치된 Starlette 버전 미지원 인자 | 인자 제거 (크기는 읽은 뒤 검사) |
| EXE 추론 실패 `torchvision::nms does not exist` | PyInstaller가 torchvision C++ 연산 미수집 | 빌드에 `--collect-all torchvision`, 추론 오류 반복 시 1초 대기·상태 표시 |
| 기존 MQTT 시험 13건 실패 | 루트 `.env` 를 EDGE_SERIAL 로 바꾼 뒤 시험이 그 값을 읽음 | `conftest.py` 에서 시험 모드를 SIMULATOR 로 고정 |
| 가짜 장치 시험 종료 시 멈춤 | pty fd 를 읽는 스레드가 막힌 상태에서 close | `select` 루프로 변경 |
| Homebrew Python에 tkinter 없음 | python-tk 미설치 | `brew install python-tk@3.12` (Windows python.org 설치본은 기본 포함) |

## 4. 남은 위험
1. **best_model.pt 의 클래스 순서/이름 미확인** — 첫 실행 로그의 "클래스 매핑" 줄을 반드시 확인.
2. **ACK 의 의미** — uno_controller 의 `ACK:DONE` 은 "서보 동작 순서 완료"이지 투하 성공 센서 확인이 아니다. 원본 trush.ino 를 쓰면 성공 확인 자체가 불가.
2-1. **uno_controller 미컴파일** — 현장에서 Arduino IDE 업로드가 실패하면 원본 trush.ino 로 대체 (적재율·성공 확인 불가 상태로 시연).
3. **8000 포트 충돌** — 맥북의 예전 백엔드를 끄지 않으면 `start_server.sh` 가 중단된다.
4. **Wi-Fi 클라이언트 격리** — 행사장 Wi-Fi면 기기 간 통신이 막힐 수 있음 → 핫스팟 준비.
5. **D3→GPIO16 5V 직결 가능성** — ESP32 손상 위험. 분압 확인 전에는 ESP32 RX 선을 빼 둔다 (시연에 ESP32 경로는 필요 없음).
6. **Windows EXE 미빌드** — 카메라 노트북에서 `build_exe.bat` 이 실패하면 `run_ai.bat`(파이썬 직접 실행)로 시연.
7. CPU 노트북에서 YOLO fps가 낮으면 안정 판정(4프레임)이 늦어짐 → `STABLE_FRAMES` 조정.

## 5. 현장 리허설 체크 (실제 장비로 채울 것)
| # | 항목 | 결과 | 비고 |
|---|---|---|---|
| 0 | UNO 에 uno_controller 업로드 → 시리얼 모니터 `HELLO:UNO_CTRL:1`·`DIST:` → 모니터 닫기 | | |
| 0-1 | 서보 혼 떼고 `L/M/P/G` 각 1회 → X 각도가 실제 칸과 일치, `ACK:…:DONE` | | |
| 1 | `SMART_RECYCLE_AI.exe` 실행 · 상태 줄 모두 초록 · 추론 장치 표시 | | |
| 2 | 카메라 영상 | | |
| 3 | 플라스틱/금속/종이/유리 각 1개 → 올바른 클래스 | | |
| 4 | 각 투입 1회당 서보 1회 · 올바른 칸 | | |
| 5 | 투입 4회 → 서버 이력 정확히 4건 | | |
| 6 | 웹·폰에 같은 Detection ID · 같은 이미지 | | `ws_consistency_check.py` |
| 7 | 손으로 센서 가리기 → GUI 거리·적재율 변화 → 웹·앱 해당 칸 적재율 반영 | | |
| 7-1 | HC-SR04 선 뽑기 → 5초 내 SENSOR_DISCONNECTED (GUI·웹) | | |
| 7-2 | 동작 중 비상 정지 → 서보 대기 자세, 해당 분류 "중단" | | |
| 8 | 카메라 노트북 Wi-Fi 끊기 → 투입 → 다시 연결 → 자동 재전송, 중복 없음 | | |
| 9 | Arduino USB 뽑기 → GUI 빨강, 모터 명령 없음 → 다시 꽂고 "연결 재확인" | | |
| 10 | 맥북 백엔드 재시작 → 웹·앱 자동 재연결 | | |
