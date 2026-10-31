#include <WiFi.h>
#include <HTTPClient.h>

const char* ssid     = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";
const char* serverName = "http://your-app-server.com/api/update_4zones";

void setup() {
  Serial.begin(115200);
  Serial2.begin(9600, SERIAL_8N1, 16, 17); // 아두이노 D3(TX) -> ESP32 RX2(16)

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi 연결 성공!");
}

void loop() {
  if (Serial2.available() > 0) {
    String data = Serial2.readStringUntil('\n');
    data.trim();

    if (data.startsWith("DATA:")) {
      String content = data.substring(5); // "P_cnt:P_full,M_cnt:M_full,G_cnt:G_full,Pa_cnt:Pa_full"
      
      // 데이터 출력 및 JSON 변환
      sendToApp(content);
    }
  }
}

void sendToApp(String rawData) {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(serverName);
    http.addHeader("Content-Type", "application/json");

    // 앱으로 전송할 JSON 데이터 패킹
    String jsonPayload = "{\"raw_data\":\"" + rawData + "\"}";
    
    int httpResponseCode = http.POST(jsonPayload);
    if (httpResponseCode > 0) {
      Serial.print("4구역 상태 앱 전송 성공: ");
      Serial.println(httpResponseCode);
    }
    http.end();
  }
}