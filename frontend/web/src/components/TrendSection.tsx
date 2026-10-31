import { useMemo } from 'react';
import type { Bin, Trend } from '@shared';
import { describeError, formatStamp } from '../lib/format';
import { MIN_TREND_BUCKETS, firstRecordedAt, populatedBuckets, trendRows } from '../lib/trend';
import type { AsyncState } from '../lib/useAsync';
import { ChartLegend, TrendChart } from './charts';
import type { SeriesDef } from './charts';
import { EmptyState, ErrorState, LoadingState } from './primitives';

const bucketLabel = (m: number) => (m >= 60 ? `${m / 60}시간` : `${m}분`);

/** 추이 API 결과를 차트/빈 상태/오류로 그린다 (개요·분석 공용) */
export function TrendBlock({ state, bins, height = 280, label }: { state: AsyncState<Trend>; bins: Bin[]; height?: number; label: string }) {
  const series: SeriesDef[] = useMemo(() => bins.map((b) => ({ key: b.bin_id, type: b.waste_type })), [bins]);
  const t = state.data;
  const rows = useMemo(() => (t ? trendRows(t, series.map((s) => s.key)) : []), [t, series]);

  if (state.error && !t) return <ErrorState onRetry={state.reload}>추이를 불러오지 못했습니다: {describeError(state.error)}</ErrorState>;
  if (!t) return <LoadingState />;
  const n = populatedBuckets(t);
  const first = firstRecordedAt(t);
  if (n < MIN_TREND_BUCKETS) {
    return (
      <EmptyState title={`데이터 부족 — 측정 구간 ${n}개`}>
        최근 {t.period_hours}시간을 {bucketLabel(t.bucket_minutes)} 구간으로 나눴을 때 측정이 있는 구간이 {MIN_TREND_BUCKETS}개 미만입니다. 측정이 쌓이면 추이가 표시됩니다.
      </EmptyState>
    );
  }
  return (
    <>
      <ChartLegend
        series={series}
        extra={
          <li className="chart-legend__note">
            {bucketLabel(t.bucket_minutes)} 평균 · 빈 구간은 측정 없음
            {first !== null && <> · 기록 시작 {formatStamp(new Date(first).toISOString())} (이전 기록 없음)</>}
          </li>
        }
      />
      <TrendChart rows={rows} series={series} spanHours={t.period_hours} height={height} ariaLabel={label} />
    </>
  );
}
