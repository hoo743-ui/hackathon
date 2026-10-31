import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealtimeClient } from '@shared';
import type { RealtimeEvent, RealtimeState } from '@shared';
import { FakeSocket, makeBin } from './helpers';

describe('RealtimeClient.backoffDelay', () => {
  it('1s, 2s, 4s ... 로 증가하고 최대값에서 멈춘다', () => {
    expect(RealtimeClient.backoffDelay(0)).toBe(1000);
    expect(RealtimeClient.backoffDelay(1)).toBe(2000);
    expect(RealtimeClient.backoffDelay(2)).toBe(4000);
    expect(RealtimeClient.backoffDelay(3)).toBe(8000);
    expect(RealtimeClient.backoffDelay(4)).toBe(15000);
    expect(RealtimeClient.backoffDelay(50)).toBe(15000);
    expect(RealtimeClient.backoffDelay(5, 5000)).toBe(5000);
    expect(RealtimeClient.backoffDelay(-3)).toBe(1000);
  });
});

describe('RealtimeClient 재연결 + onResync', () => {
  let sockets: FakeSocket[];
  let states: RealtimeState[];
  let events: RealtimeEvent[];
  let onResync: ReturnType<typeof vi.fn>;
  let client: RealtimeClient;

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    states = [];
    events = [];
    onResync = vi.fn();
    client = new RealtimeClient({
      url: 'ws://test/ws/dashboard',
      onEvent: (e) => events.push(e),
      onStateChange: (s) => states.push(s),
      onResync,
      pingIntervalMs: 1000,
      socketFactory: (url) => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s as unknown as WebSocket;
      },
    });
  });

  afterEach(() => {
    client.stop();
    vi.useRealTimers();
  });

  it('연결될 때마다 onResync 를 호출하고, 끊기면 백오프 후 재연결한다', () => {
    client.start();
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe('ws://test/ws/dashboard');
    expect(states).toEqual(['connecting']);

    sockets[0].open();
    expect(states.at(-1)).toBe('open');
    expect(onResync).toHaveBeenCalledTimes(1);

    // 1차 끊김 → 1000ms 후 재연결
    sockets[0].drop();
    expect(states.at(-1)).toBe('closed');
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    expect(states.at(-1)).toBe('connecting');

    // 연결 실패가 이어지면 2000ms 로 증가
    sockets[1].drop();
    vi.advanceTimersByTime(1999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);

    // 재연결 성공 시 재동기화 + 시도 횟수 초기화
    sockets[2].open();
    expect(onResync).toHaveBeenCalledTimes(2);
    sockets[2].drop();
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(4);
  });

  it('ping 을 주기적으로 보내고 pong / 잘못된 메시지는 무시한다', () => {
    client.start();
    sockets[0].open();
    vi.advanceTimersByTime(1000);
    expect(sockets[0].sent).toEqual(['ping']);

    sockets[0].emit('pong');
    sockets[0].emit('{not json');
    const ev: RealtimeEvent = { type: 'bins.updated', data: [makeBin({ bin_id: 'BIN_001', waste_type: 'plastic' })], sent_at: 'x' };
    sockets[0].emit(ev);
    expect(events).toEqual([ev]);
  });

  it('stop() 이후에는 재연결하지 않는다', () => {
    client.start();
    sockets[0].open();
    client.stop();
    expect(states.at(-1)).toBe('closed');
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
  });
});
