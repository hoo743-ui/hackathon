import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeDetection, makeTestSource } from './helpers';
import { renderApp } from './renderApp';

describe('분류 기록', () => {
  it('URL 의 필터·정렬·페이지를 서버 쿼리로 변환한다', async () => {
    const t = makeTestSource();
    t.api.detections.mockImplementation(async (q) => ({ items: [makeDetection()], total: 120, limit: 50, offset: q?.offset ?? 0 }));
    renderApp(t, '/sorting?type=metal&outcome=SORT_FAILED&source=simulator&order=asc&page=2&period=24h');
    await waitFor(() => expect(t.api.detections).toHaveBeenCalled());
    const q = t.api.detections.mock.calls[0][0]!;
    expect(q).toMatchObject({ waste_type: 'metal', outcome: 'SORT_FAILED', source: 'simulator', order: 'asc', limit: 50, offset: 50 });
    expect(Date.now() - Date.parse(q.from!)).toBeGreaterThan(24 * 3_600_000 - 60_000);
    expect(await screen.findByTestId('pager-range')).toHaveTextContent('51–51 / 총 120');
  });

  it('필터를 바꾸면 URL 에 반영하고 1페이지부터 다시 조회한다', async () => {
    const t = makeTestSource();
    t.api.detections.mockImplementation(async (q) => ({
      items: Array.from({ length: 50 }, (_, i) => makeDetection({ id: i + 1 + (q?.offset ?? 0) })),
      total: 130,
      limit: 50,
      offset: q?.offset ?? 0,
    }));
    renderApp(t, '/sorting');
    await screen.findByTestId('detection-table');
    const first = t.api.detections.mock.calls[0][0]!;
    expect(first).toMatchObject({ order: 'desc', offset: 0 });
    expect(new Date(first.from!).getHours()).toBe(0); // 기본 기간 = 오늘

    fireEvent.click(screen.getByRole('button', { name: '다음 페이지' }));
    await waitFor(() => expect(t.api.detections).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 })));
    expect(screen.getByTestId('location')).toHaveTextContent('/sorting?page=2');

    fireEvent.change(screen.getByLabelText('처리 결과'), { target: { value: 'LOW_CONFIDENCE' } });
    await waitFor(() => expect(t.api.detections).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: 'LOW_CONFIDENCE', offset: 0 })));
    expect(screen.getByTestId('location')).toHaveTextContent('/sorting?outcome=LOW_CONFIDENCE');

    fireEvent.change(screen.getByLabelText('종류'), { target: { value: 'paper' } });
    await waitFor(() => expect(t.api.detections).toHaveBeenLastCalledWith(expect.objectContaining({ waste_type: 'paper' })));
  });

  it('신뢰도는 모델 값 그대로(소수 2자리), 시뮬레이터는 표시, 요약은 재질·결과별 건수', async () => {
    const t = makeTestSource();
    t.api.detections.mockResolvedValue({ items: [makeDetection({ confidence: 0.4567, outcome: 'SORT_FAILED', outcome_detail: 'MOTION_TIMEOUT' })], total: 1, limit: 50, offset: 0 });
    t.api.detectionSummary.mockImplementation(async (since) => ({ since, total: 5, by_waste_type: { metal: 3, paper: 2 }, by_outcome: { SORTED: 4, LOW_CONFIDENCE: 1 }, avg_confidence: 0.81 }));
    renderApp(t, '/sorting');
    const table = await screen.findByTestId('detection-table');
    expect(within(table).getByText('0.46')).toBeInTheDocument();
    expect(within(table).getByText('시뮬레이터')).toBeInTheDocument();
    expect(within(table).getByText(/모터 동작 시간 초과/)).toBeInTheDocument();
    expect(within(table).getByText('MOTION_TIMEOUT')).toBeInTheDocument();
    const sum = await screen.findByTestId('summary');
    expect(sum).toHaveTextContent('5건');
    expect(within(sum).getByLabelText('재질별 건수')).toHaveTextContent('3');
    expect(within(sum).getByLabelText('처리 결과별 건수')).toHaveTextContent('분류 완료');
  });

  it('기록이 없으면 "아직 분류 기록 없음"', async () => {
    renderApp(makeTestSource(), '/sorting');
    expect((await screen.findAllByText(/아직 분류 기록 없음/)).length).toBeGreaterThanOrEqual(2);
  });
});
