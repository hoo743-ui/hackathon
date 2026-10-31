import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import { FILL_LEVEL_LABELS, FILL_THRESHOLDS, WASTE_LABELS, fillLevel, type WasteType } from '../services/shared';
import { useTheme } from '../theme/useTheme';

const THRESHOLDS = [FILL_THRESHOLDS.attention, FILL_THRESHOLDS.warning, FILL_THRESHOLDS.critical];

/** 사선 해치 (미보정·데이터 없음) */
function Hatch({ width, height, color }: { width: number; height: number; color: string }) {
  const lines = [];
  for (let x = -height; x < width; x += 6) {
    lines.push(<Line key={x} x1={x} y1={height} x2={x + height} y2={0} stroke={color} strokeWidth={1} />);
  }
  return (
    <Svg width={width} height={height} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
      {lines}
    </Svg>
  );
}

/**
 * Material Column — 수거함 단면. 바닥부터 채워지고 50/80/95 눈금.
 * 채움색 = 적재 단계색, 상단 캡 = 재질색. null 은 해치 + (호출부에서) "미보정", 절대 0% 아님.
 */
export function MaterialColumn({
  percent,
  type,
  width = 40,
  height = 120,
  tickLabels = false,
}: {
  percent: number | null;
  type: WasteType;
  width?: number;
  height?: number;
  tickLabels?: boolean;
}) {
  const { c, t, motion, reduceMotion } = useTheme();
  const level = fillLevel(percent);
  const cap = height >= 80 ? 4 : 3;
  const inner = height - cap - 2; // 상단 캡 + 테두리
  const clamped = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  const anim = useRef(new Animated.Value(clamped)).current;

  useEffect(() => {
    if (reduceMotion) {
      anim.setValue(clamped);
      return;
    }
    const a = Animated.timing(anim, { toValue: clamped, duration: motion.fill, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    a.start();
    return () => a.stop();
  }, [anim, clamped, reduceMotion, motion.fill]);

  const fillHeight = anim.interpolate({ inputRange: [0, 100], outputRange: [0, inner] });
  const label = `${WASTE_LABELS[type]} 적재율 ${percent === null ? '미보정' : `${Math.round(percent)}%`}, ${FILL_LEVEL_LABELS[level]}`;

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={percent === null ? { text: '미보정' } : { min: 0, max: 100, now: Math.round(clamped) }}
      style={{ flexDirection: 'row', alignItems: 'flex-end' }}
    >
      <View style={{ width, height, borderWidth: 1, borderColor: c.ink2, borderTopWidth: 0, backgroundColor: c.surfaceSunken }}>
        <View style={{ height: cap, backgroundColor: c.material[type], marginHorizontal: -1 }} />
        <View style={{ flex: 1, overflow: 'hidden' }}>
          {percent === null ? (
            <Hatch width={width - 2} height={inner} color={c.unknown} />
          ) : (
            <Animated.View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: fillHeight, backgroundColor: c.fill[level] }} />
          )}
          {THRESHOLDS.map((th) => (
            <View
              key={th}
              style={{ position: 'absolute', left: 0, right: 0, bottom: (inner * th) / 100, height: 1, backgroundColor: c.ink, opacity: th === FILL_THRESHOLDS.critical ? 0.55 : 0.3 }}
            />
          ))}
        </View>
      </View>
      {tickLabels ? (
        <View style={{ width: 24, height, marginLeft: 4 }}>
          {THRESHOLDS.map((th) => (
            <Text key={th} style={[t.caption, t.tabular, { position: 'absolute', left: 0, bottom: (inner * th) / 100 - 8, color: c.ink3 }]}>
              {th}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
