import type { Page } from './shared';

export const PAGE_SIZE = 50;

/** 다음 페이지 offset. 더 없으면 null */
export function nextOffset(page: Pick<Page<unknown>, 'offset' | 'limit' | 'total' | 'items'>): number | null {
  const next = page.offset + page.items.length;
  return page.items.length > 0 && next < page.total ? next : null;
}

/** "1–50 / 총 1,234건" */
export function rangeLabel(loaded: number, total: number): string {
  if (total === 0) return '결과 없음';
  return `${loaded.toLocaleString('ko-KR')} / 총 ${total.toLocaleString('ko-KR')}건`;
}

/** 이어 붙이기 (id 중복 제거 — 새 데이터가 들어와 offset 이 밀린 경우 대비) */
export function appendUnique<T>(prev: T[], next: T[], key: (item: T) => string | number): T[] {
  const seen = new Set(prev.map(key));
  return [...prev, ...next.filter((i) => !seen.has(key(i)))];
}
