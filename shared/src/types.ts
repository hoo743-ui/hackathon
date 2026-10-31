// 백엔드 Pydantic 스키마(backend/app/schemas/api.py)와 1:1 대응. 웹/모바일 공용.
// 백엔드 스키마를 바꾸면 이 파일도 함께 수정한다.

export type WasteType = 'plastic' | 'metal' | 'paper' | 'glass';
export type SensorStatus = 'normal' | 'out_of_range' | 'timeout' | 'error' | 'disconnected';
export type ConnectionStatus = 'online' | 'offline' | 'unknown';
export type OperatingMode = 'AUTO' | 'MANUAL';
export type DataSource = 'hardware' | 'simulator';
export type CommandType = 'OPEN_BIN' | 'SET_MODE' | 'EMERGENCY_STOP' | 'RESET_ESTOP' | 'GET_STATUS';
export type CommandStatus = 'PENDING' | 'SENT' | 'SUCCEEDED' | 'FAILED' | 'TIMEOUT';
export type CommandOrigin = 'manual' | 'auto';

export interface Device {
  device_id: string;
  device_name: string | null;
  connection_status: ConnectionStatus;
  operating_mode: OperatingMode;
  estop_active: boolean;
  data_source: DataSource | null;
  firmware_version: string | null;
  /** 장치가 status로 보고한 오류 (SENSOR_FAULT, TIME_NOT_SYNCED). null = 정상 */
  error_code?: string | null;
  last_seen: string | null;
  busy: boolean;
}

export interface Bin {
  bin_id: string;
  device_id: string;
  waste_type: WasteType;
  current_distance_cm: number | null;
  current_fill_percent: number | null; // null = 미보정 또는 정상 측정 이력 없음 (0%와 구분)
  sensor_status: SensorStatus | null;
  is_full: boolean;
  calibrated: boolean;
  last_valid_at: string | null;
  updated_at: string;
}

export interface SensorLog {
  distance_cm: number | null;
  fill_percent: number | null;
  sensor_status: SensorStatus;
  source: DataSource;
  measured_at: string;
}

export interface BinHistory {
  bin_id: string;
  items: SensorLog[];
}

export interface Calibration {
  bin_id: string;
  empty_distance_cm: number | null;
  full_distance_cm: number | null;
  calibrated: boolean;
}

export interface Command {
  command_id: string;
  device_id: string;
  command: CommandType;
  target: string | null;
  status: CommandStatus;
  requested_by: string | null;
  requested_at: string;
  expires_at: string;
  executed_at: string | null;
  /** OPEN_BIN 대상 칸 (그 외 null) */
  bin_id?: string | null;
  /** manual = 관리자, auto = AI 분류 자동 동작 */
  origin?: CommandOrigin;
  result_message: string | null;
  error_message: string | null;
}

export interface CommandRequest {
  command: CommandType;
  target?: string | null;
  /** OPEN_BIN 대상을 bin_id로 지정 (target과 함께 주면 일치해야 함) */
  bin_id?: string | null;
  command_id?: string;
}

export interface Dashboard {
  devices: Device[];
  bins: Bin[];
  recent_commands: Command[];
  /** 최근 AI 분류 기록 10건 (최신순) */
  recent_detections?: Detection[];
  server_time: string;
  hardware_mode?: HardwareMode;
  /** 카메라 노트북 상태 (EDGE_SERIAL) */
  edges?: EdgeStatus[];
  /** 가장 최근 만차 알림 (초음파 1개, trush.ino) */
  latest_full_alert?: Telemetry | null;
  /** HC-SR04 1개 최근 거리 이벤트 */
  latest_distance?: Telemetry | null;
}

export interface BinStatistics {
  bin_id: string;
  waste_type: WasteType;
  avg_fill_percent: number | null;
  max_fill_percent: number | null;
  sample_count: number;
  error_count: number;
}

export interface Statistics {
  period_hours: number;
  bins: BinStatistics[];
  command_counts: Record<string, number>;
}

export type HardwareMode = 'SIMULATOR' | 'ESP32_REAL' | 'EDGE_SERIAL';

export interface Health {
  status: string;
  database: boolean;
  /** 서버 ↔ MQTT 브로커 연결 */
  mqtt: boolean;
  hardware_mode?: HardwareMode;
  /** 백엔드 내장 가상 장치 실행 여부 */
  simulator_running?: boolean;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export type RealtimeEvent =
  | { type: 'connected'; data: { clients: number }; sent_at: string }
  | { type: 'bins.updated'; data: Bin[]; sent_at: string }
  | { type: 'device.status'; data: Device; sent_at: string }
  | { type: 'command.updated'; data: Command; sent_at: string }
  | { type: 'detection.updated'; data: Detection; sent_at: string }
  | { type: 'maintenance.created'; data: MaintenanceLog; sent_at: string }
  | { type: 'new_detection'; data: Detection; sent_at: string }
  | { type: 'edge.status'; data: EdgeStatus; sent_at: string }
  | { type: 'telemetry'; data: Telemetry; sent_at: string };

export const FINAL_COMMAND_STATUSES: CommandStatus[] = ['SUCCEEDED', 'FAILED', 'TIMEOUT'];

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface Measurement {
  id: number;
  device_id: string;
  bin_id: string;
  distance_cm: number | null;
  fill_percent: number | null;
  sensor_status: SensorStatus;
  source: DataSource;
  measured_at: string;
  received_at: string;
}

export interface TrendBucket {
  bucket_start: string;
  bin_id: string;
  avg_fill_percent: number | null;
  max_fill_percent: number | null;
  sample_count: number;
  error_count: number;
}

export interface Trend {
  period_hours: number;
  bucket_minutes: number;
  buckets: TrendBucket[];
}

export interface MeasurementQuery {
  device_id?: string;
  bin_id?: string;
  sensor_status?: SensorStatus;
  source?: DataSource;
  from?: string;
  to?: string;
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface CommandQuery {
  device_id?: string;
  status?: CommandStatus;
  command?: CommandType;
  /** OPEN_BIN 대상 칸으로 필터 */
  bin_id?: string;
  from?: string;
  to?: string;
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

/** AI 분류 처리 결과 */
export type DetectionOutcome =
  | 'SORTING' // 배출구 명령 전송, 장치 응답 대기
  | 'SORTED' // 장치 ACK 성공
  | 'SORT_FAILED' // ACK 실패/타임아웃
  | 'LOW_CONFIDENCE' // 신뢰도 임계값 미만 → 동작 안 함
  | 'UNRECOGNIZED' // 4개 분류 외
  | 'MANUAL_MODE' // 수동 모드 → 기록만
  | 'DEVICE_UNAVAILABLE' // 오프라인/동작 중/긴급정지
  | 'SORT_SENT' // EDGE: 시리얼 명령 전송 (장치 ACK 없음 → 동작 미확인)
  | 'NO_HARDWARE'; // EDGE: 하드웨어 비활성 → 기록만

export interface Detection {
  id: number;
  detection_id: string | null;
  device_id: string;
  bin_id: string | null;
  /** 모델이 낸 값 그대로 (4개 분류 외 값일 수 있음) */
  waste_type: string;
  /** 모델 출력 신뢰도 0~1 (가공하지 않음) */
  confidence: number;
  source: 'model' | 'simulator';
  model_name: string | null;
  image_reference: string | null;
  detected_at: string;
  received_at: string;
  outcome: DetectionOutcome | null;
  outcome_detail: string | null;
  command_id: string | null;
  /** 카메라 노트북 ID (CAMERA_001). EDGE_SERIAL 모드 */
  camera_id?: string | null;
  class_id?: number | null;
  bounding_box?: { x1: number; y1: number; x2: number; y2: number } | null;
  /** 카메라 노트북의 시리얼 전송 결과 */
  hardware_status?: HardwareStatus | null;
  /** 상대 경로 (/api/detections/{id}/image). API 기본 주소를 앞에 붙여 사용 */
  image_url?: string | null;
  captured_at?: string;
}

export type HardwareStatus =
  | 'pending'
  | 'command_sent'
  | 'serial_failed'
  | 'not_connected'
  | 'disabled'
  | 'skipped_busy'
  | 'completed'
  | 'ack_timeout'
  | 'rejected_busy'
  | 'aborted';

export interface EdgeStatus {
  device_id: string;
  camera_ok: boolean;
  camera_index: string | null;
  model_loaded: boolean;
  model_name: string | null;
  model_classes: Record<string, string> | null;
  fps: number | null;
  serial_enabled: boolean;
  serial_connected: boolean;
  serial_port: string | null;
  esp32_port: string | null;
  esp32_connected: boolean;
  /** uno_controller(ACK·거리) | legacy(trush.ino, 응답 없음) | unknown */
  uno_firmware?: string | null;
  servo_state?: string | null;
  sensor_status?: string | null;
  distance_cm?: number | null;
  fill_percent?: number | null;
  sorted_ok?: number;
  sorted_failed?: number;
  upload_queue: number;
  uploads_ok: number;
  uploads_failed: number;
  last_error: string | null;
  version: string | null;
  online: boolean;
  last_seen: string;
}

export interface Telemetry {
  id: number;
  device_id: string;
  kind: string;
  sensor_id: string | null;
  payload: Record<string, unknown> | null;
  raw: string | null;
  source: DataSource;
  measured_at: string;
  received_at: string;
}

export interface DetectionQuery {
  device_id?: string;
  waste_type?: string;
  outcome?: DetectionOutcome;
  source?: 'model' | 'simulator';
  from?: string;
  to?: string;
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface DetectionSummary {
  since: string;
  total: number;
  by_waste_type: Record<string, number>;
  by_outcome: Record<string, number>;
  avg_confidence: number | null;
}

export type MaintenanceKind = 'inspection' | 'sensor_test' | 'motor_test' | 'emptied' | 'repair';

export interface MaintenanceLog {
  id: number;
  device_id: string;
  bin_id: string | null;
  kind: MaintenanceKind;
  result: 'ok' | 'issue';
  note: string | null;
  related_command_id: string | null;
  created_by: string | null;
  created_at: string;
}

export interface MaintenanceCreate {
  device_id?: string;
  bin_id?: string | null;
  kind: MaintenanceKind;
  result: 'ok' | 'issue';
  note?: string | null;
  related_command_id?: string | null;
}
