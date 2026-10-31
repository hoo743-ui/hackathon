import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import type { ReactNode } from 'react';
import { RealtimeClient, applyEvent, mergeSnapshot } from '@shared';
import type { ApiClient, Bin, Dashboard, RealtimeEvent, RealtimeState } from '@shared';
import { describeError } from '../lib/format';
import type { DataSource } from './source';

/** 세션 동안 누적되는 적재율 시계열 한 점. 값은 서버가 준 current_fill_percent 그대로 (null 은 차트에서 끊김) */
export type SeriesPoint = { t: number } & Record<string, number | null>;

const SERIES_MAX = 300;

interface State {
  dashboard: Dashboard | null;
  series: SeriesPoint[];
  error: string | null;
  ws: RealtimeState;
  lastUpdateAt: number | null;
  /** maintenance.created 수신 횟수 — 점검 기록 목록 재조회 트리거 (점검 기록은 스냅샷에 없음) */
  maintenanceSeq: number;
}

type Action =
  | { type: 'snapshot'; dashboard: Dashboard; at: number }
  | { type: 'event'; event: RealtimeEvent; at: number }
  | { type: 'error'; message: string }
  | { type: 'ws'; state: RealtimeState };

function point(bins: Bin[], t: number): SeriesPoint {
  const p = { t } as SeriesPoint;
  for (const b of bins) p[b.bin_id] = b.current_fill_percent;
  return p;
}

function appendPoint(series: SeriesPoint[], p: SeriesPoint): SeriesPoint[] {
  const next = series.length && series[series.length - 1].t >= p.t ? series.slice(0, -1) : series.slice();
  next.push(p);
  return next.length > SERIES_MAX ? next.slice(next.length - SERIES_MAX) : next;
}

function eventTime(ev: RealtimeEvent, fallback: number): number {
  const t = Date.parse(ev.sent_at);
  return Number.isNaN(t) ? fallback : t;
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'snapshot': {
      const t = Date.parse(action.dashboard.server_time);
      return {
        ...state,
        dashboard: mergeSnapshot(state.dashboard, action.dashboard),
        error: null,
        lastUpdateAt: action.at,
        series: appendPoint(state.series, point(action.dashboard.bins, Number.isNaN(t) ? action.at : t)),
      };
    }
    case 'event': {
      if (action.event.type === 'maintenance.created') return { ...state, maintenanceSeq: state.maintenanceSeq + 1 };
      if (!state.dashboard) return state; // 스냅샷 이전 이벤트는 재동기화 스냅샷이 포함하므로 무시
      const dashboard = applyEvent(state.dashboard, action.event);
      if (dashboard === state.dashboard) return state;
      return {
        ...state,
        dashboard,
        lastUpdateAt: action.at,
        series:
          action.event.type === 'bins.updated'
            ? appendPoint(state.series, point(dashboard.bins, eventTime(action.event, action.at)))
            : state.series,
      };
    }
    case 'error':
      return { ...state, error: action.message };
    case 'ws':
      return { ...state, ws: action.state };
  }
}

export interface DashboardContextValue extends State {
  source: DataSource;
  /** 조회용 클라이언트 (토큰 없음) */
  api: ApiClient;
  /** GET /api/dashboard 재조회 */
  resync: () => Promise<void>;
  /** mock 모드 · SIMULATOR 하드웨어 모드 · simulator 장치 중 하나라도 해당하면 true */
  simulated: boolean;
}

const Ctx = createContext<DashboardContextValue | null>(null);

export function DashboardProvider({ source, children }: { source: DataSource; children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    dashboard: null,
    series: [],
    error: null,
    ws: 'connecting',
    lastUpdateAt: null,
    maintenanceSeq: 0,
  });
  const api = useMemo(() => source.api(), [source]);
  const seq = useRef(0);
  const alive = useRef(true);

  const resync = useCallback(async () => {
    const my = ++seq.current;
    try {
      const d = await api.dashboard();
      // 늦게 도착한 이전 요청 응답이 최신 스냅샷을 덮어쓰지 않도록
      if (alive.current && my === seq.current) dispatch({ type: 'snapshot', dashboard: d, at: Date.now() });
    } catch (e) {
      if (alive.current && my === seq.current) dispatch({ type: 'error', message: describeError(e) });
    }
  }, [api]);

  useEffect(() => {
    alive.current = true;
    // WS 가 열리지 않아도 화면이 채워지도록 최초 1회 REST 조회
    void resync();
    const client = new RealtimeClient({
      url: source.wsUrl,
      socketFactory: source.socketFactory,
      onEvent: (event) => alive.current && dispatch({ type: 'event', event, at: Date.now() }),
      onStateChange: (s) => alive.current && dispatch({ type: 'ws', state: s }),
      // (재)연결될 때마다 끊긴 동안 놓친 이벤트를 스냅샷으로 보정
      onResync: () => void resync(),
    });
    client.start();
    return () => {
      alive.current = false;
      client.stop();
    };
  }, [source, resync]);

  // mock 모드, 서버가 SIMULATOR 하드웨어 모드, 또는 장치가 simulator 출처를 보고하면 시뮬레이션 데이터로 표시
  const simulated =
    source.mode === 'mock' ||
    state.dashboard?.hardware_mode === 'SIMULATOR' ||
    (state.dashboard?.devices.some((d) => d.data_source === 'simulator') ?? false);

  const value = useMemo<DashboardContextValue>(
    () => ({ ...state, source, api, resync, simulated }),
    [state, source, api, resync, simulated],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDashboard(): DashboardContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDashboard must be used inside <DashboardProvider>');
  return v;
}
