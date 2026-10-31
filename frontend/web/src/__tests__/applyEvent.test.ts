import { describe, expect, it } from 'vitest';
import { applyEvent, mergeSnapshot } from '@shared';
import type { Command, Dashboard } from '@shared';
import { makeBin, makeCommand, makeDashboard, makeDevice } from './helpers';

describe('applyEvent (shared/state)', () => {
  it('bins.updated 는 bin_id 기준으로 병합하고 나머지 bin 은 유지한다', () => {
    const s = makeDashboard();
    const updated = makeBin({ bin_id: 'BIN_002', waste_type: 'metal', current_fill_percent: 77 });
    const next = applyEvent(s, { type: 'bins.updated', data: [updated], sent_at: 'x' });
    expect(next).not.toBe(s);
    expect(next.bins).toHaveLength(4);
    expect(next.bins.find((b) => b.bin_id === 'BIN_002')?.current_fill_percent).toBe(77);
    expect(next.bins.find((b) => b.bin_id === 'BIN_001')?.current_fill_percent).toBe(42);
    expect(next.bins.map((b) => b.bin_id)).toEqual(['BIN_001', 'BIN_002', 'BIN_003', 'BIN_004']);
    // 원본 불변
    expect(s.bins.find((b) => b.bin_id === 'BIN_002')?.current_fill_percent).toBe(10);
  });

  it('bins.updated 의 새 bin 은 추가된다', () => {
    const s = makeDashboard({ bins: [] });
    const next = applyEvent(s, { type: 'bins.updated', data: [makeBin({ bin_id: 'BIN_009', waste_type: 'paper' })], sent_at: 'x' });
    expect(next.bins.map((b) => b.bin_id)).toEqual(['BIN_009']);
  });

  it('device.status 는 device_id 기준으로 교체한다', () => {
    const s = makeDashboard();
    const next = applyEvent(s, { type: 'device.status', data: makeDevice({ connection_status: 'offline', estop_active: true }), sent_at: 'x' });
    expect(next.devices).toHaveLength(1);
    expect(next.devices[0].connection_status).toBe('offline');
    expect(next.devices[0].estop_active).toBe(true);
  });

  it('command.updated 는 같은 id 를 갱신하고 최신순 정렬, 최대 20개로 자른다', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      makeCommand({ command_id: `c${i}`, requested_at: `2026-10-31T09:${String(i).padStart(2, '0')}:00.000Z` }),
    );
    const s = makeDashboard({ recent_commands: many });
    const newest = makeCommand({ command_id: 'new', requested_at: '2026-10-31T11:00:00.000Z', status: 'SUCCEEDED' });
    const next = applyEvent(s, { type: 'command.updated', data: newest, sent_at: 'x' });
    expect(next.recent_commands).toHaveLength(20);
    expect(next.recent_commands[0].command_id).toBe('new');
    expect(next.recent_commands.some((c) => c.command_id === 'c0')).toBe(false); // 가장 오래된 것 제거

    const acked = applyEvent(next, {
      type: 'command.updated',
      data: { ...newest, status: 'FAILED', error_message: 'jam' },
      sent_at: 'y',
    });
    expect(acked.recent_commands.filter((c) => c.command_id === 'new')).toHaveLength(1);
    expect(acked.recent_commands[0].status).toBe('FAILED');
  });

  it('connected 이벤트는 상태를 바꾸지 않는다', () => {
    const s = makeDashboard();
    expect(applyEvent(s, { type: 'connected', data: { clients: 1 }, sent_at: 'x' })).toBe(s);
  });
});

describe('stale command updates (review fix)', () => {
  const base = (status: Command['status']): Command => ({
    command_id: 'c1', device_id: 'DEVICE_001', command: 'OPEN_BIN', target: 'plastic', status,
    requested_by: 'api-token', requested_at: '2026-10-31T10:00:00Z', expires_at: '2026-10-31T10:00:03Z',
    executed_at: null, result_message: null, error_message: null,
  });
  const dash = (cmds: Command[]): Dashboard => ({ devices: [], bins: [], recent_commands: cmds, server_time: '' });

  it('does not regress a final status back to SENT', () => {
    const s = applyEvent(dash([base('SUCCEEDED')]), { type: 'command.updated', data: base('SENT'), sent_at: '' });
    expect(s.recent_commands[0].status).toBe('SUCCEEDED');
  });

  it('keeps event-applied final status when an older snapshot arrives', () => {
    const merged = mergeSnapshot(dash([base('SUCCEEDED')]), dash([base('SENT')]));
    expect(merged.recent_commands[0].status).toBe('SUCCEEDED');
  });
});
