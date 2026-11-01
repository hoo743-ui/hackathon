import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FillLineChart } from '../../components/Chart';
import { MaterialCode } from '../../components/MaterialCode';
import { MaterialColumn } from '../../components/MaterialColumn';
import { Readout } from '../../components/Readout';
import { Button, DataSourceTag, Empty, ErrorNotice, Field, Loading, Section } from '../../components/primitives';
import { medianInterval } from '../../services/chart';
import { isSimulated } from '../../services/dataSource';
import { useDashboard } from '../../services/DashboardContext';
import { describeError } from '../../services/errors';
import { fillReadout, formatDateTime, formatDistance, formatFill, formatRelative, formatTime } from '../../services/format';
import {
  FILL_LEVEL_LABELS,
  FILL_THRESHOLDS,
  SENSOR_STATUS_LABELS,
  WASTE_LABELS,
  fillLevel,
  type Calibration,
  type SensorLog, binReading } from '../../services/shared';
import { useNow } from '../../services/useNow';
import { useTheme } from '../../theme/useTheme';

const HISTORY_LIMIT = 200;
const RECENT_ROWS = 15; // 이후 '더 보기'로 이미 받은 최근 200건까지 펼침

function levelCaption(level: ReturnType<typeof fillLevel>): string {
  switch (level) {
    case 'critical':
      return `위험 · ${FILL_THRESHOLDS.critical}% 이상`;
    case 'warning':
      return `경고 · ${FILL_THRESHOLDS.warning}% 이상`;
    case 'attention':
      return `주의 · ${FILL_THRESHOLDS.attention}% 이상`;
    case 'normal':
      return `여유 · ${FILL_THRESHOLDS.attention}% 미만`;
    default:
      return '미보정 · 적재율 알 수 없음';
  }
}

export default function BinDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { dashboard, api } = useDashboard();
  const { c, t, space } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const now = useNow(5000);
  const bin = dashboard?.bins.find((b) => b.bin_id === id);
  const device = dashboard?.devices.find((d) => d.device_id === bin?.device_id);

  const [history, setHistory] = useState<SensorLog[] | null>(null);
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState(RECENT_ROWS);

  const load = useCallback(async () => {
    try {
      const [h, cal] = await Promise.all([api.binHistory(id, { limit: HISTORY_LIMIT }), api.calibration(id).catch(() => null)]);
      setHistory(h.items);
      setCalibration(cal);
      setError(null);
    } catch (e) {
      setError(describeError(e));
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const asc = (history ?? []).slice().sort((a, b) => a.measured_at.localeCompare(b.measured_at));
  const desc = asc.slice().reverse();
  const times = asc.map((p) => new Date(p.measured_at).getTime());
  const median = medianInterval(times) ?? 60000;
  const reading = bin ? binReading(bin) : null;
  const level = fillLevel(reading?.percent ?? null);
  const r = fillReadout(reading?.percent ?? null, 1);
  const errorCount = asc.filter((p) => p.sensor_status !== 'normal').length;

  return (
    <ScrollView
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={{ padding: space.s4, paddingBottom: space.s6 + insets.bottom, gap: space.s5 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={c.ink2}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      <Stack.Screen
        options={{
          title: bin ? `${WASTE_LABELS[bin.waste_type]} 수거함` : id,
          // 딥링크로 바로 들어온 경우(뒤로 갈 화면 없음) 수거함 목록으로
          headerLeft: router.canGoBack()
            ? undefined
            : () => <Button label="수거함" icon="chevron-back" compact onPress={() => router.replace('/bins')} style={{ borderWidth: 0 }} />,
        }}
      />
      {!bin ? (
        dashboard ? <Empty text="수거함 정보를 찾을 수 없습니다." /> : <Loading />
      ) : (
        <>
          {/* 판독 영역: 큰 컬럼 + readout-xl */}
          <View style={{ flexDirection: 'row', gap: space.s4, alignItems: 'flex-end' }}>
            <MaterialColumn percent={reading?.percent ?? null} type={bin.waste_type} width={72} height={216} tickLabels />
            <View style={{ flex: 1, gap: space.s2, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s2, flexWrap: 'wrap' }}>
                <MaterialCode type={bin.waste_type} size="lg" />
                <View style={{ flexShrink: 1 }}>
                  <Text style={[t.title, { color: c.ink }]}>{WASTE_LABELS[bin.waste_type]}</Text>
                  <Text style={[t.mono, { color: c.ink2 }]}>{bin.bin_id}</Text>
                </View>
              </View>
              <DataSourceTag simulated={isSimulated(dashboard) || device?.data_source === 'simulator'} />
              <Readout size="xl" value={r.value} unit={r.unit} accessibilityLabel={`적재율 ${reading?.state === 'live' ? formatFill(reading.percent) : reading?.label}`} />
              <Text style={[t.bodyStrong, { color: reading?.state === 'live' ? (level === 'normal' ? c.ok : level === 'unknown' ? c.ink3 : c.fill[level]) : reading?.state === 'no_sensor' ? c.ink3 : c.critical }]}>
                {reading?.state === 'live' ? levelCaption(level) : reading?.label}
                {reading && reading.lastPercent !== null && reading.state !== 'live' ? ` · 마지막 ${reading.lastPercent.toFixed(1)}%` : ''}
              </Text>
              <Text style={[t.label, { color: c.ink2 }]}>
                {formatRelative(bin.updated_at, now)} 측정 · <Text style={t.mono}>{formatTime(bin.updated_at)}</Text>
              </Text>
            </View>
          </View>

          <Section title="센서" gap={0}>
            <Field label="원시 거리" value={formatDistance(bin.current_distance_cm)} mono />
            <Field
              label="센서 상태"
              value={bin.sensor_status ? SENSOR_STATUS_LABELS[bin.sensor_status] : '측정 없음'}
              tone={bin.sensor_status && bin.sensor_status !== 'normal' ? c.warning : undefined}
            />
            <Field label="가득 참 (서버 판정)" value={bin.is_full ? '예' : '아니오'} tone={bin.is_full ? c.critical : undefined} />
            <Field label="마지막 정상 측정" value={formatDateTime(bin.last_valid_at)} mono last />
          </Section>

          <Section title="보정 범위" gap={0} right={<Button label="편집" compact onPress={() => router.push('/settings')} accessibilityHint="설정 화면의 보정 편집으로 이동" />}>
            {calibration ? (
              <CalibrationScale cal={calibration} distance={bin.current_distance_cm} />
            ) : (
              <Empty text={bin.calibrated ? '보정값을 불러오지 못했습니다.' : '미보정 — 설정 화면에서 빈 통·가득 기준 거리를 입력하세요.'} />
            )}
          </Section>

          <Section title="측정 이력" right={<Text style={[t.caption, { color: c.ink3 }]}>적재율 % · 최근 {asc.length}건</Text>}>
            {error ? <ErrorNotice message={error} onRetry={load} /> : null}
            {history === null && !error ? <Loading /> : null}
            {history && asc.length === 0 ? <Empty text="측정 이력이 없습니다." /> : null}
            {asc.length > 1 ? (
              <>
                <FillLineChart
                  series={[{ key: bin.bin_id, color: c.material[bin.waste_type], points: asc.map((p) => ({ t: new Date(p.measured_at).getTime(), v: p.fill_percent })) }]}
                  t0={times[0]}
                  t1={times[times.length - 1]}
                  maxGapMs={Math.max(median * 3, 30000)}
                  errorTimes={asc.filter((p) => p.sensor_status !== 'normal').map((p) => new Date(p.measured_at).getTime())}
                  accessibilityLabel={`${WASTE_LABELS[bin.waste_type]} 적재율 이력 차트, ${formatTime(asc[0].measured_at)}부터 ${formatTime(asc[asc.length - 1].measured_at)}까지`}
                />
                <Text style={[t.caption, { color: c.ink3 }]}>
                  점선: 주의 {FILL_THRESHOLDS.attention} · 경고 {FILL_THRESHOLDS.warning} · 위험 {FILL_THRESHOLDS.critical}
                  {errorCount ? ` · 하단 붉은 틱: 센서 오류 ${errorCount}건` : ''} · 측정 없는 구간은 끊김
                </Text>
              </>
            ) : null}
          </Section>

          <Section
            title="최근 측정"
            gap={0}
            right={<Text style={[t.caption, { color: c.ink3 }]}>{Math.min(rows, desc.length)} / {desc.length}건</Text>}
          >
            {desc.slice(0, rows).map((it, i, arr) => {
              const bad = it.sensor_status !== 'normal';
              return (
                <View
                  key={`${it.measured_at}-${i}`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: space.s3, minHeight: 40, borderBottomWidth: i === arr.length - 1 ? 0 : 1, borderBottomColor: c.rule }}
                >
                  <Text style={[t.mono, { color: c.ink2, flex: 1 }]}>{formatDateTime(it.measured_at)}</Text>
                  <Text style={[t.mono, { color: c.ink2, width: 72, textAlign: 'right' }]}>{formatDistance(it.distance_cm)}</Text>
                  <Text style={[bad ? t.label : t.monoStrong, { color: bad ? c.warning : c.ink, width: 84, textAlign: 'right' }]} numberOfLines={1}>
                    {bad ? SENSOR_STATUS_LABELS[it.sensor_status] : formatFill(it.fill_percent)}
                  </Text>
                </View>
              );
            })}
          </Section>
          {rows < desc.length ? <Button label="더 보기" onPress={() => setRows((r) => r + 30)} /> : null}
          <Text style={[t.caption, { color: c.ink3 }]}>단계: {FILL_LEVEL_LABELS[level]}. 적재율은 서버가 보정값으로 계산한 값입니다.</Text>
        </>
      )}
    </ScrollView>
  );
}

/** 보정 범위 눈금: 가득(왼쪽) ← 현재 거리 → 빈 통(오른쪽) */
function CalibrationScale({ cal, distance }: { cal: Calibration; distance: number | null }) {
  const { c, t, space } = useTheme();
  if (cal.empty_distance_cm === null || cal.full_distance_cm === null) {
    return <Empty text="미보정 — 설정 화면에서 빈 통·가득 기준 거리를 입력하세요." />;
  }
  const full = cal.full_distance_cm;
  const empty = cal.empty_distance_cm;
  const pos = distance === null ? null : Math.max(0, Math.min(1, (distance - full) / (empty - full)));
  return (
    <View style={{ paddingVertical: space.s3, gap: space.s2 }}>
      <View style={{ height: 24, justifyContent: 'center' }}>
        <View style={{ height: 1, backgroundColor: c.ink2 }} />
        <View style={{ position: 'absolute', left: 0, width: 1, height: 12, backgroundColor: c.ink2 }} />
        <View style={{ position: 'absolute', right: 0, width: 1, height: 12, backgroundColor: c.ink2 }} />
        {pos !== null ? (
          <View
            accessible
            accessibilityLabel={`현재 거리 ${formatDistance(distance)}`}
            style={{ position: 'absolute', left: `${pos * 100}%`, marginLeft: -1, width: 3, height: 24, backgroundColor: c.ink }}
          />
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <View>
          <Text style={[t.caption, { color: c.ink3 }]}>가득 기준</Text>
          <Text style={[t.mono, { color: c.ink }]}>{formatDistance(full)}</Text>
        </View>
        <View style={{ alignItems: 'center' }}>
          <Text style={[t.caption, { color: c.ink3 }]}>현재</Text>
          <Text style={[t.monoStrong, { color: c.ink }]}>{formatDistance(distance)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[t.caption, { color: c.ink3 }]}>빈 통 기준</Text>
          <Text style={[t.mono, { color: c.ink }]}>{formatDistance(empty)}</Text>
        </View>
      </View>
    </View>
  );
}
