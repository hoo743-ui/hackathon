import { ApiError } from '@shared';

// 명령 라벨은 웹/앱 공용(shared)에서 가져온다
export { COMMAND_TYPE_LABELS } from '@shared';

/** 서버가 준 적재율을 표시용 문자열로. null(미보정/유효 측정 없음)은 절대 0%로 표시하지 않는다. */
export function formatFill(percent: number | null | undefined): string {
  // 소수 1자리: 반올림으로 임계값을 넘어 보이는 모순(94.6 → "95%"인데 단계는 경고)을 막는다
  return percent === null || percent === undefined ? '--' : `${percent.toFixed(1)}%`;
}

/** 판독값용 숫자만 (단위 분리 표기). null → "--" */
export function fillNumber(percent: number | null | undefined, digits = 1): string {
  return percent === null || percent === undefined ? '--' : percent.toFixed(digits);
}

export function formatDistance(cm: number | null | undefined): string {
  return cm === null || cm === undefined ? '--' : `${cm.toFixed(1)} cm`;
}

const timeFmt = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const hmFmt = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
const mdFmt = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('ko-KR', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});
const fullFmt = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 오늘이면 시:분:초, 아니면 월/일 시:분:초 */
export function formatTime(iso: string | null | undefined): string {
  const d = parse(iso);
  if (!d) return '--';
  return d.toDateString() === new Date().toDateString() ? timeFmt.format(d) : dateTimeFmt.format(d);
}

/** 월/일 시:분:초 (이력 표) */
export function formatStamp(iso: string | null | undefined): string {
  const d = parse(iso);
  return d ? dateTimeFmt.format(d) : '--';
}

/** 항상 날짜를 포함 (표·툴팁 title 용) */
export function formatDateTime(iso: string | null | undefined): string {
  const d = parse(iso);
  return d ? fullFmt.format(d) : '--';
}

export function formatClock(ms: number): string {
  return timeFmt.format(new Date(ms));
}

/** 차트 축 시각. 하루 이상 범위면 날짜를 함께 표시 */
export function formatAxisTime(ms: number, spanHours: number): string {
  const d = new Date(ms);
  if (spanHours > 24) return `${mdFmt.format(d)} ${hmFmt.format(d)}`;
  return hmFmt.format(d);
}

export function formatTooltipTime(ms: number): string {
  return dateTimeFmt.format(new Date(ms));
}

export function formatRelative(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return '기록 없음';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '--';
  const sec = Math.max(0, Math.round((nowMs - t) / 1000));
  if (sec < 5) return '방금 전';
  if (sec < 60) return `${sec}초 전`;
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`;
  return `${Math.floor(sec / 86400)}일 전`;
}

export function formatCount(n: number): string {
  return n.toLocaleString('ko-KR');
}

/** 서버 오류 코드 → 사용자용 한국어 메시지 (모바일 errors.ts 와 같은 문구) */
const ERROR_MESSAGES: Record<string, string> = {
  DEVICE_OFFLINE: '장치가 오프라인입니다. 장치 전원과 Wi-Fi 연결을 확인하세요.',
  DEVICE_BUSY: '장치가 다른 명령을 처리 중입니다. 잠시 후 다시 시도하세요.',
  MODE_CONFLICT: '자동 모드에서는 수동 배출을 할 수 없습니다. 수동 모드로 전환하세요.',
  ESTOP_ACTIVE: '긴급 정지 상태입니다. 긴급 정지 해제 후 다시 시도하세요.',
  INVALID_TARGET: '잘못된 대상입니다.',
  INVALID_CALIBRATION: '보정값이 올바르지 않습니다. 빈 통 거리는 가득 찬 거리보다 커야 합니다.',
  DEVICE_NOT_FOUND: '장치를 찾을 수 없습니다.',
  BIN_NOT_FOUND: '수거함을 찾을 수 없습니다.',
  UNAUTHORIZED: '제어 토큰이 필요합니다. 설정에서 토큰을 입력하세요.',
  FORBIDDEN: '제어 토큰이 올바르지 않습니다. 설정에서 토큰을 확인하세요.',
  MQTT_UNAVAILABLE: '서버가 MQTT 브로커에 연결되어 있지 않아 명령을 전송할 수 없습니다.',
  TOO_MANY_BUCKETS: '요청한 기간에 비해 구간이 너무 많습니다.',
};

export function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    if (ERROR_MESSAGES[e.code]) return ERROR_MESSAGES[e.code];
    switch (e.status) {
      case 0:
        return `서버에 연결할 수 없습니다. (${e.message})`;
      case 401:
        return ERROR_MESSAGES.UNAUTHORIZED;
      case 403:
        return ERROR_MESSAGES.FORBIDDEN;
      case 404:
        return '대상을 찾을 수 없습니다.';
      case 422:
        return `입력값 오류: ${e.message}`;
      default:
        return `오류 (${e.status} ${e.code}): ${e.message}`;
    }
  }
  return e instanceof Error ? e.message : String(e);
}
