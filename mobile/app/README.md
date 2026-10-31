# 스마트 분리수거 모바일 앱 (Expo)

React Native + Expo SDK 58 + TypeScript + expo-router. "Material Ledger" 디자인(docs/design/REDESIGN_PLAN.md §5). 탭 5개: 홈 · 수거함 · 제어 · 이력 · 설정 + 수거함 상세. 폰트(IBM Plex Sans KR / Plex Mono)는 앱에 번들됩니다.
타입·API 클라이언트·WebSocket 재연결·상태 병합은 모두 `../../shared/src`(웹과 공용)를 사용합니다 (`services/shared.ts`).

## 환경 변수
Expo는 `mobile/app/.env` 의 `EXPO_PUBLIC_*` 만 읽습니다. 루트 `.env` 의 두 값을 복사하세요.

```bash
cd mobile/app
cp .env.example .env
# 그리고 루트 .env 의 값으로 교체:
# EXPO_PUBLIC_API_BASE_URL=http://<Mac LAN IP>:8000
# EXPO_PUBLIC_WS_URL=ws://<Mac LAN IP>:8000/ws/dashboard
```

- `EXPO_PUBLIC_*` 값은 앱 번들에 그대로 포함되므로 **비밀값을 넣지 마세요.** 제어 토큰은 앱의 설정 탭에서 입력하며 기기의 SecureStore에 저장됩니다.
- Mac LAN IP 확인: `ipconfig getifaddr en0`
- `.env` 변경 후에는 `npx expo start -c` 로 캐시를 지우고 재시작하세요.
- 백엔드는 LAN에서 접근 가능해야 합니다 (`API_HOST=0.0.0.0`).

## 실행
```bash
npm install
npx expo start            # QR 표시
```
- iOS 시뮬레이터: `i` 키 (localhost 사용 가능)
- Android 에뮬레이터: `a` 키 (localhost 대신 `10.0.2.2` 또는 LAN IP)
- 실기기: 폰과 Mac을 같은 Wi-Fi에 연결 → Expo Go로 QR 스캔. `.env` 에 반드시 LAN IP 사용.
  학교/공용 Wi-Fi처럼 기기 간 통신이 막힌 망에서는 동작하지 않을 수 있습니다.

## 검증
```bash
npx tsc --noEmit      # 타입 검사 (shared/src 포함)
npm test              # jest-expo 단위 테스트 (오류 코드 매핑, 배출 차단 규칙)
npx expo export --platform ios --output-dir /tmp/expo-export   # Metro가 shared 를 해석하는지 확인
```

## 구조
- `app/` 라우트: `(tabs)/index`(홈), `(tabs)/bins`(수거함), `(tabs)/control`(제어 — 배출구는 0.6초 길게 누르기, 하단 고정 긴급 정지), `(tabs)/history`(측정/명령 이력), `(tabs)/settings`(장치·보정·임계값·연결·앱), `bin/[id]`(수거함 상세)
- `theme/` 토큰·테마(시스템/라이트/다크, 저장됨), `components/` MaterialColumn·MaterialCode·Readout·HoldButton·EStopBar 등, `services/` 순수 규칙(테스트 대상)
- `services/` API/실시간 연결과 대시보드 상태(`DashboardContext`, 공용 `applyEvent` 기반), 오류 메시지 매핑, 명령 ID(UUID v4)
- `components/` 카드·배지·적재율 바·스파크라인 등 UI
- `theme/tokens.ts` 디자인 토큰 (웹과 동일한 색상·타입 스케일 이름, 라이트/다크)

## 규칙
- 적재율은 서버의 `current_fill_percent` 만 표시합니다. `null` 은 0%가 아니라 "미보정/--".
- 명령 전송 직후 상태는 "전송됨 · ACK 대기"이며, `command.updated`(또는 폴링)에서 `SUCCEEDED` 일 때만 "실행 완료"로 표시합니다.
- `metro.config.js` 의 `watchFolders` 가 `../../shared` 를 포함합니다.
