import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import sharp from 'sharp';

import {
  ApiError,
  HealthResponseSchema,
  PolygonFeatureSchema,
  type BboxBounds,
  type PolygonFeature,
} from '@entsiegelung/shared';
import {
  appReducer,
  initialAppState,
  type AppState,
} from '@entsiegelung/mobile/appState';
import { PpgisApiClient } from '@entsiegelung/mobile/client';
import { createMemorySessionStorage } from '@entsiegelung/mobile/tokenStorage';
import {
  deriveAuthModalModel,
  deriveDrawingToolbarModel,
  deriveInspectorOverviewMeta,
  deriveMapControlsModel,
} from '@entsiegelung/mobile/viewModels';

import {
  buildApp,
  createMemoryMailer,
  upsertMunicipalitiesAndBackfill,
  type MemoryMailer,
} from '../apps/api/src/app.js';
import { loadEnvConfig } from '../apps/api/src/config.js';
import { resetTestDb, setupTestDb } from '../apps/api/src/db/testHarness.js';
import { createLogger } from '../apps/api/src/logger.js';

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

const HAMBURG_BBOX: BboxBounds = {
  minLng: 9.99,
  minLat: 53.55,
  maxLng: 10.0,
  maxLat: 53.56,
};

const MAINZ_BBOX: BboxBounds = {
  minLng: 8.26,
  minLat: 49.99,
  maxLng: 8.28,
  maxLat: 50.01,
};

const COURTYARD_VERTICES: [number, number][] = [
  [9.9937, 53.5511],
  [9.99385, 53.5511],
  [9.99385, 53.551208],
  [9.9937, 53.551208],
];

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

interface StreamedGeoJsonCollection {
  type: 'FeatureCollection';
  features: PolygonFeature[];
}

function parseStreamedGeoJson(raw: string): StreamedGeoJsonCollection {
  const parsed = JSON.parse(raw) as {
    type?: unknown;
    features?: unknown;
  };
  assert.equal(parsed.type, 'FeatureCollection');
  assert.ok(Array.isArray(parsed.features));
  return {
    type: 'FeatureCollection',
    features: parsed.features.map((item) => PolygonFeatureSchema.parse(item)),
  };
}

function extractTokenFromUrl(actionUrl: string): string {
  const parsed = new URL(actionUrl);
  const token = parsed.searchParams.get('token');
  assert.ok(token && token.length >= 32, `Expected token in ${actionUrl}`);
  return token;
}

async function confirmEmailViaHostedWebPage(
  baseUrl: string,
  actionUrl: string,
): Promise<void> {
  const token = extractTokenFromUrl(actionUrl);
  const getPageRes = await fetch(
    `${baseUrl}/auth/verify-email?token=${encodeURIComponent(token)}`,
  );
  assert.equal(getPageRes.status, 200);
  const getHtml = await getPageRes.text();
  assert.match(getHtml, /E-Mail-Adresse jetzt bestätigen/);

  const postFormRes = await fetch(`${baseUrl}/auth/verify-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ token }).toString(),
  });
  assert.equal(postFormRes.status, 200);
  const postHtml = await postFormRes.text();
  assert.match(postHtml, /erfolgreich bestätigt/);
}

describe('Full-stack HTTP E2E flow v2 (PpgisApiClient + appReducer + Fastify + PostGIS + Photos + VG250)', () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let mailer: MemoryMailer;
  let uploadsDir = '';
  let baseUrl = '';

  before(async () => {
    pool = await setupTestDb();
    uploadsDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'entsiegelung-e2e-uploads-'),
    );
    mailer = createMemoryMailer();

    const config = loadEnvConfig({
      ...process.env,
      HOST: '127.0.0.1',
      PORT: '0',
      PUBLIC_BASE_URL: 'https://entsiegelung.example.org',
      UPLOADS_DIR: uploadsDir,
      AUTO_SEED_VG250: 'false',
      ABUSE_CONTACT: 'moderation@entsiegelung.example.org',
      AUTH_CAPTCHA_ENABLED: 'true',
      AUTH_CAPTCHA_MAX_NUMBER: '500',
      ORTHOPHOTO_URL_TEMPLATE:
        'https://ortho.entsiegelung.example.org/dop/{z}/{x}/{y}.jpg',
      ORTHOPHOTO_TILE_SIZE: '256',
      ORTHOPHOTO_ATTRIBUTION: '© Municipal Aerial Survey',
      ORTHOPHOTO_BOUNDS: '9.70,53.35,10.35,53.75',
      ORTHOPHOTO_MAX_ZOOM: '20',
    });
    app = await buildApp(config, pool, {
      logger: createLogger({ level: 'silent' }),
      mailer,
      geocodeFetch: async (input) => {
        const urlStr = String(input);
        const body = urlStr.includes('Mainz')
          ? [
              {
                place_id: 90123,
                display_name:
                  'Mainz Hauptbahnhof, Bahnhofplatz, Mainz, Rheinland-Pfalz, Deutschland',
                lat: '50.0011',
                lon: '8.2587',
                boundingbox: ['49.9995', '50.0028', '8.2565', '8.2610'],
              },
            ]
          : [];
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
      rateLimits: {
        register: { max: 50, timeWindow: '1 hour' },
      },
    });
    baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  });

  beforeEach(async () => {
    await resetTestDb(pool);
    mailer.clear();
    await upsertMunicipalitiesAndBackfill(pool, [
      {
        ags: '02000000',
        name: 'Hamburg',
        stateCode: '02',
        geoJsonGeometry: HAMBURG_MUNICIPALITY_GEOJSON,
      },
      {
        ags: '07315000',
        name: 'Mainz',
        stateCode: '07',
        geoJsonGeometry: MAINZ_MUNICIPALITY_GEOJSON,
      },
    ]);
  });

  after(async () => {
    if (app) {
      await app.close();
    }
    if (pool) {
      await pool.end();
    }
    if (uploadsDir) {
      await fs.rm(uploadsDir, { recursive: true, force: true });
    }
  });

  it('completes anonymous config & privacy page, 2-step drawing wizard + draft photo, email confirmation link signup, GPS-verified EXIF-stripped photo upload & rating, municipality-bounded scoring, admin finished/import, and GDPR deletion', async () => {
    // 0. Live health check & hosted privacy policy page over HTTP
    const healthRes = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(healthRes.status, 200);
    assert.ok(healthRes.headers.get('x-request-id'));
    const healthBody = HealthResponseSchema.parse(await healthRes.json());
    assert.equal(healthBody.status, 'ok');
    assert.ok(healthBody.migrationsApplied >= 2);

    const privacyRes = await fetch(`${baseUrl}/auth/privacy`);
    assert.equal(privacyRes.status, 200);
    const privacyHtml = await privacyRes.text();
    assert.match(privacyHtml, /Datenschutzerklärung/);
    assert.match(privacyHtml, /GPS verified/);

    // 1. Anonymous cold-start: /api/v1/config + /api/v1/polygons?bbox=... (Vary: Authorization)
    const anonStorage = createMemorySessionStorage();
    const anonClient = new PpgisApiClient(baseUrl, anonStorage);

    let state: AppState = initialAppState;
    assert.equal(state.configStatus, 'loading');

    const runtimeConfig = await anonClient.getConfig();
    assert.equal(
      runtimeConfig.abuseContact,
      'moderation@entsiegelung.example.org',
    );
    assert.notEqual(runtimeConfig.orthophoto, null);

    state = appReducer(state, { type: 'CONFIG_LOADED', config: runtimeConfig });
    assert.equal(state.configStatus, 'ready');

    const initialControls = deriveMapControlsModel(state);
    assert.equal(state.locale, 'de');
    assert.equal(initialControls.locale, 'de');
    assert.equal(initialControls.showFirstVisitDisclaimer, false);
    assert.equal(initialControls.showOrthophotoToggle, true);
    assert.equal(initialControls.isAuthenticated, false);
    assert.equal(initialControls.isAdmin, false);
    assert.equal(initialControls.accountLabel, 'Anmelden');

    const englishControls = deriveMapControlsModel(
      appReducer(state, { type: 'SET_LOCALE', locale: 'en' }),
    );
    assert.equal(englishControls.locale, 'en');
    assert.equal(englishControls.accountLabel, 'Sign in');

    // Raw anonymous HTTP headers on GET /api/v1/polygons?bbox=...
    const rawAnonBboxRes = await fetch(
      `${baseUrl}/api/v1/polygons?bbox=${HAMBURG_BBOX.minLng},${HAMBURG_BBOX.minLat},${HAMBURG_BBOX.maxLng},${HAMBURG_BBOX.maxLat}`,
    );
    assert.equal(rawAnonBboxRes.status, 200);
    assert.match(rawAnonBboxRes.headers.get('vary') ?? '', /Authorization/i);
    assert.equal(
      rawAnonBboxRes.headers.get('cache-control'),
      'public, max-age=5',
    );

    // Zoom into Hamburg district and fetch initial empty collection
    state = appReducer(state, {
      type: 'SET_VIEWPORT',
      bbox: HAMBURG_BBOX,
      zoom: 16,
    });
    assert.equal(state.spanTooWide, false);

    const emptyCollection = await anonClient.listPolygons(HAMBURG_BBOX);
    assert.equal(emptyCollection.features.length, 0);
    state = appReducer(state, {
      type: 'VIEWPORT_FEATURES_LOADED',
      features: emptyCollection.features,
      truncated: emptyCollection.meta.truncated,
    });

    // 2. Two-step progressive drawing wizard + onsite GPS-tagged photo attachment
    state = appReducer(state, { type: 'START_DRAW' });
    assert.equal(state.drawingStep, 'geometry');

    for (const vertex of COURTYARD_VERTICES) {
      state = appReducer(state, { type: 'ADD_VERTEX', point: vertex });
    }
    // Tap duplicate last vertex within 1e-7 deg to verify client deduplication
    state = appReducer(state, {
      type: 'ADD_VERTEX',
      point: [9.99370002, 53.55120802],
    });

    let toolbar = deriveDrawingToolbarModel(state);
    assert.equal(toolbar.step, 'geometry');
    assert.equal(toolbar.distinctVertexCount, 4);
    assert.ok(toolbar.areaM2 >= 2 && toolbar.areaM2 <= 500_000);
    assert.equal(toolbar.canAdvanceToDetails, true);

    // Advance to Step 2 ('details') - automatically closes the polygon ring
    state = appReducer(state, { type: 'ADVANCE_TO_DETAILS' });
    state = appReducer(state, {
      type: 'SET_DRAFT_META',
      surfaceType: 'asphalt',
      note: 'Impervious asphalt parking strip next to schoolyard',
    });

    // Synthesize a real JPEG carrying camera EXIF + GPS ~15 m from (9.9937, 53.5511)
    const onsiteJpegBuffer = await sharp({
      create: {
        width: 640,
        height: 480,
        channels: 3,
        background: { r: 85, g: 115, b: 95 },
      },
    })
      .withExif({
        IFD0: {
          Make: 'PrivatePhoneVendor',
          Model: 'FieldMapperPhone',
        },
        IFD3: {
          GPSLatitudeRef: 'N',
          GPSLatitude: '53 33 4.00',
          GPSLongitudeRef: 'E',
          GPSLongitude: '9 59 37.40',
        },
      })
      .jpeg({ quality: 86 })
      .toBuffer();

    state = appReducer(state, {
      type: 'ADD_DRAFT_PHOTO',
      photo: {
        id: 'draft-onsite-1',
        previewUri: 'blob:onsite-courtyard',
        file: {
          uri: 'blob:onsite-courtyard',
          name: 'courtyard-onsite.jpg',
          mimeType: 'image/jpeg',
          webFile: new Blob([new Uint8Array(onsiteJpegBuffer)], {
            type: 'image/jpeg',
          }),
        },
      },
    });

    toolbar = deriveDrawingToolbarModel(state);
    assert.equal(toolbar.step, 'details');
    assert.equal(toolbar.isRingClosed, true);
    assert.equal(toolbar.draftPhotos.length, 1);
    assert.equal(toolbar.canSubmit, true);

    // Submitting while unauthenticated queues draft + photo and opens email registration modal
    state = appReducer(state, { type: 'SUBMIT_DRAFT' });
    assert.equal(state.authModalOpen, true);
    assert.equal(state.authModalView, 'register');
    assert.equal(state.pendingIntent?.type, 'SUBMIT_DRAFT');

    const authorStorage = createMemorySessionStorage();
    const authorClient = new PpgisApiClient(baseUrl, authorStorage);
    const regAuthor = await authorClient.register({
      pseudonym: 'courtyard_author',
      email: 'courtyard_author@example.org',
      password: 'correct-horse-battery-staple',
      acceptedPrivacyPolicy: true,
    });
    assert.equal(regAuthor.status, 'verification_email_sent');
    assert.equal(mailer.outbox.length, 1);
    assert.equal(mailer.outbox[0]?.purpose, 'verify_email');

    state = appReducer(state, {
      type: 'REGISTRATION_VERIFICATION_SENT',
      email: regAuthor.email,
      pseudonym: regAuthor.pseudonym,
    });
    const verifyPendingModal = deriveAuthModalModel(state);
    assert.equal(verifyPendingModal.view, 'verify_pending');
    assert.equal(
      verifyPendingModal.pendingVerificationEmail,
      'courtyard_author@example.org',
    );

    // Login before confirming email fails with 403 AUTH_EMAIL_UNVERIFIED
    await assert.rejects(
      () =>
        authorClient.login({
          identifier: 'courtyard_author',
          password: 'correct-horse-battery-staple',
        }),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, 'AUTH_EMAIL_UNVERIFIED');
        return true;
      },
    );

    // User clicks confirmation link on the hosted VPS page (GET + POST /auth/verify-email)
    await confirmEmailViaHostedWebPage(baseUrl, mailer.outbox[0]!.actionUrl);

    // Sign in and resume queued SUBMIT_DRAFT + photo upload!
    const authorSession = await authorClient.login({
      identifier: 'courtyard_author',
      password: 'correct-horse-battery-staple',
    });
    state = appReducer(state, {
      type: 'AUTH_SUCCEEDED',
      user: authorSession.user,
    });
    assert.equal(state.authModalOpen, false);
    assert.ok(
      state.pendingIntent && state.pendingIntent.type === 'SUBMIT_DRAFT',
    );

    const createdPolygon = await authorClient.createPolygon(
      state.pendingIntent.payload,
    );
    const uploadedPhoto = await authorClient.uploadPolygonPhoto(
      createdPolygon.id,
      state.pendingIntent.photos[0]!,
    );
    assert.equal(uploadedPhoto.gpsVerified, true);
    assert.equal(uploadedPhoto.uploaderPseudonym, 'courtyard_author');

    // Verify served WebP photo has 100% of EXIF camera & GPS tags stripped
    const servedWebpRes = await fetch(
      authorClient.resolveUploadUrl(uploadedPhoto.url),
    );
    assert.equal(servedWebpRes.status, 200);
    assert.equal(servedWebpRes.headers.get('content-type'), 'image/webp');
    const servedWebpBuf = Buffer.from(await servedWebpRes.arrayBuffer());
    const servedMeta = await sharp(servedWebpBuf).metadata();
    assert.equal(servedMeta.format, 'webp');
    assert.equal(servedMeta.exif, undefined);
    assert.equal(
      servedWebpBuf.includes(Buffer.from('PrivatePhoneVendor', 'utf8')),
      false,
    );

    state = appReducer(state, {
      type: 'POLYGON_CREATED',
      feature: {
        ...createdPolygon,
        properties: {
          ...createdPolygon.properties,
          photoCount: 1,
        },
      },
    });

    assert.equal(state.mode, 'browse');
    assert.equal(state.pendingIntent, null);
    assert.equal(createdPolygon.properties.municipalityAgs, '02000000');
    assert.equal(createdPolygon.properties.municipalityName, 'Hamburg');
    assert.equal(createdPolygon.properties.status, 'proposed');
    assert.equal(createdPolygon.properties.isAuthor, true);

    const polygonId = createdPolygon.id;

    // 3. Second user registers, rates photo as "real" (+1), votes +1 on Hamburg polygon, and verifies municipality isolation against Mainz
    const voterStorage = createMemorySessionStorage();
    const voterClient = new PpgisApiClient(baseUrl, voterStorage);
    await voterClient.register({
      pseudonym: 'district_voter',
      email: 'district_voter@example.org',
      password: 'second-user-strong-pass',
      acceptedPrivacyPolicy: true,
    });
    await confirmEmailViaHostedWebPage(
      baseUrl,
      mailer.outbox[mailer.outbox.length - 1]!.actionUrl,
    );
    await voterClient.login({
      identifier: 'district_voter@example.org',
      password: 'second-user-strong-pass',
    });

    const photoVoteRes = await voterClient.putPhotoVote(uploadedPhoto.id, 1);
    assert.equal(photoVoteRes.realVotes, 1);
    assert.equal(photoVoteRes.fakeVotes, 0);
    assert.equal(photoVoteRes.credibilityScore, 1);
    assert.equal(photoVoteRes.myVote, 1);

    // Non-author cannot delete author's polygon (403 FORBIDDEN_NOT_AUTHOR)
    await assert.rejects(
      () => voterClient.deletePolygon(polygonId),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, 'FORBIDDEN_NOT_AUTHOR');
        return true;
      },
    );

    // Create a Mainz polygon with many upvotes and ensure Hamburg's normalized score is NOT crushed by Mainz
    const mainzPoly = await voterClient.createPolygon({
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [8.271, 49.998],
            [8.2712, 49.998],
            [8.2712, 49.99815],
            [8.271, 49.99815],
            [8.271, 49.998],
          ],
        ],
      },
      surfaceType: 'concrete',
      note: 'Mainz station square',
    });
    assert.equal(mainzPoly.properties.municipalityName, 'Mainz');

    await authorClient.putVote(mainzPoly.id, 1);
    // Self-voting on own polygon is rejected with 403 FORBIDDEN_SELF_VOTE
    await assert.rejects(
      () => voterClient.putVote(mainzPoly.id, 1),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, 'FORBIDDEN_SELF_VOTE');
        return true;
      },
    );
    await assert.rejects(
      () => authorClient.putVote(polygonId, -1),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, 'FORBIDDEN_SELF_VOTE');
        return true;
      },
    );
    const upvoteHamburg = await voterClient.putVote(polygonId, 1);
    assert.equal(upvoteHamburg.score, 1);

    // Hamburg score=1 -> smoothed against Hamburg's own floor (min floor = 3 -> 1/3 = 0.3333), independent of Mainz
    const hamburgList = await anonClient.listPolygons(HAMBURG_BBOX);
    assert.equal(hamburgList.features.length, 1);
    assert.ok(
      Math.abs(
        (hamburgList.features[0]?.properties.municipalityNormalizedScore ?? 0) -
          1 / 3,
      ) < 0.01,
    );

    // 3b. Per-polygon comments, replies to comments, comment upvotes, and top-rated ordering
    const rootComment = await authorClient.createPolygonComment(polygonId, {
      body: 'Asphalt is cracked and floods during summer rainstorms.',
    });
    assert.equal(rootComment.parentId, null);

    const replyComment = await voterClient.createPolygonComment(polygonId, {
      body: 'Confirmed - tree pit unsealing along the curb would drain this whole corner.',
      parentId: rootComment.id,
    });
    assert.equal(replyComment.parentId, rootComment.id);

    await authorClient.putCommentVote(replyComment.id);
    // Self-upvoting own comment is rejected with 403 FORBIDDEN_SELF_VOTE
    await assert.rejects(
      () => voterClient.putCommentVote(replyComment.id),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, 'FORBIDDEN_SELF_VOTE');
        return true;
      },
    );
    await assert.rejects(
      () => authorClient.putCommentVote(rootComment.id),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, 'FORBIDDEN_SELF_VOTE');
        return true;
      },
    );

    const commentsBeforeDelete = await anonClient.listPolygonComments(polygonId);
    assert.equal(commentsBeforeDelete.comments.length, 2);
    assert.equal(commentsBeforeDelete.topCommentId, replyComment.id);
    assert.equal(commentsBeforeDelete.comments[0]?.id, replyComment.id);
    assert.equal(commentsBeforeDelete.comments[0]?.upvotes, 1);

    const polyWithComments = await anonClient.getPolygon(polygonId);
    assert.equal(polyWithComments.properties.commentCount, 2);

    // Voter self-deletes account -> polygon, photo & comment votes recompute cleanly, surviving comment anonymized to 'deleted'
    await voterClient.deleteMe();
    const afterVoterDeleted = await anonClient.getPolygon(polygonId);
    assert.equal(afterVoterDeleted.properties.score, 0);
    assert.equal(afterVoterDeleted.properties.commentCount, 2);

    const commentsAfterGdpr = await anonClient.listPolygonComments(polygonId);
    assert.equal(commentsAfterGdpr.topCommentId, replyComment.id);
    assert.equal(commentsAfterGdpr.comments[0]?.id, replyComment.id);
    assert.equal(commentsAfterGdpr.comments[0]?.authorPseudonym, 'deleted');
    assert.equal(commentsAfterGdpr.comments[0]?.upvotes, 1);

    // 4. Promote an admin user, import GeoJSON polygons in Mainz, and mark Hamburg polygon as "finished"
    const adminStorage = createMemorySessionStorage();
    const adminClient = new PpgisApiClient(baseUrl, adminStorage);
    await adminClient.register({
      pseudonym: 'umweltamt_hh',
      email: 'umweltamt@example.org',
      password: 'municipal-admin-pass-123',
      acceptedPrivacyPolicy: true,
    });
    await confirmEmailViaHostedWebPage(
      baseUrl,
      mailer.outbox[mailer.outbox.length - 1]!.actionUrl,
    );

    // Before grant-admin, regular user cannot mark polygon finished (403 FORBIDDEN_ADMIN_ONLY)
    await adminClient.login({
      identifier: 'umweltamt_hh',
      password: 'municipal-admin-pass-123',
    });
    await assert.rejects(
      () => adminClient.patchPolygonStatus(polygonId, 'finished'),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, 'FORBIDDEN_ADMIN_ONLY');
        return true;
      },
    );

    await app.runAdminCommand(['grant-admin', 'umweltamt_hh']);
    const adminMe = await adminClient.getMe();
    assert.equal(adminMe.role, 'admin');

    const markedInProgress = await adminClient.patchPolygonStatus(
      polygonId,
      'in_progress',
    );
    assert.equal(markedInProgress.properties.status, 'in_progress');
    assert.equal(markedInProgress.properties.finishedAt, null);

    // While 'in_progress': area voting is locked (409 VOTING_CLOSED), but comments are still permitted
    await assert.rejects(
      () => adminClient.putVote(polygonId, 1),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 409);
        assert.equal(err.code, 'VOTING_CLOSED');
        return true;
      },
    );
    const inProgressComment = await adminClient.createPolygonComment(polygonId, {
      body: 'Municipal construction crew scheduled for unsealing next month.',
    });
    assert.equal(inProgressComment.authorPseudonym, 'umweltamt_hh');

    const markedFinished = await adminClient.patchPolygonStatus(
      polygonId,
      'finished',
    );
    assert.equal(markedFinished.properties.status, 'finished');
    assert.ok(markedFinished.properties.finishedAt);

    // Once 'finished': BOTH area voting (409 VOTING_CLOSED) and comments (409 COMMENTS_CLOSED) are locked
    await assert.rejects(
      () => adminClient.putVote(polygonId, 1),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 409);
        assert.equal(err.code, 'VOTING_CLOSED');
        return true;
      },
    );
    await assert.rejects(
      () =>
        adminClient.createPolygonComment(polygonId, {
          body: 'Late comment after project completion.',
        }),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 409);
        assert.equal(err.code, 'COMMENTS_CLOSED');
        return true;
      },
    );

    // Nominatim geocoding proxy + Bug report delivery to info@open-unseal.de
    const geocodeRes = await anonClient.searchAddress('Mainz Hauptbahnhof', 'de');
    assert.equal(geocodeRes.results.length, 1);
    assert.equal(geocodeRes.results[0]?.lng, 8.2587);
    assert.equal(geocodeRes.results[0]?.lat, 50.0011);
    assert.deepEqual(geocodeRes.results[0]?.boundingBox, [
      8.2565,
      49.9995,
      8.261,
      50.0028,
    ]);

    const bugRes = await authorClient.submitBugReport({
      description: 'Opacity slider slightly jitters on older Android WebView.',
      contactEmail: 'reporter@example.org',
      platform: 'android',
    });
    assert.equal(bugRes.status, 'sent');
    assert.equal(mailer.bugReports.length, 1);
    assert.equal(mailer.bugReports[0]?.to, 'info@open-unseal.de');
    assert.equal(mailer.bugReports[0]?.reporterPseudonym, 'courtyard_author');
    assert.equal(mailer.bugReports[0]?.contactEmail, 'reporter@example.org');

    const importGeoJson = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            surfaceType: 'pavers',
            note: 'Imported municipal candidate',
          },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [8.272, 49.999],
                [8.2722, 49.999],
                [8.2722, 49.99915],
                [8.272, 49.99915],
                [8.272, 49.999],
              ],
            ],
          },
        },
      ],
    });
    const importResult = await adminClient.importPolygonsFile({
      uri: 'blob:import-geojson',
      name: 'candidates.geojson',
      mimeType: 'application/geo+json',
      webFile: new Blob([importGeoJson], { type: 'application/geo+json' }),
    });
    assert.equal(importResult.importedCount, 1);

    const mainzAfterImport = await anonClient.listPolygons(MAINZ_BBOX);
    assert.equal(mainzAfterImport.features.length, 2);

    // 5. Public streamed GeoJSON export never exposes user emails and includes status + municipality
    const exportRes = await fetch(authorClient.getExportGeoJsonUrl());
    assert.equal(exportRes.status, 200);
    const exportRaw = await exportRes.text();
    assert.equal(exportRaw.includes('courtyard_author@example.org'), false);
    assert.equal(exportRaw.includes('umweltamt@example.org'), false);
    const exportedCollection = parseStreamedGeoJson(exportRaw);
    const exportedHamburg = exportedCollection.features.find(
      (f) => f.id === polygonId,
    );
    assert.ok(exportedHamburg);
    assert.equal(exportedHamburg.properties.status, 'finished');
    assert.equal(exportedHamburg.properties.municipalityName, 'Hamburg');

    // 6. Original author deletes their account -> polygon & photo stay public under "deleted"
    await authorClient.deleteMe();
    const survivingFeature = await anonClient.getPolygon(polygonId);
    assert.equal(survivingFeature.properties.authorPseudonym, 'deleted');
    assert.equal(survivingFeature.properties.photoCount, 1);
  });

  it('verifies hosted email link password recovery + session revocation, 422 draft preservation, inline vote continuation, and admin CLI moderation', async () => {
    const userStorage = createMemorySessionStorage();
    const userClient = new PpgisApiClient(baseUrl, userStorage);

    await userClient.register({
      pseudonym: 'recovery_tester',
      email: 'recovery_tester@example.org',
      password: 'initial-password-123',
      acceptedPrivacyPolicy: true,
    });
    await confirmEmailViaHostedWebPage(baseUrl, mailer.outbox[0]!.actionUrl);

    const initialLogin = await userClient.login({
      identifier: 'recovery_tester',
      password: 'initial-password-123',
    });
    const oldToken = initialLogin.sessionToken;

    // Request password reset link via forgotPassword
    mailer.clear();
    const forgotRes = await userClient.forgotPassword(
      'recovery_tester@example.org',
    );
    assert.equal(forgotRes.status, 'ok');
    assert.equal(mailer.outbox.length, 1);
    assert.equal(mailer.outbox[0]?.purpose, 'reset_password');

    // Open hosted VPS password recovery page (GET + POST /auth/reset-password)
    const resetToken = extractTokenFromUrl(mailer.outbox[0]!.actionUrl);
    const resetGetRes = await fetch(
      `${baseUrl}/auth/reset-password?token=${encodeURIComponent(resetToken)}`,
    );
    assert.equal(resetGetRes.status, 200);
    assert.match(await resetGetRes.text(), /Neues Passwort festlegen/);

    const resetPostRes = await fetch(`${baseUrl}/auth/reset-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        token: resetToken,
        newPassword: 'rotated-password-456',
        confirmPassword: 'rotated-password-456',
      }).toString(),
    });
    assert.equal(resetPostRes.status, 200);
    assert.match(await resetPostRes.text(), /erfolgreich geändert/);

    // Prior session token is revoked immediately (401 AUTH_REQUIRED)
    const staleStorage = createMemorySessionStorage();
    await staleStorage.setToken(oldToken);
    const staleClient = new PpgisApiClient(baseUrl, staleStorage);
    await assert.rejects(
      () => staleClient.getMe(),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 401);
        assert.equal(err.code, 'AUTH_REQUIRED');
        return true;
      },
    );

    // Login with new password succeeds
    const relogin = await userClient.login({
      identifier: 'recovery_tester',
      password: 'rotated-password-456',
    });

    // Server 422 (< 2 m2 tiny polygon) preserves client draft vertices & note
    let state: AppState = appReducer(initialAppState, {
      type: 'CONFIG_LOADED',
      config: await userClient.getConfig(),
    });
    state = appReducer(state, {
      type: 'AUTH_SUCCEEDED',
      user: relogin.user,
    });
    state = appReducer(state, { type: 'START_DRAW' });
    state = appReducer(state, { type: 'ADD_VERTEX', point: [9.9937, 53.5511] });
    state = appReducer(state, {
      type: 'ADD_VERTEX',
      point: [9.993705, 53.5511],
    });
    state = appReducer(state, {
      type: 'ADD_VERTEX',
      point: [9.993705, 53.551105],
    });
    state = appReducer(state, { type: 'ADVANCE_TO_DETAILS' });
    state = appReducer(state, {
      type: 'SET_DRAFT_META',
      surfaceType: 'concrete',
      note: 'Tiny sub-meter patch',
    });
    state = appReducer(state, { type: 'SUBMIT_DRAFT' });
    assert.ok(
      state.pendingIntent && state.pendingIntent.type === 'SUBMIT_DRAFT',
    );

    await assert.rejects(
      () =>
        userClient.createPolygon(
          state.pendingIntent?.type === 'SUBMIT_DRAFT'
            ? state.pendingIntent.payload
            : {
                geometry: { type: 'Polygon', coordinates: [] },
                surfaceType: 'concrete',
              },
        ),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 422);
        assert.equal(err.code, 'AREA_OUT_OF_BOUNDS');
        state = appReducer(state, { type: 'CLEAR_PENDING_INTENT' });
        state = appReducer(state, {
          type: 'SUBMIT_ERROR_PRESERVE_DRAFT',
          message: err.message,
        });
        return true;
      },
    );
    assert.equal(state.mode, 'drawing');
    assert.equal(state.draftNote, 'Tiny sub-meter patch');
    assert.ok(state.draftSubmitError && state.draftSubmitError.length > 0);

    // Create valid polygon by a separate author, test inline CAST_VOTE auth continuation, and run admin CLI commands
    const seedAuthorStorage = createMemorySessionStorage();
    const seedAuthorClient = new PpgisApiClient(baseUrl, seedAuthorStorage);
    await seedAuthorClient.register({
      pseudonym: 'courtyard_seed',
      email: 'courtyard_seed@example.org',
      password: 'seed-author-strong-pass',
      acceptedPrivacyPolicy: true,
    });
    await confirmEmailViaHostedWebPage(
      baseUrl,
      mailer.outbox[mailer.outbox.length - 1]!.actionUrl,
    );
    await seedAuthorClient.login({
      identifier: 'courtyard_seed',
      password: 'seed-author-strong-pass',
    });
    const validPolygon = await seedAuthorClient.createPolygon({
      geometry: {
        type: 'Polygon',
        coordinates: [[...COURTYARD_VERTICES, COURTYARD_VERTICES[0]!]],
      },
      surfaceType: 'pavers',
      note: 'Contains accidental phone number 555-0199',
    });
    const anonValidPolygon = await staleClient
      .getPolygon(validPolygon.id)
      .catch(() => ({
        ...validPolygon,
        properties: { ...validPolygon.properties, isAuthor: false },
      }));

    let anonState = appReducer(initialAppState, {
      type: 'CONFIG_LOADED',
      config: await userClient.getConfig(),
    });
    anonState = appReducer(anonState, {
      type: 'VIEWPORT_FEATURES_LOADED',
      features: [
        {
          ...anonValidPolygon,
          properties: { ...anonValidPolygon.properties, isAuthor: false },
        },
      ],
      truncated: false,
    });
    anonState = appReducer(anonState, {
      type: 'CAST_VOTE',
      polygonId: validPolygon.id,
      value: 1,
    });
    assert.equal(anonState.authModalOpen, true);
    assert.equal(anonState.authModalView, 'login');

    anonState = appReducer(anonState, {
      type: 'AUTH_SUCCEEDED',
      user: relogin.user,
    });
    assert.equal(anonState.authModalOpen, false);
    assert.equal(anonState.pendingIntent?.type, 'CAST_VOTE');
    const continuedVote = await userClient.putVote(validPolygon.id, 1);
    anonState = appReducer(anonState, {
      type: 'VOTE_UPDATED',
      vote: continuedVote,
    });
    assert.equal(anonState.pendingIntent, null);
    assert.equal(anonState.features[0]?.properties.score, 1);

    const redactRes = await app.runAdminCommand([
      'redact-note',
      validPolygon.id,
    ]);
    assert.equal(redactRes.redactedNote, true);
    const afterRedact = await userClient.getPolygon(validPolygon.id);
    assert.equal(afterRedact.properties.note, null);

    await app.runAdminCommand(['ban-user', 'brigade_bot', 'automated spam']);
    await assert.rejects(
      () =>
        userClient.register({
          pseudonym: 'Brigade_Bot',
          email: 'brigade@example.org',
          password: 'valid-password-1234',
          acceptedPrivacyPolicy: true,
        }),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, 'FORBIDDEN_PSEUDONYM_BANNED');
        return true;
      },
    );
  });

  it('enforces Carbon anti-spam & civic moderation end-to-end: ALTCHA signup + email hardening, overlap auto-clipping & blocking, jurisdiction, creator/login metadata, community flagging, map filters, and 14-day unrated pruning', async () => {
    const newcomerStorage = createMemorySessionStorage();
    const newcomerClient = new PpgisApiClient(baseUrl, newcomerStorage);

    const cfg = await newcomerClient.getConfig();
    assert.equal(cfg.authCaptchaRequired, true);
    assert.equal(cfg.limits.maxAreaM2, 20_000);

    // Disposable email blocked on registration
    await assert.rejects(
      () =>
        newcomerClient.register({
          pseudonym: 'throwaway_mapper',
          email: 'throwaway@mailinator.com',
          password: 'strong-password-1234',
          acceptedPrivacyPolicy: true,
        }),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 422);
        assert.equal(err.code, 'AUTH_DISPOSABLE_EMAIL');
        return true;
      },
    );

    // Proactive ALTCHA PoW challenge solved automatically by PpgisApiClient.register
    await newcomerClient.register({
      pseudonym: 'newcomer_hh',
      email: 'newcomer.hh@gmail.com',
      password: 'strong-password-1234',
      acceptedPrivacyPolicy: true,
    });

    // Canonical email normalization blocks Gmail dot/+tag alias duplicate
    await assert.rejects(
      () =>
        newcomerClient.register({
          pseudonym: 'newcomer_alias',
          email: 'newcomerhh+sockpuppet@googlemail.com',
          password: 'strong-password-1234',
          acceptedPrivacyPolicy: true,
        }),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 409);
        assert.equal(err.code, 'AUTH_EMAIL_TAKEN');
        return true;
      },
    );

    await confirmEmailViaHostedWebPage(
      baseUrl,
      mailer.outbox[mailer.outbox.length - 1]!.actionUrl,
    );
    await newcomerClient.login({
      identifier: 'newcomer_hh',
      password: 'strong-password-1234',
    });

    // Polygon outside seeded jurisdictions (e.g. North Sea) rejected with 422 OUTSIDE_JURISDICTION
    await assert.rejects(
      () =>
        newcomerClient.createPolygon({
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [7.5, 54.2],
                [7.5002, 54.2],
                [7.5002, 54.20015],
                [7.5, 54.20015],
                [7.5, 54.2],
              ],
            ],
          },
          surfaceType: 'asphalt',
        }),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 422);
        assert.equal(err.code, 'OUTSIDE_JURISDICTION');
        return true;
      },
    );

    // New contributor creates valid courtyard polygon -> marked authorIsNewUser=true with last login & entry date
    const basePoly = await newcomerClient.createPolygon({
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [9.994, 53.552],
            [9.9944, 53.552],
            [9.9944, 53.55225],
            [9.994, 53.55225],
            [9.994, 53.552],
          ],
        ],
      },
      surfaceType: 'asphalt',
      note: 'Wide sealed yard',
    });
    assert.equal(basePoly.properties.authorPseudonym, 'newcomer_hh');
    assert.equal(basePoly.properties.authorIsNewUser, true);
    assert.ok(basePoly.properties.authorLastLoginAt);

    const metaDe = deriveInspectorOverviewMeta(basePoly, 'de');
    assert.equal(metaDe.displayAuthorHandle, 'newcomer_hh');
    assert.equal(metaDe.authorIsNewUser, true);
    assert.ok(metaDe.newContributorBadgeText);
    assert.equal(metaDe.needsReviewBadgeText, null);
    assert.ok(metaDe.entryDateText && metaDe.entryDateText.length >= 8);
    assert.notEqual(metaDe.authorLastLoginText, 'Unbekannt');

    // Public GeoJSON export redacts authorLastLoginAt to null
    const exportRes = await fetch(newcomerClient.getExportGeoJsonUrl());
    const exported = parseStreamedGeoJson(await exportRes.text());
    const exportedPoly = exported.features.find((f) => f.id === basePoly.id);
    assert.ok(exportedPoly);
    assert.equal(exportedPoly.properties.authorLastLoginAt, null);

    // >= 50% overlap is blocked (409 POLYGON_OVERLAP)
    await assert.rejects(
      () =>
        newcomerClient.createPolygon({
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [9.99405, 53.552],
                [9.99445, 53.552],
                [9.99445, 53.55225],
                [9.99405, 53.55225],
                [9.99405, 53.552],
              ],
            ],
          },
          surfaceType: 'concrete',
        }),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 409);
        assert.equal(err.code, 'POLYGON_OVERLAP');
        return true;
      },
    );

    // < 50% overlap (~25%) is auto-clipped via ST_Difference
    const unclippedPoly = await newcomerClient.createPolygon({
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [9.9943, 53.552],
            [9.9947, 53.552],
            [9.9947, 53.55225],
            [9.9943, 53.55225],
            [9.9943, 53.552],
          ],
        ],
      },
      surfaceType: 'pavers',
      note: 'Adjacent strip with minor overlap',
    });
    assert.ok(unclippedPoly.properties.areaM2 < basePoly.properties.areaM2 * 0.9);

    // Self-flagging own polygon is rejected (422 FORBIDDEN_SELF_FLAG)
    await assert.rejects(
      () => newcomerClient.flagPolygon(basePoly.id, { reason: 'spam' }),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 422);
        assert.equal(err.code, 'FORBIDDEN_SELF_FLAG');
        return true;
      },
    );

    // Second user + admin user register to test flagging, filtering, score=0 vs zero-ratings, and 14-day pruning
    const reviewerClient = new PpgisApiClient(
      baseUrl,
      createMemorySessionStorage(),
    );
    await reviewerClient.register({
      pseudonym: 'civic_reviewer',
      email: 'reviewer@example.org',
      password: 'reviewer-password-1234',
      acceptedPrivacyPolicy: true,
    });
    await confirmEmailViaHostedWebPage(
      baseUrl,
      mailer.outbox[mailer.outbox.length - 1]!.actionUrl,
    );
    await reviewerClient.login({
      identifier: 'civic_reviewer',
      password: 'reviewer-password-1234',
    });

    const flagRes = await reviewerClient.flagPolygon(basePoly.id, {
      reason: 'implausible',
      note: 'Looks like roof area',
    });
    assert.equal(flagRes.flagCount, 1);
    assert.equal(flagRes.isFlagged, true);
    assert.equal(flagRes.myFlag, true);

    // Filter: single-choice 'new' (past 7 days) returns BOTH basePoly and unclippedPoly, while 'established' (>7 days) is empty
    const filteredNew = await reviewerClient.listPolygons(HAMBURG_BBOX, {
      filter: 'new',
    });
    assert.equal(filteredNew.features.length, 2);
    assert.deepEqual(
      new Set(filteredNew.features.map((f) => f.id)),
      new Set([basePoly.id, unclippedPoly.id]),
    );

    const establishedBeforeAging = await reviewerClient.listPolygons(
      HAMBURG_BBOX,
      { filter: 'established' },
    );
    assert.equal(establishedBeforeAging.features.length, 0);

    // Filter: single-choice 'needs_review' (score = 0 AND no ratings) initially includes both unrated proposals
    const initialNeedsReview = await reviewerClient.listPolygons(
      HAMBURG_BBOX,
      { filter: 'needs_review' },
    );
    assert.equal(initialNeedsReview.features.length, 2);

    // Once basePoly receives +1 and -1 from two non-author voters (net score = 0, total ratings = 2), it has ratings so it leaves 'needs_review' immediately
    const supporterClient = new PpgisApiClient(
      baseUrl,
      createMemorySessionStorage(),
    );
    await supporterClient.register({
      pseudonym: 'civic_supporter',
      email: 'supporter@example.org',
      password: 'supporter-password-1234',
      acceptedPrivacyPolicy: true,
    });
    await confirmEmailViaHostedWebPage(
      baseUrl,
      mailer.outbox[mailer.outbox.length - 1]!.actionUrl,
    );
    await supporterClient.login({
      identifier: 'civic_supporter',
      password: 'supporter-password-1234',
    });

    await supporterClient.putVote(basePoly.id, 1);
    await reviewerClient.putVote(basePoly.id, -1);
    const ratedZeroNet = await reviewerClient.getPolygon(basePoly.id);
    assert.equal(ratedZeroNet.properties.score, 0);
    assert.equal(ratedZeroNet.properties.upvotes, 1);
    assert.equal(ratedZeroNet.properties.downvotes, 1);

    const afterVotesNeedsReview = await reviewerClient.listPolygons(
      HAMBURG_BBOX,
      { filter: 'needs_review' },
    );
    assert.deepEqual(
      afterVotesNeedsReview.features.map((f) => f.id),
      [unclippedPoly.id],
    );

    // Promote reviewer to admin -> clear flags on basePoly
    await app.runAdminCommand(['grant-admin', 'civic_reviewer']);
    const cleared = await reviewerClient.clearPolygonFlags(basePoly.id);
    assert.equal(cleared.flagCount, 0);
    assert.equal(cleared.isFlagged, false);

    // Backdate BOTH polygons to 15 days ago (> 7 days -> 'established', 0 in 'new')
    // and verify prune-stale-polygons deletes unclippedPoly (0 ratings) while keeping basePoly (2 ratings, net score 0)
    await pool.query(
      `UPDATE polygons SET created_at = NOW() - INTERVAL '15 days' WHERE id = ANY($1::uuid[])`,
      [[basePoly.id, unclippedPoly.id]],
    );
    const establishedAfterAging = await reviewerClient.listPolygons(
      HAMBURG_BBOX,
      { filter: 'established' },
    );
    assert.equal(establishedAfterAging.features.length, 2);
    const newAfterAging = await reviewerClient.listPolygons(HAMBURG_BBOX, {
      filter: 'new',
    });
    assert.equal(newAfterAging.features.length, 0);
    const pruneRes = await app.runAdminCommand(['prune-stale-polygons']);
    assert.equal(pruneRes.deletedPolygonCount, 1);
    assert.deepEqual(pruneRes.prunedPolygonIds, [unclippedPoly.id]);

    const remaining = await reviewerClient.listPolygons(HAMBURG_BBOX);
    assert.equal(remaining.features.length, 1);
    assert.equal(remaining.features[0]?.id, basePoly.id);
  });
});
