import { validateCalibration } from '../calibration';
import { buildSegments, medianInterval, timeTicks } from '../chart';
import { fillReadout, formatFill, formatRelative } from '../format';
import { appendUnique, nextOffset, rangeLabel } from '../pagination';
import type { Bin, Device } from '../shared';
import { resolveScheme } from '../../theme/ThemeContext';
import { colors } from '../../theme/tokens';

const device: Device = {
  device_id: 'D',
  device_name: null,
  connection_status: 'online',
  operating_mode: 'MANUAL',
  estop_active: false,
  data_source: 'hardware',
  firmware_version: null,
  last_seen: null,
  busy: false,
};
const bin = (over: Partial<Bin>): Bin => ({
  bin_id: 'BIN_001',
  device_id: 'D',
  waste_type: 'plastic',
  current_distance_cm: 20,
  current_fill_percent: 10,
  sensor_status: 'normal',
  is_full: false,
  calibrated: true,
  last_valid_at: null,
  updated_at: '2026-10-31T10:00:00Z',
  ...over,
});

describe('format — null 은 0% 가 아님', () => {
  it('fillReadout', () => {
    expect(fillReadout(null)).toEqual({ value: '--', unit: '' });
    expect(fillReadout(undefined)).toEqual({ value: '--', unit: '' });
    expect(fillReadout(0)).toEqual({ value: '0.0', unit: '%' });
    // 94.6 은 "95" 로 반올림되어 위험 임계와 혼동되지 않도록 소수 1자리
    expect(fillReadout(94.6).value).toBe('94.6');
  });
  it('formatFill', () => {
    expect(formatFill(null)).toBe('미보정');
    expect(formatFill(72.44)).toBe('72.4%');
  });
  it('formatRelative', () => {
    const now = Date.parse('2026-10-31T10:00:00Z');
    expect(formatRelative(null, now)).toBe('기록 없음');
    expect(formatRelative('2026-10-31T09:59:58Z', now)).toBe('방금');
    expect(formatRelative('2026-10-31T09:59:30Z', now)).toBe('30초 전');
    expect(formatRelative('2026-10-31T09:57:00Z', now)).toBe('3분 전');
    expect(formatRelative('2026-10-31T07:00:00Z', now)).toBe('3시간 전');
    expect(formatRelative('2026-10-29T10:00:00Z', now)).toBe('2일 전');
  });
});

describe('chart', () => {
  it('null 과 긴 공백에서 선을 끊는다', () => {
    const segs = buildSegments(
      [
        { t: 0, v: 10 },
        { t: 1000, v: 20 },
        { t: 2000, v: null },
        { t: 3000, v: 30 },
        { t: 4000, v: 35 },
        { t: 60_000, v: 40 },
      ],
      5000,
    );
    expect(segs).toEqual([
      [
        { t: 0, v: 10 },
        { t: 1000, v: 20 },
      ],
      [
        { t: 3000, v: 30 },
        { t: 4000, v: 35 },
      ],
      [{ t: 60_000, v: 40 }],
    ]);
  });
  it('정렬되지 않은 입력도 처리, 빈 입력은 빈 결과', () => {
    expect(buildSegments([], 1000)).toEqual([]);
    expect(buildSegments([{ t: 2, v: 1 }, { t: 1, v: 2 }], 10)[0][0].t).toBe(1);
  });
  it('medianInterval / timeTicks', () => {
    expect(medianInterval([0])).toBeNull();
    expect(medianInterval([0, 3000, 6000, 20000])).toBe(3000);
    expect(timeTicks(0, 300, 4)).toEqual([0, 100, 200, 300]);
  });
});

describe('pagination', () => {
  it('nextOffset', () => {
    expect(nextOffset({ offset: 0, limit: 50, total: 120, items: new Array(50) })).toBe(50);
    expect(nextOffset({ offset: 100, limit: 50, total: 120, items: new Array(20) })).toBeNull();
    expect(nextOffset({ offset: 0, limit: 50, total: 0, items: [] })).toBeNull();
  });
  it('rangeLabel / appendUnique', () => {
    expect(rangeLabel(0, 0)).toBe('결과 없음');
    expect(rangeLabel(50, 1234)).toBe('50 / 총 1,234건');
    expect(appendUnique([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }], (x) => x.id).map((x) => x.id)).toEqual([1, 2, 3]);
  });
});

describe('validateCalibration (서버 규칙과 동일)', () => {
  it('정상', () => expect(validateCalibration('40', '5').error).toBeNull());
  it('쉼표 소수 허용', () => expect(validateCalibration('40,5', '5').empty).toBe(40.5));
  it('가득 ≥ 빈 통 거부', () => expect(validateCalibration('5', '40').error).toMatch(/짧아야/));
  it('범위 밖·빈값 거부', () => {
    expect(validateCalibration('0', '0').error).toBeTruthy();
    expect(validateCalibration('500', '5').error).toMatch(/400/);
    expect(validateCalibration('', '5').error).toMatch(/숫자/);
  });
});

describe('theme', () => {
  it('resolveScheme: 사용자 선택이 시스템보다 우선', () => {
    expect(resolveScheme('system', 'dark')).toBe('dark');
    expect(resolveScheme('system', null)).toBe('light');
    expect(resolveScheme('light', 'dark')).toBe('light');
    expect(resolveScheme('dark', 'light')).toBe('dark');
  });
  it('사양 토큰 값', () => {
    // SMART RECYCLE 브랜드 (웹 tokens.css 와 동일)
    expect(colors.light.bg).toBe('#F6F9F6');
    expect(colors.light.ruleStrong).toBe('#0D4335');
    expect(colors.light.ok).toBe('#1B7957');
    expect(colors.dark.bg).toBe('#0B1613');
    expect(colors.light.material).toEqual({ plastic: '#2D77CD', metal: '#845CB5', paper: '#BE893A', glass: '#738289' });
    expect(colors.light.fill.critical).toBe(colors.light.critical);
  });
});

import { isSimulated } from '../dataSource';
describe('isSimulated', () => {
  const d = { devices: [{ data_source: 'hardware' as const }] as never[] };
  it('하드웨어 모드 SIMULATOR 또는 장치 출처 simulator', () => {
    expect(isSimulated(null)).toBe(false);
    expect(isSimulated({ devices: [] , hardware_mode: 'SIMULATOR' })).toBe(true);
    expect(isSimulated({ devices: [], hardware_mode: 'ESP32_REAL' })).toBe(false);
    expect(isSimulated({ devices: [{ data_source: 'simulator' } as never] })).toBe(true);
    expect(isSimulated(d as never, { hardware_mode: 'SIMULATOR' })).toBe(true);
  });
});
