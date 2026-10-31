import type { Command } from '@shared';
import { formatTime } from '../lib/format';
import { CommandError, commandTitle } from './commands';

type StepState = 'todo' | 'current' | 'done' | 'failed';

interface Step {
  label: string;
  state: StepState;
  detail?: string;
}

/** 실제 상태만으로 단계 계산. SUCCEEDED 가 아니면 절대 "실행 완료" 를 만들지 않는다. */
export function progressSteps(requesting: boolean, error: string | null, command: Command | null): Step[] {
  if (requesting) return [{ label: '요청', state: 'current', detail: '서버에 요청 중…' }, { label: '전송', state: 'todo' }, { label: '장치 응답', state: 'todo' }];
  if (error) return [{ label: '요청', state: 'failed', detail: '서버가 요청을 거부했습니다' }, { label: '전송', state: 'todo' }, { label: '장치 응답', state: 'todo' }];
  if (!command) return [];
  const req: Step = { label: '요청', state: 'done', detail: `접수 ${formatTime(command.requested_at)}` };
  switch (command.status) {
    case 'PENDING':
      return [req, { label: '전송', state: 'current', detail: '브로커로 전송 대기' }, { label: '장치 응답', state: 'todo' }];
    case 'SENT':
      return [req, { label: '전송', state: 'done', detail: '장치로 전송됨' }, { label: '장치 응답', state: 'current', detail: '장치 응답(ACK) 대기 중' }];
    case 'SUCCEEDED':
      return [req, { label: '전송', state: 'done' }, { label: '장치 응답', state: 'done', detail: `실행 완료 ${formatTime(command.executed_at)}` }];
    case 'FAILED':
      return [req, { label: '전송', state: 'done' }, { label: '장치 응답', state: 'failed', detail: '장치가 실패를 보고했습니다' }];
    case 'TIMEOUT':
      return [req, { label: '전송', state: 'done' }, { label: '장치 응답', state: 'failed', detail: '제한 시간 안에 응답이 없었습니다' }];
  }
}

export function CommandProgress({ requesting, error, command, pendingLabel }: { requesting: boolean; error: string | null; command: Command | null; pendingLabel?: string }) {
  const steps = progressSteps(requesting, error, command);
  if (!steps.length) {
    return <p className="cprog-idle">전송한 명령이 없습니다. 명령을 보내면 요청 → 전송 → 장치 응답 순서로 실제 상태가 표시됩니다.</p>;
  }
  const status = command?.status;
  const outcome =
    error ?? (status === 'SUCCEEDED' ? '실행 완료' : status === 'FAILED' ? '실패' : status === 'TIMEOUT' ? '응답 시간 초과' : status === 'SENT' ? '장치 응답 대기 중' : '처리 중');
  const tone = error || status === 'FAILED' ? 'critical' : status === 'TIMEOUT' ? 'warning' : status === 'SUCCEEDED' ? 'ok' : 'accent';
  const reason = command?.error_message ? <CommandError code={command.error_message} /> : status === 'SUCCEEDED' ? command?.result_message : null;
  return (
    <div className="cprog" data-testid="command-progress" data-status={error ? 'REJECTED' : (status ?? 'REQUESTING')}>
      <p className="cprog__title">
        <span>{command ? commandTitle(command) : pendingLabel}</span>
        {command && <span className="t-mono muted cprog__id">{command.command_id.slice(0, 8)}</span>}
      </p>
      <ol className="cprog__steps">
        {steps.map((s) => (
          <li key={s.label} data-state={s.state}>
            <span className="cprog__mark" aria-hidden />
            <span className="cprog__label">{s.label}</span>
            {s.detail && <span className="cprog__detail">{s.detail}</span>}
            <span className="sr-only">{{ todo: '대기', current: '진행 중', done: '완료', failed: '실패' }[s.state]}</span>
          </li>
        ))}
      </ol>
      <div className="cprog__outcome" data-tone={tone} role={tone === 'critical' || tone === 'warning' ? 'alert' : 'status'} aria-live="polite">
        <strong data-testid="command-outcome">{outcome}</strong>
        {reason && <span className="cprog__reason">{reason}</span>}
        {status === 'SENT' && <span className="cprog__wait" aria-hidden />}
      </div>
    </div>
  );
}
