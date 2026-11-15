import {
  AUTH_LIMITS,
  AltchaChallengeResponseSchema,
  ApiError,
  AuthUserSchema,
  DeleteAccountQuerySchema,
  EmailActionRequestSchema,
  EmailActionResponseSchema,
  LoginRequestSchema,
  PasswordSchema,
  RESERVED_PSEUDONYMS,
  RegisterRequestSchema,
  RegisterResponseSchema,
  ResetPasswordRequestSchema,
  ResetPasswordResponseSchema,
  SessionResponseSchema,
  VerifyEmailRequestSchema,
  VerifyEmailResponseSchema,
} from '@entsiegelung/shared';

import {
  TIMING_GUARD_OPAQUE_TOKEN_HASH,
  TIMING_GUARD_PASSWORD_HASH,
  createAltchaChallenge,
  generateEmailActionToken,
  hashCanonicalEmail,
  hashOpaqueToken,
  hashPassword,
  isDisposableEmailDomain,
  verifyAltchaPayload,
  verifyOpaqueToken,
  verifyPassword,
} from '../auth/crypto.js';
import { createSession, requireAuth } from '../auth/session.js';
import {
  assertEmailNotReserved,
  assertPseudonymNotReserved,
} from '../auth/tombstones.js';
import { deleteOrBanUserAccount } from '../db/integrity.js';
import { unlinkUploadFiles } from '../photos/uploadFiles.js';
import { collectUserData } from '../users/dataExport.js';
import {
  normalizeRateLimitIp,
  normalizeRateLimitSubnet,
} from '../util/rateLimit.js';
import { BoundedSemaphore } from '../util/semaphore.js';

import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type pg from 'pg';

const MAX_FAILED_LOGIN_CACHE_ENTRIES = 10_000;
const DEFAULT_LOGIN_ACCOUNT_MAX = 5;
const DEFAULT_LOGIN_ACCOUNT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_REGISTER_SUBNET_WINDOW_MS = 60 * 60 * 1000;
const MAX_USED_ALTCHA_CHALLENGES = 10_000;
const ALTCHA_REPLAY_RETENTION_MS = 15 * 60 * 1000;

class BoundedReplayCache {
  private readonly seen = new Map<string, number>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(
    maxEntries = MAX_USED_ALTCHA_CHALLENGES,
    ttlMs = ALTCHA_REPLAY_RETENTION_MS,
  ) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  public consumeOnce(key: string, nowMs: number): boolean {
    const existingExpiry = this.seen.get(key);
    if (existingExpiry !== undefined && nowMs < existingExpiry) {
      return false;
    }
    this.seen.delete(key);
    if (this.seen.size >= this.maxEntries) {
      for (const [k, exp] of this.seen) {
        if (nowMs >= exp) {
          this.seen.delete(k);
          if (this.seen.size < this.maxEntries) {
            break;
          }
        }
      }
      if (this.seen.size >= this.maxEntries) {
        const oldest = this.seen.keys().next().value;
        if (oldest !== undefined) {
          this.seen.delete(oldest);
        }
      }
    }
    this.seen.set(key, nowMs + this.ttlMs);
    return true;
  }
}

interface FailedLoginBucket {
  count: number;
  expiresAtMs: number;
}

class BoundedFailedLoginTracker {
  private readonly buckets = new Map<string, FailedLoginBucket>();
  private readonly maxEntries: number;
  private readonly maxFailures: number;
  private readonly windowMs: number;

  constructor(
    maxFailures: number,
    windowMs: number,
    maxEntries = MAX_FAILED_LOGIN_CACHE_ENTRIES,
  ) {
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
  email: string | null;
  email_verified_at: Date | null;
  role: string;
  password_hash: string;
  created_at: Date;
}

interface EmailTokenLookupRow {
  id: string;
  user_id: string;
  pseudonym: string;
  token_hash: Buffer;
  expires_at: Date;
  consumed_at: Date | null;
}

async function rollbackQuietly(
  client: pg.PoolClient,
  log?: FastifyBaseLogger,
): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch (rollbackErr: unknown) {
    log?.warn({ err: rollbackErr }, 'Database transaction rollback failed');
  }
}

export async function inspectEmailActionToken(
  pool: pg.Pool,
  rawToken: string,
  purpose: 'verify_email' | 'reset_password',
): Promise<{ valid: boolean; pseudonym?: string }> {
  const trimmed = rawToken.trim();
  if (trimmed.length < 16 || trimmed.length > 256) {
    verifyOpaqueToken(trimmed || 'invalid', TIMING_GUARD_OPAQUE_TOKEN_HASH);
    return { valid: false };
  }

  const tokenHash = hashOpaqueToken(trimmed);
  const res = await pool.query<EmailTokenLookupRow>(
    `SELECT
       et.id,
       et.user_id,
       u.pseudonym,
       et.token_hash,
       et.expires_at,
       et.consumed_at
     FROM email_tokens et
     INNER JOIN users u ON u.id = et.user_id
     WHERE et.token_hash = $1
       AND et.purpose = $2
       AND et.consumed_at IS NULL
       AND et.expires_at > clock_timestamp()
     LIMIT 1`,
    [tokenHash, purpose],
  );
  const row = res.rows[0];
  if (!row || !verifyOpaqueToken(trimmed, row.token_hash)) {
    return { valid: false };
  }
  return { valid: true, pseudonym: row.pseudonym };
}

export async function consumeVerifyEmailToken(
  pool: pg.Pool,
  rawToken: string,
  log?: FastifyBaseLogger,
): Promise<{ pseudonym: string }> {
  const trimmed = rawToken.trim();
  if (trimmed.length < 16 || trimmed.length > 256) {
    verifyOpaqueToken(trimmed || 'invalid', TIMING_GUARD_OPAQUE_TOKEN_HASH);
    throw new ApiError(
      400,
      'AUTH_TOKEN_INVALID',
      'Invalid or expired email confirmation link.',
    );
  }

  const tokenHash = hashOpaqueToken(trimmed);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tokenRes = await client.query<{
      id: string;
      user_id: string;
      token_hash: Buffer;
      consumed_at: Date | null;
      is_valid_time: boolean;
    }>(
      `SELECT
         id,
         user_id,
         token_hash,
         consumed_at,
         (expires_at > clock_timestamp()) AS is_valid_time
       FROM email_tokens
       WHERE token_hash = $1
         AND purpose = 'verify_email'
       FOR UPDATE`,
      [tokenHash],
    );
    const tokenRow = tokenRes.rows[0];
    if (
      !tokenRow ||
      !verifyOpaqueToken(trimmed, tokenRow.token_hash) ||
      tokenRow.consumed_at !== null ||
      !tokenRow.is_valid_time
    ) {
      throw new ApiError(
        400,
        'AUTH_TOKEN_INVALID',
        'Invalid or expired email confirmation link.',
      );
    }

    await client.query(
      'UPDATE email_tokens SET consumed_at = clock_timestamp() WHERE id = $1',
      [tokenRow.id],
    );

    const userRes = await client.query<{ pseudonym: string }>(
      `UPDATE users
       SET email_verified_at = COALESCE(email_verified_at, clock_timestamp())
       WHERE id = $1
       RETURNING pseudonym`,
      [tokenRow.user_id],
    );
    const updatedUser = userRes.rows[0];
    if (!updatedUser) {
      throw new ApiError(
        400,
        'AUTH_TOKEN_INVALID',
        'Account for this confirmation link no longer exists.',
      );
    }

    await client.query('COMMIT');
    return { pseudonym: updatedUser.pseudonym };
  } catch (err: unknown) {
    await rollbackQuietly(client, log);
    throw err;
  } finally {
    client.release();
  }
}

export async function consumePasswordResetToken(
  pool: pg.Pool,
  authSemaphore: BoundedSemaphore,
  rawToken: string,
  newPassword: string,
  log?: FastifyBaseLogger,
): Promise<void> {
  const parsedPassword = PasswordSchema.parse(newPassword);
  const trimmed = rawToken.trim();
  if (trimmed.length < 16 || trimmed.length > 256) {
    verifyOpaqueToken(trimmed || 'invalid', TIMING_GUARD_OPAQUE_TOKEN_HASH);
    throw new ApiError(
      400,
      'AUTH_TOKEN_INVALID',
      'Invalid or expired password reset link.',
    );
  }

  const precheck = await inspectEmailActionToken(pool, trimmed, 'reset_password');
  if (!precheck.valid) {
    throw new ApiError(
      400,
      'AUTH_TOKEN_INVALID',
      'Invalid or expired password reset link.',
    );
  }

  const nextPasswordHash = await hashPassword(parsedPassword, authSemaphore);
  const tokenHash = hashOpaqueToken(trimmed);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tokenRes = await client.query<{
      id: string;
      user_id: string;
      token_hash: Buffer;
      consumed_at: Date | null;
      is_valid_time: boolean;
    }>(
      `SELECT
         id,
         user_id,
         token_hash,
         consumed_at,
         (expires_at > clock_timestamp()) AS is_valid_time
       FROM email_tokens
       WHERE token_hash = $1
         AND purpose = 'reset_password'
       FOR UPDATE`,
      [tokenHash],
    );
    const tokenRow = tokenRes.rows[0];
    if (
      !tokenRow ||
      !verifyOpaqueToken(trimmed, tokenRow.token_hash) ||
      tokenRow.consumed_at !== null ||
      !tokenRow.is_valid_time
    ) {
      throw new ApiError(
        400,
        'AUTH_TOKEN_INVALID',
        'Invalid or expired password reset link.',
      );
    }

    const lockedUserRes = await client.query<{ id: string }>(
      'SELECT id FROM users WHERE id = $1 FOR UPDATE',
      [tokenRow.user_id],
    );
    if (lockedUserRes.rowCount === 0) {
      throw new ApiError(
        400,
        'AUTH_TOKEN_INVALID',
        'Account for this password reset link no longer exists.',
      );
    }

    await client.query(
      `UPDATE email_tokens
       SET consumed_at = clock_timestamp()
       WHERE user_id = $1
         AND purpose = 'reset_password'
         AND consumed_at IS NULL`,
      [tokenRow.user_id],
    );

    await client.query(
      `UPDATE users
       SET
         password_hash = $2,
         email_verified_at = COALESCE(email_verified_at, clock_timestamp())
       WHERE id = $1`,
      [tokenRow.user_id, nextPasswordHash],
    );

    await client.query('DELETE FROM sessions WHERE user_id = $1', [
      tokenRow.user_id,
    ]);

    await client.query('COMMIT');
  } catch (err: unknown) {
    await rollbackQuietly(client, log);
    throw err;
  } finally {
    client.release();
  }
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
  const defaultSubnetMax = Math.max(
    25,
    (app.rateLimitOverrides.register?.max ?? 10) * 3,
  );
  const registerSubnetOverride = app.rateLimitOverrides.registerSubnet;
  const registerSubnetTracker = new BoundedFailedLoginTracker(
    registerSubnetOverride?.max ?? defaultSubnetMax,
    registerSubnetOverride?.timeWindowMs ?? DEFAULT_REGISTER_SUBNET_WINDOW_MS,
  );
  const altchaReplayCache = new BoundedReplayCache();
  const challengeLimit = {
    max: Math.max(60, (app.rateLimitOverrides.register?.max ?? 10) * 6),
    timeWindow: '1 minute',
  };
  const loginIpLimit = app.rateLimitOverrides.loginIp ?? {
    max: 20,
    timeWindow: '15 minutes',
  };
  const recoverLimit = app.rateLimitOverrides.recover ?? {
    max: 8,
    timeWindow: '15 minutes',
  };
  const deleteAccountLimit = app.rateLimitOverrides.deleteAccount ?? {
    max: 10,
    timeWindow: '1 hour',
  };

  app.get(
    '/api/v1/auth/challenge',
    {
      config: {
        rateLimit: challengeLimit,
      },
    },
    async (_request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const challenge = createAltchaChallenge(app.config.authCaptchaSecret, {
        maxNumber: app.config.authCaptchaMaxNumber,
      });
      return AltchaChallengeResponseSchema.parse(challenge);
    },
  );

  app.post(
    '/api/v1/auth/register',
    {
      config: {
        rateLimit: registerLimit,
      },
    },
    async (request, reply) => {
      const subnetKey = normalizeRateLimitSubnet(request.ip);
      const nowMs = Date.now();
      try {
        registerSubnetTracker.assertAllowed(subnetKey, nowMs);
      } catch {
        throw new ApiError(
          429,
          'RATE_LIMITED',
          'Too many account registrations from this network; please retry later.',
        );
      }

      const body = RegisterRequestSchema.parse(request.body);
      const pseudonymLower = body.pseudonym.toLowerCase();
      const emailLower = body.email.toLowerCase();
      const canonicalEmailHash = hashCanonicalEmail(
        app.config.tombstoneSecret,
        emailLower,
      );

      if (
        isDisposableEmailDomain(
          emailLower,
          app.config.disposableEmailBlocklistExtra,
        )
      ) {
        throw new ApiError(
          422,
          'AUTH_DISPOSABLE_EMAIL',
          'Disposable or temporary email addresses are not permitted.',
        );
      }

      if (app.config.authCaptchaEnabled && !body.altchaPayload) {
        throw new ApiError(
          422,
          'AUTH_CAPTCHA_REQUIRED',
          'Anti-spam verification challenge is required to register.',
        );
      }

      if (body.altchaPayload !== undefined) {
        const verifiedChallenge = verifyAltchaPayload(
          body.altchaPayload,
          app.config.authCaptchaSecret,
          nowMs,
        );
        if (
          !verifiedChallenge.valid ||
          !verifiedChallenge.challengeId ||
          !altchaReplayCache.consumeOnce(verifiedChallenge.challengeId, nowMs)
        ) {
          throw new ApiError(
            422,
            'AUTH_CAPTCHA_INVALID',
            'Invalid, expired, or already-used anti-spam verification challenge.',
          );
        }
      }

      // GDPR Art. 5(1)(e) storage limitation: purge abandoned unverified accounts (> 48h)
      await app.pool.query(
        `DELETE FROM users u
         WHERE u.email_verified_at IS NULL
           AND u.created_at < NOW() - INTERVAL '48 hours'
           AND NOT EXISTS (
             SELECT 1 FROM email_tokens et
             WHERE et.user_id = u.id
               AND et.purpose = 'verify_email'
               AND et.consumed_at IS NULL
               AND et.expires_at > NOW()
           )`,
      );

      if ((RESERVED_PSEUDONYMS as readonly string[]).includes(pseudonymLower)) {
        throw new ApiError(
          409,
          'AUTH_PSEUDONYM_TAKEN',
          'This pseudonym is reserved and cannot be registered.',
        );
      }

      await assertPseudonymNotReserved(
        app.pool,
        app.config.tombstoneSecret,
        pseudonymLower,
      );
      await assertEmailNotReserved(app.pool, app.config.tombstoneSecret, emailLower);

      const existingPseudonymRes = await app.pool.query<{ exists: number }>(
        'SELECT 1 AS exists FROM users WHERE LOWER(pseudonym) = $1 LIMIT 1',
        [pseudonymLower],
      );
      if ((existingPseudonymRes.rowCount ?? 0) > 0) {
        throw new ApiError(
          409,
          'AUTH_PSEUDONYM_TAKEN',
          'This pseudonym is already taken.',
        );
      }

      const existingEmailRes = await app.pool.query<{ exists: number }>(
        'SELECT 1 AS exists FROM users WHERE LOWER(email) = $1 OR canonical_email_hash = $2 LIMIT 1',
        [emailLower, canonicalEmailHash],
      );
      if ((existingEmailRes.rowCount ?? 0) > 0) {
        throw new ApiError(
          409,
          'AUTH_EMAIL_TAKEN',
          'This email address is already registered.',
        );
      }

      const passwordHash = await hashPassword(body.password, app.authSemaphore);
      const verifyToken = generateEmailActionToken();
      const verifyTokenHash = hashOpaqueToken(verifyToken);

      const client = await app.pool.connect();
      let createdUser:
        | { id: string; pseudonym: string; email: string }
        | undefined;
      try {
        await client.query('BEGIN');
        await assertPseudonymNotReserved(
          client,
          app.config.tombstoneSecret,
          pseudonymLower,
        );
        await assertEmailNotReserved(client, app.config.tombstoneSecret, emailLower);

        try {
          const insertRes = await client.query<{
            id: string;
            pseudonym: string;
            email: string;
          }>(
            `INSERT INTO users (
               pseudonym,
               email,
               canonical_email_hash,
               password_hash,
               privacy_accepted_at,
               terms_accepted_at,
               role
             )
             VALUES ($1, $2, $3, $4, clock_timestamp(), clock_timestamp(), 'user')
             RETURNING id, pseudonym, email`,
            [body.pseudonym, emailLower, canonicalEmailHash, passwordHash],
          );
          createdUser = insertRes.rows[0];
        } catch (err: unknown) {
          const errRec =
            typeof err === 'object' && err !== null
              ? (err as { code?: unknown; constraint?: unknown })
              : {};
          if (errRec.code === '23505') {
            if (
              typeof errRec.constraint === 'string' &&
              errRec.constraint.includes('email')
            ) {
              throw new ApiError(
                409,
                'AUTH_EMAIL_TAKEN',
                'This email address is already registered.',
              );
            }
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

        await client.query(
          `INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at)
           VALUES (
             $1,
             'verify_email',
             $2,
             clock_timestamp() + make_interval(hours => $3)
           )`,
          [createdUser.id, verifyTokenHash, AUTH_LIMITS.EMAIL_VERIFY_TTL_HOURS],
        );

        await client.query('COMMIT');
        registerSubnetTracker.recordFailure(subnetKey, Date.now());
      } catch (err: unknown) {
        await rollbackQuietly(client, request.log);
        throw err;
      } finally {
        client.release();
      }

      const verifyUrl = `${app.config.publicBaseUrl}/auth/verify-email?token=${encodeURIComponent(verifyToken)}`;
      try {
        await app.mailer.sendActionEmail({
          to: createdUser.email,
          pseudonym: createdUser.pseudonym,
          purpose: 'verify_email',
          actionUrl: verifyUrl,
        });
      } catch (mailErr: unknown) {
        request.log.error(
          { err: mailErr, userId: createdUser.id },
          'Failed to dispatch initial registration verification email',
        );
      }

      const payload = RegisterResponseSchema.parse({
        status: 'verification_email_sent',
        pseudonym: createdUser.pseudonym,
        email: createdUser.email,
      });

      return reply.status(201).send(payload);
    },
  );

  app.post(
    '/api/v1/auth/resend-verification',
    {
      config: {
        rateLimit: recoverLimit,
      },
    },
    async (request, reply) => {
      const body = EmailActionRequestSchema.parse(request.body);
      const emailLower = body.email.toLowerCase();

      const userRes = await app.pool.query<{
        id: string;
        pseudonym: string;
        email: string;
        email_verified_at: Date | null;
      }>(
        `SELECT id, pseudonym, email, email_verified_at
         FROM users
         WHERE LOWER(email) = $1
         LIMIT 1`,
        [emailLower],
      );
      const userRow = userRes.rows[0];

      if (userRow && userRow.email_verified_at === null) {
        const verifyToken = generateEmailActionToken();
        const verifyTokenHash = hashOpaqueToken(verifyToken);

        const client = await app.pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            `DELETE FROM email_tokens
             WHERE user_id = $1
               AND purpose = 'verify_email'
               AND consumed_at IS NULL`,
            [userRow.id],
          );
          await client.query(
            `INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at)
             VALUES (
               $1,
               'verify_email',
               $2,
               clock_timestamp() + make_interval(hours => $3)
             )`,
            [userRow.id, verifyTokenHash, AUTH_LIMITS.EMAIL_VERIFY_TTL_HOURS],
          );
          await client.query('COMMIT');

          const verifyUrl = `${app.config.publicBaseUrl}/auth/verify-email?token=${encodeURIComponent(verifyToken)}`;
          await app.mailer.sendActionEmail({
            to: userRow.email,
            pseudonym: userRow.pseudonym,
            purpose: 'verify_email',
            actionUrl: verifyUrl,
          });
        } catch (err: unknown) {
          await rollbackQuietly(client, request.log);
          request.log.error(
            { err },
            'Failed to resend verification email link',
          );
        } finally {
          client.release();
        }
      }

      return reply.status(202).send(
        EmailActionResponseSchema.parse({
          status: 'ok',
          message:
            'If an unverified account exists for this email address, a new confirmation link has been sent.',
        }),
      );
    },
  );

  app.post(
    '/api/v1/auth/verify-email',
    {
      config: {
        rateLimit: recoverLimit,
      },
    },
    async (request) => {
      const body = VerifyEmailRequestSchema.parse(request.body);
      const verified = await consumeVerifyEmailToken(
        app.pool,
        body.token,
        request.log,
      );
      return VerifyEmailResponseSchema.parse({
        status: 'verified',
        pseudonym: verified.pseudonym,
      });
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
      const identifierLower = body.identifier.toLowerCase();
      const compositeKey = `${normalizeRateLimitIp(request.ip)}:${identifierLower}`;
      const nowMs = Date.now();

      failedLoginTracker.assertAllowed(compositeKey, nowMs);

      const userRes = await app.pool.query<UserAuthRow>(
        `SELECT
           id,
           pseudonym,
           email,
           email_verified_at,
           role,
           password_hash,
           created_at
         FROM users
         WHERE LOWER(pseudonym) = $1
            OR LOWER(email) = $1
         LIMIT 1`,
        [identifierLower],
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
          'Invalid username/email or password.',
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
          'Invalid username/email or password.',
        );
      }

      if (userRow.email !== null && userRow.email_verified_at === null) {
        throw new ApiError(
          403,
          'AUTH_EMAIL_UNVERIFIED',
          'Please confirm your email address via the link sent to your inbox before signing in.',
          { email: userRow.email },
        );
      }

      failedLoginTracker.clear(compositeKey);

      const session = await createSession(
        app.pool,
        userRow.id,
        app.config.sessionTtlDays,
      );

      return SessionResponseSchema.parse({
        user: {
          id: userRow.id,
          pseudonym: userRow.pseudonym,
          email: userRow.email,
          role: userRow.role === 'admin' ? 'admin' : 'user',
          createdAt: userRow.created_at.toISOString(),
        },
        sessionToken: session.sessionToken,
        expiresAt: session.expiresAt,
      });
    },
  );

  app.post(
    '/api/v1/auth/forgot-password',
    {
      config: {
        rateLimit: recoverLimit,
      },
    },
    async (request, reply) => {
      const body = EmailActionRequestSchema.parse(request.body);
      const emailLower = body.email.toLowerCase();

      const userRes = await app.pool.query<{
        id: string;
        pseudonym: string;
        email: string;
      }>(
        `SELECT id, pseudonym, email
         FROM users
         WHERE LOWER(email) = $1
         LIMIT 1`,
        [emailLower],
      );
      const userRow = userRes.rows[0];

      if (userRow) {
        const resetToken = generateEmailActionToken();
        const resetTokenHash = hashOpaqueToken(resetToken);

        const client = await app.pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            `DELETE FROM email_tokens
             WHERE user_id = $1
               AND purpose = 'reset_password'
               AND consumed_at IS NULL`,
            [userRow.id],
          );
          await client.query(
            `INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at)
             VALUES (
               $1,
               'reset_password',
               $2,
               clock_timestamp() + make_interval(mins => $3)
             )`,
            [
              userRow.id,
              resetTokenHash,
              AUTH_LIMITS.PASSWORD_RESET_TTL_MINUTES,
            ],
          );
          await client.query('COMMIT');

          const resetUrl = `${app.config.publicBaseUrl}/auth/reset-password?token=${encodeURIComponent(resetToken)}`;
          await app.mailer.sendActionEmail({
            to: userRow.email,
            pseudonym: userRow.pseudonym,
            purpose: 'reset_password',
            actionUrl: resetUrl,
          });
        } catch (err: unknown) {
          await rollbackQuietly(client, request.log);
          request.log.error(
            { err },
            'Failed to dispatch password reset email link',
          );
        } finally {
          client.release();
        }
      }

      return reply.status(202).send(
        EmailActionResponseSchema.parse({
          status: 'ok',
          message:
            'If an account exists for this email address, a password recovery link has been sent.',
        }),
      );
    },
  );

  app.post(
    '/api/v1/auth/reset-password',
    {
      config: {
        rateLimit: recoverLimit,
      },
    },
    async (request) => {
      const body = ResetPasswordRequestSchema.parse(request.body);
      await consumePasswordResetToken(
        app.pool,
        app.authSemaphore,
        body.token,
        body.newPassword,
        request.log,
      );
      return ResetPasswordResponseSchema.parse({
        status: 'password_reset',
      });
    },
  );

  app.post(
    '/api/v1/auth/logout',
    {
      preHandler: requireAuth,
    },
    async (request, reply) => {
      const auth = request.auth!;
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
      return AuthUserSchema.parse(request.auth!.user);
    },
  );

  // GDPR Art. 15 (access) & Art. 20 (portability): self-service data download
  app.get(
    '/api/v1/auth/me/export',
    {
      preHandler: requireAuth,
      config: {
        rateLimit: deleteAccountLimit,
      },
    },
    async (request, reply) => {
      const data = await collectUserData(app.pool, request.auth!.user.id, {
        publicBaseUrl: app.config.publicBaseUrl,
      });
      const datePart = data.exportedAt.slice(0, 10);
      return reply
        .header('Cache-Control', 'no-store')
        .header(
          'Content-Disposition',
          `attachment; filename="unseal-data-export-${datePart}.json"`,
        )
        .send(data);
    },
  );

  app.delete(
    '/api/v1/auth/me',
    {
      preHandler: requireAuth,
      config: {
        rateLimit: deleteAccountLimit,
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { purgeContent } = DeleteAccountQuerySchema.parse(request.query ?? {});
      const client = await app.pool.connect();
      let deletedPhotoFiles: string[] = [];
      try {
        await client.query('BEGIN');
        const result = await deleteOrBanUserAccount(client, {
          userId: auth.user.id,
          pseudonymLower: auth.user.pseudonym.toLowerCase(),
          mode: purgeContent ? 'self_delete_purge' : 'self_delete',
          tombstoneSecret: app.config.tombstoneSecret,
        });
        deletedPhotoFiles = result.deletedPhotoFiles;
        await client.query('COMMIT');
      } catch (err: unknown) {
        await rollbackQuietly(client, request.log);
        throw err;
      } finally {
        client.release();
      }
      await unlinkUploadFiles(app.config.uploadsDir, deletedPhotoFiles);
      return reply.status(204).send();
    },
  );
}
