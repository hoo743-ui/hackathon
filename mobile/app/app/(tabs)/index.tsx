import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { HealthLine } from '../../components/HealthLine';
import { MaterialCode } from '../../components/MaterialCode';
import { MaterialColumn } from '../../components/MaterialColumn';
import { Readout } from '../../components/Readout';
import { TabHeader } from '../../components/TabHeader';
import { Button, Empty, ErrorNotice, Hint, Loading, Section } from '../../components/primitives';
import { AlertRow } from '../../components/AlertRow';
import { DetectionRow } from '../../components/DetectionRow';
import { EdgeLine, LiveDetection } from '../../components/LiveDetection';
import { alertBadgeCount, localMidnightISO } from '../../services/alertsView';
import { describeError } from '../../services/errors';
import { useDashboard } from '../../services/DashboardContext';
import { fillReadout, formatCount, formatRelative, formatTime } from '../../services/format';
import { FILL_LEVEL_LABELS, WASTE_LABELS, WASTE_TYPES, deriveAlerts, deviceHealth, fillLevel, type Bin, type DetectionSummary, binReading } from '../../services/shared';
import { useNow } from '../../services/useNow';
import { useTheme } from '../../theme/useTheme';

const latest = (a: Date | null, b: Date | null) => (a && b ? (a > b ? a : b) : a ?? b);

export default function HomeScreen() {
  const { dashboard, wsState, loading, error, refresh, lastRefreshAt, lastEventAt, api } = useDashboard();
  const { c, t, space } = useTheme();
  const router = useRouter();
  const now = useNow(5000);
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary] = useState<DetectionSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const detections = dashboard?.recent_detections ?? [];
  const latestDetectionId = detections[0]?.id;

  // 오늘(기기 로컬 0시 이후) 분류 건수 — 실제 detection_logs 집계만 사용
  const loadSummary = useCallback(async () => {
    try {
      setSummary(await api.detectionSummary(localMidnightISO()));
      setSummaryError(null);
    } catch (e) {
      setSummaryError(describeError(e));
    }
  }, [api]);
  useEffect(() => {
    void loadSummary();
  }, [loadSummary, latestDetectionId]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refresh(), loadSummary()]);
    setRefreshing(false);
  };

  const device = dashboard?.devices[0];
  const bins = (dashboard?.bins ?? []).filter((b) => !device || b.device_id === device.device_id);
  const health = deviceHealth(device, bins, dashboard?.recent_commands ?? []);
  const alerts = deriveAlerts(dashboard, now);
  const urgent = alertBadgeCount(alerts);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TabHeader
        title="SMART RECYCLE"
        action={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="설정"
            onPress={() => router.push('/settings')}
            hitSlop={4}
            style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
          >
            <Ionicons name="settings-outline" size={24} color={c.ink} />
          </Pressable>
        }
      />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.s4, paddingBottom: space.s6, gap: space.s5 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.ink2} />}
      >
        {error ? <ErrorNotice message={error} onRetry={refresh} /> : null}
        {loading && !dashboard ? <Loading /> : null}

        {dashboard ? (
          <>
            <View style={{ borderTopWidth: 2, borderTopColor: c.ruleStrong, paddingTop: space.s3, gap: space.s1 }}>
              <HealthLine device={device} health={health} wsState={wsState} now={now} />
              <Text style={[t.label, { color: c.ink2 }]}>
                마지막 분류 수신 {detections[0] ? formatRelative(detections[0].received_at, now) : '기록 없음'}
              </Text>
              <EdgeLine edges={dashboard.edges ?? []} />
              {dashboard.latest_full_alert ? (
                <Text style={[t.label, { color: c.critical }]}>
                  만차 감지 {formatTime(dashboard.latest_full_alert.measured_at)} ({formatRelative(dashboard.latest_full_alert.measured_at, now)})
                </Text>
              ) : null}
            </View>

            <Section title="실시간 인식" right={<Text style={[t.caption, { color: c.ink3 }]}>맥북 서버 · 웹과 동일</Text>}>
              {detections[0] ? <LiveDetection key={detections[0].id} d={detections[0]} now={now} /> : <Empty text="아직 인식 결과 없음" />}
            </Section>

            <Section title="오늘 분류" right={<Text style={[t.caption, { color: c.ink3 }]}>0시 이후 · AI 분류 기록</Text>}>
              {summary ? (
                summary.total === 0 ? (
                  <Empty text="아직 분류 기록 없음" />
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.s4, flexWrap: 'wrap' }}>
                    <Readout value={formatCount(summary.total)} unit="건" accessibilityLabel={`오늘 분류 ${summary.total}건`} />
                    <View style={{ flexDirection: 'row', gap: space.s3, flexWrap: 'wrap', paddingBottom: 4, flexShrink: 1 }}>
                      {WASTE_TYPES.map((w) => (
                        <View key={w} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <MaterialCode type={w} size="sm" />
                          <Text style={[t.monoStrong, { color: c.ink }]}>{summary.by_waste_type[w] ?? 0}</Text>
                        </View>
                      ))}
                      {otherCount(summary) > 0 ? <Text style={[t.label, { color: c.ink2 }]}>기타 {otherCount(summary)}</Text> : null}
                    </View>
                  </View>
                )
              ) : summaryError ? (
                <Hint text={`분류 건수를 불러오지 못했습니다. ${summaryError}`} tone="warning" />
              ) : (
                <Text style={[t.label, { color: c.ink3 }]}>불러오는 중…</Text>
              )}
            </Section>

            <Section title="수거함" right={<Text style={[t.mono, { color: c.ink3, fontSize: 12 }]}>기준 {formatTime(latest(lastRefreshAt, lastEventAt)?.toISOString())}</Text>}>
              {bins.length === 0 ? (
                <Empty text="등록된 수거함이 없습니다." />
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -space.s2 }}>
                  {bins.map((b) => (
                    <BinCell key={b.bin_id} bin={b} />
                  ))}
                </View>
              )}
            </Section>

            <Section
              title={urgent ? `알림 ${urgent}` : '알림'}
              gap={0}
              right={alerts.length > 3 ? <Button label={`모두 ${alerts.length}`} compact onPress={() => router.push('/alerts')} /> : null}
            >
              {alerts.length === 0 ? <Empty text="알림 없음 — 조치할 항목이 없습니다" /> : alerts.slice(0, 3).map((a, i, arr) => <AlertRow key={a.id} alert={a} now={now} last={i === arr.length - 1} />)}
            </Section>

            <Section title="최근 분류" gap={0} right={<Text style={[t.caption, { color: c.ink3 }]}>종류 · 신뢰도 · 처리 결과</Text>}>
              {detections.length === 0 ? <Empty text="아직 분류 기록 없음" /> : detections.slice(0, 5).map((d, i, arr) => <DetectionRow key={d.id} d={d} last={i === arr.length - 1} />)}
            </Section>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** 4개 재질 외(모델이 낸 다른 값) 건수 */
function otherCount(s: DetectionSummary): number {
  return Object.entries(s.by_waste_type)
    .filter(([k]) => !(WASTE_TYPES as string[]).includes(k))
    .reduce((a, [, n]) => a + n, 0);
}

/** 2×2 컴팩트 Material Column 셀 */
function BinCell({ bin }: { bin: Bin }) {
  const { c, t, space } = useTheme();
  const router = useRouter();
  // 현재값은 센서 정상일 때만. 미설치·끊김은 숫자 대신 상태 문구 (마지막 값을 현재처럼 보이지 않게)
  const reading = binReading(bin);
  const level = fillLevel(reading.percent);
  const r = fillReadout(reading.percent);
  const statusText = reading.state === 'live' ? FILL_LEVEL_LABELS[level] : reading.label;
  const statusColor = reading.state === 'live' ? (level === 'normal' ? c.ink2 : level === 'unknown' ? c.ink3 : c.fill[level]) : reading.state === 'no_sensor' ? c.ink3 : c.critical;
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/bin/[id]', params: { id: bin.bin_id } })}
      accessibilityRole="button"
      accessibilityLabel={`${WASTE_LABELS[bin.waste_type]}, 적재율 ${r.value === '--' ? reading.label : `${r.value}%`}, ${statusText}. 상세 보기`}
      style={({ pressed }) => ({ width: '50%', paddingHorizontal: space.s2, paddingVertical: space.s3, opacity: pressed ? 0.7 : 1 })}
    >
      <View style={{ flexDirection: 'row', gap: space.s3, alignItems: 'flex-end' }}>
        <MaterialColumn percent={reading.percent} type={bin.waste_type} width={36} height={112} />
        <View style={{ flex: 1, gap: space.s1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <MaterialCode type={bin.waste_type} size="sm" />
            <Text style={[t.label, { color: c.ink2, flexShrink: 1 }]} numberOfLines={1}>
              {WASTE_LABELS[bin.waste_type]}
            </Text>
          </View>
          <Readout value={r.value} unit={r.unit} />
          <Text style={[t.label, { color: statusColor }]} numberOfLines={2}>
            {statusText}
            {reading.lastPercent !== null && reading.state !== 'live' ? ` · 마지막 ${reading.lastPercent.toFixed(1)}%` : ''}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
