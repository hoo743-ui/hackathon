#include "mqtt_client.h"

#include <Arduino.h>
#include <PubSubClient.h>
#include <WiFi.h>

#include "config.h"
#include "secrets_loader.h"
#include "time_utils.h"

namespace net {

namespace {
WiFiClient g_wifiClient;
PubSubClient g_mqtt(g_wifiClient);

char g_topics[4][64];
char g_lwtPayload[128];

bool g_wifiWasConnected = false;
uint32_t g_wifiLastAttemptMs = 0;
uint32_t g_wifiBackoffMs = cfg::WIFI_RETRY_MIN_MS;

uint32_t g_mqttLastAttemptMs = 0;
uint32_t g_mqttBackoffMs = cfg::MQTT_RETRY_MIN_MS;
bool g_mqttAttemptedOnce = false;
bool g_mqttWasConnected = false;
bool g_justConnected = false;

uint32_t nextBackoff(uint32_t current, uint32_t maxMs) {
    const uint32_t doubled = current * 2;
    return doubled > maxMs ? maxMs : doubled;
}

void startWifi() {
    Serial.printf("[NET] Wi-Fi connecting to '%s'\n", WIFI_SSID);
    WiFi.disconnect(false, false);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void tryMqttConnect(uint32_t nowMs) {
    g_mqttLastAttemptMs = nowMs;
    g_mqttAttemptedOnce = true;
    Serial.printf("[NET] MQTT connecting to %s:%d ...\n", MQTT_HOST, (int)MQTT_PORT);

    // LWT: retained {"message_type":"status","device_id":...,"state":"offline"}
    // on the status topic (no message_id: the broker re-sends the same bytes).
    // cleanSession=true: we never want stale queued commands after reconnect
    // (expires_at would reject them anyway, ARCHITECTURE D3).
    const bool ok = g_mqtt.connect(cfg::DEVICE_ID, MQTT_USERNAME, MQTT_PASSWORD,
                                   g_topics[(int)Topic::Status], 1, true, g_lwtPayload, true);
    if (!ok) {
        Serial.printf("[NET] MQTT connect failed, state=%d, retry in %lu ms\n", g_mqtt.state(),
                      (unsigned long)g_mqttBackoffMs);
        g_mqttBackoffMs = nextBackoff(g_mqttBackoffMs, cfg::MQTT_RETRY_MAX_MS);
        return;
    }
    if (!g_mqtt.subscribe(g_topics[(int)Topic::Command], 1)) {
        Serial.println("[NET] subscribe failed, dropping connection");
        g_mqtt.disconnect();
        g_mqttBackoffMs = nextBackoff(g_mqttBackoffMs, cfg::MQTT_RETRY_MAX_MS);
        return;
    }
    Serial.printf("[NET] MQTT connected, subscribed %s (QoS 1)\n", g_topics[(int)Topic::Command]);
    g_mqttBackoffMs = cfg::MQTT_RETRY_MIN_MS;
    g_mqttWasConnected = true;
    g_justConnected = true;
}
}  // namespace

const char* topicName(Topic topic) { return g_topics[(int)topic]; }

size_t maxPayloadLen(Topic topic) {
    const size_t overhead = 5 + 2 + strlen(g_topics[(int)topic]);  // PubSubClient MQTT_MAX_HEADER_SIZE = 5
    return cfg::MQTT_BUFFER_SIZE > overhead ? cfg::MQTT_BUFFER_SIZE - overhead : 0;
}

void begin(MessageHandler onMessage) {
    static const char* suffix[4] = {"telemetry", "status", "command", "ack"};
    for (int i = 0; i < 4; ++i) {
        snprintf(g_topics[i], sizeof(g_topics[i]), "%s/%s/%s", cfg::MQTT_TOPIC_PREFIX, cfg::DEVICE_ID,
                 suffix[i]);
    }
    snprintf(g_lwtPayload, sizeof(g_lwtPayload),
             "{\"message_type\":\"status\",\"device_id\":\"%s\",\"state\":\"offline\"}", cfg::DEVICE_ID);

    WiFi.persistent(false);
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);

    g_mqtt.setServer(MQTT_HOST, MQTT_PORT);
    g_mqtt.setBufferSize(cfg::MQTT_BUFFER_SIZE);
    g_mqtt.setKeepAlive(cfg::MQTT_KEEPALIVE_S);
    g_mqtt.setSocketTimeout(cfg::MQTT_SOCKET_TIMEOUT_S);
    g_mqtt.setCallback(onMessage);

    startWifi();
    g_wifiLastAttemptMs = millis();
}

void loop(uint32_t nowMs) {
    // ---- Wi-Fi ----
    if (WiFi.status() != WL_CONNECTED) {
        if (g_wifiWasConnected) {
            Serial.println("[NET] Wi-Fi lost");
            g_wifiWasConnected = false;
            g_wifiBackoffMs = cfg::WIFI_RETRY_MIN_MS;
            g_wifiLastAttemptMs = nowMs;  // give auto-reconnect a chance first
        }
        if (g_mqttWasConnected) {
            g_mqttWasConnected = false;
            g_mqtt.disconnect();
        }
        if (nowMs - g_wifiLastAttemptMs >= g_wifiBackoffMs) {
            startWifi();
            g_wifiLastAttemptMs = nowMs;
            g_wifiBackoffMs = nextBackoff(g_wifiBackoffMs, cfg::WIFI_RETRY_MAX_MS);
        }
        return;
    }
    if (!g_wifiWasConnected) {
        g_wifiWasConnected = true;
        g_wifiBackoffMs = cfg::WIFI_RETRY_MIN_MS;
        Serial.printf("[NET] Wi-Fi connected, IP %s, RSSI %d\n", WiFi.localIP().toString().c_str(),
                      WiFi.RSSI());
        timeutil::begin();  // SNTP (UTC)
    }

    // ---- MQTT ----
    if (g_mqtt.connected()) {
        g_mqtt.loop();
        return;
    }
    if (g_mqttWasConnected) {
        g_mqttWasConnected = false;
        Serial.printf("[NET] MQTT lost (state=%d)\n", g_mqtt.state());
        g_mqttLastAttemptMs = nowMs;
        g_mqttBackoffMs = cfg::MQTT_RETRY_MIN_MS;
    }
    if (!g_mqttAttemptedOnce || nowMs - g_mqttLastAttemptMs >= g_mqttBackoffMs) {
        tryMqttConnect(nowMs);
    }
}

bool wifiConnected() { return WiFi.status() == WL_CONNECTED; }

bool mqttConnected() { return g_mqtt.connected(); }

bool consumeJustConnected() {
    const bool v = g_justConnected;
    g_justConnected = false;
    return v;
}

bool publish(Topic topic, const char* payload, bool retain) {
    if (!g_mqtt.connected()) return false;
    const bool ok = g_mqtt.publish(g_topics[(int)topic], payload, retain);
    if (!ok) Serial.printf("[NET] publish to %s failed (len=%u)\n", g_topics[(int)topic], (unsigned)strlen(payload));
    return ok;
}

}  // namespace net
