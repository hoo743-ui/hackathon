import type { Bin, Command, Device } from './types';

/** 장치 건강 상태. 웹·앱이 같은 규칙으로 판정한다 (서버가 보낸 실제 상태만 사용). */
export type HealthLevel = 'healthy' | 'degraded' | 'offline' | 'unknown';

export interface DeviceHealth {
  level: HealthLevel;
  /** 사람이 읽는 사유 목록 (빈 배열 = 문제 없음) */
  reasons: string[];
  sensorsOk: number;
  sensorsTotal: number;
  /** 마지막 배출구(OPEN_BIN) 명령 결과. 서보 위치 센서가 없으므로 이것이 모터 상태의 유일한 근거다. */
  lastMotorResult: Command | null;
}

/** 장치 status error_code → 사유 문구 */
export const DEVICE_ERROR_LABELS: Record<string, string> = {
  SENSOR_FAULT: '장치가 센서 이상을 보고함',
  TIME_NOT_SYNCED: '장치 시간 미동기화 (배출구 명령 거부됨)',
};

/** 명령 ACK error_code → 사람이 읽는 문구 (웹·앱 공용) */
export const COMMAND_ERROR_LABELS: Record<string, string> = {
  ACK_TIMEOUT: '장치 응답 시간 초과',
  DUPLICATE: '중복 명령 (재실행 안 함)',
  EXPIRED: '유효시간이 지난 명령',
  TIME_NOT_SYNCED: '장치 시간 미동기화',
  INVALID_DEVICE: '장치 불일치',
  INVALID_COMMAND: '잘못된 명령',
  INVALID_TARGET: '잘못된 대상',
  BUSY: '다른 동작 수행 중',
  ESTOP_ACTIVE: '긴급 정지 상태',
  MODE_CONFLICT: '자동 모드에서는 수동 배출 불가',
  ABORTED_BY_ESTOP: '긴급 정지로 중단',
  ABORTED_CONNECTION_LOST: '연결 끊김으로 중단',
  MOTION_TIMEOUT: '모터 동작 시간 초과',
  PINMAP_UNCONFIRMED: '핀맵 미확정 — 서보 동작이 잠겨 있음',
  MQTT_PUBLISH_FAILED: '브로커 전송 실패',
  DEVICE_OFFLINE: '장치 오프라인',
  DEVICE_BUSY: '다른 동작 수행 중',
};

/** 장치 ACK 성공 메시지 → 문구 (분류 처리 결과 상세 등에 사용) */
export const COMMAND_RESULT_LABELS: Record<string, string> = {
  BIN_OPENED: '배출구 동작 완료',
  MODE_SET: '모드 변경 완료',
  ESTOP_ACTIVATED: '긴급 정지 실행',
  ESTOP_RESET: '긴급 정지 해제',
  STATUS_SENT: '상태 보고 완료',
};

/** 분류 처리 결과 상세(outcome_detail) → 문구. 모르는 코드는 그대로 반환 */
const EDGE_DETAIL_LABELS: Record<string, string> = {
  NO_DEVICE_ACK: '장치 응답 기능 없음',
  SERIAL_WRITE_FAILED: '시리얼 전송 실패',
  SERIAL_NOT_CONNECTED: '시리얼 미연결',
  HARDWARE_DISABLED: '하드웨어 비활성',
  HARDWARE_BUSY: '이전 동작 중',
  ACK_DONE: '장치 동작 완료 응답',
  ACK_TIMEOUT: '장치 응답 시간 초과',
  EMERGENCY_STOP: '비상 정지',
};

export function outcomeDetailLabel(detail: string | null | undefined): string | null {
  if (!detail) return null;
  if (EDGE_DETAIL_LABELS[detail]) return EDGE_DETAIL_LABELS[detail];
  return COMMAND_RESULT_LABELS[detail] ?? COMMAND_ERROR_LABELS[detail] ?? detail;
}

export const HEALTH_LABELS: Record<HealthLevel, string> = {
  healthy: '정상',
  degraded: '저하',
  offline: '오프라인',
  unknown: '알 수 없음',
};

export function deviceHealth(device: Device | undefined, bins: Bin[], commands: Command[]): DeviceHealth {
  // 측정값을 한 번도 보내지 않은 칸(sensor_status=null)은 '센서 미설치'로 보고 고장으로 세지 않는다
  // (해커톤 구성: HC-SR04 1개 → 4칸 중 1칸만 센서)
  const own = device ? bins.filter((b) => b.device_id === device.device_id && b.sensor_status !== null) : [];
  const sensorsOk = own.filter((b) => b.sensor_status === 'normal').length;
  const lastMotorResult =
    commands.find((c) => c.device_id === device?.device_id && c.command === 'OPEN_BIN' && c.status !== 'PENDING' && c.status !== 'SENT') ??
    null;
  const base = { sensorsOk, sensorsTotal: own.length, lastMotorResult };

  if (!device || device.connection_status === 'unknown') {
    return { ...base, level: 'unknown', reasons: ['장치로부터 아직 데이터를 받지 못했습니다'] };
  }
  if (device.connection_status === 'offline') {
    return { ...base, level: 'offline', reasons: ['장치 연결이 끊겼습니다'] };
  }
  const reasons: string[] = [];
  if (device.estop_active) reasons.push('긴급 정지 상태');
  if (device.error_code) reasons.push(DEVICE_ERROR_LABELS[device.error_code] ?? `장치 오류 ${device.error_code}`);
  if (sensorsOk < own.length) reasons.push(`센서 ${own.length - sensorsOk}개 이상`);
  if (lastMotorResult && lastMotorResult.status !== 'SUCCEEDED') reasons.push('마지막 배출구 동작 실패');
  return { ...base, level: reasons.length ? 'degraded' : 'healthy', reasons };
}
