import { ApiError } from './shared';

/** 서버 오류 코드 → 사용자용 한국어 메시지 (순수 함수). */
export const ERROR_MESSAGES: Record<string, string> = {
  DEVICE_OFFLINE: '장치가 오프라인입니다. 장치 전원과 Wi-Fi 연결을 확인하세요.',
  DEVICE_BUSY: '장치가 다른 명령을 처리 중입니다. 잠시 후 다시 시도하세요.',
  MODE_CONFLICT: 'AUTO 모드에서는 수동 배출을 할 수 없습니다. MANUAL 모드로 전환하세요.',
  ESTOP_ACTIVE: '긴급 정지 상태입니다. 긴급 정지 해제 후 다시 시도하세요.',
  INVALID_TARGET: '잘못된 대상입니다. (plastic, can, paper, general 또는 AUTO, MANUAL)',
  INVALID_COMMAND: '알 수 없는 명령입니다.',
  DEVICE_NOT_FOUND: '장치를 찾을 수 없습니다.',
  UNAUTHORIZED: '제어 토큰이 필요합니다. 홈 ⚙ 설정에서 토큰을 입력하세요.',
  FORBIDDEN: '제어 토큰이 올바르지 않습니다. 홈 ⚙ 설정에서 토큰을 확인하세요.',
  MQTT_UNAVAILABLE: '서버가 MQTT 브로커에 연결되어 있지 않아 명령을 전송할 수 없습니다.',
  NETWORK_ERROR: '서버에 연결할 수 없습니다. 서버 주소(LAN IP)와 네트워크를 확인하세요.',
};

const STATUS_FALLBACK: Record<number, string> = {
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'DEVICE_NOT_FOUND',
};

export function errorMessageForCode(code: string, status = 0, fallback?: string): string {
  if (ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  const byStatus = STATUS_FALLBACK[status];
  if (byStatus) return ERROR_MESSAGES[byStatus];
  return fallback ? `요청 실패 (${code}): ${fallback}` : `요청 실패 (${code})`;
}

export function describeError(e: unknown): string {
  if (e instanceof ApiError) return errorMessageForCode(e.code, e.status, e.message);
  if (e instanceof Error) return e.message;
  return String(e);
}
