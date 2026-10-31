import { FINAL_COMMAND_STATUSES, type Command, type Device } from './shared';

/** 진행 중인(최종 상태가 아닌) 명령. GET_STATUS 는 장치 동작을 막지 않으므로 제외. */
export function findInFlight(commands: Command[], deviceId: string | undefined): Command | undefined {
  return commands.find((c) => c.device_id === deviceId && c.command !== 'GET_STATUS' && !FINAL_COMMAND_STATUSES.includes(c.status));
}

/** OPEN_BIN 버튼을 막아야 하는 이유. null 이면 허용. 최종 판단은 서버가 한다(화면 안내용). */
export function openBinBlockReason(device: Device | undefined, inFlight: Command | undefined): string | null {
  if (!device) return '장치 정보가 없습니다.';
  if (device.connection_status !== 'online') return '장치가 오프라인입니다.';
  if (device.estop_active) return '긴급 정지 상태입니다. 먼저 해제하세요.';
  if (device.operating_mode === 'AUTO') return '자동 모드입니다. 수동 배출은 수동 모드에서만 가능합니다.';
  if (device.busy || inFlight) return '장치가 다른 명령을 처리 중입니다.';
  return null;
}

/** SET_MODE 등 일반 명령의 차단 사유 */
export function generalBlockReason(device: Device | undefined, inFlight: Command | undefined): string | null {
  if (!device) return '장치 정보가 없습니다.';
  if (device.connection_status !== 'online') return '장치가 오프라인입니다.';
  if (device.busy || inFlight) return '장치가 다른 명령을 처리 중입니다.';
  return null;
}

/** 운전 모드 전환 차단 사유 */
export function modeBlockReason(device: Device | undefined, inFlight: Command | undefined): string | null {
  return generalBlockReason(device, inFlight) ?? (device?.estop_active ? '긴급 정지 상태입니다. 먼저 해제하세요.' : null);
}

/** 토큰이 없으면 서버가 401 로 거부하므로 화면에서 먼저 막는다. */
export function withTokenReason(reason: string | null, hasToken: boolean): string | null {
  return reason ?? (hasToken ? null : '제어 토큰이 없습니다. 홈 ⚙ 설정에서 입력하세요.');
}

/** 배출구 길게 누르기 시간 (ms) */
export const HOLD_MS = 600;

export type HoldOutcome = 'blocked' | 'cancel' | 'activate';

/**
 * 길게 누르기 판정 (순수 함수). 차단 사유가 있으면 항상 blocked,
 * 누른 시간이 holdMs 이상일 때만 activate. 짧은 탭·실수 터치는 cancel.
 */
export function holdOutcome(heldMs: number, blockReason: string | null, holdMs = HOLD_MS): HoldOutcome {
  if (blockReason) return 'blocked';
  return heldMs >= holdMs ? 'activate' : 'cancel';
}

/** 진행률 0..1 (표시용) */
export function holdProgress(heldMs: number, holdMs = HOLD_MS): number {
  if (holdMs <= 0) return 1;
  return Math.max(0, Math.min(1, heldMs / holdMs));
}

/** WS 로 들어온 최근 명령 상태가 바뀌면 제어 기록을 다시 읽기 위한 키 */
export function commandsKey(commands: Pick<Command, 'command_id' | 'status'>[]): string {
  return commands
    .slice(0, 10)
    .map((c) => `${c.command_id}:${c.status}`)
    .join('|');
}
