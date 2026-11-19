// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Unseal Contributors

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import sharp from 'sharp';

import {
  ExportPolygonFeatureSchema,
  ImportPolygonsResponseSchema,
  PolygonFeatureSchema,
  PolygonPhotoSchema,
  RegisterResponseSchema,
  SessionResponseSchema,
} from '@entsiegelung/shared';

import {
  buildApp,
  runAdminCommand,
  seedLandCoverExclusions,
} from '../src/app.js';
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

function buildMultipartPayload(options: {
  fieldName: string;
  fileName: string;
  contentType: string;
  fileBuffer: Buffer;
}): { body: Buffer; contentTypeHeader: string } {
  const boundary = '----ResearchTelemetryBoundary987654321';
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

describe('Research Telemetry & Polygon Provenance Suite (009_research_telemetry)', () => {
  let pool: pg.Pool;
  let uploadsDir: string;

  before(async () => {
    pool = await setupTestDb();
    uploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telemetry-uploads-'));
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

  it('tracks QA rejections across rolled-back writes, ST_Difference auto-clipping, vote churn, GPS photo buckets, and CLI origin/telemetry commands', async () => {
    const config = {
      ...loadEnvConfig(),
      uploadsDir,
      authCaptchaEnabled: false,
      requireJurisdiction: 'off' as const,
    };
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
    });

    try {
      const citizen = await registerTestUser(app, 'CitizenMapper', '198.51.100.20');
      const voter = await registerTestUser(app, 'CivicVoter', '198.51.100.21');
      const admin = await registerTestUser(app, 'InitiativeAdmin', '198.51.100.22');
      await runAdminCommand(pool, ['grant-admin', 'InitiativeAdmin']);

      // Seed an OSM building exclusion at [9.9960..9.9963, 53.5520..53.5522]
      await seedLandCoverExclusions(pool, [
        {
          source: 'osm',
          category: 'building',
          geoJsonGeometry: {
            type: 'Polygon',
            coordinates: [makeBoxRing(9.996, 53.552, 9.9963, 53.5522)],
          },
        },
      ]);

      // 1) Citizen creates valid base polygon A
      const baseRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        headers: { authorization: `Bearer ${citizen.sessionToken}` },
        payload: {
          geometry: {
            type: 'Polygon',
            coordinates: [makeBoxRing(9.9937, 53.5511, 9.9939, 53.55122)],
          },
          surfaceType: 'asphalt',
          note: 'Base courtyard',
        },
      });
      assert.equal(baseRes.statusCode, 201);
      const basePoly = PolygonFeatureSchema.parse(baseRes.json());
      assert.equal(basePoly.properties.origin, 'citizen');
      assert.equal(basePoly.properties.wasAutoClipped, false);
      assert.equal(basePoly.properties.clippedAreaM2, 0);

      // 2) Adjacent citizen polygon B with ~25% overlap -> auto-clipped via ST_Difference
      const clipRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        headers: { authorization: `Bearer ${citizen.sessionToken}` },
        payload: {
          geometry: {
            type: 'Polygon',
            coordinates: [makeBoxRing(9.99385, 53.5511, 9.99405, 53.55122)],
          },
          surfaceType: 'concrete',
          note: 'Adjacent auto-clipped lot',
        },
      });
      assert.equal(clipRes.statusCode, 201);
      const clippedPoly = PolygonFeatureSchema.parse(clipRes.json());
      assert.equal(clippedPoly.properties.origin, 'citizen');
      assert.equal(clippedPoly.properties.wasAutoClipped, true);
      assert.ok((clippedPoly.properties.clippedAreaM2 ?? 0) > 10);

      // 3) Trigger rolled-back QA rejections: major overlap, land-cover building, and schema geometry
      const dupRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        headers: { authorization: `Bearer ${citizen.sessionToken}` },
        payload: {
          geometry: {
            type: 'Polygon',
            coordinates: [makeBoxRing(9.9937, 53.5511, 9.9939, 53.55122)],
          },
          surfaceType: 'asphalt',
        },
      });
      assert.equal(dupRes.statusCode, 409);

      const buildingRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        headers: { authorization: `Bearer ${citizen.sessionToken}` },
        payload: {
          geometry: {
            type: 'Polygon',
            coordinates: [makeBoxRing(9.99602, 53.55202, 9.99625, 53.55218)],
          },
          surfaceType: 'concrete',
        },
      });
      assert.equal(buildingRes.statusCode, 422);

      const badRingRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        headers: { authorization: `Bearer ${citizen.sessionToken}` },
        payload: {
          geometry: {
            type: 'Polygon',
            coordinates: [[[9.99, 53.55], [9.991, 53.55], [9.99, 53.55]]],
          },
          surfaceType: 'pavers',
        },
      });
      assert.equal(badRingRes.statusCode, 422);

      // 4) Bulk import defaults to 'initiative_import' and supports '?origin=remote_sensing'
      const initiativeGeoJson = Buffer.from(
        JSON.stringify({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { surfaceType: 'pavers', note: 'QField site 1' },
              geometry: {
                type: 'Polygon',
                coordinates: [makeBoxRing(9.991, 53.551, 9.9912, 53.55115)],
              },
            },
          ],
        }),
        'utf8',
      );
      const initMp = buildMultipartPayload({
        fieldName: 'file',
        fileName: 'initiative.geojson',
        contentType: 'application/geo+json',
        fileBuffer: initiativeGeoJson,
      });
      const importInitRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons/import',
        headers: {
          authorization: `Bearer ${admin.sessionToken}`,
          'content-type': initMp.contentTypeHeader,
        },
        payload: initMp.body,
      });
      assert.equal(importInitRes.statusCode, 200);
      const parsedImport = ImportPolygonsResponseSchema.parse(importInitRes.json());
      assert.equal(parsedImport.origin, 'initiative_import');
      assert.equal(parsedImport.importedCount, 1);

      const rsGeoJson = Buffer.from(
        JSON.stringify({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { surfaceType: 'asphalt', note: 'Detected parking' },
              geometry: {
                type: 'Polygon',
                coordinates: [makeBoxRing(9.992, 53.551, 9.9922, 53.55115)],
              },
            },
          ],
        }),
        'utf8',
      );
      const rsMp = buildMultipartPayload({
        fieldName: 'file',
        fileName: 'detected.geojson',
        contentType: 'application/geo+json',
        fileBuffer: rsGeoJson,
      });
      const importRsRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons/import?origin=remote_sensing',
        headers: {
          authorization: `Bearer ${admin.sessionToken}`,
          'content-type': rsMp.contentTypeHeader,
        },
        payload: rsMp.body,
      });
      assert.equal(importRsRes.statusCode, 200);
      assert.equal(
        ImportPolygonsResponseSchema.parse(importRsRes.json()).origin,
        'remote_sensing',
      );

      // 5) Vote cast, idempotent repeat, flip, and removal
      const upvote1 = await app.inject({
        method: 'PUT',
        url: `/api/v1/polygons/${basePoly.id}/vote`,
        headers: { authorization: `Bearer ${voter.sessionToken}` },
        payload: { value: 1 },
      });
      assert.equal(upvote1.statusCode, 200);

      // Idempotent repeat of +1 should not double-count vote_cast
      const upvoteRepeat = await app.inject({
        method: 'PUT',
        url: `/api/v1/polygons/${basePoly.id}/vote`,
        headers: { authorization: `Bearer ${voter.sessionToken}` },
        payload: { value: 1 },
      });
      assert.equal(upvoteRepeat.statusCode, 200);

      // Flip +1 -> -1
      const flipRes = await app.inject({
        method: 'PUT',
        url: `/api/v1/polygons/${basePoly.id}/vote`,
        headers: { authorization: `Bearer ${voter.sessionToken}` },
        payload: { value: -1 },
      });
      assert.equal(flipRes.statusCode, 200);

      // Remove -1 vote
      const unvoteRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/polygons/${basePoly.id}/vote`,
        headers: { authorization: `Bearer ${voter.sessionToken}` },
      });
      assert.equal(unvoteRes.statusCode, 200);

      // 6) Photo uploads across all 3 GPS states: gps_verified, gps_outside_polygon, no_exif_gps
      const nearJpeg = await sharp({
        create: { width: 400, height: 300, channels: 3, background: { r: 80, g: 110, b: 90 } },
      })
        .withExif({
          IFD3: {
            GPSLatitudeRef: 'N',
            GPSLatitude: '53 33 3.90',
            GPSLongitudeRef: 'E',
            GPSLongitude: '9 59 37.40',
          },
        })
        .jpeg()
        .toBuffer();
      const farJpeg = await sharp({
        create: { width: 400, height: 300, channels: 3, background: { r: 120, g: 90, b: 80 } },
      })
        .withExif({
          IFD3: {
            GPSLatitudeRef: 'N',
            GPSLatitude: '53 33 3.60',
            GPSLongitudeRef: 'E',
            GPSLongitude: '9 59 37.40',
          },
        })
        .jpeg()
        .toBuffer();
      const noGpsJpeg = await sharp({
        create: { width: 400, height: 300, channels: 3, background: { r: 100, g: 100, b: 100 } },
      })
        .jpeg()
        .toBuffer();

      for (const [buf, expectedVerified] of [
        [nearJpeg, true],
        [farJpeg, false],
        [noGpsJpeg, false],
      ] as const) {
        const mp = buildMultipartPayload({
          fieldName: 'photo',
          fileName: 'site.jpg',
          contentType: 'image/jpeg',
          fileBuffer: buf,
        });
        const pRes = await app.inject({
          method: 'POST',
          url: `/api/v1/polygons/${basePoly.id}/photos`,
          headers: {
            authorization: `Bearer ${citizen.sessionToken}`,
            'content-type': mp.contentTypeHeader,
          },
          payload: mp.body,
        });
        assert.equal(pRes.statusCode, 201);
        assert.equal(PolygonPhotoSchema.parse(pRes.json()).gpsVerified, expectedVerified);
      }

      // 7) Verify CC0 GeoJSON export includes origin, wasAutoClipped, clippedAreaM2 and zero PII
      const exportRes = await app.inject({
        method: 'GET',
        url: '/api/v1/polygons/export.geojson',
      });
      assert.equal(exportRes.statusCode, 200);
      const exportBody = exportRes.json() as { features: unknown[] };
      assert.equal(exportBody.features.length, 4);
      const exportedFeatures = exportBody.features.map((f) =>
        ExportPolygonFeatureSchema.parse(f),
      );
      const origins = new Set(exportedFeatures.map((f) => f.properties.origin));
      assert.deepEqual(
        origins,
        new Set(['citizen', 'initiative_import', 'remote_sensing']),
      );
      const exportedClipped = exportedFeatures.find((f) => f.id === clippedPoly.id);
      assert.equal(exportedClipped?.properties.wasAutoClipped, true);
      assert.ok((exportedClipped?.properties.clippedAreaM2 ?? 0) > 10);

      // 8) Verify admin CLI `export-telemetry` and `set-polygon-origin`
      const telemetryCmd = await runAdminCommand(pool, ['export-telemetry']);
      assert.equal(telemetryCmd.command, 'export-telemetry');
      const report = telemetryCmd.telemetryExport!;
      assert.equal(report.format, 'unseal-research-telemetry');

      const findCount = (metric: string, dimension: string): number =>
        report.totalsByMetric.find(
          (m) => m.metric === metric && m.dimension === dimension,
        )?.eventCount ?? 0;

      assert.equal(findCount('polygon_created', 'citizen'), 2);
      assert.equal(findCount('polygon_auto_clipped', 'minor_overlap'), 1);
      assert.equal(findCount('polygon_rejected', 'polygon_overlap'), 1);
      assert.equal(findCount('polygon_rejected', 'land_cover:building'), 1);
      assert.equal(findCount('polygon_rejected', 'schema_geometry'), 1);
      assert.equal(findCount('polygon_imported', 'initiative_import'), 1);
      assert.equal(findCount('polygon_imported', 'remote_sensing'), 1);
      assert.equal(findCount('vote_cast', 'upvote'), 1);
      assert.equal(findCount('vote_flipped', 'up_to_down'), 1);
      assert.equal(findCount('vote_removed', 'from_downvote'), 1);
      assert.equal(findCount('photo_uploaded', 'gps_verified'), 1);
      assert.equal(findCount('photo_uploaded', 'gps_outside_polygon'), 1);
      assert.equal(findCount('photo_uploaded', 'no_exif_gps'), 1);

      const citizenStats = report.polygonStatsByOrigin.find(
        (s) => s.origin === 'citizen',
      )!;
      assert.equal(citizenStats.polygonCount, 2);
      assert.equal(citizenStats.autoClippedCount, 1);
      assert.equal(citizenStats.photoCount, 3);
      assert.equal(citizenStats.gpsVerifiedPhotoCount, 1);

      // Backfill provenance on an individual polygon and by user via CLI
      const retagOne = await runAdminCommand(pool, [
        'set-polygon-origin',
        'initiative_import',
        '--polygon',
        basePoly.id,
      ]);
      assert.equal(retagOne.updatedPolygonCount, 1);

      const retagByUser = await runAdminCommand(pool, [
        'set-polygon-origin',
        'citizen',
        '--user',
        'CitizenMapper',
      ]);
      assert.equal(retagByUser.updatedPolygonCount, 2);

      // Future --since window returns zero daily counters cleanly
      const futureTelemetry = await runAdminCommand(pool, [
        'export-telemetry',
        '--since',
        '2099-01-01',
      ]);
      assert.equal(futureTelemetry.telemetryExport?.dailySeries.length, 0);
    } finally {
      await app.close();
    }
  });
});
