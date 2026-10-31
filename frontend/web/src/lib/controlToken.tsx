import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { getControlToken, setControlToken } from './storage';

interface TokenValue {
  token: string;
  setToken: (t: string) => void;
}

const Ctx = createContext<TokenValue | null>(null);

/** 제어/보정 API Bearer 토큰. 설정 페이지에서 입력하고 제어 센터·보정 폼이 공유한다 (브라우저에만 저장). */
export function ControlTokenProvider({ children, initial }: { children: ReactNode; initial?: string }) {
  const [token, setState] = useState(() => initial ?? getControlToken());
  const setToken = useCallback((t: string) => {
    setControlToken(t);
    setState(t);
  }, []);
  const value = useMemo(() => ({ token, setToken }), [token, setToken]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useControlToken(): TokenValue {
  const v = useContext(Ctx);
  // Provider 밖(단독 렌더 테스트 등)에서는 저장소 값만 읽는다
  return v ?? { token: getControlToken(), setToken: setControlToken };
}
