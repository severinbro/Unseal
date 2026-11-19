// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Unseal Contributors

import type { ThemePreference } from '../theme/tokens';
import { type WebStorageLike } from './secureStorage.web';
import {
  createMemoryThemeStorage,
  parseSavedThemePreference,
  THEME_STORAGE_KEY,
  type ThemeStorage,
} from './themeStorage';

function defaultWebStorageProvider(): WebStorageLike | null {
  try {
    const maybeWindow = (
      globalThis as { window?: { localStorage?: WebStorageLike } }
    ).window;
    return maybeWindow?.localStorage ?? null;
  } catch {
    return null;
  }
}

export function createWebThemeStorage(
  getStorage: () => WebStorageLike | null = defaultWebStorageProvider,
): ThemeStorage {
  const memoryFallback = createMemoryThemeStorage();
  let operational = true;

  const resolveStorage = (): WebStorageLike | null => {
    if (!operational) {
      return null;
    }
    try {
      return getStorage();
    } catch {
      operational = false;
      return null;
    }
  };

  return {
    async getThemePreference(): Promise<ThemePreference | null> {
      const storage = resolveStorage();
      if (!storage) {
        return memoryFallback.getThemePreference();
      }
      try {
        const raw = storage.getItem(THEME_STORAGE_KEY);
        return (
          parseSavedThemePreference(raw) ??
          (await memoryFallback.getThemePreference())
        );
      } catch {
        operational = false;
        return memoryFallback.getThemePreference();
      }
    },
    async setThemePreference(preference: ThemePreference): Promise<void> {
      await memoryFallback.setThemePreference(preference);
      const storage = resolveStorage();
      if (!storage) {
        return;
      }
      try {
        storage.setItem(THEME_STORAGE_KEY, preference);
      } catch {
        operational = false;
      }
    },
    async clearThemePreference(): Promise<void> {
      await memoryFallback.clearThemePreference();
      const storage = resolveStorage();
      if (!storage) {
        return;
      }
      try {
        storage.removeItem(THEME_STORAGE_KEY);
      } catch {
        operational = false;
      }
    },
  };
}

export const platformThemeStorage: ThemeStorage = createWebThemeStorage();
