// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 OpenUnseal Contributors

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import {
  CLUSTER_LIMITS,
  PolygonClusterResponseSchema,
  RegisterResponseSchema,
  SessionResponseSchema,
} from '@openunseal/shared';

import { buildApp } from '../src/app.js';
import { loadEnvConfig } from '../src/config.js';
import { resetTestDb, setupTestDb } from '../src/db/testHarness.js';
import { createLogger } from '../src/logger.js';
import {
  computeMercatorSpacingMeters,
  mergeClusterCells,
  resolveClusterMode,
  resolveClusterZoomBucket,
  type RawClusterCell,
} from '../src/polygons/clusters.js';

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

describe('spatial polygon clustering helpers', () => {
  it('switches between bubble mode and city-dot mode at BUBBLE_MAX_ZOOM', () => {
    assert.equal(resolveClusterMode(6), 'bubble');
    assert.equal(resolveClusterMode(11.49), 'bubble');
    assert.equal(resolveClusterMode(CLUSTER_LIMITS.BUBBLE_MAX_ZOOM), 'dot');
    assert.equal(resolveClusterMode(13), 'dot');

    assert.equal(resolveClusterZoomBucket(2), CLUSTER_LIMITS.MIN_ZOOM);
    assert.equal(resolveClusterZoomBucket(6.8), 6);
    assert.equal(resolveClusterZoomBucket(19), CLUSTER_LIMITS.MAX_ZOOM);

    const z6 = computeMercatorSpacingMeters(6, CLUSTER_LIMITS.BUBBLE_SPACING_PX);
    const z12 = computeMercatorSpacingMeters(12, CLUSTER_LIMITS.CITY_DOT_SPACING_PX);
    assert.ok(z6 > z12 * 100);
  });

  it('merges nearby cells into amount bubbles while keeping distant cities separate and preserving dots', () => {
    const mainzA: RawClusterCell = {
      count: 3,
      sumMercX: 920_000 * 3,
      sumMercY: 6_446_000 * 3,
      sumLng: 8.265 * 3,
      sumLat: 50.0 * 3,
      minLng: 8.26,
      minLat: 49.995,
      maxLng: 8.27,
      maxLat: 50.005,
      samplePolygonId: null,
      sampleStatus: null,
      sampleScore: null,
      sampleIsAuthor: false,
    };
    const mainzB: RawClusterCell = {
      count: 2,
      sumMercX: 925_000 * 2,
      sumMercY: 6_448_000 * 2,
      sumLng: 8.31 * 2,
      sumLat: 50.01 * 2,
      minLng: 8.305,
      minLat: 50.008,
      maxLng: 8.315,
      maxLat: 50.012,
      samplePolygonId: null,
      sampleStatus: null,
      sampleScore: null,
      sampleIsAuthor: false,
    };
    const berlin: RawClusterCell = {
      count: 1,
      sumMercX: 1_492_000,
      sumMercY: 6_894_000,
      sumLng: 13.405,
      sumLat: 52.52,
      minLng: 13.404,
      minLat: 52.519,
      maxLng: 13.406,
      maxLat: 52.521,
      samplePolygonId: '11111111-1111-4111-8111-111111111111',
      sampleStatus: 'in_progress',
      sampleScore: 4,
      sampleIsAuthor: true,
    };

    const zoom6Spacing = computeMercatorSpacingMeters(6, CLUSTER_LIMITS.BUBBLE_SPACING_PX);
    const germanyBubbles = mergeClusterCells([mainzA, mainzB, berlin], {
      mergeRadiusM: zoom6Spacing,
      mode: 'bubble',
      maxClusters: CLUSTER_LIMITS.MAX_CLUSTERS,
    });
    assert.equal(germanyBubbles.length, 2);
    assert.equal(germanyBubbles[0]?.count, 5);
    assert.equal(germanyBubbles[0]?.kind, 'bubble');
    assert.equal(germanyBubbles[0]?.polygonId, null);
    assert.deepEqual(germanyBubbles[0]?.bbox, [8.26, 49.995, 8.315, 50.012]);
    assert.equal(germanyBubbles[1]?.count, 1);
    assert.equal(germanyBubbles[1]?.kind, 'bubble');
    assert.equal(germanyBubbles[1]?.id, '11111111-1111-4111-8111-111111111111');

    const cityDotSpacing = computeMercatorSpacingMeters(12, CLUSTER_LIMITS.CITY_DOT_SPACING_PX);
    const cityDots = mergeClusterCells([berlin], {
      mergeRadiusM: cityDotSpacing,
      mode: 'dot',
      maxClusters: CLUSTER_LIMITS.MAX_CLUSTERS,
    });
    assert.equal(cityDots.length, 1);
    assert.equal(cityDots[0]?.kind, 'dot');
    assert.equal(cityDots[0]?.status, 'in_progress');
    assert.equal(cityDots[0]?.score, 4);
    assert.equal(cityDots[0]?.isAuthor, true);
  });
});

async function registerVerifiedUser(
  app: FastifyInstance,
  pseudonym: string,
  remoteAddress: string,
): Promise<{ userId: string; sessionToken: string }> {
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
  const session = SessionResponseSchema.parse(loginRes.json());
  return { userId: session.user.id, sessionToken: session.sessionToken };
}

describe('GET /api/v1/polygons/clusters', () => {
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

  it('aggregates Germany-wide polygons into bubbles and city-view polygons into dots with filters', async () => {
    const config = loadEnvConfig({
      NODE_ENV: 'test',
      AUTH_CAPTCHA_REQUIRED: 'false',
      REQUIRE_JURISDICTION: 'off',
      CORS_ORIGINS: 'http://localhost:8081',
    });
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
    });

    try {
      const alice = await registerVerifiedUser(app, 'cluster_alice', '198.51.100.31');
      const bob = await registerVerifiedUser(app, 'cluster_bob', '198.51.100.32');

      const createPoly = async (
        token: string,
        lng: number,
        lat: number,
      ): Promise<string> => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/polygons',
          headers: { authorization: `Bearer ${token}` },
          payload: {
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [lng, lat],
                  [lng + 0.0002, lat],
                  [lng + 0.0002, lat + 0.0002],
                  [lng, lat + 0.0002],
                  [lng, lat],
                ],
              ],
            },
            surfaceType: 'asphalt',
            spaceType: 'public',
          },
        });
        assert.equal(res.statusCode, 201);
        return (res.json() as { id: string }).id;
      };

      // Two close polygons in Mainz + one distant polygon in Berlin
      await createPoly(alice.sessionToken, 8.265, 50.0);
      await createPoly(bob.sessionToken, 8.285, 50.005);
      await createPoly(bob.sessionToken, 13.405, 52.52);

      // Germany-wide zoom 6 -> 2 bubbles (Mainz=2, Berlin=1), totalCount=3
      const deRes = await app.inject({
        method: 'GET',
        url: '/api/v1/polygons/clusters?bbox=5.0,47.0,15.5,55.2&zoom=6',
      });
      assert.equal(deRes.statusCode, 200);
      const deBody = PolygonClusterResponseSchema.parse(deRes.json());
      assert.equal(deBody.mode, 'bubble');
      assert.equal(deBody.totalCount, 3);
      assert.equal(deBody.clusters.length, 2);
      assert.equal(deBody.clusters[0]?.count, 2);
      assert.equal(deBody.clusters[1]?.count, 1);

      // Whole city of Mainz at zoom 12.2 -> 2 individual dots
      const mainzRes = await app.inject({
        method: 'GET',
        url: '/api/v1/polygons/clusters?bbox=8.15,49.94,8.38,50.06&zoom=12.2',
      });
      assert.equal(mainzRes.statusCode, 200);
      const mainzBody = PolygonClusterResponseSchema.parse(mainzRes.json());
      assert.equal(mainzBody.mode, 'dot');
      assert.equal(mainzBody.totalCount, 2);
      assert.equal(mainzBody.clusters.length, 2);
      assert.ok(mainzBody.clusters.every((c) => c.kind === 'dot' && c.polygonId !== null));

      // mineOnly=true authenticated as Alice -> returns only Alice's 1 Mainz polygon
      const mineRes = await app.inject({
        method: 'GET',
        url: '/api/v1/polygons/clusters?bbox=5.0,47.0,15.5,55.2&zoom=6&mineOnly=true',
        headers: { authorization: `Bearer ${alice.sessionToken}` },
      });
      assert.equal(mineRes.statusCode, 200);
      const mineBody = PolygonClusterResponseSchema.parse(mineRes.json());
      assert.equal(mineBody.totalCount, 1);
      assert.equal(mineBody.clusters.length, 1);
      assert.equal(mineBody.clusters[0]?.isAuthor, true);
    } finally {
      await app.close();
    }
  });
});
