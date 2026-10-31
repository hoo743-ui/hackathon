import { useCallback, useEffect, useRef, useState } from 'react';
import { FINAL_COMMAND_STATUSES } from '@shared';
import type { Command, CommandRequest } from '@shared';
import { useDashboard } from '../data/DashboardContext';
import { useControlToken } from './controlToken';
import { describeError } from './format';

/** 명령 멱등성 키. crypto.randomUUID 는 보안 컨텍스트(https/localhost)에서만 있으므로 LAN http 용 대체 구현을 둔다. */
export function newCommandId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const isFinal = (c: Command | null | undefined) => !!c && FINAL_COMMAND_STATUSES.includes(c.status);
const POLL_MS = 2000;

export interface CommandTracker {
  /** 요청 키 (어느 버튼이 보냈는지) */
  key: string | null;
  /** 서버에 요청 중 (응답 전) */
  requesting: boolean;
  /** 서버가 받은 명령의 최신 상태 (WS 또는 폴링). 화면은 이 상태만 표시한다 */
  command: Command | null;
  /** 요청 자체가 거부된 경우 (HTTP 오류) */
  error: string | null;
  send: (key: string, req: Omit<CommandRequest, 'command_id'>) => Promise<void>;
  reset: () => void;
}

/**
 * 명령 전송 + 실제 상태 추적. 진행 표시는 서버가 알려준 상태(PENDING→SENT→SUCCEEDED/FAILED/TIMEOUT)만 따른다.
 * WS `command.updated` 가 기본 경로이고, WS 가 끊겨도 결과를 놓치지 않도록 최종 상태 전까지 GET 으로 보조 폴링한다.
 */
export function useCommand(deviceId: string | undefined): CommandTracker {
  const { source, dashboard } = useDashboard();
  const { token } = useControlToken();
  const [key, setKey] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [polled, setPolled] = useState<Command | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const fromWs = polled ? dashboard?.recent_commands.find((c) => c.command_id === polled.command_id) : undefined;
  // 최종 상태가 있으면 그것을, 아니면 더 최근 소식을 사용 (최종 상태를 되돌리지 않는다)
  const command = isFinal(fromWs) ? fromWs! : isFinal(polled) ? polled : (fromWs ?? polled);

  const send = useCallback(
    async (k: string, req: Omit<CommandRequest, 'command_id'>) => {
      if (!deviceId) return;
      setKey(k);
      setRequesting(true);
      setError(null);
      setPolled(null);
      try {
        const cmd = await source.api(token.trim()).sendCommand(deviceId, { ...req, command_id: newCommandId() });
        if (alive.current) setPolled(cmd);
      } catch (e) {
        if (alive.current) setError(describeError(e));
      } finally {
        if (alive.current) setRequesting(false);
      }
    },
    [deviceId, source, token],
  );

  const id = command?.command_id;
  const done = isFinal(command);
  useEffect(() => {
    if (!id || done || !deviceId) return;
    const api = source.api();
    const timer = setInterval(() => {
      api
        .command(deviceId, id)
        .then((c) => {
          if (alive.current) setPolled((prev) => (prev && prev.command_id === c.command_id && isFinal(prev) ? prev : c));
        })
        .catch(() => {
          // 폴링 실패는 무시 (WS 경로가 있음)
        });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [id, done, deviceId, source]);

  const reset = useCallback(() => {
    setKey(null);
    setPolled(null);
    setError(null);
  }, []);

  return { key, requesting, command, error, send, reset };
}
