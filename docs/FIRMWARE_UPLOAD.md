# 펌웨어 업로드 가이드 (Arduino UNO · ESP32) — Windows 카메라 컴퓨터

Arduino UNO 와 ESP32 는 **실물 보드**다. 설치하는 프로그램이 아니다.
보드 안에서 도는 프로그램(펌웨어)을 **한 번 업로드**하면 보드에 저장되고, 이후에는 USB 만 꽂고 `SMART_RECYCLE_AI.exe` 를 실행하면 된다.
업로드할 때만 **Arduino IDE** 가 필요하다.

| 보드 | 역할 | 올릴 펌웨어 | 시리얼 속도 |
|---|---|---|---|
| Arduino UNO R3 | 서보 3개 · 초음파 1개 직접 제어 | `firmware/uno_controller/uno_controller.ino` | 9600 |
| ESP32 DevKitC V4 | UNO 데이터 중계 · (선택) Wi-Fi 서버 전송 | `firmware/esp32_bridge/esp32_bridge.ino` | 115200 |

## 0. Arduino IDE 설치
https://www.arduino.cc/en/software → Windows 용 Arduino IDE 2.x 설치 (무료)

## 1. Arduino UNO
1. UNO 를 USB 로 연결 → **장치 관리자 › 포트(COM & LPT)** 에 "Arduino Uno (COM○)" 확인
   - 정품: 드라이버 자동 · 호환(클론) 보드(CH340 칩): **CH340 드라이버** 설치
2. Arduino IDE → **파일 › 열기** → `firmware/uno_controller/uno_controller.ino`
3. **도구 › 보드 › Arduino AVR Boards › Arduino Uno**
4. **도구 › 포트 › COM○** (UNO 쪽)
5. **업로드(→)**
   - "Servo.h: No such file" 이면: **스케치 › 라이브러리 포함 › 라이브러리 관리** → `Servo` 설치 후 다시 업로드
6. 확인: **도구 › 시리얼 모니터** → 속도 **9600**
   - `HELLO:UNO_CTRL:1` (펌웨어 정상), `DIST:23.4` (1초마다 거리) 또는 `DIST:ERR` (센서 배선 확인)
7. **시리얼 모니터 닫기** (열어 두면 SMART_RECYCLE_AI 가 포트를 못 연다)

> 원본 `trush.ino` 로도 서보는 동작하지만, 동작 완료 응답(ACK)과 거리값이 없어 "분류 성공" 확인과 적재율 계산이 불가능하다.

## 2. ESP32 DevKitC V4

### 2-1. ESP32 보드 지원 추가 (처음 한 번만)
1. **파일 › 기본 설정(Preferences)** → "추가적인 보드 매니저 URLs" 에 붙여넣기:
   ```
   https://espressif.github.io/arduino-esp32/package_esp32_index.json
   ```
2. **보드 매니저**(왼쪽 아이콘 또는 도구 › 보드 › 보드 매니저) → `esp32` 검색 → **"esp32 by Espressif Systems"** 설치 (몇 분)

### 2-2. USB 드라이버
- ESP32 연결 → 장치 관리자 › 포트 에 **"Silicon Labs CP210x … (COM○)"** 확인
- 안 보이면 Silicon Labs **"CP210x Universal Windows Driver"** 설치 (보드가 CH340 칩이면 CH340 드라이버)
- 그래도 안 보이면 케이블 교체 (충전 전용 케이블은 데이터 불가)

### 2-3. 업로드
1. **파일 › 열기** → `firmware/esp32_bridge/esp32_bridge.ino` (`esp32_bridge` 폴더 안에 있어야 함 — 저장소 구조 그대로)
2. **도구 › 보드 › esp32 › ESP32 Dev Module**
3. **도구 › 포트 › COM○** (CP210x 쪽 — UNO 와 헷갈리지 않기)
4. **업로드(→)** — "Connecting……" 에서 멈추면 보드의 **BOOT 버튼을 누른 채** 기다리다 업로드가 시작되면 뗀다

### 2-4. (선택) Wi-Fi 로 서버에 직접 전송
안 해도 시연에 지장 없음 (카메라 컴퓨터가 UNO 값을 서버로 보낸다).
1. 같은 폴더의 `secrets.example.h` 를 복사해 **`secrets.h`** 로 이름 변경 (Git 에 올라가지 않음)
2. Wi-Fi 이름·비밀번호, `http://<맥북 IP>:8000`, AI_API_TOKEN, 센서 칸(`BIN_001` 등), 빈 통 거리 입력 → 다시 업로드
3. 카메라 프로그램 `.env` 에 `FORWARD_SENSOR=false` (같은 값 중복 전송 방지)

### 2-5. 확인
**시리얼 모니터 › 115200**
| 줄 | 의미 |
|---|---|
| `HELLO:ESP32_BRIDGE:1` | 펌웨어 정상 |
| `ESP32:WIFI:DISABLED` / `ESP32:WIFI:OK:192.168.x.x` | Wi-Fi 미설정 / 연결됨 |
| `UNO>DIST:23.4` | UNO ↔ ESP32 배선 정상 |
| `ESP32:UNO_LINK:NONE` 만 계속 | UNO D3 → GPIO16 배선·분압·GND 공통 확인 |

확인 후 **시리얼 모니터 닫기**.

## 3. 카메라 프로그램에 연결
`SMART_RECYCLE_AI.exe` → **설정**
- "Arduino UNO 포트": UNO 의 COM (또는 `auto`)
- "ESP32 포트": CP210x 쪽 COM
- 저장 후 재시작 → GUI 에 `Arduino UNO … uno_controller (ACK·거리 지원)`, `ESP32 … UNO 링크 OK` 표시되면 완료

## ⚠️ 배선 주의
```
UNO D3 ─[1kΩ]─┬─ ESP32 GPIO16      ← 5V 를 3.3V 핀에 직결 금지 (분압 필수)
              └─[2kΩ]─ GND
서보 3개 전원 = MB102 5V (UNO 5V 핀 아님)
UNO GND · ESP32 GND · MB102 GND 모두 연결
```
배선 확인 전에는 서보 전원을 연결하지 않는다. 자세한 핀표: [HARDWARE_WIRING.md](HARDWARE_WIRING.md)
