// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 OpenUnseal Contributors

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import {
  PersonalStatsResponseSchema,
  PolygonFeatureSchema,
  PublicStatsResponseSchema,
  RegisterResponseSchema,
  SessionResponseSchema,
} from '@openunseal/shared';

import { buildApp, runAdminCommand } from '../src/app.js';
import { loadEnvConfig } from '../src/config.js';
import { resetTestDb, setupTestDb } from '../src/db/testHarness.js';
import { createLogger } from '../src/logger.js';

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

function makeBoxRing(
  minLng: number,
  minLat: number,
  maxLng: number,
  maxLat: number,
): [number, number][] {
  return [
    [Number(minLng.toFixed(6)), Number(minLat.toFixed(6))],
    [Number(maxLng.toFixed(6)), Number(minLat.toFixed(6))],
    [Number(maxLng.toFixed(6)), Number(maxLat.toFixed(6))],
    [Number(minLng.toFixed(6)), Number(maxLat.toFixed(6))],
    [Number(minLng.toFixed(6)), Number(minLat.toFixed(6))],
  ];
}

async function registerTestUser(
  app: FastifyInstance,
  pseudonym: string,
  remoteAddress = '198.51.100.10',
): Promise<{ userId: string; pseudonym: string; sessionToken: string }> {
  const email = `${pseudonym.toLowerCase()}@example.org`;
  const regRes = await app.inject({
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
      password: 'valid-password-123',
    },
  });
  assert.equal(loginRes.statusCode, 200);
  const parsed = SessionResponseSchema.parse(loginRes.json());
  return {
    userId: parsed.user.id,
    pseudonym: parsed.user.pseudonym,
    sessionToken: parsed.sessionToken,
  };
}

describe('GDPR-Compliant Public & Personal Statistics Suite', () => {
  let pool: pg.Pool;
  let uploadsDir: string;

  before(async () => {
    pool = await setupTestDb();
    uploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stats-uploads-'));
  });

  beforeEach(async () => {
    await resetTestDb(pool);
  });

  after(async () => {
    if (pool) {
      await pool.end();
    }
    if (uploadsDir) {
      await fs.rm(uploadsDir, { recursive: true, force: true });
    }
  });

  it('serves accurate public and strictly isolated personal stats over existing polygons/votes, enforces 30-day default unrated pruning, and documents stats in /auth/privacy', async () => {
    const config = {
      ...loadEnvConfig({}),
      uploadsDir,
      authCaptchaEnabled: false,
      requireJurisdiction: 'off' as const,
    };
    assert.equal(config.staleUnratedPruneDays, 30);

    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
    });

    try {
      // 1) Empty DB: public stats all zeros; personal stats requires auth
      const emptyPubRes = await app.inject({
        method: 'GET',
        url: '/api/v1/stats',
      });
      assert.equal(emptyPubRes.statusCode, 200);
      assert.match(String(emptyPubRes.headers['cache-control']), /public/);
      const emptyPub = PublicStatsResponseSchema.parse(emptyPubRes.json());
      assert.equal(emptyPub.totalPolygons, 0);
      assert.equal(emptyPub.proposedCount, 0);
      assert.equal(emptyPub.inProgressCount, 0);
      assert.equal(emptyPub.finishedCount, 0);
      assert.equal(emptyPub.needsReviewCount, 0);
      assert.equal(emptyPub.totalAreaM2, 0);
      assert.equal(emptyPub.unsealedAreaM2, 0);
      assert.equal(emptyPub.totalVotes, 0);
      assert.equal(emptyPub.totalUpvotes, 0);
      assert.equal(emptyPub.totalDownvotes, 0);
      assert.deepEqual(emptyPub.surfaceBreakdown, {
        asphalt: { count: 0, areaM2: 0 },
        concrete: { count: 0, areaM2: 0 },
        pavers: { count: 0, areaM2: 0 },
        other: { count: 0, areaM2: 0 },
      });

      const unauthMeRes = await app.inject({
        method: 'GET',
        url: '/api/v1/stats/me',
      });
      assert.equal(unauthMeRes.statusCode, 401);

      // Privacy policy mentions 30-day default prune window and derived personal summary
      const privacyRes = await app.inject({
        method: 'GET',
        url: '/auth/privacy',
      });
      assert.equal(privacyRes.statusCode, 200);
      assert.match(privacyRes.body, /30 Tagen/);
      assert.match(privacyRes.body, /anonyme Gesamtzahlen/);

      // 2) Register users + admin
      const alice = await registerTestUser(app, 'AliceMapper', '198.51.100.30');
      const bob = await registerTestUser(app, 'BobMapper', '198.51.100.31');
      const admin = await registerTestUser(app, 'CityAdmin', '198.51.100.32');
      await runAdminCommand(pool, ['grant-admin', 'CityAdmin']);

      // Alice creates 2 polygons (asphalt + concrete)
      const aliceAsphaltRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        headers: { authorization: `Bearer ${alice.sessionToken}` },
        payload: {
          geometry: {
            type: 'Polygon',
            coordinates: [makeBoxRing(9.991, 53.551, 9.9912, 53.55115)],
          },
          surfaceType: 'asphalt',
          note: 'Alice asphalt lot',
        },
      });
      assert.equal(aliceAsphaltRes.statusCode, 201);
      const aliceAsphalt = PolygonFeatureSchema.parse(aliceAsphaltRes.json());

      const aliceConcreteRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        headers: { authorization: `Bearer ${alice.sessionToken}` },
        payload: {
          geometry: {
            type: 'Polygon',
            coordinates: [makeBoxRing(9.992, 53.551, 9.9922, 53.55115)],
          },
          surfaceType: 'concrete',
          note: 'Alice concrete yard',
        },
      });
      assert.equal(aliceConcreteRes.statusCode, 201);
      const aliceConcrete = PolygonFeatureSchema.parse(aliceConcreteRes.json());

      // Bob creates 2 polygons (pavers + other)
      const bobPaversRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        headers: { authorization: `Bearer ${bob.sessionToken}` },
        payload: {
          geometry: {
            type: 'Polygon',
            coordinates: [makeBoxRing(9.993, 53.551, 9.9932, 53.55115)],
          },
          surfaceType: 'pavers',
          note: 'Bob pavers lane',
        },
      });
      assert.equal(bobPaversRes.statusCode, 201);
      const bobPavers = PolygonFeatureSchema.parse(bobPaversRes.json());

      const bobOtherRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        headers: { authorization: `Bearer ${bob.sessionToken}` },
        payload: {
          geometry: {
            type: 'Polygon',
            coordinates: [makeBoxRing(9.994, 53.551, 9.9942, 53.55115)],
          },
          surfaceType: 'other',
          note: 'Bob mixed yard',
        },
      });
      assert.equal(bobOtherRes.statusCode, 201);
      const bobOther = PolygonFeatureSchema.parse(bobOtherRes.json());

      // Voting (polygon-only):
      // - Bob upvotes aliceAsphalt (+1)
      // - Admin upvotes aliceAsphalt (+1) and downvotes bobOther (-1)
      // - Alice upvotes bobPavers (+1) and downvotes bobOther (-1)
      await app.inject({
        method: 'PUT',
        url: `/api/v1/polygons/${aliceAsphalt.id}/vote`,
        headers: { authorization: `Bearer ${bob.sessionToken}` },
        payload: { value: 1 },
      });
      await app.inject({
        method: 'PUT',
        url: `/api/v1/polygons/${aliceAsphalt.id}/vote`,
        headers: { authorization: `Bearer ${admin.sessionToken}` },
        payload: { value: 1 },
      });
      await app.inject({
        method: 'PUT',
        url: `/api/v1/polygons/${bobOther.id}/vote`,
        headers: { authorization: `Bearer ${admin.sessionToken}` },
        payload: { value: -1 },
      });
      await app.inject({
        method: 'PUT',
        url: `/api/v1/polygons/${bobPavers.id}/vote`,
        headers: { authorization: `Bearer ${alice.sessionToken}` },
        payload: { value: 1 },
      });
      await app.inject({
        method: 'PUT',
        url: `/api/v1/polygons/${bobOther.id}/vote`,
        headers: { authorization: `Bearer ${alice.sessionToken}` },
        payload: { value: -1 },
      });

      // Admin marks aliceAsphalt -> 'finished' and bobPavers -> 'in_progress'
      const finRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/polygons/${aliceAsphalt.id}/status`,
        headers: { authorization: `Bearer ${admin.sessionToken}` },
        payload: { status: 'finished' },
      });
      assert.equal(finRes.statusCode, 200);

      const progRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/polygons/${bobPavers.id}/status`,
        headers: { authorization: `Bearer ${admin.sessionToken}` },
        payload: { status: 'in_progress' },
      });
      assert.equal(progRes.statusCode, 200);

      // Add a comment + comment upvote on bobOther to ensure comment votes do NOT pollute polygon vote counts
      const commentRes = await app.inject({
        method: 'POST',
        url: `/api/v1/polygons/${bobOther.id}/comments`,
        headers: { authorization: `Bearer ${bob.sessionToken}` },
        payload: { body: 'Needs inspection on site' },
      });
      assert.equal(commentRes.statusCode, 201);
      const commentId = (commentRes.json() as { id: string }).id;
      await app.inject({
        method: 'PUT',
        url: `/api/v1/polygons/${bobOther.id}/comments/${commentId}/vote`,
        headers: { authorization: `Bearer ${alice.sessionToken}` },
      });

      // 3) Verify Public Stats:
      // Existing: 4 polygons (aliceConcrete + bobOther = 2 proposed; bobPavers = 1 in_progress; aliceAsphalt = 1 finished)
      // Unrated proposed (needsReviewCount): ONLY aliceConcrete (1)
      // Votes: 3 upvotes + 2 downvotes = 5 total votes
      const pubRes = await app.inject({
        method: 'GET',
        url: '/api/v1/stats',
      });
      assert.equal(pubRes.statusCode, 200);
      const pub = PublicStatsResponseSchema.parse(pubRes.json());
      assert.equal(pub.totalPolygons, 4);
      assert.equal(pub.proposedCount, 2);
      assert.equal(pub.inProgressCount, 1);
      assert.equal(pub.finishedCount, 1);
      assert.equal(pub.needsReviewCount, 1);
      assert.equal(pub.totalUpvotes, 3);
      assert.equal(pub.totalDownvotes, 2);
      assert.equal(pub.totalVotes, 5);

      const expectedTotalArea =
        aliceAsphalt.properties.areaM2 +
        aliceConcrete.properties.areaM2 +
        bobPavers.properties.areaM2 +
        bobOther.properties.areaM2;
      assert.ok(Math.abs(pub.totalAreaM2 - expectedTotalArea) < 0.05);
      assert.ok(
        Math.abs(pub.unsealedAreaM2 - aliceAsphalt.properties.areaM2) < 0.05,
      );
      assert.equal(pub.surfaceBreakdown.asphalt.count, 1);
      assert.equal(pub.surfaceBreakdown.concrete.count, 1);
      assert.equal(pub.surfaceBreakdown.pavers.count, 1);
      assert.equal(pub.surfaceBreakdown.other.count, 1);

      // 4) Verify Personal Stats for Alice vs Bob (strictly private & isolated)
      const aliceStatsRes = await app.inject({
        method: 'GET',
        url: '/api/v1/stats/me',
        headers: { authorization: `Bearer ${alice.sessionToken}` },
      });
      assert.equal(aliceStatsRes.statusCode, 200);
      assert.equal(aliceStatsRes.headers['cache-control'], 'no-store');
      assert.equal(aliceStatsRes.headers['vary'], 'Authorization');
      const aliceStats = PersonalStatsResponseSchema.parse(aliceStatsRes.json());
      assert.equal(aliceStats.totalPolygons, 2);
      assert.equal(aliceStats.proposedCount, 1);
      assert.equal(aliceStats.inProgressCount, 0);
      assert.equal(aliceStats.finishedCount, 1);
      assert.equal(aliceStats.ratedPolygonsCount, 2); // rated bobPavers + bobOther (comment vote excluded!)
      assert.ok(
        Math.abs(
          aliceStats.totalAreaM2 -
            (aliceAsphalt.properties.areaM2 + aliceConcrete.properties.areaM2),
        ) < 0.05,
      );
      assert.ok(
        Math.abs(aliceStats.unsealedAreaM2 - aliceAsphalt.properties.areaM2) <
          0.05,
      );

      const bobStatsRes = await app.inject({
        method: 'GET',
        url: '/api/v1/stats/me',
        headers: { authorization: `Bearer ${bob.sessionToken}` },
      });
      assert.equal(bobStatsRes.statusCode, 200);
      const bobStats = PersonalStatsResponseSchema.parse(bobStatsRes.json());
      assert.equal(bobStats.totalPolygons, 2);
      assert.equal(bobStats.proposedCount, 1);
      assert.equal(bobStats.inProgressCount, 1);
      assert.equal(bobStats.finishedCount, 0);
      assert.equal(bobStats.unsealedAreaM2, 0);
      assert.equal(bobStats.ratedPolygonsCount, 1); // rated aliceAsphalt

      // 5) Verify 30-day unrated prune window & "what's there" consistency:
      // At 20 days old, aliceConcrete (unrated proposed) MUST survive default prune (30 days)
      await pool.query(
        `UPDATE polygons SET created_at = NOW() - INTERVAL '20 days' WHERE id = $1::uuid`,
        [aliceConcrete.id],
      );
      const pruneAt20 = await runAdminCommand(pool, ['prune-stale-polygons']);
      assert.equal(pruneAt20.deletedPolygonCount, 0);

      // At 31 days old, aliceConcrete is pruned -> immediately drops from both public and Alice's personal stats
      await pool.query(
        `UPDATE polygons SET created_at = NOW() - INTERVAL '31 days' WHERE id = $1::uuid`,
        [aliceConcrete.id],
      );
      const pruneAt31 = await runAdminCommand(pool, ['prune-stale-polygons']);
      assert.equal(pruneAt31.deletedPolygonCount, 1);
      assert.deepEqual(pruneAt31.prunedPolygonIds, [aliceConcrete.id]);

      const pubAfterPrune = PublicStatsResponseSchema.parse(
        (await app.inject({ method: 'GET', url: '/api/v1/stats' })).json(),
      );
      assert.equal(pubAfterPrune.totalPolygons, 3);
      assert.equal(pubAfterPrune.proposedCount, 1);
      assert.equal(pubAfterPrune.needsReviewCount, 0);
      assert.equal(pubAfterPrune.surfaceBreakdown.concrete.count, 0);

      const aliceAfterPrune = PersonalStatsResponseSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: '/api/v1/stats/me',
            headers: { authorization: `Bearer ${alice.sessionToken}` },
          })
        ).json(),
      );
      assert.equal(aliceAfterPrune.totalPolygons, 1);
      assert.equal(aliceAfterPrune.proposedCount, 0);
      assert.equal(aliceAfterPrune.finishedCount, 1);
    } finally {
      await app.close();
    }
  });
});
