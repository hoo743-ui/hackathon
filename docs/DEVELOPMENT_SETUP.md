# 개발 환경 설정 (macOS, Apple Silicon)

모든 도구는 무료/오픈소스다. Docker Desktop(대기업 유료 라이선스) 대신 **Colima**(MIT)를 사용한다.

## 1. 설치된 도구 (2026-10-31 구성)
| 도구 | 버전 | 용도 |
|---|---|---|
| Colima + Docker CLI + Compose | Compose 5.6 | PostgreSQL / Mosquitto / (선택) 백엔드 컨테이너 |
| Python | 3.12 (`python3.12`) | 백엔드, 시뮬레이터 (3.15는 의존성 호환 문제로 사용 안 함) |
| Node / npm | 26 / 11 | 웹, 모바일 |
| PlatformIO Core | 6.2 | ESP32 펌웨어 빌드/업로드 |
| mosquitto (brew) | — | `mosquitto_sub` 디버깅용 클라이언트 (브로커는 Docker) |

새 Mac에서 처음부터:
```bash
brew install colima docker docker-compose python@3.12 mosquitto platformio node
mkdir -p ~/.docker/cli-plugins && ln -sfn /opt/homebrew/opt/docker-compose/bin/docker-compose ~/.docker/cli-plugins/docker-compose
colima start --cpu 2 --memory 4
```

## 2. 프로젝트 초기화
```bash
scripts/setup.sh     # .env 생성(무작위 비밀번호), backend venv, npm install, mobile/.env 동기화
scripts/infra-up.sh  # postgres + mosquitto 기동, alembic upgrade, 초기 데이터
```

## 3. 환경변수 (.env)
| 변수 | 설명 |
|---|---|
| `POSTGRES_*` | DB 접속 |
| `MQTT_*_USERNAME/PASSWORD` | backend / simulator / device_001 계정 (ACL로 토픽 권한 분리) |
| `MQTT_BIND_ADDRESS` | 기본 `127.0.0.1`. 실제 ESP32 연결 시 `0.0.0.0` (같은 LAN만, 포트포워딩 금지) |
| `API_CONTROL_TOKEN` | 제어/보정 API Bearer 토큰. 웹·앱 설정 화면에 입력 |
| `COMMAND_ACK_TIMEOUT_SEC` | ACK 대기 시간 (기본 10초) |
| `DEVICE_OFFLINE_AFTER_SEC` | 무응답 시 offline 판정 (기본 30초) |
| `BIN_FULL_THRESHOLD_PERCENT` | 서버 is_full 기준 (기본 95, `shared/src/labels.ts` 위험 단계와 일치) |
| `VITE_*`, `EXPO_PUBLIC_*` | 웹/앱이 접속할 서버 주소 |

## 4. 디버깅 팁
```bash
# 브로커 메시지 실시간 보기 (backend 계정 사용)
source .env && mosquitto_sub -h localhost -u "$MQTT_BACKEND_USERNAME" -P "$MQTT_BACKEND_PASSWORD" -t 'smartbin/#' -v
# DB 직접 조회
docker exec -it smartbin-postgres-1 psql -U smartbin -d smartbin
# 로그
docker logs -f smartbin-mosquitto-1
```

## 5. Colima 주의사항
- Mac 재부팅 후 `colima start` 필요 (`scripts/infra-up.sh`가 자동 실행)
- 브로커는 기본적으로 Mac의 localhost에만 열린다. `.env`에서 `MQTT_BIND_ADDRESS=0.0.0.0` 후 `scripts/infra-up.sh` 하면 LAN IP로 접속 가능 (2026-10-31 확인: LAN IP 인증 접속 성공, 익명 접속 거부). 절차는 `docs/USER_GUIDE.md` 7장.
