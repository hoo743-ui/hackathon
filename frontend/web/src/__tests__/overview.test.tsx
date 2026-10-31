import { act, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from '../App';
import { DashboardProvider } from '../data/DashboardContext';
import { createMockSource } from '../data/source';
import { makeBin, makeCommand, makeDashboard, makeDetection, makeDevice, makeTestSource } from './helpers';
import { openSocket, renderApp } from './renderApp';

const readout = (el: HTMLElement) => within(el).getByTestId('fill-readout');

describe('개요 화면', () => {
  it('초기 로드 시 4개의 수거함 컬럼을 렌더링한다', async () => {
    renderApp();
    const cells = await screen.findAllByTestId(/^bin-card-/);
    expect(cells).toHaveLength(4);
    const pl = screen.getByTestId('bin-card-BIN_001');
    expect(readout(pl)).toHaveTextContent('42.0%');
    expect(within(pl).getByText('플라스틱')).toBeInTheDocument();
    expect(within(pl).getByText('PL')).toBeInTheDocument();
    expect(within(pl).getByRole('meter')).toHaveAttribute('aria-valuenow', '42');
  });

  it('WebSocket (재)연결 시 /api/dashboard 를 다시 조회한다', async () => {
    const t = renderApp();
    await screen.findByTestId('bin-card-BIN_001');
    expect(t.api.dashboard).toHaveBeenCalledTimes(1);
    await openSocket(t);
    expect(screen.getByTestId('ws-indicator')).toHaveTextContent('실시간 연결됨');
  });

  it('bins.updated 이벤트로 컬럼이 갱신된다', async () => {
    const t = renderApp();
    await screen.findByTestId('bin-card-BIN_001');
    await openSocket(t);
    act(() =>
      t.latest().emit({
        type: 'bins.updated',
        data: [makeBin({ bin_id: 'BIN_001', waste_type: 'plastic', current_fill_percent: 96, is_full: true, current_distance_cm: 6.5 })],
        sent_at: '2026-10-31T10:00:05.000Z',
      }),
    );
    const cell = screen.getByTestId('bin-card-BIN_001');
    expect(readout(cell)).toHaveTextContent('96.0%');
    expect(within(cell).getByText('6.5 cm')).toBeInTheDocument();
    expect(within(cell).getByText(/가득 참/)).toBeInTheDocument();
    expect(cell).toHaveAttribute('data-level', 'critical');
    expect(readout(screen.getByTestId('bin-card-BIN_002'))).toHaveTextContent('10.0%');
  });

  it('연결이 끊기면 연결 끊김 표시가 나타난다', async () => {
    const t = renderApp();
    await screen.findByTestId('bin-card-BIN_001');
    await openSocket(t);
    expect(screen.queryByTestId('connection-lost')).not.toBeInTheDocument();
    act(() => t.latest().drop());
    expect(await screen.findByTestId('connection-lost')).toHaveTextContent('실시간 연결이 끊어졌습니다');
    expect(screen.getByTestId('ws-indicator')).toHaveTextContent('실시간 연결 끊김');
  });

  it('적재율 null 은 0% 가 아니라 "--" 와 "미보정" 으로 표시한다', async () => {
    renderApp();
    const cell = await screen.findByTestId('bin-card-BIN_004');
    expect(readout(cell)).toHaveTextContent('--');
    expect(within(cell).getAllByText(/미보정/).length).toBeGreaterThan(0);
    expect(cell.textContent).not.toMatch(/(^|\D)0%/);
  });

  it('보정은 되었지만 유효 측정이 없으면 "측정값 없음" 으로 표시한다', async () => {
    const d = makeDashboard();
    d.bins[1] = makeBin({ bin_id: 'BIN_002', waste_type: 'metal', current_fill_percent: null, calibrated: true, sensor_status: 'timeout' });
    renderApp(makeTestSource(d));
    const cell = await screen.findByTestId('bin-card-BIN_002');
    expect(within(cell).getAllByText('측정값 없음').length).toBeGreaterThan(0);
    expect(cell.textContent).not.toMatch(/(^|\D)0%/);
    expect(within(cell).getByTestId('sensor-status')).toHaveTextContent('응답 없음');
  });

  it('command.updated 이벤트로 ACK 결과를 표시한다', async () => {
    const t = renderApp();
    await screen.findByTestId('bin-card-BIN_001');
    expect(within(screen.getByTestId('command-cmd-1')).getByText('전송됨 · ACK 대기')).toBeInTheDocument();
    await openSocket(t);
    act(() =>
      t.latest().emit({
        type: 'command.updated',
        data: makeCommand({ status: 'SUCCEEDED', executed_at: '2026-10-31T10:00:01.000Z', result_message: '플라스틱 투입구 열림' }),
        sent_at: '2026-10-31T10:00:01.000Z',
      }),
    );
    const item = screen.getByTestId('command-cmd-1');
    expect(within(item).getByText('실행 완료')).toBeInTheDocument();
    expect(within(item).getByText('플라스틱 투입구 열림')).toBeInTheDocument();
  });

  it('점검 필요는 deriveAlerts 결과를 심각도 순으로 표시한다', async () => {
    const d = makeDashboard();
    d.bins[0] = makeBin({ bin_id: 'BIN_001', waste_type: 'plastic', current_fill_percent: 97, is_full: true });
    renderApp(makeTestSource(d));
    const list = await screen.findByRole('list', { name: '점검 필요' });
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveAttribute('data-testid', 'alert-bin_full');
    expect(within(list).getByText(/플라스틱 97.0% — 비움 필요/)).toBeInTheDocument();
    expect(within(list).getByText(/종이 85.0% — 곧 비움 필요/)).toBeInTheDocument();
    expect(within(list).getByText(/유리 보정 필요/)).toBeInTheDocument();
    expect(screen.getByTestId('attention-count')).toHaveTextContent('2건');
  });

  it('점검할 항목이 없으면 "없음" 으로 표시한다', async () => {
    const d = makeDashboard({ recent_commands: [] });
    d.bins = d.bins.slice(0, 2);
    renderApp(makeTestSource(d));
    expect(await screen.findByText('점검할 항목 없음')).toBeInTheDocument();
    expect(screen.getByTestId('attention-count')).toHaveTextContent('없음');
  });

  it('오늘 분류 건수는 오늘 0시(로컬) 이후 요약 API 값을 그대로 표시한다', async () => {
    const t = makeTestSource(makeDashboard({ recent_detections: [makeDetection({ id: 3, waste_type: 'paper', confidence: 0.876, outcome: 'LOW_CONFIDENCE' })] }));
    t.api.detectionSummary.mockImplementation(async (since: string) => ({ since, total: 12, by_waste_type: {}, by_outcome: {}, avg_confidence: 0.8 }));
    renderApp(t);
    await waitFor(() => expect(screen.getByTestId('today-count')).toHaveTextContent('12건'));
    const since = new Date(t.api.detectionSummary.mock.calls[0][0]);
    expect(since.getHours()).toBe(0);
    expect(since.getMinutes()).toBe(0);
    expect(since.toDateString()).toBe(new Date().toDateString());
    const row = screen.getByTestId('detection-3');
    expect(row).toHaveTextContent('0.88');
    expect(row).toHaveTextContent('신뢰도 낮음');
    expect(row).toHaveTextContent('시뮬레이터');
  });

  it('분류 기록이 없으면 "아직 분류 기록 없음"', async () => {
    renderApp();
    expect((await screen.findAllByText(/아직 분류 기록 없음/)).length).toBeGreaterThan(0);
  });

  it('simulator 장치 데이터에는 시뮬레이터 표시를, 하드웨어에는 표시하지 않는다', async () => {
    renderApp();
    await screen.findByTestId('bin-card-BIN_001');
    expect(screen.queryByTestId('sim-tag')).not.toBeInTheDocument();
    renderApp(makeTestSource(makeDashboard({ devices: [makeDevice({ data_source: 'simulator' })] })));
    expect(await screen.findByTestId('sim-tag')).toHaveTextContent('시뮬레이터 데이터');
  });

  it('서버가 SIMULATOR 하드웨어 모드면 장치 출처와 무관하게 시뮬레이터 표시를 한다', async () => {
    renderApp(makeTestSource(makeDashboard({ hardware_mode: 'SIMULATOR' })));
    expect(await screen.findByTestId('sim-tag')).toHaveTextContent('시뮬레이터 데이터');
  });

  it('ESP32_REAL 모드 + 하드웨어 장치면 시뮬레이터 표시가 없다', async () => {
    renderApp(makeTestSource(makeDashboard({ hardware_mode: 'ESP32_REAL' })));
    await screen.findByTestId('bin-card-BIN_001');
    expect(screen.queryByTestId('sim-tag')).not.toBeInTheDocument();
  });

  it('명령 오류 코드는 한국어 문구와 원시 코드를 함께 보여준다', async () => {
    renderApp(makeTestSource(makeDashboard({ recent_commands: [makeCommand({ status: 'FAILED', error_message: 'PINMAP_UNCONFIRMED' })] })));
    const item = await screen.findByTestId('command-cmd-1');
    expect(within(item).getByText(/핀맵 미확정/)).toBeInTheDocument();
    expect(within(item).getByText('PINMAP_UNCONFIRMED')).toBeInTheDocument();
  });

  it('mock 모드: 가짜 데이터 소스로 4개 컬럼과 Mock 표시를 보여준다', async () => {
    const source = createMockSource();
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <DashboardProvider source={source}>
          <AppRoutes mode="mock" />
        </DashboardProvider>
      </MemoryRouter>,
    );
    expect(await screen.findAllByTestId(/^bin-card-/)).toHaveLength(4);
    expect(screen.getByTestId('sim-tag')).toHaveTextContent('Mock 데이터');
    expect(readout(screen.getByTestId('bin-card-BIN_004'))).toHaveTextContent('--');
  });
});
