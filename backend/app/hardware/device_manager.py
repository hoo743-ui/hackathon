"""HARDWARE_MODE에 따라 어댑터를 만들고 수명을 관리한다.

SIMULATOR  : MQTT 전송 경로 + (SIMULATOR_AUTOSTART=true면) 백엔드 내장 가상 장치. source=simulator만 수락
ESP32_REAL : MQTT 전송 경로만. source=hardware만 수락. 가상 장치 없음
EDGE_SERIAL: 카메라 노트북이 아두이노를 USB 시리얼로 직접 구동. 서버는 분류·이미지·센서 이벤트를 기록·중계만
두 모드 모두 같은 MQTT 토픽·메시지 계약을 사용하므로, 시뮬레이터에서 통과한 경로가 실제 장치에서도 그대로 쓰인다.
(단, 시뮬레이터 통과 ≠ 하드웨어 검증)
"""
import asyncio
import contextlib
import logging

from app.core.config import Settings
from app.hardware.interfaces import HardwareAdapter, HardwareMode
from app.hardware.mqtt_adapter import MqttHardwareAdapter
from app.hardware.simulator import VirtualDevice, VirtualDeviceConfig

logger = logging.getLogger(__name__)


class SimulatorHardwareAdapter(MqttHardwareAdapter):
    def __init__(self, settings: Settings):
        super().__init__(settings, HardwareMode.SIMULATOR)
        self._sim_task: asyncio.Task | None = None
        self._device: VirtualDevice | None = None

    @property
    def simulator_running(self) -> bool:
        return self._sim_task is not None and not self._sim_task.done()

    async def start(self) -> None:
        await super().start()
        s = self._settings
        if s.simulator_autostart and not self.simulator_running:
            if not (s.mqtt_simulator_username and s.mqtt_simulator_password):
                logger.error("SIMULATOR_AUTOSTART requires MQTT_SIMULATOR_USERNAME/PASSWORD")
                return
            self._device = VirtualDevice(
                VirtualDeviceConfig(
                    mqtt_host=s.mqtt_host,
                    mqtt_port=s.mqtt_port,
                    username=s.mqtt_simulator_username,
                    password=s.mqtt_simulator_password,
                    topic_prefix=s.mqtt_topic_prefix,
                    scenario=s.simulator_scenario,
                    interval=s.simulator_interval_sec,
                )
            )
            self._sim_task = asyncio.create_task(self._device.run(), name="virtual-device")
            logger.warning("SIMULATOR mode: built-in virtual device started (scenario=%s) — data is SIMULATED",
                           s.simulator_scenario)

    async def disconnect(self) -> None:
        if self._sim_task is not None:
            self._sim_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._sim_task
            self._sim_task = None
        await super().disconnect()


def create_adapter(settings: Settings) -> HardwareAdapter:
    mode = HardwareMode(settings.hardware_mode)
    if mode == HardwareMode.SIMULATOR:
        return SimulatorHardwareAdapter(settings)
    if mode == HardwareMode.EDGE_SERIAL:
        # MQTT 경로는 유지(기존 화면·상태 호환)하되 서버가 명령을 보내지 않는다. 가상 장치 없음.
        return MqttHardwareAdapter(settings, HardwareMode.EDGE_SERIAL)
    return MqttHardwareAdapter(settings, HardwareMode.ESP32_REAL)
