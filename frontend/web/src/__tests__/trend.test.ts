import { describe, expect, it } from 'vitest';
import { firstRecordedAt, trendRows } from '../lib/trend';

const H = 3_600_000;
const NOW = Date.UTC(2026, 9, 31, 12, 30);
const at = (h: number) => new Date(Date.UTC(2026, 9, 31, h)).toISOString();
const bucket = (h: number, bin: string, v: number | null) => ({ bucket_start: at(h), bin_id: bin, avg_fill_percent: v, max_fill_percent: v, sample_count: 5, error_count: 0 });

describe('trendRows', () => {
  it('측정 없는 구간은 0 이 아니라 null (선 끊김)', () => {
    const rows = trendRows({ period_hours: 24, bucket_minutes: 60, buckets: [bucket(8, 'A', 10), bucket(10, 'A', 30), bucket(10, 'B', 50)] }, ['A', 'B'], NOW);
    const byHour = new Map(rows.map((r) => [new Date(r.t).getUTCHours(), r]));
    expect(byHour.get(8)!.A).toBe(10);
    expect(byHour.get(9)!.A).toBeNull();
    expect(byHour.get(8)!.B).toBeNull();
    expect(byHour.get(10)!.B).toBe(50);
    expect(byHour.get(12)!.A).toBeNull();
    // 기록이 08시부터 → 그 이전은 그리지 않고 따로 안내
    expect(rows[0].t).toBe(Date.parse(at(8)));
    expect(firstRecordedAt({ period_hours: 24, bucket_minutes: 60, buckets: [bucket(8, 'A', 10)] }, NOW)).toBe(Date.parse(at(8)));
    expect(rows.length).toBe(5);
    expect(H).toBeGreaterThan(0);
  });
});
