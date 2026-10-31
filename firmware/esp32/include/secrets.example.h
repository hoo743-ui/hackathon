// secrets.example.h — template. Copy to secrets.h (gitignored) and fill in:
//   cp include/secrets.example.h include/secrets.h
// Use the dedicated *device* broker account (not the server/simulator one).
#pragma once

#define WIFI_SSID "your-wifi-ssid"
#define WIFI_PASSWORD "your-wifi-password"
#define MQTT_HOST "192.168.0.10"  // LAN IP of the PC running Mosquitto
#define MQTT_PORT 1883
#define MQTT_USERNAME "device_001"
#define MQTT_PASSWORD "change-me"
