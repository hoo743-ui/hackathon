import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { MaterialCode } from '../../components/MaterialCode';
import { MaterialColumn } from '../../components/MaterialColumn';
import { Readout } from '../../components/Readout';
import { TabHeader } from '../../components/TabHeader';
import { Button, Empty, ErrorNotice, Hint, Loading, Section } from '../../components/primitives';
import { AlertRow } from '../../components/AlertRow';
import { DetectionRow } from '../../components/DetectionRow';
import { LiveDetection } from '../../components/LiveDetection';
import { Grid, StatusTile, Tile, useScreenContent, type TileTone } from '../../components/Layout';
import { alertBadgeCount, localMidnightISO } from '../../services/alertsView';
import { describeError } from '../../services/errors';
import { useDashboard } from '../../services/DashboardContext';
import { fillReadout, formatCount, formatRelative, formatTime } from '../../services/format';
import { FILL_LEVEL_LABELS, HEALTH_LABELS, WASTE_LABELS, WASTE_TYPES, deriveAlerts, deviceHealth, fillLevel, type Bin, type DetectionSummary, binReading } from '../../services/shared';
import { useNow } from '../../services/useNow';
import { useTheme } from '../../theme/useTheme';

const latest = (a: Date | null, b: Date | null) => (a && b ? (a > b ? a : b) : a ?? b);

export default function HomeScreen() {
  const { dashboard, wsState, loading, error, refresh, lastRefreshAt, lastEventAt, api } = useDashboard();
  const { c, t, space } = useTheme();
  const content = useScreenContent();
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
        contentContainerStyle={content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.ink2} />}
      >
        {error ? <ErrorNotice message={error} onRetry={refresh} /> : null}
        {loading && !dashboard ? <Loading /> : null}

        {dashboard ? (
          <>
            <SystemStatus />

            <Section title="실시간 인식" right={<Text style={[t.caption, { color: c.ink3 }]}>맥북 서버 · 웹과 동일</Text>}>
              {detections[0] ? <LiveDetection key={detections[0].id} d={detections[0]} now={now} /> : <Empty text="아직 인식 결과 없음" />}
            </Section>

            <Section title="오늘 분류" right={<Text style={[t.caption, { color: c.ink3 }]}>0시 이후 · AI 분류 기록</Text>}>
              {summary ? (
                summary.total === 0 ? (
                  <Empty text="아직 분류 기록 없음" />
                ) : (
                  <View style={{ gap: space.s3 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
                      <Readout value={formatCount(summary.total)} unit="건" accessibilityLabel={`오늘 분류 ${summary.total}건`} />
                      {otherCount(summary) > 0 ? <Text style={[t.caption, { color: c.ink3 }]}>4종 외 {otherCount(summary)}건</Text> : null}
                    </View>
                    <Grid columns={4} gap={8}>
                      {WASTE_TYPES.map((w) => (
                        <Tile key={w} style={{ alignItems: 'center', minHeight: 0, paddingVertical: 10, gap: 6 }}>
                          <MaterialCode type={w} size="sm" />
                          <Text style={[t.caption, { color: c.ink2 }]}>{WASTE_LABELS[w]}</Text>
                          <Text style={[t.bodyStrong, { color: c.ink }, t.tabular]}>{summary.by_waste_type[w] ?? 0}</Text>
                        </Tile>
                      ))}
                    </Grid>
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
                <Grid columns={2}>
                  {bins.map((b) => (
                    <BinCell key={b.bin_id} bin={b} />
                  ))}
                </Grid>
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
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <Tile style={{ flexDirection: 'row', gap: space.s3, alignItems: 'flex-end' }}>
        <MaterialColumn percent={reading.percent} type={bin.waste_type} width={28} height={88} />
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
      </Tile>
    </Pressable>
  );
}

const HEALTH_TONE: Record<string, TileTone> = { healthy: 'ok', degraded: 'warn', offline: 'bad', unknown: 'off' };

/** 시스템 상태: 2열 격자 — 장치 · 실시간 · 카메라 · 모델 · UNO · 서보 · 초음파 · 전송 (값은 서버가 받은 실제 상태) */
function SystemStatus() {
  const { dashboard, wsState } = useDashboard();
  const { c, t } = useTheme();
  const now = useNow(5000);
  const device = dashboard?.devices[0];
  const bins = (dashboard?.bins ?? []).filter((b) => !device || b.device_id === device.device_id);
  const health = deviceHealth(device, bins, dashboard?.recent_commands ?? []);
  const e = dashboard?.edges?.[0];
  const on = !!e?.online;
  const last = dashboard?.recent_detections?.[0];
  const sensor = e?.sensor_status;
  const servo = e?.servo_state;
  return (
    <Section
      title="시스템 상태"
      right={<Text style={[t.caption, { color: c.ink3 }]}>마지막 인식 {last ? formatRelative(last.received_at, now) : '없음'}</Text>}
    >
      <Grid columns={2}>
        <StatusTile label="분리수거함" value={HEALTH_LABELS[health.level]} detail={device?.device_id ?? null} tone={HEALTH_TONE[health.level]} />
        <StatusTile
          label="실시간 연결"
          value={wsState === 'open' ? '연결됨' : wsState === 'connecting' ? '연결 중' : '끊김'}
          detail="맥북 서버"
          tone={wsState === 'open' ? 'ok' : wsState === 'connecting' ? 'warn' : 'bad'}
        />
        <StatusTile label="카메라 컴퓨터" value={!e ? '기록 없음' : on ? '온라인' : '오프라인'} detail={e ? `${e.device_id}${e.fps ? ` · ${e.fps.toFixed(0)} fps` : ''}` : null} tone={!e ? 'off' : on ? 'ok' : 'bad'} />
        <StatusTile label="YOLO 모델" value={on && e?.model_loaded ? '로드됨' : '없음'} detail={e?.model_name ?? null} tone={!e ? 'off' : on && e.model_loaded ? 'ok' : 'bad'} />
        <StatusTile
          label="Arduino UNO"
          value={!e?.serial_enabled ? '비활성' : on && e.serial_connected ? '연결됨' : '미연결'}
          detail={e?.serial_port ?? null}
          tone={!e || !e.serial_enabled ? 'off' : on && e.serial_connected ? 'ok' : 'bad'}
        />
        <StatusTile
          label="서보 ×3"
          value={!on || !e?.serial_connected ? '—' : servo === 'moving' ? '동작 중' : servo === 'error' ? '응답 없음' : servo === 'stopped' ? '비상 정지' : servo === 'unverified' ? '확인 불가' : '대기'}
          detail={e ? `성공 ${e.sorted_ok ?? 0} · 실패 ${e.sorted_failed ?? 0}` : null}
          tone={!on || !e?.serial_connected ? 'off' : servo === 'error' || servo === 'stopped' ? 'bad' : servo === 'moving' || servo === 'unverified' ? 'warn' : 'ok'}
        />
        <StatusTile
          label="초음파 HC-SR04"
          value={sensor === 'normal' ? `${e?.distance_cm ?? '--'} cm` : sensor === 'disconnected' ? '연결 끊김' : sensor === 'error' ? '측정 오류' : '수신 없음'}
          detail={sensor === 'normal' && e?.fill_percent != null ? `적재율 ${e.fill_percent}%` : null}
          tone={!on || !sensor || sensor === 'unknown' ? 'off' : sensor === 'normal' ? 'ok' : 'bad'}
        />
        <StatusTile
          label="서버 전송"
          value={!e ? '—' : e.upload_queue === 0 ? '대기 없음' : `대기 ${e.upload_queue}건`}
          detail={e ? `성공 ${e.uploads_ok} · 실패 ${e.uploads_failed}` : null}
          tone={!e ? 'off' : e.upload_queue === 0 ? 'ok' : 'warn'}
        />
      </Grid>
      {dashboard?.latest_full_alert ? (
        <Text style={[t.label, { color: c.critical }]}>
          만차 감지 {formatTime(dashboard.latest_full_alert.measured_at)} ({formatRelative(dashboard.latest_full_alert.measured_at, now)})
        </Text>
      ) : null}
    </Section>
  );
}
