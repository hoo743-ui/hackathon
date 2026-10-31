import { useEffect, useState } from 'react';

/** 상대 시각 표시용 현재 시각 (intervalMs 마다 갱신) */
export function useNow(intervalMs = 5000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
