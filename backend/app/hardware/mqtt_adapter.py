"""ESP32_REAL 어댑터: 실제 ESP32와 MQTT로 통신한다. (시뮬레이터 어댑터도 같은 전송 경로를 상속해 쓴다)"""
import asyncio
import contextlib
import logging

from app.core.config import Settings
from app.hardware.base import BaseHardwareAdapter
from app.hardware.interfaces import HardwareMode, HardwareUnavailable
from app.mqtt.client import MqttManager, MqttUnavailable
from app.mqtt.handlers import HANDLERS
from app.schemas.mqtt import CommandMessage

logger = logging.getLogger(__name__)


class MqttHardwareAdapter(BaseHardwareAdapter):
    def __init__(self, settings: Settings, mode: HardwareMode = HardwareMode.ESP32_REAL):
        super().__init__(mode)
        self._settings = settings
        self._mqtt = MqttManager(settings, HANDLERS)
        self._task: asyncio.Task | None = None

    @property
    def connected(self) -> bool:
        return self._mqtt.connected

    async def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._mqtt.run(), name="mqtt")

    async def disconnect(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    async def reconnect(self) -> None:
        await self.disconnect()
        await self.start()

    async def execute_servo_command(self, message: CommandMessage) -> None:
        topic = f"{self._settings.mqtt_topic_prefix}/{message.device_id}/command"
        try:
            await self._mqtt.publish(topic, message.model_dump(mode="json"))
        except MqttUnavailable as exc:
            raise HardwareUnavailable(str(exc)) from exc
