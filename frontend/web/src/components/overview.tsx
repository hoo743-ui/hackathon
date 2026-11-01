import { Link } from 'react-router-dom';
import { ALERT_KIND_LABELS, FILL_THRESHOLDS, SENSOR_STATUS_LABELS, WASTE_LABELS, fillLevel, binReading } from '@shared';
import type { Alert, AlertSeverity, Bin } from '@shared';
import { formatDistance, formatRelative, formatTime } from '../lib/format';
import { FillReadout, LEVEL_TONE, MaterialCode, MaterialColumn, levelLabel } from './material';
import type { Tone } from './primitives';

/** 컬럼 아래 한 줄 경고 (위험 bin 은 채움색 + 이 문장으로만 강조) */
export function binWarning(bin: Bin): { tone: Tone; text: string } | null {
  if (bin.sensor_status && bin.sensor_status !== 'normal') return { tone: 'critical', text: `센서 ${SENSOR_STATUS_LABELS[bin.sensor_status]}` };
  if (bin.is_full) return { tone: 'critical', text: '가득 참 · 비움 필요' };
  const level = fillLevel(bin.current_fill_percent);
  if (level === 'critical') return { tone: 'critical', text: `${FILL_THRESHOLDS.critical}% 이상 · 비움 필요` };
  if (level === 'warning') return { tone: 'warning', text: `${FILL_THRESHOLDS.warning}% 이상 · 비움 준비` };
  if (bin.current_fill_percent === null) return { tone: 'unknown', text: bin.calibrated ? '유효 측정값 없음' : '미보정 · 설정에서 보정 필요' };
  return null;
}

/** 개요의 수거함 한 칸: 코드칩 · 컬럼 · 판독값 · ledger 행 */
export function BinColumnCell({ bin, now }: { bin: Bin; now: number }) {
  // 현재값은 센서가 정상일 때만. 끊김·미설치는 숫자 대신 상태 문구 (마지막 값을 현재처럼 보이지 않게)
  const reading = binReading(bin);
  const level = fillLevel(reading.percent);
  const warn = binWarning(bin);
  const sensorBad = bin.sensor_status !== null && bin.sensor_status !== 'normal';
  return (
    <article className="bincell" data-testid={`bin-card-${bin.bin_id}`} data-level={level} aria-labelledby={`bincell-${bin.bin_id}`}>
      <header className="bincell__head">
        <MaterialCode type={bin.waste_type} />
        <Link to={`/bins/${bin.bin_id}`} className="bincell__name" id={`bincell-${bin.bin_id}`}>
          {WASTE_LABELS[bin.waste_type]}
        </Link>
      </header>
      <div className="bincell__figure">
        <MaterialColumn type={bin.waste_type} percent={reading.percent} calibrated={bin.calibrated || reading.percent !== null} size="md" />
      </div>
      <div className="bincell__readout">
        <FillReadout percent={reading.percent} calibrated={bin.calibrated || reading.percent !== null} />
        <span className="bincell__level" data-tone={reading.state === 'live' ? LEVEL_TONE[level] : reading.state === 'no_sensor' ? 'unknown' : 'critical'}>
          {reading.state === 'live' ? levelLabel(reading.percent, true) : reading.label}
          {reading.lastPercent !== null && reading.state !== 'live' ? ` · 마지막 ${reading.lastPercent.toFixed(1)}%` : ''}
        </span>
      </div>
      <p className="bincell__warn" data-tone={warn?.tone ?? 'none'} aria-live="polite">
        {warn ? warn.text : ' '}
      </p>
      <dl className="bincell__rows">
        <div>
          <dt>거리</dt>
          <dd className="num">{formatDistance(bin.current_distance_cm)}</dd>
        </div>
        <div>
          <dt>센서</dt>
          <dd data-testid="sensor-status" className={sensorBad ? 'is-bad' : ''}>
            {bin.sensor_status ? SENSOR_STATUS_LABELS[bin.sensor_status] : '--'}
          </dd>
        </div>
        <div>
          <dt>측정</dt>
          <dd className="num" title={formatTime(bin.last_valid_at)}>
            {formatRelative(bin.last_valid_at, now)}
          </dd>
        </div>
      </dl>
    </article>
  );
}

const ALERT_TONE: Record<AlertSeverity, Tone> = { critical: 'critical', warning: 'warning', info: 'unknown' };

/** 알림 → 관련 화면 */
export function alertLink(a: Alert): string {
  switch (a.kind) {
    case 'bin_full':
    case 'bin_warning':
    case 'sensor_error':
    case 'uncalibrated':
      return a.bin_id ? `/bins/${a.bin_id}` : '/bins';
    case 'estop':
    case 'command_failed':
      return '/operations';
    case 'sorting_failed':
      return '/sorting?outcome=SORT_FAILED';
    default:
      return '/devices';
  }
}

/** 점검 필요 — shared deriveAlerts() 결과 그대로 (심각도 순) */
export function AlertList({ alerts, limit = 6 }: { alerts: Alert[]; limit?: number }) {
  if (!alerts.length) return <p className="attn-empty">점검할 항목 없음</p>;
  return (
    <ul className="attn" aria-label="점검 필요">
      {alerts.slice(0, limit).map((a) => (
        <li key={a.id} className="attn__item" data-tone={ALERT_TONE[a.severity]} data-testid={`alert-${a.kind}`}>
          <span className="attn__bar" aria-hidden />
          <span className="attn__body">
            <span className="attn__kind">{ALERT_KIND_LABELS[a.kind]}</span>
            <Link to={alertLink(a)}>{a.title}</Link>
            {a.detail && <span className="attn__detail">{a.detail}</span>}
          </span>
        </li>
      ))}
      {alerts.length > limit && <li className="attn__more">외 {alerts.length - limit}건</li>}
    </ul>
  );
}

