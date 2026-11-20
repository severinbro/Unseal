// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import * as SecureStore from 'expo-secure-store';

import { SESSION_TOKEN_KEY, type SessionStorage } from './tokenStorage';

export const platformSessionStorage: SessionStorage = {
  async getToken(): Promise<string | null> {
    return SecureStore.getItemAsync(SESSION_TOKEN_KEY);
  },
  async setToken(token: string): Promise<void> {
    await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token);
  },
  async clearToken(): Promise<void> {
    await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
  },
};
