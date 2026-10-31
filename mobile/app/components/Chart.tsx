import React, { useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Line, Polyline, Circle } from 'react-native-svg';
import { buildSegments, timeTicks, type Point } from '../services/chart';
import { formatHHmm } from '../services/format';
import { FILL_THRESHOLDS } from '../services/shared';
import { useTheme } from '../theme/useTheme';

export interface Series {
  key: string;
  color: string;
  points: Point[];
}

const PAD = { left: 28, right: 6, top: 8, bottom: 22 };
const Y_TICKS = [0, FILL_THRESHOLDS.attention, FILL_THRESHOLDS.warning, FILL_THRESHOLDS.critical];

/**
 * 적재율 선 차트 (0–100%). 임계선 50/80/95, 시각 축 HH:mm.
 * null·긴 공백은 선을 끊는다. errorTimes 는 하단의 붉은 틱(센서 오류 측정).
 */
export function FillLineChart({
  series,
  t0,
  t1,
  maxGapMs,
  errorTimes = [],
  height = 180,
  accessibilityLabel,
}: {
  series: Series[];
  t0: number;
  t1: number;
  maxGapMs: number;
  errorTimes?: number[];
  height?: number;
  accessibilityLabel: string;
}) {
  const { c, t } = useTheme();
  const [width, setWidth] = useState(0);
  const w = Math.max(0, width - PAD.left - PAD.right);
  const h = height - PAD.top - PAD.bottom;
  const span = Math.max(1, t1 - t0);
  const x = (tm: number) => PAD.left + ((tm - t0) / span) * w;
  const y = (v: number) => PAD.top + h - (Math.max(0, Math.min(100, v)) / 100) * h;
  const ticks = timeTicks(t0, t1, width > 320 ? 4 : 3);

  return (
    <View accessible accessibilityLabel={accessibilityLabel} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height }}>
      {width > 0 ? (
        <>
          <Svg width={width} height={height}>
            {/* 기준선 0 + 임계선 */}
            {Y_TICKS.map((v) => (
              <Line
                key={v}
                x1={PAD.left}
                x2={PAD.left + w}
                y1={y(v)}
                y2={y(v)}
                stroke={v === 0 ? c.ink2 : v === FILL_THRESHOLDS.critical ? c.critical : v === FILL_THRESHOLDS.warning ? c.warning : c.rule}
                strokeWidth={1}
                strokeDasharray={v === 0 ? undefined : '3 3'}
                opacity={v === 0 ? 1 : 0.8}
              />
            ))}
            {series.flatMap((s) =>
              buildSegments(s.points, maxGapMs).map((seg, i) =>
                seg.length === 1 ? (
                  <Circle key={`${s.key}-${i}`} cx={x(seg[0].t)} cy={y(seg[0].v)} r={2} fill={s.color} />
                ) : (
                  <Polyline
                    key={`${s.key}-${i}`}
                    points={seg.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ),
              ),
            )}
            {errorTimes.map((tm, i) => (
              <Line key={`e${i}`} x1={x(tm)} x2={x(tm)} y1={PAD.top + h - 6} y2={PAD.top + h} stroke={c.critical} strokeWidth={2} />
            ))}
          </Svg>
          {Y_TICKS.map((v) => (
            <Text key={v} style={[t.caption, t.tabular, { position: 'absolute', left: 0, width: PAD.left - 4, textAlign: 'right', top: y(v) - 8, color: c.ink3 }]}>
              {v}
            </Text>
          ))}
          {ticks.map((tm, i) => (
            <Text
              key={i}
              style={[
                t.caption,
                t.tabular,
                {
                  position: 'absolute',
                  top: height - PAD.bottom + 4,
                  color: c.ink3,
                  ...(i === 0 ? { left: PAD.left } : i === ticks.length - 1 ? { right: PAD.right } : { left: x(tm) - 18, width: 36, textAlign: 'center' as const }),
                },
              ]}
            >
              {formatHHmm(tm)}
            </Text>
          ))}
        </>
      ) : null}
    </View>
  );
}

/** 24시간 스파크라인 (축 없음). 재질색 선, 공백은 끊김. 점이 없으면 점선 기준선만. */
export function Sparkline({ points, color, width = 72, height = 22, maxGapMs }: { points: Point[]; color: string; width?: number; height?: number; maxGapMs: number }) {
  const { c } = useTheme();
  const valid = points.filter((p) => p.v !== null);
  if (valid.length === 0) {
    return (
      <Svg width={width} height={height}>
        <Line x1={0} x2={width} y1={height - 1} y2={height - 1} stroke={c.rule} strokeDasharray="2 3" />
      </Svg>
    );
  }
  const ts = points.map((p) => p.t);
  const t0 = Math.min(...ts);
  const t1 = Math.max(...ts);
  const span = Math.max(1, t1 - t0);
  const x = (tm: number) => (t1 === t0 ? width / 2 : ((tm - t0) / span) * (width - 2) + 1);
  const y = (v: number) => height - 1 - (Math.max(0, Math.min(100, v)) / 100) * (height - 2);
  return (
    <Svg width={width} height={height}>
      <Line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} stroke={c.rule} />
      {buildSegments(points, maxGapMs).map((seg, i) =>
        seg.length === 1 ? (
          <Circle key={i} cx={x(seg[0].t)} cy={y(seg[0].v)} r={1.5} fill={color} />
        ) : (
          <Polyline key={i} points={seg.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')} fill="none" stroke={color} strokeWidth={1.5} />
        ),
      )}
    </Svg>
  );
}
