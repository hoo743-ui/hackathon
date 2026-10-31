"""Mock Hardware Simulator CLI — 시나리오 테스트용 외부 가상 장치.

가상 장치 구현은 백엔드와 공유한다: backend/app/hardware/simulator.py
평소에는 백엔드가 HARDWARE_MODE=SIMULATOR + SIMULATOR_AUTOSTART=true 로 가상 장치를 직접 실행한다.
이 CLI는 장애 시나리오(disconnect, no-ack 등)를 수동으로 재현할 때 쓴다 → 백엔드는 SIMULATOR_AUTOSTART=false 로 실행.

시나리오: normal | mixed | filling | sensor-fail | outlier | disconnect | no-ack
"""
import argparse
import asyncio
import logging
import os
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.hardware.simulator import (  # noqa: E402
    BINS,
    SCENARIOS,
    SIM_EMPTY_CM,
    SIM_FULL_CM,
    VirtualDevice,
    VirtualDeviceConfig,
)

log = logging.getLogger("simulator")


def load_env() -> dict[str, str]:
    env = {}
    path = ROOT / ".env"
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    env.update({k: v for k, v in os.environ.items() if k.startswith(("MQTT_", "API_", "SIM_"))})
    return env


def api_base(env: dict[str, str]) -> str:
    return env.get("SIM_API_BASE_URL", f"http://localhost:{env.get('API_PORT', '8000')}")


def preflight(env: dict[str, str], device_id: str) -> None:
    """같은 장치 ID로 다른 장치가 동작 중이면 실행을 거부한다 (명령/ACK/상태 혼선 방지)."""
    import httpx

    try:
        health = httpx.get(f"{api_base(env)}/health", timeout=3).json()
        device = httpx.get(f"{api_base(env)}/api/devices/{device_id}", timeout=3).json()
    except Exception:
        log.warning("백엔드에 접속할 수 없어 사전 점검을 건너뜁니다.")
        return
    if health.get("hardware_mode") == "ESP32_REAL":
        sys.exit("[SIM] 백엔드가 HARDWARE_MODE=ESP32_REAL 입니다. 시뮬레이터 데이터는 폐기됩니다. 실행하지 않습니다.")
    if health.get("simulator_running"):
        sys.exit("[SIM] 백엔드 내장 가상 장치가 이미 실행 중입니다. "
                 "SIMULATOR_AUTOSTART=false scripts/backend.sh 로 백엔드를 다시 시작하세요 (--force 로 무시).")
    if device.get("connection_status") == "online" and device.get("data_source") == "hardware":
        sys.exit(f"[SIM] {device_id} 는 실제 하드웨어로 연결되어 있습니다. 실행하지 않습니다 (--force 로 무시).")


def calibrate(env: dict[str, str]) -> None:
    """[SIM 전용] 가상 통 깊이로 보정값 설정. 실제 하드웨어 보정값을 덮어쓰므로 실기 사용 시 실행 금지."""
    import httpx

    headers = {"Authorization": f"Bearer {env['API_CONTROL_TOKEN']}"}
    for bid, _ in BINS:
        r = httpx.put(f"{api_base(env)}/api/bins/{bid}/calibration", headers=headers,
                      json={"empty_distance_cm": SIM_EMPTY_CM, "full_distance_cm": SIM_FULL_CM}, timeout=5)
        r.raise_for_status()
    log.info("simulator calibration applied (empty=%.0fcm full=%.0fcm)", SIM_EMPTY_CM, SIM_FULL_CM)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--scenario", default="normal", choices=SCENARIOS)
    p.add_argument("--device", default="DEVICE_001")
    p.add_argument("--interval", type=float, default=3.0, help="telemetry 주기(초)")
    p.add_argument("--count", type=int, default=0, help="N회 전송 후 종료 (0=무한)")
    p.add_argument("--servo-seconds", type=float, default=1.5)
    p.add_argument("--disconnect-after", type=float, default=10.0)
    p.add_argument("--calibrate", action="store_true", help="[SIM 전용] API로 가상 보정값 설정 후 시작")
    p.add_argument("--seed", type=int)
    p.add_argument("--force", action="store_true", help="사전 점검 생략")
    args = p.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s [SIM] %(message)s")
    if args.seed is not None:
        random.seed(args.seed)
    env = load_env()
    if not args.force:
        preflight(env, args.device)
    if args.calibrate:
        calibrate(env)
    cfg = VirtualDeviceConfig(
        mqtt_host=env.get("MQTT_HOST", "localhost"),
        mqtt_port=int(env.get("MQTT_PORT", 1883)),
        username=env.get("MQTT_SIMULATOR_USERNAME"),
        password=env.get("MQTT_SIMULATOR_PASSWORD"),
        topic_prefix=env.get("MQTT_TOPIC_PREFIX", "smartbin"),
        device_id=args.device,
        scenario=args.scenario,
        interval=args.interval,
        count=args.count,
        servo_seconds=args.servo_seconds,
        disconnect_after=args.disconnect_after,
        allow_hard_exit=True,
    )
    try:
        asyncio.run(VirtualDevice(cfg).run())
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
