"""가상 ESP32 (DEVICE_001). 백엔드 내장 실행과 CLI(`scripts/simulate.sh`)가 이 구현 하나를 공유한다.

실제 장치와 같은 MQTT 토픽·메시지 계약(docs/MQTT_PROTOCOL.md v1.1)과 명령 규칙을 따른다:
중복 command_id 거부, 만료 명령 거부, E-STOP 최우선·래치, 서보 1개씩 동작, 동작 완료 후에만 성공 ACK.
모든 메시지에 source="simulator" → 서버·UI가 실제 하드웨어 데이터와 구분한다.

이 모듈은 앱 설정(app.core.config)에 의존하지 않는다 (CLI에서 단독 사용).
"""
import asyncio
import contextlib
import json
import logging
import os
import random
import uuid
from collections import deque
from dataclasses import dataclass
from datetime import UTC, datetime

import aiomqtt

log = logging.getLogger("simulator")

BINS = [("BIN_001", "plastic"), ("BIN_002", "metal"), ("BIN_003", "paper"), ("BIN_004", "glass")]
SIM_EMPTY_CM = 40.0  # 가상 통 깊이 (실제 보정값 아님)
SIM_FULL_CM = 5.0
SCENARIOS = ("normal", "mixed", "filling", "sensor-fail", "outlier", "disconnect", "no-ack")
FIRMWARE_VERSION = "sim-0.2.0"


def now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


@dataclass
class VirtualDeviceConfig:
    mqtt_host: str
    mqtt_port: int
    username: str | None
    password: str | None
    topic_prefix: str = "smartbin"
    device_id: str = "DEVICE_001"
    scenario: str = "mixed"
    interval: float = 3.0
    count: int = 0  # N회 전송 후 종료 (0 = 무한)
    servo_seconds: float = 1.5
    disconnect_after: float = 10.0
    # CLI 전용: disconnect 시나리오에서 DISCONNECT 없이 프로세스를 끝내 LWT를 유발
    allow_hard_exit: bool = False

    def __post_init__(self) -> None:
        if self.scenario not in SCENARIOS:
            raise ValueError(f"unknown scenario {self.scenario}")
        if self.scenario == "disconnect" and not self.allow_hard_exit:
            raise ValueError("disconnect scenario is only available from the CLI simulator")


class VirtualDevice:
    def __init__(self, cfg: VirtualDeviceConfig):
        self.cfg = cfg
        self.device_id = cfg.device_id
        if cfg.scenario == "mixed":
            # 목표 적재율 30/62/86/97% → 가상 통 기준 거리
            self.distances = {
                bid: SIM_EMPTY_CM - p / 100 * (SIM_EMPTY_CM - SIM_FULL_CM)
                for (bid, _), p in zip(BINS, (30, 62, 86, 97))
            }
        else:
            self.distances = {bid: random.uniform(25, 38) for bid, _ in BINS}
        self.mode = "MANUAL"
        self.estop = False
        self.busy = False
        self.seen_ids: deque[str] = deque(maxlen=16)
        self.tick = 0
        self.last_statuses: dict[str, str] = {}
        self.client: aiomqtt.Client | None = None
        self.connected = False

    def topic(self, kind: str) -> str:
        return f"{self.cfg.topic_prefix}/{self.device_id}/{kind}"

    # ---- publishing ----
    async def publish(self, kind: str, payload: dict, retain: bool = False) -> None:
        await self.client.publish(self.topic(kind), json.dumps(payload), qos=1, retain=retain)

    def _error_code(self) -> str | None:
        return "SENSOR_FAULT" if any(s != "normal" for s in self.last_statuses.values()) else None

    async def publish_status(self) -> None:
        await self.publish(
            "status",
            {
                "message_type": "status",
                "message_id": str(uuid.uuid4()),
                "device_id": self.device_id,
                "source": "simulator",
                "state": "online",
                "operating_mode": self.mode,
                "estop_active": self.estop,
                "busy": self.busy,
                "firmware_version": FIRMWARE_VERSION,
                "error_code": self._error_code(),
                "timestamp": now_iso(),
            },
            retain=True,
        )

    def reading(self, bin_id: str, waste_type: str) -> dict:
        s = self.cfg.scenario
        base = {"bin_id": bin_id, "waste_type": waste_type, "fill_percent": None}
        if s == "sensor-fail" and bin_id == "BIN_002" and self.tick % 3 != 0:
            return {**base, "distance_cm": None, "sensor_status": "timeout", "samples_valid": 0}
        if s == "outlier" and bin_id == "BIN_003" and self.tick % 4 == 1:
            return {**base, "distance_cm": 950.0, "sensor_status": "normal", "samples_valid": 5}
        d = max(SIM_FULL_CM - 1, self.distances[bin_id] + random.uniform(-0.3, 0.3))
        return {**base, "distance_cm": round(d, 1), "sensor_status": "normal", "samples_valid": 5}

    async def publish_telemetry(self) -> None:
        if self.cfg.scenario == "mixed":
            for bid, _ in BINS:
                self.distances[bid] = min(SIM_EMPTY_CM, max(SIM_FULL_CM, self.distances[bid] + random.uniform(-0.15, 0.15)))
        if self.cfg.scenario == "filling":
            for bid, _ in BINS:
                self.distances[bid] = max(SIM_FULL_CM - 1, self.distances[bid] - random.uniform(0.05, 0.3))
        bins = [self.reading(bid, wt) for bid, wt in BINS]
        previous_error = self._error_code()
        self.last_statuses = {b["bin_id"]: b["sensor_status"] for b in bins}
        await self.publish(
            "telemetry",
            {
                "schema_version": 1,
                "message_type": "telemetry",
                "message_id": str(uuid.uuid4()),
                "device_id": self.device_id,
                "source": "simulator",
                "timestamp": now_iso(),
                "bins": bins,
            },
        )
        self.tick += 1
        log.debug("telemetry %s", {b["bin_id"]: b["distance_cm"] for b in bins})
        if self._error_code() != previous_error:
            await self.publish_status()

    async def ack(self, command_id: str, success: bool, message: str) -> None:
        if self.cfg.scenario == "no-ack":
            log.warning("no-ack scenario: dropping ack %s (%s)", command_id, message)
            return
        completed = now_iso()
        await self.publish(
            "ack",
            {
                "message_type": "ack",
                "message_id": command_id,
                "command_id": command_id,
                "device_id": self.device_id,
                "status": "SUCCEEDED" if success else "FAILED",
                "error_code": None if success else message,
                "message": message,
                "success": success,
                "completed_at": completed,
                "executed_at": completed,
            },
        )
        log.info("ack %s %s %s", command_id, "SUCCEEDED" if success else "FAILED", message)

    # ---- command handling (펌웨어 규칙과 동일) ----
    async def handle_command(self, raw: bytes) -> None:
        try:
            cmd = json.loads(raw)
            cid = str(uuid.UUID(cmd["command_id"]))
        except (ValueError, KeyError, TypeError):
            log.warning("invalid command payload: %r", raw[:200])
            return
        name = cmd.get("command") or cmd.get("action")
        target, bin_id = cmd.get("target"), cmd.get("bin_id")
        log.info("command %s %s %s", cid, name, target)

        if cmd.get("device_id") != self.device_id:
            return await self.ack(cid, False, "INVALID_DEVICE")
        # 긴급정지는 중복/만료 검사보다 먼저, 항상 실행
        if name == "EMERGENCY_STOP":
            self.seen_ids.append(cid)
            self.estop = True
            self.busy = False
            await self.ack(cid, True, "ESTOP_ACTIVATED")
            return await self.publish_status()

        if cid in self.seen_ids:
            return await self.ack(cid, False, "DUPLICATE")
        self.seen_ids.append(cid)
        try:
            expires = datetime.fromisoformat(cmd["expires_at"].replace("Z", "+00:00"))
        except (KeyError, ValueError, AttributeError):
            return await self.ack(cid, False, "INVALID_COMMAND")
        if expires < datetime.now(UTC):
            return await self.ack(cid, False, "EXPIRED")

        if name == "RESET_ESTOP":
            self.estop = False
            await self.ack(cid, True, "ESTOP_RESET")
            return await self.publish_status()
        if name == "GET_STATUS":
            await self.publish_status()
            return await self.ack(cid, True, "STATUS_SENT")
        if self.estop:
            return await self.ack(cid, False, "ESTOP_ACTIVE")
        if self.busy:
            return await self.ack(cid, False, "BUSY")
        if name == "SET_MODE":
            if target not in ("AUTO", "MANUAL"):
                return await self.ack(cid, False, "INVALID_TARGET")
            self.mode = target
            await self.ack(cid, True, "MODE_SET")
            return await self.publish_status()
        if name == "OPEN_BIN":
            configured = next((b for b, w in BINS if w == target), None)
            if configured is None or (bin_id is not None and bin_id != configured):
                return await self.ack(cid, False, "INVALID_TARGET")
            # 자동 모드는 AI 분류(origin=auto)만, 수동 모드는 관리자(origin=manual, v1 기본값)만 허용
            origin = cmd.get("origin") or "manual"
            if (self.mode == "AUTO") != (origin == "auto"):
                return await self.ack(cid, False, "MODE_CONFLICT")
            asyncio.create_task(self.run_servo(cid, configured))
            return
        await self.ack(cid, False, "INVALID_COMMAND")

    async def run_servo(self, cid: str, bin_id: str) -> None:
        """열기 → 대기 → 닫기 가상 동작. 완료 후에만 성공 ACK."""
        self.busy = True
        await self.publish_status()
        await asyncio.sleep(self.cfg.servo_seconds)
        if self.estop:
            self.busy = False
            return await self.ack(cid, False, "ABORTED_BY_ESTOP")
        if not self.connected:
            self.busy = False
            return  # 연결이 끊기면 동작 결과를 보낼 수 없음 (서버 TIMEOUT)
        self.distances[bin_id] = max(SIM_FULL_CM - 1, self.distances[bin_id] - random.uniform(1, 3))
        self.busy = False
        await self.ack(cid, True, "BIN_OPENED")
        await self.publish_status()

    # ---- main loop ----
    async def run(self) -> None:
        cfg = self.cfg
        will = aiomqtt.Will(
            self.topic("status"),
            json.dumps({"message_type": "status", "device_id": self.device_id, "state": "offline"}),
            qos=1,
            retain=True,
        )
        delay = 1.0
        loop = asyncio.get_running_loop()
        started = loop.time()
        while True:
            try:
                async with aiomqtt.Client(
                    hostname=cfg.mqtt_host,
                    port=cfg.mqtt_port,
                    username=cfg.username,
                    password=cfg.password,
                    identifier=f"sim-{self.device_id}-{uuid.uuid4().hex[:6]}",
                    keepalive=10,
                    will=will,
                ) as client:
                    self.client = client
                    self.connected = True
                    delay = 1.0
                    await client.subscribe(self.topic("command"), qos=1)
                    await self.publish_status()
                    log.info("virtual device %s connected (scenario=%s)", self.device_id, cfg.scenario)

                    async def listen():
                        async for msg in client.messages:
                            await self.handle_command(msg.payload)

                    listener = asyncio.create_task(listen())
                    try:
                        sent = 0
                        while True:
                            await self.publish_telemetry()
                            sent += 1
                            if cfg.count and sent >= cfg.count:
                                await asyncio.sleep(0.5)
                                return
                            if cfg.scenario == "disconnect" and loop.time() - started >= cfg.disconnect_after:
                                log.warning("disconnect scenario: exiting without DISCONNECT (LWT expected)")
                                os._exit(0)
                            if listener.done():
                                listener.result()
                            await asyncio.sleep(cfg.interval)
                    except asyncio.CancelledError:
                        # 정상 종료(백엔드 종료 등): DISCONNECT 시 LWT가 발행되지 않으므로 직접 offline 발행
                        with contextlib.suppress(Exception):
                            await self.publish("status", {"message_type": "status", "device_id": self.device_id,
                                                          "source": "simulator", "state": "offline"}, retain=True)
                        raise
                    finally:
                        listener.cancel()
                        self.connected = False
            except aiomqtt.MqttError as exc:
                self.connected = False
                log.warning("virtual device MQTT error: %s — reconnecting in %.0fs", exc, delay)
                await asyncio.sleep(delay)
                delay = min(delay * 2, 15)
