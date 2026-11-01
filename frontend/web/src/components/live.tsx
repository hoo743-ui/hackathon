import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { HARDWARE_STATUS_LABELS, WASTE_LABELS, detectionImageUrl } from '@shared';
import type { Detection, EdgeStatus, Telemetry } from '@shared';
import { config } from '../config';
import { formatDateTime, formatRelative, formatTime } from '../lib/format';
import { Confidence, DetectionType, OutcomeText } from './detections';
import { EmptyState, StatusText } from './primitives';
import type { Tone } from './primitives';

const HW_TONE: Record<string, Tone> = {
  completed: 'ok',
  ack_timeout: 'critical',
  rejected_busy: 'warning',
  aborted: 'critical',
  command_sent: 'attention',
  pending: 'accent',
  serial_failed: 'critical',
  not_connected: 'warning',
  skipped_busy: 'attention',
  disabled: 'neutral',
};

/** 분류 이미지 (YOLO annotated · bounding box 포함). 로딩·오류 상태를 구분한다. */
export function DetectionImage({ d, className = '' }: { d: Detection; className?: string }) {
  const src = detectionImageUrl(config.apiBaseUrl, d);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  if (!src) return <div className={`detimg detimg--none ${className}`}>이미지 없음</div>;
  return (
    <div className={`detimg ${className}`} data-state={state}>
      {state === 'loading' && <span className="detimg__msg">이미지 불러오는 중…</span>}
      {state === 'error' && <span className="detimg__msg">이미지를 불러오지 못함</span>}
      <img
        key={src}
        src={src}
        alt={`분류 이미지 ${d.waste_type}`}
        onLoad={() => setState('ok')}
        onError={() => setState('error')}
        style={state === 'ok' ? undefined : { visibility: 'hidden' }}
      />
    </div>
  );
}

/** 긴 ID 복사. LAN(http) 에서는 navigator.clipboard 가 없을 수 있어 textarea 방식으로 대체 */
export function CopyButton({ text, label = '복사' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      setDone(false);
    }
  };
  return (
    <button type="button" className="copy-btn" onClick={() => void copy()} aria-label={`${label}: ${text}`}>
      {done ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      {done ? '복사됨' : label}
    </button>
  );
}

/** 개요 최상단: 가장 최근 인식 결과. 방금(10초 이내) 도착한 결과는 짧게 강조한다 */
export function LiveDetection({ d, now }: { d: Detection | undefined; now: number }) {
  if (!d) return <EmptyState>아직 인식 결과 없음 — 카메라 컴퓨터 앞에 쓰레기를 보여 주세요</EmptyState>;
  const label = WASTE_LABELS[d.waste_type as keyof typeof WASTE_LABELS] ?? d.waste_type;
  const fresh = now - Date.parse(d.received_at) < 10_000;
  return (
    <div className={`live${fresh ? ' live--new' : ''}`} data-testid="live-detection" data-detection-id={d.detection_id ?? ''}>
      <DetectionImage key={d.id} d={d} className="live__img" />
      <dl className="live__facts">
        <div className="live__type">
          <dt>분류</dt>
          <dd>
            <span className="live__label">{label}</span> <DetectionType type={d.waste_type} withLabel={false} />
          </dd>
        </div>
        <div>
          <dt>신뢰도</dt>
          <dd className="live__conf">
            <Confidence value={d.confidence} />
          </dd>
        </div>
        <div>
          <dt>촬영 시각</dt>
          <dd className="t-mono" title={formatDateTime(d.captured_at ?? d.detected_at)}>
            {formatTime(d.captured_at ?? d.detected_at)} <span className="muted">({formatRelative(d.received_at, now)})</span>
          </dd>
        </div>
        <div>
          <dt>처리 결과</dt>
          <dd>
            <OutcomeText outcome={d.outcome} />
          </dd>
        </div>
        <div>
          <dt>하드웨어</dt>
          <dd>
            {d.hardware_status ? (
              <StatusText tone={HW_TONE[d.hardware_status] ?? 'neutral'}>{HARDWARE_STATUS_LABELS[d.hardware_status] ?? d.hardware_status}</StatusText>
            ) : (
              <span className="muted">--</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Detection ID</dt>
          <dd className="t-mono live__id">
            <span>{d.detection_id ?? `#${d.id}`}</span>
            {d.detection_id && <CopyButton text={d.detection_id} label="ID 복사" />}
          </dd>
        </div>
        <div>
          <dt>카메라 · 모델</dt>
          <dd className="t-mono muted">
            {d.camera_id ?? '--'} · {d.model_name ?? '--'}
            {d.class_id != null ? ` · class ${d.class_id}` : ''}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** 최근 인식 이미지 띠 */
export function DetectionStrip({ items, limit = 6 }: { items: Detection[]; limit?: number }) {
  const withImg = items.filter((d) => d.image_url).slice(1, limit + 1);
  if (!withImg.length) return null;
  return (
    <ol className="strip" aria-label="최근 인식 이미지">
      {withImg.map((d) => (
        <li key={d.id} className="strip__item">
          <DetectionImage d={d} className="strip__img" />
          <span className="strip__cap">
            <DetectionType type={d.waste_type} /> <Confidence value={d.confidence} />
            <time className="t-mono muted">{formatTime(d.detected_at)}</time>
          </span>
        </li>
      ))}
    </ol>
  );
}

const SERVO_LABEL: Record<string, string> = {
  idle: '대기',
  moving: '동작 중',
  unverified: '전송 · 확인 불가',
  error: '응답 없음/오류',
  stopped: '비상 정지',
};

function Flag({ ok, label, detail, off }: { ok: boolean; label: string; detail?: string | null; off?: boolean }) {
  return (
    <li>
      <StatusText tone={off ? 'neutral' : ok ? 'ok' : 'critical'}>{label}</StatusText>
      {detail && <span className="edge__detail t-mono">{detail}</span>}
    </li>
  );
}

/** 카메라 노트북 연결 상태 (heartbeat 기준, 노트북이 실제로 확인한 값) */
export function EdgeStatusPanel({ edges, fullAlert, now }: { edges: EdgeStatus[]; fullAlert?: Telemetry | null; now: number }) {
  return (
    <div className="edge">
      {!edges.length && <EmptyState>카메라 노트북 연결 기록 없음</EmptyState>}
      {edges.map((e) => (
        <div key={e.device_id} className="edge__item">
          <div className="edge__head">
            <strong className="t-mono">{e.device_id}</strong>
            <StatusText tone={e.online ? 'ok' : 'critical'} strong>
              {e.online ? '온라인' : '오프라인'}
            </StatusText>
            <span className="muted">수신 {formatRelative(e.last_seen, now)}</span>
          </div>
          <ul className="edge__flags">
            <Flag ok={e.online && e.camera_ok} label="카메라" detail={e.fps ? `${e.fps.toFixed(1)} fps` : null} />
            <Flag ok={e.online && e.model_loaded} label="YOLO 모델" detail={e.model_name} />
            <Flag
              ok={e.online && e.serial_connected}
              off={!e.serial_enabled}
              label={e.serial_enabled ? 'Arduino UNO' : '하드웨어 비활성'}
              detail={[e.serial_port, e.uno_firmware === 'legacy' ? 'trush.ino · 응답 없음' : e.uno_firmware].filter(Boolean).join(' · ') || null}
            />
            <Flag
              ok={e.online && e.serial_connected && (e.servo_state === 'idle' || e.servo_state === 'moving')}
              off={!e.serial_enabled}
              label="서보 ×3 (X·Y1·Y2)"
              detail={`${SERVO_LABEL[e.servo_state ?? ''] ?? '--'} · 성공 ${e.sorted_ok ?? 0} · 실패 ${e.sorted_failed ?? 0}`}
            />
            <Flag
              ok={e.online && e.sensor_status === 'normal'}
              off={!e.sensor_status || e.sensor_status === 'unknown'}
              label="HC-SR04 ×1"
              detail={
                e.sensor_status === 'normal'
                  ? `${e.distance_cm ?? '--'} cm · 적재율 ${e.fill_percent != null ? `${e.fill_percent}%` : '--'}`
                  : e.sensor_status === 'disconnected'
                    ? 'SENSOR_DISCONNECTED'
                    : e.sensor_status === 'error'
                      ? '측정 오류'
                      : '수신 없음'
              }
            />
            {e.esp32_port && <Flag ok={e.online && e.esp32_connected} label="ESP32 USB" detail={e.esp32_port} />}
            <Flag ok={e.upload_queue === 0} label={`전송 대기 ${e.upload_queue}건`} detail={`성공 ${e.uploads_ok} · 실패 ${e.uploads_failed}`} />
          </ul>
          {e.last_error && <p className="edge__err">{e.last_error}</p>}
        </div>
      ))}
      {fullAlert && (
        <p className="edge__alert">
          <StatusText tone="critical">
            만차 감지 {formatTime(fullAlert.measured_at)} ({formatRelative(fullAlert.measured_at, now)})
          </StatusText>
        </p>
      )}
    </div>
  );
}
