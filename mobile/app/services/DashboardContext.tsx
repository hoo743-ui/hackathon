import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { API_BASE_URL, WS_URL } from './config';
import { newCommandId } from './commandId';
import { describeError } from './errors';
import {
  ApiError,
  applyEvent,
  createApiClient,
  FINAL_COMMAND_STATUSES,
  mergeSnapshot,
  RealtimeClient,
  type ApiClient,
  type Command,
  type CommandRequest,
  type Dashboard,
  type RealtimeEvent,
  type RealtimeState,
} from './shared';
import { loadControlToken, saveControlToken } from './tokenStore';

interface DashboardContextValue {
  dashboard: Dashboard | null;
  wsState: RealtimeState;
  loading: boolean;
  /** 마지막 스냅샷 오류 (한국어) */
  error: string | null;
  lastRefreshAt: Date | null;
  lastEventAt: Date | null;
  api: ApiClient;
  controlToken: string | null;
  setControlToken: (token: string | null) => Promise<void>;
  refresh: () => Promise<void>;
  /** 명령 전송. 서버가 반환한 Command(보통 SENT)를 상태에 반영하고, 최종 상태까지 폴링으로 보조 추적한다. */
  sendCommand: (deviceId: string, req: Omit<CommandRequest, 'command_id'>) => Promise<Command>;
}

const Ctx = createContext<DashboardContextValue | null>(null);

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_MS = 30000;

/**
 * docs/API_SPECIFICATION.md 의 예시는 command.updated 에 부분 객체({command_id,status})만 담을 수 있다.
 * 공용 applyEvent 는 전체 Command 를 가정하므로, 부분 데이터면 기존 항목과 합쳐서 넘긴다.
 */
function normalizeEvent(state: Dashboard, event: RealtimeEvent): RealtimeEvent {
  if (event.type !== 'command.updated' || event.data.requested_at) return event;
  const prev = state.recent_commands.find((c) => c.command_id === event.data.command_id);
  if (!prev) return { type: 'connected', data: { clients: 0 }, sent_at: event.sent_at }; // 알 수 없는 부분 데이터 → 무시
  return { ...event, data: { ...prev, ...event.data } };
}

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [wsState, setWsState] = useState<RealtimeState>('closed');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<Date | null>(null);
  const [lastEventAt, setLastEventAt] = useState<Date | null>(null);
  const [controlToken, setTokenState] = useState<string | null>(null);

  const api = useMemo(
    () => createApiClient({ baseUrl: API_BASE_URL, controlToken: controlToken ?? undefined }),
    [controlToken],
  );
  const apiRef = useRef(api);
  apiRef.current = api;

  useEffect(() => {
    loadControlToken().then(setTokenState);
  }, []);

  const setControlToken = useCallback(async (token: string | null) => {
    const v = token?.trim() || null;
    await saveControlToken(v);
    setTokenState(v);
  }, []);

  const dispatch = useCallback((event: RealtimeEvent) => {
    setDashboard((s) => (s ? applyEvent(s, normalizeEvent(s, event)) : s));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const snap = await apiRef.current.dashboard();
      setDashboard((prev) => mergeSnapshot(prev, snap));
      setLastRefreshAt(new Date());
      setError(null);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // 실시간 연결: 공용 RealtimeClient(백오프 재연결) + 재연결 시 REST 재동기화.
  useEffect(() => {
    const client = new RealtimeClient({
      url: WS_URL,
      onStateChange: setWsState,
      onResync: () => void refresh(),
      onEvent: (event) => {
        setLastEventAt(new Date());
        dispatch(event);
      },
    });
    client.start();
    void refresh();
    // 백그라운드에서는 소켓을 닫고, 복귀 시 재연결(→ onResync 로 스냅샷 재조회)
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') client.start();
      else if (st === 'background') client.stop();
    });
    return () => {
      sub.remove();
      client.stop();
    };
  }, [dispatch, refresh]);

  const pollTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = pollTimers.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  const trackCommand = useCallback(
    (cmd: Command) => {
      const started = Date.now();
      const tick = async () => {
        try {
          const latest = await apiRef.current.command(cmd.device_id, cmd.command_id);
          dispatch({ type: 'command.updated', data: latest, sent_at: new Date().toISOString() });
          if (FINAL_COMMAND_STATUSES.includes(latest.status)) return;
        } catch {
          // 네트워크 오류는 다음 폴링/WS 이벤트로 보정
        }
        if (Date.now() - started < POLL_MAX_MS) schedule();
      };
      const schedule = () => {
        const t = setTimeout(() => {
          pollTimers.current.delete(t);
          void tick();
        }, POLL_INTERVAL_MS);
        pollTimers.current.add(t);
      };
      schedule();
    },
    [dispatch],
  );

  const sendCommand = useCallback(
    async (deviceId: string, req: Omit<CommandRequest, 'command_id'>) => {
      const command_id = newCommandId();
      const body: CommandRequest = { ...req, command_id };
      let cmd: Command;
      try {
        cmd = await apiRef.current.sendCommand(deviceId, body);
      } catch (e) {
        // 응답 유실(네트워크) 시 같은 command_id 로 1회 재시도 → 서버/장치가 중복을 걸러낸다.
        if (e instanceof ApiError && e.code === 'NETWORK_ERROR') {
          cmd = await apiRef.current.sendCommand(deviceId, body);
        } else {
          throw e;
        }
      }
      dispatch({ type: 'command.updated', data: cmd, sent_at: new Date().toISOString() });
      if (!FINAL_COMMAND_STATUSES.includes(cmd.status)) trackCommand(cmd);
      return cmd;
    },
    [dispatch, trackCommand],
  );

  const value = useMemo<DashboardContextValue>(
    () => ({
      dashboard,
      wsState,
      loading,
      error,
      lastRefreshAt,
      lastEventAt,
      api,
      controlToken,
      setControlToken,
      refresh,
      sendCommand,
    }),
    [dashboard, wsState, loading, error, lastRefreshAt, lastEventAt, api, controlToken, setControlToken, refresh, sendCommand],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDashboard(): DashboardContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDashboard must be used inside DashboardProvider');
  return v;
}
