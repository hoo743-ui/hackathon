import { useEffect, useId, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Archive, Cpu, Gauge, LayoutGrid, Menu, ScanLine, Settings2, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { HEALTH_LABELS, deviceHealth } from '@shared';
import type { HealthLevel, RealtimeState } from '@shared';
import type { DataMode } from '../config';
import { useDashboard } from '../data/DashboardContext';
import { useControlToken } from '../lib/controlToken';
import { formatRelative, formatTime } from '../lib/format';
import { THEME_LABELS, useTheme } from '../lib/theme';
import type { ThemePref } from '../lib/theme';
import { useNow } from '../lib/useNow';
import { useFocusTrap } from './Dialog';
import { Button, DataSourceTag, Notice, Segmented, StatusDot } from './primitives';
import type { Tone } from './primitives';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: '개요', icon: LayoutGrid, end: true },
  { to: '/bins', label: '수거함', icon: Archive },
  { to: '/sorting', label: '분류 기록', icon: ScanLine },
  { to: '/devices', label: '장치', icon: Cpu },
  { to: '/operations', label: '운영', icon: Gauge },
];

export const HEALTH_TONE: Record<HealthLevel, Tone> = {
  healthy: 'ok',
  degraded: 'warning',
  offline: 'critical',
  unknown: 'unknown',
};

const WS_LABELS: Record<RealtimeState, string> = {
  connecting: '실시간 연결 중…',
  open: '실시간 연결됨',
  closed: '실시간 연결 끊김',
};
const WS_TONE: Record<RealtimeState, Tone> = { connecting: 'unknown', open: 'ok', closed: 'critical' };

function pageTitle(pathname: string): string {
  const hit = [...NAV_ITEMS].reverse().find((n) => (n.end ? pathname === n.to : pathname.startsWith(n.to)));
  return hit?.label ?? '페이지 없음';
}

function BrandMark() {
  // 네 재질색 정사각형 = 네 개의 수거함 (장식이 아니라 재질 체계를 요약)
  return (
    <span className="brand__mark" aria-hidden>
      <i data-material="plastic" />
      <i data-material="metal" />
      <i data-material="paper" />
      <i data-material="glass" />
    </span>
  );
}

function NavList({ onNavigate, rail }: { onNavigate?: () => void; rail?: boolean }) {
  return (
    <ul className="nav">
      {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
        <li key={to}>
          <NavLink to={to} end={end} className="nav__link" onClick={onNavigate} aria-label={rail ? label : undefined} title={rail ? label : undefined}>
            <Icon size={18} strokeWidth={1.75} aria-hidden />
            <span className="nav__label">{label}</span>
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

export interface ModeProps {
  mode: DataMode;
  onModeChange?: (m: DataMode) => void;
}

/** 헤더 메뉴: 화면 테마 · 데이터 출처 · 제어 토큰 (브라우저에만 저장되는 앱 설정) */
export function HeaderMenu({ mode, onModeChange }: ModeProps) {
  const [open, setOpen] = useState(false);
  const { pref, setPref } = useTheme();
  const { token, setToken } = useControlToken();
  const [show, setShow] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useFocusTrap(open, () => setOpen(false));
  const tokenId = useId();
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, panelRef]);

  return (
    <div className="hmenu">
      <button
        ref={btnRef}
        type="button"
        className="icon-btn hmenu__btn"
        aria-label="앱 설정"
        title="앱 설정 (테마 · 데이터 출처 · 제어 토큰)"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <Settings2 size={18} strokeWidth={1.75} aria-hidden />
        {!token.trim() && <span className="hmenu__flag" aria-hidden />}
      </button>
      {open && (
        <div ref={panelRef} id={panelId} className="hmenu__panel" role="dialog" aria-label="앱 설정" tabIndex={-1}>
          <div className="pref">
            <span className="t-label">화면 테마</span>
            <Segmented<ThemePref>
              label="화면 테마"
              size="sm"
              value={pref}
              options={(['light', 'dark', 'system'] as ThemePref[]).map((v) => ({ value: v, label: THEME_LABELS[v] }))}
              onChange={setPref}
            />
          </div>
          {onModeChange && (
            <div className="pref">
              <span className="t-label">데이터 출처</span>
              <Segmented<DataMode>
                label="데이터 출처"
                size="sm"
                value={mode}
                options={[
                  { value: 'live', label: '실제 서버' },
                  { value: 'mock', label: 'Mock' },
                ]}
                onChange={onModeChange}
              />
              <span className="t-caption">Mock 은 브라우저 안의 가짜 데이터입니다 (상단에 항상 표시).</span>
            </div>
          )}
          <div className="pref">
            <label className="t-label" htmlFor={tokenId}>
              제어 토큰
            </label>
            <div className="field__row">
              <input
                id={tokenId}
                type={show ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                placeholder="API_CONTROL_TOKEN"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <Button size="sm" onClick={() => setShow((v) => !v)} aria-pressed={show}>
                {show ? '숨기기' : '보기'}
              </Button>
            </div>
            <span className="t-caption">제어 명령·보정·점검 기록 저장에 사용. 이 브라우저에만 저장됩니다. {token.trim() ? '설정됨' : '설정되지 않음'}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function SourceFoot() {
  const { dashboard, source, simulated } = useDashboard();
  const device = dashboard?.devices[0];
  return (
    <div className="side-foot">
      <span className="t-caption">장치</span>
      <span className="t-mono side-foot__id">{device?.device_id ?? '--'}</span>
      <span className="t-caption">데이터 출처</span>
      <span className="side-foot__val">{source.mode === 'mock' ? 'Mock (브라우저)' : simulated ? '시뮬레이터' : device ? '하드웨어' : '--'}</span>
    </div>
  );
}

function OperationalHeader({ onMenu, mode, onModeChange }: { onMenu: () => void } & ModeProps) {
  const { dashboard, ws, simulated, source } = useDashboard();
  const { pathname } = useLocation();
  const now = useNow();
  const device = dashboard?.devices[0];
  const health = deviceHealth(device, dashboard?.bins ?? [], dashboard?.recent_commands ?? []);
  const title = pageTitle(pathname);

  return (
    <header className="topbar">
      <button type="button" className="topbar__menu icon-btn" onClick={onMenu} aria-label="메뉴 열기">
        <Menu size={20} strokeWidth={1.75} aria-hidden />
      </button>
      <span className="topbar__title">{title}</span>
      <div className="topbar__status">
        <span className="hstat" data-testid="device-indicator" title={health.reasons.join(' · ') || undefined}>
          <StatusDot tone={HEALTH_TONE[health.level]} />
          <span className="hstat__label">
            <span className="hide-sm">장치 </span>
            {HEALTH_LABELS[health.level]}
          </span>
        </span>
        <span className="hstat hide-xs" title={device?.last_seen ? formatTime(device.last_seen) : undefined}>
          <span className="hstat__muted">수신</span>
          <span className="num">{formatRelative(device?.last_seen, now)}</span>
          <span className="hstat__muted t-mono hide-md">{device?.last_seen ? formatTime(device.last_seen) : ''}</span>
        </span>
        <span className="hstat" data-testid="ws-indicator" role="status" aria-live="polite" data-state={ws}>
          <StatusDot tone={WS_TONE[ws]} />
          <span className="hstat__label hide-xs">{WS_LABELS[ws]}</span>
          <span className="sr-only show-xs">{WS_LABELS[ws]}</span>
        </span>
        {simulated && <DataSourceTag mock={source.mode === 'mock'} />}
        <HeaderMenu mode={mode} onModeChange={onModeChange} />
      </div>
    </header>
  );
}

function Drawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useFocusTrap(open, onClose);
  if (!open) return null;
  return (
    <div className="overlay overlay--drawer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="drawer" role="dialog" aria-modal="true" aria-label="주 메뉴" tabIndex={-1}>
        <div className="drawer__head">
          <span className="brand">
            <BrandMark />
            <span className="brand__name">스마트 분리수거</span>
          </span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="메뉴 닫기">
            <X size={20} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
        <nav aria-label="주 메뉴">
          <NavList onNavigate={onClose} />
        </nav>
        <div className="drawer__foot">
          <SourceFoot />
        </div>
      </div>
    </div>
  );
}

export function AppShell({ mode, onModeChange }: ModeProps) {
  const { ws, error } = useDashboard();
  const [drawer, setDrawer] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setDrawer(false), [pathname]);

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        본문으로 건너뛰기
      </a>
      <aside className="sidebar">
        <div className="brand">
          <BrandMark />
          <span className="brand__name">스마트 분리수거</span>
        </div>
        <nav aria-label="주 메뉴">
          <NavList rail />
        </nav>
        <SourceFoot />
      </aside>

      <div className="main-col">
        <OperationalHeader onMenu={() => setDrawer(true)} mode={mode} onModeChange={onModeChange} />
        {(ws === 'closed' || error) && (
          <div className="banners">
            {ws === 'closed' && (
              <Notice tone="critical" role="alert" testId="connection-lost">
                실시간 연결이 끊어졌습니다. 자동으로 재연결을 시도합니다. 표시된 값은 최신이 아닐 수 있습니다.
              </Notice>
            )}
            {error && (
              <Notice tone="warning" role="alert">
                데이터를 불러오지 못했습니다: {error}
              </Notice>
            )}
          </div>
        )}
        <main id="main" className="main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
      <Drawer open={drawer} onClose={() => setDrawer(false)} />
    </div>
  );
}
