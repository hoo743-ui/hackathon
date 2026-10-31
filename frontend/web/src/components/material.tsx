import { FILL_LEVEL_LABELS, FILL_THRESHOLDS, WASTE_CODES, WASTE_LABELS, fillLevel } from '@shared';
import type { FillLevel, WasteType } from '@shared';
import type { ReactNode } from 'react';
import { fillNumber, formatFill } from '../lib/format';
import type { Tone } from './primitives';

/** 적재 단계 → 상태 톤 (컬럼 채움색·텍스트) */
export const LEVEL_TONE: Record<FillLevel, Tone> = {
  unknown: 'unknown',
  normal: 'ok',
  attention: 'attention',
  warning: 'warning',
  critical: 'critical',
};

/** 재질색 CSS 변수 (정체성 전용: 코드칩·컬럼 캡·차트 선) */
export const MATERIAL_COLOR: Record<WasteType, string> = {
  plastic: 'var(--mat-plastic)',
  metal: 'var(--mat-metal)',
  paper: 'var(--mat-paper)',
  glass: 'var(--mat-glass)',
};

/** null 적재율의 이유를 구분해서 표시 (미보정 / 측정값 없음). 0% 로 표시하지 않는다. */
export function levelLabel(percent: number | null, calibrated = false): string {
  if (percent === null) return calibrated ? '측정값 없음' : FILL_LEVEL_LABELS.unknown;
  return FILL_LEVEL_LABELS[fillLevel(percent)];
}

/** 재질 코드 칩 — 재활용 표기처럼 정사각 코드 */
export function MaterialCode({ type, size = 'md', withLabel = false }: { type: WasteType; size?: 'sm' | 'md' | 'lg'; withLabel?: boolean }) {
  return (
    <span className={`mcode-wrap ${withLabel ? 'mcode-wrap--label' : ''}`}>
      <span className={`mcode mcode--${size}`} data-material={type} title={WASTE_LABELS[type]} aria-label={withLabel ? undefined : WASTE_LABELS[type]}>
        <span aria-hidden={withLabel || undefined}>{WASTE_CODES[type]}</span>
      </span>
      {withLabel && <span className="mcode-wrap__label">{WASTE_LABELS[type]}</span>}
    </span>
  );
}

/**
 * 재질 컬럼 — 수거함 단면도. 바닥부터 적재 단계색으로 채우고 50/80/95 눈금을 그린다.
 * null 은 사선 해치("미보정"/"측정값 없음")이며 절대 0% 로 그리지 않는다.
 */
export function MaterialColumn({
  type,
  percent,
  calibrated = true,
  size = 'md',
  ticks = true,
  label,
}: {
  type: WasteType;
  percent: number | null;
  calibrated?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  ticks?: boolean;
  label?: string;
}) {
  const level = fillLevel(percent);
  const clamped = percent === null ? 100 : Math.min(100, Math.max(0, percent));
  const valueText = percent === null ? `${levelLabel(percent, calibrated)} (값 없음)` : `${formatFill(percent)}, ${FILL_LEVEL_LABELS[level]}`;
  return (
    <div
      className={`mcol mcol--${size}`}
      data-level={level}
      data-material={type}
      role="meter"
      aria-label={label ?? `${WASTE_LABELS[type]} 적재율`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      aria-valuetext={valueText}
    >
      <span className="mcol__cap" aria-hidden />
      <span className="mcol__body" aria-hidden>
        <span className={`mcol__fill ${percent === null ? 'mcol__fill--unknown' : ''}`} style={{ height: `${clamped}%` }} />
        {ticks &&
          [FILL_THRESHOLDS.attention, FILL_THRESHOLDS.warning, FILL_THRESHOLDS.critical].map((t) => (
            <span key={t} className="mcol__tick" style={{ bottom: `${t}%` }} data-t={t}>
              {size === 'lg' || size === 'md' ? <span className="mcol__tick-label">{t}</span> : null}
            </span>
          ))}
      </span>
    </div>
  );
}

/** 판독값: 큰 tabular 숫자 + 작은 단위 */
export function Readout({
  value,
  unit,
  size = 'md',
  tone,
  label,
  testId,
}: {
  value: ReactNode;
  unit?: string;
  size?: 'xl' | 'md' | 'sm';
  tone?: Tone;
  label?: string;
  testId?: string;
}) {
  return (
    <span className={`readout readout--${size}`} data-tone={tone} aria-label={label} data-testid={testId}>
      <span className="readout__value">{value}</span>
      {unit && <span className="readout__unit">{unit}</span>}
    </span>
  );
}

/** 적재율 판독값. null → "--" + 사유 */
export function FillReadout({ percent, calibrated, size = 'md' }: { percent: number | null; calibrated: boolean; size?: 'xl' | 'md' | 'sm' }) {
  const level = fillLevel(percent);
  return (
    <Readout
      value={fillNumber(percent)}
      unit={percent === null ? undefined : '%'}
      size={size}
      tone={percent === null ? 'unknown' : undefined}
      label={percent === null ? `적재율 정보 없음 (${levelLabel(percent, calibrated)})` : `적재율 ${formatFill(percent)}, ${FILL_LEVEL_LABELS[level]}`}
      testId="fill-readout"
    />
  );
}
