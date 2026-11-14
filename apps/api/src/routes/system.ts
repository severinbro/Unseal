import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

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

  app.get(
    '/downloads/unseal.apk',
    {
      config: {
        compress: false,
        rateLimit: {
          max: 30,
          timeWindow: '15 minutes',
        },
      },
    },
    async (_request, reply) => {
      const defaultDevApkPath = path.join(
        path.resolve(process.cwd(), 'uploads'),
        'unseal.apk',
      );
      const isDefaultDevPath = app.config.apkFilePath === defaultDevApkPath;
      const candidatePaths = isDefaultDevPath
        ? [
            app.config.apkFilePath,
            path.resolve(process.cwd(), 'downloads', 'unseal.apk'),
            path.resolve(
              process.cwd(),
              'apps/mobile/android/app/build/outputs/apk/release/app-release.apk',
            ),
            path.resolve(
              process.cwd(),
              '../mobile/android/app/build/outputs/apk/release/app-release.apk',
            ),
          ]
        : [app.config.apkFilePath];

      for (const filePath of candidatePaths) {
        try {
          const stat = await fs.stat(filePath);
          if (stat.isFile() && stat.size > 0) {
            return reply
              .status(200)
              .header('Content-Type', 'application/vnd.android.package-archive')
              .header(
                'Content-Disposition',
                'attachment; filename="unseal.apk"',
              )
              .header('Content-Length', String(stat.size))
              .header('Cache-Control', 'public, max-age=300')
              .header('X-Content-Type-Options', 'nosniff')
              .send(createReadStream(filePath));
          }
        } catch {
          // Try next candidate path
        }
      }

      throw new ApiError(
        404,
        'NOT_FOUND',
        'Android APK package has not been uploaded to this server yet.',
      );
    },
  );
}
