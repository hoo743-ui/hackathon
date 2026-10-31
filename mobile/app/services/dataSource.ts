import type { Dashboard, Health } from './shared';

/** 시뮬레이터 데이터 여부: 서버 하드웨어 모드가 SIMULATOR 이거나 장치가 simulator 출처를 보고할 때 */
export function isSimulated(dashboard: Pick<Dashboard, 'devices' | 'hardware_mode'> | null | undefined, health?: Pick<Health, 'hardware_mode'> | null): boolean {
  if (dashboard?.hardware_mode === 'SIMULATOR' || health?.hardware_mode === 'SIMULATOR') return true;
  return (dashboard?.devices ?? []).some((d) => d.data_source === 'simulator');
}

export const HARDWARE_MODE_LABELS = { SIMULATOR: '시뮬레이터 (내장 가상 장치)', ESP32_REAL: '실제 ESP32', EDGE_SERIAL: '카메라 노트북 USB 시리얼' } as const;
