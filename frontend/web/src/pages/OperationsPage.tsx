import { useState } from 'react';
import { CONNECTION_LABELS, WASTE_CODES, WASTE_LABELS, WASTE_TYPES } from '@shared';
import type { OperatingMode, WasteType } from '@shared';
import { useDashboard } from '../data/DashboardContext';
import { CommandProgress } from '../components/CommandProgress';
import { CommandMessage, CommandStatusText, CommandTarget, commandTitle } from '../components/commands';
import { MaintenanceForm, MaintenanceList, MotorTest, SensorTest } from '../components/operations';
import { Pagination } from '../components/Pagination';
import { ConfirmDialog } from '../components/Dialog';
import { MaterialCode, MaterialColumn } from '../components/material';
import { Button, EmptyState, ErrorState, LoadingState, Notice, PageHeader, Section, Segmented, StatusText } from '../components/primitives';
import { estopBlockReason, inFlightCommand, modeBlockReason, openBinBlockReason, resetBlockReason, generalBlockReason } from '../lib/controlRules';
import { useControlToken } from '../lib/controlToken';
import { describeError, formatDateTime, formatFill, formatStamp } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { useNow } from '../lib/useNow';
import { useCommand } from '../lib/useCommand';

type Confirm = { kind: 'reset' } | { kind: 'auto' } | null;

export function OperationsPage() {
  const { dashboard, api, maintenanceSeq } = useDashboard();
  const now = useNow(2000);
  const { token } = useControlToken();
  const hasToken = token.trim().length > 0;
  const device = dashboard?.devices[0];
  const commands = dashboard?.recent_commands ?? [];
  const inFlight = inFlightCommand(commands, device?.device_id);
  const tracker = useCommand(device?.device_id);
  const motor = useCommand(device?.device_id);
  const [logPage, setLogPage] = useState(1);
  const latestCmd = commands[0] ? `${commands[0].command_id}:${commands[0].status}` : '';
  const log = useAsync(() => api.commands({ limit: 20, offset: (logPage - 1) * 20, order: 'desc' }), [api, logPage, latestCmd]);
  const maint = useAsync(() => api.maintenance({ limit: 10 }), [api, maintenanceSeq]);
  const busy = tracker.requesting || motor.requesting;
  const [selected, setSelected] = useState<WasteType | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);

  if (!dashboard) return <LoadingState />;

  const estopReason = estopBlockReason(device, hasToken);
  const resetReason = resetBlockReason(device, inFlight, hasToken);
  const modeReason = modeBlockReason(device, inFlight, hasToken);
  const openReason = openBinBlockReason(device, inFlight, hasToken);
  const statusReason = generalBlockReason(device, inFlight, hasToken);
  const estop = !!device?.estop_active;

  const sendMode = (m: OperatingMode) => void tracker.send(`mode-${m}`, { command: 'SET_MODE', target: m });

  return (
    <div className="page page--control">
      <PageHeader title="운영" meta={device ? <span className="t-mono">{device.device_id}</span> : null} />

      {!hasToken && (
        <Notice tone="warning" testId="no-token">
          제어 토큰이 설정되지 않아 명령과 점검 기록을 보낼 수 없습니다. 오른쪽 위 <strong>앱 설정</strong>(⚙)에서 토큰을 입력하세요.
        </Notice>
      )}
      {!device && <Notice tone="critical">장치 정보가 없습니다. 서버 연결을 확인하세요.</Notice>}

      {/* 긴급 정지: 한 번 누르면 즉시 (안전 방향). 해제는 확인 */}
      <div className="estop" data-active={estop || undefined}>
        <div className="estop__text">
          <h2 className="estop__title">{estop ? '긴급 정지 활성' : '긴급 정지'}</h2>
          <p className="estop__desc">
            {estop ? '모든 모터 명령이 거부됩니다. 주변 안전을 확인한 뒤 해제하세요.' : '누르는 즉시 모든 모터를 멈춥니다. 확인 단계 없음.'}
          </p>
        </div>
        <div className="estop__actions">
          {estop ? (
            <Button variant="default" size="lg" className="estop__reset" disabled={!!resetReason || busy} onClick={() => setConfirm({ kind: 'reset' })} aria-describedby={resetReason ? 'reset-reason' : undefined}>
              긴급 정지 해제
            </Button>
          ) : (
            <button
              type="button"
              className="estop__btn"
              disabled={!!estopReason}
              aria-describedby={estopReason ? 'estop-reason' : undefined}
              onClick={() => void tracker.send('estop', { command: 'EMERGENCY_STOP', target: null })}
            >
              긴급 정지
            </button>
          )}
          {estop
            ? resetReason && (
                <p className="reason reason--on-strip" id="reset-reason">
                  {resetReason}
                </p>
              )
            : estopReason && (
                <p className="reason reason--on-strip" id="estop-reason">
                  {estopReason}
                </p>
              )}
        </div>
      </div>

      <div className="ctl-grid">
        <div className="ctl-main">
          <Section title="운전 모드">
            <div className="mode-row">
              <Segmented<OperatingMode>
                label="운전 모드"
                size="lg"
                value={device?.operating_mode ?? 'MANUAL'}
                disabled={!!modeReason || busy}
                options={[
                  { value: 'MANUAL', label: '수동' },
                  { value: 'AUTO', label: '자동' },
                ]}
                onChange={(m) => (m === 'AUTO' ? setConfirm({ kind: 'auto' }) : sendMode(m))}
              />
              <dl className="ctl-summary">
                <div>
                  <dt>연결</dt>
                  <dd>
                    <StatusText tone={device?.connection_status === 'online' ? 'ok' : 'critical'}>{CONNECTION_LABELS[device?.connection_status ?? 'unknown']}</StatusText>
                  </dd>
                </div>
                <div>
                  <dt>동작</dt>
                  <dd>{device?.busy || inFlight ? '명령 수행 중' : '대기'}</dd>
                </div>
                <div>
                  <dt>긴급 정지</dt>
                  <dd>{estop ? <StatusText tone="critical">활성</StatusText> : '해제'}</dd>
                </div>
              </dl>
            </div>
            <p className="reason" data-testid="mode-reason">
              {modeReason ??
                (device?.operating_mode === 'AUTO'
                  ? '자동: AI 분류 결과로 장치가 배출구를 엽니다. 수동 배출·모터 테스트는 서버가 거부합니다.'
                  : '수동: 관리자가 배출구를 직접 조작합니다. AI 분류는 기록만 하고 배출하지 않습니다.')}
            </p>
            <div className="ctl-aux">
              <Button size="sm" disabled={!!statusReason || busy} onClick={() => void tracker.send('status', { command: 'GET_STATUS', target: null })}>
                상태 요청
              </Button>
              <span className="t-caption">장치에 현재 상태 보고를 요청합니다 (동작 없음).</span>
            </div>
          </Section>

          <Section title="수동 배출">
            <fieldset className="actuators" disabled={!!openReason || busy}>
              <legend className="sr-only">작동할 배출구 선택</legend>
              {WASTE_TYPES.map((w) => {
                const bin = dashboard.bins.find((b) => b.waste_type === w);
                return (
                  <label key={w} className="actuator" data-selected={selected === w || undefined}>
                    <input type="radio" name="bin" value={w} checked={selected === w} onChange={() => setSelected(w)} />
                    <MaterialCode type={w} size="lg" />
                    <span className="actuator__name">{WASTE_LABELS[w]}</span>
                    <span className="actuator__fill">
                      <MaterialColumn type={w} percent={bin?.current_fill_percent ?? null} calibrated={bin?.calibrated} size="xs" ticks={false} />
                      <span className="num">{formatFill(bin?.current_fill_percent ?? null)}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
            <div className="actuate">
              <Button
                variant="signal"
                size="lg"
                disabled={!selected || !!openReason || busy}
                onClick={() => {
                  if (!selected) return;
                  void tracker.send(`open-${selected}`, { command: 'OPEN_BIN', target: selected });
                  setSelected(null);
                }}
              >
                {selected ? `${WASTE_CODES[selected]} ${WASTE_LABELS[selected]} 배출구 작동` : '배출구를 먼저 선택하세요'}
              </Button>
              <p className="reason" data-testid="open-reason">
                {openReason ?? '두 단계: 재질을 선택한 뒤 작동 버튼을 누릅니다.'}
              </p>
            </div>
          </Section>

          <Section title="모터 테스트" aside={<span className="t-caption">결과 = 장치 ACK</span>}>
            <MotorTest bins={dashboard.bins} tracker={motor} blockReason={openReason} deviceId={device?.device_id} />
          </Section>

          <Section title="센서 테스트" aside={<span className="t-caption">실시간 값 확인 후 판정 기록</span>}>
            <SensorTest bins={dashboard.bins} now={now} hasToken={hasToken} deviceId={device?.device_id} />
          </Section>
        </div>

        <div className="ctl-side">
          <Section title="명령 진행">
            <CommandProgress requesting={tracker.requesting} error={tracker.error} command={tracker.command} pendingLabel="요청" />
          </Section>
          <Section title="점검 기록">
            <MaintenanceForm bins={dashboard.bins} hasToken={hasToken} deviceId={device?.device_id} />
            {maint.error && !maint.data ? (
              <ErrorState onRetry={maint.reload}>점검 기록을 불러오지 못했습니다: {describeError(maint.error)}</ErrorState>
            ) : maint.data ? (
              <MaintenanceList items={maint.data.items} bins={dashboard.bins} />
            ) : (
              <LoadingState />
            )}
          </Section>
        </div>
      </div>

      <Section title="제어 기록" aside={<span className="t-caption">관리자 조작과 AI 자동 배출 — 분류 결과는 분류 기록에서</span>}>
        {log.error && !log.data ? (
          <ErrorState onRetry={log.reload}>제어 기록을 불러오지 못했습니다: {describeError(log.error)}</ErrorState>
        ) : !log.data ? (
          <LoadingState />
        ) : log.data.items.length === 0 ? (
          <EmptyState>제어 기록이 없습니다.</EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table table--dense" data-testid="command-log">
                <thead>
                  <tr>
                    <th scope="col">요청 시각</th>
                    <th scope="col">명령</th>
                    <th scope="col">대상</th>
                    <th scope="col">주체</th>
                    <th scope="col">상태</th>
                    <th scope="col">결과 · 오류</th>
                    <th scope="col">명령 ID</th>
                  </tr>
                </thead>
                <tbody>
                  {log.data.items.map((c) => (
                    <tr key={c.command_id} className={c.status === 'FAILED' || c.status === 'TIMEOUT' ? 'row-bad' : ''}>
                      <td className="t-mono nowrap" title={formatDateTime(c.requested_at)}>
                        {formatStamp(c.requested_at)}
                      </td>
                      <td className="nowrap">{commandTitle(c)}</td>
                      <td className="nowrap">
                        <CommandTarget target={c.target} />
                      </td>
                      <td className="nowrap">{c.origin === 'auto' ? <span className="origin-tag">AI 자동</span> : '관리자'}</td>
                      <td className="nowrap">
                        <CommandStatusText status={c.status} />
                      </td>
                      <td className={c.error_message ? 'is-bad' : ''}>{c.error_message || c.result_message ? <CommandMessage c={c} /> : <span className="muted">--</span>}</td>
                      <td className="t-mono muted" title={c.command_id}>
                        {c.command_id.slice(0, 8)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination offset={log.data.offset} limit={log.data.limit || 20} total={log.data.total} count={log.data.items.length} onPage={setLogPage} />
          </>
        )}
      </Section>

      <ConfirmDialog
        open={confirm?.kind === 'reset'}
        title="긴급 정지를 해제할까요?"
        confirmLabel="해제"
        confirmVariant="primary"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          void tracker.send('reset', { command: 'RESET_ESTOP', target: null });
        }}
      >
        <p>주변 안전을 확인했습니까? 해제하면 장치가 다시 모터 명령을 받습니다.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm?.kind === 'auto'}
        title="자동 모드로 전환할까요?"
        confirmLabel="자동 모드로 전환"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          sendMode('AUTO');
        }}
      >
        <p>자동 모드에서는 장치가 분류 결과에 따라 배출구를 직접 엽니다. 수동 배출은 비활성화됩니다.</p>
      </ConfirmDialog>
    </div>
  );
}
