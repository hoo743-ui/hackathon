import { vi } from 'vitest';
import type {
  ApiClient,
  Bin,
  Command,
  CommandQuery,
  CommandRequest,
  Dashboard,
  Detection,
  DetectionQuery,
  DetectionSummary,
  Device,
  MaintenanceCreate,
  MaintenanceLog,
  Measurement,
  MeasurementQuery,
  Page,
  RealtimeEvent,
  Statistics,
  Trend,
} from '@shared';
import type { DataSource } from '../data/source';

/** RealtimeClient.socketFactory 에 주입하는 가짜 WebSocket */
export class FakeSocket {
  readyState = 0;
  sent: string[] = [];
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(public readonly url: string) {}
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({});
  }
  // --- 테스트 조작용 ---
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  emit(ev: RealtimeEvent | string) {
    this.onmessage?.({ data: typeof ev === 'string' ? ev : JSON.stringify(ev) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.({});
  }
}

const T = '2026-10-31T10:00:00.000Z';

export function makeBin(over: Partial<Bin> & Pick<Bin, 'bin_id' | 'waste_type'>): Bin {
  return {
    device_id: 'DEVICE_001',
    current_distance_cm: 20,
    current_fill_percent: 42,
    sensor_status: 'normal',
    is_full: false,
    calibrated: true,
    last_valid_at: T,
    updated_at: T,
    ...over,
  };
}

export function makeDevice(over: Partial<Device> = {}): Device {
  return {
    device_id: 'DEVICE_001',
    device_name: '1번 분리수거함',
    connection_status: 'online',
    operating_mode: 'AUTO',
    estop_active: false,
    data_source: 'hardware',
    firmware_version: '0.1.0',
    last_seen: T,
    busy: false,
    ...over,
  };
}

export function makeCommand(over: Partial<Command> = {}): Command {
  return {
    command_id: 'cmd-1',
    device_id: 'DEVICE_001',
    command: 'OPEN_BIN',
    target: 'plastic',
    status: 'SENT',
    requested_by: 'app',
    requested_at: T,
    expires_at: '2026-10-31T10:00:10.000Z',
    executed_at: null,
    result_message: null,
    error_message: null,
    ...over,
  };
}

export function makeDashboard(over: Partial<Dashboard> = {}): Dashboard {
  return {
    devices: [makeDevice()],
    bins: [
      makeBin({ bin_id: 'BIN_001', waste_type: 'plastic', current_fill_percent: 42 }),
      makeBin({ bin_id: 'BIN_002', waste_type: 'metal', current_fill_percent: 10 }),
      makeBin({ bin_id: 'BIN_003', waste_type: 'paper', current_fill_percent: 85 }),
      makeBin({
        bin_id: 'BIN_004',
        waste_type: 'glass',
        current_fill_percent: null,
        current_distance_cm: null,
        calibrated: false,
        last_valid_at: null,
      }),
    ],
    recent_commands: [makeCommand()],
    recent_detections: [],
    server_time: T,
    ...over,
  };
}

export function makeDetection(over: Partial<Detection> = {}): Detection {
  return {
    id: 1,
    detection_id: null,
    device_id: 'DEVICE_001',
    bin_id: 'BIN_002',
    waste_type: 'metal',
    confidence: 0.912,
    source: 'simulator',
    model_name: 'qa',
    image_reference: null,
    detected_at: T,
    received_at: T,
    outcome: 'SORTED',
    outcome_detail: 'BIN_OPENED',
    command_id: null,
    ...over,
  };
}

const emptyPage = { items: [], total: 0, limit: 50, offset: 0 };

/** 테스트용 데이터 소스: 가짜 API + 가짜 소켓. api(token) 호출 시 받은 토큰은 tokens 에 기록된다. */
export function makeTestSource(dashboard: Dashboard = makeDashboard()) {
  const sockets: FakeSocket[] = [];
  const tokens: (string | undefined)[] = [];
  const api = {
    dashboard: vi.fn(async () => structuredClone(dashboard)),
    health: vi.fn(async () => ({ status: 'ok', database: true, mqtt: true })),
    statistics: vi.fn(async (hours = 24) => ({ period_hours: hours, bins: [], command_counts: {} }) as Statistics),
    trend: vi.fn(async (hours = 24, bucket = 60) => ({ period_hours: hours, bucket_minutes: bucket, buckets: [] }) as Trend),
    binHistory: vi.fn(async (id: string) => ({ bin_id: id, items: [] })),
    calibration: vi.fn(async (id: string) => ({ bin_id: id, empty_distance_cm: 45, full_distance_cm: 5, calibrated: true })),
    updateCalibration: vi.fn(async (id: string, e: number, f: number) => ({ bin_id: id, empty_distance_cm: e, full_distance_cm: f, calibrated: true })),
    measurements: vi.fn(async (_q?: MeasurementQuery): Promise<Page<Measurement>> => ({ ...emptyPage })),
    commands: vi.fn(async (_q?: CommandQuery): Promise<Page<Command>> => ({ ...emptyPage })),
    sendCommand: vi.fn(async (deviceId: string, req: CommandRequest) =>
      makeCommand({ command_id: req.command_id ?? 'cmd-new', device_id: deviceId, command: req.command, target: req.target ?? null, status: 'SENT' }),
    ),
    command: vi.fn(async (_d: string, id: string) => makeCommand({ command_id: id, status: 'SENT' })),
    detections: vi.fn(async (_q?: DetectionQuery): Promise<Page<Detection>> => ({ ...emptyPage })),
    detectionSummary: vi.fn(async (since: string): Promise<DetectionSummary> => ({ since, total: 0, by_waste_type: {}, by_outcome: {}, avg_confidence: null })),
    maintenance: vi.fn(async (): Promise<Page<MaintenanceLog>> => ({ ...emptyPage })),
    createMaintenance: vi.fn(
      async (b: MaintenanceCreate): Promise<MaintenanceLog> => ({
        id: 7,
        device_id: b.device_id ?? 'DEVICE_001',
        bin_id: b.bin_id ?? null,
        kind: b.kind,
        result: b.result,
        note: b.note ?? null,
        related_command_id: b.related_command_id ?? null,
        created_by: 'test',
        created_at: T,
      }),
    ),
  };
  const source: DataSource = {
    mode: 'live',
    wsUrl: 'ws://test/ws/dashboard',
    api: (token?: string) => {
      tokens.push(token);
      return api as unknown as ApiClient;
    },
    socketFactory: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s as unknown as WebSocket;
    },
  };
  return { source, api, sockets, tokens, latest: () => sockets[sockets.length - 1] };
}
