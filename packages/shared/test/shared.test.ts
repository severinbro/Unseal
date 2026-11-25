// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';

import {
  AUTH_LIMITS,
  AltchaChallengeResponseSchema,
  ApiError,
  ApiErrorEnvelopeSchema,
  AuthUserSchema,
  BboxQuerySchema,
  BrandingConfigSchema,
  COMMENT_LIMITS,
  CONTENT_REPORT_REASONS,
  CONTENT_REPORT_TARGET_TYPES,
  CommentVoteRequestSchema,
  CommentVoteResponseSchema,
  CreateContentReportRequestSchema,
  CreateContentReportResponseSchema,
  CreatePolygonCommentRequestSchema,
  CreatePolygonRequestSchema,
  DEFAULT_APP_NAME,
  type DraftValidationResult,
  type ErrorCode,
  FlagPolygonRequestSchema,
  FlagPolygonResponseSchema,
  GEOMETRY_LIMITS,
  GERMAN_STATE_DOP20_PROVIDERS,
  HealthResponseSchema,
  HexColorSchema,
  IMPORT_LIMITS,
  ImportPolygonsResponseSchema,
  LoginRequestSchema,
  PHOTO_LIMITS,
  POLYGON_STATUSES,
  PatchPolygonRequestSchema,
  PatchPolygonStatusRequestSchema,
  PolygonCommentListResponseSchema,
  PolygonCommentSchema,
  PolygonListQuerySchema,
  PolygonPhotoSchema,
  type PolygonFeature,
  PolygonCollectionResponseSchema,
  PolygonFeatureSchema,
  RESERVED_PSEUDONYMS,
  PublicStatsResponseSchema,
  PersonalStatsResponseSchema,
  TRUST_AND_MODERATION_LIMITS,
  RecoverRequestSchema,
  RegisterRequestSchema,
  RegisterResponseSchema,
  type RuntimeConfig,
  RuntimeConfigSchema,
  SURFACE_TYPES,
  SessionResponseSchema,
  type SurfaceType,
  UuidParamSchema,
  VoteRequestSchema,
  VoteResponseSchema,
  WEBHOOK_EVENT_TYPES,
  checkBboxSpan,
  checkPolygonRingStructure,
  closeRingIfNeeded,
  formatDefaultDop20Attribution,
  formatDop20PlainAttribution,
  formatDop20WebAttributionHtml,
  formatStateDop20FullAttribution,
  selectDop20ProvidersForBounds,
  computeMunicipalityNormalizedScore,
  dedupeConsecutivePoints,
  findTopRatedCommentId,
  sortPolygonCommentsByRating,
  normalizeRecoveryCode,
  validateDraftPolygon,
} from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sharedRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(sharedRoot, '../..');

/**
 * Valid ~120 m² courtyard rectangle in Hamburg (~10 m × ~12 m at 53.5511°N).
 * At 53.5511°N: 0.00015° lng ≈ 9.92 m, 0.000108° lat ≈ 12.02 m -> ~119.3 m².
 */
const VALID_COURTYARD_VERTICES: [number, number][] = [
  [9.9937, 53.5511],
  [9.99385, 53.5511],
  [9.99385, 53.551208],
  [9.9937, 53.551208],
];

describe('@openunseal/shared bootstrap, licensing, and compiled ESM contract', () => {
  it('ships verbatim AGPL-3.0-or-later and MPL-2.0 LICENSE files, split LICENSING.md notice, and THIRD_PARTY_NOTICES.txt', () => {
    const rootLicense = fs.readFileSync(path.join(repoRoot, 'LICENSE'), 'utf8');
    const mobileLicense = fs.readFileSync(
      path.join(repoRoot, 'apps', 'mobile', 'LICENSE'),
      'utf8',
    );
    const sharedLicense = fs.readFileSync(path.join(sharedRoot, 'LICENSE'), 'utf8');
    const licensingNotice = fs.readFileSync(
      path.join(repoRoot, 'LICENSING.md'),
      'utf8',
    );
    const thirdPartyNotices = fs.readFileSync(
      path.join(repoRoot, 'THIRD_PARTY_NOTICES.txt'),
      'utf8',
    );

    // Verbatim FSF AGPLv3 and Mozilla MPL-2.0 texts (no prepended headers)
    assert.equal(
      rootLicense.startsWith('GNU AFFERO GENERAL PUBLIC LICENSE'),
      true,
    );
    assert.equal(
      sharedLicense.startsWith('Mozilla Public License Version 2.0'),
      true,
    );
    assert.equal(
      mobileLicense.startsWith('Mozilla Public License Version 2.0'),
      true,
    );

    // Split license scope & AGPLv3 Section 13 clarification in LICENSING.md & CITATION.cff
    const citationCff = fs.readFileSync(path.join(repoRoot, 'CITATION.cff'), 'utf8');
    assert.match(citationCff, /AGPL-3\.0-or-later/);
    assert.match(citationCff, /MPL-2\.0/);
    // CFF 1.2.0 reads a multi-entry `license` list as OR (dual licensing), which would
    // misstate the per-component split; the file must point to LICENSING.md instead.
    assert.doesNotMatch(citationCff, /^license:/m);
    assert.match(citationCff, /^license-url: ".*\/LICENSING\.md"$/m);
    assert.match(licensingNotice, /Copyright \(C\) 2026 OpenUnseal Contributors/);
    assert.match(licensingNotice, /AGPL-3\.0-or-later/);
    assert.match(licensingNotice, /Section 13/i);
    assert.match(licensingNotice, /MPL-2\.0/);
    assert.match(licensingNotice, /ODbL-1\.0/);
    assert.match(licensingNotice, /datenquellen_vg_nuts\.pdf/);

    // Complete third-party notices present and accurate (direct & transitive runtime packages)
    assert.match(thirdPartyNotices, /@maplibre\/maplibre-react-native@.* : MIT/);
    assert.match(thirdPartyNotices, /@node-rs\/argon2@.* : MIT/);
    assert.match(thirdPartyNotices, /nodemailer@.* : MIT-0/);
    assert.match(thirdPartyNotices, /MapLibre Native Android SDK.*BSD-2-Clause/);
    assert.match(thirdPartyNotices, /Copyright \(c\) 2018-2021 MapTiler\.com/);
    assert.match(thirdPartyNotices, /Copyright \(c\) 2014-2020 Mapbox/);
    assert.match(thirdPartyNotices, /FITNESS FOR A PARTICULAR PURPOSE ARE/);
    assert.match(
      thirdPartyNotices,
      /REPRODUCED COPYRIGHT & LICENSE NOTICES FOR RUNTIME PACKAGES \(DIRECT & TRANSITIVE\)/,
    );
    assert.match(thirdPartyNotices, /@mapbox\/vector-tile@.*\(BSD-3-Clause\)/);
    assert.match(thirdPartyNotices, /pbf@.*\(BSD-3-Clause\)/);
    assert.match(thirdPartyNotices, /earcut@.*\(ISC\)/);
    assert.match(thirdPartyNotices, /pg-pool@.*\(MIT\)/);
    assert.match(thirdPartyNotices, /--- esprima@.*\(BSD-2-Clause\) ---/);
    assert.match(thirdPartyNotices, /--- stream-buffers@.*\(Unlicense\) ---/);
    assert.match(
      thirdPartyNotices,
      /@pkgjs\/parseargs@.*Apache-2\.0 \[LICENSE file; package\.json declares MIT\]/,
    );
    assert.match(
      thirdPartyNotices,
      /@maplibre\/maplibre-gl-style-spec@.*BSD-3-Clause \[LICENSE file; package\.json declares ISC\]/,
    );
    assert.equal(
      thirdPartyNotices.includes(
        '@img/sharp-darwin-arm64@0.35.5 : Apache-2.0 (declared in package.json)',
      ),
      false,
    );
    assert.match(thirdPartyNotices, /datenquellen_vg_nuts\.pdf/);
    // Boost Software License 1.0 reproduced in full (conditions paragraph + disclaimer)
    assert.match(thirdPartyNotices, /do so, all subject to the following:/);
    assert.match(
      thirdPartyNotices,
      /works are solely in the form of machine-executable object code generated by/,
    );
    assert.match(thirdPartyNotices, /FITNESS FOR A PARTICULAR PURPOSE, TITLE AND NON-INFRINGEMENT/);
  });

  it('Caddyfile.vps keeps client IPs, user agents and query strings out of Caddy logs', () => {
    const caddyfile = fs.readFileSync(path.join(repoRoot, 'Caddyfile.vps'), 'utf8');
    const globalOptions = caddyfile.slice(0, caddyfile.indexOf('{$DOMAIN}'));

    // Default logger: Caddy attaches the full request (client IP, headers, URI incl. query)
    // to handler errors, reverse-proxy stream aborts and recovered panics.
    for (const namespace of ['http.log.error', 'http.handlers.reverse_proxy', 'http.stdlib']) {
      assert.match(
        globalOptions,
        new RegExp(`^\\s*exclude\\b.*\\s${namespace.replaceAll('.', '\\.')}(\\s|$)`, 'm'),
        `Expected Caddy default logger to exclude "${namespace}"`,
      );
    }
    // Site access log stays discarded
    assert.match(caddyfile, /\{\$DOMAIN\} \{[\s\S]*?\blog \{\s*output discard\s*\}/);
  });

  it('contains zero Node Buffer references across packages/shared/src for Hermes and browser compatibility', () => {
    const srcDir = path.join(sharedRoot, 'src');
    const srcFiles = fs.readdirSync(srcDir).filter((f) => f.endsWith('.ts'));
    assert.ok(srcFiles.length >= 5, 'Expected all shared source modules to exist');

    for (const file of srcFiles) {
      const content = fs.readFileSync(path.join(srcDir, file), 'utf8');
      assert.equal(
        /\bBuffer\b/.test(content),
        false,
        `Unexpected Buffer reference found in packages/shared/src/${file}`,
      );
    }
  });

  it('compiles ESM dist/index.js and dist/index.d.ts exporting all runtime symbols', async () => {
    const distIndexJs = path.join(sharedRoot, 'dist', 'index.js');
    const distIndexDts = path.join(sharedRoot, 'dist', 'index.d.ts');
    assert.equal(fs.existsSync(distIndexJs), true, 'Expected dist/index.js to exist');
    assert.equal(fs.existsSync(distIndexDts), true, 'Expected dist/index.d.ts to exist');

    const compiled = await import('../dist/index.js');
    const expectedRuntimeExports = [
      'SURFACE_TYPES',
      'GEOMETRY_LIMITS',
      'AUTH_LIMITS',
      'RESERVED_PSEUDONYMS',
      'ApiError',
      'ApiErrorEnvelopeSchema',
      'RegisterRequestSchema',
      'LoginRequestSchema',
      'RecoverRequestSchema',
      'AuthUserSchema',
      'RegisterResponseSchema',
      'SessionResponseSchema',
      'HealthResponseSchema',
      'RuntimeConfigSchema',
      'UuidParamSchema',
      'CreatePolygonRequestSchema',
      'PatchPolygonRequestSchema',
      'VoteRequestSchema',
      'VoteResponseSchema',
      'PolygonFeatureSchema',
      'PolygonCollectionResponseSchema',
      'BboxQuerySchema',
      'checkBboxSpan',
      'normalizeRecoveryCode',
      'checkPolygonRingStructure',
      'dedupeConsecutivePoints',
      'closeRingIfNeeded',
      'validateDraftPolygon',
    ];
    for (const sym of expectedRuntimeExports) {
      assert.ok(sym in compiled, `Missing runtime export ${sym} in dist/index.js`);
    }
  });

  it('exports exact domain constants and ApiError / ApiErrorEnvelopeSchema', () => {
    const surfaceSample: SurfaceType = 'asphalt';
    assert.equal(surfaceSample, 'asphalt');
    assert.deepEqual(SURFACE_TYPES, ['asphalt', 'concrete', 'pavers', 'other']);
    assert.deepEqual(RESERVED_PSEUDONYMS, ['deleted']);
    assert.equal(GEOMETRY_LIMITS.MIN_AREA_M2, 2);
    assert.equal(GEOMETRY_LIMITS.MAX_AREA_M2, 20_000);
    assert.equal(IMPORT_LIMITS.MAX_AREA_M2, 500_000);
    assert.equal(GEOMETRY_LIMITS.MIN_VERTICES, 3);
    assert.equal(GEOMETRY_LIMITS.MAX_VERTICES, 200);
    assert.equal(GEOMETRY_LIMITS.MIN_RING_POSITIONS, 4);
    assert.equal(GEOMETRY_LIMITS.MAX_RING_POSITIONS, 201);
    assert.equal(GEOMETRY_LIMITS.MAX_POLYGON_SPAN_DEG, 0.05);
    assert.equal(GEOMETRY_LIMITS.MAX_ABS_LAT, 85);
    assert.equal(GEOMETRY_LIMITS.MAX_BBOX_SPAN_DEG, 0.15);
    assert.equal(GEOMETRY_LIMITS.BBOX_FEATURE_LIMIT, 500);
    assert.equal(GEOMETRY_LIMITS.DEDUPE_EPSILON_DEG, 1e-7);
    assert.equal(GEOMETRY_LIMITS.MIN_TURN_ANGLE_DEG, 2);
    assert.equal(GEOMETRY_LIMITS.MIN_COMPACTNESS_PP, 0.05);
    assert.equal(GEOMETRY_LIMITS.MIN_WIDTH_BUFFER_M, 0.5);
    assert.equal(GEOMETRY_LIMITS.MAX_NOTE_LENGTH, 500);

    assert.equal(AUTH_LIMITS.MIN_PASSWORD_LENGTH, 8);
    assert.equal(AUTH_LIMITS.MAX_PASSWORD_LENGTH, 128);
    assert.equal(AUTH_LIMITS.MAX_PASSWORD_BYTES, 1024);
    assert.equal(AUTH_LIMITS.RECOVERY_CODE_BYTES, 16);
    assert.equal(AUTH_LIMITS.RECOVERY_CODE_HEX_LENGTH, 32);
    assert.equal(AUTH_LIMITS.SESSION_TTL_DAYS, 30);
    assert.equal(AUTH_LIMITS.MAX_SESSIONS_PER_USER, 10);

    const code: ErrorCode = 'GEOMETRY_INVALID';
    const err = new ApiError(422, code, 'Self-intersection', { location: [9.99, 53.55] });
    assert.ok(err instanceof Error);
    assert.ok(err instanceof ApiError);
    assert.equal(err.statusCode, 422);
    assert.equal(err.code, 'GEOMETRY_INVALID');
    assert.equal(err.message, 'Self-intersection');
    assert.deepEqual(err.details, { location: [9.99, 53.55] });

    const parsedEnvelope = ApiErrorEnvelopeSchema.parse({
      error: {
        code: 'BBOX_TOO_LARGE',
        message: 'Viewport span exceeds 0.15 degrees',
        requestId: 'req-001',
      },
    });
    assert.equal(parsedEnvelope.error.code, 'BBOX_TOO_LARGE');
    assert.equal(parsedEnvelope.error.requestId, 'req-001');
  });
});

describe('Review Focus 1: Draft geometry validation & CreatePolygonRequestSchema ring rules', () => {
  it('deduplicates consecutive taps within 1e-7° and accepts a valid 4-vertex courtyard (~120 m²)', () => {
    const withJitterDuplicates: [number, number][] = [
      [9.9937, 53.5511],
      [9.9937 + 5e-8, 53.5511 - 4e-8], // duplicate tap within 1e-7°
      [9.99385, 53.5511],
      [9.99385, 53.551208],
      [9.99385 + 3e-8, 53.551208 + 3e-8], // duplicate tap within 1e-7°
      [9.9937, 53.551208],
    ];

    const deduped = dedupeConsecutivePoints(withJitterDuplicates);
    assert.equal(deduped.length, 4);

    const closed = closeRingIfNeeded(deduped);
    assert.equal(closed.length, 5);
    assert.deepEqual(closed[0], closed[4]);
    assert.equal(closeRingIfNeeded(closed).length, 5);

    const result: DraftValidationResult = validateDraftPolygon(withJitterDuplicates);
    assert.equal(result.valid, true);
    assert.equal(result.vertexCount, 4);
    assert.ok(result.closedRing !== null);
    assert.equal(result.closedRing.length, 5);
    assert.deepEqual(result.closedRing[0], result.closedRing[4]);
    assert.ok(result.areaM2 > 110 && result.areaM2 < 130, `Expected ~120 m², got ${result.areaM2}`);
    assert.equal(result.nearAreaBound, false);
    assert.equal(result.crossingPoint, null);
    assert.deepEqual(result.errors, []);

    // Also accepts an already-closed ring without counting the closing position as an extra vertex
    const fromClosed = validateDraftPolygon(closed);
    assert.equal(fromClosed.valid, true);
    assert.equal(fromClosed.vertexCount, 4);
    assert.equal(fromClosed.closedRing?.length, 5);

    // Rejects non-finite coordinates cleanly without throwing
    const nonFinite = validateDraftPolygon([
      [NaN, 53.5511],
      [9.99385, 53.5511],
      [9.99385, 53.5512],
    ]);
    assert.equal(nonFinite.valid, false);
    assert.equal(nonFinite.closedRing, null);
  });

  it('flags < 3 distinct vertices (including duplicate taps collapsing to 2) and > 200 distinct vertices', () => {
    const twoPoints = validateDraftPolygon([
      [9.9937, 53.5511],
      [9.99385, 53.5511],
    ]);
    assert.equal(twoPoints.valid, false);
    assert.equal(twoPoints.vertexCount, 2);
    assert.equal(twoPoints.closedRing, null);
    assert.ok(twoPoints.errors.length > 0);

    const collapsedThreeTaps = validateDraftPolygon([
      [9.9937, 53.5511],
      [9.9937 + 4e-8, 53.5511 + 4e-8],
      [9.99385, 53.5511],
    ]);
    assert.equal(collapsedThreeTaps.valid, false);
    assert.equal(collapsedThreeTaps.vertexCount, 2);
    assert.equal(collapsedThreeTaps.closedRing, null);

    // 201 distinct vertices around a ~50 m radius circle in Hamburg
    const circle201: [number, number][] = [];
    for (let i = 0; i < 201; i++) {
      const theta = (2 * Math.PI * i) / 201;
      circle201.push([
        9.9937 + 0.00075 * Math.cos(theta),
        53.5511 + 0.00045 * Math.sin(theta),
      ]);
    }
    const tooMany = validateDraftPolygon(circle201);
    assert.equal(tooMany.valid, false);
    assert.equal(tooMany.vertexCount, 201);
    assert.ok(tooMany.errors.some((e) => /200/.test(e)));
  });

  it('flags > 0.05° sliver spans and |lat| > 85°', () => {
    const continentalSliver: [number, number][] = [
      [9.99, 53.5511],
      [10.041, 53.5511], // lng span 0.051° > 0.05°
      [10.041, 53.5512],
      [9.99, 53.5512],
    ];
    const sliverRes = validateDraftPolygon(continentalSliver);
    assert.equal(sliverRes.valid, false);
    assert.ok(sliverRes.errors.some((e) => /span|0\.05/i.test(e)));

    const polarPolygon: [number, number][] = [
      [9.9937, 85.1],
      [9.994, 85.1],
      [9.994, 85.101],
      [9.9937, 85.101],
    ];
    const polarRes = validateDraftPolygon(polarPolygon);
    assert.equal(polarRes.valid, false);
    assert.ok(polarRes.errors.some((e) => /85|lat/i.test(e)));
  });

  it('flags < 2° fold-back spikes (both exact A -> B -> A and ~1° needle fold-backs)', () => {
    // 3-tap exact A -> B -> A fold-back
    const exactThreeTapFoldBack = validateDraftPolygon([
      [9.9937, 53.5511],
      [9.994, 53.5511],
      [9.9937, 53.5511],
    ]);
    assert.equal(exactThreeTapFoldBack.valid, false);
    assert.ok(exactThreeTapFoldBack.errors.some((e) => /spike|2°|angle/i.test(e)));

    // 4-vertex polygon with exact A -> B -> A fold-back before D
    const fourTapFoldBack = validateDraftPolygon([
      [9.9937, 53.5511],
      [9.994, 53.5511],
      [9.9937, 53.5511],
      [9.9937, 53.5513],
    ]);
    assert.equal(fourTapFoldBack.valid, false);
    assert.ok(fourTapFoldBack.errors.some((e) => /spike|2°|angle/i.test(e)));

    // 4-vertex polygon with a ~0.6° sharp needle spike at vertex 1
    const acuteNeedleSpike = validateDraftPolygon([
      [9.9937, 53.5511],
      [9.9942, 53.5511], // needle tip extending East (~33 m)
      [9.99375, 53.551103], // folds almost straight back West (~0.6° turn-back angle < 2°)
      [9.9937, 53.55125],
    ]);
    assert.equal(acuteNeedleSpike.valid, false);
    assert.ok(acuteNeedleSpike.errors.some((e) => /spike|2°|angle/i.test(e)));
  });

  it('flags bow-tie self-intersections and reports crossingPoint coordinates', () => {
    const bowTie: [number, number][] = [
      [9.9937, 53.5511],
      [9.9941, 53.5515],
      [9.9941, 53.5511],
      [9.9937, 53.5515],
    ];
    const res = validateDraftPolygon(bowTie);
    assert.equal(res.valid, false);
    assert.ok(res.crossingPoint !== null, 'Expected crossingPoint to be populated for bow-tie');
    assert.ok(Math.abs(res.crossingPoint[0] - 9.9939) < 0.0001);
    assert.ok(Math.abs(res.crossingPoint[1] - 53.5513) < 0.0001);
    assert.ok(res.errors.some((e) => /cross|intersect/i.test(e)));
  });

  it('flags areas < 2 m² and > 500,000 m² and sets nearAreaBound near boundary thresholds', () => {
    // ~0.48 m² square (~0.7 m × 0.7 m)
    const tinyPolygon: [number, number][] = [
      [9.9937, 53.5511],
      [9.99371, 53.5511],
      [9.99371, 53.551106],
      [9.9937, 53.551106],
    ];
    const tinyRes = validateDraftPolygon(tinyPolygon);
    assert.equal(tinyRes.valid, false);
    assert.ok(tinyRes.areaM2 > 0 && tinyRes.areaM2 < 2);
    assert.ok(tinyRes.errors.some((e) => /2 m²|minimum/i.test(e)));

    // ~1.47 million m² square (0.015° × 0.013°, well within 0.05° span, > 20,000 m²)
    const hugePolygon: [number, number][] = [
      [9.99, 53.55],
      [10.005, 53.55],
      [10.005, 53.563],
      [9.99, 53.563],
    ];
    const hugeRes = validateDraftPolygon(hugePolygon);
    assert.equal(hugeRes.valid, false);
    assert.ok(hugeRes.areaM2 > 20_000);
    assert.ok(hugeRes.errors.some((e) => /20,?000|maximum/i.test(e)));

    // ~60 m × 0.3 m ribbon (~18 m², valid area, but ultra-thin sliver / low compactness)
    const thinSliverPolygon: [number, number][] = [
      [9.9937, 53.5511],
      [9.9946, 53.5511],
      [9.9946, 53.5511027],
      [9.9937, 53.5511027],
    ];
    const thinSliverRes = validateDraftPolygon(thinSliverPolygon);
    assert.equal(thinSliverRes.valid, false);
    assert.ok(
      thinSliverRes.errors.some((e) => /compactness|narrow|thin/i.test(e)),
    );

    // ~2.08 m² square (within 10% of MIN_AREA_M2 = 2) -> valid & nearAreaBound === true
    const nearMinPolygon: [number, number][] = [
      [9.9937, 53.5511],
      [9.993722, 53.5511],
      [9.993722, 53.5511128],
      [9.9937, 53.5511128],
    ];
    const nearMinRes = validateDraftPolygon(nearMinPolygon);
    assert.equal(nearMinRes.valid, true);
    assert.ok(nearMinRes.areaM2 >= 2 && nearMinRes.areaM2 <= 2.2);
    assert.equal(nearMinRes.nearAreaBound, true);
  });

  it('CreatePolygonRequestSchema accepts single closed ring and rejects interior holes, unclosed rings, >0.05° span, and extra keys', () => {
    const closedCourtyard = closeRingIfNeeded(VALID_COURTYARD_VERTICES);
    assert.equal(checkPolygonRingStructure([closedCourtyard]).valid, true);

    const validParsed = CreatePolygonRequestSchema.parse({
      geometry: {
        type: 'Polygon',
        coordinates: [closedCourtyard],
      },
      surfaceType: 'asphalt',
      note: 'Unused paved parking corner',
    });
    assert.equal(validParsed.surfaceType, 'asphalt');
    assert.equal(validParsed.geometry.coordinates.length, 1);

    // Multi-ring polygon with interior hole -> rejected!
    const holeRing: [number, number][] = [
      [9.99374, 53.55113],
      [9.99378, 53.55113],
      [9.99378, 53.55117],
      [9.99374, 53.55117],
      [9.99374, 53.55113],
    ];
    assert.equal(checkPolygonRingStructure([closedCourtyard, holeRing]).valid, false);
    assert.throws(
      () =>
        CreatePolygonRequestSchema.parse({
          geometry: {
            type: 'Polygon',
            coordinates: [closedCourtyard, holeRing],
          },
          surfaceType: 'asphalt',
        }),
      ZodError,
    );

    // Unclosed ring -> rejected!
    assert.throws(
      () =>
        CreatePolygonRequestSchema.parse({
          geometry: {
            type: 'Polygon',
            coordinates: [VALID_COURTYARD_VERTICES],
          },
          surfaceType: 'concrete',
        }),
      ZodError,
    );

    // > 0.05° span -> rejected!
    assert.throws(
      () =>
        CreatePolygonRequestSchema.parse({
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [9.99, 53.55],
                [10.045, 53.55],
                [10.045, 53.56],
                [9.99, 53.56],
                [9.99, 53.55],
              ],
            ],
          },
          surfaceType: 'pavers',
        }),
      ZodError,
    );

    // Extra property on strict schema -> rejected!
    assert.throws(
      () =>
        CreatePolygonRequestSchema.parse({
          geometry: {
            type: 'Polygon',
            coordinates: [closedCourtyard],
          },
          surfaceType: 'other',
          extraField: true,
        }),
      ZodError,
    );

    // < 4 ring positions and > 201 ring positions and |lat| > 85 -> rejected!
    assert.throws(
      () =>
        CreatePolygonRequestSchema.parse({
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [9.9937, 53.5511],
                [9.99385, 53.5511],
                [9.9937, 53.5511],
              ],
            ],
          },
          surfaceType: 'asphalt',
        }),
      ZodError,
    );

    const ring202: [number, number][] = [];
    for (let i = 0; i < 201; i++) {
      const theta = (2 * Math.PI * i) / 201;
      ring202.push([9.9937 + 0.0005 * Math.cos(theta), 53.5511 + 0.0005 * Math.sin(theta)]);
    }
    ring202.push(ring202[0]!);
    assert.equal(ring202.length, 202);
    assert.throws(
      () =>
        CreatePolygonRequestSchema.parse({
          geometry: {
            type: 'Polygon',
            coordinates: [ring202],
          },
          surfaceType: 'asphalt',
        }),
      ZodError,
    );

    assert.throws(
      () =>
        CreatePolygonRequestSchema.parse({
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [9.9937, 85.2],
                [9.99385, 85.2],
                [9.99385, 85.2001],
                [9.9937, 85.2],
              ],
            ],
          },
          surfaceType: 'asphalt',
        }),
      ZodError,
    );
  });
});

describe('Review Focus 2: PatchPolygonRequestSchema, TextEncoder password bounds, and surfaceType coercion', () => {
  it('PatchPolygonRequestSchema rejects empty {} and { geometry: ... } while accepting metadata updates', () => {
    assert.throws(() => PatchPolygonRequestSchema.parse({}), ZodError);
    assert.throws(
      () => PatchPolygonRequestSchema.parse({ surfaceType: undefined, note: undefined }),
      ZodError,
    );
    assert.throws(
      () =>
        PatchPolygonRequestSchema.parse({
          geometry: {
            type: 'Polygon',
            coordinates: [closeRingIfNeeded(VALID_COURTYARD_VERTICES)],
          },
        }),
      ZodError,
    );
    assert.throws(
      () =>
        PatchPolygonRequestSchema.parse({
          surfaceType: 'concrete',
          geometry: {
            type: 'Polygon',
            coordinates: [closeRingIfNeeded(VALID_COURTYARD_VERTICES)],
          },
        }),
      ZodError,
    );
    assert.throws(
      () => PatchPolygonRequestSchema.parse({ note: 'x'.repeat(501) }),
      ZodError,
    );

    assert.deepEqual(PatchPolygonRequestSchema.parse({ surfaceType: 'pavers' }), {
      surfaceType: 'pavers',
    });
    assert.deepEqual(PatchPolygonRequestSchema.parse({ note: null }), { note: null });
    assert.deepEqual(PatchPolygonRequestSchema.parse({ note: '' }), { note: '' });
  });

  it('RegisterRequestSchema, LoginRequestSchema, and ResetPasswordRequestSchema enforce email, privacy & terms consent, and TextEncoder UTF-8 byte & char limits', () => {
    // Valid v2 email registration
    const validReg = RegisterRequestSchema.parse({
      pseudonym: 'kiez_mapper-42',
      email: 'Kiez.Mapper@Example.ORG',
      password: 'correct-horse-battery-staple',
      acceptedPrivacyPolicy: true,
      acceptedTerms: true,
    });
    assert.equal(validReg.pseudonym, 'kiez_mapper-42');
    assert.equal(validReg.email, 'kiez.mapper@example.org');

    // Missing privacy policy consent rejected
    assert.throws(
      () =>
        RegisterRequestSchema.parse({
          pseudonym: 'mapper1',
          email: 'mapper1@example.org',
          password: 'correct-horse-battery-staple',
          acceptedPrivacyPolicy: false,
          acceptedTerms: true,
        }),
      ZodError,
    );

    // Missing terms consent rejected
    assert.throws(
      () =>
        RegisterRequestSchema.parse({
          pseudonym: 'mapper1',
          email: 'mapper1@example.org',
          password: 'correct-horse-battery-staple',
          acceptedPrivacyPolicy: true,
          acceptedTerms: false,
        }),
      ZodError,
    );

    // < 8-char password rejected
    assert.throws(
      () =>
        RegisterRequestSchema.parse({
          pseudonym: 'mapper1',
          email: 'mapper1@example.org',
          password: 'short7!',
          acceptedPrivacyPolicy: true,
          acceptedTerms: true,
        }),
      ZodError,
    );

    // > 1024-byte multi-byte UTF-8 password rejected via TextEncoder
    const over1024Bytes = '🔐'.repeat(260); // 260 * 4 = 1040 UTF-8 bytes
    assert.ok(new TextEncoder().encode(over1024Bytes).byteLength > 1024);
    const overBytesRes = RegisterRequestSchema.safeParse({
      pseudonym: 'mapper1',
      email: 'mapper1@example.org',
      password: over1024Bytes,
      acceptedPrivacyPolicy: true,
      acceptedTerms: true,
    });
    assert.equal(overBytesRes.success, false);
    assert.ok(
      overBytesRes.error.issues.some((iss) => /1024|byte/i.test(iss.message)),
      'Expected UTF-8 1024-byte validation issue from TextEncoder check',
    );

    // > 128-char ASCII password rejected
    assert.throws(
      () =>
        RegisterRequestSchema.parse({
          pseudonym: 'mapper1',
          email: 'mapper1@example.org',
          password: 'a'.repeat(129),
          acceptedPrivacyPolicy: true,
          acceptedTerms: true,
        }),
      ZodError,
    );

    // Login accepts both pseudonym and email via identifier (or legacy pseudonym field)
    assert.equal(
      LoginRequestSchema.parse({ identifier: 'mapper1', password: 'valid-password-123' }).identifier,
      'mapper1',
    );
    assert.equal(
      LoginRequestSchema.parse({ identifier: 'mapper1@example.org', password: 'valid-password-123' })
        .identifier,
      'mapper1@example.org',
    );
    assert.equal(
      LoginRequestSchema.parse({ pseudonym: 'mapper1', password: 'valid-password-123' }).identifier,
      'mapper1',
    );

    // Invalid pseudonym / malformed email rejected
    assert.throws(
      () => LoginRequestSchema.parse({ pseudonym: 'ab', password: 'valid-password-123' }),
      ZodError,
    );
    assert.throws(
      () => LoginRequestSchema.parse({ identifier: 'bad space', password: 'valid-password-123' }),
      ZodError,
    );
    assert.throws(
      () => LoginRequestSchema.parse({ identifier: 'not-an-email@', password: 'valid-password-123' }),
      ZodError,
    );

    // Legacy recovery code helper remains deterministic
    assert.equal(
      normalizeRecoveryCode('abcd-ef01 2345-6789-abcd-ef01-2345-6789'),
      'ABCDEF0123456789ABCDEF0123456789',
    );
    const validRecover = RecoverRequestSchema.parse({
      pseudonym: 'mapper1',
      recoveryCode: 'abcd-ef01-2345-6789-abcd-ef01-2345-6789',
      newPassword: 'new-secure-password-99',
    });
    assert.equal(validRecover.pseudonym, 'mapper1');
  });

  it('PolygonFeatureSchema coerces unknown surfaceType "cobblestone_v2" to "other" and ignores extra keys', () => {
    const featureInput = {
      type: 'Feature',
      id: '550e8400-e29b-41d4-a716-446655440000',
      geometry: {
        type: 'Polygon',
        coordinates: [closeRingIfNeeded(VALID_COURTYARD_VERTICES)],
      },
      properties: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        surfaceType: 'cobblestone_v2',
        note: 'Historic courtyard',
        areaM2: 119.4,
        authorPseudonym: 'deleted',
        upvotes: 5,
        downvotes: 1,
        score: 4,
        myVote: 0,
        isAuthor: false,
        createdAt: '2026-11-12T12:00:00.000Z',
        updatedAt: '2026-11-12T12:05:00+00:00',
        futurePropertyFromNewerServer: 'ignored-gracefully',
      },
      futureTopLevelProperty: 123,
    };

    const parsed: PolygonFeature = PolygonFeatureSchema.parse(featureInput);
    assert.equal(parsed.properties.surfaceType, 'other');
    assert.equal(parsed.properties.authorPseudonym, 'deleted');
    assert.equal('futurePropertyFromNewerServer' in parsed.properties, false);
    assert.equal('futureTopLevelProperty' in parsed, false);

    const collection = PolygonCollectionResponseSchema.parse({
      type: 'FeatureCollection',
      features: [featureInput],
      meta: { truncated: false, limit: 500 },
    });
    assert.equal(collection.features.length, 1);
    assert.equal(collection.features[0]?.properties.surfaceType, 'other');
  });
});

describe('Review Focus 3: BboxQuerySchema vs checkBboxSpan and remaining wire schemas', () => {
  it('BboxQuerySchema rejects malformed/inverted bounds with ZodError while accepting valid bounds', () => {
    const parsedFromQueryObj = BboxQuerySchema.parse({ bbox: '9.98,53.54,10.01,53.56' });
    assert.deepEqual(parsedFromQueryObj, {
      minLng: 9.98,
      minLat: 53.54,
      maxLng: 10.01,
      maxLat: 53.56,
    });

    const parsedFromString = BboxQuerySchema.parse('9.80,53.40,10.20,53.80');
    assert.deepEqual(parsedFromString, {
      minLng: 9.8,
      minLat: 53.4,
      maxLng: 10.2,
      maxLat: 53.8,
    });

    const malformedInputs = [
      {},
      { bbox: '' },
      { bbox: '9.98,53.54,10.01' },
      { bbox: '9.98,53.54,10.01,53.56,1' },
      { bbox: '9.98,abc,10.01,53.56' },
      { bbox: '9.98,53.54,10.01,NaN' },
      { bbox: '10.05,53.54,9.98,53.56' }, // inverted lng (minLng > maxLng)
      { bbox: '9.98,53.54,9.98,53.56' }, // zero-width lng (minLng === maxLng)
      { bbox: '9.98,53.60,10.01,53.54' }, // inverted lat (minLat > maxLat)
      { bbox: '-181,53.54,-180.5,53.56' }, // out-of-range lng
      { bbox: '9.98,-91,10.01,-89' }, // out-of-range lat
    ];

    for (const bad of malformedInputs) {
      assert.throws(() => BboxQuerySchema.parse(bad), ZodError);
    }
  });

  it('checkBboxSpan accepts spans <= 0.15° (including exact 0.15° float boundary) and throws ApiError(422, BBOX_TOO_LARGE) above 0.15°', () => {
    // Exact 0.15° float span (10.1437 - 9.9937 === 0.15000000000000036 in IEEE-754)
    const exactBoundary = BboxQuerySchema.parse('9.9937,53.5511,10.1437,53.7011');
    assert.doesNotThrow(() => checkBboxSpan(exactBoundary));
    assert.doesNotThrow(() => checkBboxSpan([9.9937, 53.5511, 10.1437, 53.7011]));

    const wideLng = BboxQuerySchema.parse('9.80,53.50,9.96,53.60'); // lng span 0.16° > 0.15°
    assert.throws(
      () => checkBboxSpan(wideLng),
      (err: unknown) =>
        err instanceof ApiError && err.statusCode === 422 && err.code === 'BBOX_TOO_LARGE',
    );

    const wideLat = BboxQuerySchema.parse('9.80,53.50,9.90,53.66'); // lat span 0.16° > 0.15°
    assert.throws(
      () => checkBboxSpan(wideLat),
      (err: unknown) =>
        err instanceof ApiError && err.statusCode === 422 && err.code === 'BBOX_TOO_LARGE',
    );
  });

  it('validates RuntimeConfigSchema, HealthResponseSchema, UuidParamSchema, Vote schemas, and Auth response schemas', () => {
    const cleanDefaultConfig: RuntimeConfig = RuntimeConfigSchema.parse({
      osmStyleUrl: 'https://tiles.openfreemap.org/styles/liberty',
      orthophoto: null,
      initialView: { lng: 9.9937, lat: 53.5511, zoom: 15 },
      limits: {
        minAreaM2: 2,
        maxAreaM2: 500_000,
        maxVertices: 200,
        maxPolygonSpanDeg: 0.05,
        maxBboxSpanDeg: 0.15,
        bboxFeatureLimit: 500,
        maxDailyPolygonsPerUser: 25,
      },
      disclaimerText:
        'Community unsealing suggestions - non-binding public input, regardless of property ownership.',
      abuseContact: null,
    });
    assert.equal(cleanDefaultConfig.orthophoto, null);
    assert.equal(cleanDefaultConfig.osmDarkStyleUrl, undefined);
    assert.equal(
      RuntimeConfigSchema.parse({
        ...cleanDefaultConfig,
        osmDarkStyleUrl: 'https://tiles.openfreemap.org/styles/dark',
      }).osmDarkStyleUrl,
      'https://tiles.openfreemap.org/styles/dark',
    );
    assert.equal(cleanDefaultConfig.apkDownloadUrl, null);
    assert.equal(cleanDefaultConfig.apkSha256, null);
    assert.equal(cleanDefaultConfig.impressumUrl, null);
    assert.equal(cleanDefaultConfig.termsUrl, null);
    assert.equal(cleanDefaultConfig.licensesUrl, null);
    assert.equal(cleanDefaultConfig.sourceCodeUrl, null);
    assert.equal(cleanDefaultConfig.bugReportContact, null);
    assert.deepEqual(POLYGON_STATUSES, ['proposed', 'in_progress', 'finished']);
    assert.equal(PHOTO_LIMITS.GPS_VERIFY_DISTANCE_M, 3);

    const wmsOrthophotoConfig = RuntimeConfigSchema.parse({
      ...cleanDefaultConfig,
      orthophoto: {
        urlTemplate:
          'https://geodienste.hamburg.de/HH_WMS_DOP?SERVICE=WMS&BBOX={bbox-epsg-3857}',
        tileSize: 512,
        attribution: '© Landesbetrieb Geoinformation und Vermessung',
        bounds: [9.7, 53.35, 10.35, 53.75],
        maxZoom: 20,
      },
      abuseContact: 'moderation@example.org',
    });
    assert.equal(wmsOrthophotoConfig.orthophoto?.tileSize, 512);

    // Invalid orthophoto template without {z}/{x}/{y} or {bbox-epsg-3857}
    assert.throws(
      () =>
        RuntimeConfigSchema.parse({
          ...cleanDefaultConfig,
          orthophoto: {
            urlTemplate: 'https://example.org/static-image.png',
            tileSize: 256,
            attribution: '',
            bounds: null,
            maxZoom: 20,
          },
        }),
      ZodError,
    );

    const health = HealthResponseSchema.parse({
      status: 'ok',
      postgisVersion: '3.4 USE_GEOS=1',
      migrationsApplied: 1,
    });
    assert.equal(health.status, 'ok');

    const uuidParam = UuidParamSchema.parse({ id: '550e8400-e29b-41d4-a716-446655440000' });
    assert.equal(uuidParam.id, '550e8400-e29b-41d4-a716-446655440000');
    assert.throws(() => UuidParamSchema.parse({ id: 'not-a-uuid' }), ZodError);

    assert.equal(VoteRequestSchema.parse({ value: 1 }).value, 1);
    assert.equal(VoteRequestSchema.parse({ value: -1 }).value, -1);
    assert.throws(() => VoteRequestSchema.parse({ value: 0 }), ZodError);

    const voteRes = VoteResponseSchema.parse({
      polygonId: '550e8400-e29b-41d4-a716-446655440000',
      upvotes: 3,
      downvotes: 1,
      score: 2,
      myVote: 0,
    });
    assert.equal(voteRes.score, 2);

    const user = AuthUserSchema.parse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      pseudonym: 'kiez_mapper',
      createdAt: '2026-11-12T14:00:00.000Z',
    });
    const sessionRes = SessionResponseSchema.parse({
      user,
      sessionToken: 'opaque-session-token',
      expiresAt: '2026-12-12T14:00:00.000Z',
    });
    assert.equal(sessionRes.user.pseudonym, 'kiez_mapper');

    const regRes = RegisterResponseSchema.parse({
      status: 'verification_email_sent',
      pseudonym: 'kiez_mapper',
      email: 'kiez@example.org',
    });
    assert.equal(regRes.status, 'verification_email_sent');

    // Municipality-bounded score normalization
    assert.equal(computeMunicipalityNormalizedScore(12, 'proposed', '07315000', 12), 1);
    assert.equal(computeMunicipalityNormalizedScore(6, 'proposed', '07315000', 12), 0.5);
    assert.equal(computeMunicipalityNormalizedScore(12, 'proposed', '02000000', 120), 0.1);
    assert.equal(computeMunicipalityNormalizedScore(12, 'in_progress', '07315000', 12), 0);
    assert.equal(computeMunicipalityNormalizedScore(12, 'finished', '07315000', 12), 0);
    assert.equal(computeMunicipalityNormalizedScore(-2, 'proposed', '07315000', 12), 0);
    assert.equal(computeMunicipalityNormalizedScore(1, 'proposed', '07315000', 1), 0.3333);

    assert.equal(
      PatchPolygonStatusRequestSchema.parse({ status: 'in_progress' }).status,
      'in_progress',
    );
    assert.equal(
      PatchPolygonStatusRequestSchema.parse({ status: 'finished' }).status,
      'finished',
    );

    const parsedPhoto = PolygonPhotoSchema.parse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      polygonId: '550e8400-e29b-41d4-a716-446655440001',
      url: '/uploads/550e8400-e29b-41d4-a716-446655440000.webp',
      thumbUrl: '/uploads/550e8400-e29b-41d4-a716-446655440000_thumb.webp',
      width: 1200,
      height: 900,
      gpsVerified: true,
      uploaderPseudonym: 'kiez_mapper',
      isUploader: true,
      realVotes: 4,
      fakeVotes: 0,
      credibilityScore: 4,
      myVote: 1,
      isFlaggedFake: false,
      createdAt: '2026-11-13T10:00:00.000Z',
    });
    assert.equal(parsedPhoto.gpsVerified, true);

    const parsedImport = ImportPolygonsResponseSchema.parse({
      format: 'gpkg',
      importedCount: 15,
      skippedCount: 1,
      errors: [{ featureIndex: 7, reason: 'Area below 2 m²' }],
    });
    assert.equal(parsedImport.importedCount, 15);

    // Comment schemas and rating sort helpers
    assert.equal(COMMENT_LIMITS.MAX_BODY_LENGTH, 1000);
    const createRootComment = CreatePolygonCommentRequestSchema.parse({
      body: '  Great candidate for shade trees!  ',
    });
    assert.equal(createRootComment.body, 'Great candidate for shade trees!');
    assert.equal(createRootComment.parentId, undefined);

    assert.throws(
      () => CreatePolygonCommentRequestSchema.parse({ body: '   ' }),
      ZodError,
    );

    assert.deepEqual(CommentVoteRequestSchema.parse(undefined), { value: 1 });
    assert.deepEqual(CommentVoteRequestSchema.parse({}), { value: 1 });
    assert.deepEqual(CommentVoteRequestSchema.parse({ value: 1 }), { value: 1 });

    const commentLow = PolygonCommentSchema.parse({
      id: '550e8400-e29b-41d4-a716-446655440011',
      polygonId: '550e8400-e29b-41d4-a716-446655440001',
      parentId: null,
      body: 'Older comment with 1 upvote',
      authorPseudonym: 'citizen_a',
      isAuthor: false,
      upvotes: 1,
      myVote: 0,
      createdAt: '2026-11-13T10:00:00.000Z',
      updatedAt: '2026-11-13T10:00:00.000Z',
    });
    const commentHigh = PolygonCommentSchema.parse({
      id: '550e8400-e29b-41d4-a716-446655440012',
      polygonId: '550e8400-e29b-41d4-a716-446655440001',
      parentId: commentLow.id,
      body: 'Reply with 5 upvotes',
      authorPseudonym: 'citizen_b',
      isAuthor: true,
      upvotes: 5,
      myVote: 1,
      createdAt: '2026-11-13T11:00:00.000Z',
      updatedAt: '2026-11-13T11:00:00.000Z',
    });

    const sortedComments = sortPolygonCommentsByRating([commentLow, commentHigh]);
    assert.equal(sortedComments[0]?.id, commentHigh.id);
    assert.equal(findTopRatedCommentId([commentLow, commentHigh]), commentHigh.id);
    assert.equal(
      findTopRatedCommentId([{ ...commentLow, upvotes: 0 }]),
      null,
    );

    const parsedCommentList = PolygonCommentListResponseSchema.parse({
      polygonId: '550e8400-e29b-41d4-a716-446655440001',
      topCommentId: commentHigh.id,
      comments: sortedComments,
    });
    assert.equal(parsedCommentList.topCommentId, commentHigh.id);

    const parsedCommentVote = CommentVoteResponseSchema.parse({
      commentId: commentHigh.id,
      polygonId: '550e8400-e29b-41d4-a716-446655440001',
      upvotes: 5,
      myVote: 1,
    });
    assert.equal(parsedCommentVote.upvotes, 5);

    const parsedListQuery = PolygonListQuerySchema.parse({
      bbox: '9.98,53.54,10.01,53.56',
      filter: 'new',
    });
    assert.equal(parsedListQuery.filter, 'new');

    const parsedListQueryEstablished = PolygonListQuerySchema.parse({
      bbox: '9.98,53.54,10.01,53.56',
      filter: 'established',
    });
    assert.equal(parsedListQueryEstablished.filter, 'established');

    const parsedListQueryNeedsReview = PolygonListQuerySchema.parse({
      bbox: '9.98,53.54,10.01,53.56',
      filter: 'needs_review',
    });
    assert.equal(parsedListQueryNeedsReview.filter, 'needs_review');

    // Legacy query parameter fallback normalizes into single-choice filter
    const parsedLegacyQuery = PolygonListQuerySchema.parse({
      bbox: '9.98,53.54,10.01,53.56',
      authorType: 'new_user',
      unratedFlaggedOnly: 'false',
    });
    assert.equal(parsedLegacyQuery.filter, 'new');

    const parsedListQueryDefault = PolygonListQuerySchema.parse({
      bbox: '9.98,53.54,10.01,53.56',
    });
    assert.equal(parsedListQueryDefault.filter, 'all');

    assert.throws(() =>
      PolygonListQuerySchema.parse({
        bbox: '9.98,53.54,10.01,53.56',
        filter: ['new', 'needs_review'],
      }),
    );

    const parsedFlagReq = FlagPolygonRequestSchema.parse({
      reason: 'already_unsealed',
      note: 'Satellite & street view show lawn.',
    });
    assert.equal(parsedFlagReq.reason, 'already_unsealed');

    const parsedFlagRes = FlagPolygonResponseSchema.parse({
      polygonId: '550e8400-e29b-41d4-a716-446655440001',
      flagCount: 2,
      isFlagged: true,
      myFlag: true,
      myFlagReason: 'already_unsealed',
    });
    assert.equal(parsedFlagRes.isFlagged, true);

    const parsedChallenge = AltchaChallengeResponseSchema.parse({
      algorithm: 'SHA-256',
      challenge: 'a'.repeat(64),
      maxnumber: 10000,
      salt: '1700000000000:abcdef1234567890',
      signature: 'b'.repeat(64),
    });
    assert.equal(parsedChallenge.algorithm, 'SHA-256');
    assert.equal(TRUST_AND_MODERATION_LIMITS.STALE_UNRATED_PRUNE_DAYS, 30);

    const parsedPublicStats = PublicStatsResponseSchema.parse({
      totalPolygons: 10,
      proposedCount: 6,
      inProgressCount: 2,
      finishedCount: 2,
      needsReviewCount: 3,
      totalAreaM2: 1450.5,
      unsealedAreaM2: 320.25,
      totalVotes: 24,
      totalUpvotes: 20,
      totalDownvotes: 4,
      surfaceBreakdown: {
        asphalt: { count: 4, areaM2: 600.5 },
        concrete: { count: 3, areaM2: 450 },
        pavers: { count: 2, areaM2: 250 },
        other: { count: 1, areaM2: 150 },
      },
    });
    assert.equal(parsedPublicStats.totalPolygons, 10);
    assert.equal(parsedPublicStats.needsReviewCount, 3);
    assert.equal(parsedPublicStats.surfaceBreakdown.asphalt.count, 4);

    const parsedPersonalStats = PersonalStatsResponseSchema.parse({
      totalPolygons: 3,
      proposedCount: 2,
      inProgressCount: 0,
      finishedCount: 1,
      totalAreaM2: 410.2,
      unsealedAreaM2: 120.5,
      ratedPolygonsCount: 7,
    });
    assert.equal(parsedPersonalStats.finishedCount, 1);
    assert.equal(parsedPersonalStats.ratedPolygonsCount, 7);
  });

  it('provides publisher-prescribed German state DOP20 attributions, dynamic viewport selection, and DSA Art. 16 content-report schemas', () => {
    assert.equal(GERMAN_STATE_DOP20_PROVIDERS.length, 15);
    const byCode = new Map(GERMAN_STATE_DOP20_PROVIDERS.map((p) => [p.code, p]));

    // Verify exact GetCapabilities wordings for updated states
    assert.equal(
      formatStateDop20FullAttribution(byCode.get('RP')!, 2026),
      '©GeoBasis-DE / LVermGeoRP (2026), dl-de/by-2-0, http://www.lvermgeo.rlp.de [Daten bearbeitet]',
    );
    assert.match(
      formatStateDop20FullAttribution(byCode.get('BW')!, 2026),
      /LGL-BW.*www\.lgl-bw\.de/,
    );
    assert.match(
      formatStateDop20FullAttribution(byCode.get('SH')!, 2026),
      /GeoBasis-DE\/LVermGeo SH\/CC BY 4\.0/,
    );
    assert.match(
      formatStateDop20FullAttribution(byCode.get('MV')!, 2026),
      /© GeoBasis-DE\/M-V 2026/,
    );
    assert.match(
      formatStateDop20FullAttribution(byCode.get('NI')!, 2026),
      /LGLN.*CC BY 4\.0/,
    );
    assert.match(formatDefaultDop20Attribution(2026), /2026; DOP20\/DOP10/);

    // Mainz viewport crosses RP and HE -> selects RP + HE with clickable dl-de/by-2-0 & dl-de/zero-2-0 links
    const mainzBbox = [8.22, 49.97, 8.32, 50.03] as const;
    const mainzProviders = selectDop20ProvidersForBounds(mainzBbox);
    const mainzCodes = mainzProviders.map((p) => p.code);
    assert.ok(mainzCodes.includes('RP'));
    assert.ok(mainzCodes.includes('HE'));

    const mainzHtml = formatDop20WebAttributionHtml(mainzBbox, {
      year: 2026,
      licensesUrl: 'https://openunseal.example.org/auth/licenses',
    });
    assert.match(mainzHtml, /LVermGeoRP/);
    assert.match(mainzHtml, /HVBG/);
    assert.match(mainzHtml, /https:\/\/www\.govdata\.de\/dl-de\/by-2-0/);
    assert.match(mainzHtml, /https:\/\/www\.govdata\.de\/dl-de\/zero-2-0/);
    assert.match(mainzHtml, /Daten bearbeitet|Daten verändert/);

    const mainzPlain = formatDop20PlainAttribution(mainzBbox, { year: 2026 });
    assert.match(mainzPlain, /LVermGeoRP/);
    assert.match(mainzPlain, /HVBG/);

    // Wide Germany viewport (> 4 intersecting states) falls back cleanly with link to /auth/licenses
    const germanyBbox = [6.0, 47.5, 14.5, 54.8] as const;
    const germanyHtml = formatDop20WebAttributionHtml(germanyBbox, {
      year: 2026,
      licensesUrl: 'https://openunseal.example.org/auth/licenses',
    });
    assert.match(germanyHtml, /DOP20\/DOP10/);
    assert.match(germanyHtml, /https:\/\/openunseal\.example\.org\/auth\/licenses/);

    // Outside Germany -> empty attribution
    const oceanBbox = [-40, 30, -39, 31] as const;
    assert.deepEqual(selectDop20ProvidersForBounds(oceanBbox), []);
    assert.equal(formatDop20WebAttributionHtml(oceanBbox, { year: 2026 }), '');
    assert.equal(formatDop20PlainAttribution(oceanBbox, { year: 2026 }), '');

    // DSA Art. 16 Content Report schemas
    assert.deepEqual(CONTENT_REPORT_TARGET_TYPES, ['polygon', 'photo', 'comment', 'chat_message']);
    assert.ok(CONTENT_REPORT_REASONS.includes('privacy_personal_data'));
    assert.ok(CONTENT_REPORT_REASONS.includes('copyright'));

    const validReport = CreateContentReportRequestSchema.parse({
      targetType: 'photo',
      targetId: '550e8400-e29b-41d4-a716-446655440001',
      reason: 'privacy_personal_data',
      explanation: '  Photo clearly shows a visible car license plate and face.  ',
      reporterName: '  Max Mustermann  ',
      reporterEmail: '  max@example.org  ',
      goodFaithConfirmed: true,
      pageUrl: 'https://openunseal.example.org/#p=550e8400-e29b-41d4-a716-446655440001',
    });
    assert.equal(
      validReport.explanation,
      'Photo clearly shows a visible car license plate and face.',
    );
    assert.equal(validReport.reporterName, 'Max Mustermann');
    assert.equal(validReport.reporterEmail, 'max@example.org');

    // Empty optional email/name coerce to null; missing goodFaithConfirmed or too-short explanation fails
    const anonReport = CreateContentReportRequestSchema.parse({
      targetType: 'comment',
      targetId: '550e8400-e29b-41d4-a716-446655440002',
      reason: 'defamation_illegal',
      explanation: 'Insulting and defamatory personal attack in comment.',
      reporterName: '   ',
      reporterEmail: '',
      goodFaithConfirmed: true,
    });
    assert.equal(anonReport.reporterName, null);
    assert.equal(anonReport.reporterEmail, null);

    assert.throws(() =>
      CreateContentReportRequestSchema.parse({
        targetType: 'polygon',
        targetId: '550e8400-e29b-41d4-a716-446655440001',
        reason: 'other',
        explanation: 'too short',
        goodFaithConfirmed: true,
      }),
    );

    assert.throws(() =>
      CreateContentReportRequestSchema.parse({
        targetType: 'polygon',
        targetId: '550e8400-e29b-41d4-a716-446655440001',
        reason: 'other',
        explanation: 'Missing good-faith confirmation under Art. 16(2)(d) DSA.',
      }),
    );

    const parsedReportRes = CreateContentReportResponseSchema.parse({
      status: 'received',
      reportId: '550e8400-e29b-41d4-a716-446655440099',
      receiptSent: true,
    });
    assert.equal(parsedReportRes.receiptSent, true);
  });

  it('validates BrandingConfigSchema, rejects unsafe URLs & invalid hex colors, and preserves RuntimeConfigSchema backwards compatibility', () => {
    assert.equal(DEFAULT_APP_NAME, 'OpenUnseal');
    assert.deepEqual(WEBHOOK_EVENT_TYPES, [
      'polygon.created',
      'polygon.status_changed',
      'polygon.deleted',
    ]);

    assert.equal(HexColorSchema.parse('#005A9C'), '#005A9C');
    assert.throws(() => HexColorSchema.parse('#fff'), ZodError);
    assert.throws(() => HexColorSchema.parse('rgb(0,0,0)'), ZodError);
    assert.throws(() => HexColorSchema.parse('blue'), ZodError);

    const defaults = BrandingConfigSchema.parse({});
    assert.deepEqual(defaults, {
      appName: 'OpenUnseal',
      subtitleDe: null,
      subtitleEn: null,
      logoUrl: null,
      accentColor: null,
      accentDarkColor: null,
      introEnabled: true,
      portalUrl: null,
      portalLabel: null,
    });

    const municipal = BrandingConfigSchema.parse({
      appName: 'Entsiegelung Musterstadt',
      subtitleDe: 'Bürgerbeteiligung der Stadt Musterstadt',
      subtitleEn: 'Civic Unsealing Map of Musterstadt',
      logoUrl: '/api/v1/branding/logo?v=123456789abc',
      accentColor: '#005a9c',
      accentDarkColor: '#4fa3e0',
      introEnabled: false,
      portalUrl: 'https://www.musterstadt.de/klimaschutz',
      portalLabel: 'Klimaschutzportal',
    });
    assert.equal(municipal.appName, 'Entsiegelung Musterstadt');
    assert.equal(municipal.introEnabled, false);

    // Reject javascript:/data:/protocol-relative URLs on logoUrl & portalUrl
    for (const badLogo of [
      'javascript:alert(1)',
      'data:image/svg+xml,<svg onload=alert(1)>',
      '//evil.example/logo.svg',
      'ftp://example.org/logo.png',
    ]) {
      assert.throws(
        () => BrandingConfigSchema.parse({ logoUrl: badLogo }),
        ZodError,
        `Expected logoUrl "${badLogo}" to be rejected`,
      );
    }

    for (const badPortal of [
      'javascript:alert(1)',
      '/relative-not-allowed-for-portal',
      'mailto:test@example.org',
    ]) {
      assert.throws(
        () => BrandingConfigSchema.parse({ portalUrl: badPortal }),
        ZodError,
        `Expected portalUrl "${badPortal}" to be rejected`,
      );
    }

    // Legacy /api/v1/config payload without `branding` remains completely valid
    const legacyConfigPayload = {
      osmStyleUrl: 'https://tiles.openfreemap.org/styles/liberty',
      orthophoto: null,
      initialView: { lng: 8.2739, lat: 49.9989, zoom: 15 },
      limits: {
        minAreaM2: 2,
        maxAreaM2: 20_000,
        maxVertices: 200,
        maxPolygonSpanDeg: 0.05,
        maxBboxSpanDeg: 1.5,
        bboxFeatureLimit: 1000,
        maxDailyPolygonsPerUser: 25,
      },
      disclaimerText: 'Test',
      abuseContact: null,
      privacyPolicyUrl: 'https://example.org/auth/privacy',
    };
    const parsedLegacy = RuntimeConfigSchema.parse(legacyConfigPayload);
    assert.equal(parsedLegacy.branding, undefined);

    const parsedBranded = RuntimeConfigSchema.parse({
      ...legacyConfigPayload,
      branding: municipal,
    });
    assert.equal(parsedBranded.branding?.appName, 'Entsiegelung Musterstadt');
    assert.equal(parsedBranded.branding?.accentColor, '#005a9c');
  });
});
