"""MQTT 페이로드 스키마. 문서: docs/MQTT_PROTOCOL.md"""
import math
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator, model_validator

from app.core.enums import CommandType, DataSource, OperatingMode, SensorStatus, WasteType

DEVICE_ID_PATTERN = r"^DEVICE_\d{3}$"
BIN_ID_PATTERN = r"^BIN_\d{3}$"


def _ensure_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class TelemetryBin(BaseModel):
    # fill_percent 등 장치가 보내는 부가 필드는 무시한다 (적재율은 서버가 보정값으로 계산).
    model_config = ConfigDict(extra="ignore")

    bin_id: str = Field(pattern=BIN_ID_PATTERN)
    waste_type: WasteType | None = None  # v1.1: 보내면 서버 설정과 일치해야 함
    distance_cm: float | None = None
    sensor_status: SensorStatus
    samples_valid: int | None = Field(default=None, ge=0, le=50)

    @field_validator("distance_cm")
    @classmethod
    def _finite(cls, v: float | None) -> float | None:
        if v is not None and not math.isfinite(v):
            raise ValueError("distance_cm must be finite")
        return v

    @model_validator(mode="after")
    def _consistent(self) -> "TelemetryBin":
        if self.sensor_status == SensorStatus.NORMAL and self.distance_cm is None:
            raise ValueError("normal reading requires distance_cm")
        if self.sensor_status != SensorStatus.NORMAL:
            self.distance_cm = None
        return self


class TelemetryPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    schema_version: Literal[1] = 1
    message_type: Literal["telemetry"] | None = None
    message_id: UUID | None = None
    device_id: str = Field(pattern=DEVICE_ID_PATTERN)
    source: DataSource
    timestamp: datetime | None = None
    bins: list[TelemetryBin] = Field(min_length=1, max_length=16)

    _utc = field_validator("timestamp")(_ensure_utc)

    @model_validator(mode="after")
    def _unique_bins(self) -> "TelemetryPayload":
        ids = [b.bin_id for b in self.bins]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate bin_id in telemetry")
        return self


class StatusPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    message_type: Literal["status"] | None = None
    message_id: UUID | None = None
    device_id: str = Field(pattern=DEVICE_ID_PATTERN)
    state: Literal["online", "offline"]
    source: DataSource | None = None
    operating_mode: OperatingMode | None = None
    estop_active: bool | None = None
    busy: bool | None = None
    firmware_version: str | None = Field(default=None, max_length=32)
    error_code: str | None = Field(default=None, max_length=32)
    timestamp: datetime | None = None

    _utc = field_validator("timestamp")(_ensure_utc)


class AckPayload(BaseModel):
    """v1(success/message/executed_at)과 v1.1(status/error_code/completed_at)을 모두 수락한다."""

    model_config = ConfigDict(extra="ignore")

    message_type: Literal["ack"] | None = None
    message_id: UUID | None = None
    command_id: UUID
    device_id: str = Field(pattern=DEVICE_ID_PATTERN)
    success: bool | None = None
    status: Literal["SUCCEEDED", "FAILED"] | None = None
    error_code: str | None = Field(default=None, max_length=64)
    message: str | None = Field(default=None, max_length=64)
    executed_at: datetime | None = None
    completed_at: datetime | None = None

    _utc = field_validator("executed_at", "completed_at")(_ensure_utc)

    @model_validator(mode="after")
    def _normalize(self) -> "AckPayload":
        if self.status is None and self.success is None:
            raise ValueError("ack requires status (v1.1) or success (v1)")
        if self.status is not None and self.success is not None and (self.status == "SUCCEEDED") != self.success:
            raise ValueError("status and success disagree")
        if self.success is None:
            self.success = self.status == "SUCCEEDED"
        if self.status is None:
            self.status = "SUCCEEDED" if self.success else "FAILED"
        if not self.success and not self.error_code:
            self.error_code = self.message or "UNKNOWN_ERROR"
        if self.message is None:
            self.message = self.error_code or "OK"
        if self.completed_at is None:
            self.completed_at = self.executed_at
        return self


class CommandMessage(BaseModel):
    """서버 → 장치 명령 (retain 금지). v1 필드(command/requested_at)와 v1.1 별칭(action/issued_at)을 함께 보낸다."""

    message_type: Literal["command"] = "command"
    command_id: UUID
    device_id: str
    command: CommandType
    target: str | None
    bin_id: str | None = None
    # v1.1: manual(관리자) | auto(AI 분류). 장치는 운전 모드와 출처가 맞지 않는 OPEN_BIN을 MODE_CONFLICT로 거부
    origin: Literal["manual", "auto"] = "manual"
    requested_at: datetime
    expires_at: datetime

    @computed_field
    @property
    def message_id(self) -> UUID:
        return self.command_id

    @computed_field
    @property
    def action(self) -> CommandType:
        return self.command

    @computed_field
    @property
    def issued_at(self) -> datetime:
        return self.requested_at
