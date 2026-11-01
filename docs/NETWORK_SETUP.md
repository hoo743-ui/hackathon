# 네트워크 설정 (맥북 ↔ 카메라 노트북 ↔ 스마트폰)

## 1. 원칙
- 세 기기 모두 **같은 Wi-Fi(같은 서브넷)**. 학교/행사 Wi-Fi가 기기 간 통신을 막으면(클라이언트 격리) **휴대폰 핫스팟** 하나에 셋 다 연결한다.
- 카메라 노트북·스마트폰에서 서버 주소는 **맥북 LAN IP**. `localhost`는 그 기기 자신을 뜻하므로 절대 쓰지 않는다.
- 맥북 웹 브라우저에서는 `localhost:5173`도 되지만, 다른 기기에서는 `http://<맥북IP>:5173`.

## 2. 맥북 IP 확인
```bash
ipconfig getifaddr en0        # Wi-Fi (예: 172.16.236.252 — 2026-10-31 확인값, 장소가 바뀌면 달라짐)
```
`./start_server.sh` 가 시작할 때 IP를 다시 읽어 `.env` 의 앱 주소(`EXPO_PUBLIC_*`)를 갱신하고 마지막에 접속 주소를 출력한다.
웹은 `VITE_API_BASE_URL` 을 비워 두면 **웹을 연 주소의 호스트:8000** 으로 자동 접속한다.

## 3. 맥북 방화벽 / 포트
- 확인: `/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate` (2026-10-31: **비활성** 확인)
- 켜져 있다면 시스템 설정 › 네트워크 › 방화벽 › 옵션에서 Python(uvicorn)·node 수신 허용
- 사용 포트: **8000**(API·WS), **5173**(웹), **8081**(Expo), 5432/1883(맥북 내부 전용, 127.0.0.1 바인딩)
- 포트 점유 확인: `lsof -nP -iTCP:8000 -sTCP:LISTEN`

## 4. 카메라 노트북 설정
`edge/.env` (또는 EXE 폴더의 `.env`):
```
BACKEND_URL=http://<맥북IP>:8000
AI_API_TOKEN=<맥북 저장소 루트 .env 의 AI_API_TOKEN 값>
DEVICE_ID=CAMERA_001
```
`AI_API_TOKEN` 은 비밀값이다. 메신저 공개 채널에 붙여넣지 말고 USB/직접 입력으로 옮긴다.

## 5. 연결 시험 (카메라 노트북에서)
| 순서 | Windows | macOS/Linux | 기대 결과 |
|---|---|---|---|
| ① ping | `ping <맥북IP>` | `ping -c 3 <맥북IP>` | 응답 (일부 Wi-Fi는 ICMP 차단 → ②로 판단) |
| ② health | `curl http://<맥북IP>:8000/api/health` | 같음 | `"status":"ok"`, `"hardware_mode":"EDGE_SERIAL"` |
| ③ 인증·전체 | `python check_system.py` | 같음 | 백엔드 /api/health · 인증 PASS |
| ④ 업로드 | `python check_system.py --upload-test <쓰레기사진.jpg>` | 같음 | 업로드 시험 PASS + 웹에 즉시 표시 |
| ⑤ WebSocket | (맥북에서) `backend/.venv/bin/python scripts/ws_consistency_check.py --base http://<맥북IP>:8000 --seconds 60` | | 웹·앱 경로 모두 같은 detection_id |

## 6. 스마트폰
- Expo Go 설치 → 맥북에서 `./start_server.sh --mobile` (또는 `scripts/mobile.sh`) → QR 스캔
- 앱 주소는 `mobile/app/.env` 의 `EXPO_PUBLIC_API_BASE_URL=http://<맥북IP>:8000` (start/mobile 스크립트가 자동 갱신)
- 폰 브라우저로 `http://<맥북IP>:8000/api/health` 가 열리는지 먼저 확인하면 원인 분리가 빠르다.

## 7. 휴대폰 핫스팟으로 전환 (행사장 Wi-Fi가 기기 간 통신을 막을 때)
증상: 카메라 컴퓨터 브라우저에서 `http://<맥북IP>:8000/api/health` 가 열리지 않고, 서버 로그(`logs/backend.log`)에 카메라 컴퓨터 IP의 요청이 한 줄도 없다 (401 도 없음) → 클라이언트 격리.

1. 폰 핫스팟 켜기 (아이폰: "최대 호환성" 켜기) · 충전기 연결
2. 맥북 · 카메라 컴퓨터 · 앱 볼 폰을 모두 그 핫스팟에 연결
3. 맥북: `scripts/update-lan-ip.sh --print` → 새 IP 반영 + 카메라 컴퓨터에 넣을 주소 출력
   (서버는 0.0.0.0 으로 떠 있어 재시작 불필요, CORS 는 사설 대역 정규식으로 허용 — 10.x / 172.16~31.x / 192.168.x)
4. 맥북: Expo 재시작 `scripts/mobile.sh` (앱 주소는 Expo 시작 시 고정됨) → 폰 Expo Go `exp://<새IP>:8081`
5. 카메라 컴퓨터: 브라우저로 `http://<새IP>:8000/api/health` 확인 → 프로그램 **설정 › 맥북 서버 주소** 변경 → 저장 후 재시작
6. 맥북: `grep -v "<맥북IP>" logs/backend.log | tail` 로 카메라 컴퓨터 요청(`POST /api/edge/heartbeat 200`) 확인

핫스팟을 끄거나 바꾸면 IP 가 다시 바뀐다 → 시연 끝까지 같은 핫스팟 유지.

## 8. 장애 대응
| 증상 | 원인 후보 | 조치 |
|---|---|---|
| 카메라 GUI "맥북 서버 연결 안 됨" | IP 변경, 다른 Wi-Fi, 서버 꺼짐 | 맥북 `ipconfig getifaddr en0` → `.env` 수정 → GUI "서버 재시도". 그동안 분류는 outbox에 저장됨 |
| 웹은 되는데 폰 앱만 안 됨 | 폰이 다른 네트워크(LTE) | 폰 Wi-Fi 확인, 앱 주소 확인 |
| 웹 콘솔 CORS 오류 | 낯선 출처 | `.env` `CORS_ORIGIN_REGEX`(사설 IP 대역 허용) 확인 후 백엔드 재시작 |
| HTTP 401/403 | 토큰 불일치 | 카메라 `.env` `AI_API_TOKEN` = 맥북 `.env` 값 |
