// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 OpenUnseal Contributors

import {
  AUTH_LIMITS,
  ApiError,
  AuthUserSchema,
  type AuthUser,
} from '@openunseal/shared';

import {
  generateSessionToken,
  hashOpaqueToken,
  verifyOpaqueToken,
} from './crypto.js';

import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';

export interface AuthenticatedContext {
  user: AuthUser;
  sessionId: string;
}

export interface CreatedSession {
  sessionId: string;
  sessionToken: string;
  expiresAt: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthenticatedContext | null;
  }
}

interface SessionLookupRow {
  session_id: string;
  token_hash: Buffer;
  user_id: string;
  pseudonym: string;
  email: string | null;
  email_verified_at: Date | null;
  last_login_at: Date | null;
  role: string;
  created_at: Date;
}

// Activity is stored with day precision only (GDPR Art. 5(1)(c)), so at most one
// write per user and day is needed.
const LAST_ACTIVITY_REFRESH_MS = 24 * 60 * 60 * 1000;

interface InsertedSessionRow {
  id: string;
  expires_at: Date;
}

function isPgPool(db: pg.Pool | pg.PoolClient): db is pg.Pool {
  return 'totalCount' in db && typeof db.connect === 'function';
}

function extractBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) {
    return null;
  }
  const trimmed = authorizationHeader.trim();
  const match = /^Bearer\s+(\S+)$/i.exec(trimmed);
  if (!match || !match[1]) {
    return null;
  }
  return match[1];
}

async function createSessionWithClient(
  client: pg.PoolClient,
  userId: string,
  sessionTtlDays: number,
): Promise<CreatedSession> {
  await client.query(
    'DELETE FROM sessions WHERE user_id = $1 AND expires_at <= clock_timestamp()',
    [userId],
  );

  const sessionToken = generateSessionToken();
  const tokenHash = hashOpaqueToken(sessionToken);

  let inserted: InsertedSessionRow | undefined;
  try {
    const insertRes = await client.query<InsertedSessionRow>(
      `INSERT INTO sessions (user_id, token_hash, expires_at, created_at)
       VALUES ($1, $2, clock_timestamp() + make_interval(days => $3), clock_timestamp())
       RETURNING id, expires_at`,
      [userId, tokenHash, sessionTtlDays],
    );
    inserted = insertRes.rows[0];
  } catch (err: unknown) {
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err
        ? (err as { code?: unknown }).code
        : undefined;
    if (pgCode === '23503') {
      throw new ApiError(
        401,
        'AUTH_REQUIRED',
        'Authenticated account no longer exists.',
      );
    }
    throw err;
  }

  if (!inserted) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Failed to persist session.');
  }

  await client.query(
    `UPDATE users
     SET
       last_login_at = date_trunc('day', clock_timestamp()),
       failed_login_attempts = 0,
       login_blocked_at = NULL
     WHERE id = $1`,
    [userId],
  );

  await client.query(
    `DELETE FROM sessions
     WHERE user_id = $1
       AND id NOT IN (
         SELECT id
         FROM sessions
         WHERE user_id = $1
           AND expires_at > clock_timestamp()
         ORDER BY created_at DESC
         LIMIT $2
       )`,
    [userId, AUTH_LIMITS.MAX_SESSIONS_PER_USER],
  );

  return {
    sessionId: inserted.id,
    sessionToken,
    expiresAt: inserted.expires_at.toISOString(),
  };
}

export async function createSession(
  db: pg.Pool | pg.PoolClient,
  userId: string,
  sessionTtlDays: number = AUTH_LIMITS.SESSION_TTL_DAYS,
): Promise<CreatedSession> {
  if (!isPgPool(db)) {
    return createSessionWithClient(db, userId, sessionTtlDays);
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const created = await createSessionWithClient(client, userId, sessionTtlDays);
    await client.query('COMMIT');
    return created;
  } catch (err: unknown) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr: unknown) {
      if (err instanceof Error && !('rollbackError' in err)) {
        Object.assign(err, { rollbackError: rollbackErr });
      }
    }
    throw err;
  } finally {
    client.release();
  }
}

async function resolveSessionFromRequest(
  request: FastifyRequest,
): Promise<AuthenticatedContext | null> {
  const rawToken = extractBearerToken(request.headers.authorization);
  if (!rawToken) {
    return null;
  }

  const tokenHash = hashOpaqueToken(rawToken);
  const res = await request.server.pool.query<SessionLookupRow>(
    `SELECT
       s.id AS session_id,
       s.token_hash,
       u.id AS user_id,
       u.pseudonym,
       u.email,
       u.email_verified_at,
       u.last_login_at,
       u.role,
       u.created_at
     FROM sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1
       AND s.expires_at > clock_timestamp()
     LIMIT 1`,
    [tokenHash],
  );

  const row = res.rows[0];
  if (!row || !verifyOpaqueToken(rawToken, row.token_hash)) {
    return null;
  }

  if (row.email !== null && row.email_verified_at === null) {
    return null;
  }

  if (
    row.last_login_at === null ||
    Date.now() - row.last_login_at.getTime() >= LAST_ACTIVITY_REFRESH_MS
  ) {
    await request.server.pool.query(
      `UPDATE users
       SET last_login_at = date_trunc('day', clock_timestamp())
       WHERE id = $1
         AND (
           last_login_at IS NULL
           OR last_login_at < date_trunc('day', clock_timestamp())
         )`,
      [row.user_id],
    );
  }

  const user = AuthUserSchema.parse({
    id: row.user_id,
    pseudonym: row.pseudonym,
    email: row.email,
    role: row.role === 'admin' ? 'admin' : 'user',
    createdAt: row.created_at.toISOString(),
  });

  return {
    user,
    sessionId: row.session_id,
  };
}

export async function optionalAuth(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  request.auth = await resolveSessionFromRequest(request);
}

export async function requireAuth(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const authContext = await resolveSessionFromRequest(request);
  if (!authContext) {
    throw new ApiError(
      401,
      'AUTH_REQUIRED',
      'Valid bearer session token is required.',
    );
  }
  request.auth = authContext;
}

export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await requireAuth(request, reply);
  if (request.auth?.user.role !== 'admin') {
    throw new ApiError(
      403,
      'FORBIDDEN_ADMIN_ONLY',
      'Administrator privileges are required for this action.',
    );
  }
}
