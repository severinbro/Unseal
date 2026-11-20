// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import type { BrandingConfig, SurfaceType } from '@openunseal/shared';
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
  themePreference: 'light',
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
  readonly branding?: BrandingConfig | null | undefined;
  readonly children: React.ReactNode;
}

export function ThemeProvider({
  colorScheme,
  themePreference = 'light',
  branding = null,
  children,
}: ThemeProviderProps): React.JSX.Element {
  const accentColor = branding?.accentColor ?? null;
  const accentDarkColor = branding?.accentDarkColor ?? null;
  const value = useMemo<ThemeContextValue>(
    () => ({
      colorScheme,
      themePreference,
      palette: getPalette(colorScheme, { accentColor, accentDarkColor }),
      surfaceSwatches: getSurfaceSwatches(colorScheme),
      isDark: colorScheme === 'dark',
    }),
    [colorScheme, themePreference, accentColor, accentDarkColor],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
