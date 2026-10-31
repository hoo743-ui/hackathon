// mqtt_client — Wi-Fi + MQTT connection management (non-blocking, with backoff).
//
// KNOWN LIMITATION: PubSubClient can only PUBLISH at QoS 0. Telemetry, status
// and ACK messages can therefore be lost on a flaky link even though
// docs/MQTT_PROTOCOL.md lists QoS 1. The server's ACK timeout covers lost ACKs.
// Subscriptions (the command topic) do use QoS 1.
#pragma once

#include <stddef.h>
#include <stdint.h>

namespace net {

enum class Topic : uint8_t { Telemetry, Status, Command, Ack };

using MessageHandler = void (*)(const char* topic, const uint8_t* payload, unsigned int length);

void begin(MessageHandler onMessage);

// Call every loop iteration. Never blocks longer than one connect attempt
// (bounded by cfg::MQTT_SOCKET_TIMEOUT_S).
void loop(uint32_t nowMs);

bool wifiConnected();
bool mqttConnected();

// Returns true once after each successful (re)connect to the broker.
bool consumeJustConnected();

// QoS 0 publish (PubSubClient limitation). Returns false when disconnected
// or the payload did not fit into the buffer.
bool publish(Topic topic, const char* payload, bool retain);

const char* topicName(Topic topic);

// Largest payload that fits PubSubClient's buffer on this topic
// (cfg::MQTT_BUFFER_SIZE - 5 B max fixed header - 2 B topic length - topic).
size_t maxPayloadLen(Topic topic);

}  // namespace net
