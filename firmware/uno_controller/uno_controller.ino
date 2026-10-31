/*
 * SMART RECYCLE — Arduino UNO 제어 펌웨어 (uno_controller v1)
 *
 * trush.ino 를 기반으로 만든 버전. 핀 번호·서보 각도·동작 순서·명령 문자는 trush.ino 와 '동일'하다.
 * (원본 trush.ino 는 저장소 루트에 그대로 있다)
 *
 * 추가된 것
 *  1) 응답(ACK)  : 명령마다 ACK:<c>:START → ACK:<c>:DONE, 동작 중 새 명령은 ACK:<c>:BUSY 로 거부
 *  2) 거리 보고  : DIST:<cm> (1초마다) / 측정 실패 시 DIST:ERR   — 적재율 계산은 PC/서버가 한다
 *  3) 비상 정지  : 'S' → 즉시 대기 자세로 복귀, ACK:S:DONE
 *  4) 논블로킹   : delay() 대신 millis() 상태 머신 → 동작 중에도 센서·명령 처리
 *  5) 같은 줄을 USB Serial(카메라 PC)과 SoftwareSerial D3(ESP32)로 함께 보낸다
 *  6) 'G','M','P','L','S' 외의 바이트(개행, 'C:L:3' 같은 문자열 포함)는 '한 글자 명령'으로 오인하지 않도록
 *     줄 단위로 받아 '한 글자짜리 줄'만 명령으로 처리한다. (trush.ino 의 'C:L:3' 오동작 방지)
 *     단, 개행 없이 한 글자만 보내는 기존 방식도 50ms 후 처리한다.
 *
 * 보드: Arduino UNO R3 · 서보 SG90 ×3 (X=D9, Y1=D10, Y2=D11) · HC-SR04 ×1 (TRIG=D4, ECHO=D5)
 * 서보 전원은 별도 5V(MB102 등), GND 공통. 배선 확인 전에는 업로드/구동하지 않는다.
 */
#include <Servo.h>
#include <SoftwareSerial.h>

#define FW_NAME "UNO_CTRL"
#define FW_VERSION "1"

SoftwareSerial espSerial(2, 3);  // D2 RX, D3 TX → ESP32 GPIO16 (분압 필수)

Servo servoX, servoY1, servoY2;
const int PIN_X = 9, PIN_Y1 = 10, PIN_Y2 = 11;

// trush.ino 와 동일한 각도
const int ANGLE_X_REST = 0;
const int ANGLE_X_PLASTIC = 30;
const int ANGLE_X_METAL = 145;
const int ANGLE_X_GLASS = 160;
const int ANGLE_X_PAPER = 180;
const int Y1_FLAT = 180, Y2_FLAT = 0;
const int Y1_DROP = 145, Y2_DROP = 25;

// trush.ino 와 동일한 시간 (X 회전 대기 4000ms, 기울임 2000ms, 복귀 100ms)
const unsigned long T_ROTATE = 4000, T_DROP = 2000, T_RETURN = 100;

const int TRIG_PIN = 4, ECHO_PIN = 5;
const unsigned long DIST_INTERVAL = 1000;

enum Phase { IDLE, ROTATING, DROPPING, RETURNING };
Phase phase = IDLE;
char activeCmd = 0;
unsigned long phaseStart = 0, lastDist = 0;

char lineBuf[16];
byte lineLen = 0;
unsigned long lastByteAt = 0;

void emit(const String &s) {
  Serial.println(s);
  espSerial.println(s);
}

void resetAllServos() {
  servoX.write(ANGLE_X_REST);
  servoY1.write(Y1_FLAT);
  servoY2.write(Y2_FLAT);
}

int angleFor(char c) {
  switch (c) {
    case 'G': return ANGLE_X_GLASS;
    case 'M': return ANGLE_X_METAL;
    case 'P': return ANGLE_X_PAPER;
    case 'L': return ANGLE_X_PLASTIC;
    default: return -1;
  }
}

void handleCommand(char c) {
  if (c == 'S') {  // 비상 정지 → 대기 자세
    resetAllServos();
    if (phase != IDLE) emit(String("ACK:") + activeCmd + ":ABORTED");
    phase = IDLE;
    activeCmd = 0;
    emit("ACK:S:DONE");
    return;
  }
  if (c == '?') {
    emit(String("HELLO:") + FW_NAME + ":" + FW_VERSION);
    return;
  }
  int a = angleFor(c);
  if (a < 0) return;  // 알 수 없는 명령은 무시
  if (phase != IDLE) {
    emit(String("ACK:") + c + ":BUSY");
    return;
  }
  activeCmd = c;
  servoX.write(a);
  phase = ROTATING;
  phaseStart = millis();
  emit(String("ACK:") + c + ":START");
}

void readCommands() {
  while (Serial.available() > 0) {
    char b = Serial.read();
    lastByteAt = millis();
    if (b == '\n' || b == '\r') {
      if (lineLen == 1) handleCommand(lineBuf[0]);
      lineLen = 0;
    } else if (lineLen < sizeof(lineBuf) - 1) {
      lineBuf[lineLen++] = b;
    } else {
      lineLen = 0;  // 너무 긴 줄은 버림
    }
  }
  // 개행 없이 한 글자만 온 경우 (기존 yolo_arduino.py 방식)
  if (lineLen == 1 && millis() - lastByteAt > 50) {
    handleCommand(lineBuf[0]);
    lineLen = 0;
  } else if (lineLen > 1 && millis() - lastByteAt > 200) {
    lineLen = 0;  // 'C:L:3' 처럼 개행 없는 긴 문자열 → 무시
  }
}

void stepMotion() {
  unsigned long el = millis() - phaseStart;
  switch (phase) {
    case ROTATING:
      if (el >= T_ROTATE) {
        servoY1.write(Y1_DROP);
        servoY2.write(Y2_DROP);
        phase = DROPPING;
        phaseStart = millis();
      }
      break;
    case DROPPING:
      if (el >= T_DROP) {
        servoY1.write(Y1_FLAT);
        servoY2.write(Y2_FLAT);
        phase = RETURNING;
        phaseStart = millis();
      }
      break;
    case RETURNING:
      if (el >= T_RETURN) {
        servoX.write(ANGLE_X_REST);
        phase = IDLE;
        emit(String("ACK:") + activeCmd + ":DONE");
        activeCmd = 0;
        lastDist = 0;  // 투입 직후 바로 측정 (trush.ino 와 같은 의도)
      }
      break;
    default:
      break;
  }
}

void reportDistance() {
  if (millis() - lastDist < DIST_INTERVAL) return;
  lastDist = millis();
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  unsigned long dur = pulseIn(ECHO_PIN, HIGH, 30000UL);  // 최대 30ms (약 5m)
  if (dur == 0) {
    emit("DIST:ERR");
    return;
  }
  float cm = dur * 0.0343 / 2.0;
  emit(String("DIST:") + String(cm, 1));
}

void setup() {
  Serial.begin(9600);
  espSerial.begin(9600);
  servoX.attach(PIN_X);
  servoY1.attach(PIN_Y1);
  servoY2.attach(PIN_Y2);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  resetAllServos();
  emit(String("HELLO:") + FW_NAME + ":" + FW_VERSION);
}

void loop() {
  readCommands();
  stepMotion();
  reportDistance();
}
