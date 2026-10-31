import React from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../theme/useTheme';

/** 판독값: 큰 tabular 숫자 + 작은 단위. 값이 없으면 "--" (0 아님). */
export function Readout({
  value,
  unit,
  size = 'md',
  color,
  accessibilityLabel,
}: {
  value: string;
  unit?: string;
  size?: 'xl' | 'md' | 'sm';
  color?: string;
  accessibilityLabel?: string;
}) {
  const { c, t } = useTheme();
  const style = size === 'xl' ? t.readoutXl : size === 'md' ? t.readout : { ...t.title, ...t.tabular };
  const fg = color ?? c.ink;
  return (
    <View accessible accessibilityLabel={accessibilityLabel ?? `${value}${unit ?? ''}`} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
      <Text style={[style, { color: value === '--' ? c.ink3 : fg }]}>{value}</Text>
      {unit ? <Text style={[t.unit, { color: c.ink2, fontSize: size === 'xl' ? 20 : 15 }]}>{unit}</Text> : null}
    </View>
  );
}
