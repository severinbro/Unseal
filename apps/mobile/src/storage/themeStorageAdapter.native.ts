// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Unseal Contributors

import * as SecureStore from 'expo-secure-store';

import type { ThemePreference } from '../theme/tokens';
import {
  parseSavedThemePreference,
  THEME_STORAGE_KEY,
  type ThemeStorage,
} from './themeStorage';

export const platformThemeStorage: ThemeStorage = {
  async getThemePreference(): Promise<ThemePreference | null> {
    try {
      const raw = await SecureStore.getItemAsync(THEME_STORAGE_KEY);
      return parseSavedThemePreference(raw);
    } catch {
      return null;
    }
  },
  async setThemePreference(preference: ThemePreference): Promise<void> {
    try {
      await SecureStore.setItemAsync(THEME_STORAGE_KEY, preference);
    } catch {
      // Ignore secure-store persistence errors so theme switching never fails.
    }
  },
  async clearThemePreference(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(THEME_STORAGE_KEY);
    } catch {
      // Ignore secure-store cleanup errors.
    }
  },
};
