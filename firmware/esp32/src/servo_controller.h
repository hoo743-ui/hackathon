// servo_controller — non-blocking SG90 lid control.
//
// Safety rules enforced here (independent of the command layer):
//   * at most ONE servo is attached / driven at any time (5 V power budget)
//   * servos are NOT attached at boot -> no motion at power-up
//   * a servo is attached only for a cycle and detached after it closes
//   * every angle is clamped to [SERVO_HARD_MIN_ANGLE, SERVO_HARD_MAX_ANGLE]
//   * the E-STOP latch blocks every new motion until resetEstop()
//   * the latch is persisted in NVS (cfg::PERSIST_ESTOP) so a reboot keeps it
//   * while cfg::PINMAP_CONFIRMED is false no servo is ever attached and
//     startOpenCycle() returns PinmapUnconfirmed
#pragma once

#include <stdint.h>

enum class CycleOutcome : uint8_t {
    Completed,  // open -> hold -> close finished normally
    Aborted,    // abortToSafe() (MQTT / Wi-Fi loss)
    EStopped,   // emergencyStop()
    TimedOut,   // MOTION_TIMEOUT_MS watchdog fired
};

const char* cycleOutcomeName(CycleOutcome o);

struct CycleResult {
    int binIndex;
    CycleOutcome outcome;
};

enum class StartResult : uint8_t { Started, Busy, EStopActive, InvalidBin, PinmapUnconfirmed };

class Actuators {
public:
    void begin();  // loads E-STOP latch; does NOT attach/move any servo
    void update(uint32_t nowMs);

    StartResult startOpenCycle(int binIndex, uint32_t nowMs);

    // Drive the active servo (if any) to its closed/safe angle, detach after
    // it settled, and LATCH the E-STOP. Idempotent.
    void emergencyStop(uint32_t nowMs);
    // Same safe-close without latching. Used on MQTT/Wi-Fi loss.
    void abortToSafe(uint32_t nowMs);
    // Clears the latch. Returns false (and keeps the latch) while a servo is
    // still finishing its safe-close.
    bool resetEstop();

    bool estopActive() const { return estop_; }
    bool busy() const { return state_ != State::Idle; }
    // True while a servo is attached / physically moving or holding.
    bool motionActive() const;
    int activeBin() const { return activeBin_; }

    // Returns true once per finished/aborted cycle.
    bool takeResult(CycleResult* out);

private:
    enum class State : uint8_t { Idle, Opening, Holding, Closing, SafeClosing, Cooldown };

    void beginSafeClose(uint32_t nowMs, CycleOutcome outcome);
    void finishCycle(uint32_t nowMs, CycleOutcome outcome);
    void writeAngle(int binIndex, int angle);
    void persistEstop();
    static int clampAngle(int angle);

    State state_ = State::Idle;
    int activeBin_ = -1;
    uint32_t phaseStartMs_ = 0;
    uint32_t cycleStartMs_ = 0;
    CycleOutcome pendingOutcome_ = CycleOutcome::Completed;
    bool estop_ = false;

    bool hasResult_ = false;
    CycleResult result_{-1, CycleOutcome::Completed};
};
