// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import { type WebStorageLike } from './secureStorage.web';
import {
  createMemoryViewportStorage,
  LAST_VIEWPORT_KEY,
  parseSavedViewport,
  serializeSavedViewport,
  type SavedViewport,
  type ViewportStorage,
} from './viewportStorage';

function defaultWebStorageProvider(): WebStorageLike | null {
  try {
    const maybeWindow = (
      globalThis as { window?: { sessionStorage?: WebStorageLike } }
    ).window;
    return maybeWindow?.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function clearLegacyLocalStorageViewport(): void {
  try {
    const maybeWindow = (
      globalThis as { window?: { localStorage?: WebStorageLike } }
    ).window;
    maybeWindow?.localStorage?.removeItem(LAST_VIEWPORT_KEY);
  } catch {
    // Ignore restricted storage access
  }
}

export function createWebViewportStorage(
  getStorage: () => WebStorageLike | null = defaultWebStorageProvider,
): ViewportStorage {
  const memoryFallback = createMemoryViewportStorage();
  let operational = true;
  let legacyCleared = false;

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
    async getViewport(): Promise<SavedViewport | null> {
      if (!legacyCleared && getStorage === defaultWebStorageProvider) {
        legacyCleared = true;
        clearLegacyLocalStorageViewport();
      }
      const storage = resolveStorage();
      if (!storage) {
        return memoryFallback.getViewport();
      }
      try {
        const raw = storage.getItem(LAST_VIEWPORT_KEY);
        return parseSavedViewport(raw) ?? (await memoryFallback.getViewport());
      } catch {
        operational = false;
        return memoryFallback.getViewport();
      }
    },
    async setViewport(viewport: SavedViewport): Promise<void> {
      const serialized = serializeSavedViewport(viewport);
      if (serialized === null) {
        return;
      }
      await memoryFallback.setViewport(viewport);
      const storage = resolveStorage();
      if (!storage) {
        return;
      }
      try {
        storage.setItem(LAST_VIEWPORT_KEY, serialized);
      } catch {
        operational = false;
      }
    },
    async clearViewport(): Promise<void> {
      if (getStorage === defaultWebStorageProvider) {
        clearLegacyLocalStorageViewport();
      }
      await memoryFallback.clearViewport();
      const storage = resolveStorage();
      if (!storage) {
        return;
      }
      try {
        storage.removeItem(LAST_VIEWPORT_KEY);
      } catch {
        operational = false;
      }
    },
  };
}

export const platformViewportStorage: ViewportStorage =
  createWebViewportStorage();
