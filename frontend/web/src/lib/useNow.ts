import { useEffect, useState } from 'react';

/** 상대 시간 표시용 현재 시각 (주기적으로 갱신) */
export function useNow(intervalMs = 5000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
