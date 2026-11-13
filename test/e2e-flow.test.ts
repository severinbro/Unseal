import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

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
  deriveMapControlsModel,
} from '@entsiegelung/mobile/viewModels';

import { buildApp } from '../apps/api/src/app.js';
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

const COURTYARD_VERTICES: [number, number][] = [
  [9.9937, 53.5511],
  [9.99385, 53.5511],
  [9.99385, 53.551208],
  [9.9937, 53.551208],
];

const RECOVERY_CODE_FORMAT_RE = /^[0-9A-F]{4}(?:-[0-9A-F]{4}){7}$/;

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

describe('Full-stack HTTP E2E flow (PpgisApiClient + appReducer + Fastify + PostGIS)', () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let baseUrl = '';

  before(async () => {
    pool = await setupTestDb();
    const config = loadEnvConfig({
      ...process.env,
      HOST: '127.0.0.1',
      PORT: '0',
      ABUSE_CONTACT: 'moderation@entsiegelung.example.org',
      ORTHOPHOTO_URL_TEMPLATE:
        'https://ortho.entsiegelung.example.org/dop/{z}/{x}/{y}.jpg',
      ORTHOPHOTO_TILE_SIZE: '256',
      ORTHOPHOTO_ATTRIBUTION: '© Municipal Aerial Survey',
      ORTHOPHOTO_BOUNDS: '9.70,53.35,10.35,53.75',
      ORTHOPHOTO_MAX_ZOOM: '20',
    });
    app = await buildApp(config, pool, {
      logger: createLogger({ level: 'silent' }),
    });
    baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  });

  beforeEach(async () => {
    await resetTestDb(pool);
  });

  after(async () => {
    if (app) {
      await app.close();
    }
    if (pool) {
      await pool.end();
    }
  });

  it('completes anonymous config & viewport read, inline signup + asphalt polygon submit, +1/-1 voting & voter deletion, author PATCH & streamed export, and author tombstoned deletion', async () => {
    // 0. Live health check over HTTP
    const healthRes = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(healthRes.status, 200);
    assert.ok(healthRes.headers.get('x-request-id'));
    const healthBody = HealthResponseSchema.parse(await healthRes.json());
    assert.equal(healthBody.status, 'ok');
    assert.ok(healthBody.migrationsApplied >= 1);

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
    assert.equal(initialControls.showFirstVisitDisclaimer, true);
    assert.equal(initialControls.showOrthophotoToggle, true);
    assert.equal(initialControls.isAuthenticated, false);
    assert.equal(initialControls.accountLabel, 'Anmelden');

    const englishControls = deriveMapControlsModel(
      appReducer(state, { type: 'SET_LOCALE', locale: 'en' }),
    );
    assert.equal(englishControls.locale, 'en');
    assert.equal(englishControls.accountLabel, 'Sign in');

    // Verify raw anonymous HTTP headers on GET /api/v1/polygons?bbox=...
    const rawAnonBboxRes = await fetch(
      `${baseUrl}/api/v1/polygons?bbox=${HAMBURG_BBOX.minLng},${HAMBURG_BBOX.minLat},${HAMBURG_BBOX.maxLng},${HAMBURG_BBOX.maxLat}`,
    );
    assert.equal(rawAnonBboxRes.status, 200);
    const varyHeader = rawAnonBboxRes.headers.get('vary') ?? '';
    assert.match(varyHeader, /Authorization/i);
    assert.equal(
      rawAnonBboxRes.headers.get('cache-control'),
      'public, max-age=5',
    );

    // Wide viewport gates fetching via spanTooWide (> 0.15 deg)
    state = appReducer(state, {
      type: 'SET_VIEWPORT',
      bbox: { minLng: 9.8, minLat: 53.4, maxLng: 10.1, maxLat: 53.6 },
      zoom: 10,
    });
    assert.equal(state.spanTooWide, true);
    assert.equal(deriveMapControlsModel(state).showZoomInPrompt, true);

    // Zoom into district (<= 0.15 deg) and fetch initial empty feature collection
    state = appReducer(state, {
      type: 'SET_VIEWPORT',
      bbox: HAMBURG_BBOX,
      zoom: 16,
    });
    assert.equal(state.spanTooWide, false);

    const emptyCollection = await anonClient.listPolygons(HAMBURG_BBOX);
    assert.equal(emptyCollection.features.length, 0);
    assert.equal(emptyCollection.meta.truncated, false);
    state = appReducer(state, {
      type: 'VIEWPORT_FEATURES_LOADED',
      features: emptyCollection.features,
      truncated: emptyCollection.meta.truncated,
    });

    // 2. Anonymous draft creation + inline signup (32-hex recovery code) + asphalt polygon submission
    state = appReducer(state, { type: 'START_DRAW' });
    for (const vertex of COURTYARD_VERTICES) {
      state = appReducer(state, { type: 'ADD_VERTEX', point: vertex });
    }
    // Tap duplicate last vertex within 1e-7 deg to verify client deduplication
    state = appReducer(state, {
      type: 'ADD_VERTEX',
      point: [9.99370002, 53.55120802],
    });

    let toolbar = deriveDrawingToolbarModel(state);
    assert.equal(toolbar.distinctVertexCount, 4);
    assert.ok(toolbar.areaM2 >= 2 && toolbar.areaM2 <= 500_000);
    assert.equal(toolbar.canCloseRing, true);
    assert.equal(toolbar.canSubmit, false);

    state = appReducer(state, { type: 'CLOSE_RING' });
    state = appReducer(state, {
      type: 'SET_DRAFT_META',
      surfaceType: 'asphalt',
      note: 'Impervious asphalt parking strip next to schoolyard',
    });

    toolbar = deriveDrawingToolbarModel(state);
    assert.equal(toolbar.isRingClosed, true);
    assert.equal(toolbar.surfaceType, 'asphalt');
    assert.equal(toolbar.canSubmit, true);

    // Tapping Submit while unauthenticated preserves draft & opens inline registration modal
    state = appReducer(state, { type: 'SUBMIT_DRAFT' });
    assert.equal(state.authModalOpen, true);
    assert.equal(state.authModalView, 'register');
    assert.equal(state.pendingIntent?.type, 'SUBMIT_DRAFT');
    assert.equal(state.draftVertices.length, 5);

    const authorStorage = createMemorySessionStorage();
    const authorClient = new PpgisApiClient(baseUrl, authorStorage);
    const regAuthor = await authorClient.register({
      pseudonym: 'courtyard_author',
      password: 'correct-horse-battery-staple',
    });

    assert.equal(regAuthor.user.pseudonym, 'courtyard_author');
    assert.match(regAuthor.recoveryCode, RECOVERY_CODE_FORMAT_RE);
    assert.equal(regAuthor.recoveryCode.replace(/-/g, '').length, 32);

    state = appReducer(state, {
      type: 'AUTH_SUCCEEDED',
      user: regAuthor.user,
      recoveryCode: regAuthor.recoveryCode,
    });

    // Post-signup modal cannot close before confirming recovery code saved
    let authModal = deriveAuthModalModel(state);
    assert.equal(authModal.visible, true);
    assert.equal(authModal.isPostSignupRecoveryDisplay, true);
    assert.equal(authModal.canClose, false);

    state = appReducer(state, { type: 'CLOSE_AUTH_MODAL' });
    assert.equal(state.authModalOpen, true);

    // Confirm saving 32-hex recovery code and close modal
    state = appReducer(state, {
      type: 'SET_RECOVERY_CODE_SAVED_CHECKED',
      checked: true,
    });
    authModal = deriveAuthModalModel(state);
    assert.equal(authModal.canClose, true);

    state = appReducer(state, { type: 'CLOSE_AUTH_MODAL' });
    assert.equal(state.authModalOpen, false);
    assert.equal(state.pendingRecoveryCode, null);
    assert.equal(state.pendingIntent?.type, 'SUBMIT_DRAFT');

    // Resume queued pendingIntent over real HTTP
    assert.ok(state.pendingIntent && state.pendingIntent.type === 'SUBMIT_DRAFT');
    const createdPolygon = await authorClient.createPolygon(
      state.pendingIntent.payload,
    );
    state = appReducer(state, {
      type: 'POLYGON_CREATED',
      feature: createdPolygon,
    });

    assert.equal(state.mode, 'browse');
    assert.equal(state.pendingIntent, null);
    assert.equal(createdPolygon.properties.surfaceType, 'asphalt');
    assert.equal(
      createdPolygon.properties.note,
      'Impervious asphalt parking strip next to schoolyard',
    );
    assert.equal(createdPolygon.properties.authorPseudonym, 'courtyard_author');
    assert.equal(createdPolygon.properties.isAuthor, true);
    assert.equal(createdPolygon.properties.myVote, 0);
    assert.equal(createdPolygon.properties.score, 0);

    // Authenticated viewport read sets Vary: Authorization + Cache-Control: no-store
    const authorToken = await authorStorage.getToken();
    assert.ok(authorToken);
    const rawAuthBboxRes = await fetch(
      `${baseUrl}/api/v1/polygons?bbox=${HAMBURG_BBOX.minLng},${HAMBURG_BBOX.minLat},${HAMBURG_BBOX.maxLng},${HAMBURG_BBOX.maxLat}`,
      {
        headers: {
          Authorization: `Bearer ${authorToken}`,
        },
      },
    );
    assert.equal(rawAuthBboxRes.status, 200);
    assert.match(rawAuthBboxRes.headers.get('vary') ?? '', /Authorization/i);
    assert.equal(rawAuthBboxRes.headers.get('cache-control'), 'no-store');

    const polygonId = createdPolygon.id;

    // 3. Second user registers, casts +1, flips to -1, then deletes their account
    const voterStorage = createMemorySessionStorage();
    const voterClient = new PpgisApiClient(baseUrl, voterStorage);
    const regVoter = await voterClient.register({
      pseudonym: 'district_voter',
      password: 'second-user-strong-pass',
    });
    assert.match(regVoter.recoveryCode, RECOVERY_CODE_FORMAT_RE);

    const upvoteRes = await voterClient.putVote(polygonId, 1);
    assert.deepEqual(upvoteRes, {
      polygonId,
      upvotes: 1,
      downvotes: 0,
      score: 1,
      myVote: 1,
    });
    state = appReducer(state, { type: 'VOTE_UPDATED', vote: upvoteRes });
    assert.equal(state.features[0]?.properties.score, 1);

    const flipDownvoteRes = await voterClient.putVote(polygonId, -1);
    assert.deepEqual(flipDownvoteRes, {
      polygonId,
      upvotes: 0,
      downvotes: 1,
      score: -1,
      myVote: -1,
    });
    state = appReducer(state, { type: 'VOTE_UPDATED', vote: flipDownvoteRes });
    assert.equal(state.features[0]?.properties.score, -1);

    // Voter self-deletes account -> score recomputes back to 0 and pseudonym is tombstoned
    await voterClient.deleteMe();

    const afterVoterDeleted = await anonClient.getPolygon(polygonId);
    assert.equal(afterVoterDeleted.properties.upvotes, 0);
    assert.equal(afterVoterDeleted.properties.downvotes, 0);
    assert.equal(afterVoterDeleted.properties.score, 0);
    assert.equal(
      afterVoterDeleted.properties.authorPseudonym,
      'courtyard_author',
    );

    // Self-deleted pseudonym cannot be re-registered (case-insensitively)
    await assert.rejects(
      () =>
        anonClient.register({
          pseudonym: 'District_Voter',
          password: 'impersonation-attempt-pass',
        }),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 409);
        assert.equal(err.code, 'AUTH_PSEUDONYM_TAKEN');
        return true;
      },
    );

    // 4. Original author updates note via PATCH and streams /api/v1/polygons/export.geojson
    const updatedNote =
      'Updated note: courtyard drains directly toward street tree pit';
    const patchedPolygon = await authorClient.patchPolygon(polygonId, {
      note: updatedNote,
    });
    assert.equal(patchedPolygon.properties.note, updatedNote);
    assert.equal(patchedPolygon.properties.surfaceType, 'asphalt');
    assert.equal(patchedPolygon.properties.isAuthor, true);

    state = appReducer(state, {
      type: 'POLYGON_UPDATED',
      feature: patchedPolygon,
    });
    assert.equal(state.features[0]?.properties.note, updatedNote);

    const exportUrl = authorClient.getExportGeoJsonUrl();
    const exportRes = await fetch(exportUrl);
    assert.equal(exportRes.status, 200);
    assert.match(
      exportRes.headers.get('content-type') ?? '',
      /^application\/geo\+json/i,
    );
    assert.match(
      exportRes.headers.get('content-disposition') ?? '',
      /attachment;\s*filename="entsiegelung-proposals\.geojson"/i,
    );

    const exportedCollection = parseStreamedGeoJson(await exportRes.text());
    assert.equal(exportedCollection.features.length, 1);
    const exportedFeature = exportedCollection.features[0]!;
    assert.equal(exportedFeature.id, polygonId);
    assert.equal(exportedFeature.properties.id, polygonId);
    assert.equal(exportedFeature.properties.note, updatedNote);
    assert.equal(exportedFeature.properties.authorPseudonym, 'courtyard_author');
    assert.equal(exportedFeature.properties.myVote, 0);
    assert.equal(exportedFeature.properties.isAuthor, false);

    // 5. Original author deletes their account via DELETE /api/v1/auth/me -> polygon stays public under "deleted"
    await authorClient.deleteMe();
    state = appReducer(state, { type: 'ACCOUNT_DELETED' });
    assert.equal(state.currentUser, null);
    assert.equal(state.features[0]?.properties.authorPseudonym, 'deleted');
    assert.equal(state.features[0]?.properties.isAuthor, false);

    const finalViewport = await anonClient.listPolygons(HAMBURG_BBOX);
    assert.equal(finalViewport.features.length, 1);
    const survivingFeature = finalViewport.features[0]!;
    assert.equal(survivingFeature.id, polygonId);
    assert.equal(survivingFeature.properties.authorPseudonym, 'deleted');
    assert.equal(survivingFeature.properties.surfaceType, 'asphalt');
    assert.equal(survivingFeature.properties.note, updatedNote);
    assert.equal(survivingFeature.properties.score, 0);
    assert.equal(survivingFeature.properties.isAuthor, false);
    assert.equal(survivingFeature.properties.myVote, 0);

    // Author's tombstoned pseudonym also cannot be re-registered
    await assert.rejects(
      () =>
        anonClient.register({
          pseudonym: 'courtyard_author',
          password: 'another-valid-password-123',
        }),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 409);
        assert.equal(err.code, 'AUTH_PSEUDONYM_TAKEN');
        return true;
      },
    );
  });

  it('verifies recovery-code password rotation, draft preservation on 422 geometry rejection, inline vote auth continuation, and admin CLI moderation', async () => {
    const userStorage = createMemorySessionStorage();
    const userClient = new PpgisApiClient(baseUrl, userStorage);

    const reg = await userClient.register({
      pseudonym: 'recovery_tester',
      password: 'initial-password-123',
    });
    const oldToken = reg.sessionToken;

    // Submit lowercase unhyphenated 32-hex recovery code to rotate password + recovery code
    const normalizedLowerCode = reg.recoveryCode.replace(/-/g, '').toLowerCase();
    const recovered = await userClient.recover({
      pseudonym: 'recovery_tester',
      recoveryCode: normalizedLowerCode,
      newPassword: 'rotated-password-456',
    });
    assert.match(recovered.recoveryCode, RECOVERY_CODE_FORMAT_RE);
    assert.notEqual(recovered.recoveryCode, reg.recoveryCode);

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

    // Server 422 (< 2 m2 tiny polygon) preserves client draft vertices & note
    let state: AppState = appReducer(initialAppState, {
      type: 'CONFIG_LOADED',
      config: await userClient.getConfig(),
    });
    state = appReducer(state, {
      type: 'AUTH_SUCCEEDED',
      user: recovered.user,
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
    state = appReducer(state, { type: 'CLOSE_RING' });
    state = appReducer(state, {
      type: 'SET_DRAFT_META',
      surfaceType: 'concrete',
      note: 'Tiny sub-meter patch',
    });
    state = appReducer(state, { type: 'SUBMIT_DRAFT' });
    assert.ok(state.pendingIntent && state.pendingIntent.type === 'SUBMIT_DRAFT');

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
    assert.equal(state.draftVertices.length, 3);
    assert.equal(state.draftNote, 'Tiny sub-meter patch');
    assert.ok(state.draftSubmitError && state.draftSubmitError.length > 0);

    // Create valid polygon and redact note via admin CLI + preemptively ban abusive handle
    const validPolygon = await userClient.createPolygon({
      geometry: {
        type: 'Polygon',
        coordinates: [[...COURTYARD_VERTICES, COURTYARD_VERTICES[0]!]],
      },
      surfaceType: 'pavers',
      note: 'Contains accidental phone number 555-0199',
    });

    // Anonymous CAST_VOTE intent continuation after login
    let anonState = appReducer(initialAppState, {
      type: 'CONFIG_LOADED',
      config: await userClient.getConfig(),
    });
    anonState = appReducer(anonState, {
      type: 'VIEWPORT_FEATURES_LOADED',
      features: [validPolygon],
      truncated: false,
    });
    anonState = appReducer(anonState, {
      type: 'CAST_VOTE',
      polygonId: validPolygon.id,
      value: 1,
    });
    assert.equal(anonState.authModalOpen, true);
    assert.equal(anonState.authModalView, 'login');

    const relogin = await userClient.login({
      pseudonym: 'recovery_tester',
      password: 'rotated-password-456',
    });
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
    assert.equal(afterRedact.properties.score, 1);

    await app.runAdminCommand(['ban-user', 'brigade_bot', 'automated spam']);
    await assert.rejects(
      () =>
        userClient.register({
          pseudonym: 'Brigade_Bot',
          password: 'valid-password-1234',
        }),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, 'FORBIDDEN_PSEUDONYM_BANNED');
        return true;
      },
    );
  });
});
