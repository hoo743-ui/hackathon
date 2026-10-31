# 테스트 보고서 (2026-10-31)

표기: **[SIM]** 시뮬레이터로 실행·통과 · **[BUILD]** 빌드/정적 검사만 · **NOT TESTED** 실행하지 않음.
시뮬레이터 통과는 실제 하드웨어·실제 AI 모델 검증이 아니다.

## 1. 자동 테스트 — `scripts/test.sh` (전체 통과)
| 항목 | 결과 | 내용 |
|---|---|---|
| 계약 최신성 | ✅ | `docs/mqtt-schemas/*`, `docs/openapi.json` = 코드에서 생성한 값 |
| 백엔드 pytest | ✅ **79/79** | 실제 PostgreSQL + Alembic 마이그레이션. 적재율 계산, MQTT 검증(v1/v1.1), 출처·모드 차단, 메시지 중복 제거, 명령 상태·멱등·타임아웃·늦은 ACK·긴급정지, AI 분류(자동 배출·ACK→SORTED·실패/타임아웃→SORT_FAILED·신뢰도·수동 모드·오프라인·멱등·권한 분리), 점검 기록, 이력·추이 API, 시뮬레이터 메시지의 JSON Schema 적합성 |
| 웹 vitest | ✅ **67/67** + typecheck + build | 공용 로직(재연결·리듀서·API), 개요(오늘 건수·알림), 분류 기록(필터·페이지·URL), 운영(ACK 전 성공 표시 없음·모터 테스트 기록·긴급정지 즉시·확인 대화상자), 리다이렉트, 테마 |
| 모바일 jest | ✅ **54/54** + tsc + `expo export --platform ios` + expo-doctor 20/20 | 제어 규칙·길게 누르기·알림 배지·오류 문구 |
| 펌웨어 | ✅ [BUILD] `pio run` | RAM 15.9% · Flash 82.1% |

## 2. 통합 — `scripts/e2e.sh` **[SIM] 26/26 통과**
실제 Mosquitto(인증·ACL) + FastAPI + PostgreSQL + 외부 시뮬레이터 프로세스.
| 흐름 | 검증 항목 |
|---|---|
| 센서 → MQTT → FastAPI → PostgreSQL | 4칸 적재율 계산·저장, 이력 저장, 출처 simulator |
| FastAPI → WebSocket | `bins.updated` 수신 (웹·앱 공용 클라이언트가 같은 이벤트 사용) |
| 제어 → MQTT → 장치 → ACK | 접수 시 SENT(성공 아님), ACK 후 SUCCEEDED, 동작 중 중복 차단, 잘못된 대상 차단, 같은 command_id 멱등, `POST /api/commands`(bin_id) |
| 긴급정지 | 즉시 실행·래치·해제 전 동작 거부 |
| **AI 분류 → 자동 배출** | 수동 모드는 기록만 · 자동 모드 분류 → `origin=auto` 배출 → ACK → `SORTED` · 자동 모드에서 수동 배출 거부 · 낮은 신뢰도 무동작 |
| 장애 | ACK 미수신 → TIMEOUT · 센서 고장 → 이전 정상값 유지 · 비정상 종료 → LWT offline · offline 장치 명령 거부 · 재연결 복구 |

## 3. 수동 확인 [SIM]
| 항목 | 결과 |
|---|---|
| `HARDWARE_MODE=ESP32_REAL`: 시뮬레이터 데이터 4건 폐기, 장치 계정 v1.1 하드웨어 메시지 수락, 같은 message_id 재전송 중복 제거 | ✅ |
| MQTT TLS 8883: CA 검증 접속 성공, CA 없음 거부, 잘못된 비밀번호 거부, 백엔드 aiomqtt TLS 수신 | ✅ |
| 브로커 LAN 노출(`MQTT_BIND_ADDRESS=0.0.0.0`): LAN IP 인증 접속 | ✅ |
| 브로커 재시작 → 백엔드 자동 재연결 | ✅ |
| 백엔드 Docker 이미지 빌드·기동·마이그레이션 | ✅ |
| 화면 점검 (헤드리스 Chrome, 정확한 뷰포트): 웹 6화면 × 1440/768/390, 앱 6화면 × 360/390 (라이트·다크) — 콘솔 오류 0, 가로 넘침 0 | ✅ |
| 환경 프로필 전환 (`scripts/env-profile.sh`) — 비밀값 유지, 반복 적용 안전 | ✅ |

## 4. NOT TESTED
| 항목 | 이유 / 다음 단계 |
|---|---|
| 실제 ESP32·센서·서보 전부 (`HARDWARE_INTEGRATION.md` H1–H15) | 하드웨어 미조립 |
| 실제 AI 모델 연결 (다른 노트북) | 연결 전 — `AI_INTEGRATION.md` §3 코드 추가 후 확인 |
| 모바일 앱을 실제 휴대폰(Expo Go)에서 실행 | 사용자 휴대폰 필요 — `scripts/mobile.sh` 후 QR 스캔 |
| Android APK 빌드 | 설정만 완료(`eas.json`), Expo 계정 로그인 필요 |
| 공개 URL 배포 | 외부 공개 전 사용자 확인 필요 |
| 펌웨어 MQTT TLS | 미구현 |
| 운영(production) 프로필 전체 | 템플릿만 |
| 장시간 안정성 | 미실시 |

## 5. 실기 결과 기록란 [HW]
| 날짜 | 항목(H#) | 결과 | 측정값·비고 |
|---|---|---|---|
| | | | |
