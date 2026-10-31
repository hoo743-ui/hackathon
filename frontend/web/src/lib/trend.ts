import type { Trend } from '@shared';

/** 서버 date_bin 기준점 (backend history_service.fill_trend: 2000-01-01 UTC) */
const ORIGIN = Date.UTC(2000, 0, 1);

export type TrendRow = { t: number } & Record<string, number | null>;

/**
 * 추이 버킷을 차트 행으로 변환. 기간 전체의 버킷 시각을 만들고, 측정이 없는 버킷은 null 로 둔다
 * (0 으로 채우지 않음 → 차트에서 선이 끊긴다).
 */
export function trendRows(trend: Trend, binIds: string[], nowMs = Date.now()): TrendRow[] {
  const step = trend.bucket_minutes * 60_000;
  const align = (ms: number) => ORIGIN + Math.floor((ms - ORIGIN) / step) * step;
  const start = align(nowMs - trend.period_hours * 3_600_000);
  const end = align(nowMs);
  const byKey = new Map<string, number | null>();
  let earliest = Infinity;
  for (const b of trend.buckets) {
    const t = Date.parse(b.bucket_start);
    if (Number.isNaN(t)) continue;
    earliest = Math.min(earliest, t);
    byKey.set(`${t}|${b.bin_id}`, b.avg_fill_percent);
  }
  // 기간 시작보다 늦게 기록이 시작됐으면 첫 기록 구간부터 그린다 (그 이전은 "기록 없음"으로 따로 안내)
  const from = Number.isFinite(earliest) ? Math.max(start, earliest) : start;
  const rows: TrendRow[] = [];
  for (let t = from; t <= end; t += step) {
    const row = { t } as TrendRow;
    for (const id of binIds) row[id] = byKey.get(`${t}|${id}`) ?? null;
    rows.push(row);
  }
  return rows;
}

/** 첫 기록 구간 시각. 기간 시작 이후라면 그 이전은 기록이 없다는 뜻 */
export function firstRecordedAt(trend: Trend, nowMs = Date.now()): number | null {
  const ts = trend.buckets.map((b) => Date.parse(b.bucket_start)).filter((t) => !Number.isNaN(t));
  if (!ts.length) return null;
  const first = Math.min(...ts);
  const step = trend.bucket_minutes * 60_000;
  return first > nowMs - trend.period_hours * 3_600_000 + step ? first : null;
}

/** 값이 있는(표본이 있는) 버킷 수 — "데이터 부족" 판정용 */
export function populatedBuckets(trend: Trend): number {
  return new Set(trend.buckets.filter((b) => b.avg_fill_percent !== null).map((b) => b.bucket_start)).size;
}

/** 이 개수 미만이면 추이 차트 대신 "데이터 부족" 을 보여준다 (§4.6) */
export const MIN_TREND_BUCKETS = 3;
