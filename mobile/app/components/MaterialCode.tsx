import React from 'react';
import { Text, View } from 'react-native';
import { WASTE_CODES, WASTE_LABELS, type WasteType } from '../services/shared';
import { useTheme } from '../theme/useTheme';

/** 재질 코드 칩 — 재활용 표기처럼 정사각 (PL·CN·PA·GN). 재질색은 정체성 전용. */
export function MaterialCode({ type, size = 'md' }: { type: WasteType; size?: 'sm' | 'md' | 'lg' }) {
  const { c, t, radius, scheme } = useTheme();
  const dim = size === 'lg' ? 36 : size === 'md' ? 26 : 20;
  const fs = size === 'lg' ? 15 : size === 'md' ? 12 : 10;
  return (
    <View
      accessible
      accessibilityLabel={WASTE_LABELS[type]}
      style={{ width: dim, height: dim, borderRadius: radius.chip, backgroundColor: c.material[type], alignItems: 'center', justifyContent: 'center' }}
    >
      <Text style={[t.label, { fontSize: fs, lineHeight: fs + 2, color: scheme === 'dark' ? c.bg : '#FFFFFF', letterSpacing: 0.5 }]}>{WASTE_CODES[type]}</Text>
    </View>
  );
}
