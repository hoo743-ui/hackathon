import { Link } from 'react-router-dom';
import { HEALTH_LABELS, deriveAlerts, deviceHealth, needsAttention } from '@shared';
import { useDashboard } from '../data/DashboardContext';
import { HEALTH_TONE } from '../components/AppShell';
import { EventLog } from '../components/commands';
import { RecentDetections } from '../components/detections';
import { DetectionStrip, EdgeStatusPanel, LiveDetection } from '../components/live';
import { Readout } from '../components/material';
import { AlertList, BinColumnCell } from '../components/overview';
import { LoadingState, PageHeader, Section, StatusText } from '../components/primitives';
import { formatClock, formatRelative, formatTime } from '../lib/format';
import { localMidnightIso } from '../lib/sortingQuery';
import { useAsync } from '../lib/useAsync';
import { useNow } from '../lib/useNow';

/**
 * 개요 (SERVICE_RESTRUCTURE §3): ① 장치 상태 ② 칸별 적재 ③ AI 분류 ④ 점검 필요 ⑤ 기록.
 * KPI 카드 대신 한 줄짜리 상태 장부(ledger) → 컬럼 → 분류/알림 → 로그 순서.
 */
export function OverviewPage() {
  const { dashboard, api, lastUpdateAt } = useDashboard();
  const now = useNow();
  const minute = useNow(60_000);
  const latestDetection = dashboard?.recent_detections?.[0]?.id;
  // 오늘 0시 이후 분류 집계 — 새 분류가 들어오면 다시 조회
  const today = useAsync(() => api.detectionSummary(localMidnightIso()), [api, latestDetection, minute]);

  if (!dashboard) {
    return (
      <div className="page">
        <PageHeader title="개요" />
        <LoadingState />
      </div>
    );
  }

  const device = dashboard.devices[0];
  const bins = dashboard.bins;
  const detections = dashboard.recent_detections ?? [];
  const health = deviceHealth(device, bins, dashboard.recent_commands);
  const alerts = deriveAlerts(dashboard, now);
  const attention = needsAttention(alerts);
  const urgent = alerts.filter((a) => a.severity !== 'info').length;
  const last = detections[0];

  return (
    <div className="page page--overview">
      <PageHeader title="개요" meta={lastUpdateAt ? <span className="t-mono">기준 시각 {formatClock(lastUpdateAt)}</span> : null} />

      <dl className="status-ledger" aria-label="현재 상태 요약">
        <div className="status-ledger__cell status-ledger__cell--device">
          <dt>장치</dt>
          <dd>
            <StatusText tone={HEALTH_TONE[health.level]} strong>
              {HEALTH_LABELS[health.level]}
            </StatusText>
            <span className="status-ledger__sub">
              {health.reasons.length ? health.reasons.join(' · ') : `${device?.device_id ?? '--'} · 수신 ${formatRelative(device?.last_seen, now)}`}
            </span>
          </dd>
        </div>
        <div className="status-ledger__cell">
          <dt>운전 모드</dt>
          <dd>
            {dashboard.hardware_mode === 'EDGE_SERIAL' ? (
              <>
                <span className="status-ledger__val">카메라 노트북 자동</span>
                <span className="status-ledger__sub">YOLO 결과 → USB 시리얼 → 아두이노</span>
              </>
            ) : (
              <>
                <span className="status-ledger__val">{device ? (device.operating_mode === 'AUTO' ? '자동' : '수동') : '--'}</span>
                <span className="status-ledger__sub">{device?.operating_mode === 'AUTO' ? 'AI 분류 결과로 배출' : '관리자 조작'}</span>
              </>
            )}
          </dd>
        </div>
        <div className="status-ledger__cell" data-testid="today-count">
          <dt>오늘 분류</dt>
          <dd>
            {today.data ? (
              <Readout value={today.data.total.toLocaleString('ko-KR')} unit="건" size="md" label={`오늘 분류 ${today.data.total}건`} />
            ) : today.error ? (
              <span className="muted">집계 실패</span>
            ) : (
              <span className="muted">…</span>
            )}
            <span className="status-ledger__sub" title={last ? formatTime(last.received_at) : undefined}>
              {last ? `마지막 분류 수신 ${formatRelative(last.received_at, now)}` : '아직 분류 기록 없음'}
            </span>
          </dd>
        </div>
        <div className="status-ledger__cell" data-testid="attention-count" data-attention={attention || undefined}>
          <dt>점검 필요</dt>
          <dd>
            {attention ? (
              <StatusText tone={alerts[0].severity === 'critical' ? 'critical' : 'warning'} strong>
                {urgent}건
              </StatusText>
            ) : (
              <StatusText tone="ok">없음</StatusText>
            )}
            <span className="status-ledger__sub">{alerts.length - urgent > 0 ? `참고 ${alerts.length - urgent}건 별도` : '심각·경고 알림 기준'}</span>
          </dd>
        </div>
      </dl>

      <div className="ov-live ov-grid">
        <Section title="실시간 인식" className="ov-live__main" aside={<Link to="/sorting">분류 기록</Link>}>
          <LiveDetection key={last?.id ?? 'none'} d={last} now={now} />
          <DetectionStrip items={detections} />
        </Section>
        <Section title="카메라 노트북 · 센서" className="ov-live__edge">
          <EdgeStatusPanel edges={dashboard.edges ?? []} fullAlert={dashboard.latest_full_alert} now={now} />
        </Section>
      </div>

      <div className="ov-grid">
        <Section title="수거함" className="ov-bins" aside={<Link to="/bins">전체 보기</Link>}>
          <div className="bincells">
            {bins.map((b) => (
              <BinColumnCell key={b.bin_id} bin={b} now={now} />
            ))}
          </div>
        </Section>

        <Section title="점검 필요" className="ov-alerts" aside={<Link to="/devices">장치</Link>}>
          <AlertList alerts={alerts} />
        </Section>

        <Section title="최근 분류" className="ov-sorting" aside={<Link to="/sorting">분류 기록</Link>}>
          <RecentDetections items={detections} />
        </Section>

        <Section title="최근 제어 · 오류" className="ov-events" aside={<Link to="/operations">운영</Link>}>
          <EventLog commands={dashboard.recent_commands} limit={6} />
        </Section>
      </div>
    </div>
  );
}
