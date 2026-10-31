#!/usr/bin/env bash
# Mock Hardware Simulator. 예: scripts/simulate.sh --scenario filling
#   시나리오: normal | filling | sensor-fail | outlier | disconnect | no-ack
source "$(dirname "$0")/_common.sh"
exec "$ROOT/backend/.venv/bin/python" "$ROOT/scripts/simulator/simulator.py" "$@"
