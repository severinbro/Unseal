// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Unseal Contributors

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import {
  ApiErrorEnvelopeSchema,
  AuthUserSchema,
  EmailActionResponseSchema,
  RegisterResponseSchema,
  ResetPasswordResponseSchema,
  SessionResponseSchema,
  VerifyEmailResponseSchema,
  normalizeRecoveryCode,
} from '@entsiegelung/shared';

import { buildApp, createMemoryMailer } from '../src/app.js';
import {
  generateEmailActionToken,
  generateRecoveryCode,
  generateSessionToken,
  hashCanonicalEmail,
  hashEmailTombstone,
  hashOpaqueToken,
  hashPassword,
  hashPseudonymTombstone,
  legacyEmailTombstoneDigest,
  legacyPseudonymTombstoneDigest,
  verifyPassword,
} from '../src/auth/crypto.js';
import { rekeyCanonicalEmailHashes } from '../src/auth/tombstones.js';
import { purgeExpiredPersonalData } from '../src/db/retention.js';
import {
  createSession,
  optionalAuth,
  requireAdmin,
  requireAuth,
} from '../src/auth/session.js';
import { DEV_TOMBSTONE_SECRET, loadEnvConfig } from '../src/config.js';
import {
  deleteOrBanUserAccount,
  lockUserForWrite,
  recomputePolygonScores,
} from '../src/db/integrity.js';
import { resetTestDb, setupTestDb } from '../src/db/testHarness.js';
import { createLogger } from '../src/logger.js';
import { BoundedSemaphore } from '../src/util/semaphore.js';

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

const SAMPLE_POLYGON_WKT =
  'POLYGON((9.9930 53.5510, 9.9933 53.5510, 9.9933 53.5513, 9.9930 53.5513, 9.9930 53.5510))';

function extractTokenFromActionUrl(actionUrl: string): string {
  const parsed = new URL(actionUrl);
  const token = parsed.searchParams.get('token');
  assert.ok(token && token.length >= 32, `Missing token in URL: ${actionUrl}`);
  return token;
}

async function registerVerifiedUser(
  app: FastifyInstance,
  pseudonym: string,
  password: string,
  remoteAddress: string,
): Promise<{
  userId: string;
  pseudonym: string;
  email: string;
  sessionToken: string;
}> {
  const email = `${pseudonym.toLowerCase()}@example.org`;
  const regRes = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    remoteAddress,
    payload: {
      pseudonym,
      email,
      password,
      acceptedPrivacyPolicy: true,
      acceptedTerms: true,
    },
  });
  assert.equal(regRes.statusCode, 201);
  RegisterResponseSchema.parse(regRes.json());

  await app.pool.query(
    'UPDATE users SET email_verified_at = clock_timestamp() WHERE LOWER(email) = $1',
    [email],
  );

  const loginRes = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    remoteAddress,
    payload: {
      identifier: pseudonym,
      password,
    },
  });
  assert.equal(loginRes.statusCode, 200);
  const session = SessionResponseSchema.parse(loginRes.json());
  return {
    userId: session.user.id,
    pseudonym: session.user.pseudonym,
    email,
    sessionToken: session.sessionToken,
  };
}

describe('PPGIS-3 + V2 Auth: Email confirmation & password recovery links, hosted pages, session eviction, and GDPR tombstoned deletion', () => {
  let pool: pg.Pool;

  before(async () => {
    pool = await setupTestDb();
  });

  beforeEach(async () => {
    await resetTestDb(pool);
  });

  after(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it('purgeExpiredPersonalData erases abandoned registrations, expired sessions, stale email links and expired pseudonym reservations but keeps bans', async () => {
    const passwordHash = await hashPassword('valid-password-123');
    const usersRes = await pool.query<{ id: string; pseudonym: string }>(
      `INSERT INTO users (pseudonym, email, password_hash, email_verified_at, login_blocked_at, failed_login_attempts, created_at)
       VALUES
         ('AbandonedSignup', 'abandoned@example.org', $1, NULL, NULL, 0, NOW() - INTERVAL '3 days'),
         ('FreshSignup', 'fresh@example.org', $1, NULL, NULL, 0, NOW() - INTERVAL '1 hour'),
         ('ActiveCitizen', 'active@example.org', $1, NOW() - INTERVAL '10 days', NULL, 0, NOW() - INTERVAL '10 days'),
         ('LockedCitizen', 'locked@example.org', $1, NOW() - INTERVAL '20 days', NOW() - INTERVAL '5 days', 5, NOW() - INTERVAL '20 days')
       RETURNING id, pseudonym`,
      [passwordHash],
    );
    const idOf = (name: string): string =>
      usersRes.rows.find((r) => r.pseudonym === name)!.id;

    await pool.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() - INTERVAL '1 day'), ($1, $3, NOW() + INTERVAL '1 day')`,
      [idOf('ActiveCitizen'), Buffer.alloc(32, 1), Buffer.alloc(32, 2)],
    );
    await pool.query(
      `INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at, consumed_at, created_at)
       VALUES
         ($1, 'reset_password', $2, NOW() - INTERVAL '19 days', NOW() - INTERVAL '19 days', NOW() - INTERVAL '20 days'),
         ($1, 'reset_password', $3, NOW() - INTERVAL '8 days', NULL, NOW() - INTERVAL '9 days'),
         ($1, 'reset_password', $4, NOW() + INTERVAL '1 hour', NULL, NOW())`,
      [idOf('ActiveCitizen'), Buffer.alloc(32, 3), Buffer.alloc(32, 4), Buffer.alloc(32, 5)],
    );
    await pool.query(
      `INSERT INTO reserved_pseudonyms (pseudonym_hash, reason, created_at)
       VALUES
         ($1, 'self_deleted', NOW() - INTERVAL '400 days'),
         ($2, 'self_deleted', NOW() - INTERVAL '10 days'),
         ($3, 'spam', NOW() - INTERVAL '900 days')`,
      [
        hashPseudonymTombstone(DEV_TOMBSTONE_SECRET, 'old_leaver'),
        hashPseudonymTombstone(DEV_TOMBSTONE_SECRET, 'recent_leaver'),
        hashPseudonymTombstone(DEV_TOMBSTONE_SECRET, 'old_spammer'),
      ],
    );

    const result = await purgeExpiredPersonalData(pool, { pseudonymReservationDays: 365 });
    assert.deepEqual(result, {
      unverifiedUsers: 1,
      expiredSessions: 1,
      staleEmailTokens: 2,
      expiredPseudonymReservations: 1,
    });

    const remainingUsers = await pool.query<{ pseudonym: string }>(
      'SELECT pseudonym FROM users ORDER BY pseudonym',
    );
    assert.deepEqual(
      remainingUsers.rows.map((r) => r.pseudonym),
      ['ActiveCitizen', 'FreshSignup', 'LockedCitizen'],
    );
    const remainingReasons = await pool.query<{ reason: string }>(
      'SELECT reason FROM reserved_pseudonyms ORDER BY reason',
    );
    assert.deepEqual(
      remainingReasons.rows.map((r) => r.reason),
      ['self_deleted', 'spam'],
    );
    // Idempotent
    assert.deepEqual(await purgeExpiredPersonalData(pool, { pseudonymReservationDays: 365 }), {
      unverifiedUsers: 0,
      expiredSessions: 0,
      staleEmailTokens: 0,
      expiredPseudonymReservations: 0,
    });
  });

  it('re-keys legacy SHA-256 canonical email hashes with the HMAC secret at startup and leaves NULL hashes untouched', async () => {
    const passwordHash = await hashPassword('valid-password-123');
    const legacyRes = await pool.query<{ id: string }>(
      `INSERT INTO users (pseudonym, email, canonical_email_hash, password_hash, email_verified_at)
       VALUES ('LegacyHashUser', 'legacy.user+tag@gmail.com', $1, $2, NOW())
       RETURNING id`,
      [legacyEmailTombstoneDigest('legacyuser@gmail.com'), passwordHash],
    );
    const nullRes = await pool.query<{ id: string }>(
      `INSERT INTO users (pseudonym, email, canonical_email_hash, password_hash, email_verified_at)
       VALUES ('PreCanonicalUser', 'pre.canonical@example.org', NULL, $1, NOW())
       RETURNING id`,
      [passwordHash],
    );

    assert.equal(await rekeyCanonicalEmailHashes(pool, DEV_TOMBSTONE_SECRET), 1);
    // Idempotent: a second run changes nothing
    assert.equal(await rekeyCanonicalEmailHashes(pool, DEV_TOMBSTONE_SECRET), 0);

    const rows = await pool.query<{ id: string; canonical_email_hash: Buffer | null }>(
      'SELECT id, canonical_email_hash FROM users WHERE id = ANY($1::uuid[])',
      [[legacyRes.rows[0]!.id, nullRes.rows[0]!.id]],
    );
    const byId = new Map(rows.rows.map((r) => [r.id, r.canonical_email_hash]));
    assert.deepEqual(
      byId.get(legacyRes.rows[0]!.id),
      hashCanonicalEmail(DEV_TOMBSTONE_SECRET, 'legacy.user+tag@gmail.com'),
    );
    assert.equal(byId.get(nullRes.rows[0]!.id), null);
  });

  it('generates URL-safe email action tokens, session tokens, keyed HMAC pseudonym/email tombstones, and Argon2id hashes', async () => {
    const emailToken = generateEmailActionToken();
    assert.ok(emailToken.length >= 40);
    assert.equal(Buffer.from(emailToken, 'base64url').byteLength, 32);

    const recoveryCode = generateRecoveryCode();
    assert.equal(recoveryCode.length, 39);
    assert.equal(normalizeRecoveryCode(recoveryCode).length, 32);

    const sessionToken = generateSessionToken();
    assert.equal(Buffer.from(sessionToken, 'base64url').byteLength, 32);

    const tokenDigest = hashOpaqueToken(sessionToken);
    assert.equal(tokenDigest.byteLength, 32);

    const tombstoneLower = hashPseudonymTombstone(DEV_TOMBSTONE_SECRET, 'mapper_one');
    const tombstoneMixed = hashPseudonymTombstone(DEV_TOMBSTONE_SECRET, 'Mapper_One');
    assert.equal(tombstoneLower.byteLength, 32);
    assert.deepEqual(tombstoneLower, tombstoneMixed);

    const emailHashA = hashEmailTombstone(DEV_TOMBSTONE_SECRET, '  User@Example.ORG ');
    const emailHashB = hashEmailTombstone(DEV_TOMBSTONE_SECRET, 'user@example.org');
    assert.equal(emailHashA.byteLength, 32);
    assert.deepEqual(emailHashA, emailHashB);

    // Tombstones are keyed (HMAC): unlike the legacy unsalted SHA-256 they cannot
    // be confirmed by hashing a known pseudonym/email without the server secret.
    const otherSecret = 'another-tombstone-secret-0123456789abcdef';
    assert.notDeepEqual(hashPseudonymTombstone(otherSecret, 'mapper_one'), tombstoneLower);
    assert.notDeepEqual(legacyPseudonymTombstoneDigest('mapper_one'), tombstoneLower);
    assert.notDeepEqual(hashEmailTombstone(otherSecret, 'user@example.org'), emailHashA);
    assert.notDeepEqual(legacyEmailTombstoneDigest('user@example.org'), emailHashA);

    const sem = new BoundedSemaphore(2, 4, 'AUTH_BUSY');
    const phc = await hashPassword('correct-horse-battery', sem);
    assert.match(phc, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    assert.equal(await verifyPassword(phc, 'correct-horse-battery', sem), true);
    assert.equal(await verifyPassword(phc, 'wrong-password-123', sem), false);
  });

  it('rejects reserved "deleted", active duplicate pseudonyms/emails, banned pseudonyms/emails, and enforces email link verification before login', async () => {
    const config = loadEnvConfig({
      PUBLIC_BASE_URL: 'https://map.example.org',
      ABUSE_CONTACT: 'privacy@example.org',
    });
    const mailer = createMemoryMailer();
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
      mailer,
    });

    try {
      // Privacy policy page is publicly accessible
      const privacyRes = await app.inject({
        method: 'GET',
        url: '/auth/privacy',
      });
      assert.equal(privacyRes.statusCode, 200);
      assert.match(String(privacyRes.headers['content-type']), /text\/html/);
      assert.ok(privacyRes.body.includes('Datenschutzerklärung'));
      assert.ok(privacyRes.body.includes('privacy@example.org'));

      // Reserved "deleted" and "Deleted" -> 409 AUTH_PSEUDONYM_TAKEN
      for (const reservedName of ['deleted', 'Deleted', 'DELETED']) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/register',
          remoteAddress: '198.51.100.10',
          payload: {
            pseudonym: reservedName,
            email: 'reserved@example.org',
            password: 'valid-password-123',
            acceptedPrivacyPolicy: true,
            acceptedTerms: true,
          },
        });
        assert.equal(res.statusCode, 409);
        assert.equal(
          ApiErrorEnvelopeSchema.parse(res.json()).error.code,
          'AUTH_PSEUDONYM_TAKEN',
        );
      }

      // Seed banned pseudonym & banned email -> 403 FORBIDDEN_PSEUDONYM_BANNED
      await pool.query(
        'INSERT INTO reserved_pseudonyms (pseudonym_hash, reason) VALUES ($1, $2)',
        [hashPseudonymTombstone(DEV_TOMBSTONE_SECRET, 'banned_vandal'), 'vandalism'],
      );
      await pool.query(
        'INSERT INTO reserved_emails (email_hash, reason) VALUES ($1, $2)',
        [hashEmailTombstone(DEV_TOMBSTONE_SECRET, 'vandal@example.org'), 'vandalism'],
      );
      // Rows written before keyed hashing (plain SHA-256) must keep blocking
      await pool.query(
        'INSERT INTO reserved_pseudonyms (pseudonym_hash, reason) VALUES ($1, $2)',
        [legacyPseudonymTombstoneDigest('legacy_vandal'), 'vandalism'],
      );
      await pool.query(
        'INSERT INTO reserved_emails (email_hash, reason) VALUES ($1, $2)',
        [legacyEmailTombstoneDigest('legacy.vandal@example.org'), 'vandalism'],
      );

      const bannedPseudoRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: '198.51.100.11',
        payload: {
          pseudonym: 'Banned_Vandal',
          email: 'clean@example.org',
          password: 'valid-password-123',
          acceptedPrivacyPolicy: true,
          acceptedTerms: true,
        },
      });
      assert.equal(bannedPseudoRes.statusCode, 403);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(bannedPseudoRes.json()).error.code,
        'FORBIDDEN_PSEUDONYM_BANNED',
      );

      const bannedEmailRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: '198.51.100.11',
        payload: {
          pseudonym: 'CleanAlias',
          email: 'Vandal@Example.org',
          password: 'valid-password-123',
          acceptedPrivacyPolicy: true,
          acceptedTerms: true,
        },
      });
      // Banned emails get the same generic response as a fresh registration
      // (no enumeration of banned/registered addresses), but nothing is created or sent.
      assert.equal(bannedEmailRes.statusCode, 201);
      assert.equal(
        RegisterResponseSchema.parse(bannedEmailRes.json()).status,
        'verification_email_sent',
      );
      const cleanAliasCount = await pool.query(
        "SELECT 1 FROM users WHERE LOWER(pseudonym) = 'cleanalias'",
      );
      assert.equal(cleanAliasCount.rowCount, 0);
      assert.equal(mailer.outbox.length, 0);

      const legacyPseudoRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: '198.51.100.11',
        payload: {
          pseudonym: 'Legacy_Vandal',
          email: 'fresh-one@example.org',
          password: 'valid-password-123',
          acceptedPrivacyPolicy: true,
          acceptedTerms: true,
        },
      });
      assert.equal(legacyPseudoRes.statusCode, 403);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(legacyPseudoRes.json()).error.code,
        'FORBIDDEN_PSEUDONYM_BANNED',
      );
      const legacyEmailRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: '198.51.100.11',
        payload: {
          pseudonym: 'FreshAlias',
          email: 'Legacy.Vandal@example.org',
          password: 'valid-password-123',
          acceptedPrivacyPolicy: true,
          acceptedTerms: true,
        },
      });
      assert.equal(legacyEmailRes.statusCode, 201);
      const freshAliasCount = await pool.query(
        "SELECT 1 FROM users WHERE LOWER(pseudonym) = 'freshalias'",
      );
      assert.equal(freshAliasCount.rowCount, 0, 'legacy email ban must still block');

      // Valid registration -> 201 verification_email_sent + email dispatched
      const regRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: '198.51.100.12',
        payload: {
          pseudonym: 'CourtyardMapper',
          email: 'Courtyard.Mapper@Example.org',
          password: 'valid-password-123',
          acceptedPrivacyPolicy: true,
          acceptedTerms: true,
        },
      });
      assert.equal(regRes.statusCode, 201);
      const regBody = RegisterResponseSchema.parse(regRes.json());
      assert.equal(regBody.status, 'verification_email_sent');
      assert.equal(regBody.pseudonym, 'CourtyardMapper');
      assert.equal(regBody.email, 'courtyard.mapper@example.org');

      assert.equal(mailer.outbox.length, 1);
      const firstEmail = mailer.outbox[0]!;
      assert.equal(firstEmail.to, 'courtyard.mapper@example.org');
      assert.equal(firstEmail.purpose, 'verify_email');
      assert.ok(
        firstEmail.actionUrl.startsWith(
          'https://map.example.org/auth/verify-email?token=',
        ),
      );
      const initialToken = extractTokenFromActionUrl(firstEmail.actionUrl);

      // Duplicate pseudonym -> 409 AUTH_PSEUDONYM_TAKEN (pseudonyms are public);
      // duplicate email -> generic 201 + "account exists" notice to the owner (no enumeration)
      const dupPseudo = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: '198.51.100.13',
        payload: {
          pseudonym: 'courtyardmapper',
          email: 'other@example.org',
          password: 'another-password-123',
          acceptedPrivacyPolicy: true,
          acceptedTerms: true,
        },
      });
      assert.equal(dupPseudo.statusCode, 409);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(dupPseudo.json()).error.code,
        'AUTH_PSEUDONYM_TAKEN',
      );

      const dupEmail = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: '198.51.100.13',
        payload: {
          pseudonym: 'AnotherMapper',
          email: 'courtyard.mapper@example.org',
          password: 'another-password-123',
          acceptedPrivacyPolicy: true,
          acceptedTerms: true,
        },
      });
      assert.equal(dupEmail.statusCode, 201);
      assert.deepEqual(RegisterResponseSchema.parse(dupEmail.json()), {
        status: 'verification_email_sent',
        pseudonym: 'AnotherMapper',
        email: 'courtyard.mapper@example.org',
      });
      const anotherMapperCount = await pool.query(
        "SELECT 1 FROM users WHERE LOWER(pseudonym) = 'anothermapper'",
      );
      assert.equal(anotherMapperCount.rowCount, 0);
      assert.equal(mailer.outbox.length, 2);
      const accountExistsNotice = mailer.outbox.pop()!;
      assert.equal(accountExistsNotice.purpose, 'account_exists');
      assert.equal(accountExistsNotice.to, 'courtyard.mapper@example.org');
      assert.equal(accountExistsNotice.pseudonym, 'CourtyardMapper');
      assert.equal(accountExistsNotice.actionUrl, 'https://map.example.org');

      // Attempting login BEFORE clicking confirmation link -> 403 AUTH_EMAIL_UNVERIFIED
      const unverifiedLogin = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: '198.51.100.12',
        payload: {
          identifier: 'CourtyardMapper',
          password: 'valid-password-123',
        },
      });
      assert.equal(unverifiedLogin.statusCode, 403);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(unverifiedLogin.json()).error.code,
        'AUTH_EMAIL_UNVERIFIED',
      );

      // Resend verification rotates token (invalidating initialToken) and sends new link
      const resendRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/resend-verification',
        remoteAddress: '198.51.100.12',
        payload: { email: 'courtyard.mapper@example.org' },
      });
      assert.equal(resendRes.statusCode, 202);
      EmailActionResponseSchema.parse(resendRes.json());
      assert.equal(mailer.outbox.length, 2);
      const rotatedToken = extractTokenFromActionUrl(mailer.outbox[1]!.actionUrl);
      assert.notEqual(rotatedToken, initialToken);

      // Old rotated token is rejected on GET /auth/verify-email (400)
      const staleGet = await app.inject({
        method: 'GET',
        url: `/auth/verify-email?token=${encodeURIComponent(initialToken)}`,
      });
      assert.equal(staleGet.statusCode, 400);

      // Scanner-safe GET /auth/verify-email renders form WITHOUT consuming rotatedToken
      const verifyPageGet = await app.inject({
        method: 'GET',
        url: `/auth/verify-email?token=${encodeURIComponent(rotatedToken)}`,
      });
      assert.equal(verifyPageGet.statusCode, 200);
      assert.equal(verifyPageGet.headers['referrer-policy'], 'no-referrer');
      assert.ok(verifyPageGet.body.includes('<form method="POST" action="/auth/verify-email">'));
      assert.ok(verifyPageGet.body.includes('CourtyardMapper'));

      // Submitting POST /auth/verify-email consumes rotatedToken and activates account
      const verifyPagePost = await app.inject({
        method: 'POST',
        url: '/auth/verify-email',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({ token: rotatedToken }).toString(),
      });
      assert.equal(verifyPagePost.statusCode, 200);
      assert.ok(verifyPagePost.body.includes('erfolgreich bestätigt'));

      // Replaying POST /auth/verify-email fails with 400
      const replayVerify = await app.inject({
        method: 'POST',
        url: '/auth/verify-email',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({ token: rotatedToken }).toString(),
      });
      assert.equal(replayVerify.statusCode, 400);

      // Login now succeeds by pseudonym AND by email address
      const loginByPseudo = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: '198.51.100.12',
        payload: {
          identifier: 'CourtyardMapper',
          password: 'valid-password-123',
        },
      });
      assert.equal(loginByPseudo.statusCode, 200);
      const sessionA = SessionResponseSchema.parse(loginByPseudo.json());
      assert.equal(sessionA.user.role, 'user');
      assert.equal(sessionA.user.email, 'courtyard.mapper@example.org');

      const loginByEmail = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: '198.51.100.12',
        payload: {
          identifier: 'COURTYARD.MAPPER@example.org',
          password: 'valid-password-123',
        },
      });
      assert.equal(loginByEmail.statusCode, 200);
      const sessionB = SessionResponseSchema.parse(loginByEmail.json());
      assert.equal(sessionB.user.id, sessionA.user.id);

      // Also verify JSON POST /api/v1/auth/verify-email endpoint directly
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: '198.51.100.14',
        payload: {
          pseudonym: 'JsonVerifier',
          email: 'jsonverifier@example.org',
          password: 'valid-password-123',
          acceptedPrivacyPolicy: true,
          acceptedTerms: true,
        },
      });
      const jsonToken = extractTokenFromActionUrl(mailer.outbox[2]!.actionUrl);
      const jsonVerifyRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/verify-email',
        remoteAddress: '198.51.100.14',
        payload: { token: jsonToken },
      });
      assert.equal(jsonVerifyRes.statusCode, 200);
      assert.equal(
        VerifyEmailResponseSchema.parse(jsonVerifyRes.json()).pseudonym,
        'JsonVerifier',
      );
    } finally {
      await app.close();
    }
  });

  it('handles forgot-password & hosted /auth/reset-password web form, validates password rules without burning token, and revokes prior sessions', async () => {
    const config = loadEnvConfig({
      PUBLIC_BASE_URL: 'https://map.example.org',
    });
    const mailer = createMemoryMailer();
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
      mailer,
    });

    try {
      const user = await registerVerifiedUser(
        app,
        'RecoverTester',
        'initial-password-123',
        '198.51.100.30',
      );
      mailer.clear();

      // Create a second active session
      const secondLogin = SessionResponseSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/auth/login',
            remoteAddress: '198.51.100.30',
            payload: {
              identifier: user.email,
              password: 'initial-password-123',
            },
          })
        ).json(),
      );

      // Request forgot-password for unknown email -> uniform 202, 0 emails sent
      const unknownForgot = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        remoteAddress: '198.51.100.31',
        payload: { email: 'nobody@example.org' },
      });
      assert.equal(unknownForgot.statusCode, 202);
      assert.equal(mailer.outbox.length, 0);

      // Request forgot-password for real email -> 202 + reset link dispatched
      const realForgot = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        remoteAddress: '198.51.100.31',
        payload: { email: user.email.toUpperCase() },
      });
      assert.equal(realForgot.statusCode, 202);
      assert.equal(mailer.outbox.length, 1);
      assert.equal(mailer.outbox[0]!.purpose, 'reset_password');
      const resetToken = extractTokenFromActionUrl(mailer.outbox[0]!.actionUrl);

      // Scanner-safe GET /auth/reset-password renders HTML form without consuming token
      const getResetPage = await app.inject({
        method: 'GET',
        url: `/auth/reset-password?token=${encodeURIComponent(resetToken)}`,
      });
      assert.equal(getResetPage.statusCode, 200);
      assert.ok(getResetPage.body.includes('<form method="POST" action="/auth/reset-password">'));

      // Mismatched confirmPassword returns 422 HTML WITHOUT consuming resetToken
      const mismatchPost = await app.inject({
        method: 'POST',
        url: '/auth/reset-password',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({
          token: resetToken,
          newPassword: 'updated-password-456',
          confirmPassword: 'different-password-789',
        }).toString(),
      });
      assert.equal(mismatchPost.statusCode, 422);

      // Short password returns 422 HTML WITHOUT consuming resetToken
      const shortPost = await app.inject({
        method: 'POST',
        url: '/auth/reset-password',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({
          token: resetToken,
          newPassword: 'short',
          confirmPassword: 'short',
        }).toString(),
      });
      assert.equal(shortPost.statusCode, 422);

      // Valid POST /auth/reset-password updates password, revokes prior sessions, and consumes token
      const validResetPost = await app.inject({
        method: 'POST',
        url: '/auth/reset-password',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({
          token: resetToken,
          newPassword: 'updated-password-456',
          confirmPassword: 'updated-password-456',
        }).toString(),
      });
      assert.equal(validResetPost.statusCode, 200);
      assert.ok(validResetPost.body.includes('erfolgreich geändert'));

      // Replaying consumed token fails on both HTML and JSON endpoints
      const replayHtml = await app.inject({
        method: 'POST',
        url: '/auth/reset-password',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({
          token: resetToken,
          newPassword: 'third-password-789',
          confirmPassword: 'third-password-789',
        }).toString(),
      });
      assert.equal(replayHtml.statusCode, 400);

      const replayJson = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        remoteAddress: '198.51.100.32',
        payload: {
          token: resetToken,
          newPassword: 'third-password-789',
        },
      });
      assert.equal(replayJson.statusCode, 400);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(replayJson.json()).error.code,
        'AUTH_TOKEN_INVALID',
      );

      // Both prior sessions are immediately revoked -> 401 AUTH_REQUIRED
      for (const oldToken of [user.sessionToken, secondLogin.sessionToken]) {
        const oldMe = await app.inject({
          method: 'GET',
          url: '/api/v1/auth/me',
          headers: { authorization: `Bearer ${oldToken}` },
        });
        assert.equal(oldMe.statusCode, 401);
      }

      // Old password fails, new password succeeds, and JSON /api/v1/auth/reset-password also works
      const oldPwLogin = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: '198.51.100.33',
        payload: {
          identifier: 'RecoverTester',
          password: 'initial-password-123',
        },
      });
      assert.equal(oldPwLogin.statusCode, 401);

      const newPwLogin = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: '198.51.100.33',
        payload: {
          identifier: 'RecoverTester',
          password: 'updated-password-456',
        },
      });
      assert.equal(newPwLogin.statusCode, 200);
      SessionResponseSchema.parse(newPwLogin.json());

      // Exercise JSON reset-password endpoint end-to-end
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        remoteAddress: '198.51.100.34',
        payload: { email: user.email },
      });
      const secondResetToken = extractTokenFromActionUrl(
        mailer.outbox[1]!.actionUrl,
      );
      const jsonResetRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        remoteAddress: '198.51.100.34',
        payload: {
          token: secondResetToken,
          newPassword: 'json-reset-password-999',
        },
      });
      assert.equal(jsonResetRes.statusCode, 200);
      ResetPasswordResponseSchema.parse(jsonResetRes.json());
    } finally {
      await app.close();
    }
  });

  it('DELETE /api/v1/auth/me tombstones pseudonym, erases email (GDPR Art. 17), anonymizes authored polygons, cascades votes, and recomputes scores immediately', async () => {
    const config = loadEnvConfig({});
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
      mailer: createMemoryMailer(),
    });

    try {
      const anna = await registerVerifiedUser(
        app,
        'MapperAnna',
        'anna-password-123',
        '198.51.100.20',
      );
      const ben = await registerVerifiedUser(
        app,
        'VoterBen',
        'ben-password-123',
        '198.51.100.21',
      );
      const clara = await registerVerifiedUser(
        app,
        'VoterClara',
        'clara-password-123',
        '198.51.100.22',
      );

      const polyAnnaRes = await pool.query<{ id: string }>(
        `INSERT INTO polygons (user_id, geom, surface_type, note, area_m2, upvotes, downvotes, score)
         VALUES ($1, ST_GeomFromText($2, 4326), 'asphalt', 'Anna lot', 85.0, 2, 0, 2)
         RETURNING id`,
        [anna.userId, SAMPLE_POLYGON_WKT],
      );
      const polyAnnaId = polyAnnaRes.rows[0]!.id;
      await pool.query(
        `INSERT INTO votes (polygon_id, user_id, value) VALUES ($1, $2, 1), ($1, $3, 1)`,
        [polyAnnaId, ben.userId, clara.userId],
      );

      const polyBenRes = await pool.query<{ id: string }>(
        `INSERT INTO polygons (user_id, geom, surface_type, note, area_m2, upvotes, downvotes, score)
         VALUES ($1, ST_GeomFromText($2, 4326), 'concrete', 'Ben courtyard', 110.0, 1, 1, 0)
         RETURNING id`,
        [ben.userId, SAMPLE_POLYGON_WKT],
      );
      const polyBenId = polyBenRes.rows[0]!.id;
      await pool.query(
        `INSERT INTO votes (polygon_id, user_id, value) VALUES ($1, $2, 1), ($1, $3, -1)`,
        [polyBenId, anna.userId, clara.userId],
      );

      const delRes = await app.inject({
        method: 'DELETE',
        url: '/api/v1/auth/me',
        remoteAddress: '198.51.100.20',
        headers: { authorization: `Bearer ${anna.sessionToken}` },
      });
      assert.equal(delRes.statusCode, 204);

      // Anna's pseudonym is tombstoned (409), while her erased email is NOT stored in reserved_emails
      const reRegSamePseudo = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: '198.51.100.25',
        payload: {
          pseudonym: 'mapperanna',
          email: 'new-anna@example.org',
          password: 'impersonator-password-123',
          acceptedPrivacyPolicy: true,
          acceptedTerms: true,
        },
      });
      assert.equal(reRegSamePseudo.statusCode, 409);

      const reservedEmailCnt = await pool.query<{ cnt: number }>(
        'SELECT COUNT(*)::int AS cnt FROM reserved_emails WHERE email_hash = $1',
        [hashEmailTombstone(DEV_TOMBSTONE_SECRET, anna.email)],
      );
      assert.equal(reservedEmailCnt.rows[0]?.cnt, 0);

      // Anna's polygon survived anonymized with score=2, Ben's dropped to -1
      const polyAnnaAfter = await pool.query<{
        user_id: string | null;
        score: number;
      }>('SELECT user_id, score FROM polygons WHERE id = $1', [polyAnnaId]);
      assert.deepEqual(polyAnnaAfter.rows[0], { user_id: null, score: 2 });

      const polyBenAfter = await pool.query<{ score: number }>(
        'SELECT score FROM polygons WHERE id = $1',
        [polyBenId],
      );
      assert.equal(polyBenAfter.rows[0]?.score, -1);

      // Banning Ben purges his polygon AND tombstones both pseudonym and email (403)
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await deleteOrBanUserAccount(client, {
          userId: ben.userId,
          pseudonymLower: 'voterben',
          mode: 'ban',
          reason: 'coordinated spam',
          tombstoneSecret: DEV_TOMBSTONE_SECRET,
        });
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      const reRegBenEmail = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: '198.51.100.26',
        payload: {
          pseudonym: 'DifferentPseudonym',
          email: ben.email,
          password: 'new-ben-password-123',
          acceptedPrivacyPolicy: true,
          acceptedTerms: true,
        },
      });
      // Banned email: generic 201 (no enumeration) but no account is created
      assert.equal(reRegBenEmail.statusCode, 201);
      const differentPseudonym = await pool.query(
        "SELECT 1 FROM users WHERE LOWER(pseudonym) = 'differentpseudonym'",
      );
      assert.equal(differentPseudonym.rowCount, 0);
    } finally {
      await app.close();
    }
  });

  it('enforces BoundedSemaphore 503 AUTH_BUSY, 11th login oldest-session eviction, logout, optionalAuth/requireAdmin, lock ordering, and rateLimits', async () => {
    const config = loadEnvConfig({});

    // 1. BoundedSemaphore queue overflow -> 503 AUTH_BUSY
    const tightSemaphore = new BoundedSemaphore(1, 0, 'AUTH_BUSY');
    const busyApp = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
      argon2Semaphore: tightSemaphore,
      mailer: createMemoryMailer(),
    });

    try {
      const target = await registerVerifiedUser(
        busyApp,
        'BusyTarget',
        'busy-password-123',
        '198.51.100.40',
      );

      const release = await tightSemaphore.acquire();
      try {
        const busyReg = await busyApp.inject({
          method: 'POST',
          url: '/api/v1/auth/register',
          remoteAddress: '198.51.100.41',
          payload: {
            pseudonym: 'BusyNewUser',
            email: 'busynew@example.org',
            password: 'busy-password-123',
            acceptedPrivacyPolicy: true,
            acceptedTerms: true,
          },
        });
        assert.equal(busyReg.statusCode, 503);
        assert.equal(
          ApiErrorEnvelopeSchema.parse(busyReg.json()).error.code,
          'AUTH_BUSY',
        );

        const busyLoginExisting = await busyApp.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          remoteAddress: '198.51.100.42',
          payload: {
            identifier: target.pseudonym,
            password: 'busy-password-123',
          },
        });
        assert.equal(busyLoginExisting.statusCode, 503);

        const busyLoginUnknown = await busyApp.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          remoteAddress: '198.51.100.43',
          payload: {
            identifier: 'GhostMapper',
            password: 'busy-password-123',
          },
        });
        assert.equal(busyLoginUnknown.statusCode, 503);
      } finally {
        release();
      }
    } finally {
      await busyApp.close();
    }

    // 2. 11th session eviction + logout + optionalAuth/requireAdmin + 5-failed-attempts account lockout & re-verification + lock ordering
    const lockoutMailer = createMemoryMailer();
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
      mailer: lockoutMailer,
      rateLimits: {
        loginIp: { max: 50, timeWindow: '15 minutes' },
      },
    });

    app.get(
      '/api/v1/test-optional-auth',
      { preHandler: optionalAuth },
      async (req) => ({
        userId: req.auth?.user.id ?? null,
      }),
    );
    app.get(
      '/api/v1/test-require-auth',
      { preHandler: requireAuth },
      async (req) => ({
        userId: req.auth!.user.id,
      }),
    );
    app.get(
      '/api/v1/test-require-admin',
      { preHandler: requireAdmin },
      async (req) => ({
        role: req.auth!.user.role,
      }),
    );

    try {
      const multi = await registerVerifiedUser(
        app,
        'MultiDevice',
        'device-password-123',
        '203.0.113.10',
      );

      // Non-admin receives 403 FORBIDDEN_ADMIN_ONLY on requireAdmin route
      const nonAdminRes = await app.inject({
        method: 'GET',
        url: '/api/v1/test-require-admin',
        headers: { authorization: `Bearer ${multi.sessionToken}` },
      });
      assert.equal(nonAdminRes.statusCode, 403);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(nonAdminRes.json()).error.code,
        'FORBIDDEN_ADMIN_ONLY',
      );

      // multi.sessionToken is session #1; perform 10 more logins (total 11 sessions)
      const tokens: string[] = [multi.sessionToken];
      for (let i = 0; i < 10; i += 1) {
        const loginRes = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          remoteAddress: '203.0.113.10',
          payload: {
            identifier: 'MultiDevice',
            password: 'device-password-123',
          },
        });
        assert.equal(loginRes.statusCode, 200);
        tokens.push(SessionResponseSchema.parse(loginRes.json()).sessionToken);
      }

      const sessionCntRes = await pool.query<{ cnt: number }>(
        'SELECT COUNT(*)::int AS cnt FROM sessions WHERE user_id = $1',
        [multi.userId],
      );
      assert.equal(sessionCntRes.rows[0]?.cnt, 10);

      // Oldest session evicted -> 401; newer sessions valid -> 200
      const evictedRes = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${tokens[0]!}` },
      });
      assert.equal(evictedRes.statusCode, 401);

      const activeMe = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${tokens[2]!}` },
      });
      assert.equal(activeMe.statusCode, 200);
      assert.equal(AuthUserSchema.parse(activeMe.json()).pseudonym, 'MultiDevice');

      // Logout revokes tokens[1]
      const logoutRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: { authorization: `Bearer ${tokens[1]!}` },
      });
      assert.equal(logoutRes.statusCode, 204);

      // 5 failed login attempts block the account and require email re-verification
      lockoutMailer.clear();
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const failRes = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          remoteAddress: `2001:db8:cafe:42::${attempt}`,
          payload: {
            identifier: attempt % 2 === 0 ? 'multidevice' : 'MultiDevice',
            password: 'wrong-password-attempt',
          },
        });
        assert.equal(failRes.statusCode, 401);
        assert.equal(
          ApiErrorEnvelopeSchema.parse(failRes.json()).error.code,
          'AUTH_INVALID_CREDENTIALS',
        );
      }
      assert.equal(lockoutMailer.outbox.length, 0);

      // 5th failed attempt blocks the account across ALL IPs and sends a reverify_login link
      const fifthRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: '2001:db8:cafe:99::5',
        payload: {
          identifier: 'MultiDevice',
          password: 'wrong-password-attempt',
        },
      });
      assert.equal(fifthRes.statusCode, 403);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(fifthRes.json()).error.code,
        'AUTH_ACCOUNT_LOCKED',
      );
      assert.equal(lockoutMailer.outbox.length, 1);
      assert.equal(lockoutMailer.outbox[0]?.purpose, 'reverify_login');
      assert.equal(lockoutMailer.outbox[0]?.to, multi.email);

      // Even with the CORRECT password (and from a different IP), sign-in remains blocked until re-verified
      const blockedCorrectPw = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: '198.51.100.88',
        payload: {
          identifier: 'MultiDevice',
          password: 'device-password-123',
        },
      });
      assert.equal(blockedCorrectPw.statusCode, 403);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(blockedCorrectPw.json()).error.code,
        'AUTH_ACCOUNT_LOCKED',
      );
      // Does not send duplicate emails on subsequent blocked attempts
      assert.equal(lockoutMailer.outbox.length, 1);

      // Resend verification by pseudonym rotates the unlock token cleanly
      const resendLocked = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/resend-verification',
        remoteAddress: '198.51.100.88',
        payload: { identifier: 'MultiDevice' },
      });
      assert.equal(resendLocked.statusCode, 202);
      assert.equal(lockoutMailer.outbox.length, 2);
      assert.equal(lockoutMailer.outbox[1]?.purpose, 'reverify_login');
      const reverifyToken = extractTokenFromActionUrl(
        lockoutMailer.outbox[1]!.actionUrl,
      );

      // Completing email verification unlocks the account and resets failed_login_attempts
      const unlockVerifyRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/verify-email',
        remoteAddress: '198.51.100.88',
        payload: { token: reverifyToken },
      });
      assert.equal(unlockVerifyRes.statusCode, 200);

      const unlockedLoginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: '198.51.100.88',
        payload: {
          identifier: 'MultiDevice',
          password: 'device-password-123',
        },
      });
      assert.equal(unlockedLoginRes.statusCode, 200);
      SessionResponseSchema.parse(unlockedLoginRes.json());

      // Probing a non-existent account is still rate-limited after 5 failures per IP/subnet + identifier
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const unknownFail = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          remoteAddress: `2001:db8:dead:beef::${attempt}`,
          payload: {
            identifier: 'nonexistent_probe_user',
            password: 'wrong-password-attempt',
          },
        });
        assert.equal(unknownFail.statusCode, 401);
      }
      const sixthUnknown = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: '2001:db8:dead:beef::9999',
        payload: {
          identifier: 'nonexistent_probe_user',
          password: 'wrong-password-attempt',
        },
      });
      assert.equal(sixthUnknown.statusCode, 429);

      // Concurrent lockUserForWrite + recomputePolygonScores vs DELETE /api/v1/auth/me
      const author = await registerVerifiedUser(
        app,
        'PolyAuthor',
        'author-password-123',
        '198.51.100.60',
      );
      const voter = await registerVerifiedUser(
        app,
        'RacingVoter',
        'voter-password-123',
        '198.51.100.61',
      );
      const p1Res = await pool.query<{ id: string }>(
        `INSERT INTO polygons (user_id, geom, surface_type, area_m2)
         VALUES ($1, ST_GeomFromText($2, 4326), 'asphalt', 90.0) RETURNING id`,
        [author.userId, SAMPLE_POLYGON_WKT],
      );
      const p1 = p1Res.rows[0]!.id;

      const simulatedVoteWrite = async (): Promise<void> => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await lockUserForWrite(client, voter.userId);
          await client.query('SELECT id FROM polygons WHERE id = $1 FOR UPDATE', [p1]);
          await client.query(
            `INSERT INTO votes (polygon_id, user_id, value)
             VALUES ($1, $2, 1)
             ON CONFLICT (polygon_id, user_id) DO UPDATE SET value = EXCLUDED.value`,
            [p1, voter.userId],
          );
          await recomputePolygonScores(client, [p1]);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          if ((err as { code?: string }).code === 'AUTH_REQUIRED') {
            return;
          }
          throw err;
        } finally {
          client.release();
        }
      };

      const [, deleteOutcome] = await Promise.all([
        simulatedVoteWrite(),
        app.inject({
          method: 'DELETE',
          url: '/api/v1/auth/me',
          remoteAddress: '198.51.100.61',
          headers: { authorization: `Bearer ${voter.sessionToken}` },
        }),
      ]);
      assert.equal(deleteOutcome.statusCode, 204);

      const directSession = await createSession(pool, multi.userId, 7);
      assert.ok(directSession.sessionToken.length > 20);
    } finally {
      await app.close();
    }
  });

  it('/auth/privacy describes the configured basemap, aerial imagery, processors and backup retention', async () => {
    const app = await buildApp(
      loadEnvConfig({
        OSM_STYLE_URL: 'https://maps.thirdparty.example/styles/basic.json',
        ORTHOPHOTO_URL_TEMPLATE: 'https://ortho.thirdparty.example/{z}/{x}/{y}.png',
        PRIVACY_HOSTING_PROVIDER: 'Beispiel Hosting GmbH, Nürnberg',
        PRIVACY_EMAIL_PROVIDER: 'Beispiel Mail AG, Berlin',
        BACKUP_RETENTION_DAYS: '21',
        PSEUDONYM_RESERVATION_DAYS: '180',
      }),
      pool,
      { logger: createLogger({ enabled: false }), mailer: createMemoryMailer() },
    );
    try {
      const res = await app.inject({ method: 'GET', url: '/auth/privacy' });
      assert.equal(res.statusCode, 200);
      const html = res.body;
      assert.match(html, /<code>maps\.thirdparty\.example<\/code>/);
      assert.equal(html.includes('OpenFreeMap'), false);
      assert.match(html, /<code>ortho\.thirdparty\.example<\/code>; dabei wird deine IP-Adresse/);
      assert.equal(html.includes('Luftbilder (DOP20)'), false);
      assert.match(html, /Beispiel Hosting GmbH, Nürnberg/);
      assert.match(html, /Beispiel Mail AG, Berlin/);
      assert.match(html, /nach 21 Tagen gelöscht/);
      assert.equal(html.includes('BACKUP_RETENTION_DAYS'), false);
      assert.match(html, /180 Tage/);
      assert.match(html, /@media \(prefers-color-scheme: dark\)/);
    } finally {
      await app.close();
    }

    const splitDarkHostApp = await buildApp(
      loadEnvConfig({
        OSM_DARK_STYLE_URL: 'https://darkmaps.thirdparty.example/styles/dark.json',
      }),
      pool,
      { logger: createLogger({ enabled: false }), mailer: createMemoryMailer() },
    );
    try {
      const res = await splitDarkHostApp.inject({
        method: 'GET',
        url: '/auth/privacy',
      });
      assert.equal(res.statusCode, 200);
      assert.match(res.body, /OpenFreeMap/);
      assert.match(res.body, /<code>darkmaps\.thirdparty\.example<\/code>/);
    } finally {
      await splitDarkHostApp.close();
    }

    const noOrthoApp = await buildApp(
      loadEnvConfig({ ORTHOPHOTO_URL_TEMPLATE: 'none' }),
      pool,
      { logger: createLogger({ enabled: false }), mailer: createMemoryMailer() },
    );
    try {
      const res = await noOrthoApp.inject({ method: 'GET', url: '/auth/privacy' });
      assert.match(res.body, /Luftbilder:<\/strong> Auf dieser Instanz deaktiviert/);
    } finally {
      await noOrthoApp.close();
    }
  });

  it('serves /auth/impressum, /auth/terms, /auth/licenses, updated /auth/privacy, persists terms_accepted_at, guards unconfigured bug-reports, and sets CC0 headers on GeoJSON export', async () => {
    // 1. Minimal config without OPERATOR_* or BUG_REPORT_TO -> Impressum notice + 503 on bug-reports
    const unconfiguredApp = await buildApp(loadEnvConfig({}), pool, {
      logger: createLogger({ enabled: false }),
      mailer: createMemoryMailer(),
    });
    try {
      const impEmptyRes = await unconfiguredApp.inject({
        method: 'GET',
        url: '/auth/impressum',
      });
      assert.equal(impEmptyRes.statusCode, 200);
      assert.match(impEmptyRes.body, /OPERATOR_NAME.*OPERATOR_ADDRESS.*OPERATOR_EMAIL/);

      const bugDisabledRes = await unconfiguredApp.inject({
        method: 'POST',
        url: '/api/v1/bug-reports',
        remoteAddress: '198.51.100.70',
        payload: {
          description: 'Bug report should be 503 when BUG_REPORT_TO and OPERATOR_EMAIL are unset.',
          platform: 'web',
        },
      });
      assert.equal(bugDisabledRes.statusCode, 503);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(bugDisabledRes.json()).error.code,
        'SERVICE_UNAVAILABLE',
      );
    } finally {
      await unconfiguredApp.close();
    }

    // 2. Configured operator identity -> Impressum, Privacy, Terms, Licenses, terms_accepted_at, CC0 headers
    const configuredApp = await buildApp(
      loadEnvConfig({
        PUBLIC_BASE_URL: 'https://unseal.example.org',
        OPERATOR_NAME: 'Entsiegelung Musterverein e.V.',
        OPERATOR_ADDRESS: 'Gartenweg 5\\n55116 Mainz',
        OPERATOR_EMAIL: 'impressum@unseal.example.org',
        OPERATOR_PHONE: '+49 6131 123456',
        ABUSE_CONTACT: 'abuse@unseal.example.org',
      }),
      pool,
      {
        logger: createLogger({ enabled: false }),
        mailer: createMemoryMailer(),
      },
    );

    try {
      const [impRes, privRes, termsRes, licRes, exportRes] = await Promise.all([
        configuredApp.inject({ method: 'GET', url: '/auth/impressum' }),
        configuredApp.inject({ method: 'GET', url: '/auth/privacy' }),
        configuredApp.inject({ method: 'GET', url: '/auth/terms' }),
        configuredApp.inject({ method: 'GET', url: '/auth/licenses' }),
        configuredApp.inject({ method: 'GET', url: '/api/v1/polygons/export.geojson' }),
      ]);

      assert.equal(impRes.statusCode, 200);
      assert.match(impRes.body, /Entsiegelung Musterverein e\.V\./);
      assert.match(impRes.body, /Gartenweg 5/);
      assert.match(impRes.body, /impressum@unseal\.example\.org/);
      assert.match(impRes.body, /\+49 6131 123456/);

      assert.equal(privRes.statusCode, 200);
      assert.match(privRes.body, /Entsiegelung Musterverein e\.V\./);
      assert.match(privRes.body, /Datenschutzerklärung/);
      assert.match(privRes.body, /Nominatim/);
      // Statements that must match what the code does
      assert.match(privRes.body, /HMAC/);
      assert.equal(privRes.body.includes('nicht umkehrbar'), false);
      assert.match(privRes.body, /<strong>Keine<\/strong> IP-Adressen/);
      assert.match(privRes.body, /Art\. 6 Abs\. 1 lit\. b DSGVO/);
      assert.match(privRes.body, /<strong>kein Pseudonym<\/strong>/);
      assert.match(privRes.body, /Meine Daten herunterladen/);
      assert.match(privRes.body, /Aktiv in den letzten 30 Tagen/);
      // Default config: OpenFreeMap loaded directly, DOP20 proxied, backup warning for operators
      assert.match(privRes.body, /OpenFreeMap/);
      assert.match(privRes.body, /Luftbilder \(DOP20\):<\/strong> Werden über diesen Server/);
      assert.match(privRes.body, /BACKUP_RETENTION_DAYS/);
      assert.equal(privRes.body.includes('last_login_at'), false);

      assert.equal(termsRes.statusCode, 200);
      assert.match(termsRes.body, /CC0 1\.0/);
      assert.match(termsRes.body, /CC BY 4\.0/);

      assert.equal(licRes.statusCode, 200);
      assert.match(licRes.body, /AGPL-3\.0-or-later/);
      assert.match(licRes.body, /MPL-2\.0/);
      assert.match(licRes.body, /MapLibre React Native \(MIT\)/);
      assert.match(licRes.body, /MapLibre Native Android\/iOS \(BSD-2-Clause\)/);
      assert.match(licRes.body, /@node-rs\/argon2 \(MIT\)/);
      assert.match(licRes.body, /Nodemailer \(MIT-0\)/);
      assert.match(licRes.body, /PostGIS \(GPL-2\.0-or-later\)/);
      assert.match(licRes.body, /OpenMapTiles/);
      assert.match(licRes.body, /https:\/\/www\.bkg\.bund\.de/);
      assert.match(licRes.body, /Daten verändert/);
      assert.match(licRes.body, /Bayerische Vermessungsverwaltung.*CC BY 4\.0/);
      assert.match(licRes.body, /Land NRW.*dl-de\/zero-2-0/);
      assert.match(licRes.body, /\/auth\/third-party-notices/);

      const noticesRes = await configuredApp.inject({
        method: 'GET',
        url: '/auth/third-party-notices',
      });
      assert.equal(noticesRes.statusCode, 200);
      assert.match(
        String(noticesRes.headers['content-type'] ?? ''),
        /text\/plain/,
      );
      assert.match(noticesRes.body, /THIRD-PARTY SOFTWARE & GEODATA NOTICES/);

      assert.equal(exportRes.statusCode, 200);
      assert.equal(exportRes.headers['content-license'], 'CC0-1.0');
      assert.equal(
        exportRes.headers.link,
        '<https://creativecommons.org/publicdomain/zero/1.0/>; rel="license", <https://unseal.example.org/auth/terms>; rel="terms-of-service"',
      );
      const exportPayload = exportRes.json() as {
        type: string;
        license?: string;
        licenseUrl?: string;
        attribution?: string;
        features: unknown[];
      };
      assert.equal(exportPayload.type, 'FeatureCollection');
      assert.equal(exportPayload.license, 'CC0-1.0');
      assert.equal(
        exportPayload.licenseUrl,
        'https://creativecommons.org/publicdomain/zero/1.0/',
      );
      assert.match(exportPayload.attribution ?? '', /BKG.*dl-de\/by-2-0/);

      // Dynamic /auth/licenses: disabled orthophoto & custom basemap must not claim OpenFreeMap/DOP20
      const customApp = await buildApp(
        loadEnvConfig({
          OSM_STYLE_URL: 'https://tiles.custom.example/style.json',
          ORTHOPHOTO_URL_TEMPLATE: 'none',
        }),
        pool,
        {
          logger: createLogger({ enabled: false }),
          mailer: createMemoryMailer(),
        },
      );
      try {
        const customLicRes = await customApp.inject({
          method: 'GET',
          url: '/auth/licenses',
        });
        assert.equal(customLicRes.statusCode, 200);
        assert.match(customLicRes.body, /tiles\.custom\.example/);
        assert.equal(customLicRes.body.includes('OpenFreeMap'), false);
        assert.match(customLicRes.body, /Luftbilder:<\/strong> Auf dieser Instanz deaktiviert/);
        assert.equal(customLicRes.body.includes('Bayerische Vermessungsverwaltung'), false);
      } finally {
        await customApp.close();
      }

      const user = await registerVerifiedUser(
        configuredApp,
        'LegalCheckUser',
        'legal-password-123',
        '198.51.100.71',
      );
      const userRow = await pool.query<{ terms_accepted_at: Date | null }>(
        'SELECT terms_accepted_at FROM users WHERE id = $1',
        [user.userId],
      );
      assert.ok(userRow.rows[0]?.terms_accepted_at instanceof Date);
    } finally {
      await configuredApp.close();
    }
  });
});
