import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { Button } from './primitives';

/**
 * 화면 하단 고정 긴급 정지 바 (엄지 영역, 탭 바 바로 위).
 * 한 번 탭 = 즉시 EMERGENCY_STOP (안전 방향이므로 확인 없음). 활성 중에는 상태 + 해제(확인 필요).
 */
export function EStopBar({
  active,
  sending,
  resetting,
  onStop,
  onReset,
  resetDisabledReason,
}: {
  active: boolean;
  sending: boolean;
  resetting: boolean;
  onStop: () => void;
  onReset: () => void;
  resetDisabledReason?: string | null;
}) {
  const { c, t, space, radius } = useTheme();
  return (
    <View style={{ paddingHorizontal: space.s4, paddingTop: space.s2, paddingBottom: space.s2, backgroundColor: c.bg, borderTopWidth: 1, borderTopColor: c.rule }}>
      {active ? (
        <View
          accessibilityRole="alert"
          style={{ minHeight: 64, borderRadius: radius.estop, borderWidth: 2, borderColor: c.critical, flexDirection: 'row', alignItems: 'center', paddingLeft: space.s3, paddingRight: space.s2, gap: space.s3 }}
        >
          <Ionicons name="hand-left" size={22} color={c.critical} />
          <View style={{ flex: 1 }}>
            <Text style={[t.bodyStrong, { color: c.critical }]}>긴급 정지 중</Text>
            <Text style={[t.caption, { color: c.ink2 }]} numberOfLines={2}>
              {resetDisabledReason ?? '모든 모터 명령이 차단됩니다'}
            </Text>
          </View>
          <Button label="해제…" icon="lock-open-outline" onPress={onReset} busy={resetting} disabled={!!resetDisabledReason} compact />
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="긴급 정지"
          accessibilityHint="한 번 누르면 확인 없이 장치의 모든 동작을 즉시 정지합니다"
          accessibilityState={{ busy: sending }}
          disabled={sending}
          onPress={onStop}
          style={({ pressed }) => ({
            minHeight: 64,
            borderRadius: radius.estop,
            backgroundColor: c.critical,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: space.s3,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          {sending ? <ActivityIndicator color={c.onCritical} /> : <Ionicons name="hand-left" size={24} color={c.onCritical} />}
          <Text style={[t.title, { color: c.onCritical }]}>{sending ? '정지 명령 전송 중…' : '긴급 정지'}</Text>
        </Pressable>
      )}
    </View>
  );
}
