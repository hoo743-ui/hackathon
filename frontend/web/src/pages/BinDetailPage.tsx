import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { FILL_LEVEL_LABELS, FILL_THRESHOLDS, SENSOR_STATUS_LABELS, WASTE_LABELS, fillLevel, binReading } from '@shared';
import type { Bin, Calibration } from '@shared';
import { useDashboard } from '../data/DashboardContext';
import { ChartLegend, TrendChart } from '../components/charts';
import { FillReadout, LEVEL_TONE, MaterialCode, MaterialColumn, levelLabel } from '../components/material';
import { binWarning } from '../components/overview';
import { CalibrationRow } from '../components/CalibrationForm';
import { EventLog } from '../components/commands';
import { TrendBlock } from '../components/TrendSection';
import { DataList, EmptyState, ErrorState, LoadingState, PageHeader, Section, StatusText } from '../components/primitives';
import { describeError, formatDateTime, formatDistance, formatFill, formatRelative, formatTime } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { useNow } from '../lib/useNow';

const HISTORY_LIMIT = 200;
const HISTORY_REFRESH_MIN_MS = 10_000;

export function BinDetailPage() {
  const { binId = '' } = useParams();
  const { dashboard, api } = useDashboard();
  const now = useNow();
  const bin = dashboard?.bins.find((b) => b.bin_id === binId);

  const [historyKey, setHistoryKey] = useState(0);
  const history = useAsync(() => api.binHistory(binId, { limit: HISTORY_LIMIT }), [api, binId, historyKey]);
  const cal = useAsync(() => api.calibration(binId), [api, binId, bin?.calibrated, bin?.current_fill_percent === null]);
  const minute = useNow(60_000);
  const trend = useAsync(() => api.trend(24, 15), [api, minute]);
  const discharges = useAsync(() => api.commands({ bin_id: binId, limit: 8, order: 'desc' }), [api, binId, minute]);

  // 실시간 갱신이 오면 이력도 다시 불러온다 (최소 간격 유지)
  const lastHistoryFetch = useRef(Date.now());
  useEffect(() => {
    if (!bin) return;
    if (Date.now() - lastHistoryFetch.current < HISTORY_REFRESH_MIN_MS) return;
    lastHistoryFetch.current = Date.now();
    setHistoryKey((k) => k + 1);
  }, [bin?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo(
    () => [...(history.data?.items ?? [])].sort((a, b) => a.measured_at.localeCompare(b.measured_at)),
    [history.data],
  );

  if (dashboard && !bin) {
    return (
      <div className="page">
        <BackLink />
        <PageHeader title="수거함을 찾을 수 없습니다">
          <p className="t-mono muted">{binId}</p>
        </PageHeader>
      </div>
    );
  }

  return (
    <div className="page">
      <BackLink />
      <PageHeader
        title={
          <span className="title-with-code">
            {bin && <MaterialCode type={bin.waste_type} size="lg" />}
            {bin ? WASTE_LABELS[bin.waste_type] : binId}
          </span>
        }
        meta={<span className="t-mono">{binId}</span>}
      />

      {!bin ? (
        <LoadingState />
      ) : (
        <div className="detail-grid">
          <div className="detail-figure">
            <CurrentState bin={bin} now={now} />
          </div>
          <div className="detail-main">
            <Section title="원시 거리 · 보정 범위" aside={<a href="#calibration">보정 편집</a>}>
              <DistanceScale bin={bin} cal={cal.data} />
              {cal.error ? <p className="field-error">보정값을 불러오지 못했습니다: {describeError(cal.error)}</p> : null}
            </Section>

            <Section title="측정 이력" aside={<span className="t-caption">기록 · 최근 {HISTORY_LIMIT}건</span>}>
              {history.error && !history.data ? (
                <ErrorState onRetry={history.reload}>이력을 불러오지 못했습니다: {describeError(history.error)}</ErrorState>
              ) : !history.data ? (
                <LoadingState />
              ) : items.filter((l) => l.fill_percent !== null).length < 2 ? (
                <EmptyState title={`데이터 부족 — 표본 ${items.length}개`}>적재율이 있는 측정이 2건 이상 쌓이면 차트가 표시됩니다.</EmptyState>
              ) : (
                <MeasurementChart bin={bin} items={items} />
              )}
            </Section>

            <Section title="24시간 추이" aside={<span className="t-caption">기록 · 15분 평균</span>}>
              <TrendBlock state={trend} bins={[bin]} height={220} label={`${WASTE_LABELS[bin.waste_type]} 최근 24시간 적재율 추이`} />
            </Section>

            <Section title="최근 측정">
              <RecentTable items={[...items].reverse().slice(0, 20)} loading={!history.data} />
            </Section>

            <Section title="보정" id="calibration" aside={<span className="t-caption">저장 시 제어 토큰 필요 (헤더 ⚙)</span>}>
              <p className="section__lede">초음파 센서에서 빈 통 바닥까지, 가득 찬 높이까지의 거리입니다. 적재율은 서버가 이 두 값으로 계산합니다.</p>
              <CalibrationRow bin={bin} />
            </Section>

            <Section title="임계값" aside={<span className="t-caption">읽기 전용</span>}>
              <DataList
                items={[
                  { term: FILL_LEVEL_LABELS.attention, value: <StatusText tone="attention">{FILL_THRESHOLDS.attention}% 이상</StatusText> },
                  { term: FILL_LEVEL_LABELS.warning, value: <StatusText tone="warning">{FILL_THRESHOLDS.warning}% 이상</StatusText> },
                  { term: FILL_LEVEL_LABELS.critical, value: <StatusText tone="critical">{FILL_THRESHOLDS.critical}% 이상</StatusText> },
                  { term: '서버 가득 참 판정', value: <span className="num">is_full</span>, note: '서버 환경변수 BIN_FULL_THRESHOLD_PERCENT (기본 95%)' },
                ]}
              />
              <p className="section__lede">화면 단계 임계값은 shared/src/labels.ts 의 FILL_THRESHOLDS, 가득 참 판정은 서버 환경변수에서 바꿉니다. 실행 중 변경은 지원하지 않습니다.</p>
            </Section>

            <Section title="배출 기록" aside={<Link to="/operations">운영</Link>}>
              {discharges.error && !discharges.data ? (
                <ErrorState onRetry={discharges.reload}>배출 기록을 불러오지 못했습니다: {describeError(discharges.error)}</ErrorState>
              ) : !discharges.data ? (
                <LoadingState />
              ) : (
                <EventLog commands={discharges.data.items} empty="이 칸의 배출 기록이 없습니다." />
              )}
            </Section>
          </div>
        </div>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/bins" className="back-link">
      <ArrowLeft size={14} aria-hidden /> 수거함 목록
    </Link>
  );
}

function CurrentState({ bin, now }: { bin: Bin; now: number }) {
  const reading = binReading(bin);
  const level = fillLevel(reading.percent);
  const warn = binWarning(bin);
  return (
    <div className="current" data-testid={`bin-detail-${bin.bin_id}`}>
      <div className="current__figure">
        <MaterialColumn type={bin.waste_type} percent={reading.percent} calibrated={bin.calibrated || reading.percent !== null} size="lg" />
        <div className="current__readout">
          <FillReadout percent={reading.percent} calibrated={bin.calibrated || reading.percent !== null} size="xl" />
          <StatusText tone={reading.state === 'live' ? LEVEL_TONE[level] : reading.state === 'no_sensor' ? 'unknown' : 'critical'} strong>
            {reading.state === 'live' ? levelLabel(reading.percent, true) : reading.label}
            {reading.lastPercent !== null && reading.state !== 'live' ? ` · 마지막 ${reading.lastPercent.toFixed(1)}%` : ''}
          </StatusText>
          {warn && (
            <p className="current__warn" data-tone={warn.tone}>
              {warn.text}
            </p>
          )}
        </div>
      </div>
      <DataList
        items={[
          { term: '현재 거리', value: <span className="num">{formatDistance(bin.current_distance_cm)}</span> },
          {
            term: '센서',
            value: (
              <StatusText tone={bin.sensor_status === 'normal' ? 'ok' : bin.sensor_status ? 'critical' : 'unknown'}>
                {bin.sensor_status ? SENSOR_STATUS_LABELS[bin.sensor_status] : '--'}
              </StatusText>
            ),
          },
          { term: '보정', value: bin.calibrated ? '보정됨' : '미보정' },
          {
            term: '마지막 유효 측정',
            value: (
              <span className="num" title={formatDateTime(bin.last_valid_at)}>
                {formatRelative(bin.last_valid_at, now)} <span className="t-mono muted">{formatTime(bin.last_valid_at)}</span>
              </span>
            ),
          },
          { term: '장치', value: <span className="t-mono">{bin.device_id}</span> },
        ]}
      />
    </div>
  );
}

/** 센서(0cm)부터의 수평 눈금: 가득 기준 · 빈 통 기준 · 현재 거리 */
function DistanceScale({ bin, cal }: { bin: Bin; cal: Calibration | null }) {
  const empty = cal?.empty_distance_cm ?? null;
  const full = cal?.full_distance_cm ?? null;
  const cur = bin.current_distance_cm;
  const max = Math.max(10, (empty ?? 0) * 1.15, (cur ?? 0) * 1.1, (full ?? 0) * 1.5);
  const pos = (cm: number) => `${(Math.min(max, Math.max(0, cm)) / max) * 100}%`;
  const ticks = Array.from({ length: Math.floor(max / 10) + 1 }, (_, i) => i * 10);

  return (
    <div className="dscale">
      <div className="dscale__track" role="img" aria-label={`현재 거리 ${formatDistance(cur)}, 가득 기준 ${formatDistance(full)}, 빈 통 기준 ${formatDistance(empty)}`}>
        {empty !== null && full !== null && <span className="dscale__range" style={{ left: pos(full), width: `calc(${pos(empty)} - ${pos(full)})` }} />}
        {ticks.map((t) => (
          <span key={t} className="dscale__tick" style={{ left: pos(t) }}>
            <span>{t}</span>
          </span>
        ))}
        {full !== null && (
          <span className="dscale__mark dscale__mark--full" style={{ left: pos(full) }}>
            <span>가득 {full.toFixed(1)}</span>
          </span>
        )}
        {empty !== null && (
          <span className="dscale__mark dscale__mark--empty" style={{ left: pos(empty) }}>
            <span>빈 통 {empty.toFixed(1)}</span>
          </span>
        )}
        {cur !== null && (
          <span className="dscale__cur" style={{ left: pos(cur) }} data-level={fillLevel(bin.current_fill_percent)}>
            <span>현재 {cur.toFixed(1)}</span>
          </span>
        )}
      </div>
      <p className="dscale__axis t-caption">센서로부터의 거리 (cm) · 거리가 짧을수록 많이 찬 상태</p>
      {!bin.calibrated && <p className="t-caption">미보정: 빈 통·가득 기준이 없어 적재율을 계산하지 않습니다. 설정에서 보정하세요.</p>}
    </div>
  );
}

function MeasurementChart({ bin, items }: { bin: Bin; items: { measured_at: string; fill_percent: number | null; sensor_status: string }[] }) {
  const rows = items.map((l) => ({ t: Date.parse(l.measured_at), [bin.bin_id]: l.fill_percent }));
  const errors = items.filter((l) => l.sensor_status !== 'normal').map((l) => Date.parse(l.measured_at));
  const span = rows.length > 1 ? (rows[rows.length - 1].t - rows[0].t) / 3_600_000 : 1;
  const series = [{ key: bin.bin_id, type: bin.waste_type }];
  return (
    <>
      <ChartLegend
        series={series}
        extra={
          <li className="chart-legend__note">
            <span className="chart-legend__err" aria-hidden /> 오류 측정 {errors.length}건
          </li>
        }
      />
      <TrendChart rows={rows} series={series} spanHours={span} errorTimes={errors} height={240} ariaLabel={`${WASTE_LABELS[bin.waste_type]} 최근 측정 적재율, 오류 측정 ${errors.length}건`} />
    </>
  );
}

function RecentTable({ items, loading }: { items: { measured_at: string; distance_cm: number | null; fill_percent: number | null; sensor_status: keyof typeof SENSOR_STATUS_LABELS; source: string }[]; loading: boolean }) {
  if (loading) return <LoadingState />;
  if (!items.length) return <EmptyState>측정 이력이 없습니다.</EmptyState>;
  return (
    <div className="table-wrap">
      <table className="table table--dense">
        <thead>
          <tr>
            <th scope="col">측정 시각</th>
            <th scope="col" className="num">
              거리
            </th>
            <th scope="col" className="num">
              적재율
            </th>
            <th scope="col">센서</th>
            <th scope="col">출처</th>
          </tr>
        </thead>
        <tbody>
          {items.map((l) => (
            <tr key={l.measured_at} className={l.sensor_status !== 'normal' ? 'row-bad' : ''}>
              <td className="t-mono">{formatTime(l.measured_at)}</td>
              <td className="num t-mono">{formatDistance(l.distance_cm)}</td>
              <td className="num t-mono">{formatFill(l.fill_percent)}</td>
              <td className={l.sensor_status !== 'normal' ? 'is-bad' : ''}>{SENSOR_STATUS_LABELS[l.sensor_status]}</td>
              <td className="muted">{l.source === 'simulator' ? '시뮬레이터' : '하드웨어'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
