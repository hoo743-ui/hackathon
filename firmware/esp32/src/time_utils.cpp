#include "time_utils.h"

#include <Arduino.h>
#include <ctype.h>
#include <stdio.h>
#include <string.h>

#include "config.h"

namespace timeutil {

namespace {
bool g_started = false;

// Howard Hinnant's days_from_civil: days since 1970-01-01 (proleptic Gregorian).
int64_t daysFromCivil(int64_t y, unsigned m, unsigned d) {
    y -= m <= 2;
    const int64_t era = (y >= 0 ? y : y - 399) / 400;
    const unsigned yoe = static_cast<unsigned>(y - era * 400);
    const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
    const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    return era * 146097 + static_cast<int64_t>(doe) - 719468;
}

bool readDigits(const char*& p, int n, int* out) {
    int v = 0;
    for (int i = 0; i < n; ++i) {
        if (!isdigit(static_cast<unsigned char>(p[i]))) return false;
        v = v * 10 + (p[i] - '0');
    }
    p += n;
    *out = v;
    return true;
}
}  // namespace

void begin() {
    if (g_started) return;
    // gmtOffset = 0, daylightOffset = 0 -> everything is UTC.
    configTime(0, 0, cfg::NTP_SERVER_1, cfg::NTP_SERVER_2);
    g_started = true;
}

bool isSynced() { return time(nullptr) > static_cast<time_t>(cfg::TIME_VALID_AFTER_EPOCH); }

time_t nowEpoch() { return time(nullptr); }

bool formatNowIso(char* out, size_t outLen) {
    if (outLen > 0) out[0] = '\0';
    if (!isSynced() || outLen < 21) return false;
    time_t now = time(nullptr);
    struct tm tmUtc;
    gmtime_r(&now, &tmUtc);
    return strftime(out, outLen, "%Y-%m-%dT%H:%M:%SZ", &tmUtc) > 0;
}

bool parseIso8601(const char* s, time_t* outEpoch) {
    if (s == nullptr) return false;
    const char* p = s;
    int Y, M, D, h, m, sec;
    if (!readDigits(p, 4, &Y) || *p++ != '-') return false;
    if (!readDigits(p, 2, &M) || *p++ != '-') return false;
    if (!readDigits(p, 2, &D)) return false;
    if (*p != 'T' && *p != 't' && *p != ' ') return false;
    ++p;
    if (!readDigits(p, 2, &h) || *p++ != ':') return false;
    if (!readDigits(p, 2, &m) || *p++ != ':') return false;
    if (!readDigits(p, 2, &sec)) return false;
    if (*p == '.') {  // fractional seconds: ignored (truncated)
        ++p;
        if (!isdigit(static_cast<unsigned char>(*p))) return false;
        while (isdigit(static_cast<unsigned char>(*p))) ++p;
    }
    int offsetSec = 0;
    if (*p == 'Z' || *p == 'z') {
        ++p;
    } else if (*p == '+' || *p == '-') {
        const int sign = (*p == '-') ? -1 : 1;
        ++p;
        int oh, om;
        if (!readDigits(p, 2, &oh)) return false;
        if (*p == ':') ++p;
        if (!readDigits(p, 2, &om)) return false;
        if (oh > 23 || om > 59) return false;
        offsetSec = sign * (oh * 3600 + om * 60);
    } else {
        return false;  // no zone designator -> ambiguous, reject
    }
    if (*p != '\0') return false;
    if (M < 1 || M > 12 || D < 1 || D > 31 || h > 23 || m > 59 || sec > 60) return false;

    const int64_t days = daysFromCivil(Y, static_cast<unsigned>(M), static_cast<unsigned>(D));
    const int64_t epoch = days * 86400 + h * 3600 + m * 60 + sec - offsetSec;
    *outEpoch = static_cast<time_t>(epoch);
    return true;
}

}  // namespace timeutil
