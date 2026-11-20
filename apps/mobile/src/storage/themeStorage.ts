// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import {
  isThemePreference,
  type ColorScheme,
  type ThemePreference,
} from '../theme/tokens';

export const THEME_STORAGE_KEY = 'entsiegelung.theme';

export interface ThemeStorage {
  getThemePreference(): Promise<ThemePreference | null>;
  setThemePreference(preference: ThemePreference): Promise<void>;
  clearThemePreference(): Promise<void>;
}

export function parseSavedThemePreference(
  raw: string | null | undefined,
): ThemePreference | null {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  return isThemePreference(trimmed) ? trimmed : null;
}

export function createMemoryThemeStorage(
  initialPreference: ThemePreference | null = null,
): ThemeStorage {
  let current: ThemePreference | null = initialPreference;
  return {
    async getThemePreference(): Promise<ThemePreference | null> {
      return current;
    },
    async setThemePreference(preference: ThemePreference): Promise<void> {
      if (isThemePreference(preference)) {
        current = preference;
      }
    },
    async clearThemePreference(): Promise<void> {
      current = null;
    },
  };
}

interface WebStorageReaderLike {
  getItem(key: string): string | null;
}

export function readPersistedThemePreferenceSync(): ThemePreference | null {
  try {
    const scope = globalThis as {
      window?: { localStorage?: WebStorageReaderLike };
      localStorage?: WebStorageReaderLike;
    };
    const storage = scope.window?.localStorage ?? scope.localStorage ?? null;
    return parseSavedThemePreference(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function detectWebSystemColorScheme(): ColorScheme | null {
  try {
    const scope = globalThis as {
      window?: {
        matchMedia?: (query: string) => { matches?: boolean } | null;
      };
    };
    if (typeof scope.window?.matchMedia !== 'function') {
      return null;
    }
    const mql = scope.window.matchMedia('(prefers-color-scheme: dark)');
    if (!mql || typeof mql.matches !== 'boolean') {
      return null;
    }
    return mql.matches ? 'dark' : 'light';
  } catch {
    return null;
  }
}
