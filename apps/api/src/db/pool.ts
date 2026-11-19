// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Unseal Contributors

import pg from 'pg';

import type { EnvConfig } from '../config.js';

const { Pool } = pg;

export function createDbPool(
  databaseUrlOrConfig: string | Pick<EnvConfig, 'databaseUrl'>,
  poolOptions: pg.PoolConfig = {},
): pg.Pool {
  const connectionString =
    typeof databaseUrlOrConfig === 'string'
      ? databaseUrlOrConfig
      : databaseUrlOrConfig.databaseUrl;

  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...poolOptions,
  });
}
