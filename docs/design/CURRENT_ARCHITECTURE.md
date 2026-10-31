# 현재 아키텍처 (재디자인 착수 시점, 2026-10-31)

상세 설계는 `docs/ARCHITECTURE.md`. 여기서는 재디자인에 영향을 주는 사실만 요약한다.

## 스택
| 영역 | 구현 |
|---|---|
| 웹 | React 18.3 + TypeScript 5.7 + Vite 6, react-router-dom 6.28, Recharts 2.15, lucide-react 0.468, Pretendard(로컬), 순수 CSS(토큰 `src/styles/tokens.css`, 905줄 `app.css`) |
| 앱 | Expo SDK 58, React Native 0.88, expo-router (탭 3개: 홈/제어/설정 + `bin/[id]`), 시스템 폰트, `theme/tokens.ts` |
| 공용 | `shared/src` — 타입, API 클라이언트, 재연결 WS(`RealtimeClient`), 상태 리듀서(`applyEvent`, `mergeSnapshot`), 라벨·임계값(`FILL_THRESHOLDS`), 장치 건강 판정(`deviceHealth`) |
| 백엔드 | FastAPI 단일 프로세스, PostgreSQL 16, aiomqtt, WebSocket `/ws/dashboard` |
| 인증 | 제어·보정 API만 Bearer 정적 토큰 (`API_CONTROL_TOKEN`). 사용자 계정 없음 |
| 하드웨어 | ESP32 펌웨어(빌드만 검증) / Python 시뮬레이터 (`source: simulator`) |

## 데이터 흐름 (UI 관점)
1. 진입: `GET /api/dashboard` (devices, bins, recent_commands 10개)
2. 실시간: WS 이벤트 `bins.updated` / `device.status` / `command.updated` → `applyEvent`
3. 재연결: 지수 백오프 → `onResync`에서 스냅샷 재조회 → `mergeSnapshot`
4. 명령: `POST /api/devices/{id}/commands` → 202 `SENT` → WS `command.updated` (SUCCEEDED/FAILED/TIMEOUT). **ACK 전 성공 표시 금지**

## API (재디자인에서 사용)
| 용도 | 엔드포인트 | 비고 |
|---|---|---|
| 스냅샷 | `GET /api/dashboard` | 기존 |
| 서버 상태 | `GET /health` | DB·MQTT(서버↔브로커) |
| bin 이력 | `GET /api/bins/{id}/history?limit=` | 기존 |
| 통계 | `GET /api/statistics?hours=` | bin별 평균/최대/표본/오류 수, 명령 상태별 개수 |
| 보정 | `GET/PUT /api/bins/{id}/calibration` | PUT은 토큰 |
| 명령 | `POST /api/devices/{id}/commands`, `GET .../commands/{cid}` | 토큰 |
| **신규** 측정 이력 | `GET /api/measurements?bin_id&sensor_status&source&from&to&order&limit&offset` | `{items,total,limit,offset}` |
| **신규** 명령 이력 | `GET /api/commands?device_id&status&command&from&to&order&limit&offset` | 동일 페이지 형식 |
| **신규** 추이 | `GET /api/statistics/trend?hours&bucket_minutes` | bin×시간버킷 평균/최대/표본/오류. 측정 없는 버킷은 **없음**(0 채우지 않음) |

신규 API는 읽기 전용 추가이며 기존 계약·DB 스키마 변경 없음 (테스트 55개 통과).

## 실제로 존재하지 않는 데이터 (UI에서 지어내면 안 됨)
- 장치 연결 이력(가용률) — 저장하지 않음. 현재 상태와 `last_seen`만 존재
- 서보 위치/전류 — 센서 없음. 모터 상태의 유일한 근거는 마지막 `OPEN_BIN` ACK 결과
- 알림(notification) 시스템 — 없음
- 사용자 계정 — 없음 (토큰만)
- 임계값 런타임 변경 — 코드(`shared/src/labels.ts`)·환경변수로만 변경 (읽기 전용 표시)
