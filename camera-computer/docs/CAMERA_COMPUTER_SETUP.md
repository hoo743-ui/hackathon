# 카메라 컴퓨터 설치·점검 가이드

## 1) 카메라 컴퓨터의 역할
- 카메라 촬영 (OpenCV)
- YOLO 추론 (`best_model.pt`, Glass / Metal / Paper / Plastic)
- USB 시리얼 통신 — 기존 `yolo_arduino.py` 기준으로 **Arduino UNO(`trush.ino`)** 에 `G/M/P/L` 1바이트 전송 → 서보 3개 동작
- (이후 단계) 결과를 메인 서버(MacBook)로 보내는 클라이언트 — 이 브랜치 범위 밖

## 2) 사전 준비물
| 항목 | 비고 |
|---|---|
| Python 3.10 또는 3.11 | 3.9~3.12 동작. Windows는 python.org 설치본 (“Add python.exe to PATH” 체크) |
| VS Code (선택) | Python 확장 설치 → 인터프리터로 `.venv` 선택 |
| Git | 저장소 clone |
| USB 카메라 또는 노트북 내장 카메라 | |
| Arduino UNO R3 · ESP32 DevKitC V4 | USB **데이터** 케이블. 드라이버: CP210x(ESP32), CH340(클론 UNO) |
| `best_model.pt` | 저장소에 없음 → 팀에게 받아 `models/` 에 복사 |

## 3) 설치
```bash
git clone https://github.com/hoo743-ui/hackathon.git
cd hackathon
git checkout feature/camera-computer-setup
cd camera-computer
```
| OS | 자동 설치 | 가상환경 활성화 |
|---|---|---|
| Windows | `powershell -ExecutionPolicy Bypass -File .\setup_windows.ps1` | `.\.venv\Scripts\Activate.ps1` (cmd: `.venv\Scripts\activate.bat`) |
| macOS | `bash setup_macos_linux.sh` (`brew install python@3.11` 먼저) | `source .venv/bin/activate` |
| Ubuntu | `sudo apt install python3-venv` 후 `bash setup_macos_linux.sh` | `source .venv/bin/activate` |

수동 설치:
```bash
python -m venv .venv            # Windows: py -3.11 -m venv .venv
(가상환경 활성화)
python -m pip install --upgrade pip
pip install -r requirements.txt
cp .env.example .env            # Windows: copy .env.example .env
```
- `torch`/`torchvision` 은 ultralytics 와 함께 **CPU 버전**으로 설치된다. GPU 없이도 동작한다.
- NVIDIA GPU 가 있는 경우에만: `nvidia-smi` 로 확인 → https://pytorch.org/get-started/locally/ 의 CUDA 명령으로 torch 를 먼저 설치 → `pip install -r requirements.txt`. CUDA 버전은 GPU·드라이버에 맞춰 고른다(임의 고정 금지).

## 4) 모델 파일
```
camera-computer/models/best_model.pt     (.env: MODEL_PATH=models/best_model.pt)
python test_yolo.py                       # 로딩 + 클래스 목록 + 기존 매핑 대조
python test_yolo.py --image 쓰레기.jpg     # 단일 이미지 추론 → captures/yolo_쓰레기.jpg
```
기존 코드 가정: `0 Glass→G`, `1 Metal→M`, `2 Paper→P`, `3 Plastic→L`. 다르면 WARN → 팀 확인. 상세: `models/README.md` (Git LFS / 배포 방법)

## 5) 카메라 시험
```bash
python test_camera.py --scan                 # 0~5번 탐색
python test_camera.py                        # .env CAMERA_INDEX 실시간 영상 (q/ESC 종료)
python test_camera.py --index 1              # 다른 카메라
python test_camera.py --no-window --frames 60
```
오류: 다른 앱(Zoom·Teams·카메라 앱) 종료, OS 카메라 권한(아래 8절), USB 포트 변경.

## 6) ESP32 / Arduino 시리얼
```bash
python check_serial.py               # 포트 목록 · 보드 추정(VID) · 설정 포트 결정
python check_serial.py --open        # 실제로 열어 2초 수신 (아무것도 보내지 않음)
python check_serial.py --open --port COM6 --baud 115200    # ESP32 로그 확인
```
| OS | 포트 이름 | 확인 방법 |
|---|---|---|
| Windows | `COM3`, `COM5` … | 장치 관리자 › 포트(COM & LPT) |
| macOS | `/dev/cu.usbmodem*`(UNO), `/dev/cu.usbserial-*`·`/dev/cu.SLAB_USBtoUART`(ESP32) | `ls /dev/cu.*` |
| Linux | `/dev/ttyACM0`(UNO), `/dev/ttyUSB0`(ESP32/CH340) | `ls /dev/ttyACM* /dev/ttyUSB*` |

- `.env`: `SERIAL_PORT=COM5`, `BAUD_RATE=9600` (trush.ino `Serial.begin(9600)`), ESP32 는 `115200` (esp32.ino).
- **포트 점유**: 시리얼 포트는 한 프로세스만 열 수 있다. Arduino IDE 시리얼 모니터, YOLO 프로그램, 이 진단 도구를 동시에 열지 않는다.
- UNO 는 포트를 열 때 자동 리셋된다 (2초 대기 필요 — 기존 코드의 `time.sleep(2)`).

## 7) 전체 점검 순서
```bash
python check_environment.py
python test_camera.py --scan
python test_yolo.py --image <쓰레기 사진>
python check_serial.py --open
```

## 8) 자주 발생하는 오류
| 오류 | 해결 |
|---|---|
| `ModuleNotFoundError` | 가상환경 활성화 확인 (`which python` / `where python`) → `pip install -r requirements.txt` |
| Python 버전 불일치 | `py -0p`(Windows)로 설치 목록 확인 → `py -3.11 -m venv .venv` 로 다시 생성 |
| PyTorch 설치 오류 | `pip install --upgrade pip` 후 재시도. Python 3.13+ 이면 3.11 로 |
| CUDA 인식 실패 (`cuda.is_available()==False`) | `nvidia-smi` 확인, CPU 버전 torch 가 설치된 경우 pytorch.org 의 CUDA 명령으로 재설치. CPU 로도 시연 가능 |
| 카메라 인식 실패 | Windows: 설정 › 개인 정보 › 카메라 › 데스크톱 앱 허용 · macOS: 시스템 설정 › 개인정보 보호 › 카메라 › 터미널/VS Code · Linux: `/dev/video*`, video 그룹 |
| `SerialException` / `Access is denied` | 다른 프로그램이 포트 사용 중 → 종료. 포트 이름 오타 확인 |
| 포트 권한 (Linux) | `sudo usermod -aG dialout $USER` 후 재로그인 |
| 포트가 안 보임 | 충전 전용 케이블 교체, CP210x/CH340 드라이버 설치 |
| `best_model.pt` 경로 오류 | `.env` `MODEL_PATH` 확인 (camera-computer 기준 상대경로) |

## 9) 다른 개발자가 처음부터 재구성
```bash
git clone https://github.com/hoo743-ui/hackathon.git && cd hackathon
git checkout feature/camera-computer-setup && cd camera-computer
(OS별 setup 스크립트 실행)
best_model.pt → models/
.env 편집 (CAMERA_INDEX, SERIAL_PORT)
python check_environment.py && python test_camera.py --scan && python test_yolo.py --image 사진.jpg && python check_serial.py --open
```

## 10) 현재 검증 상태 (2026-10-31, MacBook Air arm64 · macOS 27.2 · Python 3.12.16 에서 실행)
| 항목 | 결과 | 비고 |
|---|---|---|
| Python 버전 | PASS(WARN) | 3.12 동작, 권장 3.10/3.11 |
| 가상환경 생성·활성화 | PASS | `setup_macos_linux.sh` 실제 실행 |
| 패키지 설치 | PASS | ultralytics 8.4.194, torch 2.15.0, torchvision 0.29.2, opencv-python 5.0.0, pyserial 3.5, requests 2.34.2, python-dotenv 1.2.4, numpy 2.5.4 |
| OpenCV / Ultralytics / PyTorch import | PASS | |
| GPU | PASS (Apple MPS) | NVIDIA CUDA: NOT TESTED |
| YOLO 모델 `best_model.pt` 로딩 | **FAIL / NOT TESTED** | 파일이 저장소·맥북에 없음 |
| 이미지 추론 | PASS (대체 모델) | 공개 `yolov8n.pt` + 예제 사진으로 로딩·추론·결과 저장 경로만 확인. 쓰레기 분류 검증 아님 |
| 카메라 | PASS | 맥북 내장 카메라 1920x1080, 10프레임 수신·해제 |
| Serial | NOT TESTED | USB 시리얼 장치 미연결 (목록 탐색·안내 출력은 동작) |
| Windows `setup_windows.ps1` | NOT TESTED | Windows 기기 없음 |
| Ubuntu | NOT TESTED | |

## 11) 기존 코드에서 발견한 점 (이 브랜치에서는 수정하지 않음)
1. `yolo_arduino.py` 의 `SERIAL_PORT = 'COM4'` 하드코딩 — 다른 PC에서는 포트가 다름.
2. `yolo_arduino.py` 가 보내는 `"C:L:3\n"` 카운트 메시지: `trush.ino` 는 수신 바이트를 한 글자씩 `switch` 하므로 그 안의 `L`/`G`/`M`/`P` 를 명령으로 다시 읽어 **서보가 한 번 더 동작**할 수 있다.
3. 명령을 받는 보드는 코드상 **Arduino UNO**(`trush.ino` `Serial`)이다. `esp32.ino` 는 USB 시리얼 명령을 처리하지 않는다.
4. `trush.ino` 는 ESP32로 `FULL:TRASH` 를 보내지만 `esp32.ino` 는 `DATA:` 로 시작하는 줄만 처리한다.
5. UNO D3(5V) → ESP32 GPIO16(3.3V) 직결은 위험 — 분압/레벨 시프터 필요.
6. `best_model.pt` 가 저장소에 없다.
