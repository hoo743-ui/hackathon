import { act, render, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { expect } from 'vitest';
import { AppRoutes } from '../App';
import { DashboardProvider } from '../data/DashboardContext';
import { ControlTokenProvider } from '../lib/controlToken';
import { ThemeProvider } from '../lib/theme';
import { makeTestSource } from './helpers';

export type TestSource = ReturnType<typeof makeTestSource>;

/** 현재 URL 을 DOM 에 노출 (쿼리 반영 검증용) */
function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="location">{loc.pathname + loc.search}</output>;
}

export function renderApp(t: TestSource = makeTestSource(), path = '/', opts: { token?: string } = {}) {
  render(
    <ThemeProvider>
      <ControlTokenProvider initial={opts.token ?? ''}>
        <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <DashboardProvider source={t.source}>
            <AppRoutes mode={t.source.mode} />
            <LocationProbe />
          </DashboardProvider>
        </MemoryRouter>
      </ControlTokenProvider>
    </ThemeProvider>,
  );
  return t;
}

/** 소켓을 열고 onResync 로 인한 스냅샷 재조회가 반영될 때까지 기다린다 */
export async function openSocket(t: TestSource) {
  act(() => t.latest().open());
  await waitFor(() => expect(t.api.dashboard).toHaveBeenCalledTimes(2));
  await act(async () => {});
}
