import { CONNECTION_LABELS, DEVICE_ERROR_LABELS, HEALTH_LABELS, SENSOR_STATUS_LABELS, WASTE_LABELS, deviceHealth } from '@shared';
import type { Bin, Command, Detection, Device, Health, HealthLevel, RealtimeState, Statistics } from '@shared';
import { config } from '../config';
import { useDashboard } from '../data/DashboardContext';
import { HEALTH_TONE } from '../components/AppShell';
import { CommandStatusText } from '../components/commands';
import { MaterialCode } from '../components/material';
import { DataList, EmptyState, LoadingState, PageHeader, Section, StatusText, Tag } from '../components/primitives';
import { describeError, formatCount, formatDateTime, formatRelative, formatTime } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { useNow } from '../lib/useNow';

const WS_TEXT: Record<RealtimeState, string> = { connecting: '연결 중', open: '연결됨', closed: '끊김' };
const WS_TONE: Record<RealtimeState, 'ok' | 'critical' | 'unknown'> = { connecting: 'unknown', open: 'ok', closed: 'critical' };

const LEVEL_ORDER: HealthLevel[] = ['healthy', 'degraded', 'offline', 'unknown'];
const LEVEL_HELP: Record<HealthLevel, string> = {
  healthy: '연결됨, 센서·긴급 정지·마지막 배출 모두 정상',
  degraded: '연결됨, 하지만 센서 이상·긴급 정지·배출 실패 중 하나 이상',
  offline: '서버가 장치 신호를 받지 못함',
  unknown: '장치로부터 아직 데이터를 받지 못함',
};

export function DevicesPage() {
  const { dashboard, api, ws, source } = useDashboard();
  const now = useNow();
  const minute = useNow(30_000);
  const health = useAsync(() => api.health(), [api, minute]);
  const stats = useAsync(() => api.statistics(24), [api, minute]);

  return (
    <div className="page">
      <PageHeader title="장치" />
      {!dashboard ? (
        <LoadingState />
      ) : dashboard.devices.length === 0 ? (
        <EmptyState>등록된 장치가 없습니다.</EmptyState>
      ) : (
        dashboard.devices.map((d) => (
          <DeviceLedger
            key={d.device_id}
            device={d}
            bins={dashboard.bins}
            commands={dashboard.recent_commands}
            health={health.data}
            healthError={health.error ? describeError(health.error) : null}
            stats={stats.data}
            lastDetection={dashboard.recent_detections?.[0] ?? null}
            now={now}
          />
        ))
      )}
      <Section title="연결" aside={<span className="t-caption">이 브라우저 기준</span>}>
        <DataList
          items={[
            { term: 'API 주소', value: <span className="t-mono break">{source.mode === 'mock' ? 'Mock (브라우저 내부)' : config.apiBaseUrl}</span> },
            { term: '실시간(WS) 주소', value: <span className="t-mono break">{source.wsUrl}</span> },
            { term: '실시간 연결', value: <StatusText tone={WS_TONE[ws]}>{WS_TEXT[ws]}</StatusText> },
            {
              term: '서버 상태 (/health)',
              value: health.error ? <StatusText tone="critical">응답 없음</StatusText> : health.data ? <StatusText tone={health.data.status.startsWith('ok') ? 'ok' : 'warning'}>{health.data.status}</StatusText> : <span className="muted">확인 중</span>,
              note: health.error ? describeError(health.error) : health.data ? `DB ${health.data.database ? '정상' : '오류'}` : undefined,
            },
          ]}
        />
      </Section>
    </div>
  );
}

function DeviceLedger({
  device: d,
  bins,
  commands,
  health,
  healthError,
  stats,
  lastDetection,
  now,
}: {
  device: Device;
  bins: Bin[];
  commands: Command[];
  health: Health | null;
  healthError: string | null;
  stats: Statistics | null;
  lastDetection: Detection | null;
  now: number;
}) {
  const h = deviceHealth(d, bins, commands);
  const own = bins.filter((b) => b.device_id === d.device_id);
  return (
    <div className="device">
      <Section title={d.device_name ?? d.device_id} aside={<span className="t-mono">{d.device_id}</span>}>
        <div className="device__grid">
          <div className="device__health">
            <p className="t-label">건강 상태</p>
            <ol className="hscale" aria-label="건강 상태 4단계">
              {LEVEL_ORDER.map((lv) => (
                <li key={lv} data-active={lv === h.level || undefined} data-tone={HEALTH_TONE[lv]} aria-current={lv === h.level ? 'true' : undefined}>
                  <StatusText tone={HEALTH_TONE[lv]} strong={lv === h.level}>
                    {HEALTH_LABELS[lv]}
                  </StatusText>
                  <span className="hscale__help">{LEVEL_HELP[lv]}</span>
                </li>
              ))}
            </ol>
            {h.reasons.length > 0 && (
              <div className="device__reasons">
                <p className="t-label">사유</p>
                <ul>
                  {h.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <DataList
            className="device__dl"
            items={[
              { term: '장치 ID', value: <span className="t-mono">{d.device_id}</span> },
              { term: '이름', value: d.device_name ?? '--' },
              {
                term: '연결',
                value: <StatusText tone={d.connection_status === 'online' ? 'ok' : d.connection_status === 'offline' ? 'critical' : 'unknown'}>{CONNECTION_LABELS[d.connection_status]}</StatusText>,
              },
              {
                term: '마지막 heartbeat',
                value: (
                  <span title={formatDateTime(d.last_seen)}>
                    <span className="num">{formatRelative(d.last_seen, now)}</span> <span className="t-mono muted">{formatTime(d.last_seen)}</span>
                  </span>
                ),
              },
              { term: '펌웨어', value: <span className="t-mono">{d.firmware_version ?? '--'}</span> },
              {
                term: '하드웨어 모드',
                value: health?.hardware_mode ? (health.hardware_mode === 'SIMULATOR' ? <Tag tone="sim">시뮬레이터 (내장 가상 장치)</Tag> : '실제 ESP32') : <span className="muted">서버가 보고하지 않음</span>,
                note: health?.simulator_running === undefined ? undefined : `가상 장치 ${health.simulator_running ? '실행 중' : '정지'}`,
              },
              {
                term: '장치 오류',
                value: d.error_code ? (
                  <StatusText tone="warning">
                    {DEVICE_ERROR_LABELS[d.error_code] ?? '장치 오류'} <code className="t-mono cmd-err__code">{d.error_code}</code>
                  </StatusText>
                ) : (
                  <span className="muted">없음</span>
                ),
              },
              {
                term: '데이터 출처',
                value: d.data_source === 'simulator' ? <Tag tone="sim">시뮬레이터</Tag> : d.data_source === 'hardware' ? '하드웨어 (ESP32)' : '--',
              },
              { term: '운전 모드', value: d.operating_mode === 'AUTO' ? '자동' : '수동' },
              {
                term: '긴급 정지',
                value: <StatusText tone={d.estop_active ? 'critical' : 'ok'}>{d.estop_active ? '활성 — 모든 모터 명령 거부' : '해제'}</StatusText>,
              },
              { term: '동작', value: d.busy ? '명령 수행 중' : '대기' },
              {
                term: '서버 ↔ 브로커',
                value: healthError ? (
                  <StatusText tone="critical">확인 실패</StatusText>
                ) : health ? (
                  <StatusText tone={health.mqtt ? 'ok' : 'critical'}>{health.mqtt ? 'MQTT 연결' : 'MQTT 끊김'}</StatusText>
                ) : (
                  <span className="muted">확인 중</span>
                ),
                note: healthError ?? (health ? `DB ${health.database ? '정상' : '오류'} · /health` : undefined),
              },
              {
                term: '센서 건강',
                value: (
                  <ul className="sensor-list">
                    {own.map((b) => (
                      <li key={b.bin_id}>
                        <MaterialCode type={b.waste_type} size="sm" />
                        <span className="sr-only">{WASTE_LABELS[b.waste_type]}</span>
                        <StatusText tone={b.sensor_status === 'normal' ? 'ok' : b.sensor_status ? 'critical' : 'unknown'}>
                          {b.sensor_status ? SENSOR_STATUS_LABELS[b.sensor_status] : '--'}
                        </StatusText>
                      </li>
                    ))}
                  </ul>
                ),
                note: `${h.sensorsOk} / ${h.sensorsTotal} 정상`,
              },
              {
                term: '센서 가용률 (24시간)',
                value: stats ? (
                  <ul className="sensor-list">
                    {stats.bins.map((b) => (
                      <li key={b.bin_id}>
                        <MaterialCode type={b.waste_type} size="sm" />
                        <span className="num">{b.sample_count ? `${(((b.sample_count - b.error_count) / b.sample_count) * 100).toFixed(1)}%` : '표본 없음'}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="muted">확인 중</span>
                ),
                note: stats ? `정상 표본 / 전체 표본 · 표본 ${formatCount(stats.bins.reduce((a, b) => a + b.sample_count, 0))}개` : undefined,
              },
              {
                term: '모터 건강',
                value: h.lastMotorResult ? (
                  <span className="motor">
                    <CommandStatusText status={h.lastMotorResult.status} />
                    <span className="muted">
                      마지막 배출 {h.lastMotorResult.target ? WASTE_LABELS[h.lastMotorResult.target as keyof typeof WASTE_LABELS] ?? h.lastMotorResult.target : ''} ·{' '}
                      <span className="t-mono">{formatTime(h.lastMotorResult.executed_at ?? h.lastMotorResult.requested_at)}</span>
                    </span>
                  </span>
                ) : (
                  <span className="muted">최근 배출 기록 없음</span>
                ),
                note: '서보 위치 센서 없음 — 마지막 배출 명령의 ACK 결과 기준',
              },
              {
                term: '마지막 분류 수신',
                value: lastDetection ? (
                  <span title={formatDateTime(lastDetection.received_at)}>
                    <span className="num">{formatRelative(lastDetection.received_at, now)}</span> <span className="t-mono muted">{formatTime(lastDetection.received_at)}</span>
                  </span>
                ) : (
                  <span className="muted">아직 분류 기록 없음</span>
                ),
                note: 'AI 분류 프로그램은 상태 신호가 없어 연결 여부를 표시하지 않습니다',
              },
            ]}
          />
        </div>
      </Section>
    </div>
  );
}
