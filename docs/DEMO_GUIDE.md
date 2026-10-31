# 해커톤 시연 가이드

## 역할
| 기기 | 실행 | 역할 |
|---|---|---|
| 노트북 B (MacBook) | `./start_server.sh --mobile` | 중앙 서버(API·DB·이미지·WebSocket) + 관리자 웹 + Expo 개발 서버 |
| 노트북 A (카메라) | `SMART_RECYCLE_AI.exe` (또는 `python smart_recycle_ai.py`) | 카메라·YOLO·Arduino 시리얼·센서·서버 전송 |
| 스마트폰 | Expo Go → QR | 관리자 앱 |
| Arduino UNO + ESP32 | USB 2개 · 서보 전원 MB102 | UNO: 서보 3개·초음파 1개 (uno_controller) · ESP32: 중계(esp32_bridge) |

## 전날 준비 (한 번만)
1. 맥북: `git checkout feature/smart-recycle-integration`, `.env` 확인 (`HARDWARE_MODE=EDGE_SERIAL`, `POSTGRES_DB`, `AI_API_TOKEN`)
2. 맥북: 예전 `~/smart-recycling-system` 백엔드가 8000 포트를 쓰고 있으면 그 터미널에서 Ctrl+C (start_server.sh가 점유 여부를 알려 줌)
3. 카메라 노트북: `edge/README.md` 대로 설치 → `best_model.pt` 복사 → `check_system.py` 전 항목 확인 → `build_exe.bat`
4. Arduino IDE 로 UNO 에 **`firmware/uno_controller/uno_controller.ino`** 업로드 (ACK·거리 지원. 원본 trush.ino 도 동작은 하지만 성공 확인·적재율 불가), ESP32 에 `firmware/esp32_bridge/esp32_bridge.ino` 업로드 (Wi-Fi 전송을 쓰려면 `secrets.example.h` → `secrets.h`). 업로드 후 **시리얼 모니터 닫기**. 서보 3개는 MB102 5V, GND 공통, D3→GPIO16 분압 확인 (`HARDWARE_WIRING.md` 체크리스트)
4-1. 빈 통에서 초음파 거리 실측 → 카메라 프로그램 설정의 "빈 통 거리", 센서가 달린 칸 → "초음파 센서 칸"
5. 리허설: `docs/DEMO_END_TO_END_TEST.md` 표를 실제 장비로 채우기

## 당일 순서
1. **네트워크**: 세 기기 같은 Wi-Fi (불안하면 핫스팟). 맥북 IP 확인 `ipconfig getifaddr en0`
2. **맥북**: Docker Desktop(또는 colima) 실행 → `./start_server.sh --mobile` → 마지막 출력의 주소 메모
3. **웹**: 맥북 브라우저 `http://localhost:5173` (프로젝터) — 상단 "실시간 연결됨" 확인
4. **폰**: Expo Go로 QR 스캔 → 홈 탭 "실시간 인식" 확인
5. **카메라 노트북**: Wi-Fi 연결 → Arduino USB 연결 → `.env` 의 `BACKEND_URL` 이 맥북 IP인지 확인 → `SMART_RECYCLE_AI.exe`
   - 연결 상태(모델·추론·카메라·UNO·서보×3·HC-SR04·ESP32·서버)가 초록인지 확인. 빨간 항목은 옆에 원인 표시
   - 웹 개요 "카메라 노트북 · 센서" 에 `CAMERA_001 온라인`, 하드웨어 시리얼 초록
6. **시연**: 쓰레기 1개를 카메라 앞에 0.5초 이상 → GUI에 종류·신뢰도·ID·하드웨어 결과 → 서보 동작 → 웹·폰 "실시간 인식" 에 같은 이미지·같은 ID
7. 다음 물체는 이전 물체가 화면에서 빠지고 서보가 원위치(약 6초) 된 뒤에

## 말할 때 주의 (정직하게)
- uno_controller 펌웨어면 서보 순서가 끝난 뒤 `ACK:DONE` 을 받아 "**분류 성공 (장치 ACK 확인)**" 으로 바뀐다 (약 6초 뒤). 원본 trush.ino 면 응답이 없어 "명령 전송됨 · 동작 확인 불가" 로 남는다.
- ACK 는 "펌웨어가 서보 동작 순서를 끝냈다"는 뜻이지, 쓰레기가 칸에 떨어졌는지를 센서로 확인한 것은 아니다.
- 적재율은 센서가 달린 1칸만 실데이터, 나머지 3칸은 "수신 없음".

## 트러블슈팅 빠른 표
| 증상 | 조치 |
|---|---|
| GUI "카메라를 열 수 없음" | 다른 앱(Zoom 등) 종료, `.env` `CAMERA_INDEX` 1/2로, `check_system.py --cameras` |
| GUI 하드웨어 빨강 "후보가 여러 개" | `.env` `HW_SERIAL_PORT=COM5` 처럼 지정 (장치 관리자 › 포트) |
| 하드웨어 "열기 실패: Access denied" | Arduino IDE 시리얼 모니터/다른 프로그램 종료 → GUI "연결 재확인" |
| 서버 빨강 | 맥북 IP 변경 → `.env` 수정 후 재실행. 그동안 분류는 outbox에 저장 → 복구 시 자동 전송 |
| 같은 물체가 두 번 분류 | `.env` `CLEAR_SEC`↑ / `STABLE_FRAMES`↑ |
| 반응이 느림 | `STABLE_FRAMES=3`, 조명 개선, CPU 노트북이면 정상 (fps 표시 확인) |
| 웹은 오는데 폰이 안 옴 | 폰 Wi-Fi/주소 확인, 앱 아래로 당겨 새로고침 |
| 전부 안 될 때 백업 시연 | 맥북에서 `python edge/check_system.py --upload-test 사진.jpg` (실제 사진·실제 추론으로 1건 전송) |
