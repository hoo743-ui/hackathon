import { createApiClient } from '@shared';
import type { ApiClient } from '@shared';
import { config, type DataMode } from '../config';
import { MockBackend, createMockSocketFactory } from './mockBackend';

/**
 * 화면이 사용하는 데이터 소스. live/mock 이 동일한 인터페이스(shared ApiClient + RealtimeClient)를 쓰므로
 * 화면 코드는 모드를 몰라도 된다. 차이는 api 구현과 WebSocket 생성 방식뿐이다.
 */
export interface DataSource {
  mode: DataMode;
  wsUrl: string;
  /** controlToken 을 넣으면 제어/보정 API 에 Bearer 로 전송 */
  api: (controlToken?: string) => ApiClient;
  /** RealtimeClient 의 socketFactory 로 전달. undefined 면 실제 WebSocket */
  socketFactory?: (url: string) => WebSocket;
}

export function createLiveSource(baseUrl = config.apiBaseUrl, wsUrl = config.wsUrl): DataSource {
  return {
    mode: 'live',
    wsUrl,
    api: (controlToken) => createApiClient({ baseUrl, controlToken: controlToken || undefined }),
  };
}

export function createMockSource(backend = new MockBackend()): DataSource {
  return {
    mode: 'mock',
    wsUrl: 'mock://dashboard',
    api: (controlToken) => backend.api(controlToken),
    socketFactory: createMockSocketFactory(backend),
  };
}

export function createDataSource(mode: DataMode): DataSource {
  return mode === 'mock' ? createMockSource() : createLiveSource();
}
