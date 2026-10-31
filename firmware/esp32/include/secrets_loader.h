// secrets_loader.h — picks include/secrets.h when present, otherwise falls back
// to the example values so the project still compiles (it will not connect).
#pragma once

#if __has_include("secrets.h")
#include "secrets.h"
#else
#warning "include/secrets.h not found - using secrets.example.h placeholders (device will not connect)"
#include "secrets.example.h"
#endif

#if !defined(WIFI_SSID) || !defined(WIFI_PASSWORD) || !defined(MQTT_HOST) || \
    !defined(MQTT_PORT) || !defined(MQTT_USERNAME) || !defined(MQTT_PASSWORD)
#error "secrets.h must define WIFI_SSID, WIFI_PASSWORD, MQTT_HOST, MQTT_PORT, MQTT_USERNAME, MQTT_PASSWORD"
#endif
