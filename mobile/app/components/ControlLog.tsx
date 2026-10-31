import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useDashboard } from '../services/DashboardContext';
import { commandsKey } from '../services/controlRules';
import { describeError } from '../services/errors';
import { PAGE_SIZE, appendUnique, nextOffset, rangeLabel } from '../services/pagination';
import { MAINTENANCE_KIND_LABELS, type Command } from '../services/shared';
import { useTheme } from '../theme/useTheme';
import { CommandRow } from './Command';
import { Button, Empty, Hint, Section } from './primitives';

const LOG_PAGE = Math.min(PAGE_SIZE, 20);

/** 최근 제어 기록 (/api/commands, 최신순, "더 보기" = offset). 자동 명령은 행에서 "AI 자동"으로 구분. */
export function ControlLog({ deviceId }: { deviceId: string | undefined }) {
  const { api, dashboard } = useDashboard();
  const { c, t } = useTheme();
  const [items, setItems] = useState<Command[] | null>(null);
  const [total, setTotal] = useState(0);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const req = useRef(0);
  const key = commandsKey(dashboard?.recent_commands ?? []);

  const reload = useCallback(async () => {
    const id = ++req.current;
    try {
      const page = await api.commands({ device_id: deviceId, order: 'desc', limit: LOG_PAGE, offset: 0 });
      if (id !== req.current) return;
      setItems(page.items);
      setTotal(page.total);
      setNext(nextOffset(page));
      setError(null);
    } catch (e) {
      if (id === req.current) setError(describeError(e));
    }
  }, [api, deviceId]);

  useEffect(() => {
    void reload();
  }, [reload, key]);

  const more = async () => {
    if (next === null) return;
    setLoadingMore(true);
    try {
      const page = await api.commands({ device_id: deviceId, order: 'desc', limit: LOG_PAGE, offset: next });
      setItems((prev) => appendUnique(prev ?? [], page.items, (x) => x.command_id));
      setTotal(page.total);
      setNext(nextOffset(page));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setLoadingMore(false);
    }
  };

  // 기록 API 실패 시 스냅샷의 최근 명령으로 대체 (출처를 명시)
  const fallback = error ? (dashboard?.recent_commands ?? []).filter((x) => !deviceId || x.device_id === deviceId) : null;
  const list = items ?? fallback ?? [];

  return (
    <Section title="최근 제어 기록" gap={0} right={items ? <Text style={[t.caption, t.tabular, { color: c.ink3 }]}>{rangeLabel(items.length, total)}</Text> : null}>
      {error ? <Hint text={`기록을 불러오지 못해 최근 ${fallback?.length ?? 0}건만 표시합니다. ${error}`} tone="warning" /> : null}
      {!items && !error ? <Text style={[t.label, { color: c.ink3, paddingVertical: 8 }]}>불러오는 중…</Text> : null}
      {items && list.length === 0 ? <Empty text="제어 기록이 없습니다." /> : null}
      {list.map((cmd, i) => (
        <CommandRow key={cmd.command_id} cmd={cmd} showDate last={i === list.length - 1} />
      ))}
      {items && next !== null ? <Button label="더 보기" onPress={() => void more()} busy={loadingMore} style={{ marginTop: 12 }} /> : null}
    </Section>
  );
}

/** 모터 테스트 결과를 점검 기록으로 남기기 (선택). 결과는 관리자가 판단 — ACK 성공이어도 소리·동작 이상이면 "이상". */
export function MotorTestRecord({ cmd, hasToken }: { cmd: Command; hasToken: boolean }) {
  const { api } = useDashboard();
  const { c, t, space } = useTheme();
  const [saving, setSaving] = useState<'ok' | 'issue' | null>(null);
  const [saved, setSaved] = useState<'ok' | 'issue' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (result: 'ok' | 'issue') => {
    setSaving(result);
    setError(null);
    try {
      await api.createMaintenance({
        device_id: cmd.device_id,
        bin_id: cmd.bin_id ?? null,
        kind: 'motor_test',
        result,
        related_command_id: cmd.command_id,
        note: `앱 모터 테스트 · 명령 결과 ${cmd.status}`,
      });
      setSaved(result);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSaving(null);
    }
  };

  if (saved) {
    return <Hint text={`${MAINTENANCE_KIND_LABELS.motor_test} 기록 저장됨 · ${saved === 'ok' ? '정상' : '이상'}`} tone="ok" />;
  }
  return (
    <View style={{ gap: space.s2, paddingTop: space.s2 }}>
      <Text style={[t.label, { color: c.ink2 }]}>{MAINTENANCE_KIND_LABELS.motor_test} 결과를 점검 기록으로 남길까요? (선택)</Text>
      <View style={{ flexDirection: 'row', gap: space.s2 }}>
        <Button label="정상으로 기록" compact style={{ flex: 1 }} busy={saving === 'ok'} disabled={!hasToken || !!saving} onPress={() => void save('ok')} />
        <Button label="이상으로 기록" compact style={{ flex: 1 }} busy={saving === 'issue'} disabled={!hasToken || !!saving} onPress={() => void save('issue')} />
      </View>
      <Hint text={error} tone="critical" />
    </View>
  );
}
