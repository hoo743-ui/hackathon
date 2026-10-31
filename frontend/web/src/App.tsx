import { useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { config, type DataMode } from './config';
import { DashboardProvider } from './data/DashboardContext';
import { createDataSource } from './data/source';
import type { DataSource } from './data/source';
import { ControlTokenProvider } from './lib/controlToken';
import { getDataModeOverride, setDataModeOverride } from './lib/storage';
import { ThemeProvider } from './lib/theme';
import { AppShell } from './components/AppShell';
import { OverviewPage } from './pages/OverviewPage';
import { BinsPage } from './pages/BinsPage';
import { BinDetailPage } from './pages/BinDetailPage';
import { DevicesPage } from './pages/DevicesPage';
import { OperationsPage } from './pages/OperationsPage';
import { SortingPage } from './pages/SortingPage';
import { NotFoundPage } from './pages/NotFoundPage';

/** 경로 이동 시 맨 위로, #앵커가 있으면 해당 섹션으로 스크롤 */
function ScrollManager() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      const el = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (el) {
        el.scrollIntoView?.({ block: 'start' });
        return;
      }
    }
    window.scrollTo?.(0, 0);
  }, [pathname, hash]);
  return null;
}

export function AppRoutes({ mode, onModeChange }: { mode: DataMode; onModeChange?: (m: DataMode) => void }) {
  return (
    <>
      <ScrollManager />
      <Routes>
        <Route element={<AppShell mode={mode} onModeChange={onModeChange} />}>
          <Route index element={<OverviewPage />} />
          <Route path="bins" element={<BinsPage />} />
          <Route path="bins/:binId" element={<BinDetailPage />} />
          <Route path="sorting" element={<SortingPage />} />
          <Route path="devices" element={<DevicesPage />} />
          <Route path="operations" element={<OperationsPage />} />
          {/* 이전 메뉴 경로 (SERVICE_RESTRUCTURE §3) */}
          <Route path="control" element={<Navigate to="/operations" replace />} />
          <Route path="history" element={<Navigate to="/sorting" replace />} />
          <Route path="analytics" element={<Navigate to="/bins" replace />} />
          <Route path="settings" element={<Navigate to="/devices" replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </>
  );
}

export function App({ initialSource }: { initialSource?: DataSource }) {
  // 우선순위: 화면에서 고른 값(localStorage) > VITE_DATA_MODE > live
  const [mode, setMode] = useState<DataMode>(() => initialSource?.mode ?? getDataModeOverride() ?? config.defaultDataMode);
  const source = useMemo(() => (initialSource && initialSource.mode === mode ? initialSource : createDataSource(mode)), [mode, initialSource]);

  const changeMode = (m: DataMode) => {
    setDataModeOverride(m === config.defaultDataMode ? null : m);
    setMode(m);
  };

  return (
    <ThemeProvider>
      <ControlTokenProvider>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <DashboardProvider key={mode} source={source}>
            <AppRoutes mode={mode} onModeChange={changeMode} />
          </DashboardProvider>
        </BrowserRouter>
      </ControlTokenProvider>
    </ThemeProvider>
  );
}
