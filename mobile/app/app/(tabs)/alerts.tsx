import React, { useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { AlertRow } from '../../components/AlertRow';
import { TabHeader } from '../../components/TabHeader';
import { Empty, ErrorNotice, Loading, Section } from '../../components/primitives';
import { severityCounts } from '../../services/alertsView';
import { useDashboard } from '../../services/DashboardContext';
import { deriveAlerts, type AlertSeverity } from '../../services/shared';
import { useNow } from '../../services/useNow';
import { useTheme } from '../../theme/useTheme';
import { useScreenContent } from '../../components/Layout';

const SECTIONS: { severity: AlertSeverity; title: string }[] = [
  { severity: 'critical', title: '위험' },
  { severity: 'warning', title: '경고' },
  { severity: 'info', title: '참고' },
];

/** 알림: 서버 상태에서 파생(deriveAlerts) — 저장하지 않으므로 상태가 해소되면 사라진다. */
export default function AlertsScreen() {
  const { dashboard, loading, error, refresh } = useDashboard();
  const { c, t, space } = useTheme();
  const content = useScreenContent();
  const now = useNow(5000);
  const [refreshing, setRefreshing] = useState(false);
  const alerts = deriveAlerts(dashboard, now);
  const counts = severityCounts(alerts);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TabHeader
        title="알림"
        sub={
          dashboard ? (
            <Text style={[t.label, { color: c.ink2 }]}>
              {alerts.length === 0 ? '현재 상태 기준 · 알림 없음' : `위험 ${counts.critical} · 경고 ${counts.warning} · 참고 ${counts.info}`}
            </Text>
          ) : null
        }
      />
      <ScrollView
        contentContainerStyle={content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={c.ink2}
            onRefresh={async () => {
              setRefreshing(true);
              await refresh();
              setRefreshing(false);
            }}
          />
        }
      >
        {error ? <ErrorNotice message={error} onRetry={refresh} /> : null}
        {loading && !dashboard ? <Loading /> : null}
        {dashboard && alerts.length === 0 ? (
          <Section title="조치할 항목 없음">
            <Empty text="장치·센서·적재·분류 처리에 문제가 없습니다." />
          </Section>
        ) : null}
        {SECTIONS.map(({ severity, title }) => {
          const list = alerts.filter((a) => a.severity === severity);
          if (!list.length) return null;
          return (
            <Section key={severity} title={`${title} ${list.length}`} gap={0}>
              {list.map((a, i) => (
                <AlertRow key={a.id} alert={a} now={now} last={i === list.length - 1} />
              ))}
            </Section>
          );
        })}
        {dashboard ? (
          <Text style={[t.caption, { color: c.ink3 }]}>
            분류 처리 실패와 제어 실패는 최근 1시간 기록만 표시합니다. 장치가 오프라인이면 센서 값이 오래되어 센서 알림은 내지 않습니다.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}
