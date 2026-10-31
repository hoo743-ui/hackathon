import React, { useState } from 'react';
import { ActivityIndicator, Image, Text, View } from 'react-native';
import { API_BASE_URL } from '../services/config';
import { detectionMaterial, formatConfidence } from '../services/alertsView';
import { formatRelative, formatTime } from '../services/format';
import { DETECTION_OUTCOME_LABELS, HARDWARE_STATUS_LABELS, WASTE_LABELS, detectionImageUrl, type Detection, type EdgeStatus } from '../services/shared';
import { useTheme } from '../theme/useTheme';
import { MaterialCode } from './MaterialCode';

/** 최신 인식 결과: 맥북 백엔드에 저장된 YOLO 이미지(bounding box 포함) + 종류·신뢰도·시각·ID. 웹과 같은 데이터. */
export function LiveDetection({ d, now }: { d: Detection; now: number }) {
  const { c, t, space } = useTheme();
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const uri = detectionImageUrl(API_BASE_URL, d);
  const material = detectionMaterial(d);
  const hw = d.hardware_status ? HARDWARE_STATUS_LABELS[d.hardware_status] ?? d.hardware_status : null;
  return (
    <View style={{ gap: space.s3 }} testID="live-detection">
      <View style={{ width: '100%', aspectRatio: 4 / 3, backgroundColor: c.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
        {uri ? (
          <Image
            key={uri}
            source={{ uri }}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            resizeMode="contain"
            onLoad={() => setState('ok')}
            onError={() => setState('error')}
            accessibilityLabel={`분류 이미지 ${d.waste_type}`}
          />
        ) : null}
        {!uri ? <Text style={[t.label, { color: c.ink3 }]}>이미지 없음</Text> : null}
        {uri && state === 'loading' ? <ActivityIndicator color={c.ink3} /> : null}
        {uri && state === 'error' ? <Text style={[t.label, { color: c.warning }]}>이미지를 불러오지 못함</Text> : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s3, flexWrap: 'wrap' }}>
        {material ? <MaterialCode type={material} /> : null}
        <Text style={{ fontSize: 30, fontWeight: '700', color: c.ink }}>{material ? WASTE_LABELS[material] : d.waste_type}</Text>
        <Text style={[t.monoStrong, { fontSize: 24, color: c.ink }]}>{formatConfidence(d.confidence)}</Text>
      </View>
      <Text style={[t.label, { color: c.ink2 }]}>
        촬영 {formatTime(d.captured_at ?? d.detected_at)} · {formatRelative(d.received_at, now)} · {d.camera_id ?? '--'}
      </Text>
      <Text style={[t.label, { color: c.ink2 }]}>
        {d.outcome ? DETECTION_OUTCOME_LABELS[d.outcome] ?? d.outcome : '처리 결과 없음'}
        {hw ? ` · 하드웨어: ${hw}` : ''}
      </Text>
      <Text style={[t.mono, { color: c.ink3, fontSize: 11 }]} selectable>
        ID {d.detection_id ?? `#${d.id}`}
      </Text>
    </View>
  );
}

/** 카메라 노트북 상태 한 줄 요약 */
export function EdgeLine({ edges }: { edges: EdgeStatus[] }) {
  const { c, t } = useTheme();
  if (!edges.length) return <Text style={[t.label, { color: c.ink3 }]}>카메라 노트북 연결 기록 없음</Text>;
  return (
    <>
      {edges.map((e) => {
        const parts = [
          `카메라 ${e.online && e.camera_ok ? '정상' : '끊김'}`,
          `모델 ${e.online && e.model_loaded ? '정상' : '없음'}`,
          e.serial_enabled ? `UNO ${e.online && e.serial_connected ? '연결' : '미연결'}` : '하드웨어 비활성',
          `서보 성공 ${e.sorted_ok ?? 0}/실패 ${e.sorted_failed ?? 0}`,
          e.sensor_status === 'normal'
            ? `거리 ${e.distance_cm ?? '--'}cm · 적재율 ${e.fill_percent != null ? `${e.fill_percent}%` : '--'}`
            : e.sensor_status === 'disconnected'
              ? 'SENSOR_DISCONNECTED'
              : '센서 수신 없음',
          `전송 대기 ${e.upload_queue}`,
        ];
        return (
          <Text key={e.device_id} style={[t.label, { color: e.online ? c.ink2 : c.critical }]}>
            {e.device_id} {e.online ? '온라인' : '오프라인'} · {parts.join(' · ')}
          </Text>
        );
      })}
    </>
  );
}
