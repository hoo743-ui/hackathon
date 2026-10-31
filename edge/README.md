# edge/ — 카메라 노트북(A) 프로그램

카메라 → YOLO → (USB 시리얼) Arduino 서보 구동 → 이미지·결과를 맥북 서버로 전송.
**이 프로그램 하나만 실행한다.** 시리얼 포트를 이 프로세스가 단독으로 사용한다 (Arduino IDE 시리얼 모니터·다른 파이썬 스크립트는 닫을 것).

| 파일 | 역할 |
|---|---|
| `smart_recycle_ai.py` | **통합 GUI** (영상 · 연결 상태 · 최근 분류 · 하드웨어 결과 · 로그 · 재확인/카메라 재시작/서버 재시도/안전 종료). EXE 진입점 |
| `start_camera_system.py` | 같은 기능의 CLI 버전 (OpenCV 창). `--source 이미지`, `--no-hw`, `--headless` |
| `check_system.py` | 사전 점검: 패키지 · 모델/클래스 매핑 · 카메라 · 시리얼 포트 · 백엔드 · 업로드 (PASS/FAIL/NOT TESTED) |
| `smartrecycle_edge/` | config · detector(안정 검출) · hardware(시리얼 단독 소유) · uploader(재시도·outbox) · serial_ports |
| `build_exe.bat` / `build_exe.sh` | PyInstaller 빌드 → `dist/SMART_RECYCLE_AI/SMART_RECYCLE_AI(.exe)` |
| `tests/` | 단위 시험 (`python -m pytest tests`) |

## 처음 설정 (Windows 기준, macOS/Linux는 괄호)
```bat
cd edge
py -3.11 -m venv .venv            (python3 -m venv .venv)
.venv\Scripts\activate            (source .venv/bin/activate)
pip install -r requirements.txt
copy .env.example .env            (cp .env.example .env)  → BACKEND_URL·AI_API_TOKEN·HW_SERIAL_PORT 편집
copy <어딘가>\best_model.pt models\
python check_system.py --cameras
python check_system.py --serial-open        ← GUI를 켜기 전에만
python check_system.py --upload-test 쓰레기사진.jpg
python smart_recycle_ai.py                  ← 시연 실행 (또는 EXE)
```

## EXE 만들기 (카메라 노트북에서 1회)
`build_exe.bat` 더블클릭 → `dist\SMART_RECYCLE_AI\SMART_RECYCLE_AI.exe`.
폴더째 사용하며 같은 폴더의 `.env`, `models\best_model.pt`, `logs\`, `outbox\` 를 쓴다. (약 0.9GB — torch 포함)
Windows EXE는 Windows에서만 빌드된다 (PyInstaller는 교차 빌드 불가).

## 분류 1회 판정
같은 클래스가 `STABLE_FRAMES`(4)프레임 + `STABLE_MIN_SEC`(0.4초) 연속 → 1회 처리 → 물체가 `CLEAR_SEC`(1초) 동안 사라지거나 다른 물체로 바뀌기 전까지 잠금, 처리 간격 최소 `SEND_COOLDOWN`(2초), 모터 동작 중(`HW_BUSY_SEC` 6.5초)에는 새 처리 안 함.

## 하드웨어 결과 표시
| 값 | 의미 |
|---|---|
| `command_sent` | 시리얼로 명령 전송 성공. **Arduino가 응답하지 않으므로 동작 완료가 아님** |
| `not_connected` | 포트 미연결 → 모터 명령 없음 |
| `serial_failed` | 쓰기 실패 (케이블 분리 등) |
| `skipped_busy` | 직전 동작 중 → 생략 |
| `disabled` | `HW_ENABLED=false` 이거나 모델 클래스가 4종에 없음 |
