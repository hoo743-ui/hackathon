// Smart recycling bin — ESP32 firmware (DEVICE_001).
//
// NOT TESTED ON REAL HARDWARE. Pins/angles in include/config.h are unverified
// placeholders; see README.md and docs/HARDWARE_WIRING.md before powering.
//
// The firmware only reports raw distance + sensor_status. Fill percentage is
// computed by the server (docs/ARCHITECTURE.md D1).

#include <Arduino.h>
#include <ArduinoJson.h>

#include "servo_controller.h"
#include "app.h"
#include "commands.h"
#include "config.h"
#include "mqtt_client.h"
#include "sensor_manager.h"
#include "time_utils.h"
#include "uuid.h"

AppState g_app;
Actuators g_actuators;

namespace {
SensorScanner g_sensors;

uint32_t g_lastScanStartMs = 0;
bool g_scanStartedOnce = false;
uint32_t g_lastStatusMs = 0;
bool g_statusDirty = false;

// Last values put into a status message (to detect state changes).
bool g_lastBusy = false;
bool g_lastEstop = false;
OperatingMode g_lastMode = OperatingMode::Manual;
bool g_wasTimeSynced = false;
bool g_haveScan = false;  // at least one full sensor scan finished since boot
const char* g_lastErrorCode = nullptr;

void setMessageId(JsonDocument& doc) {
    char id[uuid::STR_LEN + 1];
    uuid::newV4(id);
    doc["message_id"] = id;  // copied into the document
}

// status.error_code (docs/MQTT_PROTOCOL.md 3.2). Precedence when several apply:
//   1. TIME_NOT_SYNCED - device-wide: OPEN_BIN / RESET_ESTOP are refused and
//                        timestamps are null; only visible through status.
//   2. SENSOR_FAULT    - last completed scan has >= 1 bin != "normal"; the
//                        affected bin is also visible per bin in telemetry.
//   3. null
// Before the first scan has finished, sensors are not reported as faulty.
const char* currentErrorCode() {
    if (!timeutil::isSynced()) return "TIME_NOT_SYNCED";
    if (g_haveScan) {
        for (int i = 0; i < cfg::NUM_BINS; ++i) {
            if (g_sensors.result(i).status != SensorStatus::Normal) return "SENSOR_FAULT";
        }
    }
    return nullptr;
}

bool sameCode(const char* a, const char* b) { return a == b || (a && b && strcmp(a, b) == 0); }

void printPinmapBanner() {
    Serial.println("[BOOT] ************************************************************");
    Serial.println("[BOOT] *  PINMAP_CONFIRMED = false  (include/config.h)            *");
    Serial.println("[BOOT] *  GPIO numbers are CANDIDATES, not a verified pin map.    *");
    Serial.println("[BOOT] *  Sensors run; ALL SERVO MOTION IS REFUSED                *");
    Serial.println("[BOOT] *  (OPEN_BIN -> ACK FAILED, error_code PINMAP_UNCONFIRMED). *");
    Serial.println("[BOOT] *  Confirm procedure: firmware/esp32/README.md section 5.   *");
    Serial.println("[BOOT] ************************************************************");
}

void setNullableTimestamp(JsonDocument& doc) {
    char ts[24];
    if (timeutil::formatNowIso(ts, sizeof(ts))) {
        doc["timestamp"] = ts;
    } else {
        doc["timestamp"] = nullptr;  // server uses received_at (ARCHITECTURE D2)
    }
}

void publishTelemetry() {
    JsonDocument doc;
    doc["schema_version"] = cfg::TELEMETRY_SCHEMA_VERSION;
    doc["message_type"] = "telemetry";
    setMessageId(doc);
    doc["device_id"] = cfg::DEVICE_ID;
    doc["source"] = cfg::SOURCE;
    setNullableTimestamp(doc);
    JsonArray bins = doc["bins"].to<JsonArray>();
    for (int i = 0; i < cfg::NUM_BINS; ++i) {
        const BinReading& r = g_sensors.result(i);
        JsonObject b = bins.add<JsonObject>();
        b["bin_id"] = cfg::BINS[i].binId;
        b["waste_type"] = cfg::BINS[i].wasteType;
        if (r.hasDistance && r.status == SensorStatus::Normal) {
            b["distance_cm"] = r.distanceCm;
        } else {
            b["distance_cm"] = nullptr;  // never a fake 0
        }
        b["fill_percent"] = nullptr;  // v1.1 optional; the server computes it from its calibration
        b["sensor_status"] = sensorStatusName(r.status);
        b["samples_valid"] = r.samplesValid;
    }
    // Worst case v1.1 telemetry is 714 B (README section 4); refuse rather
    // than let PubSubClient fail silently if it ever outgrows the buffer.
    const size_t need = measureJson(doc);
    if (need > net::maxPayloadLen(net::Topic::Telemetry)) {
        Serial.printf("[TEL] payload %u B > %u B MQTT limit, not sent\n", (unsigned)need,
                      (unsigned)net::maxPayloadLen(net::Topic::Telemetry));
        return;
    }
    char payload[cfg::MQTT_BUFFER_SIZE];
    serializeJson(doc, payload, sizeof(payload));
    if (net::publish(net::Topic::Telemetry, payload, false)) {
        Serial.printf("[TEL] %s\n", payload);
    }
}
}  // namespace

void publishStatusNow() {
    const char* errorCode = currentErrorCode();
    JsonDocument doc;
    doc["message_type"] = "status";
    setMessageId(doc);
    doc["device_id"] = cfg::DEVICE_ID;
    doc["source"] = cfg::SOURCE;
    doc["state"] = "online";
    doc["operating_mode"] = operatingModeName(g_app.mode);
    doc["estop_active"] = g_actuators.estopActive();
    doc["busy"] = g_actuators.busy();
    doc["firmware_version"] = cfg::FIRMWARE_VERSION;
    if (errorCode) {
        doc["error_code"] = errorCode;
    } else {
        doc["error_code"] = nullptr;
    }
    setNullableTimestamp(doc);

    char payload[512];  // worst case 292 B (host-measured)
    if (measureJson(doc) >= sizeof(payload)) {
        Serial.println("[STA] payload too large, not sent");
        return;
    }
    serializeJson(doc, payload, sizeof(payload));
    if (net::publish(net::Topic::Status, payload, true)) {  // retained
        Serial.printf("[STA] %s\n", payload);
        g_lastStatusMs = millis();
        g_statusDirty = false;
        g_lastBusy = g_actuators.busy();
        g_lastEstop = g_actuators.estopActive();
        g_lastMode = g_app.mode;
        g_lastErrorCode = errorCode;
    }
}

void markStatusDirty() { g_statusDirty = true; }

static void onMqttMessage(const char* topic, const uint8_t* payload, unsigned int length) {
    if (strcmp(topic, net::topicName(net::Topic::Command)) != 0) return;
    commands::handleMessage(payload, length, millis());
}

void setup() {
    Serial.begin(115200);
    delay(50);
    Serial.printf("\n[BOOT] smart-bin firmware %s, device %s\n", cfg::FIRMWARE_VERSION, cfg::DEVICE_ID);
    Serial.println("[BOOT] WARNING: NOT TESTED ON REAL HARDWARE; pins/angles are UNVERIFIED (include/config.h)");
    if (!cfg::PINMAP_CONFIRMED) printPinmapBanner();

    g_actuators.begin();  // servos detached, signal lines LOW, no motion
    g_sensors.begin();
    net::begin(onMqttMessage);
}

void loop() {
    const uint32_t now = millis();

    net::loop(now);
    const bool connected = net::mqttConnected();

    // Lost the broker (or Wi-Fi) while a lid is moving/open -> close it now.
    // No new motion can start: commands only arrive over MQTT.
    if (!connected && g_actuators.motionActive()) g_actuators.abortToSafe(now);

    g_actuators.update(now);
    CycleResult res;
    if (g_actuators.takeResult(&res)) commands::onCycleResult(res);

    if (net::consumeJustConnected()) {
        publishStatusNow();  // overrides the retained LWT "offline"
        commands::onConnected();
    }

    // ---- sensors / telemetry ----
    if (!g_sensors.scanning() &&
        (!g_scanStartedOnce || now - g_lastScanStartMs >= cfg::TELEMETRY_INTERVAL_MS)) {
        g_sensors.startScan(now);
        g_lastScanStartMs = now;
        g_scanStartedOnce = true;
    }
    if (!(cfg::PAUSE_SENSING_DURING_MOTION && g_actuators.motionActive())) {
        if (g_sensors.poll(millis())) {
            g_haveScan = true;
            if (connected) publishTelemetry();
        }
    }

    // ---- status: on change, on NTP sync, and heartbeat ----
    const bool synced = timeutil::isSynced();
    if (synced && !g_wasTimeSynced) {
        Serial.println("[TIME] NTP synced (UTC)");
        g_statusDirty = true;
    }
    g_wasTimeSynced = synced;
    if (g_actuators.busy() != g_lastBusy || g_actuators.estopActive() != g_lastEstop || g_app.mode != g_lastMode ||
        !sameCode(currentErrorCode(), g_lastErrorCode)) {
        g_statusDirty = true;
    }
    if (connected && (g_statusDirty || millis() - g_lastStatusMs >= cfg::STATUS_HEARTBEAT_MS)) {
        publishStatusNow();
    }

    delay(1);  // yield to Wi-Fi / idle task
}
