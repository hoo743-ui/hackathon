export interface Point {
  t: number;
  v: number | null;
}

/**
 * 선 차트 구간 분할 (순수 함수). null 값이나 maxGapMs 보다 긴 시간 공백에서 선을 끊는다
 * — 측정 없는 구간을 이어 그려 데이터를 지어내지 않기 위함.
 */
export function buildSegments(points: Point[], maxGapMs: number): { t: number; v: number }[][] {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const segs: { t: number; v: number }[][] = [];
  let cur: { t: number; v: number }[] = [];
  let lastT: number | null = null;
  for (const p of sorted) {
    const gap = lastT !== null && p.t - lastT > maxGapMs;
    if (p.v === null || Number.isNaN(p.v) || gap) {
      if (cur.length) segs.push(cur);
      cur = [];
    }
    if (p.v !== null && !Number.isNaN(p.v)) cur.push({ t: p.t, v: p.v });
    lastT = p.t;
  }
  if (cur.length) segs.push(cur);
  return segs;
}

/** 표본 간격 중앙값 (ms). 표본 2개 미만이면 null */
export function medianInterval(times: number[]): number | null {
  if (times.length < 2) return null;
  const s = [...times].sort((a, b) => a - b);
  const d = s.slice(1).map((t, i) => t - s[i]).sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)];
}

/** [t0,t1] 사이 n개의 균등 눈금 */
export function timeTicks(t0: number, t1: number, n: number): number[] {
  if (n < 2 || t1 <= t0) return [t0];
  return Array.from({ length: n }, (_, i) => t0 + ((t1 - t0) * i) / (n - 1));
}
