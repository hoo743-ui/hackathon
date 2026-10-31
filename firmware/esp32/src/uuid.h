// uuid — random (version 4) UUIDs for telemetry/status message_id
// (docs/MQTT_PROTOCOL.md v1.1 section 2; the server de-duplicates on it).
#pragma once

#include <stddef.h>
#include <stdint.h>

namespace uuid {

constexpr size_t STR_LEN = 36;  // "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"

// Pure helper (host-testable): sets the version (4) and RFC 4122 variant bits
// in a copy of `bytes` and writes the lowercase canonical form + '\0' into out.
inline void formatV4(const uint8_t bytes[16], char out[STR_LEN + 1]) {
    static const char hex[] = "0123456789abcdef";
    uint8_t b[16];
    for (int i = 0; i < 16; ++i) b[i] = bytes[i];
    b[6] = static_cast<uint8_t>((b[6] & 0x0F) | 0x40);  // version 4
    b[8] = static_cast<uint8_t>((b[8] & 0x3F) | 0x80);  // variant 10xx
    size_t o = 0;
    for (int i = 0; i < 16; ++i) {
        if (i == 4 || i == 6 || i == 8 || i == 10) out[o++] = '-';
        out[o++] = hex[b[i] >> 4];
        out[o++] = hex[b[i] & 0x0F];
    }
    out[o] = '\0';
}

// New random UUID v4 from esp_random() (hardware RNG; truly random only while
// the Wi-Fi/BT radio is on, otherwise pseudo-random — fine for a dedupe key).
void newV4(char out[STR_LEN + 1]);

}  // namespace uuid
