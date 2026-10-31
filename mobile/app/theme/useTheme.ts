import { useThemeContext, type Theme } from './ThemeContext';

export function useTheme(): Theme {
  return useThemeContext().theme;
}

export type { Theme };
