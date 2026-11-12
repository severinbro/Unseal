import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import {
  ApiErrorEnvelopeSchema,
  AuthUserSchema,
  RegisterResponseSchema,
  SessionResponseSchema,
  normalizeRecoveryCode,
} from '@entsiegelung/shared';

import { buildApp } from '../src/app.js';
import {
  generateRecoveryCode,
  generateSessionToken,
  hashOpaqueToken,
  hashPassword,
  hashPseudonymTombstone,
  verifyPassword,
} from '../src/auth/crypto.js';
import { createSession, optionalAuth, requireAuth } from '../src/auth/session.js';
import { loadEnvConfig } from '../src/config.js';
import {
  deleteOrBanUserAccount,
  lockUserForWrite,
  recomputePolygonScores,
} from '../src/db/integrity.js';
import { resetTestDb, setupTestDb } from '../src/db/testHarness.js';
import { createLogger } from '../src/logger.js';
import { BoundedSemaphore } from '../src/util/semaphore.js';

import type pg from 'pg';

const SAMPLE_POLYGON_WKT =
  'POLYGON((9.9930 53.5510, 9.9933 53.5510, 9.9933 53.5513, 9.9930 53.5513, 9.9930 53.5510))';

describe('PPGIS-3: Zero-PII pseudonymous auth, 32-hex recovery, session eviction, and lock-ordered tombstoned deletion', () => {
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

  it('generates 39-char 8x4 uppercase hex recovery codes, base64url session tokens, SHA-256 digests, and Argon2id hashes', async () => {
    const recoveryCode = generateRecoveryCode();
    assert.equal(recoveryCode.length, 39);
    assert.match(recoveryCode, /^(?:[0-9A-F]{4}-){7}[0-9A-F]{4}$/);

    const normalized = normalizeRecoveryCode(recoveryCode);
    assert.equal(normalized.length, 32);
    assert.match(normalized, /^[0-9A-F]{32}$/);

    const sessionToken = generateSessionToken();
    assert.equal(Buffer.from(sessionToken, 'base64url').byteLength, 32);

    const tokenDigest = hashOpaqueToken(sessionToken);
    assert.equal(tokenDigest.byteLength, 32);

    const tombstoneLower = hashPseudonymTombstone('mapper_one');
    const tombstoneMixed = hashPseudonymTombstone('Mapper_One');
    assert.equal(tombstoneLower.byteLength, 32);
    assert.deepEqual(tombstoneLower, tombstoneMixed);

    const sem = new BoundedSemaphore(2, 4, 'AUTH_BUSY');
    const phc = await hashPassword('correct-horse-battery', sem);
    assert.match(phc, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    assert.equal(await verifyPassword(phc, 'correct-horse-battery', sem), true);
    assert.equal(await verifyPassword(phc, 'wrong-password-123', sem), false);
  });

  it('rejects "deleted"/"Deleted", active duplicates, self-deleted tombstones (409), and banned tombstones (403)', async () => {
    const config = loadEnvConfig({});
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
    });

    try {
      // Reserved "deleted" and "Deleted" -> 409 AUTH_PSEUDONYM_TAKEN
      for (const reservedName of ['deleted', 'Deleted', 'DELETED']) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/register',
          remoteAddress: '198.51.100.10',
          payload: {
            pseudonym: reservedName,
            password: 'valid-password-123',
          },
        });
        assert.equal(res.statusCode, 409);
        const err = ApiErrorEnvelopeSchema.parse(res.json());
        assert.equal(err.error.code, 'AUTH_PSEUDONYM_TAKEN');
      }

      // Seed banned tombstone hash -> 403 FORBIDDEN_PSEUDONYM_BANNED
      const bannedHash = hashPseudonymTombstone('banned_vandal');
      await pool.query(
        'INSERT INTO reserved_pseudonyms (pseudonym_hash, reason) VALUES ($1, $2)',
        [bannedHash, 'vandalism'],
      );

      const bannedRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: '198.51.100.11',
        payload: {
          pseudonym: 'Banned_Vandal',
          password: 'valid-password-123',
        },
      });
      assert.equal(bannedRes.statusCode, 403);
      const bannedErr = ApiErrorEnvelopeSchema.parse(bannedRes.json());
      assert.equal(bannedErr.error.code, 'FORBIDDEN_PSEUDONYM_BANNED');

      // Valid registration -> 201 with hashed credentials in DB
      const regRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: '198.51.100.12',
        payload: {
          pseudonym: 'CourtyardMapper',
          password: 'valid-password-123',
        },
      });
      assert.equal(regRes.statusCode, 201);
      const regBody = RegisterResponseSchema.parse(regRes.json());
      assert.equal(regBody.user.pseudonym, 'CourtyardMapper');
      assert.equal(regBody.recoveryCode.length, 39);
      assert.match(regBody.recoveryCode, /^(?:[0-9A-F]{4}-){7}[0-9A-F]{4}$/);

      const dbUserRes = await pool.query<{
        password_hash: string;
        recovery_code_hash: Buffer;
      }>('SELECT password_hash, recovery_code_hash FROM users WHERE id = $1', [
        regBody.user.id,
      ]);
      const dbUser = dbUserRes.rows[0]!;
      assert.match(dbUser.password_hash, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
      assert.deepEqual(
        dbUser.recovery_code_hash,
        hashOpaqueToken(normalizeRecoveryCode(regBody.recoveryCode)),
      );

      // Case-insensitive duplicate active pseudonym -> 409 AUTH_PSEUDONYM_TAKEN
      const dupRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: '198.51.100.13',
        payload: {
          pseudonym: 'courtyardmapper',
          password: 'another-password-123',
        },
      });
      assert.equal(dupRes.statusCode, 409);
      const dupErr = ApiErrorEnvelopeSchema.parse(dupRes.json());
      assert.equal(dupErr.error.code, 'AUTH_PSEUDONYM_TAKEN');
    } finally {
      await app.close();
    }
  });

  it('DELETE /api/v1/auth/me tombstones pseudonym, anonymizes authored polygons, cascades votes, and recomputes scores immediately', async () => {
    const config = loadEnvConfig({});
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
    });

    try {
      const regAnna = RegisterResponseSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/auth/register',
            remoteAddress: '198.51.100.20',
            payload: { pseudonym: 'MapperAnna', password: 'anna-password-123' },
          })
        ).json(),
      );
      const regBen = RegisterResponseSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/auth/register',
            remoteAddress: '198.51.100.21',
            payload: { pseudonym: 'VoterBen', password: 'ben-password-123' },
          })
        ).json(),
      );
      const regClara = RegisterResponseSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/auth/register',
            remoteAddress: '198.51.100.22',
            payload: { pseudonym: 'VoterClara', password: 'clara-password-123' },
          })
        ).json(),
      );

      // Seed 3 polygons + votes in SQL:
      // 1) Authored by Anna, upvoted by Ben (+1) and Clara (+1) -> score 2
      const polyAnnaRes = await pool.query<{ id: string }>(
        `INSERT INTO polygons (user_id, geom, surface_type, note, area_m2, upvotes, downvotes, score)
         VALUES ($1, ST_GeomFromText($2, 4326), 'asphalt', 'Anna lot', 85.0, 2, 0, 2)
         RETURNING id`,
        [regAnna.user.id, SAMPLE_POLYGON_WKT],
      );
      const polyAnnaId = polyAnnaRes.rows[0]!.id;
      await pool.query(
        `INSERT INTO votes (polygon_id, user_id, value) VALUES ($1, $2, 1), ($1, $3, 1)`,
        [polyAnnaId, regBen.user.id, regClara.user.id],
      );

      // 2) Authored by Ben, upvoted by Anna (+1) and downvoted by Clara (-1) -> score 0
      const polyBenRes = await pool.query<{ id: string }>(
        `INSERT INTO polygons (user_id, geom, surface_type, note, area_m2, upvotes, downvotes, score)
         VALUES ($1, ST_GeomFromText($2, 4326), 'concrete', 'Ben courtyard', 110.0, 1, 1, 0)
         RETURNING id`,
        [regBen.user.id, SAMPLE_POLYGON_WKT],
      );
      const polyBenId = polyBenRes.rows[0]!.id;
      await pool.query(
        `INSERT INTO votes (polygon_id, user_id, value) VALUES ($1, $2, 1), ($1, $3, -1)`,
        [polyBenId, regAnna.user.id, regClara.user.id],
      );

      // 3) Authored by Clara, only vote is Anna's downvote (-1) -> score -1
      const polyClaraRes = await pool.query<{ id: string }>(
        `INSERT INTO polygons (user_id, geom, surface_type, note, area_m2, upvotes, downvotes, score)
         VALUES ($1, ST_GeomFromText($2, 4326), 'pavers', 'Clara margin', 45.0, 0, 1, -1)
         RETURNING id`,
        [regClara.user.id, SAMPLE_POLYGON_WKT],
      );
      const polyClaraId = polyClaraRes.rows[0]!.id;
      await pool.query(
        `INSERT INTO votes (polygon_id, user_id, value) VALUES ($1, $2, -1)`,
        [polyClaraId, regAnna.user.id],
      );

      // Self-delete Anna's account
      const delRes = await app.inject({
        method: 'DELETE',
        url: '/api/v1/auth/me',
        remoteAddress: '198.51.100.20',
        headers: {
          authorization: `Bearer ${regAnna.sessionToken}`,
        },
      });
      assert.equal(delRes.statusCode, 204);
      assert.equal(delRes.body, '');

      // Anna's old bearer token is immediately invalid -> 401 AUTH_REQUIRED
      const meAfterDelete = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: {
          authorization: `Bearer ${regAnna.sessionToken}`,
        },
      });
      assert.equal(meAfterDelete.statusCode, 401);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(meAfterDelete.json()).error.code,
        'AUTH_REQUIRED',
      );

      // Verify Anna's users, sessions, and votes rows are gone
      const annaCounts = await pool.query<{
        user_cnt: number;
        session_cnt: number;
        vote_cnt: number;
      }>(
        `SELECT
           (SELECT COUNT(*)::int FROM users WHERE id = $1) AS user_cnt,
           (SELECT COUNT(*)::int FROM sessions WHERE user_id = $1) AS session_cnt,
           (SELECT COUNT(*)::int FROM votes WHERE user_id = $1) AS vote_cnt`,
        [regAnna.user.id],
      );
      assert.deepEqual(annaCounts.rows[0], {
        user_cnt: 0,
        session_cnt: 0,
        vote_cnt: 0,
      });

      // Verify Anna's authored polygon survived with user_id IS NULL ("deleted") and intact community score
      const polyAnnaAfter = await pool.query<{
        user_id: string | null;
        author_pseudonym: string;
        upvotes: number;
        downvotes: number;
        score: number;
      }>(
        `SELECT p.user_id, COALESCE(u.pseudonym, 'deleted') AS author_pseudonym, p.upvotes, p.downvotes, p.score
         FROM polygons p
         LEFT JOIN users u ON u.id = p.user_id
         WHERE p.id = $1`,
        [polyAnnaId],
      );
      assert.deepEqual(polyAnnaAfter.rows[0], {
        user_id: null,
        author_pseudonym: 'deleted',
        upvotes: 2,
        downvotes: 0,
        score: 2,
      });

      // Verify voted polygons recomputed immediately (Ben's drops to -1; Clara's returns to 0)
      const polyBenAfter = await pool.query<{
        upvotes: number;
        downvotes: number;
        score: number;
      }>('SELECT upvotes, downvotes, score FROM polygons WHERE id = $1', [polyBenId]);
      assert.deepEqual(polyBenAfter.rows[0], {
        upvotes: 0,
        downvotes: 1,
        score: -1,
      });

      const polyClaraAfter = await pool.query<{
        upvotes: number;
        downvotes: number;
        score: number;
      }>('SELECT upvotes, downvotes, score FROM polygons WHERE id = $1', [polyClaraId]);
      assert.deepEqual(polyClaraAfter.rows[0], {
        upvotes: 0,
        downvotes: 0,
        score: 0,
      });

      // Verify SHA-256 tombstone blocks re-registration of "MapperAnna" / "mapperanna" with 409
      const tombstoneRow = await pool.query<{ reason: string }>(
        'SELECT reason FROM reserved_pseudonyms WHERE pseudonym_hash = $1',
        [hashPseudonymTombstone('mapperanna')],
      );
      assert.equal(tombstoneRow.rows[0]?.reason, 'self_deleted');

      const reRegRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: '198.51.100.25',
        payload: {
          pseudonym: 'mapperanna',
          password: 'impersonator-password-123',
        },
      });
      assert.equal(reRegRes.statusCode, 409);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(reRegRes.json()).error.code,
        'AUTH_PSEUDONYM_TAKEN',
      );

      // Also verify deleteOrBanUserAccount in mode === 'ban' purges authored polygons, cascades votes, recomputes scores, and blocks with 403
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await deleteOrBanUserAccount(client, {
          userId: regBen.user.id,
          pseudonymLower: 'voterben',
          mode: 'ban',
          reason: 'coordinated spam',
        });
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      const benPolyCount = await pool.query<{ cnt: number }>(
        'SELECT COUNT(*)::int AS cnt FROM polygons WHERE id = $1',
        [polyBenId],
      );
      assert.equal(benPolyCount.rows[0]?.cnt, 0);

      // Anna's surviving polygon had Ben (+1) and Clara (+1); after Ben's ban, score recomputed to 1
      const polyAnnaAfterBan = await pool.query<{
        upvotes: number;
        downvotes: number;
        score: number;
      }>('SELECT upvotes, downvotes, score FROM polygons WHERE id = $1', [polyAnnaId]);
      assert.deepEqual(polyAnnaAfterBan.rows[0], {
        upvotes: 1,
        downvotes: 0,
        score: 1,
      });

      const reRegBenRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: '198.51.100.26',
        payload: {
          pseudonym: 'VoterBen',
          password: 'new-ben-password-123',
        },
      });
      assert.equal(reRegBenRes.statusCode, 403);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(reRegBenRes.json()).error.code,
        'FORBIDDEN_PSEUDONYM_BANNED',
      );
    } finally {
      await app.close();
    }
  });

  it('POST /api/v1/auth/recover accepts lowercase/unhyphenated codes, rotates recovery code, revokes prior sessions, and rejects malformed or replayed codes', async () => {
    const config = loadEnvConfig({});
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
    });

    try {
      const reg = RegisterResponseSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/auth/register',
            remoteAddress: '198.51.100.30',
            payload: {
              pseudonym: 'RecoverTester',
              password: 'initial-password-123',
            },
          })
        ).json(),
      );

      // Create a second active session via login
      const secondLogin = SessionResponseSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/auth/login',
            remoteAddress: '198.51.100.30',
            payload: {
              pseudonym: 'RecoverTester',
              password: 'initial-password-123',
            },
          })
        ).json(),
      );

      // Malformed recovery code, wrong hex recovery code, and unknown pseudonym -> 401 AUTH_RECOVERY_INVALID
      for (const badAttempt of [
        {
          pseudonym: 'RecoverTester',
          recoveryCode: 'not-even-hex!!',
          newPassword: 'updated-password-456',
        },
        {
          pseudonym: 'RecoverTester',
          recoveryCode: '1234-5678',
          newPassword: 'updated-password-456',
        },
        {
          pseudonym: 'RecoverTester',
          recoveryCode: '0000-0000-0000-0000-0000-0000-0000-0000',
          newPassword: 'updated-password-456',
        },
        {
          pseudonym: 'UnknownPerson',
          recoveryCode: reg.recoveryCode,
          newPassword: 'updated-password-456',
        },
      ]) {
        const failRes = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/recover',
          remoteAddress: '198.51.100.31',
          payload: badAttempt,
        });
        assert.equal(failRes.statusCode, 401);
        assert.equal(
          ApiErrorEnvelopeSchema.parse(failRes.json()).error.code,
          'AUTH_RECOVERY_INVALID',
        );
      }

      // Recover using lowercase unhyphenated code with surrounding spaces
      const unhyphenatedLower = `  ${reg.recoveryCode.replace(/-/g, '').toLowerCase()}  `;
      const recoverRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/recover',
        remoteAddress: '198.51.100.32',
        payload: {
          pseudonym: 'recovertester',
          recoveryCode: unhyphenatedLower,
          newPassword: 'updated-password-456',
        },
      });
      assert.equal(recoverRes.statusCode, 200);
      const recovered = RegisterResponseSchema.parse(recoverRes.json());
      assert.equal(recovered.user.id, reg.user.id);
      assert.equal(recovered.recoveryCode.length, 39);
      assert.match(recovered.recoveryCode, /^(?:[0-9A-F]{4}-){7}[0-9A-F]{4}$/);
      assert.notEqual(recovered.recoveryCode, reg.recoveryCode);
      assert.notEqual(recovered.sessionToken, reg.sessionToken);

      // Both old bearer tokens are revoked -> 401 AUTH_REQUIRED
      for (const revokedToken of [reg.sessionToken, secondLogin.sessionToken]) {
        const oldMeRes = await app.inject({
          method: 'GET',
          url: '/api/v1/auth/me',
          headers: { authorization: `Bearer ${revokedToken}` },
        });
        assert.equal(oldMeRes.statusCode, 401);
        assert.equal(
          ApiErrorEnvelopeSchema.parse(oldMeRes.json()).error.code,
          'AUTH_REQUIRED',
        );
      }

      // New bearer token succeeds
      const newMeRes = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${recovered.sessionToken}` },
      });
      assert.equal(newMeRes.statusCode, 200);
      assert.equal(AuthUserSchema.parse(newMeRes.json()).pseudonym, 'RecoverTester');

      // Replaying the consumed recovery code fails with 401 AUTH_RECOVERY_INVALID
      const replayRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/recover',
        remoteAddress: '198.51.100.32',
        payload: {
          pseudonym: 'RecoverTester',
          recoveryCode: reg.recoveryCode,
          newPassword: 'third-password-789',
        },
      });
      assert.equal(replayRes.statusCode, 401);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(replayRes.json()).error.code,
        'AUTH_RECOVERY_INVALID',
      );

      // Old password fails login, updated password succeeds
      const oldPwLogin = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: '198.51.100.33',
        payload: {
          pseudonym: 'RecoverTester',
          password: 'initial-password-123',
        },
      });
      assert.equal(oldPwLogin.statusCode, 401);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(oldPwLogin.json()).error.code,
        'AUTH_INVALID_CREDENTIALS',
      );

      const newPwLogin = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: '198.51.100.33',
        payload: {
          pseudonym: 'RecoverTester',
          password: 'updated-password-456',
        },
      });
      assert.equal(newPwLogin.statusCode, 200);
      SessionResponseSchema.parse(newPwLogin.json());
    } finally {
      await app.close();
    }
  });

  it('enforces BoundedSemaphore 503 AUTH_BUSY, 11th login oldest-session eviction, logout, optionalAuth, and composite (ipSubnet, pseudonym) throttling', async () => {
    const config = loadEnvConfig({});

    // 1. BoundedSemaphore queue overflow -> 503 AUTH_BUSY across register, login (real + unknown dummy), and recover
    const tightSemaphore = new BoundedSemaphore(1, 0, 'AUTH_BUSY');
    const busyApp = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
      argon2Semaphore: tightSemaphore,
    });

    try {
      const reg = RegisterResponseSchema.parse(
        (
          await busyApp.inject({
            method: 'POST',
            url: '/api/v1/auth/register',
            remoteAddress: '198.51.100.40',
            payload: { pseudonym: 'BusyTarget', password: 'busy-password-123' },
          })
        ).json(),
      );

      const release = await tightSemaphore.acquire();
      try {
        const busyReg = await busyApp.inject({
          method: 'POST',
          url: '/api/v1/auth/register',
          remoteAddress: '198.51.100.41',
          payload: { pseudonym: 'BusyNewUser', password: 'busy-password-123' },
        });
        assert.equal(busyReg.statusCode, 503);
        assert.equal(ApiErrorEnvelopeSchema.parse(busyReg.json()).error.code, 'AUTH_BUSY');

        const busyLoginExisting = await busyApp.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          remoteAddress: '198.51.100.42',
          payload: { pseudonym: 'BusyTarget', password: 'busy-password-123' },
        });
        assert.equal(busyLoginExisting.statusCode, 503);
        assert.equal(
          ApiErrorEnvelopeSchema.parse(busyLoginExisting.json()).error.code,
          'AUTH_BUSY',
        );

        // Unknown pseudonym ALSO gates dummy Argon2id through authSemaphore -> 503 AUTH_BUSY
        const busyLoginUnknown = await busyApp.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          remoteAddress: '198.51.100.43',
          payload: { pseudonym: 'GhostMapper', password: 'busy-password-123' },
        });
        assert.equal(busyLoginUnknown.statusCode, 503);
        assert.equal(
          ApiErrorEnvelopeSchema.parse(busyLoginUnknown.json()).error.code,
          'AUTH_BUSY',
        );

        const busyRecover = await busyApp.inject({
          method: 'POST',
          url: '/api/v1/auth/recover',
          remoteAddress: '198.51.100.44',
          payload: {
            pseudonym: 'BusyTarget',
            recoveryCode: reg.recoveryCode,
            newPassword: 'newer-busy-password-123',
          },
        });
        assert.equal(busyRecover.statusCode, 503);
        assert.equal(
          ApiErrorEnvelopeSchema.parse(busyRecover.json()).error.code,
          'AUTH_BUSY',
        );
      } finally {
        release();
      }
    } finally {
      await busyApp.close();
    }

    // 2. 11th session creation evicts oldest session + logout + optionalAuth + composite failed-login throttling
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
      rateLimits: {
        loginIp: { max: 50, timeWindow: '15 minutes' },
      },
    });

    app.get('/api/v1/test-optional-auth', { preHandler: optionalAuth }, async (req) => ({
      userId: req.auth?.user.id ?? null,
    }));
    app.get('/api/v1/test-require-auth', { preHandler: requireAuth }, async (req) => ({
      userId: req.auth!.user.id,
    }));

    try {
      const reg = RegisterResponseSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/auth/register',
            remoteAddress: '203.0.113.10',
            payload: { pseudonym: 'MultiDevice', password: 'device-password-123' },
          })
        ).json(),
      );

      // Seed an already-expired session row to verify createSession purges expired rows
      const expiredRawToken = generateSessionToken();
      await pool.query(
        `INSERT INTO sessions (user_id, token_hash, expires_at)
         VALUES ($1, $2, NOW() - INTERVAL '1 hour')`,
        [reg.user.id, hashOpaqueToken(expiredRawToken)],
      );

      // optionalAuth returns null for anonymous or expired token, and userId for active token
      const anonOpt = await app.inject({
        method: 'GET',
        url: '/api/v1/test-optional-auth',
      });
      assert.deepEqual(anonOpt.json(), { userId: null });

      const expiredOpt = await app.inject({
        method: 'GET',
        url: '/api/v1/test-optional-auth',
        headers: { authorization: `Bearer ${expiredRawToken}` },
      });
      assert.deepEqual(expiredOpt.json(), { userId: null });

      const validOpt = await app.inject({
        method: 'GET',
        url: '/api/v1/test-optional-auth',
        headers: { authorization: `Bearer ${reg.sessionToken}` },
      });
      assert.deepEqual(validOpt.json(), { userId: reg.user.id });

      const missingReqAuth = await app.inject({
        method: 'GET',
        url: '/api/v1/test-require-auth',
      });
      assert.equal(missingReqAuth.statusCode, 401);

      // reg.sessionToken is session #1; perform 10 more logins (total 11 sessions)
      const tokens: string[] = [reg.sessionToken];
      for (let i = 0; i < 10; i += 1) {
        const loginRes = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          remoteAddress: '203.0.113.10',
          payload: { pseudonym: 'MultiDevice', password: 'device-password-123' },
        });
        assert.equal(loginRes.statusCode, 200);
        tokens.push(SessionResponseSchema.parse(loginRes.json()).sessionToken);
      }
      assert.equal(tokens.length, 11);

      // Active sessions count in DB is capped at 10 (expired row also purged)
      const sessionCntRes = await pool.query<{ cnt: number }>(
        'SELECT COUNT(*)::int AS cnt FROM sessions WHERE user_id = $1',
        [reg.user.id],
      );
      assert.equal(sessionCntRes.rows[0]?.cnt, 10);

      // Oldest session (tokens[0]) was evicted -> 401 AUTH_REQUIRED
      const evictedRes = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${tokens[0]!}` },
      });
      assert.equal(evictedRes.statusCode, 401);

      // Remaining 10 newest sessions (tokens[1..10]) are all valid -> 200
      for (const activeToken of tokens.slice(1)) {
        const activeRes = await app.inject({
          method: 'GET',
          url: '/api/v1/auth/me',
          headers: { authorization: `Bearer ${activeToken}` },
        });
        assert.equal(activeRes.statusCode, 200);
      }

      // Logout revokes tokens[1] (204) without affecting tokens[2]
      const logoutRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: { authorization: `Bearer ${tokens[1]!}` },
      });
      assert.equal(logoutRes.statusCode, 204);

      const afterLogoutRes = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${tokens[1]!}` },
      });
      assert.equal(afterLogoutRes.statusCode, 401);

      const siblingStillActive = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${tokens[2]!}` },
      });
      assert.equal(siblingStillActive.statusCode, 200);

      // Composite (ipSubnet, pseudonym) login throttling:
      // 10 valid logins from 203.0.113.10 did NOT increment failed login counter!
      // Now send 5 failed attempts from same IPv6 /64 subnet across different interface IDs:
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const failRes = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          remoteAddress: `2001:db8:cafe:42::${attempt}`,
          payload: {
            pseudonym: attempt % 2 === 0 ? 'multidevice' : 'MultiDevice',
            password: 'wrong-password-attempt',
          },
        });
        assert.equal(failRes.statusCode, 401);
        assert.equal(
          ApiErrorEnvelopeSchema.parse(failRes.json()).error.code,
          'AUTH_INVALID_CREDENTIALS',
        );
      }

      // 6th attempt from the same IPv6 /64 subnet is blocked with 429 RATE_LIMITED
      const sixthRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: '2001:db8:cafe:42::9999',
        payload: {
          pseudonym: 'MultiDevice',
          password: 'wrong-password-attempt',
        },
      });
      assert.equal(sixthRes.statusCode, 429);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(sixthRes.json()).error.code,
        'RATE_LIMITED',
      );

      // Different subnet is NOT locked out for MultiDevice!
      const otherSubnetWrong = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: '2001:db8:cafe:43::1',
        payload: {
          pseudonym: 'MultiDevice',
          password: 'wrong-password-attempt',
        },
      });
      assert.equal(otherSubnetWrong.statusCode, 401);

      const otherSubnetValid = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: '2001:db8:cafe:43::1',
        payload: {
          pseudonym: 'MultiDevice',
          password: 'device-password-123',
        },
      });
      assert.equal(otherSubnetValid.statusCode, 200);

      // Directly exercise createSession helper against Pool as well
      const directSession = await createSession(pool, reg.user.id, 7);
      assert.ok(directSession.sessionToken.length > 20);
    } finally {
      await app.close();
    }
  });

  it('enforces lockUserForWrite, recomputePolygonScores, concurrent vote vs account deletion lock ordering, and CORS preflight methods', async () => {
    const config = loadEnvConfig({});
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
    });

    try {
      // CORS preflight allows DELETE/PATCH/PUT and Authorization header
      const preflight = await app.inject({
        method: 'OPTIONS',
        url: '/api/v1/auth/me',
        headers: {
          origin: 'https://map.example.org',
          'access-control-request-method': 'DELETE',
          'access-control-request-headers': 'authorization,content-type,x-request-id',
        },
      });
      assert.equal(preflight.statusCode, 204);
      const allowMethods = String(preflight.headers['access-control-allow-methods'] ?? '');
      const allowHeaders = String(preflight.headers['access-control-allow-headers'] ?? '').toLowerCase();
      for (const method of ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']) {
        assert.ok(allowMethods.includes(method), `Expected CORS to allow ${method}`);
      }
      assert.ok(allowHeaders.includes('authorization'));

      // lockUserForWrite throws 401 AUTH_REQUIRED when user does not exist
      const missingClient = await pool.connect();
      try {
        await missingClient.query('BEGIN');
        await assert.rejects(
          () =>
            lockUserForWrite(
              missingClient,
              '00000000-0000-4000-8000-000000000000',
            ),
          (err: unknown) => {
            assert.equal((err as { statusCode?: number }).statusCode, 401);
            assert.equal((err as { code?: string }).code, 'AUTH_REQUIRED');
            return true;
          },
        );
        await missingClient.query('ROLLBACK');
      } finally {
        missingClient.release();
      }

      // Concurrent lockUserForWrite + vote write vs DELETE /api/v1/auth/me obeys users -> polygons (id ASC) without deadlock
      const authorReg = RegisterResponseSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/auth/register',
            remoteAddress: '198.51.100.60',
            payload: { pseudonym: 'PolyAuthor', password: 'author-password-123' },
          })
        ).json(),
      );
      const voterReg = RegisterResponseSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/auth/register',
            remoteAddress: '198.51.100.61',
            payload: { pseudonym: 'RacingVoter', password: 'voter-password-123' },
          })
        ).json(),
      );

      const p1Res = await pool.query<{ id: string }>(
        `INSERT INTO polygons (user_id, geom, surface_type, area_m2)
         VALUES ($1, ST_GeomFromText($2, 4326), 'asphalt', 90.0) RETURNING id`,
        [authorReg.user.id, SAMPLE_POLYGON_WKT],
      );
      const p2Res = await pool.query<{ id: string }>(
        `INSERT INTO polygons (user_id, geom, surface_type, area_m2)
         VALUES ($1, ST_GeomFromText($2, 4326), 'concrete', 95.0) RETURNING id`,
        [authorReg.user.id, SAMPLE_POLYGON_WKT],
      );
      const p1 = p1Res.rows[0]!.id;
      const p2 = p2Res.rows[0]!.id;

      const simulatedVoteWrite = async (): Promise<void> => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await lockUserForWrite(client, voterReg.user.id);
          await client.query('SELECT id FROM polygons WHERE id = $1 FOR UPDATE', [p1]);
          await client.query(
            `INSERT INTO votes (polygon_id, user_id, value)
             VALUES ($1, $2, 1)
             ON CONFLICT (polygon_id, user_id) DO UPDATE SET value = EXCLUDED.value`,
            [p1, voterReg.user.id],
          );
          await recomputePolygonScores(client, [p2, p1, p1]);
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
          headers: { authorization: `Bearer ${voterReg.sessionToken}` },
        }),
      ]);
      assert.equal(deleteOutcome.statusCode, 204);

      // Regardless of race winner, voterReg is deleted, 0 phantom votes exist, and polygon score is 0
      const finalCheck = await pool.query<{
        votes_cnt: number;
        score: number;
        upvotes: number;
        downvotes: number;
      }>(
        `SELECT
           (SELECT COUNT(*)::int FROM votes WHERE polygon_id = $1) AS votes_cnt,
           p.score,
           p.upvotes,
           p.downvotes
         FROM polygons p
         WHERE p.id = $1`,
        [p1],
      );
      assert.deepEqual(finalCheck.rows[0], {
        votes_cnt: 0,
        score: 0,
        upvotes: 0,
        downvotes: 0,
      });
    } finally {
      await app.close();
    }
  });

  it('honors BuildAppOptions.rateLimits overrides across register, loginAccount, recover, and deleteAccount plus 422 payload validation', async () => {
    const config = loadEnvConfig({});
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
      rateLimits: {
        register: { max: 2, timeWindow: '1 hour' },
        loginAccount: { max: 2, timeWindowMs: 60_000 },
        recover: { max: 1, timeWindow: '15 minutes' },
        deleteAccount: { max: 1, timeWindow: '1 hour' },
      },
    });

    try {
      // 422 validation check on short password
      const badPw = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: '192.0.2.10',
        payload: { pseudonym: 'ValidName', password: 'short' },
      });
      assert.equal(badPw.statusCode, 422);
      assert.equal(ApiErrorEnvelopeSchema.parse(badPw.json()).error.code, 'VALIDATION_ERROR');

      // 2nd request from 192.0.2.10 succeeds, 3rd hits register override max=2 -> 429
      const okReg = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: '192.0.2.10',
        payload: { pseudonym: 'OverrideUser1', password: 'valid-password-123' },
      });
      assert.equal(okReg.statusCode, 201);
      const reg1 = RegisterResponseSchema.parse(okReg.json());

      const regLimited = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: '192.0.2.10',
        payload: { pseudonym: 'OverrideUser2', password: 'valid-password-123' },
      });
      assert.equal(regLimited.statusCode, 429);

      // loginAccount override max=2 -> 3rd failure returns 429
      for (let i = 0; i < 2; i += 1) {
        const failLogin = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          remoteAddress: '192.0.2.20',
          payload: { pseudonym: 'OverrideUser1', password: 'wrong-password-123' },
        });
        assert.equal(failLogin.statusCode, 401);
      }
      const thirdLogin = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: '192.0.2.20',
        payload: { pseudonym: 'OverrideUser1', password: 'wrong-password-123' },
      });
      assert.equal(thirdLogin.statusCode, 429);

      // recover override max=1 -> 2nd request from same subnet returns 429
      const rec1 = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/recover',
        remoteAddress: '192.0.2.30',
        payload: {
          pseudonym: 'OverrideUser1',
          recoveryCode: 'bad-code',
          newPassword: 'another-valid-password',
        },
      });
      assert.equal(rec1.statusCode, 401);

      const rec2 = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/recover',
        remoteAddress: '192.0.2.30',
        payload: {
          pseudonym: 'OverrideUser1',
          recoveryCode: reg1.recoveryCode,
          newPassword: 'another-valid-password',
        },
      });
      assert.equal(rec2.statusCode, 429);

      // deleteAccount override max=1 -> 1st deletes user (204), 2nd from same subnet hits 429
      const del1 = await app.inject({
        method: 'DELETE',
        url: '/api/v1/auth/me',
        remoteAddress: '192.0.2.40',
        headers: { authorization: `Bearer ${reg1.sessionToken}` },
      });
      assert.equal(del1.statusCode, 204);

      const del2 = await app.inject({
        method: 'DELETE',
        url: '/api/v1/auth/me',
        remoteAddress: '192.0.2.40',
        headers: { authorization: `Bearer ${reg1.sessionToken}` },
      });
      assert.equal(del2.statusCode, 429);
    } finally {
      await app.close();
    }
  });
});
