// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Unseal Contributors

import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';

import {
  ApiErrorEnvelopeSchema,
  PolygonCollectionResponseSchema,
  ExportPolygonFeatureSchema,
  PolygonFeatureSchema,
  RegisterResponseSchema,
  SessionResponseSchema,
  type PolygonFeature,
} from '@entsiegelung/shared';

import {
  PolygonRepository,
  buildApp,
  registerPolygonRoutes,
} from '../src/app.js';
import { loadEnvConfig } from '../src/config.js';
import { resetTestDb, setupTestDb } from '../src/db/testHarness.js';
import { createLogger } from '../src/logger.js';
import { BoundedSemaphore } from '../src/util/semaphore.js';

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

// Counter-clockwise ~120 m² courtyard in Hamburg
const VALID_CCW_RING: [number, number][] = [
  [9.9937, 53.5511],
  [9.99385, 53.5511],
  [9.99385, 53.551208],
  [9.9937, 53.551208],
  [9.9937, 53.5511],
];

// Clockwise exterior ring with >6 decimal digits on coordinates
const VALID_CW_HIGH_PRECISION_RING: [number, number][] = [
  [9.99370012345, 53.55110098765],
  [9.99370012345, 53.55120843219],
  [9.99385065432, 53.55120843219],
  [9.99385065432, 53.55110098765],
  [9.99370012345, 53.55110098765],
];

function computeSignedPlanarArea(ring: readonly [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const curr = ring[i]!;
    const next = ring[i + 1]!;
    sum += curr[0] * next[1] - next[0] * curr[1];
  }
  return sum / 2;
}

function assertMaxSixDecimals(ring: readonly [number, number][]): void {
  for (const [lng, lat] of ring) {
    for (const coord of [lng, lat]) {
      const str = coord.toString();
      assert.doesNotMatch(str, /e/i, `Unexpected scientific notation: ${str}`);
      const dotIdx = str.indexOf('.');
      if (dotIdx !== -1) {
        const decimals = str.length - dotIdx - 1;
        assert.ok(
          decimals <= 6,
          `Expected <= 6 decimal places, received ${decimals} in ${str}`,
        );
      }
    }
  }
}

async function registerTestUser(
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
  const parsed = SessionResponseSchema.parse(loginRes.json());
  return {
    userId: parsed.user.id,
    pseudonym: parsed.user.pseudonym,
    sessionToken: parsed.sessionToken,
  };
}

describe('PPGIS-4: PostGIS polygon CRUD, authoritative validation, span/sliver caps, and streamed GeoJSON export', () => {
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

  it('POST /api/v1/polygons requires auth (401), normalizes clockwise rings to CCW RFC 7946 winding, rounds to <= 6 decimals, and sets properties.id === id', async () => {
    assert.equal(typeof PolygonRepository, 'function');
    assert.equal(typeof registerPolygonRoutes, 'function');

    const config = loadEnvConfig({});
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
    });

    try {
      // Unauthenticated -> 401 AUTH_REQUIRED
      const unauthRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        payload: {
          geometry: { type: 'Polygon', coordinates: [VALID_CCW_RING] },
          surfaceType: 'asphalt',
          note: 'Parking corner',
        },
      });
      assert.equal(unauthRes.statusCode, 401);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(unauthRes.json()).error.code,
        'AUTH_REQUIRED',
      );

      // Invalid bearer token -> 401 AUTH_REQUIRED
      const badTokenRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        headers: { authorization: 'Bearer invalid-session-token' },
        payload: {
          geometry: { type: 'Polygon', coordinates: [VALID_CCW_RING] },
          surfaceType: 'asphalt',
        },
      });
      assert.equal(badTokenRes.statusCode, 401);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(badTokenRes.json()).error.code,
        'AUTH_REQUIRED',
      );

      const alice = await registerTestUser(app, 'AliceMapper', '198.51.100.11');

      // Confirm input ring is clockwise (signed planar area < 0)
      assert.ok(computeSignedPlanarArea(VALID_CW_HIGH_PRECISION_RING) < 0);

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        remoteAddress: '198.51.100.11',
        headers: { authorization: `Bearer ${alice.sessionToken}` },
        payload: {
          geometry: {
            type: 'Polygon',
            coordinates: [VALID_CW_HIGH_PRECISION_RING],
          },
          surfaceType: 'asphalt',
          note: 'Sealed parking courtyard behind library',
        },
      });
      assert.equal(createRes.statusCode, 201);
      const created = PolygonFeatureSchema.parse(createRes.json());
      assert.equal(created.id, created.properties.id);
      assert.equal(created.properties.surfaceType, 'asphalt');
      assert.equal(
        created.properties.note,
        'Sealed parking courtyard behind library',
      );
      assert.equal(created.properties.authorPseudonym, 'AliceMapper');
      assert.equal(created.properties.isAuthor, true);
      assert.equal(created.properties.myVote, 0);
      assert.equal(created.properties.upvotes, 0);
      assert.equal(created.properties.downvotes, 0);
      assert.equal(created.properties.score, 0);
      assert.ok(created.properties.areaM2 > 110 && created.properties.areaM2 < 130);

      const outputRing = created.geometry.coordinates[0]!;
      assert.equal(outputRing.length, 5);
      // Normalized to counter-clockwise RFC 7946 right-hand rule (signed planar area > 0)
      assert.ok(
        computeSignedPlanarArea(outputRing) > 0,
        'Expected ST_ForcePolygonCCW to orient exterior ring counter-clockwise',
      );
      assertMaxSixDecimals(outputRing);
    } finally {
      await app.close();
    }
  });

  it('POST /api/v1/polygons rejects > 0.05° slivers (422 VALIDATION_ERROR), interior holes, bow-tie crossings (422 GEOMETRY_INVALID with Self-intersection + location), and < 2 m² / > 500,000 m² areas (422 AREA_OUT_OF_BOUNDS)', async () => {
    const config = loadEnvConfig({});
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
    });

    try {
      const user = await registerTestUser(app, 'GeoValidator', '198.51.100.20');
      const authHeader = { authorization: `Bearer ${user.sessionToken}` };

      // 1. Continental sliver > 0.05° span -> 422 VALIDATION_ERROR
      const sliverRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        remoteAddress: '198.51.100.20',
        headers: authHeader,
        payload: {
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [9.95, 53.5511],
                [10.01, 53.5511], // 0.06° > 0.05°
                [10.01, 53.5512],
                [9.95, 53.5512],
                [9.95, 53.5511],
              ],
            ],
          },
          surfaceType: 'concrete',
        },
      });
      assert.equal(sliverRes.statusCode, 422);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(sliverRes.json()).error.code,
        'VALIDATION_ERROR',
      );

      // 2. Polygon with interior hole -> 422 VALIDATION_ERROR
      const holeRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        remoteAddress: '198.51.100.20',
        headers: authHeader,
        payload: {
          geometry: {
            type: 'Polygon',
            coordinates: [
              VALID_CCW_RING,
              [
                [9.99374, 53.55113],
                [9.99380, 53.55113],
                [9.99380, 53.55117],
                [9.99374, 53.55117],
                [9.99374, 53.55113],
              ],
            ],
          },
          surfaceType: 'concrete',
        },
      });
      assert.equal(holeRes.statusCode, 422);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(holeRes.json()).error.code,
        'VALIDATION_ERROR',
      );

      // 3. Latitude > 85° -> 422 VALIDATION_ERROR
      const polarRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        remoteAddress: '198.51.100.20',
        headers: authHeader,
        payload: {
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [9.9937, 85.1],
                [9.9939, 85.1],
                [9.9939, 85.2],
                [9.9937, 85.2],
                [9.9937, 85.1],
              ],
            ],
          },
          surfaceType: 'other',
        },
      });
      assert.equal(polarRes.statusCode, 422);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(polarRes.json()).error.code,
        'VALIDATION_ERROR',
      );

      // 4. Bow-tie self-intersection -> 422 GEOMETRY_INVALID with Self-intersection and [lng, lat] location
      const bowTieRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        remoteAddress: '198.51.100.20',
        headers: authHeader,
        payload: {
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [9.9930, 53.5510],
                [9.9936, 53.5516],
                [9.9930, 53.5516],
                [9.9936, 53.5510],
                [9.9930, 53.5510],
              ],
            ],
          },
          surfaceType: 'asphalt',
        },
      });
      assert.equal(bowTieRes.statusCode, 422);
      const bowTieErr = ApiErrorEnvelopeSchema.parse(bowTieRes.json());
      assert.equal(bowTieErr.error.code, 'GEOMETRY_INVALID');
      assert.match(bowTieErr.error.message, /Self-intersection/i);
      const bowTieDetails = bowTieErr.error.details as {
        reason?: unknown;
        location?: unknown;
      };
      assert.equal(typeof bowTieDetails, 'object');
      assert.notEqual(bowTieDetails, null);
      assert.match(String(bowTieDetails.reason), /Self-intersection/i);
      assert.ok(Array.isArray(bowTieDetails.location));
      assert.equal(bowTieDetails.location.length, 2);
      const [crossLng, crossLat] = bowTieDetails.location as [number, number];
      assert.ok(Math.abs(crossLng - 9.9933) < 1e-4);
      assert.ok(Math.abs(crossLat - 53.5513) < 1e-4);

      // 5. Area < 2 m² (~0.25 m²) -> 422 AREA_OUT_OF_BOUNDS with { areaM2 }
      const tinyRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        remoteAddress: '198.51.100.20',
        headers: authHeader,
        payload: {
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [9.9937, 53.5511],
                [9.993707, 53.5511],
                [9.993707, 53.551104],
                [9.9937, 53.551104],
                [9.9937, 53.5511],
              ],
            ],
          },
          surfaceType: 'pavers',
        },
      });
      assert.equal(tinyRes.statusCode, 422);
      const tinyErr = ApiErrorEnvelopeSchema.parse(tinyRes.json());
      assert.equal(tinyErr.error.code, 'AREA_OUT_OF_BOUNDS');
      const tinyDetails = tinyErr.error.details as { areaM2?: unknown };
      assert.equal(typeof tinyDetails?.areaM2, 'number');
      assert.ok((tinyDetails.areaM2 as number) < 2);

      // 6. Area > 500,000 m² within <= 0.05° span (0.04° x 0.04° ~ 11.7M m²) -> 422 AREA_OUT_OF_BOUNDS with { areaM2 }
      const hugeRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        remoteAddress: '198.51.100.20',
        headers: authHeader,
        payload: {
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [9.97, 53.53],
                [10.01, 53.53],
                [10.01, 53.57],
                [9.97, 53.57],
                [9.97, 53.53],
              ],
            ],
          },
          surfaceType: 'asphalt',
        },
      });
      assert.equal(hugeRes.statusCode, 422);
      const hugeErr = ApiErrorEnvelopeSchema.parse(hugeRes.json());
      assert.equal(hugeErr.error.code, 'AREA_OUT_OF_BOUNDS');
      const hugeDetails = hugeErr.error.details as { areaM2?: unknown };
      assert.equal(typeof hugeDetails?.areaM2, 'number');
      assert.ok((hugeDetails.areaM2 as number) > 500_000);

      // Verify rejected writes did not consume daily quota in polygon_creations
      const quotaRes = await pool.query<{ cnt: number }>(
        'SELECT COUNT(*)::int AS cnt FROM polygon_creations WHERE user_id = $1',
        [user.userId],
      );
      assert.equal(quotaRes.rows[0]!.cnt, 0);
    } finally {
      await app.close();
    }
  });

  it('enforces non-refundable 25 creations per 24h via polygon_creations even after deleting earlier polygons (429 RATE_LIMITED)', async () => {
    const config = loadEnvConfig({});
    assert.equal(config.maxDailyPolygonsPerUser, 25);
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
    });

    try {
      const user = await registerTestUser(app, 'QuotaTester', '198.51.100.30');
      const otherUser = await registerTestUser(app, 'OtherMapper', '198.51.100.31');
      const createdIds: string[] = [];

      // Create 25 valid polygons
      for (let i = 0; i < 25; i++) {
        const offset = i * 0.0002;
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/polygons',
          remoteAddress: '198.51.100.30',
          headers: { authorization: `Bearer ${user.sessionToken}` },
          payload: {
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [9.99 + offset, 53.5511],
                  [9.99015 + offset, 53.5511],
                  [9.99015 + offset, 53.551208],
                  [9.99 + offset, 53.551208],
                  [9.99 + offset, 53.5511],
                ],
              ],
            },
            surfaceType: 'concrete',
            note: `Proposal #${i + 1}`,
          },
        });
        assert.equal(res.statusCode, 201, `Expected 201 on creation #${i + 1}`);
        createdIds.push(PolygonFeatureSchema.parse(res.json()).id);
      }

      // Delete 5 of the created polygons
      for (let i = 0; i < 5; i++) {
        const delRes = await app.inject({
          method: 'DELETE',
          url: `/api/v1/polygons/${createdIds[i]}`,
          remoteAddress: '198.51.100.30',
          headers: { authorization: `Bearer ${user.sessionToken}` },
        });
        assert.equal(delRes.statusCode, 204);
      }

      // Verify polygons count is 20 while polygon_creations remains 25
      const dbCounts = await pool.query<{
        poly_cnt: number;
        creations_cnt: number;
      }>(
        `SELECT
           (SELECT COUNT(*)::int FROM polygons WHERE user_id = $1) AS poly_cnt,
           (SELECT COUNT(*)::int FROM polygon_creations WHERE user_id = $1) AS creations_cnt`,
        [user.userId],
      );
      assert.equal(dbCounts.rows[0]!.poly_cnt, 20);
      assert.equal(dbCounts.rows[0]!.creations_cnt, 25);

      // 26th creation within 24h MUST fail with 429 RATE_LIMITED (delete does not refund quota)
      const res26 = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        remoteAddress: '198.51.100.30',
        headers: { authorization: `Bearer ${user.sessionToken}` },
        payload: {
          geometry: {
            type: 'Polygon',
            coordinates: [VALID_CCW_RING.map(([lng, lat]) => [lng, lat + 0.002])],
          },
          surfaceType: 'asphalt',
        },
      });
      assert.equal(res26.statusCode, 429);
      const err26 = ApiErrorEnvelopeSchema.parse(res26.json());
      assert.equal(err26.error.code, 'RATE_LIMITED');

      // Independent second user is unaffected
      const otherCreate = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        remoteAddress: '198.51.100.31',
        headers: { authorization: `Bearer ${otherUser.sessionToken}` },
        payload: {
          geometry: {
            type: 'Polygon',
            coordinates: [VALID_CCW_RING.map(([lng, lat]) => [lng, lat + 0.004])],
          },
          surfaceType: 'pavers',
        },
      });
      assert.equal(otherCreate.statusCode, 201);

      // Aging one polygon_creations row past 24h frees 1 slot
      await pool.query(
        `UPDATE polygon_creations
         SET created_at = NOW() - INTERVAL '25 hours'
         WHERE id = (
           SELECT id FROM polygon_creations WHERE user_id = $1 ORDER BY id ASC LIMIT 1
         )`,
        [user.userId],
      );

      const afterWindowRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        remoteAddress: '198.51.100.32',
        headers: { authorization: `Bearer ${user.sessionToken}` },
        payload: {
          geometry: {
            type: 'Polygon',
            coordinates: [VALID_CCW_RING.map(([lng, lat]) => [lng, lat + 0.006])],
          },
          surfaceType: 'asphalt',
        },
      });
      assert.equal(afterWindowRes.statusCode, 201);
    } finally {
      await app.close();
    }
  });

  it('GET /api/v1/polygons validates bbox vs > 0.15° span, emits Vary/Cache-Control, orders by score DESC, attaches myVote/isAuthor, handles deleted authors, and sets meta.truncated past 500 rows', async () => {
    const config = loadEnvConfig({});
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
    });

    try {
      // Malformed / missing / inverted bbox -> 422 VALIDATION_ERROR
      for (const badQuery of [
        '/api/v1/polygons',
        '/api/v1/polygons?bbox=invalid',
        '/api/v1/polygons?bbox=9.99,53.55,9.98,53.56',
        '/api/v1/polygons?bbox=9.98,53.56,9.99,53.55',
      ]) {
        const res = await app.inject({ method: 'GET', url: badQuery });
        assert.equal(res.statusCode, 422, `Expected 422 for ${badQuery}`);
        assert.equal(
          ApiErrorEnvelopeSchema.parse(res.json()).error.code,
          'VALIDATION_ERROR',
        );
      }

      // Span > 0.15° -> 422 BBOX_TOO_LARGE
      const wideRes = await app.inject({
        method: 'GET',
        url: '/api/v1/polygons?bbox=9.90,53.50,10.06,53.55',
      });
      assert.equal(wideRes.statusCode, 422);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(wideRes.json()).error.code,
        'BBOX_TOO_LARGE',
      );

      const alice = await registerTestUser(app, 'AliceAuthor', '198.51.100.40');
      const bob = await registerTestUser(app, 'BobVoter', '198.51.100.41');

      const createPoly = async (
        token: string,
        lngBase: number,
        latBase: number,
        note: string,
      ): Promise<PolygonFeature> => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/polygons',
          headers: { authorization: `Bearer ${token}` },
          payload: {
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [lngBase + 0.000000123, latBase + 0.000000987],
                  [lngBase + 0.000150456, latBase + 0.000000987],
                  [lngBase + 0.000150456, latBase + 0.000108321],
                  [lngBase + 0.000000123, latBase + 0.000108321],
                  [lngBase + 0.000000123, latBase + 0.000000987],
                ],
              ],
            },
            surfaceType: 'asphalt',
            note,
          },
        });
        assert.equal(res.statusCode, 201);
        return PolygonFeatureSchema.parse(res.json());
      };

      const polyLow = await createPoly(alice.sessionToken, 9.9930, 53.5510, 'Low score');
      const polyHigh = await createPoly(bob.sessionToken, 9.9935, 53.5510, 'High score');
      // Outside viewport polygon in Berlin
      await createPoly(alice.sessionToken, 13.4050, 52.5200, 'Berlin polygon');

      // Seed votes directly in DB to verify score ordering and myVote projection
      await pool.query(
        `INSERT INTO votes (polygon_id, user_id, value)
         VALUES ($1, $2, -1), ($3, $4, 1)`,
        [polyLow.id, bob.userId, polyHigh.id, alice.userId],
      );
      await pool.query('UPDATE polygons SET downvotes = 1, score = -1 WHERE id = $1', [
        polyLow.id,
      ]);
      await pool.query('UPDATE polygons SET upvotes = 1, score = 1 WHERE id = $1', [
        polyHigh.id,
      ]);

      // Anonymous viewport GET: Vary: Authorization + Cache-Control: public, max-age=5
      const anonRes = await app.inject({
        method: 'GET',
        url: '/api/v1/polygons?bbox=9.9900,53.5500,10.0000,53.5600',
      });
      assert.equal(anonRes.statusCode, 200);
      assert.match(String(anonRes.headers['vary']), /Authorization/i);
      assert.equal(anonRes.headers['cache-control'], 'public, max-age=5');

      const anonCollection = PolygonCollectionResponseSchema.parse(anonRes.json());
      assert.equal(anonCollection.meta.truncated, false);
      assert.equal(anonCollection.meta.limit, 500);
      assert.equal(anonCollection.features.length, 2);
      assert.equal(anonCollection.features[0]!.id, polyHigh.id);
      assert.equal(anonCollection.features[1]!.id, polyLow.id);
      for (const feat of anonCollection.features) {
        assert.equal(feat.id, feat.properties.id);
        assert.equal(feat.properties.myVote, 0);
        assert.equal(feat.properties.isAuthor, false);
        assertMaxSixDecimals(feat.geometry.coordinates[0]!);
      }

      // Authenticated viewport GET (Alice): Vary: Authorization + Cache-Control: no-store
      const aliceRes = await app.inject({
        method: 'GET',
        url: '/api/v1/polygons?bbox=9.9900,53.5500,10.0000,53.5600',
        headers: { authorization: `Bearer ${alice.sessionToken}` },
      });
      assert.equal(aliceRes.statusCode, 200);
      assert.match(String(aliceRes.headers['vary']), /Authorization/i);
      assert.equal(aliceRes.headers['cache-control'], 'no-store');

      const aliceCollection = PolygonCollectionResponseSchema.parse(aliceRes.json());
      assert.equal(aliceCollection.features[0]!.id, polyHigh.id);
      assert.equal(aliceCollection.features[0]!.properties.myVote, 1);
      assert.equal(aliceCollection.features[0]!.properties.isAuthor, false);
      assert.equal(aliceCollection.features[1]!.id, polyLow.id);
      assert.equal(aliceCollection.features[1]!.properties.myVote, 0);
      assert.equal(aliceCollection.features[1]!.properties.isAuthor, true);

      // Alice deletes her account -> polyLow remains public under authorPseudonym: "deleted"
      const delAliceRes = await app.inject({
        method: 'DELETE',
        url: '/api/v1/auth/me',
        remoteAddress: '198.51.100.40',
        headers: { authorization: `Bearer ${alice.sessionToken}` },
      });
      assert.equal(delAliceRes.statusCode, 204);

      const afterDeleteRes = await app.inject({
        method: 'GET',
        url: `/api/v1/polygons/${polyLow.id}`,
      });
      assert.equal(afterDeleteRes.statusCode, 200);
      const afterDeleteFeature = PolygonFeatureSchema.parse(afterDeleteRes.json());
      assert.equal(afterDeleteFeature.properties.authorPseudonym, 'deleted');
      assert.equal(afterDeleteFeature.properties.isAuthor, false);

      // Bulk-seed 500 additional polygons inside bbox (total 502 > 500) to prove meta.truncated: true
      await pool.query(
        `INSERT INTO polygons (user_id, geom, surface_type, note, area_m2, score)
         SELECT
           $1,
           ST_MakeEnvelope(
             9.9910 + (g % 25) * 0.0002,
             53.5520 + (g / 25) * 0.0002,
             9.9911 + (g % 25) * 0.0002,
             53.5521 + (g / 25) * 0.0002,
             4326
           ),
           'concrete',
           'Seeded #' || g,
           50.0,
           0
         FROM generate_series(1, 500) AS g`,
        [bob.userId],
      );

      const truncRes = await app.inject({
        method: 'GET',
        url: '/api/v1/polygons?bbox=9.9900,53.5500,10.0000,53.5600',
      });
      assert.equal(truncRes.statusCode, 200);
      const truncCollection = PolygonCollectionResponseSchema.parse(truncRes.json());
      assert.equal(truncCollection.features.length, 500);
      assert.equal(truncCollection.meta.truncated, true);
      assert.equal(truncCollection.meta.limit, 500);
    } finally {
      await app.close();
    }
  });

  it('GET/PATCH/DELETE /api/v1/polygons/:id enforce 422 invalid UUID, 404 missing, 403 non-author, 422 geometry on PATCH, note clearing, and vote cascade', async () => {
    const config = loadEnvConfig({});
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
    });

    try {
      const author = await registerTestUser(app, 'OwnerMapper', '198.51.100.50');
      const stranger = await registerTestUser(app, 'OtherVisitor', '198.51.100.51');

      // Invalid UUID on GET / PATCH / DELETE -> 422 VALIDATION_ERROR
      const badGet = await app.inject({
        method: 'GET',
        url: '/api/v1/polygons/not-a-valid-uuid',
      });
      assert.equal(badGet.statusCode, 422);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(badGet.json()).error.code,
        'VALIDATION_ERROR',
      );

      const badPatch = await app.inject({
        method: 'PATCH',
        url: '/api/v1/polygons/not-a-valid-uuid',
        headers: { authorization: `Bearer ${author.sessionToken}` },
        payload: { surfaceType: 'concrete' },
      });
      assert.equal(badPatch.statusCode, 422);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(badPatch.json()).error.code,
        'VALIDATION_ERROR',
      );

      const badDelete = await app.inject({
        method: 'DELETE',
        url: '/api/v1/polygons/not-a-valid-uuid',
        headers: { authorization: `Bearer ${author.sessionToken}` },
      });
      assert.equal(badDelete.statusCode, 422);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(badDelete.json()).error.code,
        'VALIDATION_ERROR',
      );

      // Missing UUID -> 404 NOT_FOUND on GET / PATCH / DELETE
      const missingUuid = '00000000-0000-4000-8000-000000000099';
      const missingGet = await app.inject({
        method: 'GET',
        url: `/api/v1/polygons/${missingUuid}`,
      });
      assert.equal(missingGet.statusCode, 404);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(missingGet.json()).error.code,
        'NOT_FOUND',
      );

      const missingPatch = await app.inject({
        method: 'PATCH',
        url: `/api/v1/polygons/${missingUuid}`,
        headers: { authorization: `Bearer ${author.sessionToken}` },
        payload: { surfaceType: 'concrete' },
      });
      assert.equal(missingPatch.statusCode, 404);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(missingPatch.json()).error.code,
        'NOT_FOUND',
      );

      const missingDelete = await app.inject({
        method: 'DELETE',
        url: `/api/v1/polygons/${missingUuid}`,
        headers: { authorization: `Bearer ${author.sessionToken}` },
      });
      assert.equal(missingDelete.statusCode, 404);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(missingDelete.json()).error.code,
        'NOT_FOUND',
      );

      // Author creates a polygon
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        headers: { authorization: `Bearer ${author.sessionToken}` },
        payload: {
          geometry: { type: 'Polygon', coordinates: [VALID_CCW_RING] },
          surfaceType: 'asphalt',
          note: 'Initial courtyard note',
        },
      });
      assert.equal(createRes.statusCode, 201);
      const created = PolygonFeatureSchema.parse(createRes.json());

      // Seed author self-upvote + stranger upvote
      await pool.query(
        `INSERT INTO votes (polygon_id, user_id, value)
         VALUES ($1, $2, 1), ($1, $3, 1)`,
        [created.id, author.userId, stranger.userId],
      );
      await pool.query('UPDATE polygons SET upvotes = 2, score = 2 WHERE id = $1', [
        created.id,
      ]);

      // GET /:id headers & viewer flags
      const anonDetail = await app.inject({
        method: 'GET',
        url: `/api/v1/polygons/${created.id}`,
      });
      assert.equal(anonDetail.statusCode, 200);
      assert.match(String(anonDetail.headers['vary']), /Authorization/i);
      assert.equal(anonDetail.headers['cache-control'], 'public, max-age=5');
      assert.equal(
        PolygonFeatureSchema.parse(anonDetail.json()).properties.isAuthor,
        false,
      );

      const authDetail = await app.inject({
        method: 'GET',
        url: `/api/v1/polygons/${created.id}`,
        headers: { authorization: `Bearer ${author.sessionToken}` },
      });
      assert.equal(authDetail.statusCode, 200);
      assert.match(String(authDetail.headers['vary']), /Authorization/i);
      assert.equal(authDetail.headers['cache-control'], 'no-store');
      const authDetailFeature = PolygonFeatureSchema.parse(authDetail.json());
      assert.equal(authDetailFeature.properties.isAuthor, true);
      assert.equal(authDetailFeature.properties.myVote, 1);

      // PATCH containing geometry -> 422 VALIDATION_ERROR
      const geomPatch = await app.inject({
        method: 'PATCH',
        url: `/api/v1/polygons/${created.id}`,
        headers: { authorization: `Bearer ${author.sessionToken}` },
        payload: {
          surfaceType: 'concrete',
          geometry: { type: 'Polygon', coordinates: [VALID_CCW_RING] },
        },
      });
      assert.equal(geomPatch.statusCode, 422);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(geomPatch.json()).error.code,
        'VALIDATION_ERROR',
      );

      // Empty PATCH {} -> 422 VALIDATION_ERROR
      const emptyPatch = await app.inject({
        method: 'PATCH',
        url: `/api/v1/polygons/${created.id}`,
        headers: { authorization: `Bearer ${author.sessionToken}` },
        payload: {},
      });
      assert.equal(emptyPatch.statusCode, 422);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(emptyPatch.json()).error.code,
        'VALIDATION_ERROR',
      );

      // Non-author PATCH & DELETE -> 403 FORBIDDEN_NOT_AUTHOR
      const nonAuthorPatch = await app.inject({
        method: 'PATCH',
        url: `/api/v1/polygons/${created.id}`,
        headers: { authorization: `Bearer ${stranger.sessionToken}` },
        payload: { surfaceType: 'pavers' },
      });
      assert.equal(nonAuthorPatch.statusCode, 403);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(nonAuthorPatch.json()).error.code,
        'FORBIDDEN_NOT_AUTHOR',
      );

      const nonAuthorDelete = await app.inject({
        method: 'DELETE',
        url: `/api/v1/polygons/${created.id}`,
        headers: { authorization: `Bearer ${stranger.sessionToken}` },
      });
      assert.equal(nonAuthorDelete.statusCode, 403);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(nonAuthorDelete.json()).error.code,
        'FORBIDDEN_NOT_AUTHOR',
      );

      // Valid author PATCH updates surfaceType, note, and updatedAt while preserving score & myVote
      const okPatch = await app.inject({
        method: 'PATCH',
        url: `/api/v1/polygons/${created.id}`,
        headers: { authorization: `Bearer ${author.sessionToken}` },
        payload: { surfaceType: 'pavers', note: 'Updated permeable pavers proposal' },
      });
      assert.equal(okPatch.statusCode, 200);
      const patched = PolygonFeatureSchema.parse(okPatch.json());
      assert.equal(patched.properties.surfaceType, 'pavers');
      assert.equal(patched.properties.note, 'Updated permeable pavers proposal');
      assert.equal(patched.properties.score, 2);
      assert.equal(patched.properties.myVote, 1);
      assert.equal(patched.properties.isAuthor, true);
      assert.ok(
        Date.parse(patched.properties.updatedAt) >=
          Date.parse(created.properties.updatedAt),
      );

      // Clearing note via empty string "" -> null, and via null -> null
      const clearEmptyStr = await app.inject({
        method: 'PATCH',
        url: `/api/v1/polygons/${created.id}`,
        headers: { authorization: `Bearer ${author.sessionToken}` },
        payload: { note: '' },
      });
      assert.equal(clearEmptyStr.statusCode, 200);
      assert.equal(
        PolygonFeatureSchema.parse(clearEmptyStr.json()).properties.note,
        null,
      );

      await app.inject({
        method: 'PATCH',
        url: `/api/v1/polygons/${created.id}`,
        headers: { authorization: `Bearer ${author.sessionToken}` },
        payload: { note: 'Temporary note' },
      });

      const clearNull = await app.inject({
        method: 'PATCH',
        url: `/api/v1/polygons/${created.id}`,
        headers: { authorization: `Bearer ${author.sessionToken}` },
        payload: { note: null },
      });
      assert.equal(clearNull.statusCode, 200);
      assert.equal(
        PolygonFeatureSchema.parse(clearNull.json()).properties.note,
        null,
      );

      // Author DELETE -> 204, cascades votes, subsequent GET -> 404
      const okDelete = await app.inject({
        method: 'DELETE',
        url: `/api/v1/polygons/${created.id}`,
        headers: { authorization: `Bearer ${author.sessionToken}` },
      });
      assert.equal(okDelete.statusCode, 204);

      const votesAfterDel = await pool.query<{ cnt: number }>(
        'SELECT COUNT(*)::int AS cnt FROM votes WHERE polygon_id = $1',
        [created.id],
      );
      assert.equal(votesAfterDel.rows[0]!.cnt, 0);

      const getAfterDel = await app.inject({
        method: 'GET',
        url: `/api/v1/polygons/${created.id}`,
      });
      assert.equal(getAfterDel.statusCode, 404);
    } finally {
      await app.close();
    }
  });

  it('GET /api/v1/polygons/export.geojson streams keyset-paginated (>1,000 rows) RFC 7946 FeatureCollection, enforces exportSemaphore (503) and rate limits (429)', async () => {
    const config = loadEnvConfig({});
    const exportSemaphore = new BoundedSemaphore(2, 0, 'SERVICE_UNAVAILABLE');
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
      exportSemaphore,
      rateLimits: {
        exportGeoJson: { max: 6, timeWindow: '1 minute' },
      },
    });

    try {
      const user = await registerTestUser(app, 'ExportAuthor', '198.51.100.60');

      // Seed 1,050 polygons in a single SQL statement (exceeding 1,000-row batch size with shared timestamps)
      await pool.query(
        `INSERT INTO polygons (user_id, geom, surface_type, note, area_m2, upvotes, downvotes, score)
         SELECT
           CASE WHEN g = 1 THEN NULL ELSE $1::uuid END,
           ST_ForcePolygonCCW(
             ST_MakeEnvelope(
               9.80 + (g % 50) * 0.0003,
               53.50 + (g / 50) * 0.0003,
               9.80015 + (g % 50) * 0.0003,
               53.50015 + (g / 50) * 0.0003,
               4326
             )
           ),
           'asphalt',
           'Export batch item ' || g,
           80.25,
           1,
           0,
           1
         FROM generate_series(1, 1050) AS g`,
        [user.userId],
      );

      // Seed a vote for ExportAuthor to prove export always forces myVote: 0 and isAuthor: false
      await pool.query(
        `INSERT INTO votes (polygon_id, user_id, value)
         SELECT id, $1, 1 FROM polygons LIMIT 1`,
        [user.userId],
      );

      const exportRes = await app.inject({
        method: 'GET',
        url: '/api/v1/polygons/export.geojson',
        remoteAddress: '198.51.100.61',
        headers: {
          authorization: `Bearer ${user.sessionToken}`,
          'accept-encoding': 'identity',
        },
      });
      assert.equal(exportRes.statusCode, 200);
      assert.match(
        String(exportRes.headers['content-type']),
        /^application\/geo\+json\b/i,
      );
      assert.equal(
        exportRes.headers['content-disposition'],
        'attachment; filename="entsiegelung-proposals.geojson"',
      );

      const exported = JSON.parse(exportRes.body) as {
        type: string;
        features: unknown[];
      };
      assert.equal(exported.type, 'FeatureCollection');
      assert.equal(exported.features.length, 1050);

      const seenIds = new Set<string>();
      for (const rawFeat of exported.features) {
        // Strict schema: the ODbL-1.0 export carries no author pseudonym, author
        // trust/activity signal or viewer-specific fields (GDPR Art. 5(1)(c), 17(2)).
        const feat = ExportPolygonFeatureSchema.parse(rawFeat);
        assert.equal(feat.id, feat.properties.id);
        const rawProps = (rawFeat as { properties: Record<string, unknown> }).properties;
        for (const forbiddenKey of [
          'authorPseudonym',
          'authorIsNewUser',
          'authorRecentlyActive',
          'myVote',
          'myFlag',
          'isAuthor',
        ]) {
          assert.equal(forbiddenKey in rawProps, false, `export must not contain ${forbiddenKey}`);
        }
        assertMaxSixDecimals(feat.geometry.coordinates[0]!);
        seenIds.add(feat.id);
      }
      assert.equal(seenIds.size, 1050, 'All 1,050 keyset-paginated IDs must be unique');
      assert.equal(exportRes.body.includes('"deleted"'), false);
      assert.equal(exportSemaphore.active, 0);

      // Prove BoundedSemaphore(2, 0, 'SERVICE_UNAVAILABLE') saturation & release over live TCP streams
      await app.listen({ host: '127.0.0.1', port: 0 });
      const address = app.server.address();
      assert.ok(address && typeof address === 'object');
      const baseUrl = `http://127.0.0.1:${address.port}`;

      // Verify exportSemaphore saturation (maxConcurrent = 2, maxQueue = 0) returns 503 immediately
      const releaseSlot1 = await exportSemaphore.acquire();
      const releaseSlot2 = await exportSemaphore.acquire();
      try {
        assert.equal(exportSemaphore.active, 2);
        const overflowRes = await fetch(`${baseUrl}/api/v1/polygons/export.geojson`, {
          headers: { 'Accept-Encoding': 'identity' },
        });
        assert.equal(overflowRes.status, 503);
        const overflowErr = ApiErrorEnvelopeSchema.parse(await overflowRes.json());
        assert.equal(overflowErr.error.code, 'SERVICE_UNAVAILABLE');
      } finally {
        releaseSlot1();
        releaseSlot2();
      }
      assert.equal(exportSemaphore.active, 0);

      // Also verify aborting an in-flight TCP export request mid-stream releases its semaphore permit cleanly
      await new Promise<void>((resolve, reject) => {
        const req = http.get(
          `${baseUrl}/api/v1/polygons/export.geojson`,
          { headers: { 'Accept-Encoding': 'identity' } },
          (res) => {
            assert.equal(res.statusCode, 200);
            res.once('data', () => {
              req.destroy();
            });
            res.once('close', () => resolve());
            res.once('error', () => resolve());
          },
        );
        req.once('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'ECONNRESET') {
            resolve();
            return;
          }
          reject(err);
        });
      });

      // Wait briefly for server socket close callback to fire
      for (let attempt = 0; attempt < 20 && exportSemaphore.active > 0; attempt++) {
        await new Promise((r) => setTimeout(r, 10));
      }
      assert.equal(exportSemaphore.active, 0);

      // Verify 6/min per IP-subnet rate limiting on export.geojson
      for (let i = 0; i < 6; i++) {
        const r = await app.inject({
          method: 'GET',
          url: '/api/v1/polygons/export.geojson',
          remoteAddress: `2001:db8:abcd:0042::${i + 1}`,
          headers: { 'accept-encoding': 'identity' },
        });
        assert.equal(r.statusCode, 200);
      }
      const seventhExport = await app.inject({
        method: 'GET',
        url: '/api/v1/polygons/export.geojson',
        remoteAddress: '2001:db8:abcd:0042::99',
      });
      assert.equal(seventhExport.statusCode, 429);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(seventhExport.json()).error.code,
        'RATE_LIMITED',
      );
    } finally {
      await app.close();
    }
  });

  it('handles empty export, real concurrent export stream saturation, wall-clock export timeout, unknown surfaceType coercion, mutation rate limits, and lock-ordered deletion concurrency', async () => {
    const config = loadEnvConfig({});
    const exportSemaphore = new BoundedSemaphore(2, 0, 'SERVICE_UNAVAILABLE');
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
      exportSemaphore,
      rateLimits: {
        createPolygon: { max: 2, timeWindow: '1 minute' },
        mutatePolygon: { max: 2, timeWindow: '1 minute' },
      },
    });

    try {
      // 1. Empty DB export returns valid empty FeatureCollection
      const emptyExportRes = await app.inject({
        method: 'GET',
        url: '/api/v1/polygons/export.geojson',
        remoteAddress: '198.51.100.70',
        headers: { 'accept-encoding': 'identity' },
      });
      assert.equal(emptyExportRes.statusCode, 200);
      const emptyExportPayload = JSON.parse(emptyExportRes.body) as {
        type: string;
        license?: string;
        licenseUrl?: string;
        contributorRights?: string;
        attribution?: string;
        features: unknown[];
      };
      assert.equal(emptyExportPayload.type, 'FeatureCollection');
      assert.equal(emptyExportPayload.license, 'ODbL-1.0');
      assert.equal(
        emptyExportPayload.licenseUrl,
        'https://opendatacommons.org/licenses/odbl/1-0/',
      );
      assert.equal(emptyExportPayload.contributorRights, 'CC0-1.0');
      // AUTO_SEED_VG250 is false and municipalities table is empty -> ODbL + CC0 attribution without false BKG claim
      assert.match(emptyExportPayload.attribution ?? '', /ODbL-1\.0/);
      assert.match(emptyExportPayload.attribution ?? '', /CC0 1\.0 Universal/);
      assert.equal(
        (emptyExportPayload.attribution ?? '').includes('BKG'),
        false,
      );
      assert.deepEqual(emptyExportPayload.features, []);
      assert.equal(exportSemaphore.active, 0);

      // 2. Two real concurrent in-flight export requests saturate exportSemaphore -> 3rd returns 503
      const lockClient = await pool.connect();
      try {
        await lockClient.query('BEGIN');
        await lockClient.query('LOCK TABLE polygons IN ACCESS EXCLUSIVE MODE');

        const inFlight1 = app.inject({
          method: 'GET',
          url: '/api/v1/polygons/export.geojson',
          remoteAddress: '198.51.100.71',
          headers: { 'accept-encoding': 'identity' },
        });
        const inFlight2 = app.inject({
          method: 'GET',
          url: '/api/v1/polygons/export.geojson',
          remoteAddress: '198.51.100.72',
          headers: { 'accept-encoding': 'identity' },
        });

        for (let i = 0; i < 40 && exportSemaphore.active < 2; i++) {
          await new Promise((r) => setTimeout(r, 5));
        }
        assert.equal(exportSemaphore.active, 2);

        const saturated3 = await app.inject({
          method: 'GET',
          url: '/api/v1/polygons/export.geojson',
          remoteAddress: '198.51.100.73',
        });
        assert.equal(saturated3.statusCode, 503);
        assert.equal(
          ApiErrorEnvelopeSchema.parse(saturated3.json()).error.code,
          'SERVICE_UNAVAILABLE',
        );

        await lockClient.query('ROLLBACK');

        const [done1, done2] = await Promise.all([inFlight1, inFlight2]);
        assert.equal(done1.statusCode, 200);
        assert.equal(done2.statusCode, 200);
        assert.equal(exportSemaphore.active, 0);
      } finally {
        lockClient.release();
      }

      // 3. Unknown future surface_type in DB coerces cleanly to "other"
      const user = await registerTestUser(app, 'EvolutionMapper', '198.51.100.74');
      const futurePolyRes = await pool.query<{ id: string }>(
        `INSERT INTO polygons (user_id, geom, surface_type, note, area_m2)
         VALUES (
           $1,
           ST_ForcePolygonCCW(ST_MakeEnvelope(9.9937, 53.5511, 9.99385, 53.551208, 4326)),
           'cobblestone_v2',
           'Future surface type',
           120.0
         )
         RETURNING id`,
        [user.userId],
      );
      const futureId = futurePolyRes.rows[0]!.id;

      const getFuture = await app.inject({
        method: 'GET',
        url: `/api/v1/polygons/${futureId}`,
      });
      assert.equal(getFuture.statusCode, 200);
      assert.equal(
        PolygonFeatureSchema.parse(getFuture.json()).properties.surfaceType,
        'other',
      );

      // 4. createPolygon & mutatePolygon IP-subnet rate limits (max: 2/min override)
      for (let i = 0; i < 2; i++) {
        const lngShift = (i + 1) * 0.001;
        const r = await app.inject({
          method: 'POST',
          url: '/api/v1/polygons',
          remoteAddress: '198.51.100.75',
          headers: { authorization: `Bearer ${user.sessionToken}` },
          payload: {
            geometry: {
              type: 'Polygon',
              coordinates: [VALID_CCW_RING.map(([lng, lat]) => [lng + lngShift, lat])],
            },
            surfaceType: 'asphalt',
          },
        });
        assert.equal(r.statusCode, 201);
      }
      const rateLimitedCreate = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        remoteAddress: '198.51.100.75',
        headers: { authorization: `Bearer ${user.sessionToken}` },
        payload: {
          geometry: { type: 'Polygon', coordinates: [VALID_CCW_RING] },
          surfaceType: 'asphalt',
        },
      });
      assert.equal(rateLimitedCreate.statusCode, 429);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(rateLimitedCreate.json()).error.code,
        'RATE_LIMITED',
      );

      for (let i = 0; i < 2; i++) {
        const r = await app.inject({
          method: 'PATCH',
          url: `/api/v1/polygons/${futureId}`,
          remoteAddress: '198.51.100.76',
          headers: { authorization: `Bearer ${user.sessionToken}` },
          payload: { note: `Edit ${i}` },
        });
        assert.equal(r.statusCode, 200);
      }
      const rateLimitedPatch = await app.inject({
        method: 'PATCH',
        url: `/api/v1/polygons/${futureId}`,
        remoteAddress: '198.51.100.76',
        headers: { authorization: `Bearer ${user.sessionToken}` },
        payload: { note: 'Edit 3' },
      });
      assert.equal(rateLimitedPatch.statusCode, 429);

      // 5. Concurrent PATCH /polygons/:id and DELETE /auth/me obey users -> polygons lock order without deadlock
      const [patchRace, deleteUserRace] = await Promise.all([
        app.inject({
          method: 'PATCH',
          url: `/api/v1/polygons/${futureId}`,
          remoteAddress: '198.51.100.77',
          headers: { authorization: `Bearer ${user.sessionToken}` },
          payload: { note: 'Concurrent patch' },
        }),
        app.inject({
          method: 'DELETE',
          url: '/api/v1/auth/me',
          remoteAddress: '198.51.100.78',
          headers: { authorization: `Bearer ${user.sessionToken}` },
        }),
      ]);
      assert.equal(deleteUserRace.statusCode, 204);
      assert.ok(
        patchRace.statusCode === 200 || patchRace.statusCode === 401,
        `Expected 200 or 401 during concurrent account deletion, received ${patchRace.statusCode}`,
      );

      const anonymizedGet = await app.inject({
        method: 'GET',
        url: `/api/v1/polygons/${futureId}`,
      });
      assert.equal(anonymizedGet.statusCode, 200);
      assert.equal(
        PolygonFeatureSchema.parse(anonymizedGet.json()).properties.authorPseudonym,
        'deleted',
      );
    } finally {
      await app.close();
    }

    // 6. Wall-clock stream timeout destroys stalled export stream and releases semaphore permit
    const timeoutSemaphore = new BoundedSemaphore(2, 0, 'SERVICE_UNAVAILABLE');
    const timeoutApp = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
      exportSemaphore: timeoutSemaphore,
      exportStreamTimeoutMs: 60,
    });
    const stallClient = await pool.connect();
    let stallLocked = false;
    try {
      await stallClient.query('BEGIN');
      stallLocked = true;
      await stallClient.query('LOCK TABLE polygons IN ACCESS EXCLUSIVE MODE');

      const timedOutRes = await timeoutApp.inject({
        method: 'GET',
        url: '/api/v1/polygons/export.geojson',
        remoteAddress: '198.51.100.79',
      });
      assert.equal(timedOutRes.statusCode, 503);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(timedOutRes.json()).error.code,
        'SERVICE_UNAVAILABLE',
      );
      assert.equal(timeoutSemaphore.active, 0);

      await stallClient.query('ROLLBACK');
      stallLocked = false;

      const recoveredRes = await timeoutApp.inject({
        method: 'GET',
        url: '/api/v1/polygons/export.geojson',
        remoteAddress: '198.51.100.80',
        headers: { 'accept-encoding': 'identity' },
      });
      assert.equal(recoveredRes.statusCode, 200);
      assert.equal(timeoutSemaphore.active, 0);
    } finally {
      if (stallLocked) {
        await stallClient.query('ROLLBACK');
      }
      stallClient.release();
      await timeoutApp.close();
    }
  });
});
