import type { CommandStatus, CommandType, ConnectionStatus, SensorStatus, WasteType } from './types';

export const WASTE_LABELS: Record<WasteType, string> = {
  plastic: '플라스틱',
  metal: '금속',
  paper: '종이',
  glass: '유리',
};

export const SENSOR_STATUS_LABELS: Record<SensorStatus, string> = {
  normal: '정상',
  out_of_range: '측정 범위 이탈',
  timeout: '응답 없음',
  error: '센서 오류',
};

export const CONNECTION_LABELS: Record<ConnectionStatus, string> = {
  online: '연결됨',
  offline: '연결 끊김',
  unknown: '알 수 없음',
};

export const COMMAND_STATUS_LABELS: Record<CommandStatus, string> = {
  PENDING: '대기',
  SENT: '전송됨 · ACK 대기',
  SUCCEEDED: '실행 완료',
  FAILED: '실패',
  TIMEOUT: '응답 시간 초과',
};

/** 재질 코드 (재활용 표기처럼 화면·차트 범례에서 동일하게 사용) */
export const WASTE_CODES: Record<WasteType, string> = {
  plastic: 'PL',
  metal: 'MT',
  paper: 'PA',
  glass: 'GL',
};

export const COMMAND_TYPE_LABELS: Record<CommandType, string> = {
  OPEN_BIN: '배출구 작동',
  SET_MODE: '모드 변경',
  EMERGENCY_STOP: '긴급 정지',
  RESET_ESTOP: '긴급 정지 해제',
  GET_STATUS: '상태 요청',
};

export const WASTE_TYPES: WasteType[] = ['plastic', 'metal', 'paper', 'glass'];

export type FillLevel = 'unknown' | 'normal' | 'attention' | 'warning' | 'critical';

/** 표시 단계 임계값(%). 변경은 이 설정 한 곳에서만 한다. */
export const FILL_THRESHOLDS = { attention: 50, warning: 80, critical: 95 } as const;

export const FILL_LEVEL_LABELS: Record<FillLevel, string> = {
  unknown: '미보정',
  normal: '여유',
  attention: '주의',
  warning: '경고',
  critical: '위험',
};

/** 표시용 단계 분류(계산 아님). 적재율 계산은 서버에서만 한다. */
export function fillLevel(percent: number | null, t = FILL_THRESHOLDS): FillLevel {
  if (percent === null) return 'unknown';
  if (percent >= t.critical) return 'critical';
  if (percent >= t.warning) return 'warning';
  if (percent >= t.attention) return 'attention';
  return 'normal';
}

export const DETECTION_OUTCOME_LABELS: Record<string, string> = {
  SORTING: '분류 중 · 장치 응답 대기',
  SORTED: '분류 완료',
  SORT_FAILED: '분류 동작 실패',
  LOW_CONFIDENCE: '신뢰도 낮음 · 동작 안 함',
  UNRECOGNIZED: '인식 불가',
  MANUAL_MODE: '수동 모드 · 기록만',
  DEVICE_UNAVAILABLE: '장치 사용 불가',
  SORT_SENT: '배출 명령 전송 · 동작 미확인',
  NO_HARDWARE: '하드웨어 없음 · 기록만',
};

/** 카메라 노트북 → 아두이노 시리얼 결과. 아두이노는 ACK를 보내지 않으므로 '완료'라고 표시하지 않는다. */
export const HARDWARE_STATUS_LABELS: Record<string, string> = {
  pending: '대기',
  command_sent: '명령 전송됨 (장치 응답 없음)',
  serial_failed: '시리얼 전송 실패',
  not_connected: '하드웨어 미연결',
  disabled: '하드웨어 비활성',
  skipped_busy: '이전 동작 중 · 생략',
};

export const MAINTENANCE_KIND_LABELS: Record<string, string> = {
  inspection: '정기 점검',
  sensor_test: '센서 테스트',
  motor_test: '모터 테스트',
  emptied: '수거(비움)',
  repair: '수리',
};
