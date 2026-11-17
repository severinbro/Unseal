import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import sharp from 'sharp';

import {
  AltchaChallengeResponseSchema,
  ApiErrorEnvelopeSchema,
  FlagPolygonResponseSchema,
  ImportPolygonsResponseSchema,
  PolygonCollectionResponseSchema,
  PolygonFeatureSchema,
  PolygonPhotoSchema,
  RegisterResponseSchema,
  SessionResponseSchema,
  type PolygonFeature,
} from '@entsiegelung/shared';

import {
  buildApp,
  canonicalizeEmail,
  runAdminCommand,
  seedLandCoverExclusions,
  solveAltchaChallenge,
  upsertMunicipalitiesAndBackfill,
} from '../src/app.js';
import { loadEnvConfig } from '../src/config.js';
import { resetTestDb, setupTestDb } from '../src/db/testHarness.js';
import { createLogger } from '../src/logger.js';

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

const HAMBURG_MUNICIPALITY_GEOJSON = JSON.stringify({
  type: 'Polygon',
  coordinates: [
    [
      [9.8, 53.45],
      [10.15, 53.45],
      [10.15, 53.65],
      [9.8, 53.65],
      [9.8, 53.45],
    ],
  ],
});

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

function makeCourtyardRing(baseLng: number, baseLat: number): [number, number][] {
  return makeBoxRing(baseLng, baseLat, baseLng + 0.00018, baseLat + 0.00012);
}

function buildMultipartPayload(options: {
  fieldName: string;
  fileName: string;
  contentType: string;
  fileBuffer: Buffer;
}): { body: Buffer; contentTypeHeader: string } {
  const boundary = '----CarbonAntiSpamTestBoundary987654321';
  const preamble = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${options.fieldName}"; filename="${options.fileName}"\r\n` +
      `Content-Type: ${options.contentType}\r\n\r\n`,
    'utf8',
  );
  const epilogue = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return {
    body: Buffer.concat([preamble, options.fileBuffer, epilogue]),
    contentTypeHeader: `multipart/form-data; boundary=${boundary}`,
  };
}

async function registerTestUser(
  app: FastifyInstance,
  pseudonym: string,
  remoteAddress = '198.51.100.10',
  customEmail?: string,
): Promise<{ userId: string; pseudonym: string; sessionToken: string }> {
  const email = customEmail ?? `${pseudonym.toLowerCase()}@example.org`;
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
    [email.toLowerCase()],
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

describe('Carbon Anti-Spam & Civic Moderation Suite', () => {
  let pool: pg.Pool;
  let uploadsDir: string;

  before(async () => {
    pool = await setupTestDb();
    uploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'carbon-uploads-'));
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

  it('rejects >=50% overlapping proposals (409 POLYGON_OVERLAP) and auto-clips minor (<50%) edge overlaps', async () => {
    const config = loadEnvConfig({ UPLOADS_DIR: uploadsDir });
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
    });

    try {
      const userA = await registerTestUser(app, 'MapperAlpha', '198.51.100.11');
      const userB = await registerTestUser(app, 'MapperBeta', '198.51.100.12');

      const baseRing = makeBoxRing(9.991, 53.551, 9.9913, 53.5512);
      const createBase = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        remoteAddress: '198.51.100.11',
        headers: { authorization: `Bearer ${userA.sessionToken}` },
        payload: {
          geometry: { type: 'Polygon', coordinates: [baseRing] },
          surfaceType: 'asphalt',
          note: 'Original courtyard',
        },
      });
      assert.equal(createBase.statusCode, 201);
      const basePoly = PolygonFeatureSchema.parse(createBase.json());

      // ~80% overlap -> rejected with 409 POLYGON_OVERLAP
      const heavyOverlapRing = makeBoxRing(9.99106, 53.551, 9.99136, 53.5512);
      const heavyRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        remoteAddress: '198.51.100.12',
        headers: { authorization: `Bearer ${userB.sessionToken}` },
        payload: {
          geometry: { type: 'Polygon', coordinates: [heavyOverlapRing] },
          surfaceType: 'concrete',
        },
      });
      assert.equal(heavyRes.statusCode, 409);
      const heavyErr = ApiErrorEnvelopeSchema.parse(heavyRes.json());
      assert.equal(heavyErr.error.code, 'POLYGON_OVERLAP');

      // ~20% overlap (shifted east by 0.00024 out of 0.00030 width) -> auto-clipped (201)
      const minorOverlapRing = makeBoxRing(9.99124, 53.551, 9.99154, 53.5512);
      const clippedRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        remoteAddress: '198.51.100.12',
        headers: { authorization: `Bearer ${userB.sessionToken}` },
        payload: {
          geometry: { type: 'Polygon', coordinates: [minorOverlapRing] },
          surfaceType: 'pavers',
          note: 'Adjacent clipped lot',
        },
      });
      assert.equal(clippedRes.statusCode, 201);
      const clippedPoly = PolygonFeatureSchema.parse(clippedRes.json());
      assert.ok(
        clippedPoly.properties.areaM2 < basePoly.properties.areaM2 * 0.9,
        `Expected clipped area (${clippedPoly.properties.areaM2}) to be reduced vs unclipped (${basePoly.properties.areaM2})`,
      );

      // Verify zero interior overlap in PostGIS after auto-clipping
      const interCheck = await pool.query<{ inter_area: number }>(
        `SELECT ST_Area(
           ST_CollectionExtract(ST_Intersection(a.geom, b.geom), 3)::geography
         ) AS inter_area
         FROM polygons a, polygons b
         WHERE a.id = $1 AND b.id = $2`,
        [basePoly.id, clippedPoly.id],
      );
      assert.ok((interCheck.rows[0]?.inter_area ?? 0) < 0.01);
    } finally {
      await app.close();
    }
  });

  it('enforces 50m spatial clustering cap (429 SPATIAL_CLUSTER_LIMIT), stricter 20,000 m² user max area, compactness & sliver checks, while preserving 500,000 m² admin imports', async () => {
    const config = loadEnvConfig({ UPLOADS_DIR: uploadsDir });
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
    });

    try {
      const user = await registerTestUser(app, 'ClusterUser', '198.51.100.21');
      const admin = await registerTestUser(app, 'AdminImporter', '198.51.100.22');
      await runAdminCommand(pool, ['grant-admin', admin.pseudonym]);

      // 1. User polygon > 20,000 m² (~45,000 m² square: 0.0032° x 0.0020° in Hamburg) -> 422 AREA_OUT_OF_BOUNDS
      const hugeUserRing = makeBoxRing(9.98, 53.55, 9.9832, 53.552);
      const hugeRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        remoteAddress: '198.51.100.21',
        headers: { authorization: `Bearer ${user.sessionToken}` },
        payload: {
          geometry: { type: 'Polygon', coordinates: [hugeUserRing] },
          surfaceType: 'asphalt',
        },
      });
      assert.equal(hugeRes.statusCode, 422);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(hugeRes.json()).error.code,
        'AREA_OUT_OF_BOUNDS',
      );

      // 2. Non-compact ribbon (~0.8m wide x 150m long -> PP << 0.05) -> 422 GEOMETRY_NOT_COMPACT
      const ribbonRing = makeBoxRing(9.985, 53.55, 9.9873, 53.550015);
      const ribbonRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        remoteAddress: '198.51.100.21',
        headers: { authorization: `Bearer ${user.sessionToken}` },
        payload: {
          geometry: { type: 'Polygon', coordinates: [ribbonRing] },
          surfaceType: 'asphalt',
        },
      });
      assert.equal(ribbonRes.statusCode, 422);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(ribbonRes.json()).error.code,
        'GEOMETRY_NOT_COMPACT',
      );

      // 3. Narrow sliver (< 1m wide, ~4.5m long -> ~4m² area, PP >= 0.05, but negative 0.5m buffer collapses) -> 422 GEOMETRY_SLIVER
      const sliverRing = makeBoxRing(9.988, 53.55, 9.98807, 53.550008);
      const sliverRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        remoteAddress: '198.51.100.21',
        headers: { authorization: `Bearer ${user.sessionToken}` },
        payload: {
          geometry: { type: 'Polygon', coordinates: [sliverRing] },
          surfaceType: 'concrete',
        },
      });
      assert.equal(sliverRes.statusCode, 422);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(sliverRes.json()).error.code,
        'GEOMETRY_SLIVER',
      );

      // 4. Admin GeoJSON import > 20,000 m² (~45,000 m²) succeeds up to 500,000 m²
      const importGeoJson = JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { surfaceType: 'asphalt', note: 'Large industrial depot' },
            geometry: { type: 'Polygon', coordinates: [hugeUserRing] },
          },
        ],
      });
      const multipart = buildMultipartPayload({
        fieldName: 'file',
        fileName: 'depot.geojson',
        contentType: 'application/geo+json',
        fileBuffer: Buffer.from(importGeoJson, 'utf8'),
      });
      const importRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons/import',
        remoteAddress: '198.51.100.22',
        headers: {
          authorization: `Bearer ${admin.sessionToken}`,
          'content-type': multipart.contentTypeHeader,
        },
        payload: multipart.body,
      });
      assert.equal(importRes.statusCode, 200);
      const importParsed = ImportPolygonsResponseSchema.parse(importRes.json());
      assert.equal(importParsed.importedCount, 1);
      assert.equal(importParsed.skippedCount, 0);

      // 5. Spatial clustering cap: 5 micro-courtyards within 50m succeed; 6th within 50m -> 429 SPATIAL_CLUSTER_LIMIT
      // Arrange 6 small ~12m² squares in a tight 2x3 grid (~8m apart, zero overlap, all well within 50m)
      const gridCoords: Array<[number, number]> = [
        [9.992, 53.553],
        [9.99212, 53.553],
        [9.99224, 53.553],
        [9.992, 53.55308],
        [9.99212, 53.55308],
        [9.99224, 53.55308],
      ];
      for (let i = 0; i < 5; i++) {
        const [lng, lat] = gridCoords[i]!;
        const r = await app.inject({
          method: 'POST',
          url: '/api/v1/polygons',
          remoteAddress: '198.51.100.21',
          headers: { authorization: `Bearer ${user.sessionToken}` },
          payload: {
            geometry: {
              type: 'Polygon',
              coordinates: [makeBoxRing(lng, lat, lng + 0.00006, lat + 0.00004)],
            },
            surfaceType: 'pavers',
          },
        });
        assert.equal(r.statusCode, 201, `Expected 201 for cluster item #${i + 1}`);
      }

      const [sixthLng, sixthLat] = gridCoords[5]!;
      const sixthRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        remoteAddress: '198.51.100.21',
        headers: { authorization: `Bearer ${user.sessionToken}` },
        payload: {
          geometry: {
            type: 'Polygon',
            coordinates: [
              makeBoxRing(sixthLng, sixthLat, sixthLng + 0.00006, sixthLat + 0.00004),
            ],
          },
          surfaceType: 'pavers',
        },
      });
      assert.equal(sixthRes.statusCode, 429);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(sixthRes.json()).error.code,
        'SPATIAL_CLUSTER_LIMIT',
      );

      // A polygon 300m away succeeds immediately
      const distantRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        remoteAddress: '198.51.100.21',
        headers: { authorization: `Bearer ${user.sessionToken}` },
        payload: {
          geometry: {
            type: 'Polygon',
            coordinates: [makeCourtyardRing(9.998, 53.556)],
          },
          surfaceType: 'asphalt',
        },
      });
      assert.equal(distantRes.statusCode, 201);
    } finally {
      await app.close();
    }
  });

  it('enforces municipal jurisdiction (OUTSIDE_JURISDICTION) and OSM/ALKIS-only land-cover exclusions (LAND_COVER_EXCLUDED)', async () => {
    const config = loadEnvConfig({ UPLOADS_DIR: uploadsDir });
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
    });

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'carbon-lc-'));
    try {
      const user = await registerTestUser(app, 'GeoGuardUser', '198.51.100.31');

      // Seed Hamburg municipality -> North Sea / outside Hamburg is rejected
      await upsertMunicipalitiesAndBackfill(pool, [
        {
          ags: '02000000',
          name: 'Hamburg',
          geoJsonGeometry: HAMBURG_MUNICIPALITY_GEOJSON,
        },
      ]);

      const outsideRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        remoteAddress: '198.51.100.31',
        headers: { authorization: `Bearer ${user.sessionToken}` },
        payload: {
          geometry: {
            type: 'Polygon',
            coordinates: [makeCourtyardRing(7.9, 54.18)],
          },
          surfaceType: 'asphalt',
        },
      });
      assert.equal(outsideRes.statusCode, 422);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(outsideRes.json()).error.code,
        'OUTSIDE_JURISDICTION',
      );

      // Load OSM GeoJSON land-cover (water + forest) via admin CLI `load-landcover`
      const osmGeoJsonPath = path.join(tmpDir, 'osm-exclusions.geojson');
      await fs.writeFile(
        osmGeoJsonPath,
        JSON.stringify({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { natural: 'water', name: 'Binnenalster' },
              geometry: {
                type: 'Polygon',
                coordinates: [makeBoxRing(9.993, 53.554, 9.996, 53.556)],
              },
            },
            {
              type: 'Feature',
              properties: { landuse: 'forest' },
              geometry: {
                type: 'Polygon',
                coordinates: [makeBoxRing(9.997, 53.554, 9.999, 53.556)],
              },
            },
          ],
        }),
        'utf8',
      );

      const cliRes = await runAdminCommand(pool, [
        'load-landcover',
        'osm',
        osmGeoJsonPath,
        '--replace',
      ]);
      assert.equal(cliRes.command, 'load-landcover');
      assert.equal(cliRes.importedLandCoverCount, 2);

      // Also seed ALKIS building footprint directly
      await seedLandCoverExclusions(pool, [
        {
          source: 'alkis',
          category: 'building',
          geoJsonGeometry: {
            type: 'Polygon',
            coordinates: [makeBoxRing(10.001, 53.554, 10.002, 53.555)],
          },
        },
      ]);

      // Proposal inside OSM water -> 422 LAND_COVER_EXCLUDED
      const waterRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        remoteAddress: '198.51.100.31',
        headers: { authorization: `Bearer ${user.sessionToken}` },
        payload: {
          geometry: {
            type: 'Polygon',
            coordinates: [makeCourtyardRing(9.994, 53.5545)],
          },
          surfaceType: 'asphalt',
        },
      });
      assert.equal(waterRes.statusCode, 422);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(waterRes.json()).error.code,
        'LAND_COVER_EXCLUDED',
      );

      // Proposal inside ALKIS building -> 422 LAND_COVER_EXCLUDED
      const bldgRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        remoteAddress: '198.51.100.31',
        headers: { authorization: `Bearer ${user.sessionToken}` },
        payload: {
          geometry: {
            type: 'Polygon',
            coordinates: [makeCourtyardRing(10.0012, 53.5542)],
          },
          surfaceType: 'concrete',
        },
      });
      assert.equal(bldgRes.statusCode, 422);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(bldgRes.json()).error.code,
        'LAND_COVER_EXCLUDED',
      );

      // Proposal on unexcluded Hamburg courtyard -> 201
      const validRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        remoteAddress: '198.51.100.31',
        headers: { authorization: `Bearer ${user.sessionToken}` },
        payload: {
          geometry: {
            type: 'Polygon',
            coordinates: [makeCourtyardRing(10.005, 53.5545)],
          },
          surfaceType: 'asphalt',
        },
      });
      assert.equal(validRes.statusCode, 201);
    } finally {
      await app.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('hardens registration with canonical email alias blocking, disposable-domain blocklist, ALTCHA PoW challenge + replay defense, /24 subnet throttling, and tracks last_login_at', async () => {
    assert.equal(
      canonicalizeEmail('Alice.Mapper+spam1@GoogleMail.com'),
      'alicemapper@gmail.com',
    );
    assert.equal(
      canonicalizeEmail('User.Name+tag@example.org'),
      'user.name@example.org',
    );

    const config = loadEnvConfig({
      AUTH_CAPTCHA_ENABLED: 'true',
      AUTH_CAPTCHA_SECRET: 'carbon-test-hmac-secret-0123456789abcdef',
      AUTH_CAPTCHA_MAX_NUMBER: '500',
      UPLOADS_DIR: uploadsDir,
    });
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
      rateLimits: {
        registerSubnet: { max: 2, timeWindowMs: 60_000 },
      },
    });

    try {
      // 1. Missing ALTCHA payload when enabled -> 422 AUTH_CAPTCHA_REQUIRED
      const missingPoW = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: '198.51.100.10',
        payload: {
          pseudonym: 'NoCaptchaUser',
          email: 'nocaptcha@example.org',
          password: 'valid-password-123',
          acceptedPrivacyPolicy: true,
          acceptedTerms: true,
        },
      });
      assert.equal(missingPoW.statusCode, 422);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(missingPoW.json()).error.code,
        'AUTH_CAPTCHA_REQUIRED',
      );

      // 2. Disposable email domain rejected -> 422 AUTH_DISPOSABLE_EMAIL
      const chDispRes = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/challenge',
      });
      assert.equal(chDispRes.statusCode, 200);
      const chDisp = AltchaChallengeResponseSchema.parse(chDispRes.json());
      const solvedDisp = solveAltchaChallenge(chDisp);

      const dispRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: '198.51.101.10',
        payload: {
          pseudonym: 'BurnerMapper',
          email: 'burner@mailinator.com',
          password: 'valid-password-123',
          acceptedPrivacyPolicy: true,
          acceptedTerms: true,
          altchaPayload: solvedDisp,
        },
      });
      assert.equal(dispRes.statusCode, 422);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(dispRes.json()).error.code,
        'AUTH_DISPOSABLE_EMAIL',
      );

      // 3. Valid ALTCHA solve registers Gmail user; replay of same payload is rejected
      const ch1Res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/challenge',
      });
      const ch1 = AltchaChallengeResponseSchema.parse(ch1Res.json());
      const solved1 = solveAltchaChallenge(ch1);

      const reg1 = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: '203.0.113.5',
        payload: {
          pseudonym: 'GmailOriginal',
          email: 'civic.mapper@gmail.com',
          password: 'valid-password-123',
          acceptedPrivacyPolicy: true,
          acceptedTerms: true,
          altchaPayload: solved1,
        },
      });
      assert.equal(reg1.statusCode, 201);

      // Replay same ALTCHA solution -> 422 AUTH_CAPTCHA_INVALID
      const replayRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: '203.0.113.6',
        payload: {
          pseudonym: 'ReplayAttacker',
          email: 'other@example.org',
          password: 'valid-password-123',
          acceptedPrivacyPolicy: true,
          acceptedTerms: true,
          altchaPayload: solved1,
        },
      });
      assert.equal(replayRes.statusCode, 422);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(replayRes.json()).error.code,
        'AUTH_CAPTCHA_INVALID',
      );

      // 4. Canonical +tag / dot Gmail alias creates no account; the response is the generic
      //    201 (no email enumeration) and counts towards the registration quota of its own subnet
      const ch2 = AltchaChallengeResponseSchema.parse(
        (await app.inject({ method: 'GET', url: '/api/v1/auth/challenge' })).json(),
      );
      const aliasRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: '198.51.103.7',
        payload: {
          pseudonym: 'AliasAttempt',
          email: 'CivicMapper+sockpuppet@googlemail.com',
          password: 'valid-password-123',
          acceptedPrivacyPolicy: true,
          acceptedTerms: true,
          altchaPayload: solveAltchaChallenge(ch2),
        },
      });
      assert.equal(aliasRes.statusCode, 201);
      const aliasUser = await pool.query(
        "SELECT 1 FROM users WHERE LOWER(pseudonym) = 'aliasattempt'",
      );
      assert.equal(aliasUser.rowCount, 0);

      // 5. Second valid registration on same /24 subnet succeeds; third registration from 203.0.113.x hits /24 subnet throttle -> 429 RATE_LIMITED
      const ch2b = AltchaChallengeResponseSchema.parse(
        (await app.inject({ method: 'GET', url: '/api/v1/auth/challenge' })).json(),
      );
      const reg2 = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: '203.0.113.99',
        payload: {
          pseudonym: 'SubnetSecond',
          email: 'legit2@example.org',
          password: 'valid-password-123',
          acceptedPrivacyPolicy: true,
          acceptedTerms: true,
          altchaPayload: solveAltchaChallenge(ch2b),
        },
      });
      assert.equal(reg2.statusCode, 201);

      const ch3 = AltchaChallengeResponseSchema.parse(
        (await app.inject({ method: 'GET', url: '/api/v1/auth/challenge' })).json(),
      );
      const subnetRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: '203.0.113.200',
        payload: {
          pseudonym: 'SubnetBlocked',
          email: 'legit4@example.org',
          password: 'valid-password-123',
          acceptedPrivacyPolicy: true,
          acceptedTerms: true,
          altchaPayload: solveAltchaChallenge(ch3),
        },
      });
      assert.equal(subnetRes.statusCode, 429);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(subnetRes.json()).error.code,
        'RATE_LIMITED',
      );

      // 6. Verify email, log in, create polygon -> only a coarse authorRecentlyActive flag is public; the stored activity date has day precision
      await pool.query(
        "UPDATE users SET email_verified_at = clock_timestamp() WHERE LOWER(pseudonym) = 'gmailoriginal'",
      );
      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: '198.51.102.10',
        payload: {
          identifier: 'GmailOriginal',
          password: 'valid-password-123',
        },
      });
      assert.equal(loginRes.statusCode, 200);
      const session = SessionResponseSchema.parse(loginRes.json());

      const polyRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        remoteAddress: '198.51.102.10',
        headers: { authorization: `Bearer ${session.sessionToken}` },
        payload: {
          geometry: {
            type: 'Polygon',
            coordinates: [makeCourtyardRing(9.994, 53.551)],
          },
          surfaceType: 'asphalt',
        },
      });
      assert.equal(polyRes.statusCode, 201);
      const created = PolygonFeatureSchema.parse(polyRes.json());
      assert.equal(created.properties.authorPseudonym, 'GmailOriginal');
      assert.equal(created.properties.authorIsNewUser, true);
      assert.equal(created.properties.authorRecentlyActive, true);
      assert.equal('authorLastLoginAt' in created.properties, false);
      const rawCreated = polyRes.json() as { properties: Record<string, unknown> };
      assert.equal('authorLastLoginAt' in rawCreated.properties, false);
      const storedActivityRes = await pool.query<{ is_day_precision: boolean }>(
        `SELECT last_login_at = date_trunc('day', last_login_at) AS is_day_precision
         FROM users WHERE id = $1`,
        [session.user.id],
      );
      assert.equal(storedActivityRes.rows[0]!.is_day_precision, true);

      // Simulate pre-005 existing 30-day session with last_login_at = NULL:
      // any authenticated bearer request (e.g. GET /api/v1/auth/me or GET /api/v1/polygons)
      // automatically populates last_login_at without requiring re-login!
      await pool.query('UPDATE users SET last_login_at = NULL WHERE id = $1', [
        session.user.id,
      ]);
      const meRefreshRes = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${session.sessionToken}` },
      });
      assert.equal(meRefreshRes.statusCode, 200);
      const refreshedPolyRes = await app.inject({
        method: 'GET',
        url: `/api/v1/polygons/${created.id}`,
      });
      assert.equal(refreshedPolyRes.statusCode, 200);
      const refreshedPoly = PolygonFeatureSchema.parse(refreshedPolyRes.json());
      assert.equal(refreshedPoly.properties.authorRecentlyActive, true);

      // Authors inactive for longer than AUTHOR_ACTIVITY.RECENT_DAYS are shown as inactive
      await pool.query(
        "UPDATE users SET last_login_at = date_trunc('day', NOW()) - INTERVAL '45 days' WHERE id = $1",
        [session.user.id],
      );
      const inactivePolyRes = await app.inject({
        method: 'GET',
        url: `/api/v1/polygons/${created.id}`,
      });
      assert.equal(
        PolygonFeatureSchema.parse(inactivePolyRes.json()).properties.authorRecentlyActive,
        false,
      );

      const exportRes = await app.inject({
        method: 'GET',
        url: '/api/v1/polygons/export.geojson',
      });
      assert.equal(exportRes.statusCode, 200);
      const exported = JSON.parse(exportRes.body) as {
        features: PolygonFeature[];
      };
      assert.equal(exported.features.length, 1);
      assert.equal('authorLastLoginAt' in exported.features[0]!.properties, false);
      assert.equal('authorPseudonym' in exported.features[0]!.properties, false);
      assert.equal(exportRes.body.includes('GmailOriginal'), false);
    } finally {
      await app.close();
    }
  });

  it('marks new-user polygons without restrictions, supports community flagging, filters by authorType & unratedFlaggedOnly, and prunes 14-day stale unrated proposals', async () => {
    const config = loadEnvConfig({ UPLOADS_DIR: uploadsDir });
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
    });

    try {
      const newUser = await registerTestUser(app, 'FreshContributor', '198.51.100.41');
      const vetUser = await registerTestUser(app, 'VeteranMapper', '198.51.100.42');
      const voterA = await registerTestUser(app, 'CivicReviewerA', '198.51.100.43');
      const voterB = await registerTestUser(app, 'CivicReviewerB', '198.51.100.44');
      const admin = await registerTestUser(app, 'ModeratorAdmin', '198.51.100.45');
      await runAdminCommand(pool, ['grant-admin', admin.pseudonym]);

      // Age VeteranMapper past 14 days and give them 3 positively rated unflagged polygons
      await pool.query(
        "UPDATE users SET created_at = NOW() - INTERVAL '30 days' WHERE id = $1",
        [vetUser.userId],
      );
      const vetPolys: PolygonFeature[] = [];
      for (let i = 0; i < 3; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/polygons',
          remoteAddress: '198.51.100.42',
          headers: { authorization: `Bearer ${vetUser.sessionToken}` },
          payload: {
            geometry: {
              type: 'Polygon',
              coordinates: [makeCourtyardRing(9.98 + i * 0.002, 53.551)],
            },
            surfaceType: 'concrete',
            note: `Veteran proposal #${i + 1}`,
          },
        });
        assert.equal(res.statusCode, 201);
        const poly = PolygonFeatureSchema.parse(res.json());
        vetPolys.push(poly);

        const voteRes = await app.inject({
          method: 'PUT',
          url: `/api/v1/polygons/${poly.id}/vote`,
          remoteAddress: '198.51.100.43',
          headers: { authorization: `Bearer ${voterA.sessionToken}` },
          payload: { value: 1 },
        });
        assert.equal(voteRes.statusCode, 200);
      }

      // FreshContributor creates 2 polygons (no limitations on new users!)
      const newPolyUnratedRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        remoteAddress: '198.51.100.41',
        headers: { authorization: `Bearer ${newUser.sessionToken}` },
        payload: {
          geometry: {
            type: 'Polygon',
            coordinates: [makeCourtyardRing(9.99, 53.551)],
          },
          surfaceType: 'asphalt',
          note: 'Unrated flagged candidate',
        },
      });
      assert.equal(newPolyUnratedRes.statusCode, 201);
      const newPolyUnrated = PolygonFeatureSchema.parse(newPolyUnratedRes.json());
      assert.equal(newPolyUnrated.properties.authorIsNewUser, true);

      const newPolyContestedRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        remoteAddress: '198.51.100.41',
        headers: { authorization: `Bearer ${newUser.sessionToken}` },
        payload: {
          geometry: {
            type: 'Polygon',
            coordinates: [makeCourtyardRing(9.993, 53.551)],
          },
          surfaceType: 'pavers',
          note: 'Contested +1/-1 net-zero score candidate',
        },
      });
      assert.equal(newPolyContestedRes.statusCode, 201);
      const newPolyContested = PolygonFeatureSchema.parse(newPolyContestedRes.json());

      // Give newPolyContested +1 and -1 (upvotes = 1, downvotes = 1, net score = 0)
      await app.inject({
        method: 'PUT',
        url: `/api/v1/polygons/${newPolyContested.id}/vote`,
        remoteAddress: '198.51.100.43',
        headers: { authorization: `Bearer ${voterA.sessionToken}` },
        payload: { value: 1 },
      });
      await app.inject({
        method: 'PUT',
        url: `/api/v1/polygons/${newPolyContested.id}/vote`,
        remoteAddress: '198.51.100.44',
        headers: { authorization: `Bearer ${voterB.sessionToken}` },
        payload: { value: -1 },
      });

      // Author cannot self-flag -> 422 FORBIDDEN_SELF_FLAG
      const selfFlagRes = await app.inject({
        method: 'POST',
        url: `/api/v1/polygons/${newPolyUnrated.id}/flag`,
        remoteAddress: '198.51.100.41',
        headers: { authorization: `Bearer ${newUser.sessionToken}` },
        payload: { reason: 'implausible' },
      });
      assert.equal(selfFlagRes.statusCode, 422);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(selfFlagRes.json()).error.code,
        'FORBIDDEN_SELF_FLAG',
      );

      const bbox = '9.975,53.548,10.000,53.555';

      // Age VeteranMapper's 3 polygons past 7 days (10 days old) so they fall into filter=established,
      // while FreshContributor's 2 polygons remain < 7 days old (filter=new).
      await pool.query(
        "UPDATE polygons SET created_at = NOW() - INTERVAL '10 days' WHERE id = ANY($1::uuid[])",
        [vetPolys.map((p) => p.id)],
      );

      // Single-choice filter=needs_review -> returns ONLY polygons with score = 0 AND no ratings (newPolyUnrated),
      // excluding rated proposals (vetPolys) AND excluding contested +1/-1 net-zero-score polygons that already have ratings (newPolyContested)
      const preFlagNeedsReviewRes = await app.inject({
        method: 'GET',
        url: `/api/v1/polygons?bbox=${bbox}&filter=needs_review`,
      });
      assert.equal(preFlagNeedsReviewRes.statusCode, 200);
      const preFlagNeedsReview = PolygonCollectionResponseSchema.parse(
        preFlagNeedsReviewRes.json(),
      );
      assert.deepEqual(
        preFlagNeedsReview.features.map((f) => f.id),
        [newPolyUnrated.id],
      );

      // Reviewer flags BOTH newPolyUnrated and newPolyContested:
      // non-owner / non-admin reviewer sees myFlag=true, while flagCount/isFlagged remain hidden (0 / false)
      for (const polyId of [newPolyUnrated.id, newPolyContested.id]) {
        const flagRes = await app.inject({
          method: 'POST',
          url: `/api/v1/polygons/${polyId}/flag`,
          remoteAddress: '198.51.100.43',
          headers: { authorization: `Bearer ${voterA.sessionToken}` },
          payload: { reason: 'implausible', note: 'Looks like a pond' },
        });
        assert.equal(flagRes.statusCode, 200);
        const parsedFlag = FlagPolygonResponseSchema.parse(flagRes.json());
        assert.equal(parsedFlag.flagCount, 0);
        assert.equal(parsedFlag.isFlagged, false);
        assert.equal(parsedFlag.myFlag, true);
      }

      // Anonymous / other non-admin users do NOT see the flag on GET /api/v1/polygons/:id,
      // whereas the polygon owner (newUser) and admin DO see flagCount=1, isFlagged=true!
      const strangerViewFlagged = PolygonFeatureSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: `/api/v1/polygons/${newPolyUnrated.id}`,
            headers: { authorization: `Bearer ${voterB.sessionToken}` },
          })
        ).json(),
      );
      assert.equal(strangerViewFlagged.properties.flagCount, 0);
      assert.equal(strangerViewFlagged.properties.isFlagged, false);

      const ownerViewFlagged = PolygonFeatureSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: `/api/v1/polygons/${newPolyUnrated.id}`,
            headers: { authorization: `Bearer ${newUser.sessionToken}` },
          })
        ).json(),
      );
      assert.equal(ownerViewFlagged.properties.flagCount, 1);
      assert.equal(ownerViewFlagged.properties.isFlagged, true);

      const adminViewFlagged = PolygonFeatureSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: `/api/v1/polygons/${newPolyUnrated.id}`,
            headers: { authorization: `Bearer ${admin.sessionToken}` },
          })
        ).json(),
      );
      assert.equal(adminViewFlagged.properties.flagCount, 1);
      assert.equal(adminViewFlagged.properties.isFlagged, true);

      // Flagging a trusted contributor's polygon (or even downvoting one after trusted status is earned)
      // NEVER strips their trusted contributor status (authorIsNewUser stays false!)
      const flagVetRes = await app.inject({
        method: 'POST',
        url: `/api/v1/polygons/${vetPolys[0]!.id}/flag`,
        remoteAddress: '198.51.100.43',
        headers: { authorization: `Bearer ${voterA.sessionToken}` },
        payload: { reason: 'duplicate' },
      });
      assert.equal(flagVetRes.statusCode, 200);
      const vetAfterFlag = PolygonFeatureSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: `/api/v1/polygons/${vetPolys[0]!.id}`,
            headers: { authorization: `Bearer ${vetUser.sessionToken}` },
          })
        ).json(),
      );
      assert.equal(vetAfterFlag.properties.isFlagged, true);
      assert.equal(vetAfterFlag.properties.authorIsNewUser, false);

      // Even if voterB downvotes vetPolys[0] to net score 0 after vetUser earned trusted status,
      // trusted_at is locked in so vetUser stays authorIsNewUser = false!
      await app.inject({
        method: 'PUT',
        url: `/api/v1/polygons/${vetPolys[0]!.id}/vote`,
        remoteAddress: '198.51.100.44',
        headers: { authorization: `Bearer ${voterB.sessionToken}` },
        payload: { value: -1 },
      });
      const vetAfterDownvote = PolygonFeatureSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: `/api/v1/polygons/${vetPolys[1]!.id}`,
          })
        ).json(),
      );
      assert.equal(vetAfterDownvote.properties.authorIsNewUser, false);

      // Filter: filter=established (all except past 7 days) -> returns the 3 polygons aged 10 days
      const estListRes = await app.inject({
        method: 'GET',
        url: `/api/v1/polygons?bbox=${bbox}&filter=established`,
      });
      assert.equal(estListRes.statusCode, 200);
      const estList = PolygonCollectionResponseSchema.parse(estListRes.json());
      assert.equal(estList.features.length, 3);
      assert.deepEqual(
        new Set(estList.features.map((f) => f.id)),
        new Set(vetPolys.map((p) => p.id)),
      );

      // Filter: filter=new (past 7 days) -> returns the 2 polygons created within the past 7 days
      const newListRes = await app.inject({
        method: 'GET',
        url: `/api/v1/polygons?bbox=${bbox}&filter=new`,
      });
      assert.equal(newListRes.statusCode, 200);
      const newList = PolygonCollectionResponseSchema.parse(newListRes.json());
      assert.equal(newList.features.length, 2);
      assert.deepEqual(
        new Set(newList.features.map((f) => f.id)),
        new Set([newPolyUnrated.id, newPolyContested.id]),
      );

      // Filter: filter=needs_review -> still strictly score = 0 AND no ratings (only newPolyUnrated; newPolyContested has 2 ratings)
      const needsReviewAfterFlagRes = await app.inject({
        method: 'GET',
        url: `/api/v1/polygons?bbox=${bbox}&filter=needs_review`,
        headers: { authorization: `Bearer ${voterA.sessionToken}` },
      });
      assert.equal(needsReviewAfterFlagRes.statusCode, 200);
      const needsReviewAfterFlag = PolygonCollectionResponseSchema.parse(
        needsReviewAfterFlagRes.json(),
      );
      assert.deepEqual(
        needsReviewAfterFlag.features.map((f) => f.id),
        [newPolyUnrated.id],
      );
      assert.equal(needsReviewAfterFlag.features[0]?.properties.myFlag, true);

      // Attach a photo to newPolyUnrated, create a comment-only unrated polygon AND a truly empty unrated polygon,
      // age all of them to 15 days old, and verify ONLY the truly empty unrated polygon is pruned!
      const newPolyCommentOnlyRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        remoteAddress: '198.51.100.41',
        headers: { authorization: `Bearer ${newUser.sessionToken}` },
        payload: {
          geometry: {
            type: 'Polygon',
            coordinates: [makeCourtyardRing(9.995, 53.551)],
          },
          surfaceType: 'concrete',
          note: 'Unrated candidate with community discussion',
        },
      });
      assert.equal(newPolyCommentOnlyRes.statusCode, 201);
      const newPolyCommentOnly = PolygonFeatureSchema.parse(
        newPolyCommentOnlyRes.json(),
      );

      const commentOnUnratedRes = await app.inject({
        method: 'POST',
        url: `/api/v1/polygons/${newPolyCommentOnly.id}/comments`,
        remoteAddress: '198.51.100.43',
        headers: { authorization: `Bearer ${voterA.sessionToken}` },
        payload: { body: 'This courtyard drains poorly after rain.' },
      });
      assert.equal(commentOnUnratedRes.statusCode, 201);

      const newPolyTrulyEmptyRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        remoteAddress: '198.51.100.41',
        headers: { authorization: `Bearer ${newUser.sessionToken}` },
        payload: {
          geometry: {
            type: 'Polygon',
            coordinates: [makeCourtyardRing(9.997, 53.551)],
          },
          surfaceType: 'other',
          note: 'Unrated candidate without ratings, comments, or media',
        },
      });
      assert.equal(newPolyTrulyEmptyRes.statusCode, 201);
      const newPolyTrulyEmpty = PolygonFeatureSchema.parse(
        newPolyTrulyEmptyRes.json(),
      );

      const jpegBuf = await sharp({
        create: {
          width: 64,
          height: 64,
          channels: 3,
          background: { r: 80, g: 120, b: 90 },
        },
      })
        .jpeg()
        .toBuffer();
      const photoMp = buildMultipartPayload({
        fieldName: 'photo',
        fileName: 'courtyard.jpg',
        contentType: 'image/jpeg',
        fileBuffer: jpegBuf,
      });
      const uploadRes = await app.inject({
        method: 'POST',
        url: `/api/v1/polygons/${newPolyUnrated.id}/photos`,
        remoteAddress: '198.51.100.41',
        headers: {
          authorization: `Bearer ${newUser.sessionToken}`,
          'content-type': photoMp.contentTypeHeader,
        },
        payload: photoMp.body,
      });
      assert.equal(uploadRes.statusCode, 201);
      const uploadedPhoto = PolygonPhotoSchema.parse(uploadRes.json());
      const photoFileName = path.basename(uploadedPhoto.url);

      await pool.query(
        "UPDATE polygons SET created_at = NOW() - INTERVAL '15 days' WHERE id = ANY($1::uuid[])",
        [[
          newPolyUnrated.id,
          newPolyCommentOnly.id,
          newPolyTrulyEmpty.id,
          newPolyContested.id,
        ]],
      );

      const pruneRes = await runAdminCommand(
        pool,
        ['prune-stale-polygons', '14'],
        { uploadsDir },
      );
      assert.equal(pruneRes.command, 'prune-stale-polygons');
      assert.equal(pruneRes.deletedPolygonCount, 1);
      assert.deepEqual(pruneRes.prunedPolygonIds, [newPolyTrulyEmpty.id]);

      // Unrated polygon WITH photo survives pruning and keeps its photo file on disk!
      await fs.access(path.join(uploadsDir, photoFileName));
      const checkWithPhoto = await app.inject({
        method: 'GET',
        url: `/api/v1/polygons/${newPolyUnrated.id}`,
      });
      assert.equal(checkWithPhoto.statusCode, 200);

      // Unrated polygon WITH comment survives pruning!
      const checkWithComment = await app.inject({
        method: 'GET',
        url: `/api/v1/polygons/${newPolyCommentOnly.id}`,
      });
      assert.equal(checkWithComment.statusCode, 200);

      // Once the photo is deleted from newPolyUnrated (leaving 0 votes, 0 photos, 0 comments), it becomes eligible for pruning
      const delPhotoRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/photos/${uploadedPhoto.id}`,
        remoteAddress: '198.51.100.41',
        headers: { authorization: `Bearer ${newUser.sessionToken}` },
      });
      assert.equal(delPhotoRes.statusCode, 204);

      const secondPruneRes = await runAdminCommand(
        pool,
        ['prune-stale-polygons', '14'],
        { uploadsDir },
      );
      assert.equal(secondPruneRes.deletedPolygonCount, 1);
      assert.deepEqual(secondPruneRes.prunedPolygonIds, [newPolyUnrated.id]);

      // Contested (+1/-1, score=0) polygon WAS RATED so it MUST survive pruning!
      const checkContested = await app.inject({
        method: 'GET',
        url: `/api/v1/polygons/${newPolyContested.id}`,
      });
      assert.equal(checkContested.statusCode, 200);

      // Admin can clear all flags on newPolyContested
      const clearFlagsRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/polygons/${newPolyContested.id}/flags`,
        remoteAddress: '198.51.100.45',
        headers: { authorization: `Bearer ${admin.sessionToken}` },
      });
      assert.equal(clearFlagsRes.statusCode, 200);
      assert.equal(
        FlagPolygonResponseSchema.parse(clearFlagsRes.json()).flagCount,
        0,
      );
    } finally {
      await app.close();
    }
  });
});
