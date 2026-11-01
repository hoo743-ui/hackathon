import { FILL_THRESHOLDS, WASTE_LABELS } from './labels';
import { COMMAND_ERROR_LABELS, DEVICE_ERROR_LABELS } from './health';
import type { Dashboard, WasteType } from './types';

/** 현장 알림. 서버 상태에서 파생만 한다 (별도 저장 없음 → 상태가 해소되면 알림도 사라진다). */
export type AlertSeverity = 'critical' | 'warning' | 'info';
export type AlertKind =
  | 'device_offline'
  | 'device_unknown'
  | 'estop'
  | 'device_error'
  | 'bin_full'
  | 'bin_warning'
  | 'sensor_error'
  | 'uncalibrated'
  | 'sorting_failed'
  | 'command_failed';

export interface Alert {
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  detail?: string;
  device_id?: string;
  bin_id?: string;
  /** 발생 시각 (알 수 있을 때만) */
  at?: string | null;
}

const ORDER: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
const RECENT_MS = 60 * 60 * 1000; // 최근 1시간의 실패만 알림으로 표시

export const ALERT_KIND_LABELS: Record<AlertKind, string> = {
  device_offline: '장치 오프라인',
  device_unknown: '장치 미확인',
  estop: '긴급 정지',
  device_error: '장치 오류',
  bin_full: '적재 위험',
  bin_warning: '적재 경고',
  sensor_error: '센서 오류',
  uncalibrated: '미보정',
  sorting_failed: '분류 처리 실패',
  command_failed: '제어 실패',
};

export function deriveAlerts(d: Dashboard | null, now: number = Date.now()): Alert[] {
  if (!d) return [];
  const out: Alert[] = [];
  for (const dev of d.devices) {
    if (dev.connection_status === 'offline') {
      out.push({ id: `off-${dev.device_id}`, kind: 'device_offline', severity: 'critical', title: `${dev.device_id} 연결 끊김`, device_id: dev.device_id, at: dev.last_seen });
      continue; // 오프라인이면 센서 값은 오래된 값이므로 센서 알림은 내지 않는다
    }
    if (dev.connection_status === 'unknown') {
      out.push({ id: `unk-${dev.device_id}`, kind: 'device_unknown', severity: 'warning', title: `${dev.device_id} 데이터 없음`, device_id: dev.device_id });
      continue;
    }
    if (dev.estop_active) out.push({ id: `estop-${dev.device_id}`, kind: 'estop', severity: 'critical', title: '긴급 정지 상태', detail: '해제 전까지 모든 동작이 차단됩니다', device_id: dev.device_id });
    if (dev.error_code) out.push({ id: `err-${dev.device_id}`, kind: 'device_error', severity: 'warning', title: DEVICE_ERROR_LABELS[dev.error_code] ?? `장치 오류 ${dev.error_code}`, device_id: dev.device_id });
    for (const b of d.bins.filter((x) => x.device_id === dev.device_id)) {
      const name = WASTE_LABELS[b.waste_type as WasteType] ?? b.waste_type;
      if (b.sensor_status && b.sensor_status !== 'normal') {
        out.push({ id: `sensor-${b.bin_id}`, kind: 'sensor_error', severity: 'warning', title: `${name} 센서 이상`, detail: b.sensor_status, bin_id: b.bin_id, device_id: dev.device_id, at: b.updated_at });
      }
      const f = b.current_fill_percent;
      if (f !== null && f >= FILL_THRESHOLDS.critical) {
        out.push({ id: `full-${b.bin_id}`, kind: 'bin_full', severity: 'critical', title: `${name} ${f.toFixed(1)}% — 비움 필요`, bin_id: b.bin_id, device_id: dev.device_id, at: b.last_valid_at });
      } else if (f !== null && f >= FILL_THRESHOLDS.warning) {
        out.push({ id: `warn-${b.bin_id}`, kind: 'bin_warning', severity: 'warning', title: `${name} ${f.toFixed(1)}% — 곧 비움 필요`, bin_id: b.bin_id, device_id: dev.device_id, at: b.last_valid_at });
      }
      // 센서가 없는 칸은 보정 대상이 아님. 적재율이 이미 계산되는 칸(빈통 거리 설정됨)도 제외
      if (!b.calibrated && b.sensor_status !== null && b.current_fill_percent === null) out.push({ id: `cal-${b.bin_id}`, kind: 'uncalibrated', severity: 'info', title: `${name} 보정 필요`, bin_id: b.bin_id, device_id: dev.device_id });
    }
  }
  for (const det of d.recent_detections ?? []) {
    if (now - Date.parse(det.detected_at) > RECENT_MS) continue;
    if (det.outcome === 'SORT_FAILED' || det.outcome === 'DEVICE_UNAVAILABLE' || det.outcome === 'UNRECOGNIZED') {
      const detail = det.outcome_detail ? (COMMAND_ERROR_LABELS[det.outcome_detail] ?? det.outcome_detail) : undefined;
      out.push({ id: `det-${det.id}`, kind: 'sorting_failed', severity: 'warning', title: `분류 처리 실패 · ${det.waste_type}`, detail, device_id: det.device_id, bin_id: det.bin_id ?? undefined, at: det.detected_at });
    }
  }
  for (const c of d.recent_commands) {
    if (c.origin === 'auto' || now - Date.parse(c.requested_at) > RECENT_MS) continue; // 자동 명령은 분류 실패로 이미 표시
    if (c.status === 'FAILED' || c.status === 'TIMEOUT') {
      out.push({ id: `cmd-${c.command_id}`, kind: 'command_failed', severity: 'warning', title: '제어 실패', detail: COMMAND_ERROR_LABELS[c.error_message ?? ''] ?? c.error_message ?? c.status, device_id: c.device_id, at: c.requested_at });
    }
  }
  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || (b.at ?? '').localeCompare(a.at ?? ''));
}

/** "점검 필요" 판단: critical 또는 warning 알림이 하나라도 있으면 true */
export function needsAttention(alerts: Alert[]): boolean {
  return alerts.some((a) => a.severity !== 'info');
}
