import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SENSOR_STATUS_LABELS, WASTE_LABELS, fillLevel, binReading } from '@shared';
import { useDashboard } from '../data/DashboardContext';
import { Sparkline } from '../components/charts';
import { LEVEL_TONE, MaterialCode, MaterialColumn, levelLabel } from '../components/material';
import { EmptyState, LoadingState, PageHeader, Section, Segmented, StatusText } from '../components/primitives';
import { TrendBlock } from '../components/TrendSection';
import { fillNumber, formatDistance, formatRelative, formatTime } from '../lib/format';
import { trendRows } from '../lib/trend';
import { useAsync } from '../lib/useAsync';
import { useNow } from '../lib/useNow';

export function BinsPage() {
  const { dashboard, api } = useDashboard();
  const now = useNow();
  const minute = useNow(60_000);
  const trend = useAsync(() => api.trend(24, 30), [api, minute]);
  const navigate = useNavigate();
  const [span, setSpan] = useState<'24h' | '7d'>('24h');
  const longTrend = useAsync(() => (span === '24h' ? api.trend(24, 15) : api.trend(168, 360)), [api, span, minute]);
  const bins = useMemo(() => dashboard?.bins ?? [], [dashboard?.bins]);
  const rows = useMemo(() => (trend.data ? trendRows(trend.data, bins.map((b) => b.bin_id)) : []), [trend.data, bins]);

  return (
    <div className="page">
      <PageHeader title="수거함" meta={<span className="t-caption">행을 선택하면 상세로 이동합니다</span>} />
      {!dashboard ? (
        <LoadingState />
      ) : bins.length === 0 ? (
        <EmptyState>등록된 수거함이 없습니다.</EmptyState>
      ) : (
        <Section title="현재 상태" aside={<span className="t-caption">실시간 · 추이는 최근 24시간 기록</span>}>
          <div className="table-wrap">
            <table className="table table--bins">
              <thead>
                <tr>
                  <th scope="col">재질</th>
                  <th scope="col" className="num">
                    적재율
                  </th>
                  <th scope="col">단계</th>
                  <th scope="col" className="num col-md">
                    거리
                  </th>
                  <th scope="col">센서</th>
                  <th scope="col" className="col-md num">
                    마지막 측정
                  </th>
                  <th scope="col" className="col-lg">
                    24시간 추이
                  </th>
                </tr>
              </thead>
              <tbody>
                {bins.map((b) => {
                  const reading = binReading(b);
                  const level = fillLevel(reading.percent);
                  const sensorBad = b.sensor_status !== null && b.sensor_status !== 'normal';
                  return (
                    <tr key={b.bin_id} className="row-link" data-testid={`bin-row-${b.bin_id}`} onClick={() => navigate(`/bins/${b.bin_id}`)}>
                      <th scope="row">
                        <span className="bin-ident">
                          <MaterialCode type={b.waste_type} />
                          <span>
                            <Link to={`/bins/${b.bin_id}`} onClick={(e) => e.stopPropagation()}>
                              {WASTE_LABELS[b.waste_type]}
                            </Link>
                            <span className="t-mono muted bin-ident__id">{b.bin_id}</span>
                          </span>
                        </span>
                      </th>
                      <td className="num">
                        <span className="fill-cell">
                          <MaterialColumn type={b.waste_type} percent={reading.percent} calibrated={b.calibrated || reading.percent !== null} size="xs" ticks={false} />
                          <span className="fill-cell__val">
                            {fillNumber(reading.percent)}
                            {reading.percent !== null && <small>%</small>}
                          </span>
                        </span>
                      </td>
                      <td>
                        <StatusText tone={reading.state === 'live' ? LEVEL_TONE[level] : reading.state === 'no_sensor' ? 'unknown' : 'critical'}>
                          {reading.state === 'live' ? levelLabel(reading.percent, true) : reading.label}
                        </StatusText>
                      </td>
                      <td className="num col-md">{formatDistance(b.current_distance_cm)}</td>
                      <td className={sensorBad ? 'is-bad' : ''}>{b.sensor_status ? SENSOR_STATUS_LABELS[b.sensor_status] : '--'}</td>
                      <td className="col-md num" title={formatTime(b.last_valid_at)}>
                        {formatRelative(b.last_valid_at, now)}
                      </td>
                      <td className="col-lg">
                        {trend.data ? (
                          <Sparkline values={rows.map((r) => r[b.bin_id])} type={b.waste_type} label={`${WASTE_LABELS[b.waste_type]} 최근 24시간 적재율 추이`} />
                        ) : (
                          <span className="muted t-caption">{trend.error ? '추이 없음' : '…'}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}
      {dashboard && bins.length > 0 && (
        <Section
          title="적재율 추이"
          aside={
            <Segmented<'24h' | '7d'>
              label="추이 기간"
              size="sm"
              value={span}
              options={[
                { value: '24h', label: '24시간' },
                { value: '7d', label: '7일' },
              ]}
              onChange={setSpan}
            />
          }
        >
          <TrendBlock state={longTrend} bins={bins} height={300} label={`최근 ${span === '24h' ? '24시간' : '7일'} 재질별 적재율 추이`} />
        </Section>
      )}
    </div>
  );
}
