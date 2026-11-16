import type { SurfaceType } from '@entsiegelung/shared';
import React, { createContext, useContext, useMemo } from 'react';

import {
  getPalette,
  getSurfaceSwatches,
  LIGHT_PALETTE,
  SURFACE_SWATCHES,
  type ColorScheme,
  type ThemePalette,
  type ThemePreference,
} from './tokens';

export interface ThemeContextValue {
  readonly colorScheme: ColorScheme;
  readonly themePreference: ThemePreference;
  readonly palette: ThemePalette;
  readonly surfaceSwatches: Record<
    SurfaceType,
    { readonly color: string; readonly code: string }
  >;
  readonly isDark: boolean;
}

const DEFAULT_THEME_CONTEXT: ThemeContextValue = {
  colorScheme: 'light',
  themePreference: 'system',
  palette: LIGHT_PALETTE,
  surfaceSwatches: SURFACE_SWATCHES,
  isDark: false,
};

export const ThemeContext = createContext<ThemeContextValue>(
  DEFAULT_THEME_CONTEXT,
);

export interface ThemeProviderProps {
  readonly colorScheme: ColorScheme;
  readonly themePreference?: ThemePreference | undefined;
  readonly children: React.ReactNode;
}

export function ThemeProvider({
  colorScheme,
  themePreference = 'system',
  children,
}: ThemeProviderProps): React.JSX.Element {
  const value = useMemo<ThemeContextValue>(
    () => ({
      colorScheme,
      themePreference,
      palette: getPalette(colorScheme),
      surfaceSwatches: getSurfaceSwatches(colorScheme),
      isDark: colorScheme === 'dark',
    }),
    [colorScheme, themePreference],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
