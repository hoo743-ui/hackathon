import React, { useEffect, useRef } from 'react';
import { Animated, Text, View } from 'react-native';
import { commandFailureReason, commandStage, commandTitle, isWasteType, PROGRESS_STEPS, type FailureReason } from '../services/commandProgress';
import { useDashboard } from '../services/DashboardContext';
import { formatTime } from '../services/format';
import type { Command, WasteType } from '../services/shared';
import { useTheme } from '../theme/useTheme';
import { MaterialCode } from './MaterialCode';

export function useStageColor() {
  const { c } = useTheme();
  return (tone: 'pending' | 'ok' | 'critical') => (tone === 'ok' ? c.ok : tone === 'critical' ? c.critical : c.ink2);
}

/** 명령 대상 재질: bin_id(서버가 기록한 대상 칸) 우선, 없으면 target */
function useCommandMaterial(cmd: Command): WasteType | null {
  const { dashboard } = useDashboard();
  if (cmd.bin_id) {
    const bin = dashboard?.bins.find((b) => b.bin_id === cmd.bin_id);
    if (bin) return bin.waste_type;
  }
  return isWasteType(cmd.target) ? cmd.target : null;
}

/** 실패 사유: 한국어 문구 + 원시 코드(작게, Mono) */
function FailureText({ reason }: { reason: FailureReason }) {
  const { c, t } = useTheme();
  return (
    <Text style={[t.label, { color: c.critical }]}>
      {reason.text}
      {reason.code ? <Text style={[t.mono, { fontSize: 11, color: c.ink3 }]}>  {reason.code}</Text> : null}
    </Text>
  );
}

const reasonText = (r: FailureReason | null) => (r ? `${r.text}${r.code ? ` (${r.code})` : ''}` : '');

/** 명령 이력 한 줄 (ledger). 상태는 서버 값 그대로 — SUCCEEDED 일 때만 "실행 완료". */
export function CommandRow({ cmd, showDate, last }: { cmd: Command; showDate?: boolean; last?: boolean }) {
  const { c, t, space } = useTheme();
  const stage = commandStage(cmd.status);
  const color = useStageColor()(stage.tone);
  const failure = commandFailureReason(cmd);
  const material = useCommandMaterial(cmd);
  const time = showDate ? cmd.requested_at.slice(5, 10).replace('-', '/') + ' ' + formatTime(cmd.requested_at) : formatTime(cmd.requested_at);
  return (
    <View
      accessible
      accessibilityLabel={`${formatTime(cmd.requested_at)} ${cmd.origin === 'auto' ? 'AI 자동 ' : ''}${commandTitle(cmd)}, ${stage.label}${failure ? `, ${reasonText(failure)}` : ''}`}
      style={{ paddingVertical: space.s3, gap: space.s1, borderBottomWidth: last ? 0 : 1, borderBottomColor: c.rule, minHeight: 44 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s2 }}>
        {material ? <MaterialCode type={material} size="sm" /> : null}
        <Text style={[t.bodyStrong, { color: c.ink, flex: 1 }]} numberOfLines={1}>
          {commandTitle(cmd)}
        </Text>
        <Text style={[t.label, { color }]}>{stage.label}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s2 }}>
        {cmd.origin === 'auto' ? (
          <View accessible accessibilityLabel="AI 자동 명령" style={{ borderWidth: 1, borderColor: c.accent, borderRadius: 2, paddingHorizontal: 4 }}>
            <Text style={[t.caption, { color: c.accent }]}>AI 자동</Text>
          </View>
        ) : null}
        <Text style={[t.mono, { color: c.ink3, fontSize: 12, flexShrink: 1 }]}>
          {time}
          {cmd.executed_at ? ` → ${formatTime(cmd.executed_at)}` : ''}
          {cmd.bin_id ? ` · ${cmd.bin_id}` : ''}
        </Text>
      </View>
      {failure ? <FailureText reason={failure} /> : null}
    </View>
  );
}

/**
 * 명령 진행: 요청 → 전송 → 장치 응답. 실제 서버 상태만 반영.
 * requesting: HTTP 응답 전(아직 서버가 받지 않음). requestError: 서버가 거부(4xx 등) — 장치로 가지 않음.
 */
export function CommandProgress({
  cmd,
  requestingTitle,
  requestError,
}: {
  cmd: Command | undefined;
  requestingTitle?: string | null;
  requestError?: string | null;
}) {
  const { c, t, space, reduceMotion } = useTheme();
  const stageColor = useStageColor();
  const stage = cmd ? commandStage(cmd.status) : null;
  const step = stage ? stage.step : 0;
  const waiting = cmd?.status === 'SENT' || cmd?.status === 'PENDING' || (!cmd && !!requestingTitle && !requestError);
  const pulse = useRef(new Animated.Value(1)).current;
  const { dashboard } = useDashboard();
  const progressBin = cmd?.bin_id ? dashboard?.bins.find((b) => b.bin_id === cmd.bin_id) : undefined;
  const material: WasteType | null = progressBin?.waste_type ?? (cmd && isWasteType(cmd.target) ? cmd.target : null);

  useEffect(() => {
    if (!waiting || reduceMotion) {
      pulse.setValue(1);
      return;
    }
    // 허용된 유일한 반복 애니메이션: 장치 응답(ACK) 대기 표시
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.35, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [waiting, reduceMotion, pulse]);

  const title = cmd ? commandTitle(cmd) : requestingTitle ?? '';
  const label = requestError ? '요청 거부 · 장치로 전송되지 않음' : stage ? stage.label : '요청 중…';
  const labelColor = requestError ? c.critical : stage ? stageColor(stage.tone) : c.ink2;
  const failure: FailureReason | null = cmd ? commandFailureReason(cmd) : requestError ? { text: requestError, code: null } : null;

  return (
    <View accessible accessibilityLiveRegion="polite" accessibilityLabel={`${title}: ${label}${failure ? `. ${reasonText(failure)}` : ''}`} style={{ gap: space.s2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s2 }}>
        {material ? <MaterialCode type={material} size="sm" /> : null}
        <Text style={[t.bodyStrong, { color: c.ink, flex: 1 }]} numberOfLines={1}>
          {title}
        </Text>
        {cmd ? <Text style={[t.mono, { color: c.ink3, fontSize: 12 }]}>{cmd.command_id.slice(0, 8)}</Text> : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        {PROGRESS_STEPS.map((name, i) => {
          const done = stage ? i < step || (i === step && stage.final) : false;
          const current = !requestError && i === step && !stage?.final;
          const failedStep = (requestError && i === 0) || (stage?.final && !stage.succeeded && i === 2);
          const bg = failedStep ? c.critical : done ? (stage?.succeeded && i === 2 ? c.ok : c.ink) : current ? c.ink2 : c.surfaceSunken;
          return (
            <View key={name} style={{ flex: 1, gap: 4 }}>
              <Animated.View style={{ height: 4, backgroundColor: bg, opacity: current && waiting ? pulse : 1 }} />
              <Text style={[t.caption, { color: done || current || failedStep ? c.ink : c.ink3 }]}>{name}</Text>
            </View>
          );
        })}
      </View>
      <Text style={[t.bodyStrong, { color: labelColor }]}>{label}</Text>
      {failure ? <FailureText reason={failure} /> : null}
      {cmd?.status === 'SUCCEEDED' && cmd.result_message ? <Text style={[t.label, { color: c.ink2 }]}>{cmd.result_message}</Text> : null}
    </View>
  );
}
