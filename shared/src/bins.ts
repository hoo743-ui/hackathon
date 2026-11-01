import type { Bin } from './types';

/**
 * 칸 적재율을 '지금 믿을 수 있는 값'으로만 보여 주기 위한 판정 (웹·앱 공용).
 * - live        : 센서 정상 → 현재 적재율 표시
 * - no_sensor   : 측정값을 한 번도 받은 적 없음 (센서 미설치 칸) → '수신 없음'
 * - disconnected: SENSOR_DISCONNECTED → 마지막 값을 현재값처럼 보이지 않게 숨기고 참고로만
 * - error       : 범위 밖·응답 없음·오류
 * - uncalibrated: 센서 정상이지만 빈 통 거리 미설정 → 거리만 있고 적재율 없음
 * 적재율 숫자는 서버가 계산한 current_fill_percent 만 사용한다 (프론트에서 계산·추정하지 않음).
 */
export type BinReadingState = 'live' | 'no_sensor' | 'disconnected' | 'error' | 'uncalibrated';

export interface BinReading {
  state: BinReadingState;
  /** 화면에 '현재값'으로 표시할 적재율. live 일 때만 숫자 */
  percent: number | null;
  /** 끊김/오류 시 참고용 마지막 정상값 (현재값 아님) */
  lastPercent: number | null;
  label: string;
}

export const BIN_READING_LABELS: Record<BinReadingState, string> = {
  live: '측정 중',
  no_sensor: '수신 없음',
  disconnected: '센서 연결 끊김',
  error: '측정 오류',
  uncalibrated: '빈 통 거리 미설정',
};

export function binReading(b: Bin): BinReading {
  if (b.sensor_status === null) return { state: 'no_sensor', percent: null, lastPercent: null, label: BIN_READING_LABELS.no_sensor };
  if (b.sensor_status === 'disconnected')
    return { state: 'disconnected', percent: null, lastPercent: b.current_fill_percent, label: BIN_READING_LABELS.disconnected };
  if (b.sensor_status !== 'normal')
    return { state: 'error', percent: null, lastPercent: b.current_fill_percent, label: BIN_READING_LABELS.error };
  if (b.current_fill_percent === null) return { state: 'uncalibrated', percent: null, lastPercent: null, label: BIN_READING_LABELS.uncalibrated };
  return { state: 'live', percent: b.current_fill_percent, lastPercent: b.current_fill_percent, label: BIN_READING_LABELS.live };
}
