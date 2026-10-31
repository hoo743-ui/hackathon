import Constants from 'expo-constants';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import React, { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { WS_LABELS } from '../components/HealthLine';
import { MaterialCode } from '../components/MaterialCode';
import { Button, DataSourceTag, Field, Hint, Section, Segmented, StatusDot } from '../components/primitives';
import { validateCalibration } from '../services/calibration';
import { HARDWARE_MODE_LABELS, isSimulated } from '../services/dataSource';
import { API_BASE_URL, WS_URL } from '../services/config';
import { useDashboard } from '../services/DashboardContext';
import { describeError } from '../services/errors';
import { formatDateTime, formatDistance } from '../services/format';
import {
  CONNECTION_LABELS,
  DEVICE_ERROR_LABELS,
  FILL_LEVEL_LABELS,
  FILL_THRESHOLDS,
  HEALTH_LABELS,
  WASTE_LABELS,
  deviceHealth,
  type Bin,
  type Calibration,
  type Health,
} from '../services/shared';
import { useThemeContext, type ThemePreference } from '../theme/ThemeContext';
import { touchTarget } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

export default function SettingsScreen() {
  const { api, wsState, dashboard, lastRefreshAt, lastEventAt, refresh, controlToken, setControlToken } = useDashboard();
  const { c, t, space } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { preference, setPreference } = useThemeContext();
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [tokenMsg, setTokenMsg] = useState<string | null>(null);

  const checkHealth = useCallback(async () => {
    setChecking(true);
    try {
      setHealth(await api.health());
      setHealthError(null);
    } catch (e) {
      setHealth(null);
      setHealthError(describeError(e));
    } finally {
      setChecking(false);
    }
  }, [api]);

  useEffect(() => {
    void checkHealth();
  }, [checkHealth]);

  const device = dashboard?.devices[0];
  const bins = dashboard?.bins ?? [];
  const dh = deviceHealth(device, bins, dashboard?.recent_commands ?? []);
  const okText = (v: boolean) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <StatusDot color={v ? c.ok : c.critical} />
      <Text style={[t.body, { color: v ? c.ink : c.critical }]}>{v ? '정상' : '오류'}</Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen
        options={{
          // 딥링크로 바로 들어온 경우(뒤로 갈 화면 없음) 홈으로
          headerLeft: router.canGoBack() ? undefined : () => <Button label="홈" icon="chevron-back" compact onPress={() => router.replace('/')} style={{ borderWidth: 0 }} />,
        }}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: space.s4, paddingTop: space.s3, paddingBottom: space.s7 + insets.bottom, gap: space.s6 }} keyboardShouldPersistTaps="handled">
          {isSimulated(dashboard, health) ? (
            <View style={{ alignSelf: 'flex-start' }}>
              <DataSourceTag simulated />
            </View>
          ) : null}
          <Section title="장치" gap={0}>
            {device ? (
              <>
                <Field label="장치 ID" value={device.device_id} mono />
                <Field label="이름" value={device.device_name ?? '--'} />
                <Field label="건강 상태" value={HEALTH_LABELS[dh.level]} tone={dh.level === 'healthy' ? c.ok : dh.level === 'offline' ? c.critical : dh.level === 'unknown' ? c.ink2 : c.warning} />
                <Field label="연결" value={CONNECTION_LABELS[device.connection_status]} />
                <Field label="마지막 수신" value={formatDateTime(device.last_seen)} mono />
                <Field label="운전 모드" value={device.operating_mode === 'AUTO' ? '자동' : '수동'} />
                <Field label="긴급 정지" value={device.estop_active ? '활성' : '해제'} tone={device.estop_active ? c.critical : undefined} />
                <Field label="데이터 출처" value={device.data_source === 'simulator' ? '시뮬레이터' : device.data_source === 'hardware' ? '하드웨어' : '--'} tone={device.data_source === 'simulator' ? c.warning : undefined} />
                <Field label="펌웨어" value={device.firmware_version ?? '--'} mono />
                {device.error_code ? <Field label="장치 오류" value={`${DEVICE_ERROR_LABELS[device.error_code] ?? '장치 오류'} (${device.error_code})`} tone={c.warning} /> : null}
                <Field
                  label="모터 (마지막 배출)"
                  value={dh.lastMotorResult ? (dh.lastMotorResult.status === 'SUCCEEDED' ? '정상 응답' : '실패') : '기록 없음'}
                  tone={dh.lastMotorResult && dh.lastMotorResult.status !== 'SUCCEEDED' ? c.critical : undefined}
                  last
                />
                <Text style={[t.caption, { color: c.ink3, paddingTop: space.s1 }]}>서보 위치 센서가 없어 모터 상태는 마지막 배출 명령의 장치 응답(ACK)으로만 판단합니다.</Text>
              </>
            ) : (
              <Hint text="장치 정보가 없습니다. 아래 연결 상태를 확인하세요." tone="warning" />
            )}
          </Section>

          <Section title="센서 · 보정" gap={0}>
            <Text style={[t.label, { color: c.ink2, paddingBottom: space.s2 }]}>초음파 센서가 위에서 잰 거리로 서버가 적재율을 계산합니다. 수정에는 제어 토큰이 필요합니다.</Text>
            {bins.map((b, i) => (
              <CalibrationRow key={b.bin_id} bin={b} last={i === bins.length - 1} hasToken={!!controlToken} />
            ))}
          </Section>

          <Section title="임계값" gap={0}>
            <Field label={`${FILL_LEVEL_LABELS.attention}`} value={`${FILL_THRESHOLDS.attention}% 이상`} tone={c.attention} />
            <Field label={`${FILL_LEVEL_LABELS.warning}`} value={`${FILL_THRESHOLDS.warning}% 이상`} tone={c.warning} />
            <Field label={`${FILL_LEVEL_LABELS.critical}`} value={`${FILL_THRESHOLDS.critical}% 이상`} tone={c.critical} />
            <Field label="가득 참 (서버 판정)" value="95% 이상" last />
            <Text style={[t.caption, { color: c.ink3, paddingTop: space.s1 }]}>
              읽기 전용. 표시 단계는 shared/src/labels.ts 의 FILL_THRESHOLDS, 서버 가득 참 판정은 백엔드 환경변수에서만 바꿀 수 있습니다.
            </Text>
          </Section>

          <Section title="연결" gap={0}>
            <Field label="API 서버" value={API_BASE_URL} mono stacked />
            <Field label="실시간 (WebSocket)" value={WS_URL} mono stacked />
            <Field
              label="하드웨어 모드"
              value={health?.hardware_mode ? HARDWARE_MODE_LABELS[health.hardware_mode] : dashboard?.hardware_mode ? HARDWARE_MODE_LABELS[dashboard.hardware_mode] : '--'}
              tone={(health?.hardware_mode ?? dashboard?.hardware_mode) === 'SIMULATOR' ? c.warning : undefined}
            />
            {health?.simulator_running !== undefined ? <Field label="내장 가상 장치" value={health.simulator_running ? '실행 중' : '정지'} /> : null}
            <Field label="실시간" value={WS_LABELS[wsState]} tone={wsState === 'open' ? c.ok : c.warning} />
            <Field label="데이터베이스" value={health ? okText(health.database) : '--'} />
            <Field label="서버 ↔ MQTT 브로커" value={health ? okText(health.mqtt) : '--'} />
            <Field label="마지막 스냅샷" value={formatDateTime(lastRefreshAt?.toISOString())} mono />
            <Field label="마지막 이벤트" value={formatDateTime(lastEventAt?.toISOString())} mono last />
            {healthError ? (
              <View style={{ paddingTop: space.s2 }}>
                <Hint text={healthError} tone="critical" />
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', gap: space.s2, paddingTop: space.s3 }}>
              <Button label="서버 확인" icon="pulse" busy={checking} onPress={() => void checkHealth()} style={{ flex: 1 }} />
              <Button label="새로고침" icon="refresh" onPress={() => void refresh()} style={{ flex: 1 }} />
            </View>
            <Text style={[t.caption, { color: c.ink3, paddingTop: space.s2 }]}>실기기에서는 localhost 대신 서버 PC의 LAN IP를 mobile/app/.env 에 넣고 앱을 다시 시작하세요.</Text>
          </Section>

          <Section title="앱" gap={space.s3}>
            <Text style={[t.label, { color: c.ink2 }]}>테마</Text>
            <Segmented<ThemePreference>
              accessibilityLabel="테마"
              options={[
                { value: 'system', label: '시스템' },
                { value: 'light', label: '라이트' },
                { value: 'dark', label: '다크' },
              ]}
              value={preference}
              onChange={setPreference}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: space.s3 }}>
              <Text style={[t.label, { color: c.ink2 }]}>제어 토큰</Text>
              <Text style={[t.label, { color: controlToken ? c.ok : c.warning }]}>{controlToken ? '저장됨' : '미설정'}</Text>
            </View>
            <TextInput
              value={tokenInput}
              onChangeText={setTokenInput}
              placeholder={controlToken ? '새 토큰으로 바꾸려면 입력' : 'API_CONTROL_TOKEN'}
              placeholderTextColor={c.ink3}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="제어 토큰 입력"
              style={[t.mono, { fontSize: 15, minHeight: touchTarget + 4, borderWidth: 1, borderColor: c.ink2, borderRadius: 2, paddingHorizontal: space.s3, color: c.ink, backgroundColor: c.surface }]}
            />
            <View style={{ flexDirection: 'row', gap: space.s2 }}>
              <Button
                label="저장"
                variant="primary"
                style={{ flex: 1 }}
                disabled={!tokenInput.trim()}
                onPress={async () => {
                  await setControlToken(tokenInput);
                  setTokenInput('');
                  setTokenMsg('토큰을 저장했습니다.');
                }}
              />
              <Button
                label="삭제"
                style={{ flex: 1 }}
                disabled={!controlToken}
                onPress={async () => {
                  await setControlToken(null);
                  setTokenMsg('토큰을 삭제했습니다.');
                }}
              />
            </View>
            <Hint text={tokenMsg} tone="ok" />
            <Text style={[t.caption, { color: c.ink3 }]}>명령·보정 요청의 Authorization: Bearer 헤더로 쓰이며 기기 보안 저장소에 보관됩니다.</Text>
            <Text style={[t.mono, { color: c.ink3, fontSize: 12 }]}>앱 {Constants.expoConfig?.version ?? '--'}</Text>
          </Section>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function CalibrationRow({ bin, last, hasToken }: { bin: Bin; last: boolean; hasToken: boolean }) {
  const { api } = useDashboard();
  const { c, t, space } = useTheme();
  const [cal, setCal] = useState<Calibration | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [empty, setEmpty] = useState('');
  const [full, setFull] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'critical' } | null>(null);

  const load = useCallback(async () => {
    try {
      setCal(await api.calibration(bin.bin_id));
      setLoadError(null);
    } catch (e) {
      setLoadError(describeError(e));
    }
  }, [api, bin.bin_id]);

  useEffect(() => {
    void load();
  }, [load]);

  const startEdit = () => {
    setEmpty(cal?.empty_distance_cm != null ? String(cal.empty_distance_cm) : '');
    setFull(cal?.full_distance_cm != null ? String(cal.full_distance_cm) : '');
    setMsg(null);
    setEditing(true);
  };

  const v = validateCalibration(empty, full);
  const save = async () => {
    if (v.error) return;
    setSaving(true);
    try {
      const res = await api.updateCalibration(bin.bin_id, v.empty, v.full);
      setCal(res);
      setEditing(false);
      setMsg({ text: '보정값을 저장했습니다. 다음 측정부터 반영됩니다.', tone: 'ok' });
    } catch (e) {
      setMsg({ text: describeError(e), tone: 'critical' });
    } finally {
      setSaving(false);
    }
  };

  const input = (value: string, set: (s: string) => void, label: string) => (
    <View style={{ flex: 1, gap: 4 }}>
      <Text style={[t.label, { color: c.ink2 }]}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: c.ink2, borderRadius: 2, backgroundColor: c.surface, paddingHorizontal: space.s3 }}>
        <TextInput
          value={value}
          onChangeText={set}
          keyboardType="decimal-pad"
          accessibilityLabel={`${WASTE_LABELS[bin.waste_type]} ${label} (cm)`}
          style={[t.mono, { fontSize: 15, flex: 1, minHeight: touchTarget, color: c.ink }]}
        />
        <Text style={[t.label, { color: c.ink3 }]}>cm</Text>
      </View>
    </View>
  );

  return (
    <View style={{ paddingVertical: space.s3, gap: space.s2, borderBottomWidth: last ? 0 : 1, borderBottomColor: c.rule }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s3 }}>
        <MaterialCode type={bin.waste_type} size="sm" />
        <View style={{ flex: 1 }}>
          <Text style={[t.bodyStrong, { color: c.ink }]}>
            {WASTE_LABELS[bin.waste_type]} <Text style={[t.mono, { color: c.ink3, fontSize: 12 }]}>{bin.bin_id}</Text>
          </Text>
          <Text style={[t.mono, { color: cal?.calibrated ? c.ink2 : c.warning, fontSize: 12 }]}>
            {loadError ? '보정값 불러오기 실패' : !cal ? '…' : cal.calibrated ? `빈 통 ${formatDistance(cal.empty_distance_cm)} · 가득 ${formatDistance(cal.full_distance_cm)}` : '미보정'}
          </Text>
        </View>
        {!editing ? <Button label="편집" compact onPress={startEdit} disabled={!cal && !loadError} /> : null}
      </View>
      {editing ? (
        <View style={{ gap: space.s2 }}>
          <View style={{ flexDirection: 'row', gap: space.s2 }}>
            {input(empty, setEmpty, '빈 통 기준')}
            {input(full, setFull, '가득 기준')}
          </View>
          <Text style={[t.caption, { color: c.ink3 }]}>현재 측정 거리 {formatDistance(bin.current_distance_cm)} — 통을 비운 상태에서 잰 값을 빈 통 기준으로 쓰세요.</Text>
          {empty || full ? <Hint text={v.error} tone="warning" /> : null}
          <Hint text={hasToken ? null : '제어 토큰이 없어 저장할 수 없습니다. 아래 앱 항목에서 입력하세요.'} tone="warning" />
          <View style={{ flexDirection: 'row', gap: space.s2 }}>
            <Button label="취소" style={{ flex: 1 }} onPress={() => setEditing(false)} />
            <Button label="저장" variant="primary" style={{ flex: 1 }} busy={saving} disabled={!!v.error || !hasToken} onPress={() => void save()} />
          </View>
        </View>
      ) : null}
      {msg ? <Hint text={msg.text} tone={msg.tone} /> : null}
    </View>
  );
}
