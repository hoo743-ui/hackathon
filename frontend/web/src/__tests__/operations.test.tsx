import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeCommand, makeDashboard, makeDevice, makeTestSource } from './helpers';
import { openSocket, renderApp } from './renderApp';

const TOKEN = 'test-token';

function setup(device = makeDevice({ operating_mode: 'MANUAL' }), commands = [] as ReturnType<typeof makeCommand>[]) {
  const t = makeTestSource(makeDashboard({ devices: [device], recent_commands: commands }));
  return t;
}

const progress = () => screen.getByTestId('command-progress');

describe('운영', () => {
  it('긴급 정지는 한 번 누르면 확인 없이 즉시 EMERGENCY_STOP 을 보낸다', async () => {
    const t = renderApp(setup(), '/operations', { token: TOKEN });
    const btn = await screen.findByRole('button', { name: '긴급 정지' });
    fireEvent.click(btn);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => expect(t.api.sendCommand).toHaveBeenCalledTimes(1));
    expect(t.api.sendCommand).toHaveBeenCalledWith('DEVICE_001', expect.objectContaining({ command: 'EMERGENCY_STOP', target: null, command_id: expect.any(String) }));
    expect(t.tokens).toContain(TOKEN);
  });

  it('SUCCEEDED 전에는 "실행 완료" 를 표시하지 않는다', async () => {
    const t = renderApp(setup(), '/operations', { token: TOKEN });
    await screen.findByRole('button', { name: '긴급 정지' });
    await openSocket(t);
    t.api.sendCommand.mockResolvedValueOnce(makeCommand({ command_id: 'c-es', command: 'EMERGENCY_STOP', target: null, status: 'SENT' }));
    fireEvent.click(screen.getByRole('button', { name: '긴급 정지' }));
    await waitFor(() => expect(progress()).toHaveAttribute('data-status', 'SENT'));
    expect(within(progress()).getByTestId('command-outcome')).toHaveTextContent('장치 응답 대기 중');
    expect(within(progress()).queryByText(/실행 완료/)).not.toBeInTheDocument();

    act(() =>
      t.latest().emit({
        type: 'command.updated',
        data: makeCommand({ command_id: 'c-es', command: 'EMERGENCY_STOP', target: null, status: 'SUCCEEDED', executed_at: '2026-10-31T10:00:01.000Z' }),
        sent_at: '2026-10-31T10:00:01.000Z',
      }),
    );
    expect(within(progress()).getByTestId('command-outcome')).toHaveTextContent('실행 완료');
  });

  it('FAILED 와 TIMEOUT 은 사유와 함께 표시한다', async () => {
    const t = renderApp(setup(), '/operations', { token: TOKEN });
    await screen.findByRole('button', { name: '긴급 정지' });
    await openSocket(t);
    t.api.sendCommand.mockResolvedValueOnce(makeCommand({ command_id: 'c-1', command: 'GET_STATUS', target: null, status: 'SENT' }));
    fireEvent.click(screen.getByRole('button', { name: '상태 요청' }));
    await waitFor(() => expect(progress()).toHaveAttribute('data-status', 'SENT'));
    act(() =>
      t.latest().emit({
        type: 'command.updated',
        data: makeCommand({ command_id: 'c-1', command: 'GET_STATUS', target: null, status: 'FAILED', error_message: '서보 응답 없음' }),
        sent_at: '2026-10-31T10:00:02.000Z',
      }),
    );
    expect(within(progress()).getByTestId('command-outcome')).toHaveTextContent('실패');
    expect(within(progress()).getByText('서보 응답 없음')).toBeInTheDocument();
    expect(within(progress()).queryByText(/실행 완료/)).not.toBeInTheDocument();

    t.api.sendCommand.mockResolvedValueOnce(makeCommand({ command_id: 'c-2', command: 'GET_STATUS', target: null, status: 'SENT', requested_at: '2026-10-31T10:00:03.000Z' }));
    fireEvent.click(screen.getByRole('button', { name: '상태 요청' }));
    await waitFor(() => expect(progress()).toHaveAttribute('data-status', 'SENT'));
    act(() =>
      t.latest().emit({
        type: 'command.updated',
        data: makeCommand({ command_id: 'c-2', command: 'GET_STATUS', target: null, status: 'TIMEOUT', error_message: 'ACK_TIMEOUT', requested_at: '2026-10-31T10:00:03.000Z' }),
        sent_at: '2026-10-31T10:00:18.000Z',
      }),
    );
    expect(within(progress()).getByTestId('command-outcome')).toHaveTextContent('응답 시간 초과');
    expect(within(progress()).getByText('ACK_TIMEOUT')).toBeInTheDocument();
    expect(within(progress()).getByText(/장치 응답 시간 초과/)).toBeInTheDocument();
  });

  it('서버가 요청을 거부하면 오류 사유를 표시한다', async () => {
    const t = renderApp(setup(), '/operations', { token: TOKEN });
    const { ApiError } = await import('@shared');
    t.api.sendCommand.mockRejectedValueOnce(new ApiError(409, 'DEVICE_BUSY', 'busy'));
    fireEvent.click(await screen.findByRole('button', { name: '상태 요청' }));
    await waitFor(() => expect(progress()).toHaveAttribute('data-status', 'REJECTED'));
    expect(progress()).toHaveTextContent('장치가 다른 명령을 처리 중입니다');
  });

  it('배출구는 재질 선택 후 작동 버튼을 눌러야 OPEN_BIN 을 보낸다 (2단계 확인)', async () => {
    const t = renderApp(setup(), '/operations', { token: TOKEN });
    const radio = await screen.findByRole('radio', { name: /플라스틱/ });
    const act1 = screen.getByRole('button', { name: '배출구를 먼저 선택하세요' });
    expect(act1).toBeDisabled();
    fireEvent.click(radio);
    expect(t.api.sendCommand).not.toHaveBeenCalled();
    const confirm = screen.getByRole('button', { name: 'PL 플라스틱 배출구 작동' });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(t.api.sendCommand).toHaveBeenCalledTimes(1));
    expect(t.api.sendCommand).toHaveBeenCalledWith('DEVICE_001', expect.objectContaining({ command: 'OPEN_BIN', target: 'plastic' }));
  });

  it('비활성 사유를 표시한다: 자동 모드 / 토큰 없음 / 진행 중', async () => {
    renderApp(setup(makeDevice({ operating_mode: 'AUTO' })), '/operations', { token: TOKEN });
    expect(await screen.findByTestId('open-reason')).toHaveTextContent('자동 모드입니다');
    expect(screen.getByRole('radio', { name: /플라스틱/ })).toBeDisabled();
  });

  it('토큰이 없으면 모든 명령이 비활성이고 설정 링크를 안내한다', async () => {
    renderApp(setup(), '/operations', { token: '' });
    expect(await screen.findByTestId('no-token')).toHaveTextContent('앱 설정');
    expect(screen.getByRole('button', { name: '긴급 정지' })).toBeDisabled();
    expect(screen.getByText('제어 토큰이 설정되지 않았습니다.', { selector: '#estop-reason' })).toBeInTheDocument();
  });

  it('진행 중인 명령이 있으면 배출을 막는다', async () => {
    renderApp(setup(makeDevice({ operating_mode: 'MANUAL' }), [makeCommand({ status: 'SENT' })]), '/operations', { token: TOKEN });
    expect(await screen.findByTestId('open-reason')).toHaveTextContent('다른 명령을 처리 중');
  });

  it('긴급 정지 해제는 확인 대화상자를 거치고 Esc 로 취소할 수 있다', async () => {
    const t = renderApp(setup(makeDevice({ operating_mode: 'MANUAL', estop_active: true })), '/operations', { token: TOKEN });
    fireEvent.click(await screen.findByRole('button', { name: '긴급 정지 해제' }));
    const dialog = screen.getByRole('alertdialog', { name: '긴급 정지를 해제할까요?' });
    expect(within(dialog).getByRole('button', { name: '취소' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(t.api.sendCommand).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '긴급 정지 해제' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '해제' }));
    await waitFor(() => expect(t.api.sendCommand).toHaveBeenCalledWith('DEVICE_001', expect.objectContaining({ command: 'RESET_ESTOP' })));
  });

  it('자동 모드 전환은 확인 후에만 SET_MODE AUTO 를 보낸다', async () => {
    const t = renderApp(setup(), '/operations', { token: TOKEN });
    fireEvent.click(await screen.findByRole('button', { name: '자동' }));
    expect(t.api.sendCommand).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '자동 모드로 전환' }));
    await waitFor(() => expect(t.api.sendCommand).toHaveBeenCalledWith('DEVICE_001', expect.objectContaining({ command: 'SET_MODE', target: 'AUTO' })));
  });

  it('모터 테스트: ACK 최종 상태 전에는 성공 표시·기록 저장이 없고, SUCCEEDED 후 점검 기록(ok)을 명령 ID 와 함께 저장한다', async () => {
    const t = renderApp(setup(), '/operations', { token: TOKEN });
    await screen.findByTestId('motor-test');
    await openSocket(t);
    t.api.sendCommand.mockResolvedValueOnce(makeCommand({ command_id: 'm-1', command: 'OPEN_BIN', target: 'metal', bin_id: 'BIN_002', status: 'SENT' }));
    const row = screen.getByTestId('motor-BIN_002');
    fireEvent.click(within(row).getByRole('button', { name: '배출 테스트' }));
    await waitFor(() => expect(t.api.sendCommand).toHaveBeenCalledWith('DEVICE_001', expect.objectContaining({ command: 'OPEN_BIN', target: 'metal' })));
    await waitFor(() => expect(screen.getByTestId('motor-result-BIN_002')).toHaveTextContent('전송됨 · ACK 대기'));
    expect(screen.getByTestId('motor-result-BIN_002')).not.toHaveTextContent('정상 동작');
    expect(within(row).getByRole('button', { name: '점검 기록 저장' })).toBeDisabled();
    // 다른 칸 행에는 결과가 섞이지 않는다
    expect(screen.getByTestId('motor-result-BIN_001')).toHaveTextContent('--');

    act(() =>
      t.latest().emit({
        type: 'command.updated',
        data: makeCommand({ command_id: 'm-1', command: 'OPEN_BIN', target: 'metal', bin_id: 'BIN_002', status: 'SUCCEEDED', result_message: 'BIN_OPENED', executed_at: '2026-10-31T10:00:02.000Z' }),
        sent_at: '2026-10-31T10:00:02.000Z',
      }),
    );
    expect(screen.getByTestId('motor-result-BIN_002')).toHaveTextContent('정상 동작 (ACK)');
    fireEvent.click(within(row).getByRole('button', { name: '점검 기록 저장' }));
    await waitFor(() =>
      expect(t.api.createMaintenance).toHaveBeenCalledWith(expect.objectContaining({ kind: 'motor_test', bin_id: 'BIN_002', result: 'ok', related_command_id: 'm-1' })),
    );
    expect(await within(row).findByText('기록됨 #7')).toBeInTheDocument();
  });

  it('모터 테스트 실패(TIMEOUT)는 issue 로 기록하고 오류 사유를 보여준다', async () => {
    const t = renderApp(setup(), '/operations', { token: TOKEN });
    await screen.findByTestId('motor-test');
    await openSocket(t);
    t.api.sendCommand.mockResolvedValueOnce(makeCommand({ command_id: 'm-2', command: 'OPEN_BIN', target: 'paper', status: 'SENT' }));
    const row = screen.getByTestId('motor-BIN_003');
    fireEvent.click(within(row).getByRole('button', { name: '배출 테스트' }));
    await waitFor(() => expect(screen.getByTestId('motor-result-BIN_003')).toHaveTextContent('ACK 대기'));
    act(() =>
      t.latest().emit({
        type: 'command.updated',
        data: makeCommand({ command_id: 'm-2', command: 'OPEN_BIN', target: 'paper', status: 'TIMEOUT', error_message: 'ACK_TIMEOUT' }),
        sent_at: '2026-10-31T10:00:20.000Z',
      }),
    );
    expect(screen.getByTestId('motor-result-BIN_003')).toHaveTextContent('응답 시간 초과');
    expect(screen.getByTestId('motor-result-BIN_003')).toHaveTextContent('장치 응답 시간 초과');
    fireEvent.click(within(row).getByRole('button', { name: '점검 기록 저장' }));
    await waitFor(() => expect(t.api.createMaintenance).toHaveBeenCalledWith(expect.objectContaining({ result: 'issue', related_command_id: 'm-2' })));
  });

  it('자동 모드에서는 모터 테스트도 막는다 (서버 규칙과 동일)', async () => {
    renderApp(setup(makeDevice({ operating_mode: 'AUTO' })), '/operations', { token: TOKEN });
    const row = await screen.findByTestId('motor-BIN_001');
    expect(within(row).getByRole('button', { name: '배출 테스트' })).toBeDisabled();
  });

  it('센서 테스트 판정은 점검 기록(sensor_test)으로 저장된다', async () => {
    const t = renderApp(setup(), '/operations', { token: TOKEN });
    fireEvent.click(await screen.findByRole('button', { name: '금속 센서 이상 기록' }));
    await waitFor(() => expect(t.api.createMaintenance).toHaveBeenCalledWith(expect.objectContaining({ kind: 'sensor_test', bin_id: 'BIN_002', result: 'issue' })));
  });

  it('제어 기록은 AI 자동 명령을 구분해 표시한다', async () => {
    const t = setup();
    t.api.commands.mockResolvedValue({ items: [makeCommand({ command_id: 'a-1', status: 'SUCCEEDED', origin: 'auto' }), makeCommand({ command_id: 'u-1', status: 'SUCCEEDED', origin: 'manual' })], total: 2, limit: 20, offset: 0 });
    renderApp(t, '/operations', { token: TOKEN });
    const table = await screen.findByTestId('command-log');
    expect(within(table).getByText('AI 자동')).toBeInTheDocument();
    expect(within(table).getByText('관리자')).toBeInTheDocument();
  });
});
