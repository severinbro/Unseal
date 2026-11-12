import {
  ApiError,
  HealthResponseSchema,
  RuntimeConfigSchema,
} from '@entsiegelung/shared';

import { getMigrationFiles } from '../db/migrate.js';

import type { FastifyInstance } from 'fastify';

export interface SystemRoutesOptions {
  migrationsDir?: string;
}

interface HealthQueryRow {
  postgis_version: string;
  migrations_applied: number;
}

export function registerSystemRoutes(
  app: FastifyInstance,
  options: SystemRoutesOptions = {},
): void {
  app.get('/api/v1/health', async () => {
    let migrationFileCount: number;
    try {
      const files = await getMigrationFiles(options.migrationsDir);
      migrationFileCount = files.length;
    } catch {
      throw new ApiError(
        503,
        'SERVICE_UNAVAILABLE',
        'Unable to inspect SQL migration files.',
      );
    }

    let row: HealthQueryRow | undefined;
    try {
      const result = await app.pool.query<HealthQueryRow>(`
        SELECT
          PostGIS_Version() AS postgis_version,
          (SELECT COUNT(*)::int FROM schema_migrations) AS migrations_applied
      `);
      row = result.rows[0];
    } catch {
      throw new ApiError(
        503,
        'SERVICE_UNAVAILABLE',
        'Database health check failed.',
      );
    }

    if (
      !row ||
      migrationFileCount < 1 ||
      row.migrations_applied !== migrationFileCount
    ) {
      throw new ApiError(
        503,
        'SERVICE_UNAVAILABLE',
        'Database schema migrations are incomplete.',
      );
    }

    return HealthResponseSchema.parse({
      status: 'ok',
      postgisVersion: row.postgis_version,
      migrationsApplied: row.migrations_applied,
    });
  });

  app.get('/api/v1/config', async () => {
    return RuntimeConfigSchema.parse(app.config.runtimeConfig);
  });
}
