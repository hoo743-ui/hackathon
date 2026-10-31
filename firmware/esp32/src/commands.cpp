#include "commands.h"

#include <Arduino.h>
#include <ArduinoJson.h>
#include <string.h>

#include "app.h"
#include "config.h"
#include "mqtt_client.h"
#include "time_utils.h"

namespace commands {

namespace {

// ---- processed command_id ring buffer --------------------------------------
char g_seen[cfg::COMMAND_ID_HISTORY][cfg::COMMAND_ID_MAX_LEN + 1];
int g_seenNext = 0;

bool seenBefore(const char* id) {
    for (int i = 0; i < cfg::COMMAND_ID_HISTORY; ++i) {
        if (g_seen[i][0] != '\0' && strcmp(g_seen[i], id) == 0) return true;
    }
    return false;
}

void remember(const char* id) {
    if (seenBefore(id)) return;
    strncpy(g_seen[g_seenNext], id, cfg::COMMAND_ID_MAX_LEN);
    g_seen[g_seenNext][cfg::COMMAND_ID_MAX_LEN] = '\0';
    g_seenNext = (g_seenNext + 1) % cfg::COMMAND_ID_HISTORY;
}

// ---- OPEN_BIN awaiting completion -------------------------------------------
bool g_pendingOpen = false;
char g_pendingOpenId[cfg::COMMAND_ID_MAX_LEN + 1];

// ---- one ACK that could not be published (link was down) --------------------
// Worst case ACK (64-char command_id twice, longest code, timestamps) is
// 391 B (host-measured); 512 leaves margin and stays far below net::maxPayloadLen(Ack).
constexpr size_t ACK_PAYLOAD_MAX = 512;
bool g_deferredAck = false;
char g_deferredAckPayload[ACK_PAYLOAD_MAX];

// ACK, protocol v1 + v1.1 fields (docs/MQTT_PROTOCOL.md 3.4):
//   v1  : command_id, device_id, success, message, executed_at
//   v1.1: message_type "ack", message_id (= command_id), status
//         SUCCEEDED|FAILED, error_code (null on success, else the failure
//         code), completed_at (= executed_at)
// On failure `message` carries the same code as error_code (v1 behaviour).
bool buildAck(char* out, size_t outLen, const char* commandId, bool success, const char* message) {
    JsonDocument doc;
    doc["message_type"] = "ack";
    doc["message_id"] = commandId;
    doc["command_id"] = commandId;
    doc["device_id"] = cfg::DEVICE_ID;
    doc["status"] = success ? "SUCCEEDED" : "FAILED";
    if (success) {
        doc["error_code"] = nullptr;
    } else {
        doc["error_code"] = message;
    }
    doc["message"] = message;
    doc["success"] = success;
    char ts[24];
    if (timeutil::formatNowIso(ts, sizeof(ts))) {
        doc["completed_at"] = ts;
        doc["executed_at"] = ts;
    } else {
        doc["completed_at"] = nullptr;
        doc["executed_at"] = nullptr;
    }
    if (measureJson(doc) >= outLen) {
        if (outLen > 0) out[0] = '\0';
        return false;
    }
    serializeJson(doc, out, outLen);
    return true;
}

void sendAck(const char* commandId, bool success, const char* message) {
    char payload[ACK_PAYLOAD_MAX];
    if (!buildAck(payload, sizeof(payload), commandId, success, message)) {
        Serial.printf("[CMD] ACK %s too large, not sent\n", commandId);  // cannot happen with 64-char ids
        return;
    }
    Serial.printf("[CMD] ACK %s %s %s\n", commandId, success ? "SUCCEEDED" : "FAILED", message);
    if (!net::publish(net::Topic::Ack, payload, false)) {
        // Keep the latest undeliverable ACK and retry after reconnect. The
        // server may already have marked the command TIMEOUT; that is fine.
        strncpy(g_deferredAckPayload, payload, sizeof(g_deferredAckPayload) - 1);
        g_deferredAckPayload[sizeof(g_deferredAckPayload) - 1] = '\0';
        g_deferredAck = true;
    }
}

int binIndexForTarget(const char* target) {
    if (target == nullptr) return -1;
    for (int i = 0; i < cfg::NUM_BINS; ++i) {
        if (strcmp(cfg::BINS[i].wasteType, target) == 0) return i;
    }
    return -1;
}

enum class Cmd : uint8_t { OpenBin, SetMode, EmergencyStop, ResetEstop, GetStatus, Unknown };

// v1 field name / v1.1 alias (command|action, requested_at|issued_at).
// Either may be absent; if both are present they must be equal strings.
// Returns false on a conflict. *out = the value, or nullptr if neither is set.
bool readAliased(const JsonDocument& doc, const char* v1Key, const char* v11Key, const char** out) {
    const char* a = doc[v1Key].is<const char*>() ? doc[v1Key].as<const char*>() : nullptr;
    const char* b = doc[v11Key].is<const char*>() ? doc[v11Key].as<const char*>() : nullptr;
    *out = a != nullptr ? a : b;
    return a == nullptr || b == nullptr || strcmp(a, b) == 0;
}

Cmd parseCommandName(const char* name) {
    if (name == nullptr) return Cmd::Unknown;
    if (strcmp(name, "OPEN_BIN") == 0) return Cmd::OpenBin;
    if (strcmp(name, "SET_MODE") == 0) return Cmd::SetMode;
    if (strcmp(name, "EMERGENCY_STOP") == 0) return Cmd::EmergencyStop;
    if (strcmp(name, "RESET_ESTOP") == 0) return Cmd::ResetEstop;
    if (strcmp(name, "GET_STATUS") == 0) return Cmd::GetStatus;
    return Cmd::Unknown;
}

// Local copy: PubSubClient reuses its buffer for outgoing publishes (ACKs are
// sent from inside the callback), so never parse the broker buffer in place.
char g_rx[cfg::MQTT_BUFFER_SIZE + 1];

}  // namespace

void handleMessage(const uint8_t* payload, unsigned int length, uint32_t nowMs) {
    if (length > cfg::MQTT_BUFFER_SIZE) {
        Serial.println("[CMD] payload too large, dropped");
        return;
    }
    memcpy(g_rx, payload, length);
    g_rx[length] = '\0';

    JsonDocument doc;
    const DeserializationError err = deserializeJson(doc, static_cast<const char*>(g_rx), length);
    if (err || !doc.is<JsonObject>()) {
        Serial.printf("[CMD] invalid JSON (%s), dropped\n", err.c_str());
        return;
    }

    const char* commandId = doc["command_id"].is<const char*>() ? doc["command_id"].as<const char*>() : nullptr;
    if (commandId == nullptr || commandId[0] == '\0' || strlen(commandId) > (size_t)cfg::COMMAND_ID_MAX_LEN) {
        Serial.println("[CMD] missing/oversized command_id, dropped (cannot ACK)");
        return;
    }
    // v1.1: message_type, when present, must match the topic -> discard.
    const JsonVariantConst typeVar = doc["message_type"];
    if (!typeVar.isNull() && !(typeVar.is<const char*>() && strcmp(typeVar.as<const char*>(), "command") == 0)) {
        Serial.printf("[CMD] %s: message_type is not \"command\", dropped\n", commandId);
        return;
    }

    const char* deviceId = doc["device_id"].is<const char*>() ? doc["device_id"].as<const char*>() : nullptr;
    const char* name = nullptr;
    const bool nameConsistent = readAliased(doc, "command", "action", &name);
    const char* requestedAt = nullptr;  // informational only (expiry uses expires_at)
    const bool requestedConsistent = readAliased(doc, "requested_at", "issued_at", &requestedAt);
    const JsonVariantConst targetVar = doc["target"];
    const char* target = targetVar.is<const char*>() ? targetVar.as<const char*>() : nullptr;
    const bool targetIsNull = targetVar.isNull();
    const JsonVariantConst binIdVar = doc["bin_id"];
    // origin (protocol 3.3): "manual" | "auto"; absent/null -> "manual" (v1).
    const JsonVariantConst originVar = doc["origin"];
    bool originValid = true;
    OperatingMode originMode = OperatingMode::Manual;
    if (!originVar.isNull()) {
        const char* o = originVar.is<const char*>() ? originVar.as<const char*>() : nullptr;
        if (o != nullptr && strcmp(o, "auto") == 0) {
            originMode = OperatingMode::Auto;
        } else if (o == nullptr || strcmp(o, "manual") != 0) {
            originValid = false;
        }
    }
    // E-STOP wins even over a command/action conflict: stopping is always safe.
    const bool estopRequested = (doc["command"].is<const char*>() && strcmp(doc["command"].as<const char*>(), "EMERGENCY_STOP") == 0) ||
                                (doc["action"].is<const char*>() && strcmp(doc["action"].as<const char*>(), "EMERGENCY_STOP") == 0);
    const Cmd cmd = estopRequested ? Cmd::EmergencyStop
                    : nameConsistent ? parseCommandName(name)
                                     : Cmd::Unknown;

    Serial.printf("[CMD] rx %s %s %s requested_at=%s\n", commandId, name ? name : "(null)", target ? target : "(null)",
                  requestedAt ? requestedAt : "(null)");

    if (deviceId == nullptr || strcmp(deviceId, cfg::DEVICE_ID) != 0) {
        remember(commandId);
        sendAck(commandId, false, "INVALID_DEVICE");
        return;
    }

    // ---- EMERGENCY_STOP: first, unconditionally ------------------------------
    if (cmd == Cmd::EmergencyStop) {
        g_actuators.emergencyStop(nowMs);
        remember(commandId);
        // Idempotent: a re-delivered/expired E-STOP still stops and reports
        // success, so the server never sees "E-STOP failed".
        sendAck(commandId, true, "ESTOP_ACTIVATED");
        publishStatusNow();
        return;
    }

    if (seenBefore(commandId)) {
        sendAck(commandId, false, "DUPLICATE");
        return;
    }
    remember(commandId);  // every outcome below is final for this id

    if (cmd == Cmd::Unknown || !requestedConsistent || !originValid) {
        sendAck(commandId, false, "INVALID_COMMAND");
        return;
    }

    time_t expiresAt = 0;
    const char* expiresStr = doc["expires_at"].is<const char*>() ? doc["expires_at"].as<const char*>() : nullptr;
    if (!timeutil::parseIso8601(expiresStr, &expiresAt)) {
        sendAck(commandId, false, "INVALID_COMMAND");
        return;
    }
    const bool safetyRelevant = (cmd == Cmd::OpenBin || cmd == Cmd::ResetEstop);
    if (!timeutil::isSynced()) {
        if (safetyRelevant) {
            sendAck(commandId, false, "TIME_NOT_SYNCED");
            return;
        }
    } else if (timeutil::nowEpoch() > expiresAt) {
        sendAck(commandId, false, "EXPIRED");
        return;
    }

    switch (cmd) {
        case Cmd::GetStatus:
            publishStatusNow();
            sendAck(commandId, true, "STATUS_SENT");
            return;

        case Cmd::ResetEstop:
            if (!targetIsNull) {
                sendAck(commandId, false, "INVALID_TARGET");
                return;
            }
            if (!g_actuators.resetEstop()) {  // still safe-closing
                sendAck(commandId, false, "BUSY");
                return;
            }
            sendAck(commandId, true, "ESTOP_RESET");
            publishStatusNow();
            return;

        case Cmd::SetMode: {
            OperatingMode m;
            if (target != nullptr && strcmp(target, "AUTO") == 0) {
                m = OperatingMode::Auto;
            } else if (target != nullptr && strcmp(target, "MANUAL") == 0) {
                m = OperatingMode::Manual;
            } else {
                sendAck(commandId, false, "INVALID_TARGET");
                return;
            }
            if (g_actuators.estopActive()) {
                sendAck(commandId, false, "ESTOP_ACTIVE");
                return;
            }
            if (g_actuators.busy()) {
                sendAck(commandId, false, "BUSY");
                return;
            }
            g_app.mode = m;
            sendAck(commandId, true, "MODE_SET");
            publishStatusNow();
            return;
        }

        case Cmd::OpenBin: {
            const int bin = binIndexForTarget(target);
            if (bin < 0) {
                sendAck(commandId, false, "INVALID_TARGET");
                return;
            }
            // v1.1: optional bin_id must be the bin configured for `target`
            // (catches server/device mapping mismatches before anything moves).
            if (!binIdVar.isNull() &&
                !(binIdVar.is<const char*>() && strcmp(binIdVar.as<const char*>(), cfg::BINS[bin].binId) == 0)) {
                sendAck(commandId, false, "INVALID_TARGET");
                return;
            }
            // Unverified pin map: never move a servo (config.h PINMAP_CONFIRMED).
            if (!cfg::PINMAP_CONFIRMED) {
                Serial.println("[CMD] OPEN_BIN refused: PINMAP_CONFIRMED=false (config.h)");
                sendAck(commandId, false, "PINMAP_UNCONFIRMED");
                return;
            }
            if (g_actuators.estopActive()) {
                sendAck(commandId, false, "ESTOP_ACTIVE");
                return;
            }
            // Mode must match origin: AUTO <-> "auto" (AI sorting), MANUAL <-> "manual".
            if (g_app.mode != originMode) {
                sendAck(commandId, false, "MODE_CONFLICT");
                return;
            }
            if (g_actuators.busy() || g_pendingOpen) {
                sendAck(commandId, false, "BUSY");
                return;
            }
            if (!net::mqttConnected()) {  // defensive: never move without a link
                sendAck(commandId, false, "BUSY");
                return;
            }
            const StartResult r = g_actuators.startOpenCycle(bin, nowMs);
            if (r != StartResult::Started) {
                sendAck(commandId, false,
                        r == StartResult::EStopActive         ? "ESTOP_ACTIVE"
                        : r == StartResult::PinmapUnconfirmed ? "PINMAP_UNCONFIRMED"
                                                              : "BUSY");
                return;
            }
            strncpy(g_pendingOpenId, commandId, cfg::COMMAND_ID_MAX_LEN);
            g_pendingOpenId[cfg::COMMAND_ID_MAX_LEN] = '\0';
            g_pendingOpen = true;
            markStatusDirty();  // busy=true
            return;  // ACK after the cycle completes (onCycleResult)
        }

        case Cmd::EmergencyStop:
        case Cmd::Unknown:
            break;  // handled above
    }
}

void onCycleResult(const CycleResult& result) {
    markStatusDirty();
    if (!g_pendingOpen) return;
    g_pendingOpen = false;
    switch (result.outcome) {
        case CycleOutcome::Completed: sendAck(g_pendingOpenId, true, "BIN_OPENED"); break;
        case CycleOutcome::EStopped: sendAck(g_pendingOpenId, false, "ABORTED_BY_ESTOP"); break;
        case CycleOutcome::Aborted: sendAck(g_pendingOpenId, false, "ABORTED_CONNECTION_LOST"); break;
        case CycleOutcome::TimedOut: sendAck(g_pendingOpenId, false, "MOTION_TIMEOUT"); break;
    }
}

void onConnected() {
    if (g_deferredAck) {
        if (net::publish(net::Topic::Ack, g_deferredAckPayload, false)) {
            Serial.println("[CMD] deferred ACK delivered");
            g_deferredAck = false;
        }
    }
}

}  // namespace commands
