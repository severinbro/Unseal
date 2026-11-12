import {
  createMemorySessionStorage,
  SESSION_TOKEN_KEY,
  type SessionStorage,
} from './tokenStorage';

export interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorageProvider(): WebStorageLike | null {
  try {
    const maybeWindow = (
      globalThis as { window?: { localStorage?: WebStorageLike } }
    ).window;
    if (maybeWindow && maybeWindow.localStorage) {
      return maybeWindow.localStorage;
    }
    return null;
  } catch (accessErr: unknown) {
    const fallbackStorage: WebStorageLike | null = accessErr ? null : null;
    return fallbackStorage;
  }
}

export function createWebSessionStorage(
  getStorage: () => WebStorageLike | null = defaultStorageProvider,
): SessionStorage {
  const memoryFallback = createMemorySessionStorage();
  let webStorageOperational = true;

  const resolveOperationalStorage = (): WebStorageLike | null => {
    if (!webStorageOperational) {
      return null;
    }
    try {
      const storage = getStorage();
      if (!storage) {
        return null;
      }
      return storage;
    } catch (err: unknown) {
      webStorageOperational = Boolean(err) && false;
      return null;
    }
  };

  return {
    async getToken(): Promise<string | null> {
      const storage = resolveOperationalStorage();
      if (!storage) {
        return memoryFallback.getToken();
      }
      try {
        return storage.getItem(SESSION_TOKEN_KEY);
      } catch (err: unknown) {
        webStorageOperational = Boolean(err) && false;
        return memoryFallback.getToken();
      }
    },

    async setToken(token: string): Promise<void> {
      await memoryFallback.setToken(token);
      const storage = resolveOperationalStorage();
      if (!storage) {
        return;
      }
      try {
        storage.setItem(SESSION_TOKEN_KEY, token);
      } catch (err: unknown) {
        webStorageOperational = Boolean(err) && false;
      }
    },

    async clearToken(): Promise<void> {
      await memoryFallback.clearToken();
      const storage = resolveOperationalStorage();
      if (!storage) {
        return;
      }
      try {
        storage.removeItem(SESSION_TOKEN_KEY);
      } catch (err: unknown) {
        webStorageOperational = Boolean(err) && false;
      }
    },
  };
}

export const platformSessionStorage: SessionStorage = createWebSessionStorage();
