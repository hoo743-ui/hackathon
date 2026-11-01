// localStorage 는 사파리 프라이빗 모드 등에서 예외를 던질 수 있으므로 항상 try/catch 로 감싼다.
const TOKEN_KEY = 'smartbin.controlToken';
const MODE_KEY = 'smartbin.dataMode';
const THEME_KEY = 'smartbin.theme';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null || value === '') window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // 저장 불가 환경: 무시 (메모리 상 값만 사용)
  }
}

export const getControlToken = (): string => read(TOKEN_KEY) ?? '';
export const setControlToken = (token: string): void => write(TOKEN_KEY, token.trim() || null);

export function getDataModeOverride(): 'live' | 'mock' | null {
  const v = read(MODE_KEY);
  return v === 'live' || v === 'mock' ? v : null;
}
export const setDataModeOverride = (mode: 'live' | 'mock' | null): void => write(MODE_KEY, mode);

export type ThemePref = 'light' | 'dark' | 'system';
export function getThemePref(): ThemePref {
  const v = read(THEME_KEY);
  // 기본 = 라이트 (발표·현장 화면을 브랜드 색으로 통일). 사용자가 고르면 그 값을 유지
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'light';
}
export const setThemePref = (pref: ThemePref): void => write(THEME_KEY, pref);
