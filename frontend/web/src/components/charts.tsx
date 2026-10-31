import { CartesianGrid, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';
import type { TooltipProps } from 'recharts';
import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { FILL_THRESHOLDS, WASTE_LABELS } from '@shared';
import type { WasteType } from '@shared';
import { formatAxisTime, formatFill, formatTooltipTime } from '../lib/format';
import { MATERIAL_COLOR, MaterialCode } from './material';

export interface SeriesDef {
  key: string;
  type: WasteType;
  label?: string;
}

const THRESHOLD_LINES = [
  { y: FILL_THRESHOLDS.attention, label: '주의', color: 'var(--attention)' },
  { y: FILL_THRESHOLDS.warning, label: '경고', color: 'var(--warning)' },
  { y: FILL_THRESHOLDS.critical, label: '위험', color: 'var(--critical)' },
];

const AXIS_TICK = { fill: 'var(--ink-3)', fontSize: 12, fontFamily: 'var(--font-mono)' };
const Y_TICKS = [0, 25, 50, 75, 100];

/** 재질 코드 범례 (차트 위, HTML) */
export function ChartLegend({ series, extra }: { series: SeriesDef[]; extra?: ReactNode }) {
  return (
    <ul className="chart-legend" aria-label="범례">
      {series.map((s) => (
        <li key={s.key}>
          <span className="chart-legend__swatch" style={{ background: MATERIAL_COLOR[s.type] }} aria-hidden />
          <MaterialCode type={s.type} size="sm" />
          <span>{s.label ?? WASTE_LABELS[s.type]}</span>
        </li>
      ))}
      {extra}
    </ul>
  );
}

function TrendTooltip({ active, payload, label, series }: TooltipProps<number, string> & { series: SeriesDef[] }) {
  if (!active || label === undefined) return null;
  const row = (payload?.[0]?.payload ?? {}) as Record<string, number | null>;
  return (
    <div className="chart-tip">
      <p className="chart-tip__time t-mono">{formatTooltipTime(Number(label))}</p>
      <ul>
        {series.map((s) => (
          <li key={s.key}>
            <MaterialCode type={s.type} size="sm" />
            <span className="chart-tip__val num">{row[s.key] === null || row[s.key] === undefined ? '측정 없음' : formatFill(row[s.key])}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 앞뒤 값이 없는 고립된 점은 선이 그려지지 않으므로 점으로 표시한다 */
function isolatedDot(dataKey: string, data: Record<string, number | null>[], color: string) {
  return (props: { cx?: number; cy?: number; index?: number }) => {
    const i = props.index ?? 0;
    const v = data[i]?.[dataKey];
    const prev = data[i - 1]?.[dataKey];
    const next = data[i + 1]?.[dataKey];
    if (v === null || v === undefined || props.cx === undefined || props.cy === undefined) return <g key={`d${i}`} />;
    if ((prev === null || prev === undefined) && (next === null || next === undefined)) {
      return <circle key={`d${i}`} cx={props.cx} cy={props.cy} r={2.5} fill={color} />;
    }
    return <g key={`d${i}`} />;
  };
}

/**
 * 컨테이너 폭 측정. ResponsiveContainer 는 크기 변경 후 이전 폭의 선 경로가 남는 경우가 있어
 * 직접 측정한 폭으로 차트를 다시 만든다 (key=폭).
 */
function useWidth<T extends HTMLElement>(): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setW(Math.floor(el.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/**
 * 적재율 추이 (기록 데이터). 재질색 선 + 50/80/95 임계선, 빈 구간은 선이 끊긴다(connectNulls=false).
 */
export function TrendChart({
  rows,
  series,
  spanHours,
  height = 280,
  errorTimes = [],
  ariaLabel,
}: {
  rows: ({ t: number } & Record<string, number | null>)[];
  series: SeriesDef[];
  spanHours: number;
  height?: number;
  /** 오류 측정 시각 — 차트 하단에 붉은 틱 */
  errorTimes?: number[];
  ariaLabel: string;
}) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  // jsdom 등 레이아웃이 없는 환경은 고정 폭으로 그린다
  const width = measured > 0 ? measured : 800;
  return (
    <div className="chart" role="img" aria-label={ariaLabel} ref={ref} style={{ height }}>
        <LineChart key={width} width={width} height={height} data={rows} margin={{ top: 8, right: 48, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--rule)" strokeDasharray="0" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={rows.length ? [rows[0].t, rows[rows.length - 1].t] : ['dataMin', 'dataMax']}
            allowDataOverflow
            tickFormatter={(v: number) => formatAxisTime(v, spanHours)}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: 'var(--rule-strong)' }}
            minTickGap={36}
          />
          <YAxis
            domain={[0, 100]}
            ticks={Y_TICKS}
            tickFormatter={(v: number) => `${v}%`}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          {THRESHOLD_LINES.map((l) => (
            <ReferenceLine
              key={l.y}
              y={l.y}
              stroke={l.color}
              strokeDasharray="4 4"
              ifOverflow="extendDomain"
              label={{ value: `${l.label} ${l.y}`, position: 'right', fill: l.color, fontSize: 11 }}
            />
          ))}
          {errorTimes.map((t) => (
            <ReferenceLine
              key={`e${t}`}
              segment={[
                { x: t, y: 0 },
                { x: t, y: 5 },
              ]}
              stroke="var(--critical)"
              strokeWidth={2}
            />
          ))}
          <Tooltip
            content={<TrendTooltip series={series} />}
            cursor={{ stroke: 'var(--ink-3)', strokeWidth: 1 }}
            isAnimationActive={false}
          />
          {series.map((s) => (
            <Line
              key={s.key}
              type="linear"
              dataKey={s.key}
              name={s.label ?? WASTE_LABELS[s.type]}
              stroke={MATERIAL_COLOR[s.type]}
              strokeWidth={2}
              dot={isolatedDot(s.key, rows, MATERIAL_COLOR[s.type])}
              activeDot={{ r: 3.5, strokeWidth: 0, fill: MATERIAL_COLOR[s.type] }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
    </div>
  );
}

/** 24시간 스파크라인 (SVG). 빈 구간은 끊김, 0–100 고정 축 */
export function Sparkline({ values, type, width = 112, height = 28, label }: { values: (number | null)[]; type: WasteType; width?: number; height?: number; label: string }) {
  const n = values.length;
  const present = values.filter((v) => v !== null).length;
  if (n < 2 || present < 2) {
    return (
      <span className="spark spark--empty" style={{ width }} aria-label={`${label}: 데이터 부족`}>
        데이터 부족
      </span>
    );
  }
  const x = (i: number) => (i / (n - 1)) * (width - 2) + 1;
  const y = (v: number) => height - 1 - (Math.min(100, Math.max(0, v)) / 100) * (height - 2);
  const segments: string[] = [];
  let cur: string[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (cur.length) segments.push(cur.join(' '));
      cur = [];
    } else cur.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  });
  if (cur.length) segments.push(cur.join(' '));
  const yWarn = y(FILL_THRESHOLDS.warning);
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <line x1={0} x2={width} y1={yWarn} y2={yWarn} stroke="var(--warning)" strokeDasharray="2 3" strokeWidth={1} opacity={0.6} />
      <line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} stroke="var(--rule)" strokeWidth={1} />
      {segments.map((pts, i) =>
        pts.includes(' ') ? (
          <polyline key={i} points={pts} fill="none" stroke={MATERIAL_COLOR[type]} strokeWidth={1.5} strokeLinejoin="round" />
        ) : (
          <circle key={i} cx={pts.split(',')[0]} cy={pts.split(',')[1]} r={1.5} fill={MATERIAL_COLOR[type]} />
        ),
      )}
    </svg>
  );
}
