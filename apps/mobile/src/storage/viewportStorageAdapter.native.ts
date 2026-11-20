// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import * as SecureStore from 'expo-secure-store';

import {
  LAST_VIEWPORT_KEY,
  parseSavedViewport,
  serializeSavedViewport,
  type SavedViewport,
  type ViewportStorage,
} from './viewportStorage';

export const platformViewportStorage: ViewportStorage = {
  async getViewport(): Promise<SavedViewport | null> {
    try {
      const raw = await SecureStore.getItemAsync(LAST_VIEWPORT_KEY);
      return parseSavedViewport(raw);
    } catch {
      return null;
    }
  },
  async setViewport(viewport: SavedViewport): Promise<void> {
    const serialized = serializeSavedViewport(viewport);
    if (serialized === null) {
      return;
    }
    try {
      await SecureStore.setItemAsync(LAST_VIEWPORT_KEY, serialized);
    } catch {
      // Ignore secure-store persistence errors so map interaction never fails.
    }
  },
  async clearViewport(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(LAST_VIEWPORT_KEY);
    } catch {
      // Ignore secure-store cleanup errors.
    }
  },
};
