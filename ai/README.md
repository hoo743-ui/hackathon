# AI 모듈 (PHASE 7 — 미구현)

카메라 미보유 상태이므로 현재 구현하지 않는다.

계획된 흐름: 웹캠 → OpenCV → YOLO → 분류 결과 → `POST /api/detections` → (AUTO 모드일 때) 서버가 `OPEN_BIN` 명령 생성 → MQTT → ESP32

- 이 모듈은 MQTT/ESP32에 직접 접근하지 않는다. 서버 API만 사용한다.
- 결과 필드: `waste_type`, `confidence`, `detected_at`, `image_reference`(선택)
- 신뢰도 임계값 미만이면 명령을 생성하지 않는다(임계값은 설정값).
