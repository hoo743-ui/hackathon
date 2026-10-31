import { describeError, errorMessageForCode } from '../errors';

import { ApiError } from '../shared';

describe('errorMessageForCode', () => {
  it.each(['DEVICE_OFFLINE', 'DEVICE_BUSY', 'MODE_CONFLICT', 'ESTOP_ACTIVE', 'INVALID_TARGET', 'UNAUTHORIZED', 'FORBIDDEN', 'MQTT_UNAVAILABLE'])(
    '%s 를 한국어로 매핑',
    (code) => {
      const msg = errorMessageForCode(code);
      expect(msg).not.toContain(code);
      expect(msg).toMatch(/[가-힣]/);
    },
  );
  it('코드가 일반적이면 HTTP 상태로 대체', () => {
    expect(errorMessageForCode('HTTP_ERROR', 401)).toBe(errorMessageForCode('UNAUTHORIZED'));
    expect(errorMessageForCode('HTTP_ERROR', 403)).toBe(errorMessageForCode('FORBIDDEN'));
  });
  it('알 수 없는 코드는 코드를 노출', () => {
    expect(errorMessageForCode('WHATEVER', 500, 'boom')).toContain('WHATEVER');
  });
  it('ApiError 를 해석', () => {
    expect(describeError(new ApiError(409, 'ESTOP_ACTIVE', 'x'))).toBe(errorMessageForCode('ESTOP_ACTIVE'));
  });
});


describe('describeError', () => {
  it('네트워크 오류는 LAN 안내', () => {
    expect(describeError(new ApiError(0, 'NETWORK_ERROR', 'Failed to fetch'))).toMatch(/LAN IP/);
  });
  it('일반 Error 는 메시지 그대로', () => expect(describeError(new Error('x'))).toBe('x'));
});
