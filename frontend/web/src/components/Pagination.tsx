import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatCount } from '../lib/format';
import { Button } from './primitives';

export function Pagination({ offset, limit, total, count, onPage }: { offset: number; limit: number; total: number; count: number; onPage: (next: number) => void }) {
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  const from = total === 0 ? 0 : offset + 1;
  const to = offset + count;
  return (
    <nav className="pager" aria-label="페이지">
      <span className="pager__range num" data-testid="pager-range" aria-live="polite">
        {formatCount(from)}–{formatCount(to)} <span className="muted">/ 총 {formatCount(total)}</span>
      </span>
      <span className="pager__page num muted">
        {page} / {pages} 페이지
      </span>
      <span className="pager__btns">
        <Button size="sm" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="이전 페이지">
          <ChevronLeft size={16} aria-hidden /> 이전
        </Button>
        <Button size="sm" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="다음 페이지">
          다음 <ChevronRight size={16} aria-hidden />
        </Button>
      </span>
    </nav>
  );
}
