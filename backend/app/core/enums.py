from enum import StrEnum


class WasteType(StrEnum):
    PLASTIC = "plastic"
    METAL = "metal"
    PAPER = "paper"
    GLASS = "glass"


class SensorStatus(StrEnum):
    NORMAL = "normal"
    OUT_OF_RANGE = "out_of_range"
    TIMEOUT = "timeout"
    ERROR = "error"
    DISCONNECTED = "disconnected"  # SENSOR_DISCONNECTED: 측정값이 일정 시간 오지 않음


class ConnectionStatus(StrEnum):
    ONLINE = "online"
    OFFLINE = "offline"
    UNKNOWN = "unknown"


class OperatingMode(StrEnum):
    AUTO = "AUTO"
    MANUAL = "MANUAL"


class DataSource(StrEnum):
    HARDWARE = "hardware"
    SIMULATOR = "simulator"


class CommandType(StrEnum):
    OPEN_BIN = "OPEN_BIN"
    SET_MODE = "SET_MODE"
    EMERGENCY_STOP = "EMERGENCY_STOP"
    RESET_ESTOP = "RESET_ESTOP"
    GET_STATUS = "GET_STATUS"


class CommandStatus(StrEnum):
    PENDING = "PENDING"
    SENT = "SENT"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    TIMEOUT = "TIMEOUT"


class CommandOrigin(StrEnum):
    MANUAL = "manual"  # 관리자 (웹·앱)
    AUTO = "auto"  # AI 분류 결과에 따른 자동 동작


class DetectionSource(StrEnum):
    MODEL = "model"  # 실제 AI 모델 결과
    SIMULATOR = "simulator"


class DetectionOutcome(StrEnum):
    SORTING = "SORTING"  # 배출구 명령 전송, 장치 ACK 대기
    SORTED = "SORTED"  # 장치 ACK 성공
    SORT_FAILED = "SORT_FAILED"  # ACK 실패 또는 타임아웃
    LOW_CONFIDENCE = "LOW_CONFIDENCE"  # 임계값 미만 → 동작 안 함
    UNRECOGNIZED = "UNRECOGNIZED"  # 4개 분류에 없는 결과
    MANUAL_MODE = "MANUAL_MODE"  # 장치가 수동 모드 → 기록만
    DEVICE_UNAVAILABLE = "DEVICE_UNAVAILABLE"  # 오프라인/동작 중/긴급정지 등
    # EDGE_SERIAL 모드 (카메라 노트북이 USB 시리얼로 직접 구동)
    SORT_SENT = "SORT_SENT"  # 시리얼 명령 전송 완료 (아두이노가 ACK를 보내지 않으므로 '동작 완료'가 아님)
    NO_HARDWARE = "NO_HARDWARE"  # 카메라 노트북에 하드웨어 미연결/비활성 → 기록만


class HardwareStatus(StrEnum):
    """카메라 노트북이 보고하는 시리얼 전송 결과 (EDGE_SERIAL 모드)."""

    PENDING = "pending"
    COMMAND_SENT = "command_sent"  # 시리얼 write 성공. 실제 모터 동작은 아직(또는 ACK 없는 펌웨어라) 확인 안 됨
    COMPLETED = "completed"  # uno_controller 펌웨어가 ACK:<c>:DONE 응답 → 서보 동작 순서 완료 확인
    ACK_TIMEOUT = "ack_timeout"  # START/DONE 응답이 제한 시간 내에 없음
    REJECTED_BUSY = "rejected_busy"  # 펌웨어가 ACK:<c>:BUSY 로 거부
    ABORTED = "aborted"  # 비상 정지로 중단
    SERIAL_FAILED = "serial_failed"
    NOT_CONNECTED = "not_connected"
    DISABLED = "disabled"
    SKIPPED_BUSY = "skipped_busy"  # 이전 투입 동작 중 → 명령 생략


class MaintenanceKind(StrEnum):
    INSPECTION = "inspection"
    SENSOR_TEST = "sensor_test"
    MOTOR_TEST = "motor_test"
    EMPTIED = "emptied"
    REPAIR = "repair"


IN_FLIGHT_STATUSES = (CommandStatus.PENDING, CommandStatus.SENT)
