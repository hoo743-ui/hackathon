/** 보정 입력 검증 (서버 CalibrationIn 과 같은 규칙: 0 < 값 ≤ 400, 가득 < 빈 통). 오류 문구 또는 null. */
export function validateCalibration(emptyText: string, fullText: string): { error: string | null; empty: number; full: number } {
  const empty = Number(emptyText.replace(',', '.'));
  const full = Number(fullText.replace(',', '.'));
  if (!emptyText.trim() || !fullText.trim() || Number.isNaN(empty) || Number.isNaN(full)) {
    return { error: '두 값을 숫자(cm)로 입력하세요.', empty, full };
  }
  if (empty <= 0 || full <= 0 || empty > 400 || full > 400) return { error: '거리는 0보다 크고 400 cm 이하여야 합니다.', empty, full };
  if (full >= empty) return { error: '가득 기준 거리는 빈 통 기준보다 짧아야 합니다 (센서가 위에서 측정).', empty, full };
  return { error: null, empty, full };
}
