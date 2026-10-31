import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

/** 간단한 비동기 로더. deps 변경 시 다시 불러오며, 늦게 도착한 이전 응답은 버린다. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(() => {
    const my = ++seq.current;
    setLoading(true);
    fnRef
      .current()
      .then((d) => {
        if (my !== seq.current) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (my === seq.current) setError(e);
      })
      .finally(() => {
        if (my === seq.current) setLoading(false);
      });
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(run, deps);
  useEffect(
    () => () => {
      seq.current++;
    },
    [],
  );

  return { data, error, loading, reload: run };
}
