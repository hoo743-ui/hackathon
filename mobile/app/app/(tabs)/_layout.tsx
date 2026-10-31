import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';
import React from 'react';
import type { ColorValue } from 'react-native';
import { alertBadgeCount } from '../../services/alertsView';
import { useDashboard } from '../../services/DashboardContext';
import { deriveAlerts } from '../../services/shared';
import { useNow } from '../../services/useNow';
import { useTheme } from '../../theme/useTheme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
const icon =
  (outline: IconName, filled: IconName) =>
  ({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) => (
    <Ionicons name={focused ? filled : outline} color={color as string} size={size - 2} />
  );

/** 탭 4개: 홈 · 수거함 · 알림 · 제어 (설정은 홈 머리의 ⚙ → 스택 화면) */
export default function TabsLayout() {
  const { c, t } = useTheme();
  const { dashboard } = useDashboard();
  const now = useNow(30000); // 최근 1시간 실패 알림이 시간이 지나면 빠지도록
  const badge = alertBadgeCount(deriveAlerts(dashboard, now));
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.ink,
        tabBarInactiveTintColor: c.ink3,
        tabBarLabelStyle: { ...t.caption, fontSize: 11 },
        tabBarStyle: { backgroundColor: c.bg, borderTopColor: c.ruleStrong, borderTopWidth: 1 },
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: '홈', tabBarIcon: icon('home-outline', 'home') }} />
      <Tabs.Screen name="bins" options={{ title: '수거함', tabBarIcon: icon('file-tray-stacked-outline', 'file-tray-stacked') }} />
      <Tabs.Screen
        name="alerts"
        options={{
          title: '알림',
          tabBarIcon: icon('notifications-outline', 'notifications'),
          tabBarBadge: badge > 0 ? badge : undefined,
          tabBarBadgeStyle: { backgroundColor: c.critical, color: c.onCritical, ...t.caption, fontSize: 11 },
          tabBarAccessibilityLabel: badge > 0 ? `알림, 조치 필요 ${badge}건` : '알림',
        }}
      />
      <Tabs.Screen name="control" options={{ title: '제어', tabBarIcon: icon('options-outline', 'options') }} />
    </Tabs>
  );
}
