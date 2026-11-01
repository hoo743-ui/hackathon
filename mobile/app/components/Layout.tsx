import React from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { StatusDot } from './primitives';

/** 화면 본문 공통 여백·간격 (theme.layout) */
export function useScreenContent(extraBottom = 0): ViewStyle {
  const { layout } = useTheme();
  return { paddingHorizontal: layout.screenX, paddingTop: layout.screenTop, paddingBottom: layout.screenBottom + extraBottom, gap: layout.cardGap };
}

/** N열 격자. 자식을 순서대로 행에 채우고, 마지막 행의 빈 칸은 같은 폭의 자리로 남겨 열을 맞춘다 */
export function Grid({ columns = 2, children, gap }: { columns?: number; children: React.ReactNode; gap?: number }) {
  const { layout } = useTheme();
  const g = gap ?? layout.gridGap;
  const items = React.Children.toArray(children).filter(Boolean);
  const rows: React.ReactNode[][] = [];
  for (let i = 0; i < items.length; i += columns) rows.push(items.slice(i, i + columns));
  return (
    <View style={{ gap: g }}>
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row', gap: g }}>
          {row.map((child, i) => (
            <View key={i} style={{ flex: 1, minWidth: 0 }}>
              {child}
            </View>
          ))}
          {Array.from({ length: columns - row.length }).map((_, i) => (
            <View key={`pad-${i}`} style={{ flex: 1 }} />
          ))}
        </View>
      ))}
    </View>
  );
}

/** 카드 안의 작은 칸 (연한 바탕 · radius 12 · 안쪽 12) */
export function Tile({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c, radius, layout } = useTheme();
  return (
    <View style={[{ backgroundColor: c.surfaceSunken, borderRadius: radius.panel, padding: layout.tilePad, gap: 4, minHeight: 64 }, style]}>{children}</View>
  );
}

export type TileTone = 'ok' | 'warn' | 'bad' | 'off';

/** 상태 칸: 라벨 · (점 + 값) · 보조 설명. 색만으로 전달하지 않도록 값 문구를 항상 함께 표시 */
export function StatusTile({ label, value, detail, tone }: { label: string; value: string; detail?: string | null; tone: TileTone }) {
  const { c, t } = useTheme();
  const color = tone === 'ok' ? c.ok : tone === 'warn' ? c.attention : tone === 'bad' ? c.critical : c.unknown;
  return (
    <Tile>
      <Text style={[t.caption, { color: c.ink3 }]} numberOfLines={1}>
        {label}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <StatusDot color={color} />
        <Text style={[t.bodyStrong, { color: c.ink, flexShrink: 1 }]} numberOfLines={1}>
          {value}
        </Text>
      </View>
      {detail ? (
        <Text style={[t.caption, { color: c.ink2 }]} numberOfLines={1}>
          {detail}
        </Text>
      ) : null}
    </Tile>
  );
}
