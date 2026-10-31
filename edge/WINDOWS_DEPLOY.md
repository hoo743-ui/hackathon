# Windows 카메라 컴퓨터 배포 (SMART_RECYCLE_AI.exe)

카메라 컴퓨터 = **Windows 10/11 64bit**. 현장 AI(추론 전용)·하드웨어 제어 컴퓨터. 서버는 맥북.

## 1. 한 번만 준비 (인터넷 필요)
1. **Python 3.11 64bit** 설치 — https://www.python.org/downloads/windows/ → "Add python.exe to PATH" 체크
2. **Microsoft Visual C++ 재배포 패키지(x64)** — torch/OpenCV 실행에 필요: https://aka.ms/vs/17/release/vc_redist.x64.exe
3. USB 드라이버: ESP32 DevKitC V4 = **CP210x** (Silicon Labs), 클론 UNO = **CH340**. 정품 UNO 는 Windows 기본 드라이버
4. 저장소 받기 → `edge` 폴더에서 **`build_exe.bat` 더블클릭** (venv 생성 → 라이브러리 설치 → PyInstaller 빌드, 10~20분)
5. 결과: `edge\dist\SMART_RECYCLE_AI\` 폴더 (약 0.9GB). **폴더째** 바탕화면 등으로 복사해서 사용
   ```
   SMART_RECYCLE_AI\
     SMART_RECYCLE_AI.exe
     .env                    ← 설정 (프로그램 '설정' 버튼으로도 수정)
     models\best_model.pt    ← 모델 (빌드 때 edge\models 에 있으면 자동 복사)
     logs\smart_recycle_ai.log   ← 실행·오류 로그 (2MB × 4개 순환)
     outbox\                 ← 서버 끊김 시 못 보낸 분류 (복구 시 자동 재전송)
     _internal\              ← 런타임 (건드리지 않음)
   ```
   빌드가 안 되면: `run_ai.bat` (가상환경 Python 으로 같은 GUI 실행)

## 2. 첫 실행
`SMART_RECYCLE_AI.exe` → 필수 설정이 없으면 **설정 창이 자동으로 열린다**
| 항목 | 값 |
|---|---|
| 맥북 서버 주소 | `http://<맥북 LAN IP>:8000` (localhost 입력 시 저장 거부) |
| AI_API_TOKEN | 맥북 저장소 `.env` 의 값 |
| 카메라 번호 | "탐색" 버튼 → 사용 가능 번호 |
| Arduino UNO 포트 | 목록에서 선택(`COM5` 등) 또는 `auto` — 장치 관리자 › 포트(COM & LPT) "Arduino Uno" |
| ESP32 포트 | 목록에서 "CP210x" 쪽 COM (없으면 비움) |
| 모델 경로 | 기본 `models/best_model.pt`, 다른 위치면 "찾기…" |
| 초음파 센서 칸 / 빈 통 거리 | `BIN_00x` / 실측 cm |
"저장 후 재시작" → 프로그램이 다시 시작하며 모델(1회 로드)·카메라·포트를 연다.

## 3. 시작 순서 (프로그램 내부)
설정 확인 → 모델 경로 결정(① 설정값 ② 실행 폴더 models\best_model.pt ③ 설정 화면에서 선택) → 존재·로딩 검사(손상 시 오류 표시, 추론 안 함) → 메모리 1회 로드 → 시험 추론(GPU 실패 시 CPU 전환) → 카메라 → 실제 프레임 추론 확인 → 탐지 → 1회 판정 → UNO 명령 → ACK 대기 → 서버 전송
- **INFERENCE ONLY**: 학습·데이터셋·YAML 을 쓰지 않는다. 학습은 별도 개발 환경(`ai/`)에서만.
- 장치: `YOLO_DEVICE=auto` → NVIDIA CUDA 가능하면 GPU, 아니면 CPU (GUI "추론" 줄에 표시)

## 4. 시리얼 포트 규칙
- 포트는 이 프로그램만 연다. **Arduino IDE 시리얼 모니터를 닫는다.** ("Access is denied" = 다른 프로그램 사용 중)
- 케이블을 뽑았다 꽂으면 COM 번호가 바뀔 수 있다 → "연결 재확인" 또는 설정에서 다시 선택

## 5. 검증 상태
Windows 에서 실제 빌드·실행 시험은 **NOT TESTED** (이 작업 환경에 Windows 기기 없음). 같은 코드의 macOS 빌드는 실행·추론·전송 PASS. 현장에서 `docs/DEMO_END_TO_END_TEST.md` 5절 체크리스트로 확인한다.
