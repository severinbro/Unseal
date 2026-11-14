import {
  CommentVoteRequestSchema,
  CommentVoteResponseSchema,
  CreatePolygonCommentRequestSchema,
  PolygonCommentListResponseSchema,
  PolygonCommentSchema,
  UuidParamSchema,
} from '@entsiegelung/shared';

import { optionalAuth, requireAuth } from '../auth/session.js';
import { CommentRepository } from '../comments/repository.js';

import type { FastifyInstance } from 'fastify';

export function registerCommentRoutes(
  app: FastifyInstance,
  repository: CommentRepository = new CommentRepository(app.pool),
): void {
  const commentWriteLimit = app.rateLimitOverrides.mutatePolygon ?? {
    max: 30,
    timeWindow: '15 minutes',
  };
  const commentVoteLimit = app.rateLimitOverrides.vote ?? {
    max: 120,
    timeWindow: '1 minute',
  };

  app.get(
    '/api/v1/polygons/:id/comments',
    {
      preHandler: optionalAuth,
    },
    async (request, reply) => {
      reply.header('Vary', 'Authorization');
      reply.header('Cache-Control', 'no-store');
      const { id } = UuidParamSchema.parse(request.params);
      const viewerUserId = request.auth?.user.id ?? null;
      const list = await repository.listByPolygon(id, viewerUserId);
      return PolygonCommentListResponseSchema.parse(list);
    },
  );

  app.post(
    '/api/v1/polygons/:id/comments',
    {
      config: {
        rateLimit: commentWriteLimit,
      },
      preHandler: requireAuth,
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { id } = UuidParamSchema.parse(request.params);
      const body = CreatePolygonCommentRequestSchema.parse(request.body);

      const created = await repository.createComment({
        polygonId: id,
        userId: auth.user.id,
        body: body.body,
        parentId: body.parentId ?? null,
      });

      return reply.status(201).send(PolygonCommentSchema.parse(created));
    },
  );

  app.put(
    '/api/v1/comments/:id/vote',
    {
      config: {
        rateLimit: commentVoteLimit,
      },
      preHandler: requireAuth,
    },
    async (request) => {
      const auth = request.auth!;
      const { id } = UuidParamSchema.parse(request.params);
      CommentVoteRequestSchema.parse(request.body);

      const res = await repository.castUpvote({
        commentId: id,
        userId: auth.user.id,
      });
      return CommentVoteResponseSchema.parse(res);
    },
  );

  app.delete(
    '/api/v1/comments/:id/vote',
    {
      config: {
        rateLimit: commentVoteLimit,
      },
      preHandler: requireAuth,
    },
    async (request) => {
      const auth = request.auth!;
      const { id } = UuidParamSchema.parse(request.params);

      const res = await repository.removeUpvote({
        commentId: id,
        userId: auth.user.id,
      });
      return CommentVoteResponseSchema.parse(res);
    },
  );

  app.delete(
    '/api/v1/comments/:id',
    {
      config: {
        rateLimit: commentWriteLimit,
      },
      preHandler: requireAuth,
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { id } = UuidParamSchema.parse(request.params);

      await repository.deleteComment({
        commentId: id,
        actorUserId: auth.user.id,
        actorIsAdmin: auth.user.role === 'admin',
      });

      return reply.status(204).send();
    },
  );
}
