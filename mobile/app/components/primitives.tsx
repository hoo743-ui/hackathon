import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { touchTarget } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** 화면 제목 (display). 탭 화면은 내비 헤더 대신 이것을 쓴다 — 상단 safe-area 포함. */
export function ScreenHeader({ title, right, sub }: { title: string; right?: React.ReactNode; sub?: React.ReactNode }) {
  const { c, t, space } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top + space.s4, paddingHorizontal: space.s4, paddingBottom: space.s3, backgroundColor: c.bg, gap: space.s1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s3, minHeight: 36 }}>
        <Text accessibilityRole="header" style={[t.display, { color: c.ink, flexShrink: 1 }]} numberOfLines={1}>
          {title}
        </Text>
        {right}
      </View>
      {sub}
    </View>
  );
}

/** Ledger 섹션: 상단 2px 잉크 괘선 + 제목. 카드 테두리 없음. */
export function Section({
  title,
  right,
  children,
  style,
  gap,
}: {
  title: string;
  right?: React.ReactNode;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  gap?: number;
}) {
  const { c, t, space, ruleWidth } = useTheme();
  return (
    <View style={[{ borderTopWidth: ruleWidth.section, borderTopColor: c.ruleStrong, paddingTop: space.s2, gap: gap ?? space.s2 }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s3, minHeight: 28 }}>
        <Text accessibilityRole="header" style={[t.section, { color: c.ink, flexShrink: 1 }]}>
          {title}
        </Text>
        {right}
      </View>
      {children}
    </View>
  );
}

/** 정의 목록 행 (label · value). 1px 괘선. */
export function Field({
  label,
  value,
  mono,
  tone,
  last,
  stacked,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  tone?: string;
  last?: boolean;
  /** 긴 값(URL 등): 라벨 아래 줄에 값 */
  stacked?: boolean;
}) {
  const { c, t, space } = useTheme();
  if (stacked) {
    return (
      <View style={{ minHeight: touchTarget, paddingVertical: space.s2, gap: 2, borderBottomWidth: last ? 0 : 1, borderBottomColor: c.rule }}>
        <Text style={[t.label, { color: c.ink2 }]}>{label}</Text>
        <Text selectable style={[mono ? t.mono : t.body, { color: tone ?? c.ink }, { wordBreak: 'break-all' } as object]}>
          {value}
        </Text>
      </View>
    );
  }
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        minHeight: touchTarget,
        paddingVertical: space.s2,
        gap: space.s3,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.rule,
      }}
    >
      <Text style={[t.body, { color: c.ink2 }]}>{label}</Text>
      {typeof value === 'string' || typeof value === 'number' ? (
        <Text selectable style={[mono ? t.mono : t.body, t.tabular, { color: tone ?? c.ink, flexShrink: 1, textAlign: 'right' }]}>
          {value}
        </Text>
      ) : (
        <View style={{ flexShrink: 1, alignItems: 'flex-end' }}>{value}</View>
      )}
    </View>
  );
}

export type ButtonVariant = 'primary' | 'signal' | 'danger' | 'quiet';

export function Button({
  label,
  onPress,
  variant = 'quiet',
  disabled,
  busy,
  icon,
  accessibilityHint,
  style,
  compact,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  busy?: boolean;
  icon?: IconName;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
}) {
  const { c, t, radius, space } = useTheme();
  const palette = {
    primary: { bg: c.ink, fg: c.bg, border: c.ink },
    signal: { bg: c.signal, fg: c.onSignal, border: c.signal },
    danger: { bg: c.critical, fg: c.onCritical, border: c.critical },
    quiet: { bg: 'transparent', fg: c.ink, border: c.ink2 },
  }[variant];
  const inactive = !!(disabled || busy);
  const fg = inactive ? c.ink3 : palette.fg;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: !!busy }}
      disabled={inactive}
      onPress={onPress}
      hitSlop={compact ? 4 : 0}
      style={({ pressed }) => [
        {
          minHeight: touchTarget,
          minWidth: touchTarget,
          borderRadius: radius.chip,
          borderWidth: 1,
          borderColor: inactive ? c.rule : palette.border,
          backgroundColor: inactive ? c.surfaceSunken : palette.bg,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: space.s2,
          paddingHorizontal: compact ? space.s3 : space.s4,
          opacity: pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={c.ink3} /> : icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
      <Text style={[t.bodyStrong, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

/** 세그먼트 컨트롤 (2–4개). 선택 = 잉크 바탕. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
  accessibilityLabel,
  busyValue,
}: {
  options: SegmentOption<T>[];
  value: T | null;
  onChange: (v: T) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  busyValue?: T | null;
}) {
  const { c, t, radius } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={{ flexDirection: 'row', borderWidth: 1, borderColor: c.ink2, borderRadius: radius.chip, overflow: 'hidden' }}
    >
      {options.map((o, i) => {
        const selected = o.value === value;
        const busy = busyValue === o.value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityLabel={o.label}
            accessibilityState={{ selected, checked: selected, disabled: !!disabled }}
            disabled={disabled}
            onPress={() => !selected && onChange(o.value)}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: touchTarget + 4,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 6,
              backgroundColor: selected ? (disabled ? c.ink2 : c.ink) : pressed ? c.surfaceSunken : c.surface,
              borderLeftWidth: i === 0 ? 0 : 1,
              borderLeftColor: c.ink2,
            })}
          >
            {busy ? <ActivityIndicator size="small" color={selected ? c.bg : c.ink3} /> : null}
            <Text style={[selected ? t.bodyStrong : t.body, { color: selected ? c.bg : disabled ? c.ink3 : c.ink }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** 필터 칩 (가로 스크롤 줄 안에서 사용) */
export function FilterChip({ label, selected, onPress, leading }: { label: string; selected: boolean; onPress: () => void; leading?: React.ReactNode }) {
  const { c, t, radius, space } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: touchTarget,
        paddingHorizontal: space.s3,
        borderRadius: radius.chip,
        borderWidth: 1,
        borderColor: selected ? c.ink : c.rule,
        backgroundColor: selected ? c.ink : pressed ? c.surfaceSunken : c.surface,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
      })}
    >
      {leading}
      <Text style={[t.label, { color: selected ? c.bg : c.ink }]}>{label}</Text>
    </Pressable>
  );
}

export function ChipRow({ children }: { children: React.ReactNode }) {
  const { space } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -space.s4, flexGrow: 0 }}
      contentContainerStyle={{ paddingHorizontal: space.s4, gap: space.s2 }}
    >
      {children}
    </ScrollView>
  );
}

export function StatusDot({ color, size = 8 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

/** 비활성 사유·안내 한 줄 */
export function Hint({ text, tone = 'muted', icon }: { text: string | null | undefined; tone?: 'muted' | 'warning' | 'critical' | 'ok'; icon?: IconName }) {
  const { c, t } = useTheme();
  if (!text) return null;
  const color = tone === 'critical' ? c.critical : tone === 'warning' ? c.warning : tone === 'ok' ? c.ok : c.ink2;
  const name: IconName = icon ?? (tone === 'muted' ? 'information-circle-outline' : tone === 'ok' ? 'checkmark-circle-outline' : 'alert-circle-outline');
  return (
    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }} accessibilityLiveRegion="polite">
      <Ionicons name={name} size={16} color={color} style={{ marginTop: 1 }} />
      <Text style={[t.label, { color, flex: 1 }]}>{text}</Text>
    </View>
  );
}

/** 시뮬레이터 데이터 표시 — 오렌지 점선 테두리 태그 (대문자 금지) */
export function DataSourceTag({ simulated }: { simulated: boolean }) {
  const { c, t, radius } = useTheme();
  if (!simulated) return null;
  return (
    <View
      accessible
      accessibilityLabel="시뮬레이터 데이터 — 실제 장치가 아닌 시뮬레이터가 보낸 값입니다"
      style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: c.warning, borderRadius: radius.chip, paddingHorizontal: 6, paddingVertical: 2 }}
    >
      <Text style={[t.label, { color: c.warning }]} numberOfLines={1}>
        시뮬레이터 데이터
      </Text>
    </View>
  );
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { c, t, space } = useTheme();
  return (
    <View accessibilityRole="alert" style={{ borderLeftWidth: 3, borderLeftColor: c.critical, paddingLeft: space.s3, paddingVertical: space.s1, gap: space.s2 }}>
      <View style={{ flexDirection: 'row', gap: space.s2, alignItems: 'flex-start' }}>
        <Ionicons name="cloud-offline-outline" size={18} color={c.critical} style={{ marginTop: 2 }} />
        <Text style={[t.body, { color: c.ink, flex: 1 }]}>{message}</Text>
      </View>
      {onRetry ? <Button label="다시 시도" icon="refresh" onPress={onRetry} compact style={{ alignSelf: 'flex-start' }} /> : null}
    </View>
  );
}

export function Loading({ label = '불러오는 중…' }: { label?: string }) {
  const { c, t, space } = useTheme();
  return (
    <View style={{ paddingVertical: space.s6, alignItems: 'center', gap: space.s2 }} accessibilityLiveRegion="polite">
      <ActivityIndicator color={c.ink2} />
      <Text style={[t.body, { color: c.ink2 }]}>{label}</Text>
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  const { c, t, space } = useTheme();
  return <Text style={[t.body, { color: c.ink2, paddingVertical: space.s3 }]}>{text}</Text>;
}
