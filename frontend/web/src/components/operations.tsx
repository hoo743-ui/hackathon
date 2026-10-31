import { useState } from 'react';
import type { FormEvent } from 'react';
import { COMMAND_STATUS_LABELS, FINAL_COMMAND_STATUSES, MAINTENANCE_KIND_LABELS, SENSOR_STATUS_LABELS, WASTE_LABELS } from '@shared';
import type { Bin, Command, MaintenanceCreate, MaintenanceKind, MaintenanceLog } from '@shared';
import { useDashboard } from '../data/DashboardContext';
import { useControlToken } from '../lib/controlToken';
import { describeError, formatDateTime, formatDistance, formatStamp } from '../lib/format';
import type { CommandTracker } from '../lib/useCommand';
import { CommandError } from './commands';
import { MaterialCode } from './material';
import { Button, EmptyState, StatusText } from './primitives';
import type { Tone } from './primitives';

/** 점검 기록 저장 (제어 토큰 필요) */
export function useCreateMaintenance() {
  const { source } = useDashboard();
  const { token } = useControlToken();
  return (body: MaintenanceCreate) => source.api(token.trim()).createMaintenance(body);
}

const isFinal = (c: Command | null) => !!c && FINAL_COMMAND_STATUSES.includes(c.status);

/**
 * 모터 테스트: 칸별 OPEN_BIN → 실제 ACK 상태 표시 → 최종 상태가 된 뒤에만 "점검 기록 저장".
 * 결과(ok/issue)는 서버가 준 최종 상태로만 정한다 (SUCCEEDED 만 ok).
 */
export function MotorTest({ bins, tracker, blockReason, deviceId }: { bins: Bin[]; tracker: CommandTracker; blockReason: string | null; deviceId?: string }) {
  const create = useCreateMaintenance();
  const [saved, setSaved] = useState<Record<string, number>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const cmd = tracker.command;
  const activeBin = tracker.key?.startsWith('motor-') ? tracker.key.slice(6) : null;

  const save = async (bin: Bin) => {
    if (!cmd || !isFinal(cmd)) return;
    setSaving(true);
    setSaveError(null);
    try {
      const log = await create({
        device_id: deviceId,
        bin_id: bin.bin_id,
        kind: 'motor_test',
        result: cmd.status === 'SUCCEEDED' ? 'ok' : 'issue',
        related_command_id: cmd.command_id,
        note: `배출 테스트 ACK: ${COMMAND_STATUS_LABELS[cmd.status]}${cmd.error_message ? ` (${cmd.error_message})` : cmd.result_message ? ` (${cmd.result_message})` : ''}`,
      });
      setSaved((s) => ({ ...s, [cmd.command_id]: log.id }));
    } catch (e) {
      setSaveError(describeError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="table-wrap">
      <table className="table table--dense test-table" data-testid="motor-test">
        <thead>
          <tr>
            <th scope="col">칸</th>
            <th scope="col">테스트</th>
            <th scope="col">장치 응답</th>
            <th scope="col">기록</th>
          </tr>
        </thead>
        <tbody>
          {bins.map((b) => {
            const mine = activeBin === b.bin_id;
            const c = mine ? cmd : null;
            const final = isFinal(c);
            const savedId = c ? saved[c.command_id] : undefined;
            return (
              <tr key={b.bin_id} data-testid={`motor-${b.bin_id}`}>
                <th scope="row">
                  <MaterialCode type={b.waste_type} size="sm" withLabel />
                </th>
                <td>
                  <Button size="sm" disabled={!!blockReason || tracker.requesting} onClick={() => void tracker.send(`motor-${b.bin_id}`, { command: 'OPEN_BIN', target: b.waste_type })}>
                    배출 테스트
                  </Button>
                </td>
                <td data-testid={`motor-result-${b.bin_id}`}>
                  {mine && tracker.requesting ? (
                    <span className="muted">요청 중…</span>
                  ) : mine && tracker.error ? (
                    <span className="is-bad">{tracker.error}</span>
                  ) : c ? (
                    <MotorResult c={c} />
                  ) : (
                    <span className="muted">--</span>
                  )}
                </td>
                <td>
                  {savedId ? (
                    <span className="is-ok">기록됨 #{savedId}</span>
                  ) : (
                    <Button size="sm" variant="quiet" disabled={!final || saving} onClick={() => void save(b)} title={final ? undefined : '장치 응답(최종 상태) 후 저장할 수 있습니다'}>
                      점검 기록 저장
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      {saveError && (
        <p className="field-error" role="alert">
          {saveError}
        </p>
      )}
      <p className="reason">{blockReason ?? '배출구를 한 번 열고 닫습니다. 서보 위치 센서가 없으므로 결과는 장치 ACK 기준입니다.'}</p>
    </>
  );
}

function MotorResult({ c }: { c: Command }) {
  if (c.status === 'SUCCEEDED') return <StatusText tone="ok">정상 동작 (ACK)</StatusText>;
  if (c.status === 'FAILED' || c.status === 'TIMEOUT')
    return (
      <span className="motor-fail">
        <StatusText tone={c.status === 'FAILED' ? 'critical' : 'warning'}>{COMMAND_STATUS_LABELS[c.status]}</StatusText>
        {c.error_message && <CommandError code={c.error_message} />}
      </span>
    );
  return <StatusText tone="accent">{COMMAND_STATUS_LABELS[c.status]}</StatusText>;
}

function freshness(updatedAt: string, now: number): { tone: Tone; label: string; sec: number } {
  const sec = Math.max(0, Math.round((now - Date.parse(updatedAt)) / 1000));
  if (sec <= 10) return { tone: 'ok', label: '최신', sec };
  if (sec <= 60) return { tone: 'attention', label: '지연', sec };
  return { tone: 'critical', label: '오래됨', sec };
}

/** 센서 테스트: 칸별 실시간 거리·상태·측정 신선도를 보고 정상/이상을 기록 */
export function SensorTest({ bins, now, hasToken, deviceId }: { bins: Bin[]; now: number; hasToken: boolean; deviceId?: string }) {
  const create = useCreateMaintenance();
  const [done, setDone] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const record = async (b: Bin, result: 'ok' | 'issue') => {
    setError(null);
    try {
      const log = await create({
        device_id: deviceId,
        bin_id: b.bin_id,
        kind: 'sensor_test',
        result,
        note: `거리 ${formatDistance(b.current_distance_cm)} · 상태 ${b.sensor_status ? SENSOR_STATUS_LABELS[b.sensor_status] : '없음'} · 측정 ${formatStamp(b.updated_at)}`,
      });
      setDone((d) => ({ ...d, [b.bin_id]: `${result === 'ok' ? '정상' : '이상'} 기록됨 #${log.id}` }));
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <>
      <div className="table-wrap">
      <table className="table table--dense test-table" data-testid="sensor-test">
        <thead>
          <tr>
            <th scope="col">칸</th>
            <th scope="col" className="num">
              거리
            </th>
            <th scope="col">상태</th>
            <th scope="col">측정 신선도</th>
            <th scope="col">판정 기록</th>
          </tr>
        </thead>
        <tbody>
          {bins.map((b) => {
            const f = freshness(b.updated_at, now);
            return (
              <tr key={b.bin_id}>
                <th scope="row">
                  <MaterialCode type={b.waste_type} size="sm" withLabel />
                </th>
                <td className="num t-mono">{formatDistance(b.current_distance_cm)}</td>
                <td>
                  <StatusText tone={b.sensor_status === 'normal' ? 'ok' : b.sensor_status ? 'critical' : 'unknown'}>{b.sensor_status ? SENSOR_STATUS_LABELS[b.sensor_status] : '--'}</StatusText>
                </td>
                <td title={formatDateTime(b.updated_at)}>
                  <StatusText tone={f.tone}>
                    {f.label} <span className="t-mono muted">{f.sec}초 전</span>
                  </StatusText>
                </td>
                <td>
                  {done[b.bin_id] ? (
                    <span className="is-ok">{done[b.bin_id]}</span>
                  ) : (
                    <span className="btn-pair">
                      <Button size="sm" disabled={!hasToken} onClick={() => void record(b, 'ok')} aria-label={`${WASTE_LABELS[b.waste_type]} 센서 정상 기록`}>
                        정상
                      </Button>
                      <Button size="sm" disabled={!hasToken} onClick={() => void record(b, 'issue')} aria-label={`${WASTE_LABELS[b.waste_type]} 센서 이상 기록`}>
                        이상
                      </Button>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

const KINDS: MaintenanceKind[] = ['inspection', 'emptied', 'repair', 'sensor_test', 'motor_test'];

export function MaintenanceForm({ bins, hasToken, deviceId }: { bins: Bin[]; hasToken: boolean; deviceId?: string }) {
  const create = useCreateMaintenance();
  const [kind, setKind] = useState<MaintenanceKind>('inspection');
  const [bin, setBin] = useState('');
  const [result, setResult] = useState<'ok' | 'issue'>('ok');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const log = await create({ device_id: deviceId, kind, bin_id: bin || null, result, note: note.trim() || null });
      setMsg({ ok: true, text: `저장했습니다 (#${log.id}).` });
      setNote('');
    } catch (err) {
      setMsg({ ok: false, text: describeError(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="mform" onSubmit={submit} aria-label="점검 기록 작성">
      <label className="field">
        <span className="t-label">종류</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as MaintenanceKind)}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {MAINTENANCE_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="t-label">칸</span>
        <select value={bin} onChange={(e) => setBin(e.target.value)}>
          <option value="">장치 전체</option>
          {bins.map((b) => (
            <option key={b.bin_id} value={b.bin_id}>
              {WASTE_LABELS[b.waste_type]} ({b.bin_id})
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="t-label">결과</span>
        <select value={result} onChange={(e) => setResult(e.target.value as 'ok' | 'issue')}>
          <option value="ok">정상</option>
          <option value="issue">이상</option>
        </select>
      </label>
      <label className="field mform__note">
        <span className="t-label">메모</span>
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 플라스틱 칸 비움, 센서 렌즈 청소" maxLength={500} />
      </label>
      <div className="mform__act">
        <Button type="submit" variant="primary" disabled={!hasToken || saving}>
          {saving ? '저장 중…' : '점검 기록 저장'}
        </Button>
        {msg && (
          <span className={msg.ok ? 'is-ok' : 'is-bad'} role={msg.ok ? 'status' : 'alert'}>
            {msg.text}
          </span>
        )}
      </div>
    </form>
  );
}

export function MaintenanceList({ items, bins }: { items: MaintenanceLog[]; bins: Bin[] }) {
  if (!items.length) return <EmptyState>점검 기록이 없습니다.</EmptyState>;
  const types = new Map(bins.map((b) => [b.bin_id, b.waste_type]));
  return (
    <ol className="elog" aria-label="점검 기록" data-testid="maintenance-list">
      {items.map((m) => {
        const t = m.bin_id ? types.get(m.bin_id) : undefined;
        return (
          <li key={m.id} className="elog__item">
            <time className="elog__time t-mono" dateTime={m.created_at} title={formatDateTime(m.created_at)}>
              {formatStamp(m.created_at).slice(-8)}
            </time>
            <span className="elog__name">
              {MAINTENANCE_KIND_LABELS[m.kind] ?? m.kind}
              {t && (
                <>
                  {' '}
                  <MaterialCode type={t} size="sm" />
                </>
              )}
            </span>
            <span className="elog__status">
              <StatusText tone={m.result === 'ok' ? 'ok' : 'critical'}>{m.result === 'ok' ? '정상' : '이상'}</StatusText>
            </span>
            {(m.note || m.related_command_id) && (
              <span className="elog__msg">
                {m.note}
                {m.related_command_id && <span className="t-mono"> · 명령 {m.related_command_id.slice(0, 8)}</span>}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
