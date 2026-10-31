# 배포 · 환경 설정

모든 구성 요소는 무료·오픈소스이며 인터넷 없이 같은 LAN에서 동작한다. 비밀번호·토큰은 `.env`에만 있고(Git 제외) 코드에 없다.

## 1. 환경 프로필
`.env`(비밀값 포함)는 `scripts/setup.sh`가 무작위 값으로 생성한다. 환경 차이는 `config/env/<프로필>.env`로 덮어쓴다.
```bash
scripts/env-profile.sh local | simulator | esp32-real | production   # 이전 .env 는 .env.bak
```
| 프로필 | HARDWARE_MODE | 내장 가상장치 | 브로커 1883 | TLS 8883 | API 바인딩 | 용도 | 검증 |
|---|---|---|---|---|---|---|---|
| `local` | SIMULATOR | 끔 (CLI·e2e로 수동) | localhost | localhost | 0.0.0.0 | 개발, 장애 시나리오 | [SIM] e2e 21/21 |
| `simulator` | SIMULATOR | 켬 (mixed) | localhost | localhost | 0.0.0.0 | 시연·디자인 점검 | [SIM] 동작 확인 |
| `esp32-real` | ESP32_REAL | 없음 | **LAN** | LAN | 0.0.0.0 | 실제 ESP32 (같은 Wi-Fi) | 출처 차단·수락만 확인, 실기 NOT TESTED |
| `production` | ESP32_REAL | 없음 | 내부 전용 | **공개** | 127.0.0.1 (프록시 뒤) | 서버를 인터넷에 둘 때 | **NOT TESTED** (템플릿) |

## 2. 주소 환경변수
| 변수 | 사용처 | 개발 예 | 운영 예 |
|---|---|---|---|
| `VITE_API_BASE_URL`, `VITE_WS_URL` | 웹 빌드 시 주입 | `http://localhost:8000`, `ws://…/ws/dashboard` | `https://api.도메인`, `wss://api.도메인/ws/dashboard` |
| `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_WS_URL` | 모바일 (`mobile/app/.env`로 동기화) | `http://<Mac LAN IP>:8000` | `https://api.도메인` |
| `CORS_ORIGINS` | 백엔드 | `http://localhost:5173,…,http://localhost:8081` | `https://도메인` |
| `MQTT_HOST`/`MQTT_PORT` | 백엔드·시뮬레이터 | `localhost:1883` | 컨테이너 내부 `mosquitto:1883` |
| `MQTT_TLS_CA_FILE` | 백엔드 (브로커가 외부 TLS일 때) | 비움 | CA 경로 |
| 펌웨어 `MQTT_HOST` | `firmware/esp32/include/secrets.h` | Mac LAN IP | (TLS 펌웨어 미구현 — §4) |

모바일은 `localhost`를 쓰지 않는다 (실기기에서 Mac을 가리키지 않음). Expo는 `mobile/app/.env`의 `EXPO_PUBLIC_*`를 번들 시 주입한다 — `scripts/env-profile.sh`·`scripts/mobile.sh`가 루트 `.env`에서 동기화.

## 3. 실행 방식
### 개발 (권장)
```bash
scripts/infra-up.sh      # Postgres + Mosquitto (Docker/Colima), 마이그레이션, 시드
scripts/backend.sh       # FastAPI (로컬 venv, 단일 워커)
scripts/web.sh           # Vite
scripts/mobile.sh        # Expo
```
### 전체 Docker (FastAPI 포함)
```bash
scripts/stack-up.sh      # postgres + mosquitto + backend (profile "full"), 헬스체크 대기
```
백엔드 이미지: `backend/Dockerfile` (Python 3.12-slim, 비루트 사용자, 기동 시 `alembic upgrade head` + 시드). [SIM] 컨테이너 기동·`/health` OK 확인.

### 운영 (NOT TESTED — 절차만)
1. 서버에 Docker + Compose, 저장소 배포, `scripts/setup.sh` → `scripts/env-profile.sh production` → 도메인 값 수정
2. `scripts/gen-mqtt-certs.sh <도메인>` 또는 공인 인증서를 `infrastructure/mosquitto/certs/{ca.crt,server.crt,server.key}`에 배치
3. `scripts/stack-up.sh`
4. HTTPS 리버스 프록시 (무료: Caddy) — 예:
   ```
   api.도메인 { reverse_proxy 127.0.0.1:8000 }
   도메인     { root * /srv/web; file_server; try_files {path} /index.html }
   ```
5. 웹: `cd frontend/web && VITE_API_BASE_URL=https://api.도메인 VITE_WS_URL=wss://api.도메인/ws/dashboard npm run build` → `dist/`를 `/srv/web`에
6. 모바일: §6 참고
7. 백업: `docker exec smartbin-postgres-1 pg_dump -U smartbin smartbin > backup.sql` (cron)

## 4. MQTT 보안
| 구간 | 현재 |
|---|---|
| 인증 | 익명 금지, 계정 3개(backend/simulator/device_001), ACL 토픽 분리 — [SIM] 확인 |
| LAN 평문 1883 | 기본 localhost만, `esp32-real`에서 LAN 공개. 공유기 포트포워딩 금지 |
| TLS 8883 (브로커) | `scripts/gen-mqtt-certs.sh` → 인증서 있으면 자동 활성. **[SIM] 확인**: CA 검증 접속 성공, CA 없음 거부, 잘못된 비밀번호 거부, 백엔드 aiomqtt TLS 수신 성공 |
| TLS (ESP32 펌웨어) | **미구현** — 인터넷 경유 운영 전 필요 (`HARDWARE_INTEGRATION.md` §9) |
| 제어 API | 정적 Bearer 토큰. LAN에서는 HTTP 평문이므로 운영은 HTTPS 프록시 필수. 사용자 계정(JWT)은 미구현 |

자체 서명 CA의 `ca.key`는 서버 밖으로 복사하지 않는다. 장치·클라이언트에는 `ca.crt`만 배포한다. 인증서 디렉터리는 Git 제외.

## 5. 포트
| 포트 | 서비스 | 기본 바인딩 |
|---|---|---|
| 5432 | PostgreSQL | 127.0.0.1 (항상) |
| 1883 | MQTT 평문 | `MQTT_BIND_ADDRESS` |
| 8883 | MQTT TLS | `MQTT_TLS_BIND_ADDRESS` |
| 8000 | FastAPI | `API_HOST`(로컬) / `API_BIND_ADDRESS`(Docker) |
| 5173 | 웹 개발 서버 | — |
| 8081 | Expo 개발 서버/웹 미리보기 | — |

## 6. 모바일 앱 배포
| 방법 | 비용·시간 | 결과물 | 상태 |
|---|---|---|---|
| **Expo Go (프로토타입, 기본)** | 무료 · 즉시 | 휴대폰의 Expo Go 앱에서 실행 | 번들(`expo export`) 검증, 실기기 실행은 사용자 확인 필요 |
| EAS Build (클라우드) | 무료 등급 · 약 10–20분 · Expo 계정 필요 | 설치형 APK | 설정 완료(`mobile/app/eas.json` preview=apk), **빌드 미실행** |
| 로컬 빌드 | 무료 · Android SDK 수 GB 설치 | APK | 미실행 |

### Expo Go (지금 바로)
```bash
scripts/mobile.sh        # 현재 LAN IP로 앱 주소 자동 갱신 후 QR 표시
```
휴대폰과 Mac이 같은 Wi-Fi → Expo Go로 QR 스캔. Mac IP가 바뀌면(DHCP) `scripts/mobile.sh`가 자동 반영하고, 백엔드는 재시작해야 CORS에 반영된다.

### APK (필요할 때)
```bash
cd mobile/app
# eas.json 의 CHANGE-ME-SERVER-IP 를 서버 주소로 바꾼다 (APK에 주소가 고정되므로 서버 IP를 고정하거나 도메인 사용 권장)
npx eas-cli@latest login
npx eas-cli@latest build -p android --profile preview    # 완료 후 APK 다운로드 링크
```
HTTP(LAN) 서버 접속을 위해 `expo-build-properties`로 `usesCleartextTraffic`을 켜 두었다 (운영은 HTTPS 권장). 패키지명 `com.smartrecycle.admin`.
