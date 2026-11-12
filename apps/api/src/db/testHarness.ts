import { loadEnvConfig } from '../config.js';
import { runMigrations } from './migrate.js';
import { createDbPool } from './pool.js';

import type pg from 'pg';

export async function resetTestDb(pool: pg.Pool): Promise<void> {
  await pool.query(
    'TRUNCATE TABLE votes, polygon_creations, polygons, sessions, reserved_pseudonyms, users RESTART IDENTITY CASCADE',
  );
}

export async function setupTestDb(databaseUrl?: string): Promise<pg.Pool> {
  const resolvedUrl = databaseUrl ?? loadEnvConfig().databaseUrl;
  const pool = createDbPool(resolvedUrl);
  await runMigrations(pool);
  await resetTestDb(pool);
  return pool;
}
