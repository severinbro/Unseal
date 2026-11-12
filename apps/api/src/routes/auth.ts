import {
  AUTH_LIMITS,
  ApiError,
  AuthUserSchema,
  LoginRequestSchema,
  RESERVED_PSEUDONYMS,
  RecoverRequestSchema,
  RegisterRequestSchema,
  RegisterResponseSchema,
  SessionResponseSchema,
  normalizeRecoveryCode,
} from '@entsiegelung/shared';

import {
  TIMING_GUARD_OPAQUE_TOKEN_HASH,
  TIMING_GUARD_PASSWORD_HASH,
  generateRecoveryCode,
  hashOpaqueToken,
  hashPassword,
  hashPseudonymTombstone,
  verifyOpaqueToken,
  verifyPassword,
} from '../auth/crypto.js';
import { createSession, requireAuth } from '../auth/session.js';
import { deleteOrBanUserAccount } from '../db/integrity.js';
import { normalizeRateLimitIp } from '../util/rateLimit.js';

import type { FastifyInstance, FastifyBaseLogger } from 'fastify';
import type pg from 'pg';

const MAX_FAILED_LOGIN_CACHE_ENTRIES = 10_000;
const DEFAULT_LOGIN_ACCOUNT_MAX = 5;
const DEFAULT_LOGIN_ACCOUNT_WINDOW_MS = 15 * 60 * 1000;
const RECOVERY_HEX_RE = new RegExp(
  `^[0-9A-F]{${AUTH_LIMITS.RECOVERY_CODE_HEX_LENGTH}}$`,
);

interface FailedLoginBucket {
  count: number;
  expiresAtMs: number;
}

class BoundedFailedLoginTracker {
  private readonly buckets = new Map<string, FailedLoginBucket>();
  private readonly maxEntries: number;
  private readonly maxFailures: number;
  private readonly windowMs: number;

  constructor(maxFailures: number, windowMs: number, maxEntries = MAX_FAILED_LOGIN_CACHE_ENTRIES) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
    this.maxEntries = maxEntries;
  }

  public assertAllowed(key: string, nowMs: number): void {
    const bucket = this.buckets.get(key);
    if (!bucket) {
      return;
    }
    if (nowMs >= bucket.expiresAtMs) {
      this.buckets.delete(key);
      return;
    }
    if (bucket.count >= this.maxFailures) {
      throw new ApiError(
        429,
        'RATE_LIMITED',
        'Too many failed login attempts for this account; please retry later.',
      );
    }
  }

  public recordFailure(key: string, nowMs: number): void {
    const existing = this.buckets.get(key);
    if (!existing || nowMs >= existing.expiresAtMs) {
      this.buckets.delete(key);
      if (this.buckets.size >= this.maxEntries) {
        this.pruneExpiredOrOldest(nowMs);
      }
      this.buckets.set(key, {
        count: 1,
        expiresAtMs: nowMs + this.windowMs,
      });
      return;
    }

    this.buckets.delete(key);
    this.buckets.set(key, {
      count: existing.count + 1,
      expiresAtMs: existing.expiresAtMs,
    });
  }

  public clear(key: string): void {
    this.buckets.delete(key);
  }

  private pruneExpiredOrOldest(nowMs: number): void {
    for (const [k, v] of this.buckets) {
      if (nowMs >= v.expiresAtMs) {
        this.buckets.delete(k);
        if (this.buckets.size < this.maxEntries) {
          return;
        }
      }
    }
    const oldestKey = this.buckets.keys().next().value;
    if (oldestKey !== undefined) {
      this.buckets.delete(oldestKey);
    }
  }
}

interface UserAuthRow {
  id: string;
  pseudonym: string;
  password_hash: string;
  created_at: Date;
}

interface UserRecoverRow {
  id: string;
  pseudonym: string;
  recovery_code_hash: Buffer;
  created_at: Date;
}

interface ReservedPseudonymRow {
  reason: string;
}

async function rollbackQuietly(
  client: pg.PoolClient,
  log: FastifyBaseLogger,
): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch (rollbackErr: unknown) {
    log.warn({ err: rollbackErr }, 'Database transaction rollback failed');
  }
}

async function checkReservedPseudonymTable(
  db: pg.Pool | pg.PoolClient,
  pseudonymLower: string,
): Promise<void> {
  const tombstoneHash = hashPseudonymTombstone(pseudonymLower);
  const reservedRes = await db.query<ReservedPseudonymRow>(
    'SELECT reason FROM reserved_pseudonyms WHERE pseudonym_hash = $1 LIMIT 1',
    [tombstoneHash],
  );
  const reservedRow = reservedRes.rows[0];
  if (!reservedRow) {
    return;
  }
  if (reservedRow.reason !== 'self_deleted') {
    throw new ApiError(
      403,
      'FORBIDDEN_PSEUDONYM_BANNED',
      'This pseudonym is not permitted.',
    );
  }
  throw new ApiError(
    409,
    'AUTH_PSEUDONYM_TAKEN',
    'This pseudonym is unavailable.',
  );
}

export function registerAuthRoutes(app: FastifyInstance): void {
  if (!app.hasRequestDecorator('auth')) {
    app.decorateRequest('auth', null);
  }

  const loginAccountOverride = app.rateLimitOverrides.loginAccount;
  const failedLoginTracker = new BoundedFailedLoginTracker(
    loginAccountOverride?.max ?? DEFAULT_LOGIN_ACCOUNT_MAX,
    loginAccountOverride?.timeWindowMs ?? DEFAULT_LOGIN_ACCOUNT_WINDOW_MS,
  );

  const registerLimit = app.rateLimitOverrides.register ?? {
    max: 10,
    timeWindow: '1 hour',
  };
  const loginIpLimit = app.rateLimitOverrides.loginIp ?? {
    max: 20,
    timeWindow: '15 minutes',
  };
  const recoverLimit = app.rateLimitOverrides.recover ?? {
    max: 10,
    timeWindow: '15 minutes',
  };
  const deleteAccountLimit = app.rateLimitOverrides.deleteAccount ?? {
    max: 10,
    timeWindow: '1 hour',
  };

  app.post(
    '/api/v1/auth/register',
    {
      config: {
        rateLimit: registerLimit,
      },
    },
    async (request, reply) => {
      const body = RegisterRequestSchema.parse(request.body);
      const pseudonymLower = body.pseudonym.toLowerCase();

      if ((RESERVED_PSEUDONYMS as readonly string[]).includes(pseudonymLower)) {
        throw new ApiError(
          409,
          'AUTH_PSEUDONYM_TAKEN',
          'This pseudonym is reserved and cannot be registered.',
        );
      }

      await checkReservedPseudonymTable(app.pool, pseudonymLower);

      const existingRes = await app.pool.query<{ exists: number }>(
        'SELECT 1 AS exists FROM users WHERE LOWER(pseudonym) = $1 LIMIT 1',
        [pseudonymLower],
      );
      if ((existingRes.rowCount ?? 0) > 0) {
        throw new ApiError(
          409,
          'AUTH_PSEUDONYM_TAKEN',
          'This pseudonym is already taken.',
        );
      }

      const passwordHash = await hashPassword(body.password, app.authSemaphore);
      const recoveryCode = generateRecoveryCode();
      const recoveryCodeHash = hashOpaqueToken(
        normalizeRecoveryCode(recoveryCode),
      );

      const client = await app.pool.connect();
      try {
        await client.query('BEGIN');
        await checkReservedPseudonymTable(client, pseudonymLower);

        let createdUser: { id: string; pseudonym: string; created_at: Date } | undefined;
        try {
          const insertRes = await client.query<{
            id: string;
            pseudonym: string;
            created_at: Date;
          }>(
            `INSERT INTO users (pseudonym, password_hash, recovery_code_hash)
             VALUES ($1, $2, $3)
             RETURNING id, pseudonym, created_at`,
            [body.pseudonym, passwordHash, recoveryCodeHash],
          );
          createdUser = insertRes.rows[0];
        } catch (err: unknown) {
          const pgCode =
            typeof err === 'object' && err !== null && 'code' in err
              ? (err as { code?: unknown }).code
              : undefined;
          if (pgCode === '23505') {
            throw new ApiError(
              409,
              'AUTH_PSEUDONYM_TAKEN',
              'This pseudonym is already taken.',
            );
          }
          throw err;
        }

        if (!createdUser) {
          throw new ApiError(500, 'INTERNAL_ERROR', 'Failed to create user.');
        }

        const session = await createSession(
          client,
          createdUser.id,
          app.config.sessionTtlDays,
        );

        await client.query('COMMIT');

        const payload = RegisterResponseSchema.parse({
          user: {
            id: createdUser.id,
            pseudonym: createdUser.pseudonym,
            createdAt: createdUser.created_at.toISOString(),
          },
          sessionToken: session.sessionToken,
          expiresAt: session.expiresAt,
          recoveryCode,
        });

        return reply.status(201).send(payload);
      } catch (err: unknown) {
        await rollbackQuietly(client, request.log);
        throw err;
      } finally {
        client.release();
      }
    },
  );

  app.post(
    '/api/v1/auth/login',
    {
      config: {
        rateLimit: loginIpLimit,
      },
    },
    async (request) => {
      const body = LoginRequestSchema.parse(request.body);
      const pseudonymLower = body.pseudonym.toLowerCase();
      const compositeKey = `${normalizeRateLimitIp(request.ip)}:${pseudonymLower}`;
      const nowMs = Date.now();

      failedLoginTracker.assertAllowed(compositeKey, nowMs);

      const userRes = await app.pool.query<UserAuthRow>(
        `SELECT id, pseudonym, password_hash, created_at
         FROM users
         WHERE LOWER(pseudonym) = $1
         LIMIT 1`,
        [pseudonymLower],
      );
      const userRow = userRes.rows[0];

      if (!userRow) {
        await verifyPassword(
          TIMING_GUARD_PASSWORD_HASH,
          body.password,
          app.authSemaphore,
        );
        failedLoginTracker.recordFailure(compositeKey, Date.now());
        throw new ApiError(
          401,
          'AUTH_INVALID_CREDENTIALS',
          'Invalid pseudonym or password.',
        );
      }

      const passwordValid = await verifyPassword(
        userRow.password_hash,
        body.password,
        app.authSemaphore,
      );
      if (!passwordValid) {
        failedLoginTracker.recordFailure(compositeKey, Date.now());
        throw new ApiError(
          401,
          'AUTH_INVALID_CREDENTIALS',
          'Invalid pseudonym or password.',
        );
      }

      const session = await createSession(
        app.pool,
        userRow.id,
        app.config.sessionTtlDays,
      );

      return SessionResponseSchema.parse({
        user: {
          id: userRow.id,
          pseudonym: userRow.pseudonym,
          createdAt: userRow.created_at.toISOString(),
        },
        sessionToken: session.sessionToken,
        expiresAt: session.expiresAt,
      });
    },
  );

  app.post(
    '/api/v1/auth/recover',
    {
      config: {
        rateLimit: recoverLimit,
      },
    },
    async (request) => {
      const body = RecoverRequestSchema.parse(request.body);
      const pseudonymLower = body.pseudonym.toLowerCase();
      const normalizedCode = normalizeRecoveryCode(body.recoveryCode);
      const isValidHexFormat = RECOVERY_HEX_RE.test(normalizedCode);

      const userRes = await app.pool.query<UserRecoverRow>(
        `SELECT id, pseudonym, recovery_code_hash, created_at
         FROM users
         WHERE LOWER(pseudonym) = $1
         LIMIT 1`,
        [pseudonymLower],
      );
      const userRow = userRes.rows[0];

      if (!userRow) {
        verifyOpaqueToken(normalizedCode, TIMING_GUARD_OPAQUE_TOKEN_HASH);
        throw new ApiError(
          401,
          'AUTH_RECOVERY_INVALID',
          'Invalid pseudonym or recovery code.',
        );
      }

      const precheckMatches = verifyOpaqueToken(
        normalizedCode,
        userRow.recovery_code_hash,
      );
      if (!isValidHexFormat || !precheckMatches) {
        throw new ApiError(
          401,
          'AUTH_RECOVERY_INVALID',
          'Invalid pseudonym or recovery code.',
        );
      }

      const newPasswordHash = await hashPassword(
        body.newPassword,
        app.authSemaphore,
      );

      const client = await app.pool.connect();
      try {
        await client.query('BEGIN');

        const lockedRes = await client.query<UserRecoverRow>(
          `SELECT id, pseudonym, recovery_code_hash, created_at
           FROM users
           WHERE id = $1
           FOR UPDATE`,
          [userRow.id],
        );
        const lockedUser = lockedRes.rows[0];

        if (
          !lockedUser ||
          !verifyOpaqueToken(normalizedCode, lockedUser.recovery_code_hash)
        ) {
          throw new ApiError(
            401,
            'AUTH_RECOVERY_INVALID',
            'Invalid pseudonym or recovery code.',
          );
        }

        const nextRecoveryCode = generateRecoveryCode();
        const nextRecoveryCodeHash = hashOpaqueToken(
          normalizeRecoveryCode(nextRecoveryCode),
        );

        await client.query(
          `UPDATE users
           SET password_hash = $2,
               recovery_code_hash = $3
           WHERE id = $1`,
          [lockedUser.id, newPasswordHash, nextRecoveryCodeHash],
        );

        await client.query('DELETE FROM sessions WHERE user_id = $1', [
          lockedUser.id,
        ]);

        const session = await createSession(
          client,
          lockedUser.id,
          app.config.sessionTtlDays,
        );

        await client.query('COMMIT');

        const compositeKey = `${normalizeRateLimitIp(request.ip)}:${pseudonymLower}`;
        failedLoginTracker.clear(compositeKey);

        return RegisterResponseSchema.parse({
          user: {
            id: lockedUser.id,
            pseudonym: lockedUser.pseudonym,
            createdAt: lockedUser.created_at.toISOString(),
          },
          sessionToken: session.sessionToken,
          expiresAt: session.expiresAt,
          recoveryCode: nextRecoveryCode,
        });
      } catch (err: unknown) {
        await rollbackQuietly(client, request.log);
        throw err;
      } finally {
        client.release();
      }
    },
  );

  app.post(
    '/api/v1/auth/logout',
    {
      preHandler: requireAuth,
    },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) {
        throw new ApiError(
          401,
          'AUTH_REQUIRED',
          'Valid bearer session token is required.',
        );
      }
      await app.pool.query('DELETE FROM sessions WHERE id = $1', [
        auth.sessionId,
      ]);
      return reply.status(204).send();
    },
  );

  app.get(
    '/api/v1/auth/me',
    {
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
      return AuthUserSchema.parse(auth.user);
    },
  );

  app.delete(
    '/api/v1/auth/me',
    {
      config: {
        rateLimit: deleteAccountLimit,
      },
      preHandler: requireAuth,
    },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) {
        throw new ApiError(
          401,
          'AUTH_REQUIRED',
          'Valid bearer session token is required.',
        );
      }

      const client = await app.pool.connect();
      try {
        await client.query('BEGIN');
        await deleteOrBanUserAccount(client, {
          userId: auth.user.id,
          pseudonymLower: auth.user.pseudonym.toLowerCase(),
          mode: 'self_delete',
        });
        await client.query('COMMIT');
      } catch (err: unknown) {
        await rollbackQuietly(client, request.log);
        throw err;
      } finally {
        client.release();
      }

      return reply.status(204).send();
    },
  );
}
