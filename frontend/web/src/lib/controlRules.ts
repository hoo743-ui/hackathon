import { FINAL_COMMAND_STATUSES } from '@shared';
import type { Command, Device } from '@shared';

/*
 * 제어 버튼 비활성 사유 (화면 안내용, 최종 판단은 서버). mobile/app/services/controlRules.ts 와 같은 규칙에
 * 웹 전용 "토큰 없음" 사유를 더했다. 서버(command_service.py)는 진행 중 명령이 하나라도 있으면 거부하므로
 * GET_STATUS 를 포함한 모든 미완료 명령을 진행 중으로 본다.
 */

export const NO_TOKEN_REASON = '제어 토큰이 설정되지 않았습니다.';

export function inFlightCommand(commands: Command[], deviceId: string | undefined): Command | undefined {
  return commands.find((c) => c.device_id === deviceId && !FINAL_COMMAND_STATUSES.includes(c.status));
}

/** SET_MODE · GET_STATUS 등 일반 명령 */
export function generalBlockReason(device: Device | undefined, inFlight: Command | undefined, hasToken: boolean): string | null {
  if (!hasToken) return NO_TOKEN_REASON;
  if (!device) return '장치 정보가 없습니다.';
  if (device.connection_status !== 'online') return '장치가 오프라인입니다.';
  if (device.busy || inFlight) return '장치가 다른 명령을 처리 중입니다.';
  return null;
}

/** 운전 모드 전환 */
export function modeBlockReason(device: Device | undefined, inFlight: Command | undefined, hasToken: boolean): string | null {
  return generalBlockReason(device, inFlight, hasToken) ?? (device?.estop_active ? '긴급 정지 상태입니다. 먼저 해제하세요.' : null);
}

/** 배출구 작동 (OPEN_BIN) */
export function openBinBlockReason(device: Device | undefined, inFlight: Command | undefined, hasToken: boolean): string | null {
  if (!hasToken) return NO_TOKEN_REASON;
  if (!device) return '장치 정보가 없습니다.';
  if (device.connection_status !== 'online') return '장치가 오프라인입니다.';
  if (device.estop_active) return '긴급 정지 상태입니다. 먼저 해제하세요.';
  if (device.operating_mode === 'AUTO') return '자동 모드입니다. 수동 배출은 수동 모드에서만 가능합니다.';
  if (device.busy || inFlight) return '장치가 다른 명령을 처리 중입니다.';
  return null;
}

/** 긴급 정지: 서버가 오프라인·진행 중에도 최선 노력으로 발행하므로 토큰과 장치만 있으면 허용 (안전 방향) */
export function estopBlockReason(device: Device | undefined, hasToken: boolean): string | null {
  if (!hasToken) return NO_TOKEN_REASON;
  if (!device) return '장치 정보가 없습니다.';
  return null;
}

export function resetBlockReason(device: Device | undefined, inFlight: Command | undefined, hasToken: boolean): string | null {
  return generalBlockReason(device, inFlight, hasToken);
}
