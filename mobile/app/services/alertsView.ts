import type { Alert, AlertKind, AlertSeverity, Detection } from './shared';
import { WASTE_TYPES, type WasteType } from './shared';

/** 탭 배지 수 = critical + warning (info 제외). 0 이면 배지를 숨긴다. */
export function alertBadgeCount(alerts: Alert[]): number {
  return alerts.filter((a) => a.severity === 'critical' || a.severity === 'warning').length;
}

/** 알림 종류 묶음 — 장치 오프라인 / 센서 오류 / 분류 실패가 시각적으로 구분되게 아이콘·그룹을 나눈다. */
export type AlertGroup = 'device' | 'safety' | 'sensor' | 'fill' | 'sorting' | 'control' | 'setup';

export const ALERT_GROUP: Record<AlertKind, AlertGroup> = {
  device_offline: 'device',
  device_unknown: 'device',
  device_error: 'device',
  estop: 'safety',
  sensor_error: 'sensor',
  bin_full: 'fill',
  bin_warning: 'fill',
  sorting_failed: 'sorting',
  command_failed: 'control',
  uncalibrated: 'setup',
};

/** Ionicons 이름 (그룹별) */
export const ALERT_GROUP_ICON: Record<AlertGroup, string> = {
  device: 'cloud-offline-outline',
  safety: 'hand-left-outline',
  sensor: 'pulse-outline',
  fill: 'layers-outline',
  sorting: 'scan-outline',
  control: 'options-outline',
  setup: 'construct-outline',
};

export type AlertTarget = { pathname: '/bin/[id]'; params: { id: string } } | '/control' | '/settings';

/** 알림 → 이동할 화면. 칸이 있으면 수거함 상세, 장치·제어 문제는 제어, 보정은 설정. */
export function alertTarget(a: Pick<Alert, 'kind' | 'bin_id'>): AlertTarget {
  if (a.kind === 'uncalibrated') return a.bin_id ? { pathname: '/bin/[id]', params: { id: a.bin_id } } : '/settings';
  if (a.kind === 'sensor_error' || a.kind === 'bin_full' || a.kind === 'bin_warning') {
    return a.bin_id ? { pathname: '/bin/[id]', params: { id: a.bin_id } } : '/control';
  }
  if (a.kind === 'sorting_failed' && a.bin_id) return { pathname: '/bin/[id]', params: { id: a.bin_id } };
  return '/control';
}

const RANK: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

/** 심각도별 개수 (요약 줄) */
export function severityCounts(alerts: Alert[]): Record<AlertSeverity, number> {
  const out: Record<AlertSeverity, number> = { critical: 0, warning: 0, info: 0 };
  for (const a of alerts) out[a.severity] += 1;
  return out;
}

export function bySeverity(a: Alert, b: Alert): number {
  return RANK[a.severity] - RANK[b.severity];
}

/** 모델이 낸 종류가 4개 재질 중 하나인지 (아니면 원문 그대로 표시) */
export function detectionMaterial(d: Pick<Detection, 'waste_type'>): WasteType | null {
  return (WASTE_TYPES as string[]).includes(d.waste_type) ? (d.waste_type as WasteType) : null;
}

/** confidence 는 모델 출력 그대로, 소수 2자리 (반올림 표시만, 값 가공 없음) */
export function formatConfidence(v: number | null | undefined): string {
  return v === null || v === undefined || Number.isNaN(v) ? '--' : v.toFixed(2);
}

/** 기기 로컬 자정 (오늘 0시) ISO — 오늘 분류 건수 조회용 */
export function localMidnightISO(now: Date = new Date()): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
