// app — shared device state and reporting hooks (implemented in main.cpp).
#pragma once

#include "servo_controller.h"

enum class OperatingMode : uint8_t { Manual, Auto };

inline const char* operatingModeName(OperatingMode m) { return m == OperatingMode::Auto ? "AUTO" : "MANUAL"; }

struct AppState {
    // Boot default is MANUAL: the device never opens a lid on its own. The mode
    // is not persisted and the server does NOT re-apply it automatically; the
    // reported status (MANUAL) becomes the server's state after a reboot.
    OperatingMode mode = OperatingMode::Manual;
};

extern AppState g_app;
extern Actuators g_actuators;

// Publishes the retained "online" status immediately (no-op if disconnected).
void publishStatusNow();
// Marks status as changed; main loop publishes it soon.
void markStatusDirty();
