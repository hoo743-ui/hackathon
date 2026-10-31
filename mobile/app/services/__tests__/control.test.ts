import { HOLD_MS, findInFlight, holdOutcome, holdProgress, modeBlockReason, openBinBlockReason, withTokenReason } from '../controlRules';
import { commandFailureReason, commandStage, commandTitle, describeCommandError } from '../commandProgress';
import type { Command, CommandStatus, Device } from '../shared';

const device: Device = {
  device_id: 'DEVICE_001',
  device_name: null,
  connection_status: 'online',
  operating_mode: 'MANUAL',
  estop_active: false,
  data_source: 'simulator',
  firmware_version: null,
  last_seen: null,
  busy: false,
};

const cmd = (over: Partial<Command> = {}): Command => ({
  command_id: 'c1',
  device_id: 'DEVICE_001',
  command: 'OPEN_BIN',
  target: 'plastic',
  status: 'SENT',
  requested_by: null,
  requested_at: '2026-10-31T10:00:00Z',
  expires_at: '2026-10-31T10:00:10Z',
  executed_at: null,
  result_message: null,
  error_message: null,
  ...over,
});

describe('holdOutcome (길게 누르기 0.6초)', () => {
  it('기본 시간은 600ms', () => expect(HOLD_MS).toBe(600));
  it('0.6초 미만이면 취소, 이상이면 작동', () => {
    expect(holdOutcome(0, null)).toBe('cancel');
    expect(holdOutcome(599, null)).toBe('cancel');
    expect(holdOutcome(600, null)).toBe('activate');
    expect(holdOutcome(2000, null)).toBe('activate');
  });
  it('차단 사유가 있으면 오래 눌러도 작동하지 않음', () => {
    expect(holdOutcome(5000, '장치가 오프라인입니다.')).toBe('blocked');
  });
  it('진행률은 0..1 로 고정', () => {
    expect(holdProgress(-10)).toBe(0);
    expect(holdProgress(300)).toBeCloseTo(0.5);
    expect(holdProgress(10_000)).toBe(1);
  });
});

describe('차단 규칙', () => {
  it('MANUAL + online 이면 배출 허용', () => expect(openBinBlockReason(device, undefined)).toBeNull());
  it('offline/estop/AUTO/busy/진행 중 명령 차단', () => {
    expect(openBinBlockReason({ ...device, connection_status: 'offline' }, undefined)).toMatch(/오프라인/);
    expect(openBinBlockReason({ ...device, estop_active: true }, undefined)).toMatch(/긴급/);
    expect(openBinBlockReason({ ...device, operating_mode: 'AUTO' }, undefined)).toMatch(/자동/);
    expect(openBinBlockReason({ ...device, busy: true }, undefined)).toMatch(/처리 중/);
    expect(openBinBlockReason(device, cmd())).toMatch(/처리 중/);
    expect(openBinBlockReason(undefined, undefined)).toMatch(/장치 정보/);
  });
  it('모드 전환은 긴급 정지 중 차단', () => {
    expect(modeBlockReason(device, undefined)).toBeNull();
    expect(modeBlockReason({ ...device, estop_active: true }, undefined)).toMatch(/긴급/);
  });
  it('토큰이 없으면 장치 사유가 없어도 차단, 장치 사유가 우선', () => {
    expect(withTokenReason(null, true)).toBeNull();
    expect(withTokenReason(null, false)).toMatch(/토큰/);
    expect(withTokenReason('장치가 오프라인입니다.', false)).toMatch(/오프라인/);
  });
  it('findInFlight: 최종 상태와 GET_STATUS 는 제외', () => {
    expect(findInFlight([cmd({ status: 'SUCCEEDED' })], 'DEVICE_001')).toBeUndefined();
    expect(findInFlight([cmd({ command: 'GET_STATUS', target: null })], 'DEVICE_001')).toBeUndefined();
    expect(findInFlight([cmd({ status: 'PENDING' })], 'DEVICE_001')?.command_id).toBe('c1');
    expect(findInFlight([cmd()], 'OTHER')).toBeUndefined();
  });
});

describe('commandStage — ACK 전 성공 표시 금지', () => {
  const all: CommandStatus[] = ['PENDING', 'SENT', 'SUCCEEDED', 'FAILED', 'TIMEOUT'];
  it('SUCCEEDED 만 성공', () => {
    for (const s of all) expect(commandStage(s).succeeded).toBe(s === 'SUCCEEDED');
  });
  it('SENT 는 "전송됨 · 장치 응답 대기", 최종 아님', () => {
    expect(commandStage('SENT').label).toBe('전송됨 · 장치 응답 대기');
    expect(commandStage('SENT').final).toBe(false);
    expect(commandStage('SENT').step).toBe(1);
  });
  it('실행 완료 문구는 SUCCEEDED 에서만', () => {
    for (const s of all) expect(commandStage(s).label.includes('완료')).toBe(s === 'SUCCEEDED');
  });
  it('FAILED/TIMEOUT 은 최종 + critical', () => {
    expect(commandStage('FAILED')).toMatchObject({ final: true, tone: 'critical' });
    expect(commandStage('TIMEOUT')).toMatchObject({ final: true, tone: 'critical' });
  });
  it('실패 사유: 코드는 한국어 + 코드, 진행 중/성공이면 null', () => {
    expect(commandFailureReason(cmd({ status: 'TIMEOUT', error_message: 'ACK_TIMEOUT' }))).toEqual({ text: '장치 응답 시간 초과', code: 'ACK_TIMEOUT' });
    expect(commandFailureReason(cmd({ status: 'TIMEOUT' }))?.code).toBe('ACK_TIMEOUT');
    expect(commandFailureReason(cmd({ status: 'FAILED', error_message: 'PINMAP_UNCONFIRMED' }))?.text).toMatch(/핀맵/);
    expect(commandFailureReason(cmd({ status: 'FAILED', error_message: 'servo jammed' }))).toEqual({ text: 'servo jammed', code: null });
    expect(commandFailureReason(cmd({ status: 'SENT' }))).toBeNull();
    expect(commandFailureReason(cmd({ status: 'SUCCEEDED' }))).toBeNull();
    expect(describeCommandError('WEIRD_CODE')).toEqual({ text: '장치 오류', code: 'WEIRD_CODE' });
  });
  it('명령 제목', () => {
    expect(commandTitle({ command: 'OPEN_BIN', target: 'paper' })).toBe('배출구 작동 · 종이');
    expect(commandTitle({ command: 'SET_MODE', target: 'AUTO' })).toBe('모드 변경 · 자동');
    expect(commandTitle({ command: 'EMERGENCY_STOP', target: null })).toBe('긴급 정지');
  });
});
