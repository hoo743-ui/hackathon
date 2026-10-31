/*
 * SMART RECYCLE — ESP32 DevKitC V4 브리지 펌웨어 (esp32_bridge v1)
 *
 * esp32.ino 를 기반으로 만든 버전 (원본은 저장소 루트에 그대로).
 *  - UNO(uno_controller) 가 D3 로 보내는 줄(HELLO / ACK / DIST)을 Serial2(GPIO16 RX2) 로 받는다.
 *    ※ UNO D3 는 5V → GPIO16 앞에 분압(1kΩ/2kΩ) 또는 레벨 시프터 필수
 *  - 받은 줄을 USB Serial(115200) 로 "UNO>" 를 붙여 그대로 출력 → 카메라 PC 가 ESP32 연결 상태를 확인
 *  - Wi-Fi 설정이 있으면 DIST 값을 맥북 서버 POST /api/telemetry (kind=distance) 로 5초마다 전송
 *    (서버 주소·토큰은 secrets.h — Git 에 올리지 않음. secrets.example.h 복사)
 *  - 서보·센서는 제어하지 않는다 (UNO 담당)
 *
 * 카메라 PC 도 같은 DIST 를 서버로 보낼 수 있다. ESP32 Wi-Fi 전송을 쓰면 카메라 PC .env 에서
 * FORWARD_SENSOR=false 로 중복 전송을 끈다.
 */
#include <WiFi.h>
#include <HTTPClient.h>

#if __has_include("secrets.h")
#include "secrets.h"
#else
#define WIFI_SSID ""
#define WIFI_PASSWORD ""
#define BACKEND_URL ""  // 예: "http://192.168.0.10:8000"
#define AI_API_TOKEN ""
#define SENSOR_BIN_ID ""  // 예: "BIN_001"
#define EMPTY_DISTANCE_CM 0.0
#endif

const unsigned long POST_INTERVAL = 5000;
unsigned long lastPost = 0, lastWifiTry = 0, lastLineAt = 0;
String lastDist = "";

bool wifiConfigured() { return String(WIFI_SSID).length() > 0 && String(BACKEND_URL).length() > 0; }

void ensureWifi() {
  if (!wifiConfigured() || WiFi.status() == WL_CONNECTED) return;
  if (millis() - lastWifiTry < 10000) return;  // 10초 간격 재시도 (블로킹 없음)
  lastWifiTry = millis();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.println("ESP32:WIFI:CONNECTING");
}

void postDistance(const String &value) {
  if (!wifiConfigured() || WiFi.status() != WL_CONNECTED) return;
  String status = "normal", dist = "null";
  if (value == "ERR") status = "error"; else dist = value;
  String body = String("{\"device_id\":\"ESP32_BRIDGE\",\"kind\":\"distance\",\"sensor_id\":\"HC-SR04\",\"raw\":\"DIST:") + value +
                "\",\"payload\":{\"distance_cm\":" + dist + ",\"sensor_status\":\"" + status + "\",\"bin_id\":\"" + SENSOR_BIN_ID +
                "\",\"empty_distance_cm\":" + String(EMPTY_DISTANCE_CM, 1) + "}}";
  HTTPClient http;
  http.setTimeout(3000);
  http.begin(String(BACKEND_URL) + "/api/telemetry");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + AI_API_TOKEN);
  int code = http.POST(body);
  http.end();
  Serial.println(String("ESP32:HTTP:") + code);
}

void setup() {
  Serial.begin(115200);
  Serial2.begin(9600, SERIAL_8N1, 16, 17);
  Serial.println("HELLO:ESP32_BRIDGE:1");
  if (!wifiConfigured()) Serial.println("ESP32:WIFI:DISABLED");
}

void loop() {
  ensureWifi();
  static bool announced = false;
  if (WiFi.status() == WL_CONNECTED && !announced) {
    announced = true;
    Serial.println(String("ESP32:WIFI:OK:") + WiFi.localIP().toString());
  }
  if (Serial2.available() > 0) {
    String line = Serial2.readStringUntil('\n');
    line.trim();
    if (line.length() > 0) {
      lastLineAt = millis();
      Serial.println(String("UNO>") + line);
      if (line.startsWith("DIST:")) lastDist = line.substring(5);
    }
  }
  if (lastDist.length() > 0 && millis() - lastPost >= POST_INTERVAL) {
    lastPost = millis();
    postDistance(lastDist);
  }
  static unsigned long lastBeat = 0;
  if (millis() - lastBeat > 5000) {  // UNO 링크 상태 (카메라 PC 표시용)
    lastBeat = millis();
    Serial.println(millis() - lastLineAt < 5000 && lastLineAt > 0 ? "ESP32:UNO_LINK:OK" : "ESP32:UNO_LINK:NONE");
  }
}
