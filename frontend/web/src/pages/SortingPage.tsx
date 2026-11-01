import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowUpDown } from 'lucide-react';
import { DETECTION_OUTCOME_LABELS, HARDWARE_STATUS_LABELS, WASTE_LABELS, WASTE_TYPES, detectionImageUrl } from '@shared';
import type { Detection, DetectionOutcome, DetectionSummary } from '@shared';
import { useDashboard } from '../data/DashboardContext';
import { Confidence, DetectionType, OUTCOME_TONE, OutcomeDetail, OutcomeText } from '../components/detections';
import { DetectionImage } from '../components/live';
import { config } from '../config';
import { Pagination } from '../components/Pagination';
import { Button, EmptyState, ErrorState, LoadingState, PageHeader, Section, Segmented, StatusText } from '../components/primitives';
import { describeError, formatCount, formatDateTime, formatStamp } from '../lib/format';
import { OUTCOMES, PAGE_SIZE, PERIOD_LABELS, detectionQuery, filtersToSearch, localMidnightIso, parseFilters, periodRange } from '../lib/sortingQuery';
import type { Period, SortingFilters } from '../lib/sortingQuery';
import { useAsync } from '../lib/useAsync';

/** AI 분류 기록 (SERVICE_RESTRUCTURE §3). 제어 기록(명령)과 다른 표 — 연결 명령은 ID 와 ACK 결과만 보여준다. */
export function SortingPage() {
  const { api, dashboard } = useDashboard();
  const [sp, setSp] = useSearchParams();
  const f = useMemo(() => parseFilters(sp), [sp]);
  const key = filtersToSearch(f).toString();
  // 새 분류가 들어오면 다시 조회
  const latest = dashboard?.recent_detections?.[0]?.id;

  const update = (patch: Partial<SortingFilters>, keepPage = false) => {
    setSp(filtersToSearch({ ...f, ...patch, page: keepPage ? (patch.page ?? f.page) : 1 }));
  };

  const page = useAsync(() => api.detections(detectionQuery(f)), [api, key, latest]);
  const periodFrom = periodRange(f).from;
  const summary = useAsync(() => api.detectionSummary(periodFrom ?? new Date(0).toISOString()), [api, f.period, f.from, latest]);
  const today = useAsync(() => api.detectionSummary(localMidnightIso()), [api, latest]);

  return (
    <div className="page">
      <PageHeader title="분류 기록">
        <p className="page-head__lede">AI 분류 프로그램이 보낸 결과와 처리 결과입니다. 신뢰도는 모델 출력값 그대로이며, 서버 임계값(AI_CONFIDENCE_THRESHOLD) 미만이면 동작하지 않고 “신뢰도 낮음”으로 기록됩니다.</p>
      </PageHeader>

      <Section title="요약" aside={<span className="t-caption">{PERIOD_LABELS[f.period]} 기준 · 저장된 분류 기록만 집계</span>}>
        {summary.error && !summary.data ? (
          <ErrorState onRetry={summary.reload}>요약을 불러오지 못했습니다: {describeError(summary.error)}</ErrorState>
        ) : !summary.data ? (
          <LoadingState />
        ) : (
          <SummaryStrip s={summary.data} today={today.data?.total ?? null} period={f.period} />
        )}
      </Section>

      <Section title="기록">
        <form className="filters" aria-label="필터" onSubmit={(e) => e.preventDefault()}>
          <div className="filters__group">
            <span className="t-label">기간</span>
            <Segmented<Period>
              label="기간"
              size="sm"
              value={f.period}
              options={(Object.keys(PERIOD_LABELS) as Period[]).map((p) => ({ value: p, label: PERIOD_LABELS[p] }))}
              onChange={(p) => update({ period: p })}
            />
          </div>
          {f.period === 'custom' && (
            <div className="filters__group filters__range">
              <label className="field field--inline">
                <span className="t-label">시작</span>
                <input type="datetime-local" value={f.from} onChange={(e) => update({ from: e.target.value })} />
              </label>
              <label className="field field--inline">
                <span className="t-label">끝</span>
                <input type="datetime-local" value={f.to} onChange={(e) => update({ to: e.target.value })} />
              </label>
            </div>
          )}
          <label className="field field--inline">
            <span className="t-label">종류</span>
            <select value={f.type} onChange={(e) => update({ type: e.target.value })}>
              <option value="">전체</option>
              {WASTE_TYPES.map((w) => (
                <option key={w} value={w}>
                  {WASTE_LABELS[w]}
                </option>
              ))}
            </select>
          </label>
          <label className="field field--inline">
            <span className="t-label">처리 결과</span>
            <select value={f.outcome} onChange={(e) => update({ outcome: e.target.value as DetectionOutcome | '' })}>
              <option value="">전체</option>
              {OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {DETECTION_OUTCOME_LABELS[o]}
                </option>
              ))}
            </select>
          </label>
          <label className="field field--inline">
            <span className="t-label">출처</span>
            <select value={f.source} onChange={(e) => update({ source: e.target.value as SortingFilters['source'] })}>
              <option value="">전체</option>
              <option value="model">AI 모델</option>
              <option value="simulator">시뮬레이터</option>
            </select>
          </label>
          <div className="filters__group filters__end">
            <Button size="sm" onClick={() => update({ order: f.order === 'desc' ? 'asc' : 'desc' })} aria-label={`정렬: ${f.order === 'desc' ? '최신순' : '오래된순'} (눌러서 변경)`}>
              <ArrowUpDown size={14} aria-hidden /> {f.order === 'desc' ? '최신순' : '오래된순'}
            </Button>
            <Button size="sm" variant="quiet" onClick={() => setSp(new URLSearchParams())}>
              필터 초기화
            </Button>
          </div>
        </form>

        {page.error && !page.data ? (
          <ErrorState onRetry={page.reload}>분류 기록을 불러오지 못했습니다: {describeError(page.error)}</ErrorState>
        ) : !page.data ? (
          <LoadingState />
        ) : (
          <>
            {page.data.items.length === 0 ? (
              <EmptyState title="아직 분류 기록 없음">이 기간·조건에 맞는 분류가 없습니다. 기간을 넓히거나 필터를 초기화해 보세요.</EmptyState>
            ) : (
              <DetectionTable items={page.data.items} />
            )}
            <Pagination offset={page.data.offset} limit={page.data.limit || PAGE_SIZE} total={page.data.total} count={page.data.items.length} onPage={(p) => update({ page: p }, true)} />
          </>
        )}
      </Section>
    </div>
  );
}

function SummaryStrip({ s, today, period }: { s: DetectionSummary; today: number | null; period: Period }) {
  if (s.total === 0) {
    return (
      <p className="sum-empty" data-testid="summary-empty">
        아직 분류 기록 없음{today !== null && period !== 'today' ? ` · 오늘 ${formatCount(today)}건` : ''}
      </p>
    );
  }
  const types = Object.entries(s.by_waste_type).sort((a, b) => b[1] - a[1]);
  const outcomes = Object.entries(s.by_outcome).sort((a, b) => b[1] - a[1]);
  return (
    <div className="sum" data-testid="summary">
      <div className="sum__total">
        <span className="t-label">{PERIOD_LABELS[period]} 분류</span>
        <span className="sum__num num">
          {formatCount(s.total)}
          <small>건</small>
        </span>
        <span className="t-caption">
          {period !== 'today' && today !== null ? `오늘 ${formatCount(today)}건 · ` : ''}평균 신뢰도 {s.avg_confidence === null ? '--' : s.avg_confidence.toFixed(2)}
        </span>
      </div>
      <dl className="sum__group" aria-label="재질별 건수">
        <dt className="t-label">재질별</dt>
        {types.map(([t, n]) => (
          <dd key={t}>
            <DetectionType type={t} />
            <span className="num">{formatCount(n)}</span>
          </dd>
        ))}
      </dl>
      <dl className="sum__group" aria-label="처리 결과별 건수">
        <dt className="t-label">처리 결과별</dt>
        {outcomes.map(([o, n]) => (
          <dd key={o}>
            <StatusText tone={OUTCOME_TONE[o as DetectionOutcome] ?? 'neutral'}>{DETECTION_OUTCOME_LABELS[o] ?? o}</StatusText>
            <span className="num">{formatCount(n)}</span>
          </dd>
        ))}
      </dl>
    </div>
  );
}

function DetectionTable({ items }: { items: Detection[] }) {
  return (
    <div className="table-wrap">
      <table className="table table--dense" data-testid="detection-table">
        <thead>
          <tr>
            <th scope="col">이미지</th>
            <th scope="col">분류 시각</th>
            <th scope="col">종류</th>
            <th scope="col" className="num">
              신뢰도
            </th>
            <th scope="col">처리 결과</th>
            <th scope="col">하드웨어 · 장치 응답</th>
            <th scope="col">출처</th>
            <th scope="col">모델</th>
          </tr>
        </thead>
        <tbody>
          {items.map((d) => (
            <tr key={d.id} className={d.outcome === 'SORT_FAILED' || d.outcome === 'DEVICE_UNAVAILABLE' ? 'row-bad' : ''}>
              <td className="sort-thumb">
                {d.image_url ? (
                  <a href={detectionImageUrl(config.apiBaseUrl, d) ?? undefined} target="_blank" rel="noreferrer">
                    <DetectionImage d={d} />
                  </a>
                ) : (
                  <span className="muted">--</span>
                )}
              </td>
              <td className="t-mono nowrap" title={formatDateTime(d.detected_at)}>
                {formatStamp(d.detected_at)}
              </td>
              <td className="nowrap">
                <DetectionType type={d.waste_type} />
              </td>
              <td className="num">
                <Confidence value={d.confidence} />
              </td>
              <td className="nowrap">
                <OutcomeText outcome={d.outcome} />
              </td>
              <td>
                {d.hardware_status ? (
                  <span>{HARDWARE_STATUS_LABELS[d.hardware_status] ?? d.hardware_status}</span>
                ) : (
                  <>
                    {d.command_id ? <span className="t-mono muted">{d.command_id.slice(0, 8)} · </span> : null}
                    {d.outcome_detail ? <OutcomeDetail detail={d.outcome_detail} /> : !d.command_id ? <span className="muted">--</span> : null}
                  </>
                )}
              </td>
              <td className="nowrap">{d.source === 'simulator' ? <span className="origin-tag origin-tag--sim">시뮬레이터</span> : 'AI 모델'}</td>
              <td className="t-mono muted">{d.model_name ?? '--'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
