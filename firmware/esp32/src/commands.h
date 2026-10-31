// commands — validate, de-duplicate and execute server commands; publish ACKs.
//
// Processing order (docs/MQTT_PROTOCOL.md, ARCHITECTURE D3/D10):
//   1. parse JSON, require command_id (no id -> dropped, cannot be ACKed);
//      message_type (v1.1), if present, must be "command" (else dropped)
//   2. device_id must match            -> INVALID_DEVICE
//   3. EMERGENCY_STOP: executed IMMEDIATELY, before dedupe/expiry/busy checks
//      (stopping is always safe, so it is never refused) -> ESTOP_ACTIVATED
//   4. command_id seen before          -> DUPLICATE (not re-executed)
//   5. command whitelist               -> INVALID_COMMAND
//      (`action` is the v1.1 alias of `command`, `issued_at` of
//      `requested_at`; both present but different -> INVALID_COMMAND;
//      `origin` present but not "manual"/"auto" -> INVALID_COMMAND)
//   6. expires_at missing/unparseable  -> INVALID_COMMAND
//   7. clock not NTP-synced: OPEN_BIN / RESET_ESTOP -> TIME_NOT_SYNCED
//      (SET_MODE / GET_STATUS are accepted; their expiry cannot be checked)
//   8. expires_at in the past          -> EXPIRED
//   9. command specific: INVALID_TARGET (OPEN_BIN: also when a non-null
//      bin_id is not the bin configured for target), PINMAP_UNCONFIRMED
//      (OPEN_BIN while cfg::PINMAP_CONFIRMED is false), ESTOP_ACTIVE,
//      MODE_CONFLICT (OPEN_BIN: operating mode != origin; absent origin =
//      "manual"), BUSY
// OPEN_BIN is ACKed (BIN_OPENED) only after open -> hold -> close completed.
// Every ACK carries v1 (success/message/executed_at) and v1.1
// (message_type/message_id/status/error_code/completed_at) fields.
#pragma once

#include <stdint.h>

#include "servo_controller.h"

namespace commands {

void handleMessage(const uint8_t* payload, unsigned int length, uint32_t nowMs);

// Called by main when the actuator reports a finished/aborted cycle.
void onCycleResult(const CycleResult& result);

// Called after every MQTT (re)connect: flushes an ACK that could not be sent.
void onConnected();

}  // namespace commands
