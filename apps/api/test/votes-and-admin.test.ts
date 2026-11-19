// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Unseal Contributors

import { execFile } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { after, before, beforeEach, describe, it } from 'node:test';

import {
  ApiError,
  ApiErrorEnvelopeSchema,
  PolygonCollectionResponseSchema,
  PolygonFeatureSchema,
  RegisterResponseSchema,
  SessionResponseSchema,
  VoteResponseSchema,
  type PolygonFeature,
} from '@entsiegelung/shared';

import {
  VoteRepository,
  buildApp,
  registerVoteRoutes,
  runAdminCommand,
  type AdminCommandResult,
} from '../src/app.js';
import { DEV_TOMBSTONE_SECRET, loadEnvConfig } from '../src/config.js';
import {
  deleteOrBanUserAccount,
  lockUserForWrite,
  recomputePolygonScores,
} from '../src/db/integrity.js';
import { resetTestDb, setupTestDb } from '../src/db/testHarness.js';
import { createLogger } from '../src/logger.js';

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

const execFileAsync = promisify(execFile);

const VALID_COURTYARD_RING: [number, number][] = [
  [9.9937, 53.5511],
  [9.99385, 53.5511],
  [9.99385, 53.551208],
  [9.9937, 53.551208],
  [9.9937, 53.5511],
];

function makeShiftedRing(offsetIndex: number): [number, number][] {
  const dLng = offsetIndex * 0.0004;
  return VALID_COURTYARD_RING.map(([lng, lat]) => [
    Number((lng + dLng).toFixed(6)),
    lat,
  ]);
}

async function registerUser(
  app: FastifyInstance,
  pseudonym: string,
  remoteAddress = '198.51.100.10',
): Promise<{ userId: string; pseudonym: string; sessionToken: string }> {
  const email = `${pseudonym.toLowerCase()}@example.org`;
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    remoteAddress,
    payload: {
      pseudonym,
      email,
      password: 'valid-password-123',
      acceptedPrivacyPolicy: true,
      acceptedTerms: true,
    },
  });
  assert.equal(res.statusCode, 201);
  RegisterResponseSchema.parse(res.json());

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
      password: 'valid-password-123',
    },
  });
  assert.equal(loginRes.statusCode, 200);
  const body = SessionResponseSchema.parse(loginRes.json());
  return {
    userId: body.user.id,
    pseudonym: body.user.pseudonym,
    sessionToken: body.sessionToken,
  };
}

async function createPolygonForUser(
  app: FastifyInstance,
  sessionToken: string,
  options: {
    offsetIndex?: number;
    surfaceType?: 'asphalt' | 'concrete' | 'pavers' | 'other';
    note?: string | null;
    remoteAddress?: string;
  } = {},
): Promise<PolygonFeature> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/polygons',
    remoteAddress: options.remoteAddress ?? '198.51.100.15',
    headers: {
      authorization: `Bearer ${sessionToken}`,
    },
    payload: {
      geometry: {
        type: 'Polygon',
        coordinates: [makeShiftedRing(options.offsetIndex ?? 0)],
      },
      surfaceType: options.surfaceType ?? 'asphalt',
      ...(options.note !== undefined ? { note: options.note } : {}),
    },
  });
  assert.equal(res.statusCode, 201);
  return PolygonFeatureSchema.parse(res.json());
}

describe('PPGIS-5: Transactional +1/-1 voting and operator moderation CLI', () => {
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

  it('supports idempotent +1/-1 voting, vote flipping, vote removal, 404 on missing UUID, validation errors, rate limits, and vote cascade on polygon DELETE', async () => {
    assert.equal(typeof VoteRepository, 'function');
    assert.equal(typeof registerVoteRoutes, 'function');
    assert.equal(typeof runAdminCommand, 'function');

    const config = loadEnvConfig({});
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
      rateLimits: {
        vote: { max: 8, timeWindow: '1 minute' },
      },
    });

    try {
      const author = await registerUser(app, 'AuthorOne', '198.51.100.20');
      const voterA = await registerUser(app, 'VoterAlpha', '198.51.100.21');
      const voterB = await registerUser(app, 'VoterBravo', '198.51.100.22');

      const polygon = await createPolygonForUser(app, author.sessionToken, {
        note: 'Sealed parking strip',
        remoteAddress: '198.51.100.20',
      });

      // Unauthenticated PUT and DELETE -> 401 AUTH_REQUIRED
      const unauthPut = await app.inject({
        method: 'PUT',
        url: `/api/v1/polygons/${polygon.id}/vote`,
        remoteAddress: '198.51.100.30',
        payload: { value: 1 },
      });
      assert.equal(unauthPut.statusCode, 401);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(unauthPut.json()).error.code,
        'AUTH_REQUIRED',
      );

      const unauthDel = await app.inject({
        method: 'DELETE',
        url: `/api/v1/polygons/${polygon.id}/vote`,
        remoteAddress: '198.51.100.30',
      });
      assert.equal(unauthDel.statusCode, 401);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(unauthDel.json()).error.code,
        'AUTH_REQUIRED',
      );

      // Invalid UUID & invalid vote value -> 422 VALIDATION_ERROR
      const badUuidPut = await app.inject({
        method: 'PUT',
        url: '/api/v1/polygons/not-a-uuid/vote',
        remoteAddress: '198.51.100.31',
        headers: { authorization: `Bearer ${voterA.sessionToken}` },
        payload: { value: 1 },
      });
      assert.equal(badUuidPut.statusCode, 422);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(badUuidPut.json()).error.code,
        'VALIDATION_ERROR',
      );

      const badValuePut = await app.inject({
        method: 'PUT',
        url: `/api/v1/polygons/${polygon.id}/vote`,
        remoteAddress: '198.51.100.31',
        headers: { authorization: `Bearer ${voterA.sessionToken}` },
        payload: { value: 0 },
      });
      assert.equal(badValuePut.statusCode, 422);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(badValuePut.json()).error.code,
        'VALIDATION_ERROR',
      );

      // Missing polygon UUID -> 404 NOT_FOUND on both PUT and DELETE
      const missingId = '00000000-0000-4000-8000-000000000999';
      const missingPut = await app.inject({
        method: 'PUT',
        url: `/api/v1/polygons/${missingId}/vote`,
        remoteAddress: '198.51.100.32',
        headers: { authorization: `Bearer ${voterA.sessionToken}` },
        payload: { value: 1 },
      });
      assert.equal(missingPut.statusCode, 404);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(missingPut.json()).error.code,
        'NOT_FOUND',
      );

      const missingDel = await app.inject({
        method: 'DELETE',
        url: `/api/v1/polygons/${missingId}/vote`,
        remoteAddress: '198.51.100.32',
        headers: { authorization: `Bearer ${voterA.sessionToken}` },
      });
      assert.equal(missingDel.statusCode, 404);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(missingDel.json()).error.code,
        'NOT_FOUND',
      );

      // 1) VoterA upvotes (+1)
      const up1 = await app.inject({
        method: 'PUT',
        url: `/api/v1/polygons/${polygon.id}/vote`,
        remoteAddress: '198.51.100.40',
        headers: { authorization: `Bearer ${voterA.sessionToken}` },
        payload: { value: 1 },
      });
      assert.equal(up1.statusCode, 200);
      assert.deepEqual(VoteResponseSchema.parse(up1.json()), {
        polygonId: polygon.id,
        upvotes: 1,
        downvotes: 0,
        score: 1,
        myVote: 1,
      });

      // 2) VoterA repeats +1 (idempotent)
      const upRepeat = await app.inject({
        method: 'PUT',
        url: `/api/v1/polygons/${polygon.id}/vote`,
        remoteAddress: '198.51.100.40',
        headers: { authorization: `Bearer ${voterA.sessionToken}` },
        payload: { value: 1 },
      });
      assert.equal(upRepeat.statusCode, 200);
      assert.deepEqual(VoteResponseSchema.parse(upRepeat.json()), {
        polygonId: polygon.id,
        upvotes: 1,
        downvotes: 0,
        score: 1,
        myVote: 1,
      });

      // 3) VoterB upvotes (+1) -> upvotes: 2, downvotes: 0, score: 2
      const upVoterB = await app.inject({
        method: 'PUT',
        url: `/api/v1/polygons/${polygon.id}/vote`,
        remoteAddress: '198.51.100.41',
        headers: { authorization: `Bearer ${voterB.sessionToken}` },
        payload: { value: 1 },
      });
      assert.equal(upVoterB.statusCode, 200);
      assert.deepEqual(VoteResponseSchema.parse(upVoterB.json()), {
        polygonId: polygon.id,
        upvotes: 2,
        downvotes: 0,
        score: 2,
        myVote: 1,
      });

      // 4) VoterA flips from +1 to -1 -> upvotes: 1, downvotes: 1, score: 0
      const flipToMinus = await app.inject({
        method: 'PUT',
        url: `/api/v1/polygons/${polygon.id}/vote`,
        remoteAddress: '198.51.100.40',
        headers: { authorization: `Bearer ${voterA.sessionToken}` },
        payload: { value: -1 },
      });
      assert.equal(flipToMinus.statusCode, 200);
      assert.deepEqual(VoteResponseSchema.parse(flipToMinus.json()), {
        polygonId: polygon.id,
        upvotes: 1,
        downvotes: 1,
        score: 0,
        myVote: -1,
      });

      // Verify GET /api/v1/polygons?bbox=... reflects per-user myVote and score
      const bboxRes = await app.inject({
        method: 'GET',
        url: '/api/v1/polygons?bbox=9.9900,53.5500,9.9990,53.5550',
        headers: { authorization: `Bearer ${voterA.sessionToken}` },
      });
      assert.equal(bboxRes.statusCode, 200);
      const collection = PolygonCollectionResponseSchema.parse(bboxRes.json());
      assert.equal(collection.features.length, 1);
      assert.equal(collection.features[0]?.properties.myVote, -1);
      assert.equal(collection.features[0]?.properties.upvotes, 1);
      assert.equal(collection.features[0]?.properties.downvotes, 1);
      assert.equal(collection.features[0]?.properties.score, 0);

      // 5) VoterA deletes their vote -> upvotes: 1, downvotes: 0, score: 1, myVote: 0
      const delVoteA = await app.inject({
        method: 'DELETE',
        url: `/api/v1/polygons/${polygon.id}/vote`,
        remoteAddress: '198.51.100.40',
        headers: { authorization: `Bearer ${voterA.sessionToken}` },
      });
      assert.equal(delVoteA.statusCode, 200);
      assert.deepEqual(VoteResponseSchema.parse(delVoteA.json()), {
        polygonId: polygon.id,
        upvotes: 1,
        downvotes: 0,
        score: 1,
        myVote: 0,
      });

      // Repeating DELETE when already 0 is idempotent
      const delVoteARepeat = await app.inject({
        method: 'DELETE',
        url: `/api/v1/polygons/${polygon.id}/vote`,
        remoteAddress: '198.51.100.40',
        headers: { authorization: `Bearer ${voterA.sessionToken}` },
      });
      assert.equal(delVoteARepeat.statusCode, 200);
      assert.deepEqual(VoteResponseSchema.parse(delVoteARepeat.json()), {
        polygonId: polygon.id,
        upvotes: 1,
        downvotes: 0,
        score: 1,
        myVote: 0,
      });

      // Re-cast a vote for VoterA so multiple votes exist when polygon is deleted
      const recastA = await app.inject({
        method: 'PUT',
        url: `/api/v1/polygons/${polygon.id}/vote`,
        remoteAddress: '198.51.100.42',
        headers: { authorization: `Bearer ${voterA.sessionToken}` },
        payload: { value: -1 },
      });
      assert.equal(recastA.statusCode, 200);

      const beforeCascadeCnt = await pool.query<{ cnt: number }>(
        'SELECT COUNT(*)::int AS cnt FROM votes WHERE polygon_id = $1',
        [polygon.id],
      );
      assert.equal(beforeCascadeCnt.rows[0]?.cnt, 2);

      // 6) Rate limit enforcement (max: 8 per minute per IP-subnet)
      for (let i = 0; i < 8; i++) {
        const okRate = await app.inject({
          method: 'PUT',
          url: `/api/v1/polygons/${polygon.id}/vote`,
          remoteAddress: '2001:db8:abcd:1234::1',
          headers: { authorization: `Bearer ${voterB.sessionToken}` },
          payload: { value: 1 },
        });
        assert.equal(okRate.statusCode, 200);
      }
      // 9th request from same /64 IPv6 subnet -> 429 RATE_LIMITED
      const rateLimitedPut = await app.inject({
        method: 'PUT',
        url: `/api/v1/polygons/${polygon.id}/vote`,
        remoteAddress: '2001:db8:abcd:1234::ffff',
        headers: { authorization: `Bearer ${voterB.sessionToken}` },
        payload: { value: 1 },
      });
      assert.equal(rateLimitedPut.statusCode, 429);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(rateLimitedPut.json()).error.code,
        'RATE_LIMITED',
      );

      // DELETE /vote also enforces rate limit (max: 8 per minute per IP-subnet)
      for (let i = 0; i < 8; i++) {
        const okDelRate = await app.inject({
          method: 'DELETE',
          url: `/api/v1/polygons/${polygon.id}/vote`,
          remoteAddress: '2001:db8:abcd:5678::1',
          headers: { authorization: `Bearer ${voterB.sessionToken}` },
        });
        assert.equal(okDelRate.statusCode, 200);
      }
      const rateLimitedDel = await app.inject({
        method: 'DELETE',
        url: `/api/v1/polygons/${polygon.id}/vote`,
        remoteAddress: '2001:db8:abcd:5678::2',
        headers: { authorization: `Bearer ${voterB.sessionToken}` },
      });
      assert.equal(rateLimitedDel.statusCode, 429);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(rateLimitedDel.json()).error.code,
        'RATE_LIMITED',
      );

      // Re-cast VoterB's +1 vote so 2 votes exist on polygon before author DELETE
      const restoreVoterB = await app.inject({
        method: 'PUT',
        url: `/api/v1/polygons/${polygon.id}/vote`,
        remoteAddress: '198.51.100.43',
        headers: { authorization: `Bearer ${voterB.sessionToken}` },
        payload: { value: 1 },
      });
      assert.equal(restoreVoterB.statusCode, 200);

      // 7) DELETE /api/v1/polygons/:id cascades votes
      const deletePolyRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/polygons/${polygon.id}`,
        remoteAddress: '198.51.100.20',
        headers: { authorization: `Bearer ${author.sessionToken}` },
      });
      assert.equal(deletePolyRes.statusCode, 204);

      const afterCascadeCnt = await pool.query<{ cnt: number }>(
        'SELECT COUNT(*)::int AS cnt FROM votes WHERE polygon_id = $1',
        [polygon.id],
      );
      assert.equal(afterCascadeCnt.rows[0]?.cnt, 0);
    } finally {
      await app.close();
    }
  });

  it('obeys global users -> polygons lock ordering under concurrent PUT /vote and DELETE /api/v1/auth/me without phantom votes or 40P01 deadlocks', async () => {
    const config = loadEnvConfig({});
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
      rateLimits: {
        register: { max: 500, timeWindow: '1 hour' },
        loginIp: { max: 500, timeWindow: '15 minutes' },
        deleteAccount: { max: 500, timeWindow: '1 hour' },
        createPolygon: { max: 500, timeWindow: '1 minute' },
        vote: { max: 1000, timeWindow: '1 minute' },
      },
    });

    try {
      const author = await registerUser(app, 'LockAuthor', '198.51.100.50');
      const bystander = await registerUser(app, 'SteadyVoter', '198.51.100.51');

      const p1 = await createPolygonForUser(app, author.sessionToken, {
        offsetIndex: 1,
        remoteAddress: '198.51.100.50',
      });
      const p2 = await createPolygonForUser(app, author.sessionToken, {
        offsetIndex: 2,
        remoteAddress: '198.51.100.50',
      });
      const p3 = await createPolygonForUser(app, author.sessionToken, {
        offsetIndex: 3,
        remoteAddress: '198.51.100.50',
      });

      // Part A: Deterministic lock-barrier test where users row is locked FOR UPDATE
      // while a concurrent PUT /vote attempts lockUserForWrite (FOR KEY SHARE).
      const barrierVoter = await registerUser(
        app,
        'BarrierVoter',
        '198.51.100.52',
      );
      // Pre-seed a vote on p1 so deleteOrBanUserAccount touches p1 while concurrent PUT targets p2
      const preVoteRes = await app.inject({
        method: 'PUT',
        url: `/api/v1/polygons/${p1.id}/vote`,
        remoteAddress: '198.51.100.52',
        headers: { authorization: `Bearer ${barrierVoter.sessionToken}` },
        payload: { value: 1 },
      });
      assert.equal(preVoteRes.statusCode, 200);

      const holdClient = await pool.connect();
      let concurrentVotePromise: ReturnType<typeof app.inject> | undefined;
      try {
        await holdClient.query('BEGIN');
        await holdClient.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [
          barrierVoter.userId,
        ]);

        // Start PUT /vote on p2 while barrierVoter's users row is locked FOR UPDATE
        concurrentVotePromise = app.inject({
          method: 'PUT',
          url: `/api/v1/polygons/${p2.id}/vote`,
          remoteAddress: '198.51.100.52',
          headers: { authorization: `Bearer ${barrierVoter.sessionToken}` },
          payload: { value: 1 },
        });

        // Give the concurrent vote query a brief moment to block on lockUserForWrite
        await new Promise((resolve) => setTimeout(resolve, 40));

        await deleteOrBanUserAccount(holdClient, {
          userId: barrierVoter.userId,
          pseudonymLower: barrierVoter.pseudonym.toLowerCase(),
          mode: 'self_delete',
          tombstoneSecret: DEV_TOMBSTONE_SECRET,
        });
        await holdClient.query('COMMIT');
      } catch (err: unknown) {
        await holdClient.query('ROLLBACK');
        throw err;
      } finally {
        holdClient.release();
      }

      const blockedVoteRes = await concurrentVotePromise!;
      assert.equal(blockedVoteRes.statusCode, 401);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(blockedVoteRes.json()).error.code,
        'AUTH_REQUIRED',
      );

      // Part A2: Reverse lock-barrier direction - in-flight vote transaction holds
      // lockUserForWrite (FOR KEY SHARE on users) + FOR UPDATE on p2 while concurrent
      // DELETE /api/v1/auth/me blocks on users FOR UPDATE, then sees & cleans up the vote!
      const reverseVoter = await registerUser(
        app,
        'ReverseBarrierVoter',
        '198.51.100.54',
      );
      const voteTxClient = await pool.connect();
      let concurrentDeleteMePromise: ReturnType<typeof app.inject> | undefined;
      try {
        await voteTxClient.query('BEGIN');
        await lockUserForWrite(voteTxClient, reverseVoter.userId);
        await voteTxClient.query(
          'SELECT id FROM polygons WHERE id = $1 FOR UPDATE',
          [p2.id],
        );
        await voteTxClient.query(
          `INSERT INTO votes (polygon_id, user_id, value, updated_at)
           VALUES ($1, $2, 1, NOW())
           ON CONFLICT (polygon_id, user_id)
           DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [p2.id, reverseVoter.userId],
        );
        await recomputePolygonScores(voteTxClient, [p2.id]);

        // Start DELETE /api/v1/auth/me while voteTxClient holds FOR KEY SHARE on users
        concurrentDeleteMePromise = app.inject({
          method: 'DELETE',
          url: '/api/v1/auth/me',
          remoteAddress: '198.51.100.54',
          headers: { authorization: `Bearer ${reverseVoter.sessionToken}` },
        });

        await new Promise((resolve) => setTimeout(resolve, 40));

        // Commit the vote transaction so DELETE /api/v1/auth/me unblocks on users FOR UPDATE
        await voteTxClient.query('COMMIT');
      } catch (err: unknown) {
        await voteTxClient.query('ROLLBACK');
        throw err;
      } finally {
        voteTxClient.release();
      }

      const reverseDeleteRes = await concurrentDeleteMePromise!;
      assert.equal(reverseDeleteRes.statusCode, 204);

      const p2AfterReverse = await pool.query<{
        upvotes: number;
        downvotes: number;
        score: number;
        vote_cnt: number;
      }>(
        `SELECT
           p.upvotes,
           p.downvotes,
           p.score,
           (SELECT COUNT(*)::int FROM votes v WHERE v.polygon_id = p.id) AS vote_cnt
         FROM polygons p
         WHERE p.id = $1`,
        [p2.id],
      );
      assert.deepEqual(p2AfterReverse.rows[0], {
        upvotes: 0,
        downvotes: 0,
        score: 0,
        vote_cnt: 0,
      });

      // Part B: 12-round multi-connection race burst between PUT/DELETE /vote and DELETE /api/v1/auth/me
      for (let round = 0; round < 12; round++) {
        const ephemeral = await registerUser(
          app,
          `RaceUser_${round}`,
          '198.51.100.53',
        );

        // Seed an initial vote on p3 so DELETE /api/v1/auth/me must lock p3 and recompute
        const seedRes = await app.inject({
          method: 'PUT',
          url: `/api/v1/polygons/${p3.id}/vote`,
          remoteAddress: '198.51.100.53',
          headers: { authorization: `Bearer ${ephemeral.sessionToken}` },
          payload: { value: -1 },
        });
        assert.equal(seedRes.statusCode, 200);

        const bystanderValue: 1 | -1 = round % 2 === 0 ? 1 : -1;

        const [v1, v2, v3, delMe, vBystander] = await Promise.all([
          app.inject({
            method: 'PUT',
            url: `/api/v1/polygons/${p1.id}/vote`,
            remoteAddress: '198.51.100.53',
            headers: { authorization: `Bearer ${ephemeral.sessionToken}` },
            payload: { value: 1 },
          }),
          app.inject({
            method: 'PUT',
            url: `/api/v1/polygons/${p2.id}/vote`,
            remoteAddress: '198.51.100.53',
            headers: { authorization: `Bearer ${ephemeral.sessionToken}` },
            payload: { value: -1 },
          }),
          app.inject({
            method: 'DELETE',
            url: `/api/v1/polygons/${p3.id}/vote`,
            remoteAddress: '198.51.100.53',
            headers: { authorization: `Bearer ${ephemeral.sessionToken}` },
          }),
          app.inject({
            method: 'DELETE',
            url: '/api/v1/auth/me',
            remoteAddress: '198.51.100.53',
            headers: { authorization: `Bearer ${ephemeral.sessionToken}` },
          }),
          app.inject({
            method: 'PUT',
            url: `/api/v1/polygons/${p1.id}/vote`,
            remoteAddress: '198.51.100.51',
            headers: { authorization: `Bearer ${bystander.sessionToken}` },
            payload: { value: bystanderValue },
          }),
        ]);

        assert.equal(delMe.statusCode, 204);
        assert.equal(vBystander.statusCode, 200);

        for (const raceRes of [v1, v2, v3]) {
          assert.ok(
            raceRes.statusCode === 200 || raceRes.statusCode === 401,
            `Expected 200 or 401 on concurrent vote during self-delete, got ${raceRes.statusCode}: ${raceRes.body}`,
          );
        }

        // Zero phantom votes left behind for deleted user
        const phantomCheck = await pool.query<{ cnt: number }>(
          'SELECT COUNT(*)::int AS cnt FROM votes WHERE user_id = $1',
          [ephemeral.userId],
        );
        assert.equal(phantomCheck.rows[0]?.cnt, 0);

        // Stored upvotes/downvotes/score on every polygon must match ground-truth votes table
        const integrityRes = await pool.query<{
          id: string;
          upvotes: number;
          downvotes: number;
          score: number;
          actual_up: number;
          actual_down: number;
          actual_score: number;
        }>(
          `SELECT
             p.id,
             p.upvotes,
             p.downvotes,
             p.score,
             COALESCE(COUNT(*) FILTER (WHERE v.value = 1), 0)::int AS actual_up,
             COALESCE(COUNT(*) FILTER (WHERE v.value = -1), 0)::int AS actual_down,
             COALESCE(SUM(v.value), 0)::int AS actual_score
           FROM polygons p
           LEFT JOIN votes v ON v.polygon_id = p.id
           WHERE p.id = ANY($1::uuid[])
           GROUP BY p.id`,
          [[p1.id, p2.id, p3.id]],
        );
        assert.equal(integrityRes.rows.length, 3);
        for (const row of integrityRes.rows) {
          assert.equal(row.upvotes, row.actual_up);
          assert.equal(row.downvotes, row.actual_down);
          assert.equal(row.score, row.actual_score);
        }
      }
    } finally {
      await app.close();
    }
  });

  it('executes runAdminCommand for active & preemptive ban-user, delete-polygon, and redact-note, and rejects reset-recovery or malformed args', async () => {
    const config = loadEnvConfig({});
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
    });

    try {
      const citizen = await registerUser(app, 'GoodCitizen', '198.51.100.70');
      const neighbor = await registerUser(app, 'GoodNeighbor', '203.0.113.70');
      const abuser = await registerUser(app, 'SpamAbuser', '198.51.100.71');

      const citizenPoly = await createPolygonForUser(app, citizen.sessionToken, {
        offsetIndex: 1,
        note: 'Contact owner John Doe at +49-123-456789',
        remoteAddress: '198.51.100.70',
      });
      const citizenPolyToDelete = await createPolygonForUser(
        app,
        citizen.sessionToken,
        {
          offsetIndex: 2,
          note: 'Duplicate test polygon',
          remoteAddress: '198.51.100.70',
        },
      );
      const abuserPoly = await createPolygonForUser(app, abuser.sessionToken, {
        offsetIndex: 3,
        note: 'Vandalism spam polygon',
        remoteAddress: '198.51.100.71',
      });

      // Citizen self-vote is rejected with 403 FORBIDDEN_SELF_VOTE; neighbor upvotes citizenPoly (+1), citizen upvotes abuserPoly (+1), abuser downvotes citizenPoly (-1)
      const selfVoteAttempt = await app.inject({
        method: 'PUT',
        url: `/api/v1/polygons/${citizenPoly.id}/vote`,
        remoteAddress: '198.51.100.70',
        headers: { authorization: `Bearer ${citizen.sessionToken}` },
        payload: { value: 1 },
      });
      assert.equal(selfVoteAttempt.statusCode, 403);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(selfVoteAttempt.json()).error.code,
        'FORBIDDEN_SELF_VOTE',
      );
      await app.inject({
        method: 'PUT',
        url: `/api/v1/polygons/${citizenPoly.id}/vote`,
        remoteAddress: '203.0.113.70',
        headers: { authorization: `Bearer ${neighbor.sessionToken}` },
        payload: { value: 1 },
      });
      await app.inject({
        method: 'PUT',
        url: `/api/v1/polygons/${abuserPoly.id}/vote`,
        remoteAddress: '198.51.100.70',
        headers: { authorization: `Bearer ${citizen.sessionToken}` },
        payload: { value: 1 },
      });
      await app.inject({
        method: 'PUT',
        url: `/api/v1/polygons/${citizenPoly.id}/vote`,
        remoteAddress: '198.51.100.71',
        headers: { authorization: `Bearer ${abuser.sessionToken}` },
        payload: { value: -1 },
      });

      // Before ban: citizenPoly has upvotes=1, downvotes=1, score=0
      const beforeBanGet = await app.inject({
        method: 'GET',
        url: `/api/v1/polygons/${citizenPoly.id}`,
      });
      assert.equal(
        PolygonFeatureSchema.parse(beforeBanGet.json()).properties.score,
        0,
      );

      // 1) Active-user ban-user (case-insensitive lookup via app.runAdminCommand decorator)
      const activeBanResult: AdminCommandResult = await app.runAdminCommand([
        'ban-user',
        'spamabuser',
        'coordinated spam',
      ]);
      assert.equal(activeBanResult.command, 'ban-user');
      assert.equal(activeBanResult.deletedUser, true);
      assert.equal(activeBanResult.deletedPolygonCount, 1);
      assert.equal(activeBanResult.reason, 'coordinated spam');

      // Abuser's polygon was purged (404), session revoked (401), and citizenPoly score recomputed to +1
      const abuserPolyAfter = await app.inject({
        method: 'GET',
        url: `/api/v1/polygons/${abuserPoly.id}`,
      });
      assert.equal(abuserPolyAfter.statusCode, 404);

      const abuserMeAfter = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${abuser.sessionToken}` },
      });
      assert.equal(abuserMeAfter.statusCode, 401);

      const citizenPolyAfterBan = PolygonFeatureSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: `/api/v1/polygons/${citizenPoly.id}`,
          })
        ).json(),
      );
      assert.equal(citizenPolyAfterBan.properties.upvotes, 1);
      assert.equal(citizenPolyAfterBan.properties.downvotes, 0);
      assert.equal(citizenPolyAfterBan.properties.score, 1);

      // Re-registering banned active user fails with 403 FORBIDDEN_PSEUDONYM_BANNED
      const reRegActiveBanned = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: '198.51.100.72',
        payload: {
          pseudonym: 'SpamAbuser',
          email: 'fresh-spam@example.org',
          password: 'another-password-123',
          acceptedPrivacyPolicy: true,
          acceptedTerms: true,
        },
      });
      assert.equal(reRegActiveBanned.statusCode, 403);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(reRegActiveBanned.json()).error.code,
        'FORBIDDEN_PSEUDONYM_BANNED',
      );

      // Re-registering with the banned user's email under a new pseudonym creates no account
      // (generic 201 so the response does not reveal that the address is banned)
      const reRegBannedEmail = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: '198.51.100.72',
        payload: {
          pseudonym: 'FreshAlias99',
          email: 'spamabuser@example.org',
          password: 'another-password-123',
          acceptedPrivacyPolicy: true,
          acceptedTerms: true,
        },
      });
      assert.equal(reRegBannedEmail.statusCode, 201);
      const freshAlias = await pool.query(
        "SELECT 1 FROM users WHERE LOWER(pseudonym) = 'freshalias99'",
      );
      assert.equal(freshAlias.rowCount, 0);

      // 2) Preemptive ban-user (no users row exists, default reason -> 'banned')
      const preemptiveBanResult = await runAdminCommand(pool, [
        'ban-user',
        'PreemptiveTroll',
      ]);
      assert.equal(preemptiveBanResult.command, 'ban-user');
      assert.equal(preemptiveBanResult.deletedUser, false);
      assert.equal(preemptiveBanResult.deletedPolygonCount, 0);
      assert.equal(preemptiveBanResult.reason, 'banned');

      const regPreemptiveBanned = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: '198.51.100.73',
        payload: {
          pseudonym: 'preemptivetroll',
          email: 'troll@example.org',
          password: 'another-password-123',
          acceptedPrivacyPolicy: true,
          acceptedTerms: true,
        },
      });
      assert.equal(regPreemptiveBanned.statusCode, 403);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(regPreemptiveBanned.json()).error.code,
        'FORBIDDEN_PSEUDONYM_BANNED',
      );

      // Self-deleted user (409) upgraded to banned (403) when ban-user runs post-deletion
      const formerUser = await registerUser(app, 'FormerUser', '198.51.100.75');
      const selfDelRes = await app.inject({
        method: 'DELETE',
        url: '/api/v1/auth/me',
        remoteAddress: '198.51.100.75',
        headers: { authorization: `Bearer ${formerUser.sessionToken}` },
      });
      assert.equal(selfDelRes.statusCode, 204);

      const postSelfDelReg = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: '198.51.100.76',
        payload: {
          pseudonym: 'FormerUser',
          email: 'former2@example.org',
          password: 'another-password-123',
          acceptedPrivacyPolicy: true,
          acceptedTerms: true,
        },
      });
      assert.equal(postSelfDelReg.statusCode, 409);

      const upgradeBanRes = await runAdminCommand(pool, [
        'ban-user',
        'FormerUser',
        'post-delete abuse',
      ]);
      assert.equal(upgradeBanRes.deletedUser, false);
      assert.equal(upgradeBanRes.reason, 'post-delete abuse');

      const postBanUpgradeReg = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: '198.51.100.77',
        payload: {
          pseudonym: 'FormerUser',
          email: 'former3@example.org',
          password: 'another-password-123',
          acceptedPrivacyPolicy: true,
          acceptedTerms: true,
        },
      });
      assert.equal(postBanUpgradeReg.statusCode, 403);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(postBanUpgradeReg.json()).error.code,
        'FORBIDDEN_PSEUDONYM_BANNED',
      );

      // 3) redact-note sets note = NULL and advances updated_at while preserving geometry & votes
      const redactRes = await runAdminCommand(pool, [
        'redact-note',
        citizenPoly.id,
      ]);
      assert.equal(redactRes.command, 'redact-note');
      assert.equal(redactRes.polygonId, citizenPoly.id);
      assert.equal(redactRes.redactedNote, true);

      const afterRedact = PolygonFeatureSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: `/api/v1/polygons/${citizenPoly.id}`,
          })
        ).json(),
      );
      assert.equal(afterRedact.properties.note, null);
      assert.equal(afterRedact.properties.score, 1);
      assert.ok(
        Date.parse(afterRedact.properties.updatedAt) >=
          Date.parse(citizenPoly.properties.updatedAt),
      );

      // redact-note on missing UUID throws 404 NOT_FOUND
      await assert.rejects(
        () =>
          runAdminCommand(pool, [
            'redact-note',
            '00000000-0000-4000-8000-000000000404',
          ]),
        (err: unknown) =>
          err instanceof ApiError &&
          err.statusCode === 404 &&
          err.code === 'NOT_FOUND',
      );

      // 4) delete-polygon deletes target polygon and throws 404 when repeated
      const delPolyAdminRes = await runAdminCommand(pool, [
        'delete-polygon',
        citizenPolyToDelete.id,
      ]);
      assert.equal(delPolyAdminRes.command, 'delete-polygon');
      assert.equal(delPolyAdminRes.polygonId, citizenPolyToDelete.id);
      assert.equal(delPolyAdminRes.deletedPolygon, true);

      const checkDeletedPoly = await app.inject({
        method: 'GET',
        url: `/api/v1/polygons/${citizenPolyToDelete.id}`,
      });
      assert.equal(checkDeletedPoly.statusCode, 404);

      await assert.rejects(
        () => runAdminCommand(pool, ['delete-polygon', citizenPolyToDelete.id]),
        (err: unknown) =>
          err instanceof ApiError &&
          err.statusCode === 404 &&
          err.code === 'NOT_FOUND',
      );

      // 5) Zero reset-recovery takeover command & argument validation
      for (const badArgv of [
        [],
        ['reset-recovery', 'GoodCitizen'],
        ['reset-password', 'GoodCitizen'],
        ['ban-user'],
        ['ban-user', 'ab'],
        ['ban-user', 'deleted'],
        ['delete-polygon', 'not-a-uuid'],
        ['redact-note', 'not-a-uuid'],
      ]) {
        await assert.rejects(
          () => runAdminCommand(pool, badArgv),
          (err: unknown) =>
            err instanceof ApiError &&
            err.statusCode === 422 &&
            err.code === 'VALIDATION_ERROR',
          `Expected 422 VALIDATION_ERROR for argv=${JSON.stringify(badArgv)}`,
        );
      }

      // 6) Direct CLI execution via subprocess (`src/cli/admin.ts`) works end-to-end
      const adminCliPath = fileURLToPath(
        new URL('../src/cli/admin.ts', import.meta.url),
      );
      const apiRoot = path.resolve(path.dirname(adminCliPath), '../..');
      await execFileAsync(
        process.execPath,
        ['--import', 'tsx', adminCliPath, 'ban-user', 'CliBannedActor', 'cli-ban'],
        {
          cwd: apiRoot,
          env: { ...process.env, DATABASE_URL: config.databaseUrl },
        },
      );

      const cliBanRegRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: '198.51.100.74',
        payload: {
          pseudonym: 'CliBannedActor',
          email: 'clibanned@example.org',
          password: 'another-password-123',
          acceptedPrivacyPolicy: true,
          acceptedTerms: true,
        },
      });
      assert.equal(cliBanRegRes.statusCode, 403);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(cliBanRegRes.json()).error.code,
        'FORBIDDEN_PSEUDONYM_BANNED',
      );
    } finally {
      await app.close();
    }
  });

  it('GET /api/v1/auth/me/export returns only the caller\'s own data (GDPR Art. 15/20) and requires authentication', async () => {
    const config = loadEnvConfig({ PUBLIC_BASE_URL: 'https://unseal.example.org' });
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
    });
    try {
      const anonRes = await app.inject({ method: 'GET', url: '/api/v1/auth/me/export' });
      assert.equal(anonRes.statusCode, 401);

      const alice = await registerUser(app, 'ExportAlice', '198.51.100.81');
      const bob = await registerUser(app, 'ExportBob', '198.51.100.82');
      const alicePoly = await createPolygonForUser(app, alice.sessionToken, {
        offsetIndex: 0,
        note: 'Alice courtyard',
        remoteAddress: '198.51.100.81',
      });
      const bobPoly = await createPolygonForUser(app, bob.sessionToken, {
        offsetIndex: 3,
        note: 'Bob parking corner',
        remoteAddress: '198.51.100.82',
      });

      const voteRes = await app.inject({
        method: 'PUT',
        url: `/api/v1/polygons/${bobPoly.id}/vote`,
        remoteAddress: '198.51.100.81',
        headers: { authorization: `Bearer ${alice.sessionToken}` },
        payload: { value: 1 },
      });
      assert.equal(voteRes.statusCode, 200);
      const commentRes = await app.inject({
        method: 'POST',
        url: `/api/v1/polygons/${bobPoly.id}/comments`,
        remoteAddress: '198.51.100.81',
        headers: { authorization: `Bearer ${alice.sessionToken}` },
        payload: { body: 'Alice agrees with Bob' },
      });
      assert.equal(commentRes.statusCode, 201);
      const bobCommentRes = await app.inject({
        method: 'POST',
        url: `/api/v1/polygons/${alicePoly.id}/comments`,
        remoteAddress: '198.51.100.82',
        headers: { authorization: `Bearer ${bob.sessionToken}` },
        payload: { body: 'Bob comment that must not leak' },
      });
      assert.equal(bobCommentRes.statusCode, 201);

      const exportRes = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me/export',
        remoteAddress: '198.51.100.81',
        headers: { authorization: `Bearer ${alice.sessionToken}` },
      });
      assert.equal(exportRes.statusCode, 200);
      assert.equal(exportRes.headers['cache-control'], 'no-store');
      assert.match(
        String(exportRes.headers['content-disposition']),
        /^attachment; filename="unseal-data-export-\d{4}-\d{2}-\d{2}\.json"$/,
      );
      const data = exportRes.json() as {
        format: string;
        account: { pseudonym: string; email: string; lastActiveDate: string };
        sessions: unknown[];
        polygons: Array<{ id: string; note: string; geometry: { type: string } }>;
        comments: Array<{ body: string; polygonId: string }>;
        polygonVotes: Array<{ polygonId: string; value: number }>;
        polygonCreationTimestamps: string[];
      };
      assert.equal(data.format, 'unseal-user-data-export');
      assert.equal(data.account.pseudonym, 'ExportAlice');
      assert.equal(data.account.email, 'exportalice@example.org');
      assert.match(data.account.lastActiveDate, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(data.sessions.length >= 1);
      assert.deepEqual(data.polygons.map((p) => p.id), [alicePoly.id]);
      assert.equal(data.polygons[0]!.note, 'Alice courtyard');
      assert.equal(data.polygons[0]!.geometry.type, 'Polygon');
      assert.deepEqual(data.comments.map((c) => c.body), ['Alice agrees with Bob']);
      assert.deepEqual(data.polygonVotes, [
        { ...data.polygonVotes[0]!, polygonId: bobPoly.id, value: 1 },
      ]);
      assert.equal(data.polygonCreationTimestamps.length, 1);

      const raw = exportRes.body;
      for (const forbidden of [
        'ExportBob',
        'exportbob@example.org',
        'Bob parking corner',
        'Bob comment that must not leak',
        '$argon2',
      ]) {
        assert.equal(raw.includes(forbidden), false, `export must not contain ${forbidden}`);
      }
    } finally {
      await app.close();
    }
  });

  it('admin CLI export-user, set-email, rename-user and lift-ban support GDPR access/rectification requests', async () => {
    const config = loadEnvConfig({ PUBLIC_BASE_URL: 'https://unseal.example.org' });
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
    });
    try {
      const carla = await registerUser(app, 'CarlaRealName', '198.51.100.83');
      await registerUser(app, 'OtherCitizen', '198.51.100.84');
      const carlaPoly = await createPolygonForUser(app, carla.sessionToken, {
        offsetIndex: 1,
        remoteAddress: '198.51.100.83',
      });

      // export-user (by email) returns the same structure as the self-service download
      const exportResult = await app.runAdminCommand([
        'export-user',
        'CarlaRealName@example.org',
      ]);
      assert.equal(exportResult.command, 'export-user');
      assert.equal(exportResult.userExport?.account.pseudonym, 'CarlaRealName');
      assert.equal(exportResult.userExport?.polygons.length, 1);
      await assert.rejects(
        () => app.runAdminCommand(['export-user', 'nobody@example.org']),
        (err: unknown) => err instanceof ApiError && err.statusCode === 404,
      );

      // set-email: rejects addresses already in use, invalidates pending links
      await assert.rejects(
        () =>
          app.runAdminCommand(['set-email', 'CarlaRealName', 'othercitizen@example.org']),
        (err: unknown) => err instanceof ApiError && err.code === 'AUTH_EMAIL_TAKEN',
      );
      await pool.query(
        `INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at)
         VALUES ($1, 'reset_password', $2, NOW() + INTERVAL '1 hour')`,
        [carla.userId, Buffer.alloc(32, 7)],
      );
      const setEmailResult = await app.runAdminCommand([
        'set-email',
        'CarlaRealName',
        'Carla.New@Example.org',
      ]);
      assert.equal(setEmailResult.email, 'carla.new@example.org');
      const pendingTokens = await pool.query(
        'SELECT 1 FROM email_tokens WHERE user_id = $1 AND consumed_at IS NULL',
        [carla.userId],
      );
      assert.equal(pendingTokens.rowCount, 0);
      const loginNewEmail = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: '198.51.100.83',
        payload: { identifier: 'carla.new@example.org', password: 'valid-password-123' },
      });
      assert.equal(loginNewEmail.statusCode, 200);

      // rename-user: the old pseudonym is reserved against impersonation
      await assert.rejects(
        () => app.runAdminCommand(['rename-user', 'CarlaRealName', 'OtherCitizen']),
        (err: unknown) => err instanceof ApiError && err.code === 'AUTH_PSEUDONYM_TAKEN',
      );
      const renameResult = await app.runAdminCommand([
        'rename-user',
        'carla.new@example.org',
        'GreenCourtyard',
      ]);
      assert.equal(renameResult.pseudonym, 'GreenCourtyard');
      assert.equal(renameResult.previousPseudonym, 'CarlaRealName');
      const polyAfterRename = await app.inject({
        method: 'GET',
        url: `/api/v1/polygons/${carlaPoly.id}`,
      });
      assert.equal(polyAfterRename.statusCode, 200);
      assert.equal(
        PolygonFeatureSchema.parse(polyAfterRename.json()).properties.authorPseudonym,
        'GreenCourtyard',
      );
      const impersonationRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: '198.51.100.85',
        payload: {
          pseudonym: 'CarlaRealName',
          email: 'impostor@example.org',
          password: 'valid-password-123',
          acceptedPrivacyPolicy: true,
          acceptedTerms: true,
        },
      });
      assert.equal(impersonationRes.statusCode, 409);

      // lift-ban removes ban tombstones (keyed and legacy) but keeps self-deletion reservations
      await app.runAdminCommand(['ban-user', 'OtherCitizen', 'spam']);
      const liftResult = await app.runAdminCommand([
        'lift-ban',
        'OtherCitizen',
        'othercitizen@example.org',
      ]);
      assert.equal(liftResult.liftedPseudonymBans, 1);
      assert.ok((liftResult.liftedEmailBans ?? 0) >= 1);
      const reRegister = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: '198.51.100.86',
        payload: {
          pseudonym: 'OtherCitizen',
          email: 'othercitizen@example.org',
          password: 'valid-password-123',
          acceptedPrivacyPolicy: true,
          acceptedTerms: true,
        },
      });
      assert.equal(reRegister.statusCode, 201);
      const reRegistered = await pool.query(
        "SELECT 1 FROM users WHERE LOWER(pseudonym) = 'othercitizen'",
      );
      assert.equal(reRegistered.rowCount, 1, 'lifted ban must allow a real registration');
      const keepReservation = await app.runAdminCommand(['lift-ban', 'CarlaRealName']);
      assert.equal(keepReservation.liftedPseudonymBans, 0);
    } finally {
      await app.close();
    }
  });
});
