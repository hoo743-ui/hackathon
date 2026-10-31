#include "servo_controller.h"

#include <Arduino.h>
#include <ESP32Servo.h>
#include <Preferences.h>

#include "config.h"

namespace {
Servo g_servo;  // ONE servo object => physically impossible to drive two at once
int g_attachedPin = -1;

constexpr const char* NVS_NAMESPACE = "smartbin";
constexpr const char* NVS_KEY_ESTOP = "estop";

void detachServo() {
    if (g_attachedPin >= 0) {
        g_servo.detach();
        // Hold the signal line LOW: no pulses => SG90 stays unpowered-in-place
        // instead of reacting to a floating line.
        pinMode(g_attachedPin, OUTPUT);
        digitalWrite(g_attachedPin, LOW);
        g_attachedPin = -1;
    }
}
}  // namespace

const char* cycleOutcomeName(CycleOutcome o) {
    switch (o) {
        case CycleOutcome::Completed: return "completed";
        case CycleOutcome::Aborted: return "aborted";
        case CycleOutcome::EStopped: return "estopped";
        case CycleOutcome::TimedOut: return "timed_out";
    }
    return "unknown";
}

int Actuators::clampAngle(int angle) {
    if (angle < cfg::SERVO_HARD_MIN_ANGLE) return cfg::SERVO_HARD_MIN_ANGLE;
    if (angle > cfg::SERVO_HARD_MAX_ANGLE) return cfg::SERVO_HARD_MAX_ANGLE;
    return angle;
}

void Actuators::begin() {
    // Signal lines LOW, nothing attached => no PWM, no motion at boot.
    for (int i = 0; i < cfg::NUM_BINS; ++i) {
        pinMode(cfg::BINS[i].servoPin, OUTPUT);
        digitalWrite(cfg::BINS[i].servoPin, LOW);
    }
    g_servo.setPeriodHertz(cfg::SERVO_PWM_HZ);

    if (cfg::PERSIST_ESTOP) {
        Preferences prefs;
        if (prefs.begin(NVS_NAMESPACE, true)) {
            estop_ = prefs.getBool(NVS_KEY_ESTOP, false);
            prefs.end();
        }
    }
    if (estop_) Serial.println("[ACT] E-STOP latch restored from NVS (send RESET_ESTOP to clear)");
}

void Actuators::persistEstop() {
    if (!cfg::PERSIST_ESTOP) return;
    Preferences prefs;
    if (prefs.begin(NVS_NAMESPACE, false)) {
        prefs.putBool(NVS_KEY_ESTOP, estop_);
        prefs.end();
    } else {
        Serial.println("[ACT] WARN: failed to persist E-STOP latch");
    }
}

void Actuators::writeAngle(int binIndex, int angle) {
    // Second line of defence behind startOpenCycle(): never generate PWM on an
    // unconfirmed pin map.
    if (!cfg::PINMAP_CONFIRMED) return;
    const int pin = cfg::BINS[binIndex].servoPin;
    if (g_attachedPin != pin) {
        detachServo();  // enforce single-servo invariant
        g_servo.setPeriodHertz(cfg::SERVO_PWM_HZ);
        g_servo.attach(pin, cfg::SERVO_MIN_PULSE_US, cfg::SERVO_MAX_PULSE_US);
        g_attachedPin = pin;
    }
    g_servo.write(clampAngle(angle));
}

bool Actuators::motionActive() const {
    return state_ == State::Opening || state_ == State::Holding || state_ == State::Closing ||
           state_ == State::SafeClosing;
}

StartResult Actuators::startOpenCycle(int binIndex, uint32_t nowMs) {
    if (!cfg::PINMAP_CONFIRMED) return StartResult::PinmapUnconfirmed;
    if (binIndex < 0 || binIndex >= cfg::NUM_BINS) return StartResult::InvalidBin;
    if (estop_) return StartResult::EStopActive;
    if (state_ != State::Idle) return StartResult::Busy;

    activeBin_ = binIndex;
    cycleStartMs_ = nowMs;
    phaseStartMs_ = nowMs;
    writeAngle(binIndex, cfg::BINS[binIndex].openAngle);
    state_ = State::Opening;
    Serial.printf("[ACT] %s opening\n", cfg::BINS[binIndex].binId);
    return StartResult::Started;
}

void Actuators::beginSafeClose(uint32_t nowMs, CycleOutcome outcome) {
    if (activeBin_ < 0) return;
    writeAngle(activeBin_, cfg::BINS[activeBin_].closedAngle);
    pendingOutcome_ = outcome;
    phaseStartMs_ = nowMs;
    state_ = State::SafeClosing;
    Serial.printf("[ACT] %s safe-close (%s)\n", cfg::BINS[activeBin_].binId, cycleOutcomeName(outcome));
}

void Actuators::finishCycle(uint32_t nowMs, CycleOutcome outcome) {
    detachServo();
    result_ = CycleResult{activeBin_, outcome};
    hasResult_ = true;
    Serial.printf("[ACT] %s cycle %s, servo detached\n", cfg::BINS[activeBin_].binId,
                  cycleOutcomeName(outcome));
    activeBin_ = -1;
    phaseStartMs_ = nowMs;
    state_ = State::Cooldown;
}

void Actuators::update(uint32_t nowMs) {
    const uint32_t inPhase = nowMs - phaseStartMs_;

    // Cycle watchdog (normal phases only; SafeClosing is already going safe).
    if ((state_ == State::Opening || state_ == State::Holding || state_ == State::Closing) &&
        (nowMs - cycleStartMs_) > cfg::MOTION_TIMEOUT_MS) {
        beginSafeClose(nowMs, CycleOutcome::TimedOut);
        return;
    }

    switch (state_) {
        case State::Idle:
            break;
        case State::Opening:
            if (inPhase >= cfg::SERVO_MOVE_SETTLE_MS) {
                phaseStartMs_ = nowMs;
                state_ = State::Holding;
            }
            break;
        case State::Holding:
            if (inPhase >= cfg::OPEN_HOLD_MS) {
                writeAngle(activeBin_, cfg::BINS[activeBin_].closedAngle);
                phaseStartMs_ = nowMs;
                state_ = State::Closing;
            }
            break;
        case State::Closing:
            if (inPhase >= cfg::SERVO_MOVE_SETTLE_MS) finishCycle(nowMs, CycleOutcome::Completed);
            break;
        case State::SafeClosing:
            if (inPhase >= cfg::SERVO_MOVE_SETTLE_MS) finishCycle(nowMs, pendingOutcome_);
            break;
        case State::Cooldown:
            if (inPhase >= cfg::SERVO_COOLDOWN_MS) state_ = State::Idle;
            break;
    }
}

void Actuators::emergencyStop(uint32_t nowMs) {
    const bool wasLatched = estop_;
    estop_ = true;
    if (!wasLatched) persistEstop();

    switch (state_) {
        case State::Opening:
        case State::Holding:
        case State::Closing:
            beginSafeClose(nowMs, CycleOutcome::EStopped);
            break;
        case State::SafeClosing:
            pendingOutcome_ = CycleOutcome::EStopped;  // already heading to safe angle
            break;
        default:
            break;
    }
    Serial.println("[ACT] E-STOP latched");
}

void Actuators::abortToSafe(uint32_t nowMs) {
    if (state_ == State::Opening || state_ == State::Holding || state_ == State::Closing) {
        beginSafeClose(nowMs, CycleOutcome::Aborted);
    }
}

bool Actuators::resetEstop() {
    if (motionActive()) return false;
    if (estop_) {
        estop_ = false;
        persistEstop();
        Serial.println("[ACT] E-STOP reset");
    }
    return true;
}

bool Actuators::takeResult(CycleResult* out) {
    if (!hasResult_) return false;
    *out = result_;
    hasResult_ = false;
    return true;
}
