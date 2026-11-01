import React from 'react';
import { Text, View } from 'react-native';
import { formatRelative, formatTime } from '../services/format';
import { HEALTH_LABELS, type DeviceHealth, type Device, type HealthLevel, type RealtimeState } from '../services/shared';
import { useDashboard } from '../services/DashboardContext';
import { useTheme } from '../theme/useTheme';
import { StatusDot } from './primitives';

export const WS_LABELS: Record<RealtimeState, string> = { open: '실시간 연결', connecting: '실시간 연결 중…', closed: '실시간 끊김' };

export function useHealthColor() {
  const { c } = useTheme();
  return (level: HealthLevel) => (level === 'healthy' ? c.ok : level === 'degraded' ? c.warning : level === 'offline' ? c.critical : c.unknown);
}

/** 장치 건강 한 줄: ● 상태 · 장치 ID — 마지막 수신 (상대 + 절대) + 사유 목록 */
export function HealthLine({ device, health, wsState, now }: { device: Device | undefined; health: DeviceHealth; wsState: RealtimeState; now: number }) {
  const { c, t, space } = useTheme();
  const hardwareMode = useDashboard().dashboard?.hardware_mode;
  const color = useHealthColor()(health.level);
  const meta = [
    hardwareMode === 'EDGE_SERIAL' ? '카메라 컴퓨터 자동' : device ? (device.operating_mode === 'AUTO' ? '자동 모드' : '수동 모드') : null,
    `센서 ${health.sensorsOk}/${health.sensorsTotal}`,
    WS_LABELS[wsState],
  ].filter(Boolean);
  return (
    <View
      accessible
      accessibilityLabel={`장치 상태 ${HEALTH_LABELS[health.level]}. ${health.reasons.join(', ')}. 마지막 수신 ${formatRelative(device?.last_seen, now)}`}
      style={{ gap: space.s1 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s2, flexWrap: 'wrap' }}>
        <StatusDot color={color} size={10} />
        <Text style={[t.title, { color: c.ink }]}>{HEALTH_LABELS[health.level]}</Text>
        <Text style={[t.mono, { color: c.ink2 }]}>{device?.device_id ?? '장치 없음'}</Text>
        <View style={{ flexGrow: 1 }} />
        <Text style={[t.label, t.tabular, { color: c.ink2 }]}>
          수신 {formatRelative(device?.last_seen, now)}
          <Text style={[t.mono, { color: c.ink3, fontSize: 12 }]}> {formatTime(device?.last_seen)}</Text>
        </Text>
      </View>
      {health.reasons.map((r) => (
        <Text key={r} style={[t.bodyStrong, { color: health.level === 'offline' ? c.critical : c.warning }]}>
          {r}
        </Text>
      ))}
      <Text style={[t.label, { color: wsState === 'open' ? c.ink2 : c.warning }]}>{meta.join(' · ')}</Text>
    </View>
  );
}
