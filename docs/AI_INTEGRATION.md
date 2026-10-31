# AI 분류 프로그램 연동 (다른 노트북의 기존 코드)

AI 쪽 코드는 그대로 두고, **분류가 끝날 때마다 HTTP 요청 1번**만 추가하면 된다. 서버가 기록·자동 배출·결과 갱신·웹/앱 실시간 반영을 모두 처리한다.

```
[AI 노트북] 투입 감지 → 촬영 → 분류 ──POST /api/detections──▶ [서버]
                                                         ├ 기록 (detection_logs)
                                                         ├ 자동 모드 + 신뢰도 ≥ 임계값 → 배출 명령(origin=auto) → 장치 ACK
                                                         └ WebSocket → 웹·앱 (분류 기록·처리 결과)
```

## 1. 준비
- AI 노트북과 서버(Mac)가 같은 네트워크. 서버 주소: `http://<서버 LAN IP>:8000` (`ipconfig getifaddr en0`)
- 토큰: 서버 `.env`의 `AI_API_TOKEN` (제어 토큰과 별개 — AI 쪽은 장치를 직접 제어할 권한이 없다)
- 연결 확인: `curl http://<서버>:8000/health`

## 2. 요청 형식
```http
POST /api/detections
Authorization: Bearer <AI_API_TOKEN>
Content-Type: application/json

{
  "waste_type": "plastic",        // plastic | can | paper | general (그 외 값은 '인식 불가'로 기록만)
  "confidence": 0.87,             // 모델 출력 그대로 0~1 (가공 금지)
  "detected_at": "2026-10-31T10:00:00Z",  // 선택, 없으면 서버 수신 시각
  "model": "yolov8n-recycle-v3",  // 선택, 모델 이름/버전
  "image_reference": "captures/20261031-100000.jpg",  // 선택, AI 노트북 쪽 경로나 URL
  "detection_id": "6f1c2b8e-…",   // 선택(권장), UUID — 재전송 시 중복 기록 방지
  "device_id": "DEVICE_001"       // 선택, 기본 DEVICE_001
}
```
응답 `201` (같은 `detection_id` 재전송은 `200`): 저장된 기록 + `outcome`
| outcome | 의미 |
|---|---|
| `SORTING` → `SORTED` / `SORT_FAILED` | 자동 모드에서 배출 명령 전송 → 장치 ACK에 따라 갱신 |
| `LOW_CONFIDENCE` | 신뢰도 < `AI_CONFIDENCE_THRESHOLD`(기본 0.6) → 동작 안 함 |
| `UNRECOGNIZED` | 4개 분류 외 |
| `MANUAL_MODE` | 장치가 수동 모드 → 기록만 |
| `DEVICE_UNAVAILABLE` | 장치 오프라인·동작 중·긴급정지 등 (`outcome_detail`에 사유) |

## 3. 기존 코드에 붙이는 예 (Python, 표준 라이브러리만)
```python
import json, uuid, urllib.request
from datetime import datetime, timezone

SERVER = "http://192.168.0.10:8000"      # 서버 LAN IP
TOKEN = "…AI_API_TOKEN…"
LABEL_MAP = {"plastic": "plastic", "can": "can", "paper": "paper", "trash": "general"}  # 모델 클래스명 → 서버 분류

def report(label: str, confidence: float, image_path: str | None = None, model: str = "yolo"):
    body = {
        "waste_type": LABEL_MAP.get(label, label),
        "confidence": round(float(confidence), 4),
        "detected_at": datetime.now(timezone.utc).isoformat(),
        "model": model,
        "image_reference": image_path,
        "detection_id": str(uuid.uuid4()),
    }
    req = urllib.request.Request(
        f"{SERVER}/api/detections", data=json.dumps(body).encode(), method="POST",
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=3) as r:
            print("server:", json.load(r)["outcome"])
    except Exception as e:                 # 서버가 꺼져 있어도 AI 프로그램은 멈추지 않게
        print("report failed:", e)

# 분류 루프 안에서:
# label, conf = model_predict(frame)
# report(label, conf, image_path)
```
YOLO(ultralytics) 예: `r = results[0]; i = int(r.boxes.cls[0]); report(r.names[i], float(r.boxes.conf[0]))`

## 4. 확인
- 웹 **분류 기록** 화면 / 앱 **홈** 최근 분류에 바로 나타난다
- 자동 배출을 보려면 운영(웹) 또는 제어(앱)에서 **자동 모드**로 전환 (수동 모드에서는 기록만)

## 5. AI 노트북 없이 시연
```bash
scripts/simulate-detection.sh            # 10초마다 가상 분류 (source=simulator, 화면에 '시뮬레이터' 표시)
scripts/simulate-detection.sh --once --waste-type can --confidence 0.92
```
가상 분류는 `HARDWARE_MODE=SIMULATOR`에서만 서버가 받는다.

## 6. 상태 정직성
AI 프로그램은 별도 연결 신호(heartbeat)가 없으므로 화면은 "AI 연결됨"이 아니라 **마지막 분류 수신 시각**만 보여준다. 실제 모델 결과로 시험한 기록은 아직 없다 — **[AI] NOT TESTED** (다른 노트북 코드와 연결 후 `docs/TEST_REPORT.md`에 기록).
