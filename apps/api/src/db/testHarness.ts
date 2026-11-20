// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 OpenUnseal Contributors

import { loadEnvConfig } from '../config.js';
import { runMigrations } from './migrate.js';
import { createDbPool } from './pool.js';

import type pg from 'pg';

export async function resetTestDb(pool: pg.Pool): Promise<void> {
  await pool.query(
    'TRUNCATE TABLE daily_telemetry_counters, polygon_flags, land_cover_exclusions, polygon_comment_votes, polygon_comments, polygon_photo_votes, polygon_photos, votes, polygon_creations, polygons, import_attributions, email_tokens, sessions, reserved_emails, reserved_pseudonyms, users, municipalities RESTART IDENTITY CASCADE',
  );
}

export async function setupTestDb(databaseUrl?: string): Promise<pg.Pool> {
  const resolvedUrl = databaseUrl ?? loadEnvConfig().databaseUrl;
  const pool = createDbPool(resolvedUrl);
  await runMigrations(pool);
  await resetTestDb(pool);
  return pool;
}
