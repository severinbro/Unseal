import crypto from 'node:crypto';
import fastifyCompress from '@fastify/compress';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

import { ApiError, type ErrorCode } from '@entsiegelung/shared';

import { type EnvConfig } from './config.js';
import { resetTestDb, setupTestDb } from './db/testHarness.js';
import { createLogger } from './logger.js';
import { registerSystemRoutes } from './routes/system.js';
import { normalizeRateLimitIp } from './util/rateLimit.js';
import { BoundedSemaphore } from './util/semaphore.js';

import type pg from 'pg';

export interface RateLimitWindowOverride {
  max: number;
  timeWindow: string | number;
}

export interface RateLimitOverrides {
  register?: RateLimitWindowOverride;
  loginIp?: RateLimitWindowOverride;
  loginAccount?: { max: number; timeWindowMs: number };
  recover?: RateLimitWindowOverride;
  deleteAccount?: RateLimitWindowOverride;
  createPolygon?: RateLimitWindowOverride;
  mutatePolygon?: RateLimitWindowOverride;
  vote?: RateLimitWindowOverride;
  exportGeoJson?: RateLimitWindowOverride;
}

export interface BuildAppOptions {
  logger?: FastifyBaseLogger;
  migrationsDir?: string;
  argon2Semaphore?: BoundedSemaphore;
  exportSemaphore?: BoundedSemaphore;
  rateLimits?: RateLimitOverrides;
}

declare module 'fastify' {
  interface FastifyInstance {
    config: EnvConfig;
    pool: pg.Pool;
    authSemaphore: BoundedSemaphore;
    exportSemaphore: BoundedSemaphore;
    rateLimitOverrides: RateLimitOverrides;
  }
}

const SAFE_REQUEST_ID_RE = /^[a-zA-Z0-9._-]{1,64}$/;
const MAX_REQUEST_BODY_BYTES = 65536;

function resolveCorsOrigin(corsOrigin: string): string | string[] {
  const trimmed = corsOrigin.trim();
  if (trimmed === '' || trimmed === '*') {
    return '*';
  }
  const origins = trimmed
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return origins.length === 1 ? origins[0]! : origins;
}

export async function buildApp(
  config: EnvConfig,
  pool: pg.Pool,
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const logger: FastifyBaseLogger = options.logger ?? createLogger();
  const authSemaphore =
    options.argon2Semaphore ?? new BoundedSemaphore(4, 20, 'AUTH_BUSY');
  const exportSemaphore =
    options.exportSemaphore ?? new BoundedSemaphore(2, 0, 'SERVICE_UNAVAILABLE');

  const app = Fastify({
    loggerInstance: logger,
    trustProxy: config.trustProxy,
    bodyLimit: MAX_REQUEST_BODY_BYTES,
    genReqId(req) {
      const incoming = req.headers['x-request-id'];
      if (typeof incoming === 'string' && SAFE_REQUEST_ID_RE.test(incoming)) {
        return incoming;
      }
      return crypto.randomUUID();
    },
  });

  app.decorate('config', config);
  app.decorate('pool', pool);
  app.decorate('authSemaphore', authSemaphore);
  app.decorate('exportSemaphore', exportSemaphore);
  app.decorate('rateLimitOverrides', options.rateLimits ?? {});

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', String(request.id));
    return payload;
  });

  await app.register(fastifyCompress, {
    global: true,
  });

  await app.register(fastifyCors, {
    origin: resolveCorsOrigin(config.corsOrigin),
    exposedHeaders: ['x-request-id'],
  });

  await app.register(fastifyRateLimit, {
    global: false,
    cache: 10_000,
    keyGenerator: (request) => normalizeRateLimitIp(request.ip),
    errorResponseBuilder: (_request, context) =>
      new ApiError(
        429,
        'RATE_LIMITED',
        `Too many requests; retry in ${context.after}.`,
      ),
  });

  app.setNotFoundHandler((request, reply) => {
    const requestId = String(request.id);
    reply
      .status(404)
      .header('x-request-id', requestId)
      .send({
        error: {
          code: 'NOT_FOUND' satisfies ErrorCode,
          message: `Route ${request.method} ${request.url} not found.`,
          requestId,
        },
      });
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    const requestId = String(request.id);
    reply.header('x-request-id', requestId);

    if (error instanceof ApiError) {
      const errorPayload: {
        code: ErrorCode;
        message: string;
        details?: unknown;
        requestId: string;
      } = {
        code: error.code,
        message: error.message,
        requestId,
      };
      if (error.details !== undefined) {
        errorPayload.details = error.details;
      }
      reply.status(error.statusCode).send({ error: errorPayload });
      return;
    }

    if (error instanceof ZodError) {
      const primaryMessage =
        error.issues[0]?.message ?? 'Request validation failed.';
      reply.status(422).send({
        error: {
          code: 'VALIDATION_ERROR' satisfies ErrorCode,
          message: primaryMessage,
          details: error.issues,
          requestId,
        },
      });
      return;
    }

    const errRecord =
      typeof error === 'object' && error !== null
        ? (error as { code?: unknown; statusCode?: unknown; message?: unknown })
        : {};
    const fastifyCode =
      typeof errRecord.code === 'string' ? errRecord.code : undefined;
    const statusCode =
      typeof errRecord.statusCode === 'number' ? errRecord.statusCode : undefined;

    if (fastifyCode === 'FST_ERR_CTP_BODY_TOO_LARGE' || statusCode === 413) {
      reply.status(413).send({
        error: {
          code: 'PAYLOAD_TOO_LARGE' satisfies ErrorCode,
          message: 'Request payload exceeds the 64 KiB limit.',
          requestId,
        },
      });
      return;
    }

    if (
      fastifyCode === 'FST_ERR_CTP_INVALID_JSON_BODY' ||
      fastifyCode === 'FST_ERR_CTP_EMPTY_JSON_BODY' ||
      statusCode === 400
    ) {
      reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR' satisfies ErrorCode,
          message: 'Malformed request payload.',
          requestId,
        },
      });
      return;
    }

    if (statusCode === 429) {
      const rateMsg =
        typeof errRecord.message === 'string' && errRecord.message.length > 0
          ? errRecord.message
          : 'Too many requests; please slow down.';
      reply.status(429).send({
        error: {
          code: 'RATE_LIMITED' satisfies ErrorCode,
          message: rateMsg,
          requestId,
        },
      });
      return;
    }

    request.log.error({ err: error }, 'Unhandled server error');
    reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR' satisfies ErrorCode,
        message: 'An unexpected internal error occurred.',
        requestId,
      },
    });
  });

  registerSystemRoutes(app, {
    ...(options.migrationsDir !== undefined
      ? { migrationsDir: options.migrationsDir }
      : {}),
  });

  return app;
}

export { resetTestDb, setupTestDb, type EnvConfig };
