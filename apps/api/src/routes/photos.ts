import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  ApiError,
  PHOTO_LIMITS,
  PhotoVoteRequestSchema,
  PhotoVoteResponseSchema,
  PolygonPhotoListResponseSchema,
  PolygonPhotoSchema,
  UuidParamSchema,
} from '@entsiegelung/shared';

import { optionalAuth, requireAuth } from '../auth/session.js';
import { processUploadedPhoto } from '../photos/processor.js';
import { PhotoRepository } from '../photos/repository.js';

import type { FastifyInstance } from 'fastify';

const SAFE_WEBP_FILE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:_thumb)?\.webp$/i;

export function registerPhotoRoutes(
  app: FastifyInstance,
  repository: PhotoRepository,
): void {
  const uploadLimit = app.rateLimitOverrides.mutatePolygon ?? {
    max: 30,
    timeWindow: '15 minutes',
  };
  const photoVoteLimit = app.rateLimitOverrides.vote ?? {
    max: 120,
    timeWindow: '1 minute',
  };

  app.get('/uploads/:fileName', async (request, reply) => {
    const rawName =
      typeof request.params === 'object' &&
      request.params !== null &&
      'fileName' in request.params &&
      typeof (request.params as { fileName?: unknown }).fileName === 'string'
        ? (request.params as { fileName: string }).fileName
        : '';

    if (!SAFE_WEBP_FILE_RE.test(rawName)) {
      throw new ApiError(404, 'NOT_FOUND', 'Image file not found.');
    }

    const fullPath = path.resolve(app.config.uploadsDir, rawName);
    const uploadsRoot = path.resolve(app.config.uploadsDir);
    if (!fullPath.startsWith(`${uploadsRoot}${path.sep}`)) {
      throw new ApiError(404, 'NOT_FOUND', 'Image file not found.');
    }

    try {
      const stat = await fs.stat(fullPath);
      if (!stat.isFile()) {
        throw new ApiError(404, 'NOT_FOUND', 'Image file not found.');
      }
    } catch {
      throw new ApiError(404, 'NOT_FOUND', 'Image file not found.');
    }

    reply.header('Content-Type', 'image/webp');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    return reply.send(createReadStream(fullPath));
  });

  app.get(
    '/api/v1/polygons/:id/photos',
    {
      preHandler: optionalAuth,
    },
    async (request, reply) => {
      reply.header('Vary', 'Authorization');
      reply.header('Cache-Control', 'no-store');
      const { id } = UuidParamSchema.parse(request.params);
      const viewerUserId = request.auth?.user.id ?? null;
      const photos = await repository.listByPolygon(id, viewerUserId);
      return PolygonPhotoListResponseSchema.parse({ photos });
    },
  );

  app.post(
    '/api/v1/polygons/:id/photos',
    {
      bodyLimit: PHOTO_LIMITS.MAX_UPLOAD_BYTES + 512 * 1024,
      config: {
        rateLimit: uploadLimit,
      },
      preHandler: requireAuth,
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { id } = UuidParamSchema.parse(request.params);

      if (!request.isMultipart()) {
        throw new ApiError(
          415,
          'UNSUPPORTED_MEDIA_TYPE',
          'Multipart form-data upload is required for polygon photos.',
        );
      }

      const uploaded = await request.file({
        limits: {
          fileSize: PHOTO_LIMITS.MAX_UPLOAD_BYTES,
          files: 1,
        },
      });
      if (!uploaded) {
        throw new ApiError(
          422,
          'VALIDATION_ERROR',
          'No photo file provided in multipart field.',
        );
      }

      const buffer = await uploaded.toBuffer();
      if (uploaded.file.truncated) {
        throw new ApiError(
          413,
          'PAYLOAD_TOO_LARGE',
          `Photo exceeds maximum size of ${Math.round(PHOTO_LIMITS.MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`,
        );
      }

      const processed = await processUploadedPhoto(buffer);
      const created = await repository.createPhoto({
        polygonId: id,
        userId: auth.user.id,
        processed,
      });

      return reply.status(201).send(PolygonPhotoSchema.parse(created));
    },
  );

  app.put(
    '/api/v1/photos/:id/vote',
    {
      config: {
        rateLimit: photoVoteLimit,
      },
      preHandler: requireAuth,
    },
    async (request) => {
      const auth = request.auth!;
      const { id } = UuidParamSchema.parse(request.params);
      const body = PhotoVoteRequestSchema.parse(request.body);

      const res = await repository.castVote({
        photoId: id,
        userId: auth.user.id,
        value: body.value,
      });
      return PhotoVoteResponseSchema.parse(res);
    },
  );

  app.delete(
    '/api/v1/photos/:id/vote',
    {
      config: {
        rateLimit: photoVoteLimit,
      },
      preHandler: requireAuth,
    },
    async (request) => {
      const auth = request.auth!;
      const { id } = UuidParamSchema.parse(request.params);

      const res = await repository.removeVote({
        photoId: id,
        userId: auth.user.id,
      });
      return PhotoVoteResponseSchema.parse(res);
    },
  );

  app.delete(
    '/api/v1/photos/:id',
    {
      config: {
        rateLimit: uploadLimit,
      },
      preHandler: requireAuth,
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { id } = UuidParamSchema.parse(request.params);

      await repository.deletePhoto({
        photoId: id,
        actorUserId: auth.user.id,
        actorIsAdmin: auth.user.role === 'admin',
      });
      return reply.status(204).send();
    },
  );
}
