import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { CommandProgress } from '../../components/Command';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EStopBar } from '../../components/EStopBar';
import { HoldButton } from '../../components/HoldButton';
import { TabHeader } from '../../components/TabHeader';
import { Button, Hint, Section, Segmented, StatusDot } from '../../components/primitives';
import { commandTitle } from '../../services/commandProgress';
import { findInFlight, modeBlockReason, openBinBlockReason, withTokenReason } from '../../services/controlRules';
import { useDashboard } from '../../services/DashboardContext';
import { describeError } from '../../services/errors';
import { ControlLog, MotorTestRecord } from '../../components/ControlLog';
import { CONNECTION_LABELS, FINAL_COMMAND_STATUSES, WASTE_TYPES, type CommandStatus, type CommandRequest, type OperatingMode } from '../../services/shared';
import { useTheme } from '../../theme/useTheme';

const isFinalStatus = (st: CommandStatus) => FINAL_COMMAND_STATUSES.includes(st);

type Confirm = { kind: 'auto' } | { kind: 'reset' } | null;

export default function ControlScreen() {
  const { dashboard, sendCommand, controlToken } = useDashboard();
  const { c, t, space } = useTheme();
  const router = useRouter();
  // 장치 1대 전제 (DESIGN_AUDIT F3) — 장치 ID 를 화면에 항상 표시한다.
  const device = dashboard?.devices[0];
  const [sending, setSending] = useState<string | null>(null);
  const [requesting, setRequesting] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [lastCommandId, setLastCommandId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const blockedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (blockedTimer.current) clearTimeout(blockedTimer.current);
  }, []);

  const commands = (dashboard?.recent_commands ?? []).filter((cmd) => !device || cmd.device_id === device.device_id);
  const inFlight = findInFlight(commands, device?.device_id);
  const lastCommand = commands.find((cmd) => cmd.command_id === lastCommandId);
  const hasToken = !!controlToken;

  // 차단 판단에는 토큰 여부를 포함하고, 안내 문구는 상단 토큰 안내와 중복되지 않게 장치 사유만 보인다.
  const openBase = openBinBlockReason(device, inFlight);
  const modeBase = modeBlockReason(device, inFlight);
  const openReason = withTokenReason(openBase, hasToken);
  const modeReason = withTokenReason(modeBase, hasToken);
  const resetReason = !device ? '장치 정보가 없습니다.' : device.connection_status !== 'online' ? '장치가 오프라인입니다 — 해제할 수 없습니다.' : null;

  async function send(key: string, req: Omit<CommandRequest, 'command_id'>) {
    if (!device) return;
    setSending(key);
    setRequesting(commandTitle({ command: req.command, target: req.target ?? null }));
    setRequestError(null);
    setLastCommandId(null);
    try {
      const cmd = await sendCommand(device.device_id, req);
      setLastCommandId(cmd.command_id);
    } catch (e) {
      setRequestError(describeError(e));
    } finally {
      setSending(null);
    }
  }

  function flashBlocked(reason: string) {
    setBlocked(reason);
    if (blockedTimer.current) clearTimeout(blockedTimer.current);
    blockedTimer.current = setTimeout(() => setBlocked(null), 4000);
  }

  const showProgress = !!(lastCommand || requesting);

  if (dashboard?.hardware_mode === 'EDGE_SERIAL') {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <TabHeader title="제어" />
        <ScrollView contentContainerStyle={{ padding: space.s4, gap: space.s3 }}>
          <View style={{ borderLeftWidth: 3, borderLeftColor: c.accent, paddingLeft: space.s3, gap: space.s2 }}>
            <Text style={[t.bodyStrong, { color: c.ink }]}>카메라 컴퓨터가 직접 제어하는 구성입니다</Text>
            <Text style={[t.body, { color: c.ink2 }]}>
              YOLO 인식 결과에 따라 카메라 컴퓨터가 Arduino 서보 3개를 USB 시리얼로 구동합니다. 앱의 원격 제어(모드 변경·수동 배출·모터
              테스트)는 사용하지 않습니다.
            </Text>
            <Text style={[t.body, { color: c.ink2 }]}>비상 정지는 카메라 컴퓨터 프로그램의 빨간 버튼을 사용하세요.</Text>
            <Text style={[t.body, { color: c.ink2 }]}>인식 결과·하드웨어 동작 결과는 홈 탭, 칸별 적재율은 수거함 탭에서 확인합니다.</Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TabHeader
        title="제어"
        sub={
          device ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s2, flexWrap: 'wrap' }}>
              <StatusDot color={device.connection_status === 'online' ? c.ok : device.connection_status === 'offline' ? c.critical : c.unknown} />
              <Text style={[t.mono, { color: c.ink2 }]}>{device.device_id}</Text>
              <Text style={[t.label, { color: c.ink2 }]}>
                {CONNECTION_LABELS[device.connection_status]} · {device.operating_mode === 'AUTO' ? '자동 모드' : '수동 모드'}
                {device.busy ? ' · 처리 중' : ''}
              </Text>
            </View>
          ) : null
        }
      />
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.s4, paddingBottom: space.s5, gap: space.s5 }} keyboardShouldPersistTaps="handled">
        {!device ? <Hint text="장치 정보가 없습니다. 서버 연결을 확인하세요 (홈 ⚙ 설정)." tone="warning" /> : null}

        {!hasToken ? (
          <View style={{ borderLeftWidth: 3, borderLeftColor: c.warning, paddingLeft: space.s3, gap: space.s2 }}>
            <Text style={[t.bodyStrong, { color: c.ink }]}>제어 토큰이 없습니다</Text>
            <Text style={[t.label, { color: c.ink2 }]}>명령은 서버의 API_CONTROL_TOKEN 이 있어야 허용됩니다. 긴급 정지도 토큰이 필요합니다.</Text>
            <Button label="설정에서 토큰 입력" icon="key-outline" compact onPress={() => router.push('/settings')} style={{ alignSelf: 'flex-start' }} />
          </View>
        ) : null}

        <Section title="운전 모드">
          <Segmented<OperatingMode>
            accessibilityLabel="운전 모드"
            options={[
              { value: 'MANUAL', label: '수동' },
              { value: 'AUTO', label: '자동' },
            ]}
            value={device?.operating_mode ?? null}
            busyValue={sending === 'mode-AUTO' ? 'AUTO' : sending === 'mode-MANUAL' ? 'MANUAL' : null}
            disabled={!!modeReason}
            onChange={(m) => (m === 'AUTO' ? setConfirm({ kind: 'auto' }) : void send('mode-MANUAL', { command: 'SET_MODE', target: 'MANUAL' }))}
          />
          <Hint text={modeBase} tone="warning" />
          <Text style={[t.label, { color: c.ink2 }]}>
            자동 = AI 분류 결과로 배출구가 동작 · 수동 = 관리자가 직접 조작. 자동 모드에서는 서버가 수동 배출 명령을 거부합니다.
          </Text>
        </Section>

        <Section title="배출구 · 모터 테스트" right={<Text style={[t.label, { color: c.ink2 }]}>0.6초 길게 누르기</Text>}>
          <View style={{ gap: space.s2 }}>
            {[WASTE_TYPES.slice(0, 2), WASTE_TYPES.slice(2, 4)].map((row, ri) => (
              <View key={ri} style={{ flexDirection: 'row', gap: space.s2 }}>
                {row.map((w) => {
                  const target = dashboard?.bins.find((b) => b.device_id === device?.device_id && b.waste_type === w);
                  return (
                  <HoldButton
                    key={w}
                    type={w}
                    percent={target?.current_fill_percent ?? null}
                    blockReason={openReason}
                    busy={sending === `open-${w}`}
                    onBlocked={flashBlocked}
                    onActivate={() => void send(`open-${w}`, { command: 'OPEN_BIN', target: w, bin_id: target?.bin_id })}
                  />
                  );
                })}
              </View>
            ))}
          </View>
          <Hint text={blocked ?? openBase} tone={blocked ? 'warning' : 'muted'} />
        </Section>

        {showProgress ? (
          <Section title="명령 진행">
            <CommandProgress cmd={lastCommand} requestingTitle={requesting} requestError={requestError} />
            {lastCommand && lastCommand.command === 'OPEN_BIN' && isFinalStatus(lastCommand.status) ? (
              <MotorTestRecord key={lastCommand.command_id} cmd={lastCommand} hasToken={hasToken} />
            ) : null}
          </Section>
        ) : null}

        <Section title="상태 확인" gap={space.s2}>
          <Button
            label="장치 상태 새로 요청"
            icon="refresh"
            style={{ alignSelf: 'flex-start' }}
            disabled={!device || device.connection_status !== 'online' || !hasToken}
            busy={sending === 'status'}
            accessibilityHint="GET_STATUS 명령을 보내 장치 상태를 다시 받습니다"
            onPress={() => void send('status', { command: 'GET_STATUS', target: null })}
          />
        </Section>

        <ControlLog deviceId={device?.device_id} />
      </ScrollView>

      {device ? (
        <EStopBar
          active={device.estop_active}
          sending={sending === 'estop'}
          resetting={sending === 'reset'}
          resetDisabledReason={resetReason}
          onStop={() => void send('estop', { command: 'EMERGENCY_STOP', target: null })}
          onReset={() => setConfirm({ kind: 'reset' })}
        />
      ) : null}

      <ConfirmDialog
        visible={confirm?.kind === 'auto'}
        title="자동 모드로 전환할까요?"
        body="자동 모드에서는 장치가 스스로 분류·배출하며 앱의 수동 배출이 막힙니다. 투입구 주변을 확인하세요."
        confirmLabel="자동으로 전환"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          void send('mode-AUTO', { command: 'SET_MODE', target: 'AUTO' });
        }}
      />
      <ConfirmDialog
        visible={confirm?.kind === 'reset'}
        title="긴급 정지를 해제할까요?"
        body="주변 안전을 확인했습니까? 해제하면 장치가 다시 명령을 받습니다."
        confirmLabel="해제"
        confirmVariant="danger"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          void send('reset', { command: 'RESET_ESTOP', target: null });
        }}
      />
    </View>
  );
}
