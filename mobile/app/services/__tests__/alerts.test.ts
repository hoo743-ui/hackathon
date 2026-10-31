import { ALERT_GROUP, alertBadgeCount, alertTarget, detectionMaterial, formatConfidence, localMidnightISO, severityCounts } from '../alertsView';
import { ALERT_KIND_LABELS, deriveAlerts, needsAttention, type Alert, type AlertKind, type Bin, type Dashboard, type Device, type Detection } from '../shared';

import { commandsKey } from '../controlRules';

const NOW = Date.parse('2026-10-31T10:00:00Z');
const device: Device = {
  device_id: 'DEVICE_001',
  device_name: null,
  connection_status: 'online',
  operating_mode: 'AUTO',
  estop_active: false,
  data_source: 'simulator',
  firmware_version: null,
  last_seen: '2026-10-31T09:59:59Z',
  busy: false,
};
const bin = (over: Partial<Bin>): Bin => ({
  bin_id: 'BIN_001',
  device_id: 'DEVICE_001',
  waste_type: 'plastic',
  current_distance_cm: 30,
  current_fill_percent: 20,
  sensor_status: 'normal',
  is_full: false,
  calibrated: true,
  last_valid_at: '2026-10-31T09:59:00Z',
  updated_at: '2026-10-31T09:59:00Z',
  ...over,
});
const det = (over: Partial<Detection>): Detection => ({
  id: 1,
  detection_id: null,
  device_id: 'DEVICE_001',
  bin_id: 'BIN_003',
  waste_type: 'paper',
  confidence: 0.876,
  source: 'simulator',
  model_name: 'qa',
  image_reference: null,
  detected_at: '2026-10-31T09:58:00Z',
  received_at: '2026-10-31T09:58:01Z',
  outcome: 'SORTED',
  outcome_detail: null,
  command_id: null,
  ...over,
});
const dash = (over: Partial<Dashboard>): Dashboard => ({ devices: [device], bins: [], recent_commands: [], server_time: '', recent_detections: [], ...over });

describe('알림 탭 배지 = critical + warning', () => {
  it('정상 상태면 0', () => {
    expect(alertBadgeCount(deriveAlerts(dash({ bins: [bin({})] }), NOW))).toBe(0);
  });
  it('info(미보정)는 배지에 포함하지 않음', () => {
    const alerts = deriveAlerts(dash({ bins: [bin({ calibrated: false, current_fill_percent: null })] }), NOW);
    expect(alerts).toHaveLength(1);
    expect(alertBadgeCount(alerts)).toBe(0);
    expect(needsAttention(alerts)).toBe(false);
  });
  it('위험·경고·센서 오류·분류 실패를 센다', () => {
    const alerts = deriveAlerts(
      dash({
        bins: [
          bin({ bin_id: 'B1', current_fill_percent: 97 }),
          bin({ bin_id: 'B2', waste_type: 'metal', current_fill_percent: 85 }),
          bin({ bin_id: 'B3', waste_type: 'paper', sensor_status: 'timeout' }),
          bin({ bin_id: 'B4', waste_type: 'glass', calibrated: false }),
        ],
        recent_detections: [det({ outcome: 'SORT_FAILED', outcome_detail: 'ACK_TIMEOUT' })],
      }),
      NOW,
    );
    const c = severityCounts(alerts);
    expect(c).toEqual({ critical: 1, warning: 3, info: 1 });
    expect(alertBadgeCount(alerts)).toBe(4);
    expect(alertBadgeCount(alerts) > 0).toBe(needsAttention(alerts));
  });
  it('오프라인이면 장치 알림 하나 (센서 알림 없음)', () => {
    const alerts = deriveAlerts(dash({ devices: [{ ...device, connection_status: 'offline' }], bins: [bin({ sensor_status: 'error' })] }), NOW);
    expect(alerts.map((a) => a.kind)).toEqual(['device_offline']);
    expect(alertBadgeCount(alerts)).toBe(1);
  });
});

describe('알림 종류 구분·이동', () => {
  it('센서 오류 / 장치 오프라인 / 분류 실패는 다른 그룹·라벨', () => {
    const kinds: AlertKind[] = ['sensor_error', 'device_offline', 'sorting_failed'];
    expect(new Set(kinds.map((k) => ALERT_GROUP[k])).size).toBe(3);
    expect(new Set(kinds.map((k) => ALERT_KIND_LABELS[k])).size).toBe(3);
  });
  it('모든 종류에 그룹이 있다', () => {
    for (const k of Object.keys(ALERT_KIND_LABELS) as AlertKind[]) expect(ALERT_GROUP[k]).toBeTruthy();
  });
  const a = (kind: AlertKind, bin_id?: string): Alert => ({ id: 'x', kind, severity: 'warning', title: 't', bin_id });
  it('칸 관련은 수거함 상세, 장치·제어는 제어 화면', () => {
    expect(alertTarget(a('bin_full', 'BIN_004'))).toEqual({ pathname: '/bin/[id]', params: { id: 'BIN_004' } });
    expect(alertTarget(a('sensor_error', 'BIN_002'))).toEqual({ pathname: '/bin/[id]', params: { id: 'BIN_002' } });
    expect(alertTarget(a('device_offline'))).toBe('/control');
    expect(alertTarget(a('estop'))).toBe('/control');
    expect(alertTarget(a('command_failed'))).toBe('/control');
    expect(alertTarget(a('sorting_failed'))).toBe('/control');
    expect(alertTarget(a('uncalibrated'))).toBe('/settings');
  });
});

describe('분류 표시', () => {
  it('confidence 는 모델값 그대로 소수 2자리', () => {
    expect(formatConfidence(0.876)).toBe('0.88');
    expect(formatConfidence(1)).toBe('1.00');
    expect(formatConfidence(null)).toBe('--');
  });
  it('4개 재질 외 값은 원문 유지', () => {
    expect(detectionMaterial({ waste_type: 'paper' })).toBe('paper');
    expect(detectionMaterial({ waste_type: 'battery' })).toBeNull();
  });
  it('오늘 0시 (로컬)', () => {
    const iso = localMidnightISO(new Date(2026, 9, 31, 15, 30));
    const d = new Date(iso);
    expect([d.getHours(), d.getMinutes(), d.getDate()]).toEqual([0, 0, 31]);
  });
  it('commandsKey 는 상태 변화에 반응', () => {
    const k1 = commandsKey([{ command_id: 'a', status: 'SENT' }]);
    const k2 = commandsKey([{ command_id: 'a', status: 'SUCCEEDED' }]);
    expect(k1).not.toBe(k2);
  });
});
