# 테스트 계획

> 최신 실행 결과는 **[TEST_REPORT.md](TEST_REPORT.md)**. 이 문서는 초기 계획과 시나리오 정의다.

모든 테스트 결과에는 **환경 구분**을 표기한다: `[SIM]` 시뮬레이터 / `[HW]` 실제 하드웨어. `[SIM]` 통과는 하드웨어 검증을 의미하지 않는다.

## 1. 단위 테스트 (backend, pytest)
- 적재율 계산: 경계값(empty, full, 그 밖), 0~100 클램프, 미보정 시 None, 잘못된 보정(full ≥ empty) 거부
- 페이로드 검증: bin 누락/중복, 음수 거리, 알 수 없는 sensor_status, source 누락
- 명령 상태 전이: PENDING→SENT→SUCCEEDED/FAILED/TIMEOUT, 중복 command_id, BUSY/MODE/ESTOP 거부, E-STOP 우선

## 2. 통합 테스트 (Docker 인프라 + 시뮬레이터)
| ID | 시나리오 | 기대 결과 |
|---|---|---|
| I-01 | 정상 4채널 telemetry | sensor_logs 4행, bins 갱신 |
| I-02 | 적재율 증가 시퀀스 | 단조 증가, WS 이벤트 수신 |
| I-03 | 센서 1개 timeout | 해당 bin 이전 값 유지, status=timeout |
| I-04 | 이상값(거리 500cm, 음수) | 검증 거부 또는 out_of_range |
| I-05 | 시뮬레이터 강제 종료 | LWT → device offline |
| I-06 | 브로커 재시작 | 서버/시뮬레이터 자동 재연결 |
| I-07 | OPEN_BIN 명령 | ACK → SUCCEEDED |
| I-08 | 시뮬레이터 ACK 미응답 | TIMEOUT |
| I-09 | E-STOP 후 OPEN_BIN | ESTOP_ACTIVE 거부 |

## 3. 프론트엔드
최초 로딩, WS 연결, 실시간 반영, 끊김 표시 및 재동기화, 명령 결과 표시, SIMULATED 배지 표시.

## 4. 최종 검증 시나리오
명세 14장의 1~10단계. 각 단계에 날짜·환경·결과·로그 위치를 기록한다.

## 5. 결과 기록
| 날짜 | 항목 | 환경 | 결과 | 비고 |
|---|---|---|---|---|
| 2026-10-31 | backend pytest (단위·API·MQTT 핸들러·명령·WS) | [SIM] | ✅ 52/52 | 실제 PostgreSQL(smartbin_test) + Alembic 마이그레이션 |
| 2026-10-31 | `scripts/e2e.sh` I-01~I-09 포함 17개 항목 | [SIM] | ✅ 17/17 | 실제 Mosquitto(인증·ACL)·FastAPI·시뮬레이터 |
| 2026-10-31 | web vitest (shared 로직 + 컴포넌트) | [SIM] | ✅ 27/27 | + typecheck, production build |
| 2026-10-31 | mobile tsc + jest + `expo export --platform ios` | [SIM] | ✅ 13/13 | expo-doctor 20/20 |
| 2026-10-31 | firmware `pio run` | 빌드만 | ✅ | RAM 15.8%, Flash 81.5% — **실기 미검증** |
| 2026-10-31 | 브로커 LAN 노출(`MQTT_BIND_ADDRESS=0.0.0.0`) | [SIM] | ✅ | LAN IP 인증 접속 성공, 익명 거부 |
| 2026-10-31 | 화면 점검 (헤드리스 Chrome 스크린샷: 웹 대시보드/상세/장치, 앱 홈/제어) | [SIM] | ✅ | 실데이터 표시·SIMULATED 배지 확인 |
| — | 실제 ESP32·센서·서보 | [HW] | ☐ 미실시 | 조립 후 HARDWARE_WIRING 체크리스트부터 |
