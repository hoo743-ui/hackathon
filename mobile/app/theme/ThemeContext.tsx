import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, useColorScheme } from 'react-native';
import { loadPref, savePref } from '../services/prefsStore';
import { colors, layout, makeTypography, motion, radius, ruleWidth, space, type Scheme } from './tokens';

export type ThemePreference = 'system' | 'light' | 'dark';
const PREF_KEY = 'theme_preference';

export function resolveScheme(pref: ThemePreference, system: string | null | undefined): Scheme {
  if (pref === 'light' || pref === 'dark') return pref;
  return system === 'dark' ? 'dark' : 'light';
}

function buildTheme(scheme: Scheme, fontsLoaded: boolean, reduceMotion: boolean) {
  return { scheme, c: colors[scheme], t: makeTypography(fontsLoaded), space, radius, layout, ruleWidth, motion, reduceMotion } as const;
}

export type Theme = ReturnType<typeof buildTheme>;

interface ThemeCtx {
  theme: Theme;
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

export function AppThemeProvider({ fontsLoaded, children }: { fontsLoaded: boolean; children: React.ReactNode }) {
  const system = useColorScheme();
  // 기본 = 라이트 (웹과 같은 브랜드 화면). 사용자가 설정에서 바꾸면 그 값을 유지
  const [preference, setPref] = useState<ThemePreference>('light');
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    loadPref(PREF_KEY).then((v) => {
      if (v === 'light' || v === 'dark' || v === 'system') setPref(v);
    });
  }, []);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => alive && setReduceMotion(v))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  const setPreference = useCallback((p: ThemePreference) => {
    setPref(p);
    void savePref(PREF_KEY, p);
  }, []);

  const scheme = resolveScheme(preference, system);
  const theme = useMemo(() => buildTheme(scheme, fontsLoaded, reduceMotion), [scheme, fontsLoaded, reduceMotion]);
  const value = useMemo(() => ({ theme, preference, setPreference }), [theme, preference, setPreference]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useThemeContext(): ThemeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useThemeContext must be used inside AppThemeProvider');
  return v;
}
