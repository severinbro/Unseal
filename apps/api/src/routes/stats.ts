// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Unseal Contributors

import {
  PersonalStatsResponseSchema,
  PublicStatsResponseSchema,
} from '@entsiegelung/shared';

import { requireAuth } from '../auth/session.js';
import { PolygonRepository } from '../polygons/repository.js';

import type { FastifyInstance } from 'fastify';

export function registerStatsRoutes(
  app: FastifyInstance,
  repository: PolygonRepository = new PolygonRepository(
    app.pool,
    app.config.uploadsDir,
    {
      minAccountDays: app.config.newUserMinAccountDays,
      minCleanPolygons: app.config.newUserMinCleanPolygons,
    },
  ),
): void {
  if (!app.hasRequestDecorator('auth')) {
    app.decorateRequest('auth', null);
  }

  app.get(
    '/api/v1/stats',
    {
      config: {
        rateLimit: {
          max: 120,
          timeWindow: '1 minute',
        },
      },
    },
    async (_request, reply) => {
      reply.header('Cache-Control', 'public, max-age=15');
      const stats = await repository.getPublicStats();
      return PublicStatsResponseSchema.parse(stats);
    },
  );

  app.get(
    '/api/v1/stats/me',
    {
      preHandler: requireAuth,
      config: {
        rateLimit: {
          max: 120,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      reply.header('Vary', 'Authorization');
      reply.header('Cache-Control', 'no-store');
      const stats = await repository.getPersonalStats(request.auth!.user.id);
      return PersonalStatsResponseSchema.parse(stats);
    },
  );
}
