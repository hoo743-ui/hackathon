import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from '@shared';

function res(status: number, body: unknown, statusText = '') {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

function mockFetch(impl: (...args: unknown[]) => unknown) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function catchErr(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    return e as ApiError;
  }
  throw new Error('expected rejection');
}

describe('createApiClient (shared/api)', () => {
  it('성공 응답의 JSON 을 반환하고 baseUrl 끝 슬래시를 정리한다', async () => {
    const fetch = mockFetch(async () => res(200, { devices: [], bins: [], recent_commands: [], server_time: 't' }));
    const api = createApiClient({ baseUrl: 'http://h:8000/' });
    const d = await api.dashboard();
    expect(d.server_time).toBe('t');
    expect(fetch.mock.calls[0][0]).toBe('http://h:8000/api/dashboard');
  });

  it('쿼리 파라미터를 만든다', async () => {
    const fetch = mockFetch(async () => res(200, { bin_id: 'BIN_001', items: [] }));
    await createApiClient({ baseUrl: 'http://h' }).binHistory('BIN_001', { limit: 200 });
    expect(fetch.mock.calls[0][0]).toBe('http://h/api/bins/BIN_001/history?limit=200');
  });

  it('서버 오류 본문의 code/message 를 ApiError 로 매핑한다', async () => {
    mockFetch(async () => res(409, { error: { code: 'DEVICE_OFFLINE', message: 'device is offline' } }, 'Conflict'));
    const e = await catchErr(createApiClient({ baseUrl: 'http://h' }).device('DEVICE_001'));
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(409);
    expect(e.code).toBe('DEVICE_OFFLINE');
    expect(e.message).toBe('device is offline');
  });

  it('본문이 없는 오류는 HTTP_ERROR + statusText', async () => {
    mockFetch(async () => res(500, undefined, 'Internal Server Error'));
    const e = await catchErr(createApiClient({ baseUrl: 'http://h' }).bins());
    expect(e.status).toBe(500);
    expect(e.code).toBe('HTTP_ERROR');
    expect(e.message).toBe('Internal Server Error');
  });

  it('네트워크 실패는 status 0 / NETWORK_ERROR', async () => {
    mockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    const e = await catchErr(createApiClient({ baseUrl: 'http://h' }).health());
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(0);
    expect(e.code).toBe('NETWORK_ERROR');
  });

  it('보정 PUT 에만 Bearer 토큰과 JSON 본문을 보낸다', async () => {
    const fetch = mockFetch(async () => res(200, { bin_id: 'BIN_001', empty_distance_cm: 45, full_distance_cm: 5, calibrated: true }));
    const api = createApiClient({ baseUrl: 'http://h', controlToken: 'secret' });
    await api.bin('BIN_001');
    await api.updateCalibration('BIN_001', 45, 5);
    const getInit = fetch.mock.calls[0][1] as RequestInit;
    const putInit = fetch.mock.calls[1][1] as RequestInit;
    expect((getInit.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(putInit.method).toBe('PUT');
    expect((putInit.headers as Record<string, string>).Authorization).toBe('Bearer secret');
    expect(JSON.parse(String(putInit.body))).toEqual({ empty_distance_cm: 45, full_distance_cm: 5 });
  });

  it('401 응답을 ApiError 로 전달한다', async () => {
    mockFetch(async () => res(401, { error: { code: 'UNAUTHORIZED', message: 'missing token' } }));
    const e = await catchErr(createApiClient({ baseUrl: 'http://h' }).updateCalibration('BIN_001', 45, 5));
    expect(e.status).toBe(401);
    expect(e.code).toBe('UNAUTHORIZED');
  });
});
