import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { getThemePref, setThemePref } from './storage';
import type { ThemePref } from './storage';

export type { ThemePref };

export const THEME_LABELS: Record<ThemePref, string> = { light: '라이트', dark: '다크', system: '시스템' };

/** html[data-theme] 반영. system 이면 속성을 지워 CSS 의 prefers-color-scheme 을 따른다. */
export function applyTheme(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}

interface ThemeValue {
  pref: ThemePref;
  setPref: (p: ThemePref) => void;
}

const Ctx = createContext<ThemeValue>({ pref: 'system', setPref: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setState] = useState<ThemePref>(getThemePref);
  useEffect(() => applyTheme(pref), [pref]);
  const setPref = useCallback((p: ThemePref) => {
    setThemePref(p);
    setState(p);
  }, []);
  const value = useMemo(() => ({ pref, setPref }), [pref, setPref]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTheme = (): ThemeValue => useContext(Ctx);
