// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 OpenUnseal Contributors

import {
  ApiError,
  UuidParamSchema,
  VoteRequestSchema,
  VoteResponseSchema,
} from '@openunseal/shared';

import { requireAuth } from '../auth/session.js';
import { VoteRepository } from '../votes/repository.js';

import type { FastifyInstance } from 'fastify';

export function registerVoteRoutes(
  app: FastifyInstance,
  repository: VoteRepository = new VoteRepository(app.pool, {
    minAccountDays: app.config.newUserMinAccountDays,
    minCleanPolygons: app.config.newUserMinCleanPolygons,
  }),
): void {
  if (!app.hasRequestDecorator('auth')) {
    app.decorateRequest('auth', null);
  }

  const voteLimit = app.rateLimitOverrides.vote ?? {
    max: 60,
    timeWindow: '1 minute',
  };

  app.put(
    '/api/v1/polygons/:id/vote',
    {
      config: {
        rateLimit: voteLimit,
      },
      preHandler: requireAuth,
    },
    async (request) => {
      const auth = request.auth;
      if (!auth) {
        throw new ApiError(
          401,
          'AUTH_REQUIRED',
          'Valid bearer session token is required.',
        );
      }

      const { id } = UuidParamSchema.parse(request.params);
      const body = VoteRequestSchema.parse(request.body);
      const result = await repository.putVote({
        polygonId: id,
        userId: auth.user.id,
        value: body.value,
      });

      return VoteResponseSchema.parse(result);
    },
  );

  app.delete(
    '/api/v1/polygons/:id/vote',
    {
      config: {
        rateLimit: voteLimit,
      },
      preHandler: requireAuth,
    },
    async (request) => {
      const auth = request.auth;
      if (!auth) {
        throw new ApiError(
          401,
          'AUTH_REQUIRED',
          'Valid bearer session token is required.',
        );
      }

      const { id } = UuidParamSchema.parse(request.params);
      const result = await repository.deleteVote(id, auth.user.id);

      return VoteResponseSchema.parse(result);
    },
  );
}
