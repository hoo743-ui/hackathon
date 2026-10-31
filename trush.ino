#include <Servo.h>
#include <SoftwareSerial.h>

// 1. ESP32 시리얼 통신 (아두이노 D2: RX, D3: TX)
SoftwareSerial espSerial(2, 3);

// 2. 서보모터 3개 선언
Servo servoX;
Servo servoY1;
Servo servoY2;

// 핀 번호
const int PIN_X  = 9;
const int PIN_Y1 = 10;
const int PIN_Y2 = 11;

// X축 방향 각도
const int ANGLE_X_REST    = 0;
const int ANGLE_X_PLASTIC = 30;
const int ANGLE_X_METAL   = 145;
const int ANGLE_X_GLASS   = 160;
const int ANGLE_X_PAPER   = 180;

// Y축 뚜껑 기울기 각도
const int Y1_FLAT = 180;
const int Y2_FLAT = 0;
const int Y1_DROP = 145;
const int Y2_DROP = 25;

// 3. 단일 초음파 센서 핀 설정
const int TRIG_PIN = 4;
const int ECHO_PIN = 5;

// 쓰레기 감지 기준 거리 (센서로부터 쓰레기까지 5cm 이내면 꽉 참으로 판단)
const int FULL_THRESHOLD_CM = 5;

// 주기적 감지 타이머
unsigned long lastCheckTime = 0;
const unsigned long CHECK_INTERVAL = 3000; // 3초마다 체크

void setup() {
  Serial.begin(9600);    // PC 파이썬 통신
  espSerial.begin(9600); // ESP32 통신

  servoX.attach(PIN_X);
  servoY1.attach(PIN_Y1);
  servoY2.attach(PIN_Y2);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  resetAllServos();
}

void loop() {
  // 1. 파이썬(YOLO) 신호 수신 시 모터 동작
  if (Serial.available() > 0) {
    char command = Serial.read();

    switch (command) {
      case 'G': processDrop(ANGLE_X_GLASS); break;
      case 'M': processDrop(ANGLE_X_METAL); break;
      case 'P': processDrop(ANGLE_X_PAPER); break;
      case 'L': processDrop(ANGLE_X_PLASTIC); break;
      default: break;
    }
  }

  // 2. 3초마다 초음파 센서 거리 측정
  if (millis() - lastCheckTime > CHECK_INTERVAL) {
    lastCheckTime = millis();
    checkTrashLevel();
  }
}

// 거리 측정 함수 (cm)
long getDistance() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  if (duration == 0) return 999;
  return duration * 0.034 / 2;
}

// 만차 체크 및 ESP32 전송
void checkTrashLevel() {
  long distance = getDistance();
  
  if (distance <= FULL_THRESHOLD_CM) {
    espSerial.println("FULL:TRASH");
    Serial.println("[ALERT] 쓰레기통 만차 감지!");
  }
}

void processDrop(int targetAngleX) {
  servoX.write(targetAngleX);
  delay(4000);

  servoY1.write(Y1_DROP);
  servoY2.write(Y2_DROP);
  delay(2000);

  servoY1.write(Y1_FLAT);
  servoY2.write(Y2_FLAT);
  delay(100);

  servoX.write(ANGLE_X_REST);

  // 투입 직후 용량 점검
  checkTrashLevel();
}

void resetAllServos() {
  servoX.write(ANGLE_X_REST);
  servoY1.write(Y1_FLAT);
  servoY2.write(Y2_FLAT);
}