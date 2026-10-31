import React from 'react';
import { Text, View } from 'react-native';
import { detectionMaterial, formatConfidence } from '../services/alertsView';
import { formatTime } from '../services/format';
import { outcomeDetailLabel, DETECTION_OUTCOME_LABELS, WASTE_LABELS, type Detection } from '../services/shared';
import { useTheme } from '../theme/useTheme';
import { MaterialCode } from './MaterialCode';

/** AI 분류 한 줄: 종류 코드 · confidence(모델값, 소수 2자리) · 처리 결과. 분류 성공은 SORTED(ACK) 일 때만. */
export function DetectionRow({ d, last }: { d: Detection; last?: boolean }) {
  const { c, t, space, radius } = useTheme();
  const material = detectionMaterial(d);
  const outcome = d.outcome ? DETECTION_OUTCOME_LABELS[d.outcome] ?? d.outcome : '처리 결과 없음';
  const tone =
    d.outcome === 'SORTED' ? c.ok : d.outcome === 'SORT_SENT' ? c.warning : d.outcome === 'SORT_FAILED' || d.outcome === 'DEVICE_UNAVAILABLE' || d.outcome === 'UNRECOGNIZED' ? c.critical : c.ink2;
  const detail = outcomeDetailLabel(d.outcome_detail);
  return (
    <View
      accessible
      accessibilityLabel={`${formatTime(d.detected_at)} AI 분류 ${d.waste_type}, 신뢰도 ${formatConfidence(d.confidence)}, ${outcome}${d.source === 'simulator' ? ', 시뮬레이터' : ''}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.s3, paddingVertical: space.s3, minHeight: 52, borderBottomWidth: last ? 0 : 1, borderBottomColor: c.rule }}
    >
      {material ? (
        <MaterialCode type={material} size="sm" />
      ) : (
        <View style={{ width: 20, height: 20, borderRadius: radius.chip, borderWidth: 1, borderColor: c.ink3, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={[t.caption, { fontSize: 10, color: c.ink3 }]}>?</Text>
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.s2 }}>
          <Text style={[t.bodyStrong, { color: c.ink, flexShrink: 1 }]} numberOfLines={1}>
            {material ? WASTE_LABELS[material] : d.waste_type}
          </Text>
          <Text style={[t.monoStrong, { color: c.ink }]}>{formatConfidence(d.confidence)}</Text>
          {d.source === 'simulator' ? <Text style={[t.caption, { color: c.warning }]}>시뮬레이터</Text> : null}
        </View>
        <Text style={[t.label, { color: tone }]} numberOfLines={2}>
          {outcome}
          {detail ? <Text style={{ color: c.ink3 }}> · {detail}</Text> : null}
        </Text>
      </View>
      <Text style={[t.mono, { color: c.ink3, fontSize: 12 }]}>{formatTime(d.detected_at)}</Text>
    </View>
  );
}
