# SMART RECYCLE — 재디자인 계획 및 사양

> **메뉴·화면 구성(§3.2, §4, §5)은 [SERVICE_RESTRUCTURE.md](SERVICE_RESTRUCTURE.md)로 대체되었다** (웹 5메뉴·앱 4탭). 디자인 시스템(§1–2, §3.1, §6)은 그대로 유효하다.

> Material Intelligence System. 이 문서가 웹·앱 구현의 **단일 기준**이다. 사양과 다르게 구현해야 하면 이유를 `DESIGN_DECISIONS.md`에 기록한다.

---

## 1. 디자인 방향 탐색 (PASS 2)

| | A. Field Instrument | **B. Material Ledger (채택)** | C. Eco Signal |
|---|---|---|---|
| 개념 | 어두운 계기판, 발광 수치, 고밀도 패널 | 스위스 정보 디자인의 장부(ledger) + 계측 판독값. 재질별 코드·색 체계 | 친환경 그린 중심, 부드러운 곡선, 일러스트 |
| 정체성 | 강하지만 "다크 사이버 대시보드"와 구분 어려움 | 분리수거 = **재질 분류**라는 본질을 시각 체계로 만듦 (PL/CN/PA/GN 코드, 재질색) | 친환경 템플릿과 구분 어려움, 장난감 같음 |
| 위계 | 모든 것이 빛나 경고가 묻힘 | 종이 같은 바탕 + 잉크 위계 → 위험만 신호색 | 녹색 과다로 상태색 의미 약화 |
| 그리드 | 촘촘한 균등 패널 | 12단 비대칭, 카드 대신 괘선(hairline)과 여백 | 카드 그리드 |
| 타이포 | 모노스페이스 과다 | IBM Plex Sans KR + 측정값에만 Plex Mono | 둥근 산세리프 |
| 운영성 | 야간 관제엔 좋으나 현장(주간·모바일) 가독성 낮음 | 주간 현장·발표 화면에서 고대비, 다크 테마도 지원 | 경고 인지 느림 |

**채택: B. Material Ledger** — 이 제품의 핵심은 "어떤 재질이 얼마나 찼는가"다. 재질을 1급 시각 요소(코드·색·컬럼)로 만들고, 상태 신호는 신호색(오렌지/레드)에만 집중시킨다. 계측 장비의 판독값 표현(A의 장점)은 수치 표기에만 차용한다.

### 시그니처 요소
1. **Material Column (재질 컬럼)** — 수거함을 실제 통처럼 세로 기둥으로 표현. 바닥부터 채워지고 50/80/95% 임계 눈금이 그려져 있다. 진행 막대가 아니라 "통의 단면도"다.
2. **Material Code** — 재활용 표기처럼 정사각 코드 칩: `PL` 플라스틱 · `CN` 캔 · `PA` 종이 · `GN` 일반. 코드+재질색이 모든 화면·차트 범례에서 동일.
3. **Ledger rule** — 섹션 구분은 카드 테두리가 아니라 상단 2px 잉크 괘선 + 제목. 표·목록은 1px 괘선.
4. **Readout** — 측정값은 큰 tabular 숫자 + 작은 단위 (`72.4` `%`, `12.5` `cm`). 시각·ID·원시값만 Mono.

---

## 2. 디자인 토큰 (PASS 3)

### 2.1 색 — Light (기본)
| 토큰 | 값 | 용도 |
|---|---|---|
| `--bg` | `#F3F1EC` | 바탕 (따뜻한 종이) |
| `--surface` | `#FBFAF7` | 입력·표·패널 바탕 |
| `--surface-sunken` | `#E9E6DF` | 컬럼 빈 영역, 비활성 |
| `--ink` | `#16181B` | 본문/제목 (흑연) |
| `--ink-2` | `#4A4F55` | 보조 텍스트 |
| `--ink-3` | `#6B7076` | 캡션·축 (바탕 대비 AA 4.5↑) |
| `--rule` | `#D6D2C8` | 1px 괘선 |
| `--rule-strong` | `#16181B` | 섹션 2px 괘선 |
| `--accent` | `#3D5A66` | 미네랄 — 링크, 선택, 포커스 (상태 아님) |
| `--ok` | `#1F6B4A` | 환경 그린 — 정상/성공/여유 |
| `--attention` | `#8A5A00` | 주의 50–79% (오커) |
| `--warning` | `#C2410C` | 경고 80–94% (시그널 오렌지) |
| `--critical` | `#B3261E` | 위험 95%↑, 실패, 긴급정지 |
| `--unknown` | `#8D9196` + 사선 해치 | 미보정·데이터 없음 |
| `--signal` | `#D9480F` | 시그널 오렌지 — 주요 실행 버튼(배출구 작동) 전용 |

### 2.2 색 — Dark (`[data-theme="dark"]`, 시스템 따름 기본)
`--bg #111315` · `--surface #181B1E` · `--surface-sunken #0C0E10` · `--ink #ECEAE4` · `--ink-2 #A9ADB2` · `--ink-3 #8A8F95` · `--rule #2A2E33` · `--rule-strong #ECEAE4` · `--accent #8FB3C2` · `--ok #4FB286` · `--attention #E0A33A` · `--warning #FF7A3D` · `--critical #F2665C` · `--unknown #6B7076` · `--signal #FF7A3D`

### 2.3 재질색 (정체성 전용 — 상태 표시에 쓰지 않음)
| 재질 | 코드 | Light | Dark |
|---|---|---|---|
| plastic | PL | `#2E6F95` | `#6FA8D1` |
| can | CN | `#6D4FA0` | `#A98BD3` |
| paper | PA | `#8C6A2F` | `#C9A465` |
| general | GN | `#3F4449` | `#9AA1A8` |

컬럼의 **채움색은 적재 단계색**(ok/attention/warning/critical), 재질색은 코드 칩·컬럼 상단 캡·차트 선에만 쓴다. (재질과 상태가 같은 채널을 다투지 않게)

### 2.4 타이포그래피
- **IBM Plex Sans KR** (OFL) — UI 전체. 웹: `@fontsource/ibm-plex-sans-kr` 400/500/600/700, 앱: `@expo-google-fonts/ibm-plex-sans-kr` (파일 번들, 런타임 네트워크 불필요)
- **IBM Plex Mono** (OFL) — 타임스탬프, 장치·bin ID, 원시 거리값 표, command_id 에만. 웹 `@fontsource/ibm-plex-mono` 400/500, 앱 `@expo-google-fonts/ibm-plex-mono`
- Pretendard 제거 (중복 폰트 금지)
- 숫자: `font-variant-numeric: tabular-nums` (앱: `fontVariant: ['tabular-nums']`)

| 토큰 | 웹 size/line | weight | 용도 |
|---|---|---|---|
| `display` | 40/44 (모바일 32/36), -0.02em | 600 | 페이지 제목 |
| `readout-xl` | 64/64 (모바일 48) | 500 | 핵심 판독값 (적재율) |
| `readout` | 28/32 | 500 | 보조 판독값 |
| `title` | 22/28 | 600 | 섹션 제목 |
| `body` | 15/22 | 400 | 본문 |
| `label` | 13/18 | 500 | 필드 라벨 (대문자 변환 금지) |
| `caption` | 12/16 | 400 | 축·보조 |
| `mono` | 13/18 Plex Mono | 400 | 시각·ID |

### 2.5 간격 · 형태 · 깊이
- 간격 4 기반: `4 8 12 16 24 32 48 64` (`--s1`…`--s8`). 컴포넌트에 임의 px 금지
- 반경: 괘선/표 `0`, 입력·칩·태그 `2px`, 패널·대화상자 `4px`, 긴급정지 `6px`, 상태 점 `50%`. **카드 전체를 둥글게 만들지 않는다**
- 그림자: `--shadow-overlay` 하나만 (드로어·대화상자·토스트). 그 외 0
- 포커스: 2px `--accent` 외곽선 + 2px offset

### 2.6 모션
- 상태 변화만: 컬럼 채움 높이 240ms ease-out, 상태색 150ms, 명령 단계 표시 150ms, 드로어 200ms
- 무한 반복 애니메이션 금지 (예외: "ACK 대기" 중 진행 표시 1개, reduced-motion 시 정적 텍스트)
- `prefers-reduced-motion` / RN `AccessibilityInfo.isReduceMotionEnabled` 존중
- 신규 애니메이션 라이브러리 금지 (CSS transition / RN Animated)

---

## 3. 그리드 · 내비게이션

### 3.1 웹 브레이크포인트
| 이름 | 폭 | 내비 | 페이지 여백 | 거터 |
|---|---|---|---|---|
| xl | ≥1440 | 사이드바 240px | 40 | 24 |
| lg | 1280–1439 | 사이드바 240px | 32 | 24 |
| md | 1024–1279 | 아이콘 레일 64px (툴팁·aria-label) | 24 | 16 |
| sm | 768–1023 | 상단바 + 드로어 | 24 | 16 |
| xs | <768 | 상단바 + 드로어 | 16 | 12 |

- 12단 그리드, 콘텐츠 최대 폭 1560px, 헤더 높이 56px (고정)
- 가로 스크롤 금지 (표는 컨테이너 안에서만 스크롤)

### 3.2 내비게이션 (웹 7개)
| 라벨 | 경로 | 비고 |
|---|---|---|
| 개요 | `/` | |
| 수거함 | `/bins`, `/bins/:binId` | 기존 `/bins/:binId` 유지 |
| 장치 | `/devices` | 기존 경로 유지 |
| 제어 센터 | `/control` | 신규 (웹 제어) |
| 이력 | `/history` | 신규 |
| 분석 | `/analytics` | 신규 |
| 설정 | `/settings` | 신규 (보정·연결·앱 설정 이동) |

활성 항목: 좌측 3px `--ink` 막대 + 굵은 라벨. 사이드바 하단에 장치 ID·데이터 출처.

### 3.3 헤더 (OperationalHeader)
좌: 현재 페이지 제목(작게) · 우: 장치 연결 표시(실제 `connection_status` + `deviceHealth`), 마지막 수신 시각(`last_seen`, 상대+절대), 실시간 연결(WS 상태), 데이터 출처 표시(시뮬레이터/Mock일 때만: "시뮬레이터 데이터" — 오렌지 점선 테두리 태그, 대문자 금지), 테마 전환(라이트/다크/시스템). 알림·사용자 메뉴는 기능이 없으므로 **만들지 않는다**.

---

## 4. 페이지 사양 (웹)

### 4.1 개요 `/`
```
┌ display: 개요 ───────────────────────────── 기준 시각 19:47:50 ┐
│ [8 cols] MATERIAL COLUMNS ×4 (같은 기준선)   │ [4 cols] 장치 건강      │
│  PL ▮72%  CN ▮45%  PA ▮30%  GN ▮91%           │  ● 저하 · 사유 목록      │
│  거리·센서·마지막 측정 (컬럼 아래 ledger 행)    │  센서 4/4 · MQTT · 수신  │
│                                              │ ─ 조치 필요 ─           │
│                                              │  GN 91% 경고 / CN 센서… │
├──────────────────────────────────────────────┼────────────────────────┤
│ [8] 적재율 추이 24h (trend API, 임계선, 재질색) │ [4] 최근 이벤트 (명령)   │
└──────────────────────────────────────────────┴────────────────────────┘
```
- 평균 적재율은 장치 건강 블록 안의 보조 판독값 (주인공 아님)
- 위험 bin: 컬럼 채움색 + 컬럼 아래 한 줄 경고 텍스트. 화면 전체를 붉게 만들지 않음
- "조치 필요"가 비면 "조치할 항목 없음"

### 4.2 수거함 `/bins` · `/bins/:binId`
- 목록: ledger 표 — 코드칩 · 재질 · 적재율(작은 컬럼 아이콘+수치) · 거리 · 센서 · 단계 · 마지막 측정 · 24h 스파크라인(trend API). 행 클릭 → 상세
- 상세: 좌 4단 큰 Material Column + readout-xl / 우 8단: 원시 거리·보정 범위(빈 통/가득 기준, 현재 거리의 위치를 수평 눈금으로) · 측정 이력 차트(`/history?limit=200`, 축 단위 %, 시각 HH:mm, 오류 측정은 차트 하단 붉은 틱) · 최근 측정 표(Mono). 보정 편집은 설정 페이지로 링크(+ 현재 보정값 읽기)

### 4.3 장치 `/devices`
- 건강 상태 4단계 명시 (healthy/degraded/offline/unknown, `deviceHealth`) — 색 + 텍스트 + 사유
- 정의 목록(dl) ledger: 장치 ID · 이름 · 연결 · 마지막 heartbeat · 펌웨어 · 데이터 출처 · 운전 모드 · 긴급정지 · 서버↔브로커(MQTT, `/health`) · 센서 건강(bin별 상태) · 모터 건강(마지막 OPEN_BIN 결과, "서보 위치 센서 없음 — ACK 기준" 주석)

### 4.4 제어 센터 `/control` (웹 신규)
```
┌ 긴급 정지 스트립 (전체 폭, 높이 72, --critical) ── [긴급 정지] ┐
├ 운전 모드: [수동 | 자동] (세그먼트)  · 장치 상태 요약          ┤
├ 배출구 4개 (PL CN PA GN): 선택 → "PL 배출구 작동" 확인 버튼(--signal) ┤
├ 명령 진행: 요청 → 전송 → 장치 응답 (단계 표시) + 결과/오류        ┤
└ 최근 명령 로그 ───────────────────────────────────────────────┘
```
- 긴급정지: **한 번 누르면 즉시** (안전 방향). 해제(`RESET_ESTOP`)는 확인 대화상자
- 배출구: 2단계 (재질 선택 → 확인 버튼). 자동 모드 전환도 확인
- 비활성 사유 표시 (`controlRules` 와 동일 규칙: offline/busy/estop/auto/토큰 없음)
- 토큰 미설정 시 설정 페이지 링크
- 진행 표시는 실제 상태만: PENDING→SENT(전송됨·장치 응답 대기)→SUCCEEDED/FAILED/TIMEOUT

### 4.5 이력 `/history`
- 탭: 측정 | 명령
- 필터: 기간(1시간/24시간/7일/사용자 지정 from–to), bin, 센서 상태, 출처(hardware/simulator) / 명령: 종류, 상태
- 정렬: 시각 오름/내림 (서버 `order`)
- 페이지네이션: 50행, 이전/다음 + "n–m / 총 N" (서버 `offset`)
- 표: 시각(Mono) · 이벤트 · 장치 · bin(코드칩) · 측정값(거리/적재율) · 결과 · 상태. 필터 상태는 URL 쿼리에 반영

### 4.6 분석 `/analytics`
- 기간: 24시간(버킷 60분) / 7일(버킷 360분) / 30일(버킷 1440분)
- ① 적재율 추이 (trend avg, 재질색 선, 임계선 50/80/95, 빈 버킷은 선 끊김)
- ② 재질별 비교 (statistics avg/max 가로 막대 — 수치 라벨 포함)
- ③ 센서 가용률 = 정상 표본/전체 표본 (bin별, 표본 수 함께 표기)
- ④ 명령 결과 분포 (status별 개수)
- ⑤ 장치 가용률: **기록되지 않음** — "연결 이력은 저장하지 않습니다" 정직한 안내
- 표본이 부족하면 (예: <3 버킷) 차트 대신 "데이터 부족 — 표본 N개" 표시. 데이터를 지어내지 않음

### 4.7 설정 `/settings`
그룹(좌측 앵커 목록 + 우측 섹션): 장치(읽기) · 센서 & 보정(bin별 보정 편집, 기존 기능 이전) · 임계값(읽기 전용: 50/80/95, 서버 is_full 95 — 변경 방법 안내) · 연결(API/WS 주소, WS 상태, `/health`) · 앱(테마, 데이터 출처 실제/Mock, 제어 토큰)

---

## 5. 모바일 앱 사양
- 탭 5개: **홈 · 수거함 · 제어 · 이력 · 설정** (아이콘+라벨, 하단 safe-area)
- 홈: 상단 장치 건강 한 줄(상태·마지막 수신) → 2×2 Material Column(컴팩트, 코드칩·수치·단계) → 조치 필요 목록
- 수거함: 목록(ledger 행) → 상세(`bin/[id]`): 큰 판독값, 컬럼, 이력 미니 차트, 최근 측정
- 제어: 스크롤 영역(모드 세그먼트, 2×2 배출구 버튼 — **길게 누르기 0.6초**로 작동, 진행 표시) + **화면 하단 고정 긴급정지 바**(엄지 영역, 탭 바 위, 한 번 탭 즉시) + 해제는 확인
- 이력: 측정/명령 세그먼트, 무한 스크롤 대신 "더 보기"(offset)
- 설정: 그룹 리스트 (장치·보정(읽기 + 웹 안내 or 편집)·임계값·연결·앱(테마, 토큰))
- 터치 타깃 ≥44pt, 본문 ≥15, 가로 넘침 금지, safe-area 준수
- 차트: `react-native-svg`(Expo 호환, MIT)로 스파크라인/라인 — 필요 시에만 추가

---

## 6. 컴포넌트 계층 (웹 기준, 앱은 대응 컴포넌트)
```
AppShell ─ ResponsiveNavigation, OperationalHeader(DeviceHealthIndicator, ConnectionIndicator, DataSourceTag, ThemeToggle)
Pages ─ Overview, Bins, BinDetail, Devices, Control, History, Analytics, Settings
Domain ─ MaterialCode, MaterialColumn, Readout, BinLedgerRow, DeviceHealthPanel, AttentionList,
         CapacityTrendChart, MeasurementChart, EventLog, ModeSelector, BinActuator, EmergencyStopControl,
         CommandProgress, CalibrationForm, FilterBar, Pagination, EmptyState/LoadingState/ErrorState
Primitives ─ Section(ledger rule + title), DataList(dl), Table, Button(primary/signal/danger/quiet), Segmented, Dialog, Tag, StatusDot
```
- 비즈니스 로직(상태 판정·필터→쿼리 변환·명령 전송)은 hooks/lib, 표현은 컴포넌트
- 공용 규칙은 `shared/src` (`deviceHealth`, `fillLevel`, 라벨) — 중복 구현 금지

## 7. 기능 보존 체크리스트 (PASS 6)
- [ ] 모든 기존 경로 동작 (`/`, `/bins/:binId`, `/devices`) + 신규 경로
- [ ] 초기 스냅샷 + WS 증분 + 재연결 재동기화
- [ ] 명령: ACK 전 "실행 완료" 없음, FAILED/TIMEOUT 사유 표시
- [ ] null 적재율 ≠ 0%
- [ ] 시뮬레이터/Mock 출처 표시
- [ ] 보정 PUT (토큰)
- [ ] 기존 테스트 + 신규 테스트 통과, 빌드 통과, 콘솔 오류 0, 가로 넘침 0

## 8. 시각 QA (PASS 7)
`scripts/screenshot.sh --base <url> --pages <경로들> --widths 1920,1440,1280,768,390 --full`
(정확한 뷰포트 폭 에뮬레이션, 콘솔 오류·가로 넘침 자동 보고). 라이트·다크 각각 주요 페이지 확인.
