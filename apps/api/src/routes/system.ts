// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Unseal Contributors

import { createReadStream } from 'node:fs';

import {
  ApiError,
  HealthResponseSchema,
  RuntimeConfigSchema,
} from '@entsiegelung/shared';

import {
  findExistingApkInfo,
  resolveRuntimeApkAvailability,
} from '../config.js';
import { getMigrationFiles } from '../db/migrate.js';
import { getMunicipalitiesStatus } from '../municipalities/vg250.js';

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
    const apkAvailability = resolveRuntimeApkAvailability(app.config);
    const muniStatus = await getMunicipalitiesStatus(app.pool).catch(() => ({
      seeded: false,
      dataYear: null,
    }));
    const vg250AttributionEnabled =
      app.config.autoSeedVg250 || muniStatus.seeded;
    const vg250DataYear = vg250AttributionEnabled
      ? (muniStatus.dataYear ?? new Date().getUTCFullYear())
      : null;
    return RuntimeConfigSchema.parse({
      ...app.config.runtimeConfig,
      vg250AttributionEnabled,
      vg250DataYear,
      apkDownloadUrl: apkAvailability.apkDownloadUrl,
      apkSha256: apkAvailability.apkSha256,
    });
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
      if (app.config.apkMode !== 'disabled') {
        const existing = findExistingApkInfo(app.config.apkFilePath);
        if (existing) {
          return reply
            .status(200)
            .header('Content-Type', 'application/vnd.android.package-archive')
            .header(
              'Content-Disposition',
              'attachment; filename="unseal.apk"',
            )
            .header('Content-Length', String(existing.size))
            .header('ETag', `"sha256-${existing.sha256}"`)
            .header('Cache-Control', 'public, max-age=300')
            .header('X-Content-Type-Options', 'nosniff')
            .send(createReadStream(existing.filePath));
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
