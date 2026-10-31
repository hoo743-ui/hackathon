// time_utils — NTP (UTC) helpers and ISO-8601 parsing/formatting.
#pragma once

#include <stddef.h>
#include <stdint.h>
#include <time.h>

namespace timeutil {

// Starts SNTP (UTC, no DST). Safe to call repeatedly.
void begin();

// True once the RTC holds a plausible (NTP-derived) wall clock.
bool isSynced();

// Current UTC epoch seconds (only meaningful when isSynced()).
time_t nowEpoch();

// Writes "YYYY-MM-DDTHH:MM:SSZ" into out (needs >= 21 bytes).
// Returns false (and writes "") when time is not synced.
bool formatNowIso(char* out, size_t outLen);

// Parses "YYYY-MM-DDTHH:MM:SS[.fff](Z|+HH:MM|-HH:MM)" into UTC epoch seconds.
// Strings without an explicit zone are rejected.
bool parseIso8601(const char* s, time_t* outEpoch);

}  // namespace timeutil
