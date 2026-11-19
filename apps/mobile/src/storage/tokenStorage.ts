// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Unseal Contributors

/**
 * Platform-neutral opaque session bearer token contract.
 *
 * Concrete runtime adapters:
 * - `./secureStorage.native` (`expo-secure-store` Keychain / Keystore)
 * - `./secureStorage.web` (`window.localStorage` with `createMemorySessionStorage` fallback)
 */
export const SESSION_TOKEN_KEY = 'entsiegelung.session_token';

export interface SessionStorage {
  getToken(): Promise<string | null>;
  setToken(token: string): Promise<void>;
  clearToken(): Promise<void>;
}

export function createMemorySessionStorage(
  initialToken: string | null = null,
): SessionStorage {
  let storedToken: string | null = initialToken;

  return {
    async getToken(): Promise<string | null> {
      return storedToken;
    },
    async setToken(token: string): Promise<void> {
      storedToken = token;
    },
    async clearToken(): Promise<void> {
      storedToken = null;
    },
  };
}
