import asyncio
import json
import logging
import uuid
from collections.abc import Awaitable, Callable

import aiomqtt

from app.core.config import Settings

logger = logging.getLogger(__name__)

Handler = Callable[[str, bytes], Awaitable[None]]


class MqttUnavailable(Exception):
    pass


class MqttManager:
    """브로커 연결 유지(자동 재연결), 구독 메시지 디스패치, 명령 발행."""

    SUBSCRIPTIONS = ("telemetry", "status", "ack")

    def __init__(self, settings: Settings, handlers: dict[str, Handler]):
        self._settings = settings
        self._handlers = handlers
        self._client: aiomqtt.Client | None = None

    @property
    def connected(self) -> bool:
        return self._client is not None

    async def run(self) -> None:
        delay = 1.0
        prefix = self._settings.mqtt_topic_prefix
        while True:
            try:
                async with aiomqtt.Client(
                    hostname=self._settings.mqtt_host,
                    port=self._settings.mqtt_port,
                    username=self._settings.mqtt_backend_username,
                    password=self._settings.mqtt_backend_password,
                    identifier=f"smartbin-backend-{uuid.uuid4().hex[:8]}",
                    keepalive=30,
                    tls_params=(
                        aiomqtt.TLSParameters(ca_certs=self._settings.mqtt_tls_ca_file)
                        if self._settings.mqtt_tls_ca_file
                        else None
                    ),
                ) as client:
                    for kind in self.SUBSCRIPTIONS:
                        await client.subscribe(f"{prefix}/+/{kind}", qos=1)
                    self._client = client
                    delay = 1.0
                    logger.info("MQTT connected to %s:%s", self._settings.mqtt_host, self._settings.mqtt_port)
                    async for message in client.messages:
                        await self._dispatch(message.topic.value, message.payload)
            except aiomqtt.MqttError as exc:
                logger.warning("MQTT connection lost: %s (retry in %.0fs)", exc, delay)
            finally:
                self._client = None
            await asyncio.sleep(delay)
            delay = min(delay * 2, 30.0)

    async def _dispatch(self, topic: str, payload) -> None:
        parts = topic.split("/")
        if len(parts) != 3 or parts[0] != self._settings.mqtt_topic_prefix:
            return
        handler = self._handlers.get(parts[2])
        if handler is None:
            return
        raw = payload if isinstance(payload, bytes) else str(payload).encode()
        try:
            await handler(parts[1], raw)
        except Exception:
            logger.exception("error handling MQTT message on %s", topic)

    async def publish(self, topic: str, payload: dict) -> None:
        client = self._client
        if client is None:
            raise MqttUnavailable("MQTT broker not connected")
        # 명령은 절대 retain하지 않는다 (ARCHITECTURE D3)
        await client.publish(topic, json.dumps(payload), qos=1, retain=False)
