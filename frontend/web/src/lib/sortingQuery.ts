import type { DetectionOutcome, DetectionQuery } from '@shared';

/** 분류 기록 필터. URL 쿼리와 1:1 대응 */
export type Period = 'today' | '24h' | '7d' | 'custom';
export interface SortingFilters {
  period: Period;
  /** custom 기간: datetime-local (로컬 시각) */
  from: string;
  to: string;
  type: string;
  outcome: DetectionOutcome | '';
  source: 'model' | 'simulator' | '';
  order: 'asc' | 'desc';
  page: number;
}

export const PAGE_SIZE = 50;
export const PERIOD_LABELS: Record<Period, string> = { today: '오늘', '24h': '24시간', '7d': '7일', custom: '사용자 지정' };
export const OUTCOMES: DetectionOutcome[] = ['SORTING', 'SORTED', 'SORT_FAILED', 'LOW_CONFIDENCE', 'UNRECOGNIZED', 'MANUAL_MODE', 'DEVICE_UNAVAILABLE'];

const DEFAULTS: SortingFilters = { period: 'today', from: '', to: '', type: '', outcome: '', source: '', order: 'desc', page: 1 };

const oneOf = <T extends string>(v: string | null, allowed: readonly T[], fallback: T): T =>
  v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

export function parseFilters(sp: URLSearchParams): SortingFilters {
  const page = Number(sp.get('page'));
  return {
    period: oneOf(sp.get('period'), ['today', '24h', '7d', 'custom'] as const, DEFAULTS.period),
    from: sp.get('from') ?? '',
    to: sp.get('to') ?? '',
    type: sp.get('type') ?? '',
    outcome: oneOf(sp.get('outcome'), ['', ...OUTCOMES] as const, ''),
    source: oneOf(sp.get('source'), ['', 'model', 'simulator'] as const, ''),
    order: oneOf(sp.get('order'), ['asc', 'desc'] as const, 'desc'),
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

/** 기본값과 다른 항목만 URL 에 남긴다 */
export function filtersToSearch(f: SortingFilters): URLSearchParams {
  const sp = new URLSearchParams();
  (Object.keys(DEFAULTS) as (keyof SortingFilters)[]).forEach((k) => {
    const v = f[k];
    if (v !== DEFAULTS[k] && v !== '') sp.set(k, String(v));
  });
  if (f.period !== 'custom') {
    sp.delete('from');
    sp.delete('to');
  }
  return sp;
}

/** 오늘 0시 (로컬) ISO */
export function localMidnightIso(nowMs = Date.now()): string {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function toIso(local: string): string | undefined {
  if (!local) return undefined;
  const t = new Date(local).getTime();
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

export function periodRange(f: SortingFilters, nowMs = Date.now()): { from?: string; to?: string } {
  switch (f.period) {
    case 'today':
      return { from: localMidnightIso(nowMs) };
    case '24h':
      return { from: new Date(nowMs - 24 * 3_600_000).toISOString() };
    case '7d':
      return { from: new Date(nowMs - 168 * 3_600_000).toISOString() };
    case 'custom':
      return { from: toIso(f.from), to: toIso(f.to) };
  }
}

export function detectionQuery(f: SortingFilters, nowMs = Date.now()): DetectionQuery {
  return {
    ...periodRange(f, nowMs),
    waste_type: f.type || undefined,
    outcome: f.outcome || undefined,
    source: f.source || undefined,
    order: f.order,
    limit: PAGE_SIZE,
    offset: (f.page - 1) * PAGE_SIZE,
  };
}
