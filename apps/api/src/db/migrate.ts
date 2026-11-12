import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnvConfig } from '../config.js';
import { createLogger } from '../logger.js';
import { createDbPool } from './pool.js';

import type pg from 'pg';

export const MIGRATION_ADVISORY_LOCK_ID = 7744715;

export interface MigrationResult {
  applied: string[];
  totalApplied: number;
  migrationFileCount: number;
}

export function resolveDefaultMigrationsDir(): string {
  return fileURLToPath(new URL('../../migrations', import.meta.url));
}

export async function getMigrationFiles(
  migrationsDir: string = resolveDefaultMigrationsDir(),
): Promise<string[]> {
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

export async function runMigrations(
  pool: pg.Pool,
  migrationsDir: string = resolveDefaultMigrationsDir(),
): Promise<MigrationResult> {
  const sqlFiles = await getMigrationFiles(migrationsDir);
  const client = await pool.connect();
  let destroyConnection = false;

  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_ID]);

    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          filename TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      const existingRes = await client.query<{ filename: string }>(
        'SELECT filename FROM schema_migrations ORDER BY filename ASC',
      );
      const appliedSet = new Set(existingRes.rows.map((row) => row.filename));
      const newlyApplied: string[] = [];

      for (const filename of sqlFiles) {
        if (appliedSet.has(filename)) {
          continue;
        }

        const sqlPath = path.join(migrationsDir, filename);
        const sqlContent = await fs.readFile(sqlPath, 'utf8');

        await client.query('BEGIN');
        try {
          await client.query(sqlContent);
          await client.query(
            'INSERT INTO schema_migrations (filename) VALUES ($1)',
            [filename],
          );
          await client.query('COMMIT');
          newlyApplied.push(filename);
        } catch (migrationErr) {
          await client.query('ROLLBACK');
          throw migrationErr;
        }
      }

      return {
        applied: newlyApplied,
        totalApplied: appliedSet.size + newlyApplied.length,
        migrationFileCount: sqlFiles.length,
      };
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [
          MIGRATION_ADVISORY_LOCK_ID,
        ]);
      } catch {
        destroyConnection = true;
      }
    }
  } finally {
    client.release(destroyConnection);
  }
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  const config = loadEnvConfig();
  const logger = createLogger();
  const pool = createDbPool(config.databaseUrl);

  runMigrations(pool)
    .then(async (result) => {
      logger.info(
        {
          applied: result.applied,
          totalApplied: result.totalApplied,
          migrationFileCount: result.migrationFileCount,
        },
        'SQL migrations completed',
      );
      await pool.end();
    })
    .catch(async (err: unknown) => {
      logger.error({ err }, 'SQL migration execution failed');
      await pool.end();
      process.exit(1);
    });
}
