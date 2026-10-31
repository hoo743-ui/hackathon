# 사용 가이드

처음 사용하는 사람이 순서대로 따라 하면 되는 문서다. 명령은 모두 저장소 루트(`smart-recycling-system/`)에서 실행한다.

---

## 1. 한 번만: 설치
```bash
brew install colima docker docker-compose python@3.12 mosquitto platformio node   # 이미 설치돼 있으면 생략
scripts/setup.sh
```
`setup.sh`가 하는 일: `.env` 생성(비밀번호·API 토큰 무작위 생성, 휴대폰용 서버 주소에 Mac LAN IP 입력), 백엔드 가상환경, 웹·앱 의존성 설치.

**API 토큰 확인** (웹/앱의 설정 화면에 붙여넣기):
```bash
grep API_CONTROL_TOKEN .env
```

## 2. 매일: 실행 순서 (터미널 4개)
| 터미널 | 명령 | 확인 |
|---|---|---|
| 1 | `scripts/infra-up.sh` 후 `scripts/backend.sh` | http://localhost:8000/health → `"status":"ok"` |
| 2 | `scripts/simulate.sh --scenario filling --calibrate` | `[SIM] telemetry ...` 로그 |
| 3 | `scripts/web.sh` | http://localhost:5173 |
| 4 | `scripts/mobile.sh` | 휴대폰 Expo Go로 QR 스캔 |

종료: 각 터미널 `Ctrl+C` → `scripts/infra-down.sh` (데이터 유지). DB까지 초기화: `scripts/infra-down.sh --volumes`.

> 백엔드까지 Docker로 돌리고 싶으면 `scripts/stack-up.sh` (이 경우 `scripts/backend.sh`는 실행하지 않는다).

## 3. 시뮬레이터 (하드웨어 없이 테스트)
```bash
scripts/simulate.sh --scenario <이름> [--interval 3] [--calibrate]
```
| 시나리오 | 내용 |
|---|---|
| `normal` | 4개 센서 정상 |
| `mixed` | 4칸이 여유·주의·경고·위험 단계에서 천천히 변동 (화면 점검·발표용) |
| `filling` | 적재율이 점점 증가 (대시보드 변화 확인용) |
| `sensor-fail` | BIN_002 센서가 주기적으로 응답 없음 |
| `outlier` | BIN_003이 불가능한 값(950cm) 전송 → 서버가 `측정 범위 이탈`로 처리 |
| `disconnect` | 10초 후 비정상 종료 → 장치 `연결 끊김` |
| `no-ack` | 명령에 응답 안 함 → 15초 후 `응답 시간 초과` |

> 기본 실행에서는 백엔드가 가상 장치를 내장 실행한다(`HARDWARE_MODE=SIMULATOR`). 위 CLI 시나리오는 `SIMULATOR_AUTOSTART=false scripts/backend.sh`로 백엔드를 띄운 뒤 사용한다.

- `--calibrate`: 가상 통 깊이(빈 통 40cm / 가득 5cm)를 보정값으로 등록. **실제 하드웨어 보정 후에는 사용 금지** (실측 보정값을 덮어씀).
- 시뮬레이터 데이터는 화면에 **SIMULATED** 배지로 표시된다.

## 4. 관리자 웹 (5개 메뉴)
| 메뉴 | 용도 |
|---|---|
| **개요** | 장치 상태 · 운전 모드 · 오늘 분류 건수 · 점검 필요 · 4칸 적재 컬럼 · 최근 분류 · 최근 제어/오류 |
| **수거함** | 칸별 적재율·거리·센서 · 상세: 측정 이력·추이 · **보정 편집** · 임계값 |
| **분류 기록** | AI 분류 결과 (종류·신뢰도·처리 결과·연결 명령) — 필터·페이지 |
| **장치** | 연결·마지막 통신·MQTT·HW 모드·센서 상태·장치 오류·모터·마지막 분류 수신 |
| **운영** | 긴급정지 · 자동/수동 모드 · 수동 배출 · 모터 테스트 · 센서 테스트 · 상태 확인 · 점검 기록 · 제어 기록 |

- 헤더 ⚙ **앱 설정**: 테마, 데이터 출처(실제/Mock), **제어 토큰** (`grep API_CONTROL_TOKEN .env`)
- 운전 모드: **자동** = AI 분류 결과로 배출 (관리자 수동 배출은 거부) / **수동** = 관리자 조작 (AI 분류는 기록만)
- 서버 없이 화면만: `VITE_DATA_MODE=mock scripts/web.sh` 또는 앱 설정에서 Mock
- 적재 단계: 여유(0–49) · 주의(50–79) · 경고(80–94) · 위험(95–100) · 미보정(회색). 변경: `shared/src/labels.ts` `FILL_THRESHOLDS`

## 5. 관리자 앱 (4개 탭)
1. 휴대폰과 Mac을 같은 Wi-Fi에 연결, 휴대폰에 **Expo Go** 설치
2. `scripts/mobile.sh` → QR 스캔 (Mac IP가 바뀌어도 자동 반영)
3. 홈 ⚙ **설정** → 제어 토큰 입력, 연결 상태 확인

| 탭 | 용도 |
|---|---|
| **홈** | 장치 상태 · 오늘 분류 · 4칸 · 알림 상위 · 최근 분류 |
| **수거함** | 칸 목록 → 상세(적재율·거리·센서·이력) |
| **알림** | 적재 위험/경고 · 센서 오류 · 장치 오프라인 · 분류 실패 · 긴급정지 (탭 배지 = 위험+경고 수) |
| **제어** | 자동/수동 · 배출구 **0.6초 길게 누르기**(=모터 테스트) · 상태 확인 · 결과 · 제어 기록 · 하단 **긴급 정지** |

브라우저 미리보기: `cd mobile/app && npx expo start --web` → http://localhost:8081 · APK: `docs/DEPLOYMENT.md` §6

## 5-1. AI 분류
- 다른 노트북의 AI 코드 연동: **[AI_INTEGRATION.md](AI_INTEGRATION.md)** (HTTP 요청 1개 추가)
- AI 없이 시연: `scripts/simulate-detection.sh` (화면에 '시뮬레이터' 표시)

## 6. 자동 검증
```bash
scripts/test.sh   # 백엔드 단위·API 테스트, 웹 테스트·빌드, 앱 타입검사, 펌웨어 빌드
scripts/e2e.sh    # [SIM] SIMULATOR_AUTOSTART=false 백엔드 필요: 센서·제어·AI 분류·장애 26개 항목
```
`e2e.sh`는 보정값을 시뮬레이터 값으로 덮어쓰므로 실제 하드웨어 보정 후에는 실행하지 않는다.

## 7. 실제 하드웨어로 전환
1. **배선 전 반드시** `docs/HARDWARE_WIRING.md` 체크리스트 확인 (Echo 분압, 서보 별도 5V 전원, 공통 GND)
2. 브로커를 LAN에 공개: `.env`에서 `MQTT_BIND_ADDRESS=0.0.0.0` → `scripts/infra-up.sh`
   - 공유기 포트포워딩은 하지 않는다. 같은 Wi-Fi 안에서만 사용.
3. 펌웨어 설정
   ```bash
   cd firmware/esp32
   cp include/secrets.example.h include/secrets.h   # Wi-Fi(2.4GHz), MQTT_HOST=Mac LAN IP, MQTT 계정=.env의 MQTT_DEVICE_*
   ```
   핀·서보 각도·측정 주기는 `include/config.h`에서만 수정.
4. 업로드: `pio run -t upload && pio device monitor`
5. 시뮬레이터는 **끈다** (같은 DEVICE_001을 쓰므로 동시 실행 금지)
6. 보정: 빈 통 거리와 가득 찬 기준 거리를 실측 → 웹 쓰레기통 상세 화면에서 저장 (또는 `PUT /api/bins/{id}/calibration`)
7. 화면의 SIMULATED 배지가 사라지고 데이터 출처가 hardware로 바뀌는지 확인

## 8. 문제 해결
| 증상 | 확인 |
|---|---|
| `/health`의 `mqtt: false` | `docker ps`로 mosquitto 실행 확인, `.env` 계정 확인 |
| 적재율이 `--`(미보정) | 보정값 미설정 → 보정 화면에서 입력 (시뮬레이터는 `--calibrate`) |
| 명령이 `DEVICE_OFFLINE` | 장치/시뮬레이터 실행 여부, 30초 이상 데이터 없음 |
| 명령이 `응답 시간 초과` | 장치가 ACK를 못 보냄 — 펌웨어 시리얼 로그 확인, NTP 시간 동기화 여부 |
| 웹은 되는데 앱만 안 됨 | LAN IP·방화벽 (5장) |
| `docker` 명령 실패 | `colima start` |
| 포트 충돌(5432/1883/8000) | 다른 Postgres/브로커 중지 또는 `.env` 포트 변경 |
