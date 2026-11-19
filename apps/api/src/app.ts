// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Unseal Contributors

import crypto from 'node:crypto';
import fastifyCompress from '@fastify/compress';
import fastifyCors from '@fastify/cors';
import fastifyMultipart from '@fastify/multipart';
import fastifyRateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

import { ApiError, IMPORT_LIMITS, type ErrorCode } from '@entsiegelung/shared';

import {
  canonicalizeEmail,
  createAltchaChallenge,
  generateEmailActionToken,
  generateRecoveryCode,
  generateSessionToken,
  hashCanonicalEmail,
  hashEmailTombstone,
  hashOpaqueToken,
  hashPassword,
  hashPseudonymTombstone,
  isDisposableEmailDomain,
  legacyEmailTombstoneDigest,
  legacyPseudonymTombstoneDigest,
  solveAltchaChallenge,
  verifyAltchaPayload,
  verifyPassword,
} from './auth/crypto.js';
import {
  createMemoryMailer,
  createSmtpMailer,
  type AuthEmailPayload,
  type AuthMailer,
  type BugReportEmailPayload,
  type MemoryMailer,
} from './auth/mailer.js';
import { createSession, optionalAuth, requireAdmin, requireAuth } from './auth/session.js';
import { rekeyCanonicalEmailHashes } from './auth/tombstones.js';
import { runAdminCommand, type AdminCommandResult } from './cli/admin.js';
import { CommentRepository } from './comments/repository.js';
import { type EnvConfig } from './config.js';
import {
  deleteOrBanUserAccount,
  lockUserForWrite,
  recomputeCommentScores,
  recomputePhotoScores,
  recomputePolygonScores,
} from './db/integrity.js';
import {
  purgeAbandonedUnverifiedAccounts,
  purgeExpiredPersonalData,
} from './db/retention.js';
import {
  collectTelemetryExport,
  recordTelemetryBestEffort,
  recordTelemetryCounter,
  type TelemetryExportReport,
} from './db/telemetry.js';
import { resetTestDb, setupTestDb } from './db/testHarness.js';
import { createLogger } from './logger.js';
import {
  loadVg250Municipalities,
  upsertMunicipalitiesAndBackfill,
  type MunicipalitySeedInput,
} from './municipalities/vg250.js';
import { processUploadedPhoto } from './photos/processor.js';
import { PhotoRepository } from './photos/repository.js';
import { parseGeoPackageBinary } from './polygons/gpkgReader.js';
import {
  classifyLandCoverFeatureProperties,
  loadLandCoverFile,
  seedLandCoverExclusions,
  type LandCoverSeedItem,
  type LoadLandCoverOptions,
  type LoadLandCoverResult,
} from './polygons/landCover.js';
import { PolygonRepository } from './polygons/repository.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAuthPageRoutes } from './routes/authPages.js';
import { registerBugReportRoutes } from './routes/bugReports.js';
import { registerCommentRoutes } from './routes/comments.js';
import {
  registerDop20TileRoutes,
  type Dop20TileRoutesOptions,
} from './routes/dop20Tiles.js';
import {
  registerGeocodeRoutes,
  type GeocodeRoutesOptions,
} from './routes/geocode.js';
import { registerPhotoRoutes } from './routes/photos.js';
import { registerPolygonRoutes } from './routes/polygons.js';
import { registerStatsRoutes } from './routes/stats.js';
import { registerSystemRoutes } from './routes/system.js';
import { registerVoteRoutes } from './routes/votes.js';
import { normalizeRateLimitIp } from './util/rateLimit.js';
import { BoundedSemaphore } from './util/semaphore.js';
import { VoteRepository } from './votes/repository.js';

import type pg from 'pg';

export interface RateLimitWindowOverride {
  max: number;
  timeWindow: string | number;
}

export interface RateLimitOverrides {
  register?: RateLimitWindowOverride;
  registerSubnet?: { max: number; timeWindowMs: number };
  loginIp?: RateLimitWindowOverride;
  loginAccount?: { max: number; timeWindowMs: number };
  recover?: RateLimitWindowOverride;
  deleteAccount?: RateLimitWindowOverride;
  createPolygon?: RateLimitWindowOverride;
  mutatePolygon?: RateLimitWindowOverride;
  vote?: RateLimitWindowOverride;
  exportGeoJson?: RateLimitWindowOverride;
  geocode?: RateLimitWindowOverride;
  bugReport?: RateLimitWindowOverride;
}

export interface BuildAppOptions {
  logger?: FastifyBaseLogger;
  migrationsDir?: string;
  argon2Semaphore?: BoundedSemaphore;
  exportSemaphore?: BoundedSemaphore;
  exportBatchSize?: number;
  exportStreamTimeoutMs?: number;
  rateLimits?: RateLimitOverrides;
  mailer?: AuthMailer;
  dop20TileFetch?: Dop20TileRoutesOptions['fetchImpl'];
  geocodeFetch?: GeocodeRoutesOptions['fetchImpl'];
}

declare module 'fastify' {
  interface FastifyInstance {
    config: EnvConfig;
    pool: pg.Pool;
    authSemaphore: BoundedSemaphore;
    exportSemaphore: BoundedSemaphore;
    rateLimitOverrides: RateLimitOverrides;
    mailer: AuthMailer;
    runAdminCommand: (argv: string[]) => Promise<AdminCommandResult>;
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
    options.exportSemaphore ??
    new BoundedSemaphore(2, 0, 'SERVICE_UNAVAILABLE');
  const mailer = options.mailer ?? createSmtpMailer(config, logger);

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
  app.decorate('mailer', mailer);
  app.decorate('runAdminCommand', (argv: string[]) =>
    runAdminCommand(pool, argv, {
      uploadsDir: config.uploadsDir,
      logger,
      tombstoneSecret: config.tombstoneSecret,
      publicBaseUrl: config.publicBaseUrl,
    }),
  );

  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string', bodyLimit: 16384 },
    (_req, body, done) => {
      try {
        const raw = typeof body === 'string' ? body : String(body);
        const params = new URLSearchParams(raw);
        const obj: Record<string, string> = {};
        for (const [k, v] of params.entries()) {
          obj[k] = v;
        }
        done(null, obj);
      } catch (err) {
        done(err instanceof Error ? err : new Error('Invalid form body'), undefined);
      }
    },
  );

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', String(request.id));
    return payload;
  });

  await app.register(fastifyCompress, {
    global: true,
  });

  await app.register(fastifyCors, {
    origin: resolveCorsOrigin(config.corsOrigin),
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id'],
    exposedHeaders: ['x-request-id'],
  });

  await app.register(fastifyMultipart, {
    limits: {
      fileSize: IMPORT_LIMITS.MAX_FILE_BYTES,
      files: 1,
      fields: 10,
    },
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

    if (
      fastifyCode === 'FST_ERR_CTP_BODY_TOO_LARGE' ||
      fastifyCode === 'FST_REQ_FILE_TOO_LARGE' ||
      statusCode === 413
    ) {
      reply.status(413).send({
        error: {
          code: 'PAYLOAD_TOO_LARGE' satisfies ErrorCode,
          message: 'Request payload exceeds allowed size limit.',
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
  registerDop20TileRoutes(
    app,
    options.dop20TileFetch !== undefined
      ? { fetchImpl: options.dop20TileFetch }
      : {},
  );
  registerGeocodeRoutes(
    app,
    options.geocodeFetch !== undefined
      ? { fetchImpl: options.geocodeFetch }
      : {},
  );
  registerBugReportRoutes(app);
  registerAuthRoutes(app);
  registerAuthPageRoutes(app);

  const polygonRepository = new PolygonRepository(pool, config.uploadsDir, {
    minAccountDays: config.newUserMinAccountDays,
    minCleanPolygons: config.newUserMinCleanPolygons,
  });
  registerPolygonRoutes(app, polygonRepository, {
    ...(options.exportBatchSize !== undefined
      ? { exportBatchSize: options.exportBatchSize }
      : {}),
    ...(options.exportStreamTimeoutMs !== undefined
      ? { exportStreamTimeoutMs: options.exportStreamTimeoutMs }
      : {}),
  });
  registerStatsRoutes(app, polygonRepository);

  const photoRepository = new PhotoRepository(pool, config.uploadsDir);
  registerPhotoRoutes(app, photoRepository);

  const commentRepository = new CommentRepository(pool);
  registerCommentRoutes(app, commentRepository);

  const voteRepository = new VoteRepository(pool);
  registerVoteRoutes(app, voteRepository);

  return app;
}

export {
  CommentRepository,
  PhotoRepository,
  PolygonRepository,
  VoteRepository,
  canonicalizeEmail,
  classifyLandCoverFeatureProperties,
  collectTelemetryExport,
  createAltchaChallenge,
  createMemoryMailer,
  createSession,
  createSmtpMailer,
  deleteOrBanUserAccount,
  generateEmailActionToken,
  generateRecoveryCode,
  generateSessionToken,
  hashCanonicalEmail,
  hashEmailTombstone,
  hashOpaqueToken,
  hashPassword,
  hashPseudonymTombstone,
  isDisposableEmailDomain,
  legacyEmailTombstoneDigest,
  legacyPseudonymTombstoneDigest,
  loadLandCoverFile,
  loadVg250Municipalities,
  lockUserForWrite,
  optionalAuth,
  parseGeoPackageBinary,
  processUploadedPhoto,
  purgeAbandonedUnverifiedAccounts,
  purgeExpiredPersonalData,
  recomputeCommentScores,
  recomputePhotoScores,
  recomputePolygonScores,
  recordTelemetryBestEffort,
  recordTelemetryCounter,
  rekeyCanonicalEmailHashes,
  registerAuthPageRoutes,
  registerAuthRoutes,
  registerBugReportRoutes,
  registerCommentRoutes,
  registerGeocodeRoutes,
  registerPhotoRoutes,
  registerPolygonRoutes,
  registerStatsRoutes,
  registerVoteRoutes,
  requireAdmin,
  requireAuth,
  resetTestDb,
  runAdminCommand,
  seedLandCoverExclusions,
  setupTestDb,
  solveAltchaChallenge,
  upsertMunicipalitiesAndBackfill,
  verifyAltchaPayload,
  verifyPassword,
  type AdminCommandResult,
  type AuthEmailPayload,
  type AuthMailer,
  type BugReportEmailPayload,
  type EnvConfig,
  type LandCoverSeedItem,
  type LoadLandCoverOptions,
  type LoadLandCoverResult,
  type MemoryMailer,
  type MunicipalitySeedInput,
  type TelemetryExportReport,
};
