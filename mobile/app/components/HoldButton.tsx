import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, Text, View } from 'react-native';
import { HOLD_MS, holdOutcome } from '../services/controlRules';
import { fillReadout } from '../services/format';
import { WASTE_LABELS, type WasteType } from '../services/shared';
import { useTheme } from '../theme/useTheme';
import { MaterialCode } from './MaterialCode';

/**
 * 배출구 작동 버튼 — 0.6초 길게 눌러야 작동 (주머니·장갑 오조작 방지).
 * 누르는 동안 시그널 오렌지 진행 막대가 차오르고, 손을 떼면 취소. 차단 사유가 있으면 onBlocked.
 * 화면 낭독기 사용자는 accessibility action(두 번 탭)으로 작동한다.
 */
export function HoldButton({
  type,
  percent,
  blockReason,
  busy,
  onActivate,
  onBlocked,
}: {
  type: WasteType;
  percent: number | null;
  blockReason: string | null;
  busy?: boolean;
  onActivate: () => void;
  onBlocked: (reason: string) => void;
}) {
  const { c, t, space, radius, reduceMotion } = useTheme();
  const progress = useRef(new Animated.Value(0)).current;
  const [holding, setHolding] = useState(false);
  const startRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);
  const reasonRef = useRef(blockReason);
  reasonRef.current = blockReason;
  const activateRef = useRef(onActivate);
  activateRef.current = onActivate;

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const disabled = !!blockReason || !!busy;
  const fill = fillReadout(percent);

  const reset = () => {
    progress.stopAnimation();
    if (reduceMotion) progress.setValue(0);
    else Animated.timing(progress, { toValue: 0, duration: 150, useNativeDriver: false }).start();
  };

  const onPressIn = () => {
    if (busy) return;
    if (reasonRef.current) {
      onBlocked(reasonRef.current);
      return;
    }
    firedRef.current = false;
    startRef.current = Date.now();
    setHolding(true);
    progress.setValue(0);
    if (!reduceMotion) Animated.timing(progress, { toValue: 1, duration: HOLD_MS, easing: Easing.linear, useNativeDriver: false }).start();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (holdOutcome(Date.now() - startRef.current, reasonRef.current) === 'activate') {
        firedRef.current = true;
        progress.setValue(1);
        setHolding(false);
        activateRef.current();
        reset();
      }
    }, HOLD_MS);
  };

  const onPressOut = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setHolding(false);
    if (!firedRef.current) reset();
  };

  const width = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  const caption = busy ? '전송 중…' : holding ? (reduceMotion ? '계속 누르세요 (0.6초)' : '계속 누르세요') : disabled ? '사용 불가' : '길게 눌러 작동';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${WASTE_LABELS[type]} 배출구 작동`}
      accessibilityHint={blockReason ?? '0.6초 길게 누르면 작동합니다. 화면 낭독기에서는 두 번 탭하세요.'}
      accessibilityState={{ disabled, busy: !!busy }}
      accessibilityActions={[{ name: 'activate', label: '배출구 작동' }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName !== 'activate') return;
        if (blockReason) onBlocked(blockReason);
        else if (!busy) onActivate();
      }}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={{
        flex: 1,
        minHeight: 112,
        borderRadius: radius.panel,
        borderWidth: holding ? 2 : 1,
        borderColor: holding ? c.signal : disabled ? c.rule : c.ink2,
        backgroundColor: disabled ? c.surfaceSunken : c.surface,
        padding: space.s3,
        paddingBottom: space.s3 + 6,
        justifyContent: 'space-between',
        overflow: 'hidden',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s2 }}>
        <View style={{ opacity: disabled ? 0.45 : 1 }}>
          <MaterialCode type={type} />
        </View>
        <Text style={[t.bodyStrong, { color: disabled ? c.ink3 : c.ink, flex: 1 }]} numberOfLines={1}>
          {WASTE_LABELS[type]}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.s2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 }}>
          {disabled ? null : <Ionicons name="arrow-down-circle" size={16} color={c.signal} />}
          <Text style={[t.label, { color: holding ? c.signal : disabled ? c.ink3 : c.ink2, flexShrink: 1 }]} numberOfLines={1}>
            {caption}
          </Text>
        </View>
        {busy ? (
          <ActivityIndicator size="small" color={c.ink3} />
        ) : (
          <Text style={[t.label, t.tabular, { color: disabled ? c.ink3 : c.ink2 }]}>{fill.value === '--' ? '미보정' : `${fill.value}%`}</Text>
        )}
      </View>
      {/* 길게 누르기 진행 막대 */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 6, backgroundColor: disabled ? 'transparent' : c.surfaceSunken }}>
        <Animated.View style={{ height: 6, width: reduceMotion ? (holding ? '100%' : '0%') : width, backgroundColor: c.signal }} />
      </View>
    </Pressable>
  );
}
