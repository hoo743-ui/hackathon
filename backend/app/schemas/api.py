from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, computed_field, model_validator

from typing import Literal

from app.core.enums import CommandStatus, CommandType, DataSource, DetectionSource, HardwareStatus, MaintenanceKind


class DeviceOut(BaseModel):
    device_id: str
    device_name: str | None
    connection_status: str
    operating_mode: str
    estop_active: bool
    data_source: str | None
    firmware_version: str | None
    error_code: str | None = None
    last_seen: datetime | None
    busy: bool


class BinOut(BaseModel):
    bin_id: str
    device_id: str
    waste_type: str
    current_distance_cm: float | None
    current_fill_percent: float | None
    sensor_status: str | None
    is_full: bool
    calibrated: bool
    last_valid_at: datetime | None
    updated_at: datetime


class SensorLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    distance_cm: float | None
    fill_percent: float | None
    sensor_status: str
    source: str
    measured_at: datetime


class BinHistoryOut(BaseModel):
    bin_id: str
    items: list[SensorLogOut]


class CalibrationOut(BaseModel):
    bin_id: str
    empty_distance_cm: float | None
    full_distance_cm: float | None
    calibrated: bool


class CalibrationIn(BaseModel):
    empty_distance_cm: float = Field(gt=0, le=400)
    full_distance_cm: float = Field(gt=0, le=400)

    @model_validator(mode="after")
    def _order(self) -> "CalibrationIn":
        if self.full_distance_cm >= self.empty_distance_cm:
            raise ValueError("full_distance_cm must be smaller than empty_distance_cm")
        return self


class CommandCreate(BaseModel):
    command: CommandType
    target: str | None = None
    # OPEN_BIN 대상을 bin_id로 지정할 수도 있다 (target과 함께 주면 일치해야 함)
    bin_id: str | None = None
    # 클라이언트 재시도 시 중복 생성을 막기 위한 선택적 멱등 키
    command_id: UUID | None = None


class GlobalCommandCreate(CommandCreate):
    """POST /api/commands 용 (device_id를 본문에 포함)."""

    device_id: str


class CommandOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    command_id: UUID
    device_id: str
    command: str
    target: str | None
    status: CommandStatus
    requested_by: str | None
    requested_at: datetime
    expires_at: datetime
    executed_at: datetime | None
    bin_id: str | None = None
    origin: str = "manual"
    result_message: str | None
    error_message: str | None


class DashboardOut(BaseModel):
    devices: list[DeviceOut]
    bins: list[BinOut]
    recent_commands: list[CommandOut]
    recent_detections: list["DetectionOut"] = []
    server_time: datetime
    hardware_mode: str = "SIMULATOR"
    edges: list["EdgeStatusOut"] = []
    latest_full_alert: "TelemetryOut | None" = None
    latest_distance: "TelemetryOut | None" = None


class BinStatisticsOut(BaseModel):
    bin_id: str
    waste_type: str
    avg_fill_percent: float | None
    max_fill_percent: float | None
    sample_count: int
    error_count: int


class StatisticsOut(BaseModel):
    period_hours: int
    bins: list[BinStatisticsOut]
    command_counts: dict[str, int]


class HealthOut(BaseModel):
    status: str
    database: bool
    mqtt: bool
    hardware_mode: str
    simulator_running: bool


class MeasurementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    device_id: str
    bin_id: str
    distance_cm: float | None
    fill_percent: float | None
    sensor_status: str
    source: str
    measured_at: datetime
    received_at: datetime


class MeasurementPage(BaseModel):
    items: list[MeasurementOut]
    total: int
    limit: int
    offset: int


class CommandPage(BaseModel):
    items: list[CommandOut]
    total: int
    limit: int
    offset: int


class TrendBucketOut(BaseModel):
    bucket_start: datetime
    bin_id: str
    avg_fill_percent: float | None
    max_fill_percent: float | None
    sample_count: int
    error_count: int


class TrendOut(BaseModel):
    period_hours: int
    bucket_minutes: int
    buckets: list[TrendBucketOut]


class BoundingBox(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float


class EdgeDetectionMeta(BaseModel):
    """multipart POST /api/detections 의 metadata(JSON) 필드. 카메라 노트북 → 서버."""

    detection_id: UUID
    device_id: str = Field(min_length=1, max_length=64)  # 카메라 노트북 ID (CAMERA_001)
    waste_type: str = Field(min_length=1, max_length=16)
    class_id: int | None = Field(default=None, ge=0, le=1000)
    confidence: float = Field(ge=0, le=1)
    model_name: str | None = Field(default=None, max_length=64)
    captured_at: datetime | None = None
    bounding_box: BoundingBox | None = None
    hardware_status: HardwareStatus = HardwareStatus.PENDING
    source: DetectionSource = DetectionSource.MODEL


class DetectionCreate(BaseModel):
    """외부 AI 프로그램이 보내는 분류 결과. confidence는 모델 출력값 그대로(0~1)."""

    device_id: str = "DEVICE_001"
    waste_type: str = Field(min_length=1, max_length=16)
    confidence: float = Field(ge=0, le=1)
    detected_at: datetime | None = None
    image_reference: str | None = Field(default=None, max_length=500)
    model: str | None = Field(default=None, max_length=64)
    source: DetectionSource = DetectionSource.MODEL
    # 재전송 시 중복 기록을 막는 멱등 키 (선택)
    detection_id: UUID | None = None
    # --- 카메라 노트북(EDGE_SERIAL) 추가 메타데이터 (모두 선택) ---
    camera_id: str | None = Field(default=None, max_length=64)
    class_id: int | None = Field(default=None, ge=0, le=1000)
    bounding_box: BoundingBox | None = None
    hardware_status: HardwareStatus | None = None


class DetectionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    detection_id: UUID | None
    device_id: str
    bin_id: str | None
    waste_type: str
    confidence: float
    source: str
    model_name: str | None
    image_reference: str | None
    detected_at: datetime
    received_at: datetime
    outcome: str | None
    outcome_detail: str | None
    command_id: UUID | None
    camera_id: str | None = None
    class_id: int | None = None
    bounding_box: dict | None = None
    hardware_status: str | None = None
    image_path: str | None = Field(default=None, exclude=True)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def image_url(self) -> str | None:
        """상대 경로. 클라이언트가 API 기본 주소(맥북 LAN IP)를 앞에 붙인다 — localhost를 넣지 않는다."""
        if not self.image_path or self.detection_id is None:
            return None
        return f"/api/detections/{self.detection_id}/image"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def captured_at(self) -> datetime:
        return self.detected_at


class TelemetryIn(BaseModel):
    """카메라 노트북/ESP32 브리지 → 서버 센서·하드웨어 이벤트."""

    device_id: str = Field(min_length=1, max_length=64)
    kind: str = Field(min_length=1, max_length=32)
    sensor_id: str | None = Field(default=None, max_length=32)
    payload: dict | None = None
    raw: str | None = Field(default=None, max_length=1000)
    source: DataSource = DataSource.HARDWARE
    measured_at: datetime | None = None


class HardwareStatusIn(BaseModel):
    hardware_status: HardwareStatus


class TelemetryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    device_id: str
    kind: str
    sensor_id: str | None
    payload: dict | None
    raw: str | None
    source: str
    measured_at: datetime
    received_at: datetime


class EdgeHeartbeatIn(BaseModel):
    """카메라 노트북 상태 (5초 주기). 값은 노트북이 실제로 확인한 것만 보낸다."""

    device_id: str = Field(min_length=1, max_length=64)
    camera_ok: bool
    camera_index: str | None = Field(default=None, max_length=200)
    model_loaded: bool
    model_name: str | None = Field(default=None, max_length=64)
    model_classes: dict[str, str] | None = None
    fps: float | None = None
    serial_enabled: bool = False
    serial_connected: bool = False
    serial_port: str | None = Field(default=None, max_length=64)
    esp32_port: str | None = Field(default=None, max_length=64)
    esp32_connected: bool = False
    # UNO 펌웨어 종류: uno_controller(ACK·거리 지원) | legacy(trush.ino, 응답 없음) | unknown
    uno_firmware: str | None = Field(default=None, max_length=32)
    servo_state: str | None = Field(default=None, max_length=32)  # idle | moving | unverified | error
    sensor_status: str | None = Field(default=None, max_length=24)
    distance_cm: float | None = None
    fill_percent: float | None = None
    sorted_ok: int = 0
    sorted_failed: int = 0
    upload_queue: int = 0
    uploads_ok: int = 0
    uploads_failed: int = 0
    last_error: str | None = Field(default=None, max_length=300)
    version: str | None = Field(default=None, max_length=32)


class EdgeStatusOut(EdgeHeartbeatIn):
    online: bool
    last_seen: datetime


class DevicesStatusOut(BaseModel):
    hardware_mode: str
    edges: list[EdgeStatusOut]
    devices: list[DeviceOut]
    latest_full_alert: TelemetryOut | None = None
    latest_distance: TelemetryOut | None = None
    server_time: datetime


class DetectionPage(BaseModel):
    items: list[DetectionOut]
    total: int
    limit: int
    offset: int


class DetectionSummaryOut(BaseModel):
    since: datetime
    total: int
    by_waste_type: dict[str, int]
    by_outcome: dict[str, int]
    avg_confidence: float | None


class MaintenanceCreate(BaseModel):
    device_id: str = "DEVICE_001"
    bin_id: str | None = None
    kind: MaintenanceKind
    result: Literal["ok", "issue"]
    note: str | None = Field(default=None, max_length=2000)
    related_command_id: UUID | None = None


class MaintenanceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    device_id: str
    bin_id: str | None
    kind: str
    result: str
    note: str | None
    related_command_id: UUID | None
    created_by: str | None
    created_at: datetime


class MaintenancePage(BaseModel):
    items: list[MaintenanceOut]
    total: int
    limit: int
    offset: int


DashboardOut.model_rebuild()
