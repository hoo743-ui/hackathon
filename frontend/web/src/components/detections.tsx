import { DETECTION_OUTCOME_LABELS, WASTE_LABELS, outcomeDetailLabel } from '@shared';
import type { Detection, DetectionOutcome, WasteType } from '@shared';
import { formatDateTime, formatTime } from '../lib/format';
import { MaterialCode } from './material';
import { EmptyState, StatusText } from './primitives';
import type { Tone } from './primitives';

export const OUTCOME_TONE: Record<DetectionOutcome, Tone> = {
  SORTING: 'accent',
  SORTED: 'ok',
  SORT_FAILED: 'critical',
  LOW_CONFIDENCE: 'attention',
  UNRECOGNIZED: 'warning',
  MANUAL_MODE: 'neutral',
  DEVICE_UNAVAILABLE: 'warning',
  SORT_SENT: 'attention',
  NO_HARDWARE: 'neutral',
};

export const isWasteType = (t: string): t is WasteType => t in WASTE_LABELS;

/** 모델이 낸 종류. 4개 분류면 재질 코드칩, 아니면 원시 값을 그대로 */
export function DetectionType({ type, withLabel = true }: { type: string; withLabel?: boolean }) {
  if (isWasteType(type)) return <MaterialCode type={type} size="sm" withLabel={withLabel} />;
  return (
    <span className="det-raw" title="4개 분류 외 값 (모델 출력 그대로)">
      <span className="t-mono">{type}</span>
    </span>
  );
}

/** 모델 출력 신뢰도 그대로 (소수 2자리, 가공 없음) */
export function Confidence({ value }: { value: number }) {
  return <span className="t-mono conf">{value.toFixed(2)}</span>;
}

export function OutcomeText({ outcome }: { outcome: DetectionOutcome | null }) {
  if (!outcome) return <span className="muted">기록 없음</span>;
  return <StatusText tone={OUTCOME_TONE[outcome] ?? 'neutral'}>{DETECTION_OUTCOME_LABELS[outcome] ?? outcome}</StatusText>;
}

/** outcome_detail: ACK 코드면 한국어 문구 + 원시 코드 */
export function OutcomeDetail({ detail }: { detail: string | null }) {
  const label = outcomeDetailLabel(detail);
  if (!detail || !label) return null;
  return label !== detail ? (
    <span className="cmd-err">
      {label} <code className="cmd-err__code t-mono">{detail}</code>
    </span>
  ) : (
    <span className="t-mono">{detail}</span>
  );
}

/** 개요용 최근 분류 (종류 · 신뢰도 · 처리 결과) */
export function RecentDetections({ items, limit = 8 }: { items: Detection[]; limit?: number }) {
  if (!items.length) return <EmptyState>아직 분류 기록 없음</EmptyState>;
  return (
    <ol className="dlog" aria-label="최근 분류">
      {items.slice(0, limit).map((d) => (
        <li key={d.id} className="dlog__item" data-testid={`detection-${d.id}`}>
          <time className="dlog__time t-mono" dateTime={d.detected_at} title={formatDateTime(d.detected_at)}>
            {formatTime(d.detected_at)}
          </time>
          <span className="dlog__type">
            <DetectionType type={d.waste_type} />
          </span>
          <Confidence value={d.confidence} />
          <span className="dlog__outcome">
            <OutcomeText outcome={d.outcome} />
          </span>
          {d.source === 'simulator' && <span className="dlog__src">시뮬레이터</span>}
        </li>
      ))}
    </ol>
  );
}
