import { COMMAND_ERROR_LABELS, COMMAND_TYPE_LABELS, WASTE_LABELS, type Command, type CommandStatus, type WasteType } from './shared';

export type StageTone = 'pending' | 'ok' | 'critical';

export interface CommandStage {
  /** 0 요청 · 1 전송 · 2 장치 응답 */
  step: 0 | 1 | 2;
  label: string;
  tone: StageTone;
  final: boolean;
  /** 성공 여부. SUCCEEDED(장치 ACK) 일 때만 true */
  succeeded: boolean;
}

export const PROGRESS_STEPS = ['요청', '전송', '장치 응답'] as const;

/** 서버가 보고한 실제 상태만으로 진행 단계를 정한다. SUCCEEDED 이전에는 절대 성공으로 표시하지 않는다. */
export function commandStage(status: CommandStatus): CommandStage {
  switch (status) {
    case 'PENDING':
      return { step: 0, label: '요청됨 · 전송 대기', tone: 'pending', final: false, succeeded: false };
    case 'SENT':
      return { step: 1, label: '전송됨 · 장치 응답 대기', tone: 'pending', final: false, succeeded: false };
    case 'SUCCEEDED':
      return { step: 2, label: '실행 완료', tone: 'ok', final: true, succeeded: true };
    case 'FAILED':
      return { step: 2, label: '실패', tone: 'critical', final: true, succeeded: false };
    case 'TIMEOUT':
      return { step: 2, label: '응답 시간 초과', tone: 'critical', final: true, succeeded: false };
  }
}

export function isWasteType(v: string | null | undefined): v is WasteType {
  return !!v && v in WASTE_LABELS;
}

/** "배출구 작동 · 플라스틱", "모드 변경 · 자동" */
export function commandTitle(cmd: Pick<Command, 'command' | 'target'>): string {
  const base = COMMAND_TYPE_LABELS[cmd.command];
  if (!cmd.target) return base;
  if (isWasteType(cmd.target)) return `${base} · ${WASTE_LABELS[cmd.target]}`;
  if (cmd.target === 'AUTO') return `${base} · 자동`;
  if (cmd.target === 'MANUAL') return `${base} · 수동`;
  return `${base} · ${cmd.target}`;
}


export interface FailureReason {
  /** 사람이 읽는 문구 */
  text: string;
  /** 원시 오류 코드 (작게 함께 표시, 추적용). 없으면 null */
  code: string | null;
}

/** 명령 ACK 오류 → 문구. 공용 COMMAND_ERROR_LABELS 사용 (HTTP 오류 매핑 errors.ts 와는 다른 계층). */
export function describeCommandError(raw: string): FailureReason {
  const code = raw.trim();
  if (/^[A-Z][A-Z0-9_]+$/.test(code)) return { text: COMMAND_ERROR_LABELS[code] ?? '장치 오류', code };
  return { text: raw, code: null };
}

/** 실패/시간 초과 사유. 성공·진행 중이면 null */
export function commandFailureReason(cmd: Command): FailureReason | null {
  const raw = cmd.error_message ?? (cmd.status === 'FAILED' ? cmd.result_message : null);
  if (cmd.status === 'FAILED') return raw ? describeCommandError(raw) : { text: '장치가 명령을 거부했습니다', code: null };
  if (cmd.status === 'TIMEOUT') return raw ? describeCommandError(raw) : { text: COMMAND_ERROR_LABELS.ACK_TIMEOUT, code: 'ACK_TIMEOUT' };
  return null;
}
