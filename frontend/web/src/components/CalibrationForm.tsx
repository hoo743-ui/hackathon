import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { Bin } from '@shared';
import { useDashboard } from '../data/DashboardContext';
import { useControlToken } from '../lib/controlToken';
import { describeError, formatDistance } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { MaterialCode } from './material';
import { WASTE_LABELS } from '@shared';
import { Button, StatusText } from './primitives';

/** bin 하나의 보정 읽기 + 편집 (PUT /api/bins/{id}/calibration, 제어 토큰 필요) */
export function CalibrationRow({ bin }: { bin: Bin }) {
  const { api, source, resync } = useDashboard();
  const { token } = useControlToken();
  const cal = useAsync(() => api.calibration(bin.bin_id), [api, bin.bin_id]);
  const [empty, setEmpty] = useState('');
  const [full, setFull] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const idBase = `cal-${bin.bin_id}`;

  useEffect(() => {
    if (!cal.data) return;
    setEmpty(cal.data.empty_distance_cm?.toString() ?? '');
    setFull(cal.data.full_distance_cm?.toString() ?? '');
  }, [cal.data]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    const emptyCm = Number(empty);
    const fullCm = Number(full);
    if (!empty || !full || !Number.isFinite(emptyCm) || !Number.isFinite(fullCm)) {
      setMessage({ ok: false, text: '두 값을 모두 숫자로 입력하세요.' });
      return;
    }
    if (fullCm <= 0 || emptyCm <= fullCm) {
      setMessage({ ok: false, text: '빈 통 거리는 가득 찬 거리보다 커야 하며, 0보다 커야 합니다.' });
      return;
    }
    if (!token.trim()) {
      setMessage({ ok: false, text: '제어 토큰을 먼저 입력하세요 (헤더의 앱 설정).' });
      return;
    }
    setSaving(true);
    try {
      await source.api(token.trim()).updateCalibration(bin.bin_id, emptyCm, fullCm);
      setMessage({ ok: true, text: '저장했습니다. 적재율은 서버에서 다시 계산됩니다.' });
      cal.reload();
      void resync();
    } catch (err) {
      setMessage({ ok: false, text: describeError(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="calrow" onSubmit={onSubmit} aria-label={`${WASTE_LABELS[bin.waste_type]} 보정값 수정`} data-testid={`calibration-${bin.bin_id}`}>
      <div className="calrow__id">
        <MaterialCode type={bin.waste_type} />
        <span>
          {WASTE_LABELS[bin.waste_type]}
          <span className="t-mono muted calrow__bin">{bin.bin_id}</span>
        </span>
      </div>
      <div className="calrow__now">
        {cal.error ? (
          <span className="is-bad">불러오기 실패</span>
        ) : cal.data ? (
          <>
            <StatusText tone={cal.data.calibrated ? 'ok' : 'unknown'}>{cal.data.calibrated ? '보정됨' : '미보정'}</StatusText>
            <span className="t-mono muted">
              {formatDistance(cal.data.empty_distance_cm)} → {formatDistance(cal.data.full_distance_cm)}
            </span>
          </>
        ) : (
          <span className="muted">불러오는 중…</span>
        )}
        <span className="t-mono muted calrow__cur">현재 {formatDistance(bin.current_distance_cm)}</span>
      </div>
      <label className="field" htmlFor={`${idBase}-empty`}>
        <span className="t-label">빈 통 거리 (cm)</span>
        <input id={`${idBase}-empty`} type="number" inputMode="decimal" step="0.1" min="0" value={empty} onChange={(e) => setEmpty(e.target.value)} />
      </label>
      <label className="field" htmlFor={`${idBase}-full`}>
        <span className="t-label">가득 찬 거리 (cm)</span>
        <input id={`${idBase}-full`} type="number" inputMode="decimal" step="0.1" min="0" value={full} onChange={(e) => setFull(e.target.value)} />
      </label>
      <div className="calrow__act">
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? '저장 중…' : '저장'}
        </Button>
      </div>
      {message && (
        <p className={`calrow__msg ${message.ok ? 'is-ok' : 'is-bad'}`} role={message.ok ? 'status' : 'alert'}>
          {message.text}
        </p>
      )}
    </form>
  );
}
