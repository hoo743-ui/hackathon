// =============================================================================
// config.h — THE ONLY place for pins, bin mapping, servo angles, timings and
// protocol constants. Do not hard-code any of these anywhere else.
//
//  !!! UNVERIFIED PLACEHOLDERS !!!
//  Every GPIO number and every servo angle below is a *candidate* taken from
//  docs/HARDWARE_WIRING.md. None of it has been checked on real hardware:
//    - confirm the module is WROOM-32E (on WROVER, GPIO16/17 are NOT usable)
//    - confirm board silkscreen vs. this table
//    - confirm the Echo divider output is <= 3.3 V before connecting ECHO pins
//    - measure the real closed/open angles of every lid with the servo
//      DISCONNECTED from the mechanism first, then tighten the hard limits
//  Update the checklist in docs/HARDWARE_WIRING.md when an item is verified.
//
//  Until PINMAP_CONFIRMED (below) is set to true the firmware still builds and
//  runs the ultrasonic sensors, but REFUSES every servo motion (OPEN_BIN ->
//  ACK FAILED, error_code PINMAP_UNCONFIRMED). Procedure: README.md section 5.
// =============================================================================
#pragma once

#include <stdint.h>

namespace cfg {

// ----------------------------------------------------------------------------
// Identity / protocol
// ----------------------------------------------------------------------------
constexpr const char* FIRMWARE_VERSION = "0.2.0";  // MQTT protocol v1.1 fields
constexpr const char* DEVICE_ID = "DEVICE_001";
constexpr const char* MQTT_TOPIC_PREFIX = "smartbin";  // smartbin/{device_id}/...
constexpr const char* SOURCE = "hardware";              // vs "simulator" (ARCHITECTURE D6)
constexpr int TELEMETRY_SCHEMA_VERSION = 1;

// ----------------------------------------------------------------------------
// Pin map confirmation gate.
// The GPIO numbers in BINS[] are CANDIDATES, not a final pin map. Leave this
// false until every item of the README.md section 5 "PINMAP_CONFIRMED" procedure
// has been checked ON THE REAL BOARD (module WROOM vs WROVER, GPIO16/17,
// strapping pins, ECHO divider measured <= 3.3 V, servo on a separate 5 V
// supply with common GND) and recorded in docs/HARDWARE_WIRING.md.
//   false: boot banner warning on serial; sensors run; servos are never
//          attached and OPEN_BIN is refused with PINMAP_UNCONFIRMED.
//   true : normal operation (all other safety rules still apply).
// ----------------------------------------------------------------------------
constexpr bool PINMAP_CONFIRMED = false;

// ----------------------------------------------------------------------------
// Bins. Index order == measurement order (BIN_001 -> BIN_004).
// PIN VALUES ARE UNVERIFIED CANDIDATES (docs/HARDWARE_WIRING.md section 2) —
// NOT a final pin map. See PINMAP_CONFIRMED above.
//   - ECHO pins 34/35 are input-only (fine for ECHO, never use them for TRIG).
//   - ECHO must go through the 1k/2k divider (5 V -> ~3.3 V).
//   - GPIO14 may toggle during boot -> check whether servo #2 twitches.
// ----------------------------------------------------------------------------
struct BinConfig {
    const char* binId;
    const char* wasteType;  // command "target" value (ARCHITECTURE D9)
    uint8_t trigPin;
    uint8_t echoPin;
    uint8_t servoPin;
    int closedAngle;  // UNVERIFIED placeholder (degrees)
    int openAngle;    // UNVERIFIED placeholder (degrees)
};

constexpr int NUM_BINS = 4;
constexpr BinConfig BINS[NUM_BINS] = {
    //  bin_id     type       TRIG ECHO SERVO closed open
    {"BIN_001", "plastic", 16, 34, 13, 0, 90},
    {"BIN_002", "metal", 17, 35, 14, 0, 90},
    {"BIN_003", "paper", 18, 32, 25, 0, 90},
    {"BIN_004", "glass", 19, 33, 26, 0, 90},
};

// ----------------------------------------------------------------------------
// Servo (SG90) — UNVERIFIED. Every commanded angle is clamped to
// [SERVO_HARD_MIN_ANGLE, SERVO_HARD_MAX_ANGLE] no matter what is requested.
// Tighten these once the mechanical end stops of each lid are known.
// ----------------------------------------------------------------------------
constexpr int SERVO_HARD_MIN_ANGLE = 0;
constexpr int SERVO_HARD_MAX_ANGLE = 120;
constexpr int SERVO_PWM_HZ = 50;
constexpr int SERVO_MIN_PULSE_US = 500;   // SG90 typical, verify
constexpr int SERVO_MAX_PULSE_US = 2400;  // SG90 typical, verify

// SG90 has no position feedback: "motion done" == this much time elapsed
// after the write. ~0.1 s/60deg unloaded -> 700 ms leaves margin for load.
constexpr uint32_t SERVO_MOVE_SETTLE_MS = 700;
// How long the lid stays open before closing automatically.
constexpr uint32_t OPEN_HOLD_MS = 3000;
// Watchdog for one complete open->hold->close cycle. Exceeding it forces the
// lid to the closed angle and fails the command.
constexpr uint32_t MOTION_TIMEOUT_MS = 8000;
// Idle time between two servo cycles (lets the 5 V rail recover).
constexpr uint32_t SERVO_COOLDOWN_MS = 300;
// Pause ultrasonic sampling while a servo is moving (supply noise, lid moves).
constexpr bool PAUSE_SENSING_DURING_MOTION = true;

constexpr bool binAnglesWithinHardLimits(int i = 0) {
    return i >= NUM_BINS ||
           (BINS[i].closedAngle >= SERVO_HARD_MIN_ANGLE && BINS[i].closedAngle <= SERVO_HARD_MAX_ANGLE &&
            BINS[i].openAngle >= SERVO_HARD_MIN_ANGLE && BINS[i].openAngle <= SERVO_HARD_MAX_ANGLE &&
            binAnglesWithinHardLimits(i + 1));
}
// Angles are also clamped at runtime; this catches config typos at build time.
static_assert(binAnglesWithinHardLimits(), "a BINS[] servo angle is outside the hard limits");
static_assert(SERVO_HARD_MIN_ANGLE >= 0 && SERVO_HARD_MAX_ANGLE <= 180 &&
                  SERVO_HARD_MIN_ANGLE < SERVO_HARD_MAX_ANGLE,
              "invalid servo hard limits");
// The whole OPEN_BIN cycle must finish before the server's ACK timeout even
// when the command is accepted just before it expires. Keep in sync with
// COMMAND_EXPIRES_SEC (3 s) / COMMAND_ACK_TIMEOUT_SEC (15 s) in .env.
constexpr uint32_t SERVER_COMMAND_EXPIRES_MS = 3000;
constexpr uint32_t SERVER_ACK_TIMEOUT_MS = 15000;
static_assert(2 * SERVO_MOVE_SETTLE_MS + OPEN_HOLD_MS < MOTION_TIMEOUT_MS,
              "MOTION_TIMEOUT_MS shorter than a normal cycle");
static_assert(SERVER_COMMAND_EXPIRES_MS + MOTION_TIMEOUT_MS + SERVO_MOVE_SETTLE_MS < SERVER_ACK_TIMEOUT_MS,
              "OPEN_BIN cycle could exceed the server ACK timeout");

// ----------------------------------------------------------------------------
// Ultrasonic (HC-SR04)
// ----------------------------------------------------------------------------
constexpr int SAMPLES_PER_MEASUREMENT = 5;
constexpr int MIN_VALID_SAMPLES = 3;          // fewer -> non-normal status, distance null
constexpr uint32_t INTER_PING_GAP_MS = 60;    // >= 60 ms (HC-SR04 datasheet)
constexpr uint32_t ECHO_TIMEOUT_US = 30000;   // ~5 m round trip; > 400 cm => timeout
constexpr uint32_t TRIG_PULSE_US = 10;
constexpr float MIN_VALID_DISTANCE_CM = 2.0f;
constexpr float MAX_VALID_DISTANCE_CM = 400.0f;
constexpr float SOUND_CM_PER_US = 0.0343f;    // ~20 degC, no temperature compensation

static_assert(INTER_PING_GAP_MS >= 60, "HC-SR04 needs >= 60 ms between pings");
static_assert(MIN_VALID_SAMPLES >= 1 && MIN_VALID_SAMPLES <= SAMPLES_PER_MEASUREMENT,
              "MIN_VALID_SAMPLES out of range");

// ----------------------------------------------------------------------------
// Publishing intervals
// ----------------------------------------------------------------------------
constexpr uint32_t TELEMETRY_INTERVAL_MS = 5000;
constexpr uint32_t STATUS_HEARTBEAT_MS = 15000;  // must stay below server DEVICE_OFFLINE_AFTER_SEC (30 s)

// ----------------------------------------------------------------------------
// Network
// ----------------------------------------------------------------------------
// PubSubClient buffer: holds one whole MQTT packet (fixed header <= 5 B +
// 2 B topic length + topic + payload) for both RX and TX. Telemetry v1.1 is the
// largest message (714 B worst case measured on host, see README section 4); it is checked at
// runtime against net::maxPayloadLen() before publishing.
constexpr uint16_t MQTT_BUFFER_SIZE = 1024;
static_assert(MQTT_BUFFER_SIZE >= 1024, "telemetry v1.1 needs a >= 1024 B MQTT buffer");
constexpr uint16_t MQTT_KEEPALIVE_S = 15;
constexpr uint16_t MQTT_SOCKET_TIMEOUT_S = 3;  // bounds blocking inside connect()
constexpr uint32_t WIFI_RETRY_MIN_MS = 2000;
constexpr uint32_t WIFI_RETRY_MAX_MS = 60000;
constexpr uint32_t MQTT_RETRY_MIN_MS = 1000;
constexpr uint32_t MQTT_RETRY_MAX_MS = 30000;

constexpr const char* NTP_SERVER_1 = "pool.ntp.org";
constexpr const char* NTP_SERVER_2 = "time.google.com";
// time(nullptr) above this (2024-01-01T00:00:00Z) is treated as "NTP synced".
constexpr long TIME_VALID_AFTER_EPOCH = 1704067200L;

// ----------------------------------------------------------------------------
// Commands
// ----------------------------------------------------------------------------
constexpr int COMMAND_ID_HISTORY = 16;  // ring buffer of processed command_ids
constexpr int COMMAND_ID_MAX_LEN = 64;
// Keep the E-STOP latch in NVS so a reboot / brown-out does NOT clear it.
constexpr bool PERSIST_ESTOP = true;

}  // namespace cfg
