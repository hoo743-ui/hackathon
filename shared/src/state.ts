import { FINAL_COMMAND_STATUSES } from './types';
import type { Bin, Command, Dashboard, Device, RealtimeEvent } from './types';

const isFinal = (c: Command) => FINAL_COMMAND_STATUSES.includes(c.status);

/** 이미 최종 상태(SUCCEEDED/FAILED/TIMEOUT)인 명령을 더 오래된 SENT/PENDING 으로 되돌리지 않는다. */
function newerCommand(current: Command | undefined, incoming: Command): Command {
  if (current && isFinal(current) && !isFinal(incoming)) return current;
  return incoming;
}

/** REST 스냅샷 + WebSocket 이벤트를 합치는 순수 리듀서. 웹/앱이 동일한 규칙으로 상태를 갱신한다. */
export function applyEvent(state: Dashboard, event: RealtimeEvent): Dashboard {
  switch (event.type) {
    case 'bins.updated':
      return { ...state, bins: mergeBy(state.bins, event.data, (b) => b.bin_id) };
    case 'device.status':
      return { ...state, devices: mergeBy(state.devices, [event.data], (d) => d.device_id) };
    case 'command.updated': {
      const current = state.recent_commands.find((c) => c.command_id === event.data.command_id);
      const next = newerCommand(current, event.data);
      if (next === current) return state;
      return { ...state, recent_commands: sortCommands(mergeBy(state.recent_commands, [next], (c) => c.command_id)) };
    }
    case 'detection.updated': {
      const merged = mergeBy(state.recent_detections ?? [], [event.data], (d) => String(d.id));
      merged.sort((a, b) => b.detected_at.localeCompare(a.detected_at));
      return { ...state, recent_detections: merged.slice(0, 20) };
    }
    case 'edge.status':
      return { ...state, edges: mergeBy(state.edges ?? [], [event.data], (e) => e.device_id) };
    case 'telemetry':
      if (event.data.kind !== 'bin_full_alert') return state;
      return { ...state, latest_full_alert: event.data };
    default:
      return state;
  }
}

/** 분류 이미지의 절대 URL. API 기본 주소(맥북 LAN IP)를 앞에 붙인다. */
export function detectionImageUrl(apiBaseUrl: string, d: { image_url?: string | null }): string | null {
  if (!d.image_url) return null;
  return `${apiBaseUrl.replace(/\/$/, '')}${d.image_url}`;
}

/** 재동기화 스냅샷 적용. 스냅샷 조회 이후 도착한 이벤트로 이미 최종 상태가 된 명령은 유지한다. */
export function mergeSnapshot(prev: Dashboard | null, snapshot: Dashboard): Dashboard {
  if (!prev) return snapshot;
  const known = new Map(prev.recent_commands.map((c) => [c.command_id, c]));
  return {
    ...snapshot,
    recent_commands: snapshot.recent_commands.map((c) => newerCommand(known.get(c.command_id), c)),
  };
}

function sortCommands(commands: Command[]): Command[] {
  return commands.sort((a, b) => b.requested_at.localeCompare(a.requested_at)).slice(0, 20);
}

function mergeBy<T>(current: T[], updates: T[], key: (item: T) => string): T[] {
  const map = new Map(current.map((item) => [key(item), item]));
  for (const u of updates) map.set(key(u), u);
  return [...map.values()].sort((a, b) => key(a).localeCompare(key(b)));
}

export type { Bin, Command, Device };
