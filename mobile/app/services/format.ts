const pad = (n: number) => String(n).padStart(2, '0');

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** ISO 시각 → "HH:MM:SS" (기기 로컬 시간) */
export function formatTime(iso: string | null | undefined): string {
  const d = parse(iso);
  return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` : '--';
}

/** ISO 시각 → "HH:MM" (차트 축) */
export function formatHHmm(iso: string | number | null | undefined): string {
  const d = typeof iso === 'number' ? new Date(iso) : parse(iso);
  return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '--';
}

/** ISO 시각 → "MM/DD HH:MM:SS" */
export function formatDateTime(iso: string | null | undefined): string {
  const d = parse(iso);
  return d ? `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${formatTime(iso)}` : '--';
}

/** 상대 시각 ("방금", "12초 전", "3분 전", "2시간 전", "4일 전"). 미래 시각(시계 차)은 "방금". */
export function formatRelative(iso: string | null | undefined, now: number = Date.now()): string {
  const d = parse(iso);
  if (!d) return '기록 없음';
  const s = Math.floor((now - d.getTime()) / 1000);
  if (s < 5) return '방금';
  if (s < 60) return `${s}초 전`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

/** 서버가 계산한 적재율을 그대로 표시. null 은 0%가 아니라 "미보정". */
export function formatFill(percent: number | null | undefined): string {
  if (percent === null || percent === undefined) return '미보정';
  return `${percent.toFixed(1)}%`;
}

/** 판독값용 분리 표기: 값 + 단위. null 이면 "--" (단위 없음, 0 아님). */
export function fillReadout(percent: number | null | undefined, digits = 1): { value: string; unit: string } {
  if (percent === null || percent === undefined || Number.isNaN(percent)) return { value: '--', unit: '' };
  return { value: percent.toFixed(digits), unit: '%' };
}

export function formatDistance(cm: number | null | undefined): string {
  if (cm === null || cm === undefined) return '--';
  return `${cm.toFixed(1)} cm`;
}

/** 숫자 천 단위 구분 */
export function formatCount(n: number): string {
  return n.toLocaleString('ko-KR');
}
