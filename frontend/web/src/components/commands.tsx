import { COMMAND_ERROR_LABELS, COMMAND_RESULT_LABELS, COMMAND_STATUS_LABELS, COMMAND_TYPE_LABELS, WASTE_LABELS } from '@shared';
import type { Command, CommandStatus, WasteType } from '@shared';
import { formatDateTime, formatTime } from '../lib/format';
import { MaterialCode } from './material';
import { EmptyState, StatusText } from './primitives';
import type { Tone } from './primitives';

export const COMMAND_TONE: Record<CommandStatus, Tone> = {
  PENDING: 'unknown',
  SENT: 'accent',
  SUCCEEDED: 'ok',
  FAILED: 'critical',
  TIMEOUT: 'warning',
};

export function CommandStatusText({ status }: { status: CommandStatus }) {
  return <StatusText tone={COMMAND_TONE[status]}>{COMMAND_STATUS_LABELS[status]}</StatusText>;
}

const isWaste = (t: string | null): t is WasteType => !!t && t in WASTE_LABELS;

/** 명령 대상 표시: 재질이면 코드칩, 모드면 한국어 */
export function CommandTarget({ target }: { target: string | null }) {
  if (!target) return <span className="muted">--</span>;
  if (isWaste(target)) return <MaterialCode type={target} size="sm" withLabel />;
  if (target === 'AUTO') return <span>자동</span>;
  if (target === 'MANUAL') return <span>수동</span>;
  return <span className="t-mono">{target}</span>;
}

export function commandTitle(c: Pick<Command, 'command' | 'target'>): string {
  const base = COMMAND_TYPE_LABELS[c.command] ?? c.command;
  if (c.command === 'OPEN_BIN' && isWaste(c.target)) return `${WASTE_LABELS[c.target]} ${base}`;
  if (c.command === 'SET_MODE') return c.target === 'AUTO' ? '자동 모드 전환' : c.target === 'MANUAL' ? '수동 모드 전환' : base;
  return base;
}

/** ACK 오류 코드 → 한국어 문구 + 원시 코드(작게, Mono). 코드표에 없으면 서버 문자열 그대로 */
export function CommandError({ code }: { code: string }) {
  const label = COMMAND_ERROR_LABELS[code];
  if (!label) return <span>{code}</span>;
  return (
    <span className="cmd-err">
      {label} <code className="cmd-err__code t-mono">{code}</code>
    </span>
  );
}

/** 결과/오류 메시지 (오류 우선) */
export function CommandMessage({ c }: { c: Pick<Command, 'error_message' | 'result_message'> }) {
  if (c.error_message) return <CommandError code={c.error_message} />;
  if (!c.result_message) return null;
  const label = COMMAND_RESULT_LABELS[c.result_message];
  return label ? (
    <span className="cmd-err">
      {label} <code className="cmd-err__code t-mono">{c.result_message}</code>
    </span>
  ) : (
    <span>{c.result_message}</span>
  );
}

/** 최근 명령 로그 (ledger 행). 결과/오류 메시지는 서버가 준 그대로 */
export function EventLog({ commands, limit = 8, empty = '최근 명령이 없습니다.' }: { commands: Command[]; limit?: number; empty?: string }) {
  if (!commands.length) return <EmptyState>{empty}</EmptyState>;
  return (
    <ol className="elog" aria-label="최근 명령 결과">
      {commands.slice(0, limit).map((c) => (
        <li key={c.command_id} className="elog__item" data-testid={`command-${c.command_id}`} data-status={c.status}>
          <time className="elog__time t-mono" dateTime={c.requested_at} title={formatDateTime(c.requested_at)}>
            {formatTime(c.executed_at ?? c.requested_at)}
          </time>
          <span className="elog__name">
            {commandTitle(c)}
            {c.origin === 'auto' && <span className="origin-tag">AI 자동</span>}
          </span>
          <span className="elog__status">
            <CommandStatusText status={c.status} />
          </span>
          {(c.error_message || c.result_message) && (
            <span className={`elog__msg ${c.error_message ? 'elog__msg--error' : ''}`}>
              <CommandMessage c={c} />
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
