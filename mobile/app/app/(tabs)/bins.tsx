import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Sparkline } from '../../components/Chart';
import { MaterialCode } from '../../components/MaterialCode';
import { MaterialColumn } from '../../components/MaterialColumn';
import { Readout } from '../../components/Readout';
import { TabHeader } from '../../components/TabHeader';
import { Empty, ErrorNotice, Loading, Section } from '../../components/primitives';
import type { Point } from '../../services/chart';
import { useDashboard } from '../../services/DashboardContext';
import { fillReadout, formatDistance, formatTime } from '../../services/format';
import { FILL_LEVEL_LABELS, SENSOR_STATUS_LABELS, WASTE_LABELS, fillLevel, type Bin, type Trend } from '../../services/shared';
import { useTheme } from '../../theme/useTheme';

const TREND_HOURS = 24;
const BUCKET_MIN = 60;

export default function BinsScreen() {
  const { dashboard, loading, error, refresh, api } = useDashboard();
  const { c, t, space } = useTheme();
  const [trend, setTrend] = useState<Trend | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadTrend = useCallback(async () => {
    try {
      setTrend(await api.trend(TREND_HOURS, BUCKET_MIN));
    } catch {
      setTrend(null); // 스파크라인은 보조 정보 — 실패 시 생략
    }
  }, [api]);

  useEffect(() => {
    void loadTrend();
  }, [loadTrend]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refresh(), loadTrend()]);
    setRefreshing(false);
  };

  const bins = dashboard?.bins ?? [];
  const counts = bins.reduce<Record<string, number>>((acc, b) => {
    const l = fillLevel(b.current_fill_percent);
    acc[l] = (acc[l] ?? 0) + 1;
    return acc;
  }, {});
  const summary = [
    `${bins.length}개`,
    counts.critical ? `위험 ${counts.critical}` : null,
    counts.warning ? `경고 ${counts.warning}` : null,
    counts.attention ? `주의 ${counts.attention}` : null,
    counts.unknown ? `미보정 ${counts.unknown}` : null,
  ].filter(Boolean);

  const pointsFor = (binId: string): Point[] =>
    (trend?.buckets ?? []).filter((b) => b.bin_id === binId).map((b) => ({ t: new Date(b.bucket_start).getTime(), v: b.avg_fill_percent }));

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TabHeader title="수거함" />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.s4, paddingBottom: space.s6, gap: space.s4 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.ink2} />}
      >
        {error ? <ErrorNotice message={error} onRetry={refresh} /> : null}
        {loading && !dashboard ? <Loading /> : null}
        {dashboard ? (
          <Section title={summary.join(' · ')} right={<Text style={[t.caption, { color: c.ink3 }]}>24시간 추이</Text>} gap={0}>
            {bins.length === 0 ? <Empty text="등록된 수거함이 없습니다." /> : null}
            {bins.map((b, i) => (
              <BinLedgerRow key={b.bin_id} bin={b} points={pointsFor(b.bin_id)} last={i === bins.length - 1} />
            ))}
          </Section>
        ) : null}
      </ScrollView>
    </View>
  );
}

function BinLedgerRow({ bin, points, last }: { bin: Bin; points: Point[]; last: boolean }) {
  const { c, t, space } = useTheme();
  const router = useRouter();
  const level = fillLevel(bin.current_fill_percent);
  const r = fillReadout(bin.current_fill_percent);
  const sensorText = bin.sensor_status ? `센서 ${SENSOR_STATUS_LABELS[bin.sensor_status]}` : '측정 없음';
  const sensorBad = bin.sensor_status !== null && bin.sensor_status !== 'normal';
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/bin/[id]', params: { id: bin.bin_id } })}
      accessibilityRole="button"
      accessibilityLabel={`${WASTE_LABELS[bin.waste_type]} ${bin.bin_id}, 적재율 ${r.value === '--' ? '미보정' : `${r.value}%`}, ${FILL_LEVEL_LABELS[level]}, ${sensorText}. 상세 보기`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.s3,
        paddingVertical: space.s3,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.rule,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <MaterialColumn percent={bin.current_fill_percent} type={bin.waste_type} width={20} height={64} />
      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <MaterialCode type={bin.waste_type} size="sm" />
          <Text style={[t.bodyStrong, { color: c.ink, flexShrink: 1 }]} numberOfLines={1}>
            {WASTE_LABELS[bin.waste_type]}
          </Text>
        </View>
        <Text style={[t.mono, { color: c.ink2, fontSize: 12 }]} numberOfLines={1}>
          {bin.bin_id} · {formatDistance(bin.current_distance_cm)}
        </Text>
        <Text style={[t.caption, { color: sensorBad ? c.warning : c.ink3 }]} numberOfLines={1}>
          {sensorText} · {formatTime(bin.updated_at)}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Readout value={r.value} unit={r.unit} />
        <Text style={[t.label, { color: level === 'normal' ? c.ink2 : level === 'unknown' ? c.ink3 : c.fill[level] }]}>{FILL_LEVEL_LABELS[level]}</Text>
        <Sparkline points={points} color={c.material[bin.waste_type]} width={64} height={18} maxGapMs={BUCKET_MIN * 60000 * 1.5} />
      </View>
      <Ionicons name="chevron-forward" size={18} color={c.ink3} />
    </Pressable>
  );
}
