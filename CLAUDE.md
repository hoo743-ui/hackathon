# CLAUDE.md — 작업 컨텍스트 (토큰 절약용 요약)

공공장소 스마트 분리수거 (단일 장치·4칸): ESP32/가상장치 ↔ MQTT ↔ FastAPI ← AI 노트북(POST /api/detections). PostgreSQL → REST + WS → 관리자 웹(5메뉴) / 관리자 앱(4탭). 메뉴 기준: `docs/design/SERVICE_RESTRUCTURE.md`
상세 설계는 `docs/`에 있다. 전체 파일을 다시 읽지 말고 아래 지도를 먼저 본다.

## 코드 지도
- `backend/app/services/fill_level.py` — 적재율 계산의 **유일한** 구현 (펌웨어/웹/앱은 계산 금지)
- `backend/app/services/command_service.py` — 명령 검증·상태 전이(PENDING→SENT→SUCCEEDED/FAILED/TIMEOUT)
- `backend/app/services/telemetry_service.py` — telemetry/status 수신, offline 판정
- `backend/app/hardware/` — HAL (`HARDWARE_MODE` SIMULATOR/ESP32_REAL, 내장 가상 장치 `simulator.py`)
- `backend/app/services/detection_service.py` — AI 분류 수신 → 자동 배출(origin=auto) → ACK로 outcome 갱신
- `shared/src/alerts.ts` — 알림 파생 규칙 (웹·앱 공용, 저장 안 함)
- `backend/app/services/history_service.py` — 이력/추이 조회 (measurements, commands, trend)
- `shared/src/health.ts` — 장치 건강 판정(healthy/degraded/offline/unknown) 웹·앱 공용
- `docs/design/REDESIGN_PLAN.md` — 디자인 시스템·페이지 사양 (Material Ledger)
- `backend/app/mqtt/` — aiomqtt 연결/디스패치, `backend/app/api/routes.py` — REST, `backend/app/websocket/` — WS
- `shared/src/` — 웹·앱 공용 TS 타입/API 클라이언트/재연결 WS/리듀서/라벨·임계값 (백엔드 스키마 변경 시 함께 수정)
- `scripts/simulator/simulator.py` — Mock 장치 (펌웨어와 같은 명령 규칙)
- `firmware/esp32/include/config.h` — 핀·서보 각도 등 하드웨어 설정 유일 위치

## 명령
- 설치: `scripts/setup.sh` · 인프라: `scripts/infra-up.sh` / `infra-down.sh`
- 실행: `scripts/backend.sh`, `scripts/web.sh`, `scripts/mobile.sh`, `scripts/simulate.sh --scenario filling --calibrate`
- 검증: `scripts/test.sh` (단위/빌드), `scripts/e2e.sh` (백엔드 실행 중 [SIM] 통합)
- 시각 QA: `scripts/screenshot.sh --base http://localhost:5173 --pages / --widths 1440,390 --out <dir>` (정확한 폭, 콘솔 오류·가로 넘침 보고)

## 규칙
- API/MQTT/DB 스키마 변경 시 `docs/*` 와 `shared/src/types.ts` 갱신, DB는 Alembic 리비전 추가
- 명령 토픽 retain 금지, 시뮬레이터 데이터는 `source: "simulator"` 필수
- 실제 하드웨어 검증 전에는 "검증 완료"라고 쓰지 않는다 ([SIM]/[HW] 구분)
- 유료 서비스·외부 API 도입 금지 (로컬 LAN만으로 동작)
