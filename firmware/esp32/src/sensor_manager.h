// sensor_manager — HC-SR04 sequential sampling with median filter.
//
// Bins are measured strictly one after another (BIN_001 -> BIN_004), one
// ping at a time, with >= cfg::INTER_PING_GAP_MS between ANY two pings, so
// two sensors never listen at the same time (crosstalk).
//
// The scanner is cooperative: poll() fires at most one ping per call and
// returns immediately when the gap has not elapsed. A single ping blocks for
// at most ~2 x cfg::ECHO_TIMEOUT_US (pulseIn) — that is the only blocking.
#pragma once

#include <stdint.h>

#include "config.h"

enum class SensorStatus : uint8_t { Normal, OutOfRange, Timeout, Error };

const char* sensorStatusName(SensorStatus s);  // "normal" | "out_of_range" | ...

struct BinReading {
    bool hasDistance = false;  // false => publish distance_cm = null
    float distanceCm = 0.0f;   // valid only when hasDistance
    SensorStatus status = SensorStatus::Error;
    uint8_t samplesValid = 0;
};

class SensorScanner {
public:
    void begin();

    // Request a full scan of all bins (ignored if one is already running).
    void startScan(uint32_t nowMs);
    bool scanning() const { return scanning_; }

    // Advance the scan. Returns true exactly once when a full scan completes;
    // results are then available via result().
    bool poll(uint32_t nowMs);

    const BinReading& result(int binIndex) const { return results_[binIndex]; }

private:
    enum class SampleKind : uint8_t { Valid, OutOfRange, Timeout, Error };
    SampleKind pingOnce(int binIndex, float* distanceCm);
    void finishBin(int binIndex);

    bool scanning_ = false;
    int bin_ = 0;
    int sample_ = 0;
    uint32_t lastPingMs_ = 0;
    bool pingedBefore_ = false;

    float valid_[cfg::SAMPLES_PER_MEASUREMENT];
    uint8_t validCount_ = 0;
    uint8_t outOfRangeCount_ = 0;
    uint8_t timeoutCount_ = 0;
    uint8_t errorCount_ = 0;

    BinReading results_[cfg::NUM_BINS];
};
