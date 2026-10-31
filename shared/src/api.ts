import type {
  ApiErrorBody,
  Bin,
  BinHistory,
  Calibration,
  Command,
  CommandQuery,
  CommandRequest,
  Dashboard,
  Detection,
  DetectionQuery,
  DetectionSummary,
  Device,
  Health,
  MaintenanceCreate,
  MaintenanceLog,
  Measurement,
  MeasurementQuery,
  Page,
  Statistics,
  Trend,
} from './types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  /** 제어/보정 API에 필요한 Bearer 토큰 */
  controlToken?: string;
  timeoutMs?: number;
}

export function createApiClient({ baseUrl, controlToken, timeoutMs = 8000 }: ApiClientOptions) {
  const root = baseUrl.replace(/\/+$/, '');

  async function request<T>(path: string, init: RequestInit = {}, auth = false): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (init.body) headers['Content-Type'] = 'application/json';
    if (auth && controlToken) headers.Authorization = `Bearer ${controlToken}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${root}${path}`, { ...init, headers, signal: controller.signal });
      const text = await res.text();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        // 프록시 HTML 오류 페이지 등 비JSON 응답: 실제 HTTP 상태를 유지한다
        if (!res.ok) throw new ApiError(res.status, 'HTTP_ERROR', res.statusText || `HTTP ${res.status}`);
        throw new ApiError(res.status, 'INVALID_RESPONSE', 'Response was not valid JSON');
      }
      if (!res.ok) {
        const err = (body as ApiErrorBody | null)?.error;
        throw new ApiError(res.status, err?.code ?? 'HTTP_ERROR', err?.message ?? res.statusText);
      }
      return body as T;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(0, 'NETWORK_ERROR', e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(timer);
    }
  }

  const q = (params: object) => {
    const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '') as [string, string | number][];
    return entries.length ? `?${entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}` : '';
  };

  return {
    health: () => request<Health>('/health'),
    dashboard: () => request<Dashboard>('/api/dashboard'),
    statistics: (hours = 24) => request<Statistics>(`/api/statistics${q({ hours })}`),
    devices: () => request<Device[]>('/api/devices'),
    device: (id: string) => request<Device>(`/api/devices/${id}`),
    deviceStatus: (id: string) => request<Device>(`/api/devices/${id}/status`),
    bins: () => request<Bin[]>('/api/bins'),
    bin: (id: string) => request<Bin>(`/api/bins/${id}`),
    binHistory: (id: string, opts: { from?: string; to?: string; limit?: number } = {}) =>
      request<BinHistory>(`/api/bins/${id}/history${q(opts)}`),
    calibration: (id: string) => request<Calibration>(`/api/bins/${id}/calibration`),
    updateCalibration: (id: string, empty_distance_cm: number, full_distance_cm: number) =>
      request<Calibration>(
        `/api/bins/${id}/calibration`,
        { method: 'PUT', body: JSON.stringify({ empty_distance_cm, full_distance_cm }) },
        true,
      ),
    sendCommand: (deviceId: string, req: CommandRequest) =>
      request<Command>(`/api/devices/${deviceId}/commands`, { method: 'POST', body: JSON.stringify(req) }, true),
    /** 전체 측정 이력 (필터·페이지네이션) */
    measurements: (query: MeasurementQuery = {}) => request<Page<Measurement>>(`/api/measurements${q(query)}`),
    /** 전체 명령 이력 (필터·페이지네이션) */
    commands: (query: CommandQuery = {}) => request<Page<Command>>(`/api/commands${q(query)}`),
    /** bin별 시간 버킷 적재율 추이. 측정이 없는 구간은 버킷이 없다(0으로 채우지 않음). */
    trend: (hours = 24, bucketMinutes = 60) =>
      request<Trend>(`/api/statistics/trend${q({ hours, bucket_minutes: bucketMinutes })}`),
    /** AI 분류 기록 */
    detections: (query: DetectionQuery = {}) => request<Page<Detection>>(`/api/detections${q(query)}`),
    /** since(ISO) 이후 분류 집계 — 예: 오늘 0시 */
    detectionSummary: (since: string) => request<DetectionSummary>(`/api/detections/summary${q({ since })}`),
    /** 점검 기록 */
    maintenance: (query: { device_id?: string; kind?: string; limit?: number; offset?: number } = {}) =>
      request<Page<MaintenanceLog>>(`/api/maintenance${q(query)}`),
    createMaintenance: (body: MaintenanceCreate) =>
      request<MaintenanceLog>('/api/maintenance', { method: 'POST', body: JSON.stringify(body) }, true),
    command: (deviceId: string, commandId: string) =>
      request<Command>(`/api/devices/${deviceId}/commands/${commandId}`),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
