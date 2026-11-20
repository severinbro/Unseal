// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 OpenUnseal Contributors

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, beforeEach, describe, it } from 'node:test';

import exifr from 'exifr';
import sharp from 'sharp';

import {
  ApiErrorEnvelopeSchema,
  CommentVoteResponseSchema,
  ImportPolygonsResponseSchema,
  PhotoVoteResponseSchema,
  PolygonCollectionResponseSchema,
  PolygonCommentListResponseSchema,
  PolygonCommentSchema,
  PolygonFeatureSchema,
  PolygonPhotoListResponseSchema,
  PolygonPhotoSchema,
  RegisterResponseSchema,
  SessionResponseSchema,
  type PolygonFeature,
} from '@openunseal/shared';

import {
  buildApp,
  createMemoryMailer,
  runAdminCommand,
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

const MAINZ_MUNICIPALITY_GEOJSON = JSON.stringify({
  type: 'Polygon',
  coordinates: [
    [
      [8.15, 49.92],
      [8.35, 49.92],
      [8.35, 50.05],
      [8.15, 50.05],
      [8.15, 49.92],
    ],
  ],
});

function makeCourtyardRing(baseLng: number, baseLat: number): [number, number][] {
  return [
    [baseLng, baseLat],
    [Number((baseLng + 0.00018).toFixed(6)), baseLat],
    [
      Number((baseLng + 0.00018).toFixed(6)),
      Number((baseLat + 0.00012).toFixed(6)),
    ],
    [baseLng, Number((baseLat + 0.00012).toFixed(6))],
    [baseLng, baseLat],
  ];
}

function buildMultipartPayload(options: {
  fieldName: string;
  fileName: string;
  contentType: string;
  fileBuffer: Buffer;
}): { body: Buffer; contentTypeHeader: string } {
  const boundary = '----EntsiegelungV2TestBoundary987654321';
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

function buildBulkMultipartPayload(
  files: ReadonlyArray<{
    fieldName: string;
    fileName: string;
    contentType: string;
    fileBuffer: Buffer;
  }>,
): { body: Buffer; contentTypeHeader: string } {
  const boundary = '----EntsiegelungBulkPhotoBoundary987654321';
  const chunks: Buffer[] = [];
  for (const file of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${file.fieldName}"; filename="${file.fileName}"\r\n` +
          `Content-Type: ${file.contentType}\r\n\r\n`,
        'utf8',
      ),
    );
    chunks.push(file.fileBuffer);
    chunks.push(Buffer.from('\r\n', 'utf8'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return {
    body: Buffer.concat(chunks),
    contentTypeHeader: `multipart/form-data; boundary=${boundary}`,
  };
}

function buildGeoPackageBinaryHeader(srsId: number, wkb: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header[0] = 0x47; // 'G'
  header[1] = 0x50; // 'P'
  header[2] = 0x00; // version 0
  header[3] = 0x01; // little-endian, no envelope, standard GPB, non-empty
  header.writeInt32LE(srsId, 4);
  return Buffer.concat([header, wkb]);
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

async function createPolygon(
  app: FastifyInstance,
  sessionToken: string,
  ring: [number, number][],
  note = 'Test courtyard',
): Promise<PolygonFeature> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/polygons',
    remoteAddress: '198.51.100.20',
    headers: { authorization: `Bearer ${sessionToken}` },
    payload: {
      geometry: { type: 'Polygon', coordinates: [ring] },
      surfaceType: 'asphalt',
      note,
    },
  });
  assert.equal(res.statusCode, 201);
  return PolygonFeatureSchema.parse(res.json());
}

describe('V2 Features: Municipality-bounded score normalization, admin "finished" status, GeoJSON/.gpkg import, and EXIF-safe GPS-verified photos', () => {
  let pool: pg.Pool;
  let uploadsDir: string;

  before(async () => {
    pool = await setupTestDb();
    uploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'entsiegelung-uploads-'));
  });

  beforeEach(async () => {
    await resetTestDb(pool);
    const entries = await fs.readdir(uploadsDir);
    await Promise.all(
      entries.map((entry) =>
        fs.rm(path.join(uploadsDir, entry), { force: true, recursive: true }),
      ),
    );
  });

  after(async () => {
    if (pool) {
      await pool.end();
    }
    if (uploadsDir) {
      await fs.rm(uploadsDir, { force: true, recursive: true });
    }
  });

  it('bounds positive score normalization independently per municipality (Hamburg vs. Mainz) and handles admin "finished" status transitions', async () => {
    const config = loadEnvConfig({ UPLOADS_DIR: uploadsDir });
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
      mailer: createMemoryMailer(),
      rateLimits: {
        register: { max: 100, timeWindow: '1 hour' },
        loginIp: { max: 100, timeWindow: '15 minutes' },
        vote: { max: 500, timeWindow: '1 minute' },
      },
    });

    try {
      const mapper = await registerTestUser(app, 'CityMapper', '198.51.100.10');
      const v1 = await registerTestUser(app, 'VoterOne', '198.51.100.11');
      const v2 = await registerTestUser(app, 'VoterTwo', '198.51.100.12');
      const v3 = await registerTestUser(app, 'VoterThree', '198.51.100.13');
      const v4 = await registerTestUser(app, 'VoterFour', '198.51.100.14');

      // Create Hamburg #1 BEFORE municipalities are loaded to also test backfill!
      const hhLow = await createPolygon(
        app,
        mapper.sessionToken,
        makeCourtyardRing(9.9937, 53.5511),
        'Hamburg low-score courtyard',
      );
      assert.equal(hhLow.properties.municipalityAgs, null);

      // Seed Hamburg (02000000) and Mainz (07315000) and backfill existing polygons
      const seedStats = await upsertMunicipalitiesAndBackfill(pool, [
        {
          ags: '02000000',
          name: 'Hamburg',
          designation: 'Freie und Hansestadt',
          stateCode: '02',
          geoJsonGeometry: HAMBURG_MUNICIPALITY_GEOJSON,
        },
        {
          ags: '07315000',
          name: 'Mainz',
          designation: 'Kreisfreie Stadt',
          stateCode: '07',
          geoJsonGeometry: MAINZ_MUNICIPALITY_GEOJSON,
        },
      ]);
      assert.equal(seedStats.upsertedMunicipalities, 2);
      assert.equal(seedStats.backfilledPolygons, 1);

      // Create Hamburg #2 and Mainz #1 (auto-matched at insert time)
      const hhHigh = await createPolygon(
        app,
        mapper.sessionToken,
        makeCourtyardRing(9.9965, 53.5522),
        'Hamburg top-voted schoolyard',
      );
      const mainzTop = await createPolygon(
        app,
        mapper.sessionToken,
        makeCourtyardRing(8.2711, 49.9988),
        'Mainz top-voted square',
      );
      assert.equal(hhHigh.properties.municipalityName, 'Hamburg');
      assert.equal(mainzTop.properties.municipalityName, 'Mainz');

      // Hamburg: hhHigh gets 4 upvotes (score=4), hhLow gets 3 upvotes (score=3)
      for (const voter of [v1, v2, v3, v4]) {
        await app.inject({
          method: 'PUT',
          url: `/api/v1/polygons/${hhHigh.id}/vote`,
          headers: { authorization: `Bearer ${voter.sessionToken}` },
          payload: { value: 1 },
        });
      }
      for (const voter of [v1, v2, v3]) {
        await app.inject({
          method: 'PUT',
          url: `/api/v1/polygons/${hhLow.id}/vote`,
          headers: { authorization: `Bearer ${voter.sessionToken}` },
          payload: { value: 1 },
        });
      }

      // Mainz: mainzTop also gets 3 upvotes (score=3), which is #1 inside Mainz!
      for (const voter of [v1, v2, v3]) {
        await app.inject({
          method: 'PUT',
          url: `/api/v1/polygons/${mainzTop.id}/vote`,
          headers: { authorization: `Bearer ${voter.sessionToken}` },
          payload: { value: 1 },
        });
      }

      const fetchedHhLow = PolygonFeatureSchema.parse(
        (await app.inject({ method: 'GET', url: `/api/v1/polygons/${hhLow.id}` })).json(),
      );
      const fetchedHhHigh = PolygonFeatureSchema.parse(
        (await app.inject({ method: 'GET', url: `/api/v1/polygons/${hhHigh.id}` })).json(),
      );
      const fetchedMainz = PolygonFeatureSchema.parse(
        (await app.inject({ method: 'GET', url: `/api/v1/polygons/${mainzTop.id}` })).json(),
      );

      // Hamburg: score 3 / max(4, 3) => 0.75; score 4 / max(4, 3) => 1.0
      assert.equal(fetchedHhLow.properties.municipalityMaxScore, 4);
      assert.equal(fetchedHhLow.properties.municipalityNormalizedScore, 0.75);
      assert.equal(fetchedHhHigh.properties.municipalityMaxScore, 4);
      assert.equal(fetchedHhHigh.properties.municipalityNormalizedScore, 1);

      // Mainz: same raw score (3), yet normalized = 1.0 inside Mainz (independent of Hamburg's max=4!)
      assert.equal(fetchedMainz.properties.municipalityMaxScore, 3);
      assert.equal(fetchedMainz.properties.municipalityNormalizedScore, 1);

      // Standard user CANNOT mark hhHigh as "finished" -> 403 FORBIDDEN_ADMIN_ONLY
      const nonAdminPatch = await app.inject({
        method: 'PATCH',
        url: `/api/v1/polygons/${hhHigh.id}/status`,
        headers: { authorization: `Bearer ${mapper.sessionToken}` },
        payload: { status: 'finished' },
      });
      assert.equal(nonAdminPatch.statusCode, 403);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(nonAdminPatch.json()).error.code,
        'FORBIDDEN_ADMIN_ONLY',
      );

      // Promote mapper via grant-admin CLI command
      const grantRes = await runAdminCommand(pool, ['grant-admin', 'CityMapper']);
      assert.equal(grantRes.role, 'admin');

      const adminPatchInProgress = await app.inject({
        method: 'PATCH',
        url: `/api/v1/polygons/${hhHigh.id}/status`,
        headers: { authorization: `Bearer ${mapper.sessionToken}` },
        payload: { status: 'in_progress' },
      });
      assert.equal(adminPatchInProgress.statusCode, 200);
      const inProgressFeature = PolygonFeatureSchema.parse(adminPatchInProgress.json());
      assert.equal(inProgressFeature.properties.status, 'in_progress');
      assert.equal(inProgressFeature.properties.finishedAt, null);
      assert.equal(inProgressFeature.properties.municipalityNormalizedScore, 0);

      // Once hhHigh is "in_progress", hhLow (score=3) already becomes the top proposed polygon in Hamburg (normalized = 1.0)
      const hhLowAfterInProgress = PolygonFeatureSchema.parse(
        (await app.inject({ method: 'GET', url: `/api/v1/polygons/${hhLow.id}` })).json(),
      );
      assert.equal(hhLowAfterInProgress.properties.municipalityMaxScore, 3);
      assert.equal(hhLowAfterInProgress.properties.municipalityNormalizedScore, 1);

      const adminPatchFinished = await app.inject({
        method: 'PATCH',
        url: `/api/v1/polygons/${hhHigh.id}/status`,
        headers: { authorization: `Bearer ${mapper.sessionToken}` },
        payload: { status: 'finished' },
      });
      assert.equal(adminPatchFinished.statusCode, 200);
      const finishedFeature = PolygonFeatureSchema.parse(adminPatchFinished.json());
      assert.equal(finishedFeature.properties.status, 'finished');
      assert.ok(finishedFeature.properties.finishedAt !== null);

      // Once hhHigh is "finished", hhLow (score=3) becomes the top proposed polygon in Hamburg (normalized = 1.0)
      const hhLowAfterFinish = PolygonFeatureSchema.parse(
        (await app.inject({ method: 'GET', url: `/api/v1/polygons/${hhLow.id}` })).json(),
      );
      assert.equal(hhLowAfterFinish.properties.municipalityMaxScore, 3);
      assert.equal(hhLowAfterFinish.properties.municipalityNormalizedScore, 1);

      // Admin can delete (204) another user's polygon, but CANNOT alter its attributes via PATCH (403 FORBIDDEN_NOT_AUTHOR)
      const otherUserPoly = await createPolygon(
        app,
        v1.sessionToken,
        makeCourtyardRing(9.9985, 53.5535),
        'VoterOne proposal moderated by admin',
      );
      const adminAlterOtherRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/polygons/${otherUserPoly.id}`,
        headers: { authorization: `Bearer ${mapper.sessionToken}` },
        payload: { surfaceType: 'pavers', note: 'Admin tried to rewrite note' },
      });
      assert.equal(adminAlterOtherRes.statusCode, 403);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(adminAlterOtherRes.json()).error.code,
        'FORBIDDEN_NOT_AUTHOR',
      );

      const adminDeleteOtherRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/polygons/${otherUserPoly.id}`,
        headers: { authorization: `Bearer ${mapper.sessionToken}` },
      });
      assert.equal(adminDeleteOtherRes.statusCode, 204);

      const getAfterAdminDelete = await app.inject({
        method: 'GET',
        url: `/api/v1/polygons/${otherUserPoly.id}`,
      });
      assert.equal(getAfterAdminDelete.statusCode, 404);

      // Revoking admin blocks status updates and non-author deletes again
      const secondOtherPoly = await createPolygon(
        app,
        v1.sessionToken,
        makeCourtyardRing(9.9995, 53.5545),
        'VoterOne second proposal',
      );
      const revokeRes = await runAdminCommand(pool, ['revoke-admin', 'CityMapper']);
      assert.equal(revokeRes.role, 'user');

      const afterRevokePatch = await app.inject({
        method: 'PATCH',
        url: `/api/v1/polygons/${hhHigh.id}/status`,
        headers: { authorization: `Bearer ${mapper.sessionToken}` },
        payload: { status: 'proposed' },
      });
      assert.equal(afterRevokePatch.statusCode, 403);

      const afterRevokeDeleteOther = await app.inject({
        method: 'DELETE',
        url: `/api/v1/polygons/${secondOtherPoly.id}`,
        headers: { authorization: `Bearer ${mapper.sessionToken}` },
      });
      assert.equal(afterRevokeDeleteOther.statusCode, 403);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(afterRevokeDeleteOther.json()).error.code,
        'FORBIDDEN_NOT_AUTHOR',
      );
    } finally {
      await app.close();
    }
  });

  it('restricts GeoJSON & .gpkg import to admins, splits MultiPolygons, and reprojects EPSG:25832 GeoPackages to EPSG:4326', async () => {
    const config = loadEnvConfig({ UPLOADS_DIR: uploadsDir });
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
      mailer: createMemoryMailer(),
    });

    try {
      await upsertMunicipalitiesAndBackfill(pool, [
        {
          ags: '02000000',
          name: 'Hamburg',
          geoJsonGeometry: HAMBURG_MUNICIPALITY_GEOJSON,
        },
      ]);

      const regularUser = await registerTestUser(app, 'NormalUser', '198.51.100.30');
      const adminUser = await registerTestUser(app, 'MunicipalAdmin', '198.51.100.31');
      await runAdminCommand(pool, ['grant-admin', 'MunicipalAdmin']);

      const geoJsonCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { surfaceType: 'concrete', note: 'Imported lot A' },
            geometry: {
              type: 'Polygon',
              coordinates: [makeCourtyardRing(9.991, 53.551)],
            },
          },
          {
            type: 'Feature',
            properties: { belag: 'Pflaster', beschreibung: 'Split MultiPolygon' },
            geometry: {
              type: 'MultiPolygon',
              coordinates: [
                [makeCourtyardRing(9.993, 53.551)],
                [makeCourtyardRing(9.995, 53.551)],
              ],
            },
          },
          {
            type: 'Feature',
            properties: { surfaceType: 'asphalt', note: 'Too tiny (<5m²)' },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [9.997, 53.551],
                  [9.997005, 53.551],
                  [9.997005, 53.551005],
                  [9.997, 53.551005],
                  [9.997, 53.551],
                ],
              ],
            },
          },
        ],
      };

      const geoJsonMultipart = buildMultipartPayload({
        fieldName: 'file',
        fileName: 'hamburg-import.geojson',
        contentType: 'application/geo+json',
        fileBuffer: Buffer.from(JSON.stringify(geoJsonCollection), 'utf8'),
      });

      // Non-admin -> 403 FORBIDDEN_ADMIN_ONLY
      const forbiddenImport = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons/import',
        headers: {
          authorization: `Bearer ${regularUser.sessionToken}`,
          'content-type': geoJsonMultipart.contentTypeHeader,
        },
        payload: geoJsonMultipart.body,
      });
      assert.equal(forbiddenImport.statusCode, 403);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(forbiddenImport.json()).error.code,
        'FORBIDDEN_ADMIN_ONLY',
      );

      // Admin import without ?license= and without embedded dataset license -> 422 VALIDATION_ERROR
      const missingLicenseImport = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons/import',
        headers: {
          authorization: `Bearer ${adminUser.sessionToken}`,
          'content-type': geoJsonMultipart.contentTypeHeader,
        },
        payload: geoJsonMultipart.body,
      });
      assert.equal(missingLicenseImport.statusCode, 422);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(missingLicenseImport.json()).error.code,
        'VALIDATION_ERROR',
      );

      // Admin GeoJSON import -> imports 3 valid polygons (1 Polygon + 2 from MultiPolygon) and skips 1 tiny polygon
      const okGeoJsonImport = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons/import?license=CC0-1.0',
        headers: {
          authorization: `Bearer ${adminUser.sessionToken}`,
          'content-type': geoJsonMultipart.contentTypeHeader,
        },
        payload: geoJsonMultipart.body,
      });
      assert.equal(okGeoJsonImport.statusCode, 200);
      const geoJsonRes = ImportPolygonsResponseSchema.parse(okGeoJsonImport.json());
      assert.equal(geoJsonRes.format, 'geojson');
      assert.equal(geoJsonRes.importedCount, 3);
      assert.equal(geoJsonRes.skippedCount, 1);
      assert.equal(geoJsonRes.errors.length, 1);

      // Incompatible embedded GeoJSON license ("CC-BY-NC-4.0") or query param (?license=proprietary) -> 422 VALIDATION_ERROR
      const ncGeoJsonMultipart = buildMultipartPayload({
        fieldName: 'file',
        fileName: 'restricted.geojson',
        contentType: 'application/geo+json',
        fileBuffer: Buffer.from(
          JSON.stringify({
            type: 'FeatureCollection',
            license: 'CC-BY-NC-4.0',
            features: geoJsonCollection.features.slice(0, 1),
          }),
          'utf8',
        ),
      });
      const rejectedNcImport = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons/import',
        headers: {
          authorization: `Bearer ${adminUser.sessionToken}`,
          'content-type': ncGeoJsonMultipart.contentTypeHeader,
        },
        payload: ncGeoJsonMultipart.body,
      });
      assert.equal(rejectedNcImport.statusCode, 422);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(rejectedNcImport.json()).error.code,
        'VALIDATION_ERROR',
      );

      const rejectedQueryLicenseImport = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons/import?license=proprietary',
        headers: {
          authorization: `Bearer ${adminUser.sessionToken}`,
          'content-type': geoJsonMultipart.contentTypeHeader,
        },
        payload: geoJsonMultipart.body,
      });
      assert.equal(rejectedQueryLicenseImport.statusCode, 422);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(rejectedQueryLicenseImport.json()).error.code,
        'VALIDATION_ERROR',
      );

      // Build a real SQLite GeoPackage (.gpkg) in EPSG:25832 (ETRS89 / UTM zone 32N) + GeoJSON with versioned OGC URN
      const utmWkbRes = await pool.query<{ wkb: Buffer; utm_geojson: string }>(
        `SELECT
           ST_AsBinary(
             ST_Transform(
               ST_SetSRID(
                 ST_GeomFromGeoJSON($1),
                 4326
               ),
               25832
             )
           ) AS wkb,
           ST_AsGeoJSON(
             ST_Transform(
               ST_SetSRID(
                 ST_GeomFromGeoJSON($2),
                 4326
               ),
               25832
             )
           ) AS utm_geojson`,
        [
          JSON.stringify({
            type: 'Polygon',
            coordinates: [makeCourtyardRing(9.998, 53.553)],
          }),
          JSON.stringify({
            type: 'Polygon',
            coordinates: [makeCourtyardRing(9.999, 53.553)],
          }),
        ],
      );
      const gpbBlob = buildGeoPackageBinaryHeader(25832, utmWkbRes.rows[0]!.wkb);

      const utmGeoJsonMultipart = buildMultipartPayload({
        fieldName: 'file',
        fileName: 'utm32n-versioned-urn.geojson',
        contentType: 'application/geo+json',
        fileBuffer: Buffer.from(
          JSON.stringify({
            type: 'FeatureCollection',
            crs: {
              type: 'name',
              properties: { name: 'urn:ogc:def:crs:EPSG:6.3:25832' },
            },
            features: [
              {
                type: 'Feature',
                properties: { surfaceType: 'asphalt', note: 'Reprojected from versioned EPSG URN GeoJSON' },
                geometry: JSON.parse(utmWkbRes.rows[0]!.utm_geojson),
              },
            ],
          }),
          'utf8',
        ),
      });
      const okUtmGeoJson = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons/import?license=CC0-1.0',
        headers: {
          authorization: `Bearer ${adminUser.sessionToken}`,
          'content-type': utmGeoJsonMultipart.contentTypeHeader,
        },
        payload: utmGeoJsonMultipart.body,
      });
      assert.equal(okUtmGeoJson.statusCode, 200);
      assert.equal(ImportPolygonsResponseSchema.parse(okUtmGeoJson.json()).importedCount, 1);

      const gpkgPath = path.join(uploadsDir, 'utm32n-sample.gpkg');
      const sqlite = new DatabaseSync(gpkgPath);
      try {
        sqlite.exec(`
          CREATE TABLE gpkg_spatial_ref_sys (
            srs_name TEXT NOT NULL,
            srs_id INTEGER NOT NULL PRIMARY KEY,
            organization TEXT NOT NULL,
            organization_coordsys_id INTEGER NOT NULL,
            definition TEXT NOT NULL
          );
          INSERT INTO gpkg_spatial_ref_sys VALUES ('ETRS89 / UTM 32N', 25832, 'EPSG', 25832, '');
          CREATE TABLE gpkg_contents (
            table_name TEXT NOT NULL PRIMARY KEY,
            data_type TEXT NOT NULL,
            identifier TEXT,
            srs_id INTEGER
          );
          INSERT INTO gpkg_contents VALUES ('sealed_lots', 'features', 'sealed_lots', 25832);
          CREATE TABLE gpkg_geometry_columns (
            table_name TEXT NOT NULL,
            column_name TEXT NOT NULL,
            geometry_type_name TEXT NOT NULL,
            srs_id INTEGER NOT NULL,
            z TINYINT NOT NULL,
            m TINYINT NOT NULL
          );
          INSERT INTO gpkg_geometry_columns VALUES ('sealed_lots', 'geom', 'POLYGON', 25832, 0, 0);
          CREATE TABLE sealed_lots (
            fid INTEGER PRIMARY KEY AUTOINCREMENT,
            geom BLOB NOT NULL,
            belag TEXT,
            notiz TEXT
          );
        `);
        const insertStmt = sqlite.prepare(
          'INSERT INTO sealed_lots (geom, belag, notiz) VALUES (?, ?, ?)',
        );
        insertStmt.run(gpbBlob, 'Beton', 'Reprojected from EPSG:25832 GPKG');
      } finally {
        sqlite.close();
      }

      const gpkgBuffer = await fs.readFile(gpkgPath);
      await fs.rm(gpkgPath, { force: true });

      const gpkgMultipart = buildMultipartPayload({
        fieldName: 'file',
        fileName: 'utm32n-sample.gpkg',
        contentType: 'application/geopackage+sqlite3',
        fileBuffer: gpkgBuffer,
      });

      const okGpkgImport = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons/import?license=CC0-1.0',
        headers: {
          authorization: `Bearer ${adminUser.sessionToken}`,
          'content-type': gpkgMultipart.contentTypeHeader,
        },
        payload: gpkgMultipart.body,
      });
      assert.equal(okGpkgImport.statusCode, 200);
      const gpkgRes = ImportPolygonsResponseSchema.parse(okGpkgImport.json());
      assert.equal(gpkgRes.format, 'gpkg');
      assert.equal(gpkgRes.importedCount, 1);
      assert.equal(gpkgRes.skippedCount, 0);

      // Verify all 5 imported polygons appear in Hamburg bbox with EPSG:4326 coordinates & municipality assigned
      const bboxRes = await app.inject({
        method: 'GET',
        url: '/api/v1/polygons?bbox=9.98,53.54,10.01,53.56',
      });
      assert.equal(bboxRes.statusCode, 200);
      const collection = PolygonCollectionResponseSchema.parse(bboxRes.json());
      assert.equal(collection.features.length, 5);
      const reprojectedFeature = collection.features.find(
        (f) => f.properties.note === 'Reprojected from EPSG:25832 GPKG',
      );
      assert.ok(reprojectedFeature, 'Expected GPKG feature in Hamburg WGS84 bbox');
      assert.equal(reprojectedFeature.properties.surfaceType, 'concrete');
      assert.equal(reprojectedFeature.properties.municipalityName, 'Hamburg');

      // 4) Regression test for gpkg_metadata license guard (must NOT swallow ApiError)
      const restrictedGpkgPath = path.join(uploadsDir, 'restricted-metadata.gpkg');
      const restrictedSqlite = new DatabaseSync(restrictedGpkgPath);
      try {
        restrictedSqlite.exec(`
          CREATE TABLE gpkg_spatial_ref_sys (
            srs_name TEXT NOT NULL,
            srs_id INTEGER NOT NULL PRIMARY KEY,
            organization TEXT NOT NULL,
            organization_coordsys_id INTEGER NOT NULL,
            definition TEXT NOT NULL
          );
          INSERT INTO gpkg_spatial_ref_sys VALUES ('ETRS89 / UTM 32N', 25832, 'EPSG', 25832, '');
          CREATE TABLE gpkg_contents (
            table_name TEXT NOT NULL PRIMARY KEY,
            data_type TEXT NOT NULL,
            identifier TEXT,
            srs_id INTEGER
          );
          INSERT INTO gpkg_contents VALUES ('sealed_lots', 'features', 'sealed_lots', 25832);
          CREATE TABLE gpkg_geometry_columns (
            table_name TEXT NOT NULL,
            column_name TEXT NOT NULL,
            geometry_type_name TEXT NOT NULL,
            srs_id INTEGER NOT NULL,
            z TINYINT NOT NULL,
            m TINYINT NOT NULL
          );
          INSERT INTO gpkg_geometry_columns VALUES ('sealed_lots', 'geom', 'POLYGON', 25832, 0, 0);
          CREATE TABLE gpkg_metadata (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            md_scope TEXT NOT NULL,
            md_standard_uri TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            metadata TEXT NOT NULL
          );
          INSERT INTO gpkg_metadata (md_scope, md_standard_uri, mime_type, metadata)
          VALUES ('dataset', 'http://example.org', 'text/plain', 'License: CC-BY-NC-4.0 non-commercial only');
          CREATE TABLE sealed_lots (
            fid INTEGER PRIMARY KEY AUTOINCREMENT,
            geom BLOB NOT NULL
          );
        `);
        restrictedSqlite
          .prepare('INSERT INTO sealed_lots (geom) VALUES (?)')
          .run(gpbBlob);
      } finally {
        restrictedSqlite.close();
      }
      const restrictedGpkgBuffer = await fs.readFile(restrictedGpkgPath);
      await fs.rm(restrictedGpkgPath, { force: true });

      const restrictedGpkgMultipart = buildMultipartPayload({
        fieldName: 'file',
        fileName: 'restricted-metadata.gpkg',
        contentType: 'application/geopackage+sqlite3',
        fileBuffer: restrictedGpkgBuffer,
      });
      const rejectedGpkgMetaRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons/import',
        headers: {
          authorization: `Bearer ${adminUser.sessionToken}`,
          'content-type': restrictedGpkgMultipart.contentTypeHeader,
        },
        payload: restrictedGpkgMultipart.body,
      });
      assert.equal(rejectedGpkgMetaRes.statusCode, 422);
      assert.equal(
        ApiErrorEnvelopeSchema.parse(rejectedGpkgMetaRes.json()).error.code,
        'VALIDATION_ERROR',
      );

      // 5) ODbL-1.0 bulk-import waiver gating & attribution persistence -> emitted in export.geojson
      const singleImportGeoJson = buildMultipartPayload({
        fieldName: 'file',
        fileName: 'waiver-gated.geojson',
        contentType: 'application/geo+json',
        fileBuffer: Buffer.from(
          JSON.stringify({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: { surfaceType: 'asphalt', note: 'Municipal open-data lot' },
                geometry: {
                  type: 'Polygon',
                  coordinates: [makeCourtyardRing(9.991, 53.556)],
                },
              },
            ],
          }),
          'utf8',
        ),
      });

      // CC-BY-4.0 / dl-de/by-2-0 without waiverConfirmed=true -> 422
      for (const gatedLic of ['CC-BY-4.0', 'dl-de/by-2-0']) {
        const unwaivedRes = await app.inject({
          method: 'POST',
          url: `/api/v1/polygons/import?license=${encodeURIComponent(gatedLic)}&attribution=${encodeURIComponent('Stadt Hamburg Open Data')}`,
          headers: {
            authorization: `Bearer ${adminUser.sessionToken}`,
            'content-type': singleImportGeoJson.contentTypeHeader,
          },
          payload: singleImportGeoJson.body,
        });
        assert.equal(unwaivedRes.statusCode, 422);
        assert.equal(
          ApiErrorEnvelopeSchema.parse(unwaivedRes.json()).error.code,
          'VALIDATION_ERROR',
        );
      }

      // ODbL-1.0 without sourceAttribution -> 422
      const odblNoAttrRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons/import?license=ODbL-1.0',
        headers: {
          authorization: `Bearer ${adminUser.sessionToken}`,
          'content-type': singleImportGeoJson.contentTypeHeader,
        },
        payload: singleImportGeoJson.body,
      });
      assert.equal(odblNoAttrRes.statusCode, 422);

      // CC-BY-4.0 WITH waiverConfirmed=true + attribution + sourceUrl -> 200, persisted & exported
      const waivedImportRes = await app.inject({
        method: 'POST',
        url: `/api/v1/polygons/import?license=CC-BY-4.0&waiverConfirmed=true&attribution=${encodeURIComponent('© Freie und Hansestadt Hamburg, LGV')}&sourceUrl=${encodeURIComponent('https://geoportal-hamburg.de/opendata')}`,
        headers: {
          authorization: `Bearer ${adminUser.sessionToken}`,
          'content-type': singleImportGeoJson.contentTypeHeader,
        },
        payload: singleImportGeoJson.body,
      });
      assert.equal(waivedImportRes.statusCode, 200);
      assert.equal(
        ImportPolygonsResponseSchema.parse(waivedImportRes.json()).importedCount,
        1,
      );

      const exportWithImportsRes = await app.inject({
        method: 'GET',
        url: '/api/v1/polygons/export.geojson',
      });
      assert.equal(exportWithImportsRes.statusCode, 200);
      const exportPayload = exportWithImportsRes.json() as {
        attribution?: string;
        upstreamConditions?: string;
        features?: Array<{
          properties: {
            municipalityAgs: string | null;
            municipalityName: string | null;
          };
        }>;
      };
      assert.match(
        exportPayload.attribution ?? '',
        /Imported open datasets:.*© Freie und Hansestadt Hamburg, LGV.*CC-BY-4\.0.*https:\/\/geoportal-hamburg\.de\/opendata.*ODbL-1\.0 waiver confirmed/,
      );
      assert.match(
        exportPayload.attribution ?? '',
        /Full license and source notices:.*\/auth\/licenses/,
      );
      assert.match(exportPayload.upstreamConditions ?? '', /CC BY 4\.0/);
      assert.ok(
        (exportPayload.features ?? []).some(
          (f) => f.properties.municipalityName === 'Hamburg',
        ),
      );

      // 6) Unrecognized/incompatible embedded licenses ("CC BY 3.0", "GPL-3.0") and query-vs-embedded license conflict -> 422
      for (const badEmbeddedLic of ['CC BY 3.0', 'GPL-3.0', 'ODC-By-1.0']) {
        const badEmbeddedMp = buildMultipartPayload({
          fieldName: 'file',
          fileName: 'bad-embedded.geojson',
          contentType: 'application/geo+json',
          fileBuffer: Buffer.from(
            JSON.stringify({
              type: 'FeatureCollection',
              license: badEmbeddedLic,
              attribution: '© Some Source',
              features: geoJsonCollection.features.slice(0, 1),
            }),
            'utf8',
          ),
        });
        const badRes = await app.inject({
          method: 'POST',
          url: '/api/v1/polygons/import',
          headers: {
            authorization: `Bearer ${adminUser.sessionToken}`,
            'content-type': badEmbeddedMp.contentTypeHeader,
          },
          payload: badEmbeddedMp.body,
        });
        assert.equal(badRes.statusCode, 422);
      }

      const conflictingQueryMp = buildMultipartPayload({
        fieldName: 'file',
        fileName: 'odbl-embedded.geojson',
        contentType: 'application/geo+json',
        fileBuffer: Buffer.from(
          JSON.stringify({
            type: 'FeatureCollection',
            license: 'ODbL-1.0',
            attribution: '© OpenStreetMap contributors',
            features: geoJsonCollection.features.slice(0, 1),
          }),
          'utf8',
        ),
      });
      const conflictRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons/import?license=CC0-1.0',
        headers: {
          authorization: `Bearer ${adminUser.sessionToken}`,
          'content-type': conflictingQueryMp.contentTypeHeader,
        },
        payload: conflictingQueryMp.body,
      });
      assert.equal(conflictRes.statusCode, 422);

      // 7) GeoPackage with embedded dl-de/by-2-0 in gpkg_metadata preserves dl-de/by-2-0 (never falsely claims CC0-1.0)
      const gpkgDlDePath = path.join(uploadsDir, 'dldeby20-metadata.gpkg');
      const gpkgDlDeWkbRes = await pool.query<{ wkb: Buffer }>(
        `SELECT ST_AsBinary(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), 25832)) AS wkb`,
        [
          JSON.stringify({
            type: 'Polygon',
            coordinates: [makeCourtyardRing(9.993, 53.556)],
          }),
        ],
      );
      const gpkgDlDeBlob = buildGeoPackageBinaryHeader(
        25832,
        gpkgDlDeWkbRes.rows[0]!.wkb,
      );
      const dlDeSqlite = new DatabaseSync(gpkgDlDePath);
      try {
        dlDeSqlite.exec(`
          CREATE TABLE gpkg_spatial_ref_sys (
            srs_name TEXT NOT NULL,
            srs_id INTEGER NOT NULL PRIMARY KEY,
            organization TEXT NOT NULL,
            organization_coordsys_id INTEGER NOT NULL,
            definition TEXT NOT NULL
          );
          INSERT INTO gpkg_spatial_ref_sys VALUES ('ETRS89 / UTM 32N', 25832, 'EPSG', 25832, '');
          CREATE TABLE gpkg_contents (
            table_name TEXT NOT NULL PRIMARY KEY,
            data_type TEXT NOT NULL,
            identifier TEXT,
            srs_id INTEGER
          );
          INSERT INTO gpkg_contents VALUES ('sealed_lots', 'features', 'sealed_lots', 25832);
          CREATE TABLE gpkg_geometry_columns (
            table_name TEXT NOT NULL,
            column_name TEXT NOT NULL,
            geometry_type_name TEXT NOT NULL,
            srs_id INTEGER NOT NULL,
            z TINYINT NOT NULL,
            m TINYINT NOT NULL
          );
          INSERT INTO gpkg_geometry_columns VALUES ('sealed_lots', 'geom', 'POLYGON', 25832, 0, 0);
          CREATE TABLE gpkg_metadata (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            md_scope TEXT NOT NULL,
            md_standard_uri TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            metadata TEXT NOT NULL
          );
          INSERT INTO gpkg_metadata (md_scope, md_standard_uri, mime_type, metadata)
          VALUES ('dataset', 'http://www.isotc211.org/2005/gmd', 'text/xml', '<gmd:MD_Metadata><gmd:useLimitation>Datenlizenz Deutschland - Namensnennung - Version 2.0 (dl-de/by-2-0)</gmd:useLimitation></gmd:MD_Metadata>');
          CREATE TABLE sealed_lots (
            fid INTEGER PRIMARY KEY AUTOINCREMENT,
            geom BLOB NOT NULL
          );
        `);
        dlDeSqlite
          .prepare('INSERT INTO sealed_lots (geom) VALUES (?)')
          .run(gpkgDlDeBlob);
      } finally {
        dlDeSqlite.close();
      }
      const dlDeGpkgBuffer = await fs.readFile(gpkgDlDePath);
      await fs.rm(gpkgDlDePath, { force: true });
      const dlDeGpkgMp = buildMultipartPayload({
        fieldName: 'file',
        fileName: 'dldeby20-metadata.gpkg',
        contentType: 'application/geopackage+sqlite3',
        fileBuffer: dlDeGpkgBuffer,
      });
      const dlDeGpkgImportRes = await app.inject({
        method: 'POST',
        url: `/api/v1/polygons/import?waiverConfirmed=true&attribution=${encodeURIComponent('© GeoBasis-DE / GeoSN')}`,
        headers: {
          authorization: `Bearer ${adminUser.sessionToken}`,
          'content-type': dlDeGpkgMp.contentTypeHeader,
        },
        payload: dlDeGpkgMp.body,
      });
      assert.equal(dlDeGpkgImportRes.statusCode, 200);

      // 8) ?includeMunicipality=false omits VG250 columns & VG250 attribution while preserving embedded dl-de/by-2-0 import license
      const exportNoMuniRes = await app.inject({
        method: 'GET',
        url: '/api/v1/polygons/export.geojson?includeMunicipality=false',
      });
      assert.equal(exportNoMuniRes.statusCode, 200);
      const exportNoMuniPayload = exportNoMuniRes.json() as {
        attribution?: string;
        features?: Array<{
          properties: {
            municipalityAgs: string | null;
            municipalityName: string | null;
          };
        }>;
      };
      assert.match(
        exportNoMuniPayload.attribution ?? '',
        /© GeoBasis-DE \/ GeoSN \(dl-de\/by-2-0; ODbL-1\.0 waiver confirmed\)/,
      );
      assert.equal(
        (exportNoMuniPayload.attribution ?? '').includes('GeoSN (CC0-1.0'),
        false,
      );
      assert.equal(
        (exportNoMuniPayload.attribution ?? '').includes('BKG'),
        false,
      );
      for (const feat of exportNoMuniPayload.features ?? []) {
        assert.equal(feat.properties.municipalityAgs, null);
        assert.equal(feat.properties.municipalityName, null);
      }
    } finally {
      await app.close();
    }
  });

  it('verifies EXIF GPS proximity ("GPS verified"), strips 100% of EXIF tags on WebP conversion, and supports photo real/fake voting & deletion', async () => {
    const config = loadEnvConfig({ UPLOADS_DIR: uploadsDir });
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
      mailer: createMemoryMailer(),
    });

    try {
      const uploader = await registerTestUser(app, 'PhotoMapper', '198.51.100.40');
      const rater1 = await registerTestUser(app, 'PhotoRater1', '198.51.100.41');
      const rater2 = await registerTestUser(app, 'PhotoRater2', '198.51.100.42');
      const rater3 = await registerTestUser(app, 'PhotoRater3', '198.51.100.43');
      const admin = await registerTestUser(app, 'PhotoAdmin', '198.51.100.44');
      await runAdminCommand(pool, ['grant-admin', 'PhotoAdmin']);

      const polygon = await createPolygon(
        app,
        uploader.sessionToken,
        makeCourtyardRing(9.9937, 53.5511),
        'Courtyard with photos',
      );

      // 1) Synthesize a JPEG with EXIF camera Make + GPS ~1.85 m outside southern edge of [53.5511..53.55122] (within 3 m buffer -> gpsVerified: true)
      const nearJpeg = await sharp({
        create: {
          width: 800,
          height: 600,
          channels: 3,
          background: { r: 90, g: 120, b: 100 },
        },
      })
        .withExif({
          IFD0: {
            Make: 'SensitivePhoneVendor',
            Model: 'TrackerCam Pro',
          },
          IFD3: {
            GPSLatitudeRef: 'N',
            GPSLatitude: '53 33 3.90',
            GPSLongitudeRef: 'E',
            GPSLongitude: '9 59 37.40',
          },
        })
        .jpeg({ quality: 85 })
        .toBuffer();

      // Confirm input JPEG actually carries EXIF GPS & Make before upload
      const inputExif = await exifr.parse(nearJpeg);
      assert.equal(inputExif?.Make, 'SensitivePhoneVendor');
      const inputGps = await exifr.gps(nearJpeg);
      assert.ok(inputGps && Math.abs(inputGps.latitude - 53.5511) < 0.002);

      const nearMultipart = buildMultipartPayload({
        fieldName: 'photo',
        fileName: 'courtyard-onsite.jpg',
        contentType: 'image/jpeg',
        fileBuffer: nearJpeg,
      });

      const uploadNearRes = await app.inject({
        method: 'POST',
        url: `/api/v1/polygons/${polygon.id}/photos`,
        headers: {
          authorization: `Bearer ${uploader.sessionToken}`,
          'content-type': nearMultipart.contentTypeHeader,
        },
        payload: nearMultipart.body,
      });
      assert.equal(uploadNearRes.statusCode, 201);
      const nearPhoto = PolygonPhotoSchema.parse(uploadNearRes.json());
      assert.equal(nearPhoto.gpsVerified, true);
      assert.equal(nearPhoto.uploaderPseudonym, 'PhotoMapper');

      // 2) Synthesize a JPEG with GPS ~11.1 m south of polygon edge (> 3 m buffer -> gpsVerified: false)
      const farJpeg = await sharp({
        create: {
          width: 640,
          height: 480,
          channels: 3,
          background: { r: 140, g: 100, b: 90 },
        },
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

      const farMultipart = buildMultipartPayload({
        fieldName: 'photo',
        fileName: 'munich-offsite.jpg',
        contentType: 'image/jpeg',
        fileBuffer: farJpeg,
      });

      const uploadFarRes = await app.inject({
        method: 'POST',
        url: `/api/v1/polygons/${polygon.id}/photos`,
        headers: {
          authorization: `Bearer ${rater1.sessionToken}`,
          'content-type': farMultipart.contentTypeHeader,
        },
        payload: farMultipart.body,
      });
      assert.equal(uploadFarRes.statusCode, 201);
      const farPhoto = PolygonPhotoSchema.parse(uploadFarRes.json());
      assert.equal(farPhoto.gpsVerified, false);

      // Verify polygon.properties.photoCount incremented to 2
      const polyWithPhotos = PolygonFeatureSchema.parse(
        (await app.inject({ method: 'GET', url: `/api/v1/polygons/${polygon.id}` })).json(),
      );
      assert.equal(polyWithPhotos.properties.photoCount, 2);

      // 3) Serve stored WebP image & prove 100% EXIF stripping, GDPR-safe Cache-Control, + path-traversal rejection
      const servedImgRes = await app.inject({
        method: 'GET',
        url: nearPhoto.url,
      });
      assert.equal(servedImgRes.statusCode, 200);
      assert.equal(servedImgRes.headers['content-type'], 'image/webp');
      assert.equal(
        servedImgRes.headers['cache-control'],
        'public, max-age=3600, must-revalidate',
      );
      assert.equal(
        servedImgRes.headers.link,
        '<https://creativecommons.org/licenses/by/4.0/>; rel="license"',
      );
      const servedMeta = await sharp(servedImgRes.rawPayload).metadata();
      assert.equal(servedMeta.format, 'webp');
      assert.equal(servedMeta.exif, undefined);
      assert.equal(servedMeta.xmp, undefined);
      assert.equal(servedMeta.iptc, undefined);
      assert.equal(
        servedImgRes.rawPayload.includes(Buffer.from('SensitivePhoneVendor', 'utf8')),
        false,
      );

      const traversalRes = await app.inject({
        method: 'GET',
        url: '/uploads/..%2Fsecret.webp',
      });
      assert.equal(traversalRes.statusCode, 404);

      // 4) Self-voting (+1 or -1) on own uploaded photo is rejected with 403 FORBIDDEN_SELF_VOTE
      for (const selfValue of [1, -1] as const) {
        const selfNearRes = await app.inject({
          method: 'PUT',
          url: `/api/v1/photos/${nearPhoto.id}/vote`,
          headers: { authorization: `Bearer ${uploader.sessionToken}` },
          payload: { value: selfValue },
        });
        assert.equal(selfNearRes.statusCode, 403);
        assert.equal(
          ApiErrorEnvelopeSchema.parse(selfNearRes.json()).error.code,
          'FORBIDDEN_SELF_VOTE',
        );

        const selfFarRes = await app.inject({
          method: 'PUT',
          url: `/api/v1/photos/${farPhoto.id}/vote`,
          headers: { authorization: `Bearer ${rater1.sessionToken}` },
          payload: { value: selfValue },
        });
        assert.equal(selfFarRes.statusCode, 403);
        assert.equal(
          ApiErrorEnvelopeSchema.parse(selfFarRes.json()).error.code,
          'FORBIDDEN_SELF_VOTE',
        );
      }

      // Rate farPhoto as "fake" (-1) by 3 distinct non-uploader users -> credibilityScore = -3, isFlaggedFake = true
      for (const rater of [uploader, rater2, rater3]) {
        const voteRes = await app.inject({
          method: 'PUT',
          url: `/api/v1/photos/${farPhoto.id}/vote`,
          headers: { authorization: `Bearer ${rater.sessionToken}` },
          payload: { value: -1 },
        });
        assert.equal(voteRes.statusCode, 200);
        PhotoVoteResponseSchema.parse(voteRes.json());
      }

      // Rate nearPhoto as "real" (+1)
      const realVoteRes = await app.inject({
        method: 'PUT',
        url: `/api/v1/photos/${nearPhoto.id}/vote`,
        headers: { authorization: `Bearer ${rater1.sessionToken}` },
        payload: { value: 1 },
      });
      assert.equal(realVoteRes.statusCode, 200);
      assert.equal(PhotoVoteResponseSchema.parse(realVoteRes.json()).realVotes, 1);

      const listPhotosRes = await app.inject({
        method: 'GET',
        url: `/api/v1/polygons/${polygon.id}/photos`,
        headers: { authorization: `Bearer ${rater1.sessionToken}` },
      });
      assert.equal(listPhotosRes.statusCode, 200);
      assert.equal(
        listPhotosRes.headers.link,
        '<https://creativecommons.org/licenses/by/4.0/>; rel="license"',
      );
      const photoList = PolygonPhotoListResponseSchema.parse(listPhotosRes.json());
      assert.equal(photoList.photos.length, 2);
      // Ordered by credibility_score DESC -> nearPhoto (+1) first, farPhoto (-3, flagged fake) second
      assert.equal(photoList.photos[0]!.id, nearPhoto.id);
      assert.equal(photoList.photos[0]!.myVote, 1);
      assert.equal(photoList.photos[1]!.id, farPhoto.id);
      assert.equal(photoList.photos[1]!.credibilityScore, -3);
      assert.equal(photoList.photos[1]!.isFlaggedFake, true);

      // Removing a photo vote works
      const delVoteRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/photos/${nearPhoto.id}/vote`,
        headers: { authorization: `Bearer ${rater1.sessionToken}` },
      });
      assert.equal(delVoteRes.statusCode, 200);
      assert.equal(PhotoVoteResponseSchema.parse(delVoteRes.json()).realVotes, 0);

      // 5) Deletion permissions: third-party non-admin -> 403; uploader -> 204; admin -> 204
      const thirdPartyDel = await app.inject({
        method: 'DELETE',
        url: `/api/v1/photos/${nearPhoto.id}`,
        headers: { authorization: `Bearer ${rater2.sessionToken}` },
      });
      assert.equal(thirdPartyDel.statusCode, 403);

      const uploaderDel = await app.inject({
        method: 'DELETE',
        url: `/api/v1/photos/${nearPhoto.id}`,
        headers: { authorization: `Bearer ${uploader.sessionToken}` },
      });
      assert.equal(uploaderDel.statusCode, 204);

      const adminDel = await app.inject({
        method: 'DELETE',
        url: `/api/v1/photos/${farPhoto.id}`,
        headers: { authorization: `Bearer ${admin.sessionToken}` },
      });
      assert.equal(adminDel.statusCode, 204);

      const polyAfterDeletes = PolygonFeatureSchema.parse(
        (await app.inject({ method: 'GET', url: `/api/v1/polygons/${polygon.id}` })).json(),
      );
      assert.equal(polyAfterDeletes.properties.photoCount, 0);
      assert.equal((await fs.readdir(uploadsDir)).length, 0);

      // 6) Bulk gallery upload: POST /api/v1/polygons/:id/photos/bulk accepts multiple images at once
      const bulkMp = buildBulkMultipartPayload([
        {
          fieldName: 'photos',
          fileName: 'gallery-1.jpg',
          contentType: 'image/jpeg',
          fileBuffer: nearJpeg,
        },
        {
          fieldName: 'photos',
          fileName: 'gallery-2.jpg',
          contentType: 'image/jpeg',
          fileBuffer: farJpeg,
        },
      ]);
      const bulkUploadRes = await app.inject({
        method: 'POST',
        url: `/api/v1/polygons/${polygon.id}/photos/bulk`,
        headers: {
          authorization: `Bearer ${uploader.sessionToken}`,
          'content-type': bulkMp.contentTypeHeader,
        },
        payload: bulkMp.body,
      });
      assert.equal(bulkUploadRes.statusCode, 201);
      const bulkUploaded = PolygonPhotoListResponseSchema.parse(
        bulkUploadRes.json(),
      );
      assert.equal(bulkUploaded.photos.length, 2);
      assert.equal(bulkUploaded.photos[0]!.gpsVerified, true);
      assert.equal(bulkUploaded.photos[1]!.gpsVerified, false);

      const polyAfterBulk = PolygonFeatureSchema.parse(
        (await app.inject({ method: 'GET', url: `/api/v1/polygons/${polygon.id}` })).json(),
      );
      assert.equal(polyAfterBulk.properties.photoCount, 2);
    } finally {
      await app.close();
    }
  });

  it('supports isolated per-polygon comment instances, nested replies, comment upvotes, highest-rated-first ordering, and GDPR/moderation cleanup', async () => {
    const config = loadEnvConfig({ UPLOADS_DIR: uploadsDir });
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
      mailer: createMemoryMailer(),
      rateLimits: {
        register: { max: 100, timeWindow: '1 hour' },
        loginIp: { max: 100, timeWindow: '15 minutes' },
        vote: { max: 500, timeWindow: '1 minute' },
      },
    });
    try {
      const alice = await registerTestUser(app, 'alice_discuss', '198.51.100.41');
      const bob = await registerTestUser(app, 'bob_discuss', '198.51.100.42');
      const clara = await registerTestUser(app, 'clara_discuss', '198.51.100.43');

      // Create two distinct polygons so we verify strict per-polygon comment isolation
      const polyA = await createPolygon(
        app,
        alice.sessionToken,
        makeCourtyardRing(9.9937, 53.5511),
        'Polygon A courtyard',
      );
      assert.equal(polyA.properties.commentCount, 0);

      const polyB = await createPolygon(
        app,
        alice.sessionToken,
        makeCourtyardRing(8.271, 49.998),
        'Polygon B square',
      );

      // Unauthenticated comment creation is rejected (401)
      const unauthPost = await app.inject({
        method: 'POST',
        url: `/api/v1/polygons/${polyA.id}/comments`,
        payload: { body: 'Unauthenticated comment' },
      });
      assert.equal(unauthPost.statusCode, 401);

      // Alice posts a root comment on Polygon A
      const c1Res = await app.inject({
        method: 'POST',
        url: `/api/v1/polygons/${polyA.id}/comments`,
        headers: { authorization: `Bearer ${alice.sessionToken}` },
        payload: { body: 'First root comment on Polygon A' },
      });
      assert.equal(c1Res.statusCode, 201);
      const c1 = PolygonCommentSchema.parse(c1Res.json());
      assert.equal(c1.polygonId, polyA.id);
      assert.equal(c1.parentId, null);
      assert.equal(c1.authorPseudonym, 'alice_discuss');
      assert.equal(c1.isAuthor, true);
      assert.equal(c1.upvotes, 0);

      // Bob posts a second root comment on Polygon A
      const c2Res = await app.inject({
        method: 'POST',
        url: `/api/v1/polygons/${polyA.id}/comments`,
        headers: { authorization: `Bearer ${bob.sessionToken}` },
        payload: { body: 'Second root comment on Polygon A' },
      });
      assert.equal(c2Res.statusCode, 201);
      const c2 = PolygonCommentSchema.parse(c2Res.json());

      // Clara replies to Alice's comment c1 ("comment other comments")
      const replyRes = await app.inject({
        method: 'POST',
        url: `/api/v1/polygons/${polyA.id}/comments`,
        headers: { authorization: `Bearer ${clara.sessionToken}` },
        payload: {
          body: 'Detailed hydrological reply to Alice',
          parentId: c1.id,
        },
      });
      assert.equal(replyRes.statusCode, 201);
      const reply = PolygonCommentSchema.parse(replyRes.json());
      assert.equal(reply.parentId, c1.id);

      // Cross-polygon parentId is strictly rejected with 404 NOT_FOUND
      const crossPolyReply = await app.inject({
        method: 'POST',
        url: `/api/v1/polygons/${polyB.id}/comments`,
        headers: { authorization: `Bearer ${bob.sessionToken}` },
        payload: {
          body: 'Trying to reply across polygons',
          parentId: c1.id,
        },
      });
      assert.equal(crossPolyReply.statusCode, 404);

      // Polygon B still has 0 comments (isolated per-polygon comment instance)
      const polyBCommentsRes = await app.inject({
        method: 'GET',
        url: `/api/v1/polygons/${polyB.id}/comments`,
      });
      assert.equal(polyBCommentsRes.statusCode, 200);
      const polyBList = PolygonCommentListResponseSchema.parse(polyBCommentsRes.json());
      assert.equal(polyBList.comments.length, 0);
      assert.equal(polyBList.topCommentId, null);

      // Polygon A has commentCount = 3
      const polyAAfterPost = PolygonFeatureSchema.parse(
        (await app.inject({ method: 'GET', url: `/api/v1/polygons/${polyA.id}` })).json(),
      );
      assert.equal(polyAAfterPost.properties.commentCount, 3);

      // Upvote comments: give c2 1 upvote, and give Clara's reply 2 upvotes (Alice + Bob)
      const voteC2 = await app.inject({
        method: 'PUT',
        url: `/api/v1/comments/${c2.id}/vote`,
        headers: { authorization: `Bearer ${alice.sessionToken}` },
        payload: { value: 1 },
      });
      assert.equal(voteC2.statusCode, 200);
      assert.equal(CommentVoteResponseSchema.parse(voteC2.json()).upvotes, 1);

      await app.inject({
        method: 'PUT',
        url: `/api/v1/comments/${reply.id}/vote`,
        headers: { authorization: `Bearer ${alice.sessionToken}` },
        payload: { value: 1 },
      });
      const voteReplyBob = await app.inject({
        method: 'PUT',
        url: `/api/v1/comments/${reply.id}/vote`,
        headers: { authorization: `Bearer ${bob.sessionToken}` },
        payload: {},
      });
      assert.equal(voteReplyBob.statusCode, 200);
      const parsedReplyVote = CommentVoteResponseSchema.parse(voteReplyBob.json());
      assert.equal(parsedReplyVote.upvotes, 2);
      assert.equal(parsedReplyVote.myVote, 1);

      // GET /api/v1/polygons/:id/comments returns highest-rated comment ALWAYS at index 0 + sets topCommentId
      const listPolyARes = await app.inject({
        method: 'GET',
        url: `/api/v1/polygons/${polyA.id}/comments`,
        headers: { authorization: `Bearer ${bob.sessionToken}` },
      });
      assert.equal(listPolyARes.statusCode, 200);
      assert.equal(
        listPolyARes.headers.link,
        '<https://creativecommons.org/licenses/by/4.0/>; rel="license"',
      );
      const polyAList = PolygonCommentListResponseSchema.parse(listPolyARes.json());
      assert.equal(polyAList.topCommentId, reply.id);
      assert.equal(polyAList.comments[0]?.id, reply.id);
      assert.equal(polyAList.comments[0]?.upvotes, 2);
      assert.equal(polyAList.comments[0]?.myVote, 1);
      assert.equal(polyAList.comments[1]?.id, c2.id);
      assert.equal(polyAList.comments[1]?.upvotes, 1);
      assert.equal(polyAList.comments[2]?.id, c1.id);
      assert.equal(polyAList.comments[2]?.upvotes, 0);

      // Removing an upvote updates score immediately
      const unvoteRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/comments/${c2.id}/vote`,
        headers: { authorization: `Bearer ${alice.sessionToken}` },
      });
      assert.equal(unvoteRes.statusCode, 200);
      assert.equal(CommentVoteResponseSchema.parse(unvoteRes.json()).upvotes, 0);

      // Non-author cannot delete someone else's comment (403 FORBIDDEN_NOT_AUTHOR)
      const forbiddenDel = await app.inject({
        method: 'DELETE',
        url: `/api/v1/comments/${c2.id}`,
        headers: { authorization: `Bearer ${clara.sessionToken}` },
      });
      assert.equal(forbiddenDel.statusCode, 403);

      // GDPR self-deletion (Clara) anonymizes Clara's surviving comment to 'deleted' and removes Bob's/Clara's votes cleanly
      const claraDelMe = await app.inject({
        method: 'DELETE',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${clara.sessionToken}` },
      });
      assert.equal(claraDelMe.statusCode, 204);

      const listAfterGdpr = PolygonCommentListResponseSchema.parse(
        (await app.inject({ method: 'GET', url: `/api/v1/polygons/${polyA.id}/comments` })).json(),
      );
      const survivingReply = listAfterGdpr.comments.find((c) => c.id === reply.id);
      assert.equal(survivingReply?.authorPseudonym, 'deleted');
      assert.equal(survivingReply?.upvotes, 2);

      // Deleting parent comment c1 cascades to reply and updates commentCount from 3 -> 1
      const delParentRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/comments/${c1.id}`,
        headers: { authorization: `Bearer ${alice.sessionToken}` },
      });
      assert.equal(delParentRes.statusCode, 204);

      const polyAAfterCascade = PolygonFeatureSchema.parse(
        (await app.inject({ method: 'GET', url: `/api/v1/polygons/${polyA.id}` })).json(),
      );
      assert.equal(polyAAfterCascade.properties.commentCount, 1);

      // CLI moderation command delete-comment removes c2 and updates commentCount -> 0
      const cliRes = await runAdminCommand(pool, ['delete-comment', c2.id]);
      assert.equal(cliRes.command, 'delete-comment');
      assert.equal(cliRes.deletedComment, true);
      assert.equal(cliRes.commentId, c2.id);

      const polyAFinal = PolygonFeatureSchema.parse(
        (await app.inject({ method: 'GET', url: `/api/v1/polygons/${polyA.id}` })).json(),
      );
      assert.equal(polyAFinal.properties.commentCount, 0);
    } finally {
      await app.close();
    }
  });

  it('DELETE /api/v1/auth/me?purgeContent=true erases own polygons, photos (incl. files) and comments; plain deletion keeps them anonymised', async () => {
    const config = loadEnvConfig({ UPLOADS_DIR: uploadsDir });
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
      mailer: createMemoryMailer(),
    });

    const uploadPhoto = async (sessionToken: string, polygonId: string): Promise<void> => {
      const jpeg = await sharp({
        create: { width: 320, height: 240, channels: 3, background: { r: 80, g: 110, b: 90 } },
      })
        .jpeg({ quality: 80 })
        .toBuffer();
      const multipart = buildMultipartPayload({
        fieldName: 'photo',
        fileName: 'site.jpg',
        contentType: 'image/jpeg',
        fileBuffer: jpeg,
      });
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/polygons/${polygonId}/photos`,
        headers: {
          authorization: `Bearer ${sessionToken}`,
          'content-type': multipart.contentTypeHeader,
        },
        payload: multipart.body,
      });
      assert.equal(res.statusCode, 201);
    };
    const comment = async (sessionToken: string, polygonId: string, body: string): Promise<void> => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/polygons/${polygonId}/comments`,
        remoteAddress: '198.51.100.60',
        headers: { authorization: `Bearer ${sessionToken}` },
        payload: { body },
      });
      assert.equal(res.statusCode, 201);
    };

    try {
      const purger = await registerTestUser(app, 'PurgeMapper', '198.51.100.61');
      const keeper = await registerTestUser(app, 'KeepMapper', '198.51.100.62');
      const other = await registerTestUser(app, 'OtherMapper', '198.51.100.63');

      const purgerPoly = await createPolygon(app, purger.sessionToken, makeCourtyardRing(9.9937, 53.5511));
      const keeperPoly = await createPolygon(app, keeper.sessionToken, makeCourtyardRing(9.9947, 53.5511));
      const otherPoly = await createPolygon(app, other.sessionToken, makeCourtyardRing(9.9957, 53.5511));

      await uploadPhoto(purger.sessionToken, purgerPoly.id);
      await uploadPhoto(purger.sessionToken, otherPoly.id);
      await uploadPhoto(keeper.sessionToken, keeperPoly.id);
      await comment(purger.sessionToken, otherPoly.id, 'Purger comment on other polygon');
      await comment(keeper.sessionToken, otherPoly.id, 'Keeper comment on other polygon');
      assert.equal((await fs.readdir(uploadsDir)).length, 6);

      // Plain deletion: contributions stay public, anonymised as "deleted"
      const keepRes = await app.inject({
        method: 'DELETE',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${keeper.sessionToken}` },
      });
      assert.equal(keepRes.statusCode, 204);
      const keptPoly = await app.inject({ method: 'GET', url: `/api/v1/polygons/${keeperPoly.id}` });
      assert.equal(keptPoly.statusCode, 200);
      assert.equal(PolygonFeatureSchema.parse(keptPoly.json()).properties.authorPseudonym, 'deleted');
      assert.equal((await fs.readdir(uploadsDir)).length, 6);

      // Purge: own polygons, photos (rows + files) and comments are erased
      const badQuery = await app.inject({
        method: 'DELETE',
        url: '/api/v1/auth/me?purgeContent=maybe',
        headers: { authorization: `Bearer ${purger.sessionToken}` },
      });
      assert.equal(badQuery.statusCode, 422);
      const purgeRes = await app.inject({
        method: 'DELETE',
        url: '/api/v1/auth/me?purgeContent=true',
        headers: { authorization: `Bearer ${purger.sessionToken}` },
      });
      assert.equal(purgeRes.statusCode, 204);

      const purgedPoly = await app.inject({ method: 'GET', url: `/api/v1/polygons/${purgerPoly.id}` });
      assert.equal(purgedPoly.statusCode, 404);
      const remaining = await pool.query<{ photos: number; comments: number; users: number }>(
        `SELECT
           (SELECT COUNT(*)::int FROM polygon_photos) AS photos,
           (SELECT COUNT(*)::int FROM polygon_comments) AS comments,
           (SELECT COUNT(*)::int FROM users WHERE LOWER(pseudonym) = 'purgemapper') AS users`,
      );
      assert.deepEqual(remaining.rows[0], { photos: 1, comments: 1, users: 0 });
      // Only the keeper's photo + thumbnail remain on disk
      assert.equal((await fs.readdir(uploadsDir)).length, 2);

      const otherAfter = PolygonFeatureSchema.parse(
        (await app.inject({ method: 'GET', url: `/api/v1/polygons/${otherPoly.id}` })).json(),
      );
      assert.equal(otherAfter.properties.photoCount, 0);
      assert.equal(otherAfter.properties.commentCount, 1);

      // No email ban tombstone for a voluntary purge: the address can register again
      const reRegister = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: '198.51.100.64',
        payload: {
          pseudonym: 'PurgeMapperReturns',
          email: 'purgemapper@example.org',
          password: 'valid-password-123',
          acceptedPrivacyPolicy: true,
          acceptedTerms: true,
        },
      });
      assert.equal(reRegister.statusCode, 201);
      const returned = await pool.query(
        "SELECT 1 FROM users WHERE LOWER(pseudonym) = 'purgemapperreturns'",
      );
      assert.equal(returned.rowCount, 1);
    } finally {
      await app.close();
    }
  });
});
