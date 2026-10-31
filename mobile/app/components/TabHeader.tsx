import React from 'react';
import { Text, View } from 'react-native';
import { isSimulated } from '../services/dataSource';
import { useDashboard } from '../services/DashboardContext';
import { useTheme } from '../theme/useTheme';
import { DataSourceTag, ScreenHeader, StatusDot } from './primitives';

/** 탭 화면 공통 머리: 제목 + (시뮬레이터면) 데이터 출처 태그 + (끊겼으면) 실시간 상태 */
export function TabHeader({ title, sub, action }: { title: string; sub?: React.ReactNode; action?: React.ReactNode }) {
  const { dashboard, wsState } = useDashboard();
  const { c, t, space } = useTheme();
  const simulated = isSimulated(dashboard);
  return (
    <ScreenHeader
      title={title}
      sub={sub}
      right={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s2, flexShrink: 0 }}>
          {wsState !== 'open' ? (
            <View accessible accessibilityLabel={wsState === 'connecting' ? '실시간 연결 중' : '실시간 끊김'} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <StatusDot color={wsState === 'connecting' ? c.attention : c.critical} />
              <Text style={[t.label, { color: c.ink2 }]}>{wsState === 'connecting' ? '연결 중' : '끊김'}</Text>
            </View>
          ) : null}
          <DataSourceTag simulated={simulated} />
          {action}
        </View>
      }
    />
  );
}
