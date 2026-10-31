import type { RealtimeEvent } from './types';

export type RealtimeState = 'connecting' | 'open' | 'closed';

export interface RealtimeOptions {
  url: string;
  onEvent: (event: RealtimeEvent) => void;
  onStateChange?: (state: RealtimeState) => void;
  /** (재)연결 직후 호출. 끊긴 동안 놓친 이벤트를 REST 스냅샷으로 보정한다. */
  onResync?: () => void;
  maxDelayMs?: number;
  pingIntervalMs?: number;
  /** 테스트 주입용 */
  socketFactory?: (url: string) => WebSocket;
}

/** 지수 백오프 재연결 WebSocket 클라이언트 (브라우저/React Native 공용). */
export class RealtimeClient {
  private ws: WebSocket | null = null;
  private attempts = 0;
  private stopped = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly opts: RealtimeOptions) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.ws?.close();
    this.ws = null;
    this.opts.onStateChange?.('closed');
  }

  /** 다음 재연결까지 대기 시간 (ms). 1s, 2s, 4s ... 최대 maxDelayMs */
  static backoffDelay(attempt: number, maxDelayMs = 15000): number {
    return Math.min(maxDelayMs, 1000 * 2 ** Math.max(0, attempt));
  }

  private connect(): void {
    this.opts.onStateChange?.('connecting');
    const ws = this.opts.socketFactory ? this.opts.socketFactory(this.opts.url) : new WebSocket(this.opts.url);
    this.ws = ws;

    ws.onopen = () => {
      this.attempts = 0;
      this.opts.onStateChange?.('open');
      this.opts.onResync?.();
      this.pingTimer = setInterval(() => {
        if (ws.readyState === 1) ws.send('ping');
      }, this.opts.pingIntervalMs ?? 20000);
    };
    ws.onmessage = (msg) => {
      if (msg.data === 'pong') return;
      try {
        this.opts.onEvent(JSON.parse(String(msg.data)) as RealtimeEvent);
      } catch {
        // 잘못된 메시지는 무시
      }
    };
    ws.onclose = () => {
      this.clearTimers();
      if (this.stopped) return;
      this.opts.onStateChange?.('closed');
      const delay = RealtimeClient.backoffDelay(this.attempts++, this.opts.maxDelayMs);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => ws.close();
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.reconnectTimer = null;
    this.pingTimer = null;
  }
}
