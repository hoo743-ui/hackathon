#include "sensor_manager.h"

#include <Arduino.h>

const char* sensorStatusName(SensorStatus s) {
    switch (s) {
        case SensorStatus::Normal: return "normal";
        case SensorStatus::OutOfRange: return "out_of_range";
        case SensorStatus::Timeout: return "timeout";
        case SensorStatus::Error: default: return "error";
    }
}

void SensorScanner::begin() {
    for (int i = 0; i < cfg::NUM_BINS; ++i) {
        pinMode(cfg::BINS[i].trigPin, OUTPUT);
        digitalWrite(cfg::BINS[i].trigPin, LOW);
        // ECHO comes through the external 1k/2k divider; GPIO34/35 have no
        // internal pull resistors anyway, so plain INPUT for all.
        pinMode(cfg::BINS[i].echoPin, INPUT);
        results_[i] = BinReading{};
    }
}

void SensorScanner::startScan(uint32_t nowMs) {
    (void)nowMs;
    if (scanning_) return;
    scanning_ = true;
    bin_ = 0;
    sample_ = 0;
    validCount_ = outOfRangeCount_ = timeoutCount_ = errorCount_ = 0;
}

bool SensorScanner::poll(uint32_t nowMs) {
    if (!scanning_) return false;
    // Global gap between ANY two pings (also across bins) to avoid crosstalk
    // and to let the previous echo die out.
    if (pingedBefore_ && (nowMs - lastPingMs_) < cfg::INTER_PING_GAP_MS) return false;

    float d = 0.0f;
    const SampleKind kind = pingOnce(bin_, &d);
    lastPingMs_ = millis();
    pingedBefore_ = true;

    switch (kind) {
        case SampleKind::Valid: valid_[validCount_++] = d; break;
        case SampleKind::OutOfRange: ++outOfRangeCount_; break;
        case SampleKind::Timeout: ++timeoutCount_; break;
        case SampleKind::Error: ++errorCount_; break;
    }

    if (++sample_ >= cfg::SAMPLES_PER_MEASUREMENT) {
        finishBin(bin_);
        sample_ = 0;
        validCount_ = outOfRangeCount_ = timeoutCount_ = errorCount_ = 0;
        if (++bin_ >= cfg::NUM_BINS) {
            scanning_ = false;
            return true;
        }
    }
    return false;
}

SensorScanner::SampleKind SensorScanner::pingOnce(int binIndex, float* distanceCm) {
    const uint8_t trig = cfg::BINS[binIndex].trigPin;
    const uint8_t echo = cfg::BINS[binIndex].echoPin;

    // ECHO already high before triggering => stuck line / wiring fault /
    // previous echo still running. Do not trust this sample.
    if (digitalRead(echo) == HIGH) return SampleKind::Error;

    digitalWrite(trig, LOW);
    delayMicroseconds(2);
    digitalWrite(trig, HIGH);
    delayMicroseconds(cfg::TRIG_PULSE_US);
    digitalWrite(trig, LOW);

    const unsigned long us = pulseIn(echo, HIGH, cfg::ECHO_TIMEOUT_US);
    if (us == 0) return SampleKind::Timeout;  // no echo (or > timeout)

    const float cm = static_cast<float>(us) * cfg::SOUND_CM_PER_US / 2.0f;
    if (cm < cfg::MIN_VALID_DISTANCE_CM || cm > cfg::MAX_VALID_DISTANCE_CM) {
        return SampleKind::OutOfRange;
    }
    *distanceCm = cm;
    return SampleKind::Valid;
}

void SensorScanner::finishBin(int binIndex) {
    BinReading r;
    r.samplesValid = validCount_;

    if (validCount_ >= cfg::MIN_VALID_SAMPLES) {
        // Insertion sort (n <= 5) then median.
        for (int i = 1; i < validCount_; ++i) {
            const float v = valid_[i];
            int j = i - 1;
            while (j >= 0 && valid_[j] > v) {
                valid_[j + 1] = valid_[j];
                --j;
            }
            valid_[j + 1] = v;
        }
        const int n = validCount_;
        const float median = (n % 2 == 1) ? valid_[n / 2] : 0.5f * (valid_[n / 2 - 1] + valid_[n / 2]);
        r.hasDistance = true;
        r.distanceCm = roundf(median * 10.0f) / 10.0f;
        r.status = SensorStatus::Normal;
    } else {
        // Not enough valid samples: NEVER report a distance (no fake 0).
        // Status = most frequent failure kind; ties -> the more severe one.
        r.hasDistance = false;
        r.distanceCm = 0.0f;
        if (errorCount_ >= timeoutCount_ && errorCount_ >= outOfRangeCount_ && errorCount_ > 0) {
            r.status = SensorStatus::Error;
        } else if (timeoutCount_ >= outOfRangeCount_ && timeoutCount_ > 0) {
            r.status = SensorStatus::Timeout;
        } else if (outOfRangeCount_ > 0) {
            r.status = SensorStatus::OutOfRange;
        } else {
            r.status = SensorStatus::Error;  // only some valid samples, no failures?? -> error
        }
    }
    results_[binIndex] = r;
}
