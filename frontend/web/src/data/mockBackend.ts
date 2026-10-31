import { ApiError, FINAL_COMMAND_STATUSES, WASTE_TYPES } from '@shared';
import type {
  ApiClient,
  Bin,
  BinStatistics,
  Calibration,
  Command,
  CommandRequest,
  Dashboard,
  Detection,
  DetectionOutcome,
  Device,
  MaintenanceLog,
  Measurement,
  Page,
  RealtimeEvent,
  SensorStatus,
  TrendBucket,
} from '@shared';

/**
 * 브라우저 안에서 동작하는 가짜 "백엔드".
 * - 응답 타입은 shared/types 와 동일하며, 모든 장치는 data_source='simulator' 로 표시된다.
 * - 적재율은 실제 서버와 마찬가지로 "서버 측(이 모의 백엔드)"에서 계산한다. UI 는 이 값을 그대로 표시만 한다.
 */

const DEVICE_ID = 'DEVICE_001';
const TICK_MS = 2000;
const HISTORY_MAX = 1000;

interface Cal {
  empty: number | null;
  full: number | null;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));

export class MockBackend {
  private device: Device;
  private bins: Bin[];
  private cal: Record<string, Cal> = {};
  private history: Record<string, Measurement[]> = {};
  private logSeq = 0;
  private commands: Command[] = [];
  private detections: Detection[] = [];
  private maintenanceLogs: MaintenanceLog[] = [];
  private detSeq = 0;
  private mntSeq = 0;
  private listeners = new Set<(ev: RealtimeEvent) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticks = 0;

  constructor(private readonly now: () => number = Date.now) {
    const iso = new Date(this.now()).toISOString();
    this.device = {
      device_id: DEVICE_ID,
      device_name: '모의 분리수거함 (Simulator)',
      connection_status: 'online',
      operating_mode: 'AUTO',
      estop_active: false,
      data_source: 'simulator',
      firmware_version: 'sim-0.1.0',
      last_seen: iso,
      busy: false,
    };
    const startDistances = [32, 18, 40, 25];
    this.bins = WASTE_TYPES.map((w, i) => {
      const bin_id = `BIN_00${i + 1}`;
      // BIN_004 는 일부러 미보정 상태로 둔다 (UI 의 "미보정" 표시 확인용)
      this.cal[bin_id] = i === 3 ? { empty: null, full: null } : { empty: 45, full: 5 };
      this.history[bin_id] = [];
      const d = startDistances[i];
      return {
        bin_id,
        device_id: DEVICE_ID,
        waste_type: w,
        current_distance_cm: d,
        current_fill_percent: this.fill(bin_id, d),
        sensor_status: 'normal' as SensorStatus,
        is_full: false,
        calibrated: i !== 3,
        last_valid_at: iso,
        updated_at: iso,
      };
    });
    // 과거 이력 시드: 지난 24시간은 15분 간격(비우고 다시 차는 톱니 패턴), 최근 2분은 2초 간격
    const base = this.now();
    this.bins.forEach((b, i) => {
      const end = b.current_distance_cm ?? 30;
      for (let k = 96; k > 0; k--) {
        const at = base - 120_000 - k * 15 * 60_000;
        // 수거 주기(약 8시간)마다 비워지는 톱니. bin 마다 위상을 다르게 한다
        const phase = ((96 - k + i * 9) % 32) / 32;
        // 일부 구간은 측정이 없도록 비워 둔다 (차트 끊김 확인용)
        if (i === 2 && k > 40 && k < 48) continue;
        const d = round1(44 - phase * 34);
        this.pushLog(b.bin_id, this.log(b.bin_id, d, k % 37 === i ? 'timeout' : 'normal', at));
      }
      let d = end + 6;
      for (let k = 60; k > 0; k--) {
        d = Math.max(4, d - 0.1);
        this.pushLog(b.bin_id, this.log(b.bin_id, round1(d), 'normal', base - k * TICK_MS));
      }
    });
    this.commands = [
      this.makeCommand({ command: 'GET_STATUS' }, 'SUCCEEDED', base - 90_000, '상태 보고 완료'),
      this.makeCommand({ command: 'OPEN_BIN', target: 'metal' }, 'TIMEOUT', base - 60_000, null, 'ACK_TIMEOUT'),
      this.makeCommand({ command: 'OPEN_BIN', target: 'plastic' }, 'SUCCEEDED', base - 30_000, '플라스틱 투입구 열림'),
    ];
    this.commands.sort((a, b) => b.requested_at.localeCompare(a.requested_at));
    // AI 분류 기록 시드: 지난 24시간, 모두 source='simulator' (실제 모델 결과 아님)
    const outcomes: DetectionOutcome[] = ['MANUAL_MODE', 'SORTED', 'SORTED', 'LOW_CONFIDENCE', 'SORTED', 'SORT_FAILED'];
    for (let k = 40; k > 0; k--) {
      const w = WASTE_TYPES[k % 4];
      const outcome = outcomes[k % outcomes.length];
      const conf = outcome === 'LOW_CONFIDENCE' ? 0.42 + (k % 7) / 100 : 0.7 + (k % 29) / 100;
      this.detections.push(this.makeDetection(w, round2(conf), outcome, base - k * 35 * 60_000));
    }
    this.detections.sort((a, b) => b.detected_at.localeCompare(a.detected_at));
    this.maintenanceLogs = [
      { id: ++this.mntSeq, device_id: DEVICE_ID, bin_id: null, kind: 'inspection', result: 'ok', note: '정기 점검 (모의)', related_command_id: null, created_by: 'mock', created_at: new Date(base - 3 * 3_600_000).toISOString() },
    ];
  }

  private makeDetection(w: string, confidence: number, outcome: DetectionOutcome, at: number, commandId: string | null = null): Detection {
    const iso = new Date(at).toISOString();
    const bin = this.bins.find((b) => b.waste_type === w);
    const detail: Partial<Record<DetectionOutcome, string>> = {
      SORTED: 'BIN_OPENED',
      SORT_FAILED: 'MOTION_TIMEOUT',
      DEVICE_UNAVAILABLE: 'DEVICE_OFFLINE',
    };
    return {
      id: ++this.detSeq,
      detection_id: null,
      device_id: DEVICE_ID,
      bin_id: bin?.bin_id ?? null,
      waste_type: w,
      confidence,
      source: 'simulator',
      model_name: 'mock-model',
      image_reference: null,
      detected_at: iso,
      received_at: iso,
      outcome,
      outcome_detail: detail[outcome] ?? null,
      command_id: commandId,
    };
  }

  /** 모의 AI 분류 1건 (자동 모드면 배출까지 모의) */
  private simulateDetection(): void {
    const w = WASTE_TYPES[Math.floor(Math.random() * 4)];
    const conf = round2(0.45 + Math.random() * 0.54);
    let outcome: DetectionOutcome = 'MANUAL_MODE';
    if (conf < 0.6) outcome = 'LOW_CONFIDENCE';
    else if (this.device.estop_active) outcome = 'DEVICE_UNAVAILABLE';
    else if (this.device.operating_mode === 'AUTO') outcome = 'SORTED';
    const det = this.makeDetection(w, conf, outcome, this.now());
    if (outcome === 'SORTED') {
      const cmd = this.makeCommand({ command: 'OPEN_BIN', target: w }, 'SUCCEEDED', this.now(), 'BIN_OPENED');
      cmd.origin = 'auto';
      det.command_id = cmd.command_id;
      this.commands.unshift(cmd);
      this.emit({ type: 'command.updated', data: cmd, sent_at: det.detected_at });
    }
    this.detections.unshift(det);
    this.emit({ type: 'detection.updated', data: det, sent_at: det.detected_at });
  }

  // ---------- 실시간 ----------
  subscribe(fn: (ev: RealtimeEvent) => void): () => void {
    this.listeners.add(fn);
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
    return () => {
      this.listeners.delete(fn);
      if (this.listeners.size === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  private emit(ev: RealtimeEvent): void {
    for (const l of this.listeners) l(clone(ev));
  }

  /** 한 주기 측정 시뮬레이션 (테스트에서도 직접 호출 가능) */
  tick(): void {
    this.ticks++;
    if (this.ticks % 10 === 0) this.simulateDetection();
    const iso = new Date(this.now()).toISOString();
    for (const b of this.bins) {
      let status: SensorStatus = 'normal';
      const r = Math.random();
      if (r < 0.04) status = 'timeout';
      else if (r < 0.06) status = 'out_of_range';

      if (status !== 'normal') {
        // 실제 서버 규칙: 오류 측정은 이력만 남기고 현재 적재율은 유지, sensor_status 만 갱신
        b.sensor_status = status;
        b.updated_at = iso;
        this.pushLog(b.bin_id, this.log(b.bin_id, null, status, this.now()));
        continue;
      }
      let d = (b.current_distance_cm ?? 40) - Math.random() * 0.9 + Math.random() * 0.3;
      if (d < 4) d = 42 + Math.random() * 3; // 비움
      d = round1(d);
      const fill = this.fill(b.bin_id, d);
      b.current_distance_cm = d;
      b.current_fill_percent = fill;
      b.sensor_status = 'normal';
      b.is_full = fill !== null && fill >= 95;
      b.last_valid_at = iso;
      b.updated_at = iso;
      this.pushLog(b.bin_id, this.log(b.bin_id, d, 'normal', this.now()));
    }
    this.device.last_seen = iso;
    this.emit({ type: 'bins.updated', data: this.bins, sent_at: iso });
    if (this.ticks % 5 === 0) this.emit({ type: 'device.status', data: this.device, sent_at: iso });
  }

  private log(binId: string, distance: number | null, status: SensorStatus, at: number): Measurement {
    const iso = new Date(at).toISOString();
    const ok = status === 'normal' && distance !== null;
    return {
      id: ++this.logSeq,
      device_id: DEVICE_ID,
      bin_id: binId,
      distance_cm: ok ? distance : null,
      fill_percent: ok ? this.fill(binId, distance) : null,
      sensor_status: status,
      source: 'simulator',
      measured_at: iso,
      received_at: iso,
    };
  }

  private pushLog(binId: string, log: Measurement): void {
    const h = this.history[binId];
    h.push(log);
    if (h.length > HISTORY_MAX) h.splice(0, h.length - HISTORY_MAX);
  }

  private fill(binId: string, distance: number): number | null {
    const c = this.cal[binId];
    if (!c || c.empty === null || c.full === null) return null;
    const p = ((c.empty - distance) / (c.empty - c.full)) * 100;
    return Math.round(Math.min(100, Math.max(0, p)) * 10) / 10;
  }

  private makeCommand(
    req: CommandRequest,
    status: Command['status'],
    at: number,
    result: string | null = null,
    error: string | null = null,
  ): Command {
    return {
      command_id: req.command_id ?? `mock-${at.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      device_id: DEVICE_ID,
      command: req.command,
      target: req.target ?? null,
      bin_id: req.command === 'OPEN_BIN' ? (req.bin_id ?? this.bins.find((b) => b.waste_type === req.target)?.bin_id ?? null) : null,
      origin: 'manual',
      status,
      requested_by: 'mock',
      requested_at: new Date(at).toISOString(),
      expires_at: new Date(at + 10_000).toISOString(),
      executed_at: FINAL_COMMAND_STATUSES.includes(status) ? new Date(at + 800).toISOString() : null,
      result_message: result,
      error_message: error,
    };
  }

  // ---------- REST ----------
  private findBin(id: string): Bin {
    const b = this.bins.find((x) => x.bin_id === id);
    if (!b) throw new ApiError(404, 'BIN_NOT_FOUND', `bin ${id} not found`);
    return b;
  }

  private dashboard(): Dashboard {
    return clone({
      devices: [this.device],
      bins: this.bins,
      recent_commands: this.commands.slice(0, 20),
      recent_detections: this.detections.slice(0, 20),
      hardware_mode: 'SIMULATOR' as const,
      server_time: new Date(this.now()).toISOString(),
    });
  }

  private requireToken(token?: string): void {
    if (!token) throw new ApiError(401, 'UNAUTHORIZED', 'control token required');
  }

  api(controlToken?: string): ApiClient {
    const run = async <T>(fn: () => T): Promise<T> => {
      await delay();
      return clone(fn());
    };
    const calibration = (id: string): Calibration => {
      const b = this.findBin(id);
      const c = this.cal[id];
      return { bin_id: b.bin_id, empty_distance_cm: c.empty, full_distance_cm: c.full, calibrated: b.calibrated };
    };
    return {
      health: () => run(() => ({ status: 'ok (mock)', database: true, mqtt: true, hardware_mode: 'SIMULATOR' as const, simulator_running: true })),
      dashboard: () => run(() => this.dashboard()),
      statistics: (hours = 24) =>
        run(() => ({
          period_hours: hours,
          bins: this.bins.map((b): BinStatistics => {
            const logs = this.history[b.bin_id];
            const fills = logs.map((l) => l.fill_percent).filter((v): v is number => v !== null);
            return {
              bin_id: b.bin_id,
              waste_type: b.waste_type,
              avg_fill_percent: fills.length ? Math.round((fills.reduce((a, v) => a + v, 0) / fills.length) * 10) / 10 : null,
              max_fill_percent: fills.length ? Math.max(...fills) : null,
              sample_count: logs.length,
              error_count: logs.filter((l) => l.sensor_status !== 'normal').length,
            };
          }),
          command_counts: this.commands.reduce<Record<string, number>>((acc, c) => {
            acc[c.status] = (acc[c.status] ?? 0) + 1;
            return acc;
          }, {}),
        })),
      devices: () => run(() => [this.device]),
      device: (id) =>
        run(() => {
          if (id !== DEVICE_ID) throw new ApiError(404, 'DEVICE_NOT_FOUND', `device ${id} not found`);
          return this.device;
        }),
      deviceStatus: (id) =>
        run(() => {
          if (id !== DEVICE_ID) throw new ApiError(404, 'DEVICE_NOT_FOUND', `device ${id} not found`);
          return this.device;
        }),
      bins: () => run(() => this.bins),
      bin: (id) => run(() => this.findBin(id)),
      binHistory: (id, opts = {}) =>
        run(() => {
          this.findBin(id);
          const items = [...this.history[id]]
            .reverse()
            .slice(0, opts.limit ?? 100)
            .map(({ distance_cm, fill_percent, sensor_status, source, measured_at }) => ({
              distance_cm,
              fill_percent,
              sensor_status,
              source,
              measured_at,
            }));
          return { bin_id: id, items };
        }),
      measurements: (query = {}) =>
        run(() => {
          let rows = Object.values(this.history).flat();
          if (query.device_id) rows = rows.filter((r) => r.device_id === query.device_id);
          if (query.bin_id) rows = rows.filter((r) => r.bin_id === query.bin_id);
          if (query.sensor_status) rows = rows.filter((r) => r.sensor_status === query.sensor_status);
          if (query.source) rows = rows.filter((r) => r.source === query.source);
          rows = inRange(rows, (r) => r.measured_at, query.from, query.to);
          return paginate(rows, (r) => r.measured_at, query);
        }),
      commands: (query = {}) =>
        run(() => {
          let rows = [...this.commands];
          if (query.device_id) rows = rows.filter((r) => r.device_id === query.device_id);
          if (query.status) rows = rows.filter((r) => r.status === query.status);
          if (query.command) rows = rows.filter((r) => r.command === query.command);
          if (query.bin_id) rows = rows.filter((r) => r.bin_id === query.bin_id);
          rows = inRange(rows, (r) => r.requested_at, query.from, query.to);
          return paginate(rows, (r) => r.requested_at, query);
        }),
      trend: (hours = 24, bucketMinutes = 60) =>
        run(() => {
          const step = bucketMinutes * 60_000;
          const since = this.now() - hours * 3_600_000;
          const origin = Date.UTC(2000, 0, 1);
          const acc = new Map<string, { bin: string; start: number; fills: number[]; n: number; err: number }>();
          for (const [binId, logs] of Object.entries(this.history)) {
            for (const l of logs) {
              const t = Date.parse(l.measured_at);
              if (t < since) continue;
              const start = origin + Math.floor((t - origin) / step) * step;
              const k = `${start}|${binId}`;
              const a = acc.get(k) ?? { bin: binId, start, fills: [], n: 0, err: 0 };
              a.n++;
              if (l.sensor_status !== 'normal') a.err++;
              if (l.fill_percent !== null) a.fills.push(l.fill_percent);
              acc.set(k, a);
            }
          }
          const buckets: TrendBucket[] = [...acc.values()]
            .sort((x, y) => x.start - y.start || x.bin.localeCompare(y.bin))
            .map((a) => ({
              bucket_start: new Date(a.start).toISOString(),
              bin_id: a.bin,
              avg_fill_percent: a.fills.length ? round1(a.fills.reduce((s, v) => s + v, 0) / a.fills.length) : null,
              max_fill_percent: a.fills.length ? Math.max(...a.fills) : null,
              sample_count: a.n,
              error_count: a.err,
            }));
          return { period_hours: hours, bucket_minutes: bucketMinutes, buckets };
        }),
      calibration: (id) => run(() => calibration(id)),
      updateCalibration: (id, empty, full) =>
        run(() => {
          this.requireToken(controlToken);
          const b = this.findBin(id);
          if (!(empty > full) || full <= 0) {
            throw new ApiError(422, 'INVALID_CALIBRATION', 'empty_distance_cm must be greater than full_distance_cm');
          }
          this.cal[id] = { empty, full };
          b.calibrated = true;
          if (b.current_distance_cm !== null) b.current_fill_percent = this.fill(id, b.current_distance_cm);
          b.updated_at = new Date(this.now()).toISOString();
          this.emit({ type: 'bins.updated', data: [b], sent_at: b.updated_at });
          return calibration(id);
        }),
      sendCommand: (deviceId, req) =>
        run(() => {
          this.requireToken(controlToken);
          if (deviceId !== DEVICE_ID) throw new ApiError(404, 'DEVICE_NOT_FOUND', `device ${deviceId} not found`);
          // 실제 서버(command_service.py)와 같은 거부 규칙
          if (req.command !== 'EMERGENCY_STOP') {
            if (this.device.estop_active && !['RESET_ESTOP', 'GET_STATUS'].includes(req.command)) {
              throw new ApiError(409, 'ESTOP_ACTIVE', 'emergency stop is active; send RESET_ESTOP first');
            }
            if (this.commands.some((c) => !FINAL_COMMAND_STATUSES.includes(c.status))) {
              throw new ApiError(409, 'DEVICE_BUSY', 'another command is in progress');
            }
            if (req.command === 'OPEN_BIN' && this.device.operating_mode === 'AUTO') {
              throw new ApiError(409, 'MODE_CONFLICT', 'manual OPEN_BIN is not allowed in AUTO mode');
            }
          }
          const cmd = this.makeCommand(req, 'SENT', this.now());
          this.commands.unshift(cmd);
          this.device.busy = true;
          this.emit({ type: 'command.updated', data: cmd, sent_at: cmd.requested_at });
          setTimeout(() => {
            cmd.status = 'SUCCEEDED';
            cmd.executed_at = new Date(this.now()).toISOString();
            cmd.result_message = '모의 장치 실행 완료';
            if (req.command === 'EMERGENCY_STOP') this.device.estop_active = true;
            if (req.command === 'RESET_ESTOP') this.device.estop_active = false;
            if (req.command === 'SET_MODE' && (req.target === 'AUTO' || req.target === 'MANUAL')) this.device.operating_mode = req.target;
            this.device.busy = false;
            this.emit({ type: 'command.updated', data: cmd, sent_at: cmd.executed_at });
            this.emit({ type: 'device.status', data: this.device, sent_at: cmd.executed_at });
          }, 800);
          return cmd;
        }),
      detections: (query = {}) =>
        run(() => {
          let rows = [...this.detections];
          if (query.device_id) rows = rows.filter((r) => r.device_id === query.device_id);
          if (query.waste_type) rows = rows.filter((r) => r.waste_type === query.waste_type);
          if (query.outcome) rows = rows.filter((r) => r.outcome === query.outcome);
          if (query.source) rows = rows.filter((r) => r.source === query.source);
          rows = inRange(rows, (r) => r.detected_at, query.from, query.to);
          return paginate(rows, (r) => r.detected_at, query);
        }),
      detectionSummary: (since) =>
        run(() => {
          const rows = inRange(this.detections, (r) => r.detected_at, since);
          const count = (key: (d: Detection) => string | null) =>
            rows.reduce<Record<string, number>>((acc, d) => {
              const k = key(d);
              if (k) acc[k] = (acc[k] ?? 0) + 1;
              return acc;
            }, {});
          return {
            since,
            total: rows.length,
            by_waste_type: count((d) => d.waste_type),
            by_outcome: count((d) => d.outcome),
            avg_confidence: rows.length ? round2(rows.reduce((a, d) => a + d.confidence, 0) / rows.length) : null,
          };
        }),
      maintenance: (query = {}) => run(() => paginate(this.maintenanceLogs, (r) => r.created_at, { ...query, order: 'desc' })),
      createMaintenance: (body) =>
        run(() => {
          this.requireToken(controlToken);
          const log: MaintenanceLog = {
            id: ++this.mntSeq,
            device_id: body.device_id ?? DEVICE_ID,
            bin_id: body.bin_id ?? null,
            kind: body.kind,
            result: body.result,
            note: body.note ?? null,
            related_command_id: body.related_command_id ?? null,
            created_by: 'mock',
            created_at: new Date(this.now()).toISOString(),
          };
          this.maintenanceLogs.unshift(log);
          this.emit({ type: 'maintenance.created', data: log, sent_at: log.created_at });
          return log;
        }),
      command: (deviceId, commandId) =>
        run(() => {
          const c = this.commands.find((x) => x.device_id === deviceId && x.command_id === commandId);
          if (!c) throw new ApiError(404, 'COMMAND_NOT_FOUND', `command ${commandId} not found`);
          return c;
        }),
    };
  }
}

function inRange<T>(rows: T[], at: (r: T) => string, from?: string, to?: string): T[] {
  const f = from ? Date.parse(from) : -Infinity;
  const t = to ? Date.parse(to) : Infinity;
  return rows.filter((r) => {
    const v = Date.parse(at(r));
    return v >= f && v <= t;
  });
}

function paginate<T>(rows: T[], at: (r: T) => string, q: { order?: 'asc' | 'desc'; limit?: number; offset?: number }): Page<T> {
  const sorted = [...rows].sort((a, b) => at(a).localeCompare(at(b)));
  if ((q.order ?? 'desc') === 'desc') sorted.reverse();
  const limit = q.limit ?? 50;
  const offset = q.offset ?? 0;
  return { items: sorted.slice(offset, offset + limit), total: sorted.length, limit, offset };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

type Handler<E> = ((ev: E) => void) | null;

/** RealtimeClient 가 실제 WebSocket 처럼 다룰 수 있는 최소 구현. 재연결/백오프는 shared RealtimeClient 가 담당. */
class MockSocket {
  readyState = 0;
  onopen: Handler<Event> = null;
  onmessage: Handler<MessageEvent> = null;
  onclose: Handler<CloseEvent> = null;
  onerror: Handler<Event> = null;
  private unsubscribe: (() => void) | null = null;
  private openTimer: ReturnType<typeof setTimeout>;

  constructor(private readonly backend: MockBackend) {
    this.openTimer = setTimeout(() => {
      this.readyState = 1;
      this.onopen?.(new Event('open'));
      this.deliver(JSON.stringify({ type: 'connected', data: { clients: 1 }, sent_at: new Date().toISOString() }));
      this.unsubscribe = this.backend.subscribe((ev) => this.deliver(JSON.stringify(ev)));
    }, 250);
  }

  private deliver(data: string): void {
    if (this.readyState !== 1) return;
    this.onmessage?.({ data } as MessageEvent);
  }

  send(data: string): void {
    if (data === 'ping') setTimeout(() => this.deliver('pong'), 10);
  }

  close(): void {
    if (this.readyState === 3) return;
    clearTimeout(this.openTimer);
    this.readyState = 3;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.onclose?.({ code: 1000 } as CloseEvent);
  }
}

export function createMockSocketFactory(backend: MockBackend): (url: string) => WebSocket {
  return () => new MockSocket(backend) as unknown as WebSocket;
}
