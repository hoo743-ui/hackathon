import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { ALERT_GROUP, ALERT_GROUP_ICON, alertTarget } from '../services/alertsView';
import { formatRelative } from '../services/format';
import { ALERT_KIND_LABELS, SENSOR_STATUS_LABELS, WASTE_LABELS, type Alert, type SensorStatus } from '../services/shared';
import { useTheme } from '../theme/useTheme';
import { MaterialCode } from './MaterialCode';
import type { IconName } from './primitives';

/** 알림 한 줄. 종류 라벨(ALERT_KIND_LABELS) + 종류별 아이콘으로 장치 오프라인 / 센서 오류 / 분류 실패를 구분. 탭 → 관련 화면. */
export function AlertRow({ alert, now, last }: { alert: Alert; now: number; last?: boolean }) {
  const { c, t, space } = useTheme();
  const router = useRouter();
  const color = alert.severity === 'critical' ? c.critical : alert.severity === 'warning' ? c.warning : c.ink2;
  const group = ALERT_GROUP[alert.kind];
  const bin = alert.bin_id;
  // 센서 상태 코드는 라벨로 (shared 는 원시 sensor_status 를 detail 로 넘김)
  const detail = alert.kind === 'sensor_error' && alert.detail && alert.detail in SENSOR_STATUS_LABELS ? SENSOR_STATUS_LABELS[alert.detail as SensorStatus] : alert.detail;
  const materialFromTitle = (Object.keys(WASTE_LABELS) as (keyof typeof WASTE_LABELS)[]).find((w) => alert.title.startsWith(WASTE_LABELS[w]));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${ALERT_KIND_LABELS[alert.kind]}: ${alert.title}${detail ? `, ${detail}` : ''}. 관련 화면 열기`}
      onPress={() => router.push(alertTarget(alert))}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.s3,
        paddingVertical: space.s3,
        minHeight: 60,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.rule,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View style={{ width: 3, alignSelf: 'stretch', backgroundColor: color }} />
      <View style={{ width: 28, alignItems: 'center' }}>
        {bin && materialFromTitle && group !== 'sensor' ? (
          <MaterialCode type={materialFromTitle} size="sm" />
        ) : (
          <Ionicons name={ALERT_GROUP_ICON[group] as IconName} size={22} color={color} />
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={[t.label, { color }]}>{ALERT_KIND_LABELS[alert.kind]}</Text>
        <Text style={[t.bodyStrong, { color: c.ink }]}>{alert.title}</Text>
        {detail || alert.at ? (
          <Text style={[t.caption, { color: c.ink2 }]} numberOfLines={2}>
            {[detail, alert.at ? formatRelative(alert.at, now) : null].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={c.ink3} />
    </Pressable>
  );
}
