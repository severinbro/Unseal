import assert from 'node:assert/strict';
import http from 'node:http';
import { describe, it } from 'node:test';

import {
  ApiError,
  type AuthUser,
  type PolygonCollectionResponse,
  type PolygonFeature,
  type RegisterResponse,
  type RuntimeConfig,
  type SessionResponse,
  type VoteResponse,
} from '@entsiegelung/shared';

import { PpgisApiClient } from '../src/api/client';
import {
  appReducer,
  initialAppState,
  type AppState,
} from '../src/state/appState';
import {
  deriveAuthModalModel,
  deriveDrawingToolbarModel,
  deriveMapControlsModel,
} from '../src/state/viewModels';
import {
  createWebSessionStorage,
  platformSessionStorage,
  type WebStorageLike,
} from '../src/storage/secureStorage.web';
import {
  createMemorySessionStorage,
  SESSION_TOKEN_KEY,
} from '../src/storage/tokenStorage';

const SAMPLE_CONFIG_NO_ORTHO: RuntimeConfig = {
  osmStyleUrl: 'https://tiles.openfreemap.org/styles/liberty',
  orthophoto: null,
  initialView: {
    lng: 9.9937,
    lat: 53.5511,
    zoom: 15,
  },
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
    'Community unsealing suggestions — non-binding public input, regardless of property ownership.',
  abuseContact: 'moderation@example.org',
};

const SAMPLE_CONFIG_WITH_ORTHO: RuntimeConfig = {
  ...SAMPLE_CONFIG_NO_ORTHO,
  orthophoto: {
    urlTemplate: 'https://ortho.example.org/tiles/{z}/{x}/{y}.png',
    tileSize: 256,
    attribution: '© Municipal Geodata',
    bounds: [9.7, 53.35, 10.35, 53.75],
    maxZoom: 20,
  },
};

const SAMPLE_USER: AuthUser = {
  id: '11111111-1111-4111-8111-111111111111',
  pseudonym: 'courtyard_mapper',
  createdAt: '2026-11-12T10:00:00.000Z',
};

const COURTYARD_VERTICES: [number, number][] = [
  [9.9935, 53.551],
  [9.9937, 53.551],
  [9.9937, 53.55115],
  [9.9935, 53.55115],
];

const SAMPLE_POLYGON_ID = '22222222-2222-4222-8222-222222222222';

function makePolygonFeature(overrides?: Partial<PolygonFeature['properties']> & { id?: string }): PolygonFeature {
  const id = overrides?.id ?? SAMPLE_POLYGON_ID;
  return {
    type: 'Feature',
    id,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [9.9935, 53.551],
          [9.9937, 53.551],
          [9.9937, 53.55115],
          [9.9935, 53.55115],
          [9.9935, 53.551],
        ],
      ],
    },
    properties: {
      id,
      surfaceType: overrides?.surfaceType ?? 'asphalt',
      note: overrides?.note !== undefined ? overrides.note : 'Unused corner parking area',
      areaM2: overrides?.areaM2 ?? 220.4,
      authorPseudonym: overrides?.authorPseudonym ?? SAMPLE_USER.pseudonym,
      upvotes: overrides?.upvotes ?? 3,
      downvotes: overrides?.downvotes ?? 1,
      score: overrides?.score ?? 2,
      myVote: overrides?.myVote ?? 0,
      isAuthor: overrides?.isAuthor ?? true,
      createdAt: overrides?.createdAt ?? '2026-11-12T10:05:00.000Z',
      updatedAt: overrides?.updatedAt ?? '2026-11-12T10:05:00.000Z',
    },
  };
}

describe('tokenStorage and secureStorage.web', () => {
  it('stores, overwrites, and clears session tokens in memory', async () => {
    assert.equal(SESSION_TOKEN_KEY, 'entsiegelung.session_token');
    const mem = createMemorySessionStorage();
    assert.equal(await mem.getToken(), null);

    await mem.setToken('tok_alpha');
    assert.equal(await mem.getToken(), 'tok_alpha');

    await mem.setToken('tok_beta');
    assert.equal(await mem.getToken(), 'tok_beta');

    await mem.clearToken();
    assert.equal(await mem.getToken(), null);
  });

  it('persists tokens via Web localStorage under SESSION_TOKEN_KEY and survives reload', async () => {
    const backingMap = new Map<string, string>();
    const fakeLocalStorage: WebStorageLike = {
      getItem(key) {
        return backingMap.get(key) ?? null;
      },
      setItem(key, value) {
        backingMap.set(key, value);
      },
      removeItem(key) {
        backingMap.delete(key);
      },
    };

    const tabOne = createWebSessionStorage(() => fakeLocalStorage);
    await tabOne.setToken('persisted_token_123');
    assert.equal(backingMap.get(SESSION_TOKEN_KEY), 'persisted_token_123');

    const reloadedTab = createWebSessionStorage(() => fakeLocalStorage);
    assert.equal(await reloadedTab.getToken(), 'persisted_token_123');

    await reloadedTab.clearToken();
    assert.equal(backingMap.has(SESSION_TOKEN_KEY), false);
    assert.equal(await tabOne.getToken(), null);
  });

  it('falls back to in-memory storage when window.localStorage is absent or throws SecurityError / QuotaExceededError', async () => {
    // Node runtime has no window.localStorage by default
    await platformSessionStorage.clearToken();
    assert.equal(await platformSessionStorage.getToken(), null);
    await platformSessionStorage.setToken('node_fallback_token');
    assert.equal(await platformSessionStorage.getToken(), 'node_fallback_token');
    await platformSessionStorage.clearToken();
    assert.equal(await platformSessionStorage.getToken(), null);

    // Getter throwing SecurityError
    const getterThrows = createWebSessionStorage(() => {
      throw new Error('SecurityError: The operation is insecure.');
    });
    await getterThrows.setToken('sec_fallback_tok');
    assert.equal(await getterThrows.getToken(), 'sec_fallback_tok');
    await getterThrows.clearToken();
    assert.equal(await getterThrows.getToken(), null);

    // setItem throwing QuotaExceededError while getItem returns null
    const quotaBrokenStorage: WebStorageLike = {
      getItem() {
        return null;
      },
      setItem() {
        throw new Error('QuotaExceededError');
      },
      removeItem() {
        throw new Error('SecurityError');
      },
    };
    const quotaAdapter = createWebSessionStorage(() => quotaBrokenStorage);
    await quotaAdapter.setToken('quota_survivor');
    assert.equal(await quotaAdapter.getToken(), 'quota_survivor');
    await quotaAdapter.clearToken();
    assert.equal(await quotaAdapter.getToken(), null);
  });
});

describe('PpgisApiClient against live HTTP server', () => {
  it('executes all /api/v1 endpoints, manages bearer tokens, omits Content-Type on empty bodies, and parses ApiError + Zod schemas', async () => {
    interface CapturedRequest {
      method: string;
      url: string;
      authorization: string | undefined;
      contentType: string | undefined;
      body: string;
    }

    const captured: CapturedRequest[] = [];
    let nextConfigMode: 'valid' | 'invalid_schema' = 'valid';

    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        const method = req.method ?? 'GET';
        const url = req.url ?? '/';
        captured.push({
          method,
          url,
          authorization: req.headers['authorization'],
          contentType: req.headers['content-type'],
          body: rawBody,
        });

        res.setHeader('x-request-id', 'req-test-1');

        if (method === 'GET' && url === '/api/v1/config') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          if (nextConfigMode === 'invalid_schema') {
            res.end(JSON.stringify({ osmStyleUrl: 'not-a-valid-url' }));
            return;
          }
          res.end(JSON.stringify(SAMPLE_CONFIG_WITH_ORTHO));
          return;
        }

        if (method === 'POST' && url === '/api/v1/auth/register') {
          const payload: RegisterResponse = {
            user: SAMPLE_USER,
            sessionToken: 'sess_registered_1',
            expiresAt: '2026-12-12T10:00:00.000Z',
            recoveryCode: 'ABCD-1234-EF56-7890-ABCD-1234-EF56-7890',
          };
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(payload));
          return;
        }

        if (method === 'POST' && url === '/api/v1/auth/login') {
          const parsed = JSON.parse(rawBody) as { password?: string };
          if (parsed.password === 'wrongpassword') {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                error: {
                  code: 'AUTH_INVALID_CREDENTIALS',
                  message: 'Invalid pseudonym or password.',
                  requestId: 'req-login-fail',
                },
              }),
            );
            return;
          }
          const payload: SessionResponse = {
            user: SAMPLE_USER,
            sessionToken: 'sess_logged_in_2',
            expiresAt: '2026-12-12T10:00:00.000Z',
          };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(payload));
          return;
        }

        if (method === 'POST' && url === '/api/v1/auth/recover') {
          const payload: RegisterResponse = {
            user: SAMPLE_USER,
            sessionToken: 'sess_recovered_3',
            expiresAt: '2026-12-12T10:00:00.000Z',
            recoveryCode: '9999-8888-7777-6666-5555-4444-3333-2222',
          };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(payload));
          return;
        }

        if (method === 'GET' && url === '/api/v1/auth/me') {
          if (!req.headers['authorization']) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                error: {
                  code: 'AUTH_REQUIRED',
                  message: 'Missing session token.',
                  requestId: 'req-me-401',
                },
              }),
            );
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(SAMPLE_USER));
          return;
        }

        if (method === 'POST' && url === '/api/v1/auth/logout') {
          if (req.headers['content-type']?.includes('application/json') && rawBody.length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                error: {
                  code: 'VALIDATION_ERROR',
                  message: 'Body cannot be empty when content-type is application/json',
                  requestId: 'req-empty-json',
                },
              }),
            );
            return;
          }
          res.writeHead(204);
          res.end();
          return;
        }

        if (method === 'DELETE' && url === '/api/v1/auth/me') {
          if (req.headers['content-type']?.includes('application/json') && rawBody.length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                error: {
                  code: 'VALIDATION_ERROR',
                  message: 'Body cannot be empty when content-type is application/json',
                  requestId: 'req-empty-json',
                },
              }),
            );
            return;
          }
          res.writeHead(204);
          res.end();
          return;
        }

        if (method === 'GET' && url.startsWith('/api/v1/polygons?')) {
          const rawFeature = makePolygonFeature();
          const futureSurfaceFeature = {
            ...rawFeature,
            properties: {
              ...rawFeature.properties,
              surfaceType: 'cobblestone_v2',
              myVote: req.headers['authorization'] ? 1 : 0,
            },
          };
          const collection = {
            type: 'FeatureCollection',
            features: [futureSurfaceFeature],
            meta: {
              truncated: false,
              limit: 500,
            },
          };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(collection));
          return;
        }

        if (method === 'GET' && url === `/api/v1/polygons/${SAMPLE_POLYGON_ID}`) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(makePolygonFeature()));
          return;
        }

        if (method === 'POST' && url === '/api/v1/polygons') {
          const parsed = JSON.parse(rawBody) as { note?: string };
          if (parsed.note === 'trigger_self_intersection') {
            res.writeHead(422, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                error: {
                  code: 'GEOMETRY_INVALID',
                  message: 'Self-intersection',
                  details: { location: [9.9936, 53.5511] },
                  requestId: 'req-geom-422',
                },
              }),
            );
            return;
          }
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(makePolygonFeature({ note: parsed.note ?? null })));
          return;
        }

        if (method === 'PATCH' && url === `/api/v1/polygons/${SAMPLE_POLYGON_ID}`) {
          const parsed = JSON.parse(rawBody) as { note?: string | null; surfaceType?: 'pavers' };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify(
              makePolygonFeature({
                surfaceType: parsed.surfaceType ?? 'asphalt',
                note: parsed.note ?? null,
              }),
            ),
          );
          return;
        }

        if (method === 'DELETE' && url === `/api/v1/polygons/${SAMPLE_POLYGON_ID}`) {
          if (req.headers['content-type']?.includes('application/json') && rawBody.length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'Empty JSON body', requestId: 'r' } }));
            return;
          }
          res.writeHead(204);
          res.end();
          return;
        }

        if (method === 'PUT' && url === `/api/v1/polygons/${SAMPLE_POLYGON_ID}/vote`) {
          const parsed = JSON.parse(rawBody) as { value: 1 | -1 };
          const voteRes: VoteResponse = {
            polygonId: SAMPLE_POLYGON_ID,
            upvotes: parsed.value === 1 ? 4 : 3,
            downvotes: parsed.value === -1 ? 2 : 1,
            score: parsed.value === 1 ? 3 : 1,
            myVote: parsed.value,
          };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(voteRes));
          return;
        }

        if (method === 'DELETE' && url === `/api/v1/polygons/${SAMPLE_POLYGON_ID}/vote`) {
          if (req.headers['content-type']?.includes('application/json') && rawBody.length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'Empty JSON body', requestId: 'r' } }));
            return;
          }
          const voteRes: VoteResponse = {
            polygonId: SAMPLE_POLYGON_ID,
            upvotes: 3,
            downvotes: 1,
            score: 2,
            myVote: 0,
          };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(voteRes));
          return;
        }

        res.writeHead(502, { 'Content-Type': 'text/html' });
        res.end('<html>Bad Gateway</html>');
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    try {
      const addr = server.address();
      assert.ok(addr && typeof addr === 'object');
      const baseUrl = `http://127.0.0.1:${addr.port}/`;
      const storage = createMemorySessionStorage();
      const client = new PpgisApiClient(baseUrl, storage);

      assert.equal(
        client.getExportGeoJsonUrl(),
        `http://127.0.0.1:${addr.port}/api/v1/polygons/export.geojson`,
      );

      const cfg = await client.getConfig();
      assert.deepEqual(cfg, SAMPLE_CONFIG_WITH_ORTHO);

      // Anonymous listPolygons omits Authorization header and coerces unknown surfaceType -> 'other'
      const anonList: PolygonCollectionResponse = await client.listPolygons({
        minLng: 9.98,
        minLat: 53.54,
        maxLng: 10.01,
        maxLat: 53.56,
      });
      assert.equal(anonList.features.length, 1);
      assert.equal(anonList.features[0]?.properties.surfaceType, 'other');
      assert.equal(anonList.features[0]?.properties.myVote, 0);
      assert.equal(captured[captured.length - 1]?.authorization, undefined);

      // Register stores token in SessionStorage
      const regRes = await client.register({
        pseudonym: 'courtyard_mapper',
        password: 'correct-horse-battery',
      });
      assert.equal(regRes.sessionToken, 'sess_registered_1');
      assert.equal(await storage.getToken(), 'sess_registered_1');

      // Authenticated getMe & listPolygons attach Bearer token
      const me = await client.getMe();
      assert.deepEqual(me, SAMPLE_USER);
      assert.equal(
        captured[captured.length - 1]?.authorization,
        'Bearer sess_registered_1',
      );

      const authedList = await client.listPolygons([9.98, 53.54, 10.01, 53.56]);
      assert.equal(authedList.features[0]?.properties.myVote, 1);

      // Polygon CRUD + Vote CRUD
      const single = await client.getPolygon(SAMPLE_POLYGON_ID);
      assert.equal(single.id, SAMPLE_POLYGON_ID);

      const created = await client.createPolygon({
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [9.9935, 53.551],
              [9.9937, 53.551],
              [9.9937, 53.55115],
              [9.9935, 53.55115],
              [9.9935, 53.551],
            ],
          ],
        },
        surfaceType: 'asphalt',
        note: 'Fresh courtyard',
      });
      assert.equal(created.properties.note, 'Fresh courtyard');

      // Structured 422 GEOMETRY_INVALID error parsed into ApiError with details
      await assert.rejects(
        () =>
          client.createPolygon({
            geometry: created.geometry,
            surfaceType: 'asphalt',
            note: 'trigger_self_intersection',
          }),
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.statusCode, 422);
          assert.equal(err.code, 'GEOMETRY_INVALID');
          assert.deepEqual(err.details, { location: [9.9936, 53.5511] });
          return true;
        },
      );

      const patched = await client.patchPolygon(SAMPLE_POLYGON_ID, {
        surfaceType: 'pavers',
        note: 'Updated pavers note',
      });
      assert.equal(patched.properties.surfaceType, 'pavers');
      assert.equal(patched.properties.note, 'Updated pavers note');

      const upvoted = await client.putVote(SAMPLE_POLYGON_ID, 1);
      assert.equal(upvoted.myVote, 1);
      assert.equal(upvoted.score, 3);

      const unvoted = await client.deleteVote(SAMPLE_POLYGON_ID);
      assert.equal(unvoted.myVote, 0);

      await client.deletePolygon(SAMPLE_POLYGON_ID);

      // Logout clears token and sends no Content-Type on empty body
      await client.logout();
      assert.equal(await storage.getToken(), null);

      // Failed login surfaces 401 AUTH_INVALID_CREDENTIALS
      await assert.rejects(
        () =>
          client.login({
            pseudonym: 'courtyard_mapper',
            password: 'wrongpassword',
          }),
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.statusCode, 401);
          assert.equal(err.code, 'AUTH_INVALID_CREDENTIALS');
          return true;
        },
      );

      // Successful login + recover + deleteMe
      const loginRes = await client.login({
        pseudonym: 'courtyard_mapper',
        password: 'correct-horse-battery',
      });
      assert.equal(await storage.getToken(), loginRes.sessionToken);

      const recoverRes = await client.recover({
        pseudonym: 'courtyard_mapper',
        recoveryCode: 'ABCD-1234-EF56-7890-ABCD-1234-EF56-7890',
        newPassword: 'new-horse-battery-staple',
      });
      assert.equal(await storage.getToken(), recoverRes.sessionToken);

      await client.deleteMe();
      assert.equal(await storage.getToken(), null);

      // Invalid server response rejected by Zod schema validation
      nextConfigMode = 'invalid_schema';
      await assert.rejects(() => client.getConfig());
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('appReducer and viewModels', () => {
  it('Review Focus 1: transitions configStatus loading -> error -> ready, gates spanTooWide > 0.15°, and cycles overlapping features 1/3 -> 2/3 -> 3/3 -> 1/3', () => {
    let state: AppState = initialAppState;
    assert.equal(state.configStatus, 'loading');

    state = appReducer(state, {
      type: 'CONFIG_ERROR',
      message: 'Network unreachable',
    });
    assert.equal(state.configStatus, 'error');
    assert.equal(state.configError, 'Network unreachable');

    state = appReducer(state, { type: 'CONFIG_LOADING' });
    assert.equal(state.configStatus, 'loading');
    assert.equal(state.configError, null);

    state = appReducer(state, {
      type: 'CONFIG_LOADED',
      config: SAMPLE_CONFIG_WITH_ORTHO,
    });
    assert.equal(state.configStatus, 'ready');
    assert.deepEqual(state.config, SAMPLE_CONFIG_WITH_ORTHO);

    // Viewport span <= 0.15° -> spanTooWide === false (including exact 0.15° boundary)
    state = appReducer(state, {
      type: 'SET_VIEWPORT',
      bbox: { minLng: 9.9, minLat: 53.5, maxLng: 10.05, maxLat: 53.65 },
      zoom: 13,
    });
    assert.equal(state.spanTooWide, false);

    // Viewport span > 0.15° -> spanTooWide === true
    state = appReducer(state, {
      type: 'SET_VIEWPORT',
      bbox: { minLng: 9.9, minLat: 53.5, maxLng: 10.051, maxLat: 53.62 },
      zoom: 11,
    });
    assert.equal(state.spanTooWide, true);

    // SELECT_FEATURES_AT_TAP cycles 1/3 -> 2/3 -> 3/3 -> 1/3
    const overlapIds = [
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000003',
    ];

    state = appReducer(state, {
      type: 'SELECT_FEATURES_AT_TAP',
      featureIds: overlapIds,
    });
    assert.equal(state.overlapIndex, 0);
    assert.equal(state.selectedFeatureId, overlapIds[0]);

    state = appReducer(state, {
      type: 'SELECT_FEATURES_AT_TAP',
      featureIds: overlapIds,
    });
    assert.equal(state.overlapIndex, 1);
    assert.equal(state.selectedFeatureId, overlapIds[1]);

    state = appReducer(state, {
      type: 'SELECT_FEATURES_AT_TAP',
      featureIds: overlapIds,
    });
    assert.equal(state.overlapIndex, 2);
    assert.equal(state.selectedFeatureId, overlapIds[2]);

    state = appReducer(state, {
      type: 'SELECT_FEATURES_AT_TAP',
      featureIds: overlapIds,
    });
    assert.equal(state.overlapIndex, 0);
    assert.equal(state.selectedFeatureId, overlapIds[0]);

    // CYCLE_OVERLAP_FEATURE also cycles 1/3 -> 2/3 -> 3/3 -> 1/3
    state = appReducer(state, { type: 'CYCLE_OVERLAP_FEATURE' });
    assert.equal(state.overlapIndex, 1);
    state = appReducer(state, { type: 'CYCLE_OVERLAP_FEATURE' });
    assert.equal(state.overlapIndex, 2);
    state = appReducer(state, { type: 'CYCLE_OVERLAP_FEATURE' });
    assert.equal(state.overlapIndex, 0);
  });

  it('Review Focus 2a: ignores ADD_VERTEX when closed, reopens closed ring on UNDO_VERTEX without losing vertices, and preserves draft on error or discard prompt', () => {
    let state = appReducer(initialAppState, {
      type: 'CONFIG_LOADED',
      config: SAMPLE_CONFIG_WITH_ORTHO,
    });

    state = appReducer(state, { type: 'START_DRAW' });
    assert.equal(state.mode, 'drawing');

    for (const pt of COURTYARD_VERTICES) {
      state = appReducer(state, { type: 'ADD_VERTEX', point: pt });
    }
    assert.equal(state.draftVertices.length, 4);
    assert.equal(state.isRingClosed, false);

    state = appReducer(state, { type: 'CLOSE_RING' });
    assert.equal(state.isRingClosed, true);

    // ADD_VERTEX must be ignored while ring is closed
    const afterIgnoredTap = appReducer(state, {
      type: 'ADD_VERTEX',
      point: [9.994, 53.552],
    });
    assert.equal(afterIgnoredTap.draftVertices.length, 4);
    assert.deepEqual(afterIgnoredTap.draftVertices, COURTYARD_VERTICES);
    assert.equal(afterIgnoredTap.isRingClosed, true);
    state = afterIgnoredTap;

    // UNDO_VERTEX on closed ring reopens without popping any vertex
    state = appReducer(state, { type: 'UNDO_VERTEX' });
    assert.equal(state.isRingClosed, false);
    assert.equal(state.draftVertices.length, 4);
    assert.deepEqual(state.draftVertices, COURTYARD_VERTICES);

    // Next UNDO_VERTEX pops last vertex
    state = appReducer(state, { type: 'UNDO_VERTEX' });
    assert.equal(state.draftVertices.length, 3);

    // Re-add 4th vertex, close, set metadata, and verify SUBMIT_ERROR_PRESERVE_DRAFT
    state = appReducer(state, {
      type: 'ADD_VERTEX',
      point: COURTYARD_VERTICES[3]!,
    });
    state = appReducer(state, { type: 'CLOSE_RING' });
    state = appReducer(state, {
      type: 'SET_DRAFT_META',
      surfaceType: 'concrete',
      note: 'Courtyard behind school',
    });

    state = appReducer(state, {
      type: 'SUBMIT_ERROR_PRESERVE_DRAFT',
      message: 'Polygon edges must not cross or self-intersect.',
    });
    assert.equal(state.mode, 'drawing');
    assert.equal(state.isRingClosed, true);
    assert.equal(state.draftVertices.length, 4);
    assert.equal(state.draftSurfaceType, 'concrete');
    assert.equal(state.draftNote, 'Courtyard behind school');
    assert.equal(
      state.draftSubmitError,
      'Polygon edges must not cross or self-intersect.',
    );

    // Discard confirmation requires two-step REQUEST -> CONFIRM
    state = appReducer(state, { type: 'REQUEST_DISCARD_DRAFT' });
    assert.equal(state.confirmingDiscardDraft, true);
    assert.equal(state.mode, 'drawing');
    assert.equal(state.draftVertices.length, 4);

    state = appReducer(state, { type: 'CONFIRM_DISCARD_DRAFT' });
    assert.equal(state.mode, 'browse');
    assert.equal(state.draftVertices.length, 0);
    assert.equal(state.isRingClosed, false);
    assert.equal(state.confirmingDiscardDraft, false);
  });

  it('Review Focus 2b: bumps viewportRefreshSeq on AUTH_SUCCEEDED, LOGOUT_SUCCEEDED, and ACCOUNT_DELETED and resumes pendingIntent for SUBMIT_DRAFT (deduplicated closed ring) and CAST_VOTE', () => {
    let state = appReducer(initialAppState, {
      type: 'CONFIG_LOADED',
      config: SAMPLE_CONFIG_WITH_ORTHO,
    });
    assert.equal(state.viewportRefreshSeq, 0);

    // Anonymous user draws vertices with a consecutive duplicate tap, closes ring, and submits
    state = appReducer(state, { type: 'START_DRAW' });
    state = appReducer(state, { type: 'ADD_VERTEX', point: COURTYARD_VERTICES[0]! });
    state = appReducer(state, { type: 'ADD_VERTEX', point: COURTYARD_VERTICES[1]! });
    // Consecutive near-identical duplicate tap within 1e-7°
    state = appReducer(state, {
      type: 'ADD_VERTEX',
      point: [COURTYARD_VERTICES[1]![0] + 1e-8, COURTYARD_VERTICES[1]![1]],
    });
    state = appReducer(state, { type: 'ADD_VERTEX', point: COURTYARD_VERTICES[2]! });
    state = appReducer(state, { type: 'ADD_VERTEX', point: COURTYARD_VERTICES[3]! });
    assert.equal(state.draftVertices.length, 5);

    state = appReducer(state, { type: 'CLOSE_RING' });
    state = appReducer(state, {
      type: 'SET_DRAFT_META',
      surfaceType: 'pavers',
      note: 'Sidewalk bulge',
    });

    state = appReducer(state, { type: 'SUBMIT_DRAFT' });
    assert.equal(state.authModalOpen, true);
    assert.ok(state.pendingIntent);
    assert.equal(state.pendingIntent.type, 'SUBMIT_DRAFT');
    assert.deepEqual(state.pendingIntent.payload, {
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            COURTYARD_VERTICES[0]!,
            COURTYARD_VERTICES[1]!,
            COURTYARD_VERTICES[2]!,
            COURTYARD_VERTICES[3]!,
            COURTYARD_VERTICES[0]!,
          ],
        ],
      },
      surfaceType: 'pavers',
      note: 'Sidewalk bulge',
    });

    // Signup succeeds -> bumps viewportRefreshSeq (0 -> 1) and preserves pendingIntent while recovery code is displayed
    state = appReducer(state, {
      type: 'AUTH_SUCCEEDED',
      user: SAMPLE_USER,
      recoveryCode: 'ABCD-1234-EF56-7890-ABCD-1234-EF56-7890',
    });
    assert.equal(state.viewportRefreshSeq, 1);
    assert.equal(state.authModalOpen, true);
    assert.ok(state.pendingIntent);
    assert.equal(state.pendingIntent.type, 'SUBMIT_DRAFT');

    // User checks recovery code saved and closes modal -> pendingIntent remains ready to resume!
    state = appReducer(state, {
      type: 'SET_RECOVERY_CODE_SAVED_CHECKED',
      checked: true,
    });
    state = appReducer(state, { type: 'CLOSE_AUTH_MODAL' });
    assert.equal(state.authModalOpen, false);
    assert.ok(state.pendingIntent);
    assert.equal(state.pendingIntent.type, 'SUBMIT_DRAFT');

    // Polygon creation completes -> exits drawing and clears pendingIntent
    const createdFeature = makePolygonFeature({ surfaceType: 'pavers', note: 'Sidewalk bulge' });
    state = appReducer(state, {
      type: 'POLYGON_CREATED',
      feature: createdFeature,
    });
    assert.equal(state.mode, 'browse');
    assert.equal(state.pendingIntent, null);
    assert.equal(state.selectedFeatureId, createdFeature.id);

    // LOGOUT_SUCCEEDED bumps viewportRefreshSeq (1 -> 2) and clears currentUser
    state = appReducer(state, { type: 'LOGOUT_SUCCEEDED' });
    assert.equal(state.viewportRefreshSeq, 2);
    assert.equal(state.currentUser, null);
    assert.equal(state.features[0]?.properties.isAuthor, false);

    // Anonymous user attempts CAST_VOTE -> queues pendingIntent and opens auth modal
    state = appReducer(state, {
      type: 'CAST_VOTE',
      polygonId: SAMPLE_POLYGON_ID,
      value: -1,
    });
    assert.equal(state.authModalOpen, true);
    assert.deepEqual(state.pendingIntent, {
      type: 'CAST_VOTE',
      polygonId: SAMPLE_POLYGON_ID,
      value: -1,
    });

    // Login succeeds -> bumps viewportRefreshSeq (2 -> 3), closes modal immediately, preserves CAST_VOTE pendingIntent
    state = appReducer(state, {
      type: 'AUTH_SUCCEEDED',
      user: SAMPLE_USER,
    });
    assert.equal(state.viewportRefreshSeq, 3);
    assert.equal(state.authModalOpen, false);
    assert.deepEqual(state.pendingIntent, {
      type: 'CAST_VOTE',
      polygonId: SAMPLE_POLYGON_ID,
      value: -1,
    });

    // Vote completes -> updates feature and clears pendingIntent
    state = appReducer(state, {
      type: 'VOTE_UPDATED',
      vote: {
        polygonId: SAMPLE_POLYGON_ID,
        upvotes: 3,
        downvotes: 2,
        score: 1,
        myVote: -1,
      },
    });
    assert.equal(state.pendingIntent, null);
    assert.equal(state.features[0]?.properties.myVote, -1);
    assert.equal(state.features[0]?.properties.score, 1);

    // ACCOUNT_DELETED bumps viewportRefreshSeq (3 -> 4) and anonymizes local authored feature
    state = appReducer(state, {
      type: 'VIEWPORT_FEATURES_LOADED',
      features: [makePolygonFeature({ isAuthor: true, myVote: 1 })],
      truncated: false,
    });
    state = appReducer(state, { type: 'ACCOUNT_DELETED' });
    assert.equal(state.viewportRefreshSeq, 4);
    assert.equal(state.currentUser, null);
    assert.equal(state.features[0]?.properties.authorPseudonym, 'deleted');
    assert.equal(state.features[0]?.properties.isAuthor, false);
    assert.equal(state.features[0]?.properties.myVote, 0);
  });

  it('Review Focus 3 & viewModels: hides orthophoto toggle when orthophoto is null, reverts on TILE_LOAD_ERROR, blocks closing signup recovery modal until checked, and computes live drawing toolbar diagnostics', () => {
    // Config without orthophoto -> showOrthophotoToggle === false
    let state = appReducer(initialAppState, {
      type: 'CONFIG_LOADED',
      config: SAMPLE_CONFIG_NO_ORTHO,
    });
    let controls = deriveMapControlsModel(state);
    assert.equal(controls.showOrthophotoToggle, false);
    assert.equal(controls.showFirstVisitDisclaimer, true);

    // Dismiss first-visit disclaimer
    state = appReducer(state, { type: 'DISMISS_FIRST_VISIT_DISCLAIMER' });
    controls = deriveMapControlsModel(state);
    assert.equal(controls.showFirstVisitDisclaimer, false);

    // Config WITH orthophoto -> showOrthophotoToggle === true; TILE_LOAD_ERROR reverts to 'osm'
    state = appReducer(state, {
      type: 'CONFIG_LOADED',
      config: SAMPLE_CONFIG_WITH_ORTHO,
    });
    state = appReducer(state, {
      type: 'SET_BASEMAP_MODE',
      mode: 'orthophoto',
    });
    controls = deriveMapControlsModel(state);
    assert.equal(controls.showOrthophotoToggle, true);
    assert.equal(controls.basemapMode, 'orthophoto');

    state = appReducer(state, {
      type: 'TILE_LOAD_ERROR',
      reason: 'WMS 503 Service Unavailable',
    });
    controls = deriveMapControlsModel(state);
    assert.equal(controls.basemapMode, 'osm');
    assert.equal(controls.tileWarning, 'WMS 503 Service Unavailable');

    // Post-signup recovery modal blocks closing until recoveryCodeSavedChecked === true
    state = appReducer(state, {
      type: 'AUTH_SUCCEEDED',
      user: SAMPLE_USER,
      recoveryCode: '1111-2222-3333-4444-5555-6666-7777-8888',
    });
    let authModal = deriveAuthModalModel(state);
    assert.equal(authModal.visible, true);
    assert.equal(authModal.isPostSignupRecoveryDisplay, true);
    assert.equal(authModal.canClose, false);
    assert.ok(authModal.closeBlockedReason);

    // Attempting CLOSE_AUTH_MODAL before checking is blocked
    state = appReducer(state, { type: 'CLOSE_AUTH_MODAL' });
    assert.equal(state.authModalOpen, true);

    // Checking the box unlocks closing
    state = appReducer(state, {
      type: 'SET_RECOVERY_CODE_SAVED_CHECKED',
      checked: true,
    });
    authModal = deriveAuthModalModel(state);
    assert.equal(authModal.canClose, true);
    assert.equal(authModal.closeBlockedReason, null);

    state = appReducer(state, { type: 'CLOSE_AUTH_MODAL' });
    authModal = deriveAuthModalModel(state);
    assert.equal(authModal.visible, false);

    // Drawing toolbar model: live areaM2 and self-intersection crossing detection
    state = appReducer(state, { type: 'START_DRAW' });
    for (const pt of COURTYARD_VERTICES) {
      state = appReducer(state, { type: 'ADD_VERTEX', point: pt });
    }
    state = appReducer(state, { type: 'CLOSE_RING' });
    const validToolbar = deriveDrawingToolbarModel(state);
    assert.equal(validToolbar.visible, true);
    assert.ok(validToolbar.areaM2 > 100 && validToolbar.areaM2 < 400);
    assert.equal(validToolbar.canSubmit, true);
    assert.equal(validToolbar.crossingPoint, null);

    // Bow-tie crossing disables canSubmit and reports crossingPoint
    state = appReducer(state, { type: 'START_DRAW' });
    const bowTie: [number, number][] = [
      [9.9935, 53.551],
      [9.9938, 53.5513],
      [9.9938, 53.551],
      [9.9935, 53.5513],
    ];
    for (const pt of bowTie) {
      state = appReducer(state, { type: 'ADD_VERTEX', point: pt });
    }
    state = appReducer(state, { type: 'CLOSE_RING' });
    const invalidToolbar = deriveDrawingToolbarModel(state);
    assert.equal(invalidToolbar.canSubmit, false);
    assert.ok(invalidToolbar.crossingPoint !== null);
    assert.ok(invalidToolbar.validationErrors.length > 0);
  });

  it('handles SESSION_EXPIRED 401 continuation, non-JSON proxy / network errors, and workspace subpath exports', async () => {
    const [clientPkg, statePkg, vmPkg, storagePkg] = await Promise.all([
      import('@entsiegelung/mobile/client'),
      import('@entsiegelung/mobile/appState'),
      import('@entsiegelung/mobile/viewModels'),
      import('@entsiegelung/mobile/tokenStorage'),
    ]);
    assert.equal(clientPkg.PpgisApiClient, PpgisApiClient);
    assert.equal(statePkg.appReducer, appReducer);
    assert.equal(vmPkg.deriveMapControlsModel, deriveMapControlsModel);
    assert.equal(storagePkg.SESSION_TOKEN_KEY, SESSION_TOKEN_KEY);

    // Network failure and non-JSON 502 Bad Gateway map cleanly to ApiError
    const mem = createMemorySessionStorage();
    const offlineClient = new PpgisApiClient(
      'http://127.0.0.1:9',
      mem,
      async () => {
        throw new TypeError('fetch failed');
      },
    );
    await assert.rejects(
      () => offlineClient.getConfig(),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 503);
        assert.equal(err.code, 'SERVICE_UNAVAILABLE');
        return true;
      },
    );

    const htmlProxyClient = new PpgisApiClient(
      'https://maps.example.org/api/v1/',
      mem,
      async () =>
        new Response('<html>502 Bad Gateway</html>', {
          status: 502,
          headers: { 'Content-Type': 'text/html' },
        }),
    );
    assert.equal(
      htmlProxyClient.getExportGeoJsonUrl(),
      'https://maps.example.org/api/v1/polygons/export.geojson',
    );
    await assert.rejects(
      () => htmlProxyClient.getConfig(),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 502);
        assert.equal(err.code, 'SERVICE_UNAVAILABLE');
        return true;
      },
    );

    // Authenticated user submits draft -> receives 401 SESSION_EXPIRED -> re-authenticates -> resumes draft
    let state = appReducer(initialAppState, {
      type: 'CONFIG_LOADED',
      config: SAMPLE_CONFIG_WITH_ORTHO,
    });
    state = appReducer(state, {
      type: 'AUTH_SUCCEEDED',
      user: SAMPLE_USER,
    });
    state = appReducer(state, { type: 'START_DRAW' });
    for (const pt of COURTYARD_VERTICES) {
      state = appReducer(state, { type: 'ADD_VERTEX', point: pt });
    }
    state = appReducer(state, { type: 'CLOSE_RING' });
    state = appReducer(state, { type: 'SUBMIT_DRAFT' });
    assert.equal(state.isSubmittingDraft, true);
    assert.equal(state.pendingIntent?.type, 'SUBMIT_DRAFT');

    const seqBeforeExpiry = state.viewportRefreshSeq;
    state = appReducer(state, { type: 'SESSION_EXPIRED' });
    assert.equal(state.currentUser, null);
    assert.equal(state.isSubmittingDraft, false);
    assert.equal(state.authModalOpen, true);
    assert.equal(state.viewportRefreshSeq, seqBeforeExpiry + 1);
    assert.equal(state.draftVertices.length, 4);
    assert.equal(state.pendingIntent?.type, 'SUBMIT_DRAFT');

    state = appReducer(state, {
      type: 'AUTH_SUCCEEDED',
      user: SAMPLE_USER,
    });
    assert.equal(state.authModalOpen, false);
    assert.equal(state.viewportRefreshSeq, seqBeforeExpiry + 2);
    assert.equal(state.pendingIntent?.type, 'SUBMIT_DRAFT');
  });
});
