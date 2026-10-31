"""Hardware Abstraction Layer 인터페이스.

웹·모바일·비즈니스 로직(services/)은 이 인터페이스만 사용한다. 시뮬레이터와 실제 ESP32 어댑터는
같은 메서드와 같은 데이터 계약(DeviceOut / BinOut / CommandOut / CommandMessage)을 쓴다.
"""
from enum import StrEnum
from typing import Protocol
from uuid import UUID

from app.core.enums import DataSource
from app.schemas.api import BinOut, CommandOut, DeviceOut
from app.schemas.mqtt import CommandMessage


class HardwareMode(StrEnum):
    SIMULATOR = "SIMULATOR"
    ESP32_REAL = "ESP32_REAL"
    EDGE_SERIAL = "EDGE_SERIAL"  # 카메라 노트북이 USB 시리얼로 하드웨어 구동 (서버는 기록·중계만)


# 모드별로 받아들이는 데이터 출처 — 시뮬레이터 데이터가 실제 장치 데이터로 기록되는 것을 막는다
ACCEPTED_SOURCE: dict[HardwareMode, DataSource] = {
    HardwareMode.SIMULATOR: DataSource.SIMULATOR,
    HardwareMode.ESP32_REAL: DataSource.HARDWARE,
    HardwareMode.EDGE_SERIAL: DataSource.HARDWARE,
}


class HardwareUnavailable(Exception):
    """명령을 장치까지 전달할 수 없음 (브로커 미연결 등)."""


class HardwareAdapter(Protocol):
    mode: HardwareMode

    @property
    def connected(self) -> bool:
        """서버 ↔ 브로커 연결 여부 (장치 연결 여부는 get_device_status)."""
        ...

    @property
    def simulator_running(self) -> bool: ...

    def accepts_source(self, source: DataSource | str | None) -> bool: ...

    async def get_device_status(self, device_id: str) -> DeviceOut | None: ...

    async def get_sensor_data(self, device_id: str) -> list[BinOut]: ...

    async def execute_servo_command(self, message: CommandMessage) -> None:
        """검증을 통과한 명령을 장치로 전달한다 (전송만; 실행 결과는 ACK로 온다). 실패 시 HardwareUnavailable."""
        ...

    async def get_command_status(self, command_id: UUID) -> CommandOut | None: ...

    async def start(self) -> None: ...

    async def disconnect(self) -> None: ...

    async def reconnect(self) -> None: ...
