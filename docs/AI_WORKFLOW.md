# Claude Code 활용 가이드 (토큰 절약)

## 1. 이 저장소에 이미 적용된 것
| 방법 | 효과 |
|---|---|
| `CLAUDE.md` (루트) | 새 세션이 코드 지도·명령·규칙을 바로 읽음 → 전체 탐색 불필요 |
| `shared/` 공용 TS 모듈 | 웹·앱 수정 시 한 곳만 읽고 고침 (중복 코드 없음) |
| 스크립트화 (`scripts/*.sh`) | "실행해줘" 요청이 명령 1개로 끝남 |
| 자동 테스트 + `scripts/e2e.sh` | 결과 요약만 확인하면 됨 (로그 전체를 대화에 붙일 필요 없음) |
| 생성 도구 활용 | Alembic autogenerate(마이그레이션), create-expo-app(앱 골격), FastAPI `/docs`(API 문서 자동 생성) → 직접 작성하는 코드·토큰 감소 |

## 2. Claude Code 내장 기능 사용법
| 명령 | 언제 |
|---|---|
| `/code-review` | 변경 후 버그 리뷰 (기본 수준이면 충분, `ultra`는 비용 큼) |
| `/simplify` | 리뷰 후 중복·과한 코드 정리 |
| `/run` | 앱 실행·화면 확인을 맡길 때 |
| `/fewer-permission-prompts` | 자주 쓰는 읽기 명령 자동 허용 → 승인 왕복 감소 |
| `/compact` | 대화가 길어졌을 때 요약으로 압축 |
| `/clear` | 다른 작업으로 넘어갈 때 (CLAUDE.md가 있으니 맥락 손실 적음) |

## 3. 요청 요령
- 범위를 좁혀서: "백엔드 명령 타임아웃을 15초로" → 파일 1개만 읽음
- 파일 경로를 직접 지정: `backend/app/services/command_service.py 의 ...`
- 큰 독립 작업(웹/앱/펌웨어 동시 수정)만 병렬 에이전트 사용 — 작은 수정에 에이전트를 쓰면 오히려 토큰 증가
- 로그는 필요한 부분만: `scripts/e2e.sh | tail -20`

## 4. 비용 정책
모든 구성 요소는 무료 오픈소스이며 로컬에서 동작한다 (유료 API·클라우드 없음).
| 영역 | 사용 | 라이선스 |
|---|---|---|
| 컨테이너 | Colima, Docker CLI/Compose | MIT / Apache-2.0 |
| DB / 브로커 | PostgreSQL, Eclipse Mosquitto | PostgreSQL / EPL-2.0·EDL |
| 백엔드 | FastAPI, SQLAlchemy, Alembic, aiomqtt, Pydantic | MIT / BSD |
| 웹 | React, Vite, Recharts, lucide-react, Pretendard(로컬 번들) | MIT / ISC / OFL |
| 앱 | Expo, React Native, @expo/vector-icons | MIT |
| 펌웨어 | PlatformIO Core, Arduino-ESP32, PubSubClient, ArduinoJson, ESP32Servo | Apache-2.0 / LGPL / MIT |
| AI (계획) | OpenCV, Ultralytics YOLO (로컬 추론) | Apache-2.0 / **AGPL-3.0** — 배포 시 소스 공개 의무 확인 필요 |
