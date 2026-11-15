import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { describe, it } from 'node:test';

import {
  ApiError,
  type AuthUser,
  type ImportPolygonsResponse,
  type PhotoVoteResponse,
  type PolygonCollectionResponse,
  type PolygonComment,
  type PolygonFeature,
  type PolygonPhoto,
  type RegisterResponse,
  type RuntimeConfig,
  type SessionResponse,
  type VoteResponse,
} from '@entsiegelung/shared';

import {
  encodeUtf8Base64,
  sha256Hex,
  solveAltchaChallengeClient,
} from '../src/api/altcha';
import { PpgisApiClient } from '../src/api/client';
import {
  appReducer,
  initialAppState,
  type AppState,
} from '../src/state/appState';
import {
  buildCommentDisplayModel,
  deriveAuthModalModel,
  deriveDrawingToolbarModel,
  deriveMapControlsModel,
  pruneDeletedCommentSubtree,
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
    'Community unsealing suggestions - non-binding public input, regardless of property ownership.',
  abuseContact: 'moderation@example.org',
  privacyPolicyUrl: 'https://maps.example.org/auth/privacy',
  impressumUrl: 'https://maps.example.org/auth/impressum',
  termsUrl: 'https://maps.example.org/auth/terms',
  licensesUrl: 'https://maps.example.org/auth/licenses',
  sourceCodeUrl: 'https://github.com/sebroccoli/Entsiegelungskartierung',
  bugReportContact: 'bugs@example.org',
  apkDownloadUrl: null,
  apkSha256: null,
  authCaptchaRequired: false,
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
  email: 'mapper@example.org',
  role: 'user',
  createdAt: '2026-11-12T10:00:00.000Z',
};

const SAMPLE_ADMIN_USER: AuthUser = {
  ...SAMPLE_USER,
  id: '99999999-9999-4999-8999-999999999999',
  pseudonym: 'stadtplanung_hh',
  email: 'admin@example.org',
  role: 'admin',
};

const COURTYARD_VERTICES: [number, number][] = [
  [9.9935, 53.551],
  [9.9937, 53.551],
  [9.9937, 53.55115],
  [9.9935, 53.55115],
];

const SAMPLE_POLYGON_ID = '22222222-2222-4222-8222-222222222222';
const SAMPLE_PHOTO_ID = '33333333-3333-4333-8333-333333333333';

function makePolygonFeature(
  overrides?: Partial<PolygonFeature['properties']> & { id?: string },
): PolygonFeature {
  const id = overrides?.id ?? SAMPLE_POLYGON_ID;
  const status = overrides?.status ?? 'proposed';
  const score = overrides?.score ?? 2;
  const municipalityMaxScore =
    overrides?.municipalityMaxScore ?? Math.max(score, 3);
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
      status,
      finishedAt:
        overrides?.finishedAt !== undefined
          ? overrides.finishedAt
          : status === 'finished'
            ? '2026-11-13T10:00:00.000Z'
            : null,
      note:
        overrides?.note !== undefined
          ? overrides.note
          : 'Unused corner parking area',
      areaM2: overrides?.areaM2 ?? 220.4,
      municipalityAgs:
        overrides?.municipalityAgs !== undefined
          ? overrides.municipalityAgs
          : '02000000',
      municipalityName:
        overrides?.municipalityName !== undefined
          ? overrides.municipalityName
          : 'Hamburg',
      municipalityMaxScore,
      municipalityNormalizedScore:
        overrides?.municipalityNormalizedScore ??
        (status === 'finished' || score <= 0
          ? 0
          : Number((score / municipalityMaxScore).toFixed(4))),
      photoCount: overrides?.photoCount ?? 0,
      commentCount: overrides?.commentCount ?? 0,
      authorPseudonym: overrides?.authorPseudonym ?? SAMPLE_USER.pseudonym,
      authorIsNewUser: overrides?.authorIsNewUser ?? false,
      authorRecentlyActive:
        overrides?.authorRecentlyActive !== undefined
          ? overrides.authorRecentlyActive
          : true,
      upvotes: overrides?.upvotes ?? Math.max(score, 0),
      downvotes: overrides?.downvotes ?? Math.max(-score, 0),
      score,
      myVote: overrides?.myVote ?? 0,
      flagCount: overrides?.flagCount ?? 0,
      isFlagged: overrides?.isFlagged ?? (overrides?.flagCount ?? 0) > 0,
      myFlag: overrides?.myFlag ?? false,
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
    await platformSessionStorage.clearToken();
    assert.equal(await platformSessionStorage.getToken(), null);
    await platformSessionStorage.setToken('node_fallback_token');
    assert.equal(await platformSessionStorage.getToken(), 'node_fallback_token');
    await platformSessionStorage.clearToken();
    assert.equal(await platformSessionStorage.getToken(), null);

    const getterThrows = createWebSessionStorage(() => {
      throw new Error('SecurityError: The operation is insecure.');
    });
    await getterThrows.setToken('sec_fallback_tok');
    assert.equal(await getterThrows.getToken(), 'sec_fallback_tok');
    await getterThrows.clearToken();
    assert.equal(await getterThrows.getToken(), null);

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

describe('PpgisApiClient v2 against live HTTP server', () => {
  it('executes email auth, polygons, admin status/import, and photo upload/voting endpoints with full Zod validation', async () => {
    interface CapturedRequest {
      method: string;
      url: string;
      authorization: string | undefined;
      contentType: string | undefined;
      body: string;
    }

    const captured: CapturedRequest[] = [];
    let nextConfigMode: 'valid' | 'invalid_schema' = 'valid';

    const samplePhoto: PolygonPhoto = {
      id: SAMPLE_PHOTO_ID,
      polygonId: SAMPLE_POLYGON_ID,
      url: `/uploads/${SAMPLE_PHOTO_ID}.webp`,
      thumbUrl: `/uploads/${SAMPLE_PHOTO_ID}_thumb.webp`,
      width: 1200,
      height: 900,
      gpsVerified: true,
      uploaderPseudonym: SAMPLE_USER.pseudonym,
      isUploader: true,
      realVotes: 2,
      fakeVotes: 0,
      credibilityScore: 2,
      myVote: 0,
      isFlaggedFake: false,
      createdAt: '2026-11-13T10:00:00.000Z',
    };

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
            status: 'verification_email_sent',
            pseudonym: SAMPLE_USER.pseudonym,
            email: 'mapper@example.org',
          };
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(payload));
          return;
        }

        if (method === 'POST' && url === '/api/v1/auth/resend-verification') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              status: 'ok',
              message: 'Verification link sent.',
            }),
          );
          return;
        }

        if (method === 'POST' && url === '/api/v1/auth/verify-email') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              status: 'verified',
              pseudonym: SAMPLE_USER.pseudonym,
            }),
          );
          return;
        }

        if (method === 'POST' && url === '/api/v1/auth/login') {
          const parsed = JSON.parse(rawBody) as {
            identifier?: string;
            password?: string;
          };
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
            user: SAMPLE_ADMIN_USER,
            sessionToken: 'sess_logged_in_2',
            expiresAt: '2026-12-12T10:00:00.000Z',
          };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(payload));
          return;
        }

        if (method === 'POST' && url === '/api/v1/auth/forgot-password') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              status: 'ok',
              message: 'Reset link sent.',
            }),
          );
          return;
        }

        if (method === 'POST' && url === '/api/v1/auth/reset-password') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'password_reset' }));
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
          res.end(JSON.stringify(SAMPLE_ADMIN_USER));
          return;
        }

        if (
          (method === 'POST' && url === '/api/v1/auth/logout') ||
          (method === 'DELETE' && url === '/api/v1/auth/me')
        ) {
          if (
            req.headers['content-type']?.includes('application/json') &&
            rawBody.length === 0
          ) {
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
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              type: 'FeatureCollection',
              features: [futureSurfaceFeature],
              meta: { truncated: false, limit: 500 },
            }),
          );
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
          res.end(
            JSON.stringify(makePolygonFeature({ note: parsed.note ?? null })),
          );
          return;
        }

        if (method === 'PATCH' && url === `/api/v1/polygons/${SAMPLE_POLYGON_ID}`) {
          const parsed = JSON.parse(rawBody) as {
            note?: string | null;
            surfaceType?: 'pavers';
          };
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

        if (
          method === 'PATCH' &&
          url === `/api/v1/polygons/${SAMPLE_POLYGON_ID}/status`
        ) {
          const parsed = JSON.parse(rawBody) as {
            status: 'proposed' | 'finished';
          };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(makePolygonFeature({ status: parsed.status })));
          return;
        }

        if (method === 'POST' && url === '/api/v1/polygons/import') {
          assert.ok(req.headers['content-type']?.includes('multipart/form-data'));
          const importRes: ImportPolygonsResponse = {
            format: 'gpkg',
            importedCount: 4,
            skippedCount: 1,
            errors: [{ featureIndex: 4, reason: 'Area below minimum.' }],
          };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(importRes));
          return;
        }

        if (
          method === 'GET' &&
          url === `/api/v1/polygons/${SAMPLE_POLYGON_ID}/photos`
        ) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ photos: [samplePhoto] }));
          return;
        }

        if (
          method === 'POST' &&
          url === `/api/v1/polygons/${SAMPLE_POLYGON_ID}/photos`
        ) {
          assert.ok(req.headers['content-type']?.includes('multipart/form-data'));
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(samplePhoto));
          return;
        }

        if (method === 'PUT' && url === `/api/v1/photos/${SAMPLE_PHOTO_ID}/vote`) {
          const parsed = JSON.parse(rawBody) as { value: 1 | -1 };
          const voteRes: PhotoVoteResponse = {
            photoId: SAMPLE_PHOTO_ID,
            polygonId: SAMPLE_POLYGON_ID,
            realVotes: parsed.value === 1 ? 3 : 2,
            fakeVotes: parsed.value === -1 ? 1 : 0,
            credibilityScore: parsed.value === 1 ? 3 : 1,
            myVote: parsed.value,
            isFlaggedFake: false,
          };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(voteRes));
          return;
        }

        if (
          method === 'DELETE' &&
          url === `/api/v1/photos/${SAMPLE_PHOTO_ID}/vote`
        ) {
          const voteRes: PhotoVoteResponse = {
            photoId: SAMPLE_PHOTO_ID,
            polygonId: SAMPLE_POLYGON_ID,
            realVotes: 2,
            fakeVotes: 0,
            credibilityScore: 2,
            myVote: 0,
            isFlaggedFake: false,
          };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(voteRes));
          return;
        }

        if (method === 'DELETE' && url === `/api/v1/photos/${SAMPLE_PHOTO_ID}`) {
          res.writeHead(204);
          res.end();
          return;
        }

        if (method === 'DELETE' && url === `/api/v1/polygons/${SAMPLE_POLYGON_ID}`) {
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

        if (method === 'GET' && url.startsWith('/api/v1/geocode?')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              results: [
                {
                  placeId: '4711',
                  displayName: 'Gutenbergplatz, Mainz, Deutschland',
                  lat: 49.9989,
                  lng: 8.2739,
                  boundingBox: [8.271, 49.997, 8.276, 50.001],
                },
              ],
            }),
          );
          return;
        }

        if (method === 'POST' && url === '/api/v1/bug-reports') {
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'sent' }));
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
      assert.equal(
        client.getPrivacyPolicyUrl(),
        `http://127.0.0.1:${addr.port}/auth/privacy`,
      );
      assert.equal(
        client.resolveUploadUrl('/uploads/abc.webp'),
        `http://127.0.0.1:${addr.port}/uploads/abc.webp`,
      );

      const cfg = await client.getConfig();
      assert.deepEqual(cfg, SAMPLE_CONFIG_WITH_ORTHO);

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

      // Register sends email verification link and does NOT store a session token before verification
      const regRes = await client.register({
        pseudonym: 'courtyard_mapper',
        email: 'mapper@example.org',
        password: 'correct-horse-battery',
        acceptedPrivacyPolicy: true,
        acceptedTerms: true,
      });
      assert.equal(regRes.status, 'verification_email_sent');
      assert.equal(await storage.getToken(), null);

      const resendRes = await client.resendVerification('mapper@example.org');
      assert.equal(resendRes.status, 'ok');

      const verifyRes = await client.verifyEmail(
        '1234567890abcdef1234567890abcdef',
      );
      assert.equal(verifyRes.status, 'verified');

      // Login stores bearer token
      const loginRes = await client.login({
        identifier: 'stadtplanung_hh',
        password: 'correct-horse-battery',
      });
      assert.equal(loginRes.sessionToken, 'sess_logged_in_2');
      assert.equal(await storage.getToken(), 'sess_logged_in_2');

      const me = await client.getMe();
      assert.deepEqual(me, SAMPLE_ADMIN_USER);
      assert.equal(
        captured[captured.length - 1]?.authorization,
        'Bearer sess_logged_in_2',
      );

      // Polygon CRUD + Status + Import + Photos
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

      const markedFinished = await client.patchPolygonStatus(
        SAMPLE_POLYGON_ID,
        'finished',
      );
      assert.equal(markedFinished.properties.status, 'finished');
      assert.equal(markedFinished.properties.municipalityNormalizedScore, 0);

      const imported = await client.importPolygonsFile({
        uri: 'blob:test-gpkg',
        name: 'municipal.gpkg',
        mimeType: 'application/geopackage+sqlite3',
        webFile: new Blob([new Uint8Array([0x53, 0x51, 0x4c, 0x69])]),
      });
      assert.equal(imported.importedCount, 4);

      const uploadedPhoto = await client.uploadPolygonPhoto(SAMPLE_POLYGON_ID, {
        uri: 'blob:test-jpg',
        name: 'courtyard.jpg',
        mimeType: 'image/jpeg',
        webFile: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], {
          type: 'image/jpeg',
        }),
      });
      assert.equal(uploadedPhoto.gpsVerified, true);

      const listedPhotos = await client.listPolygonPhotos(SAMPLE_POLYGON_ID);
      assert.equal(listedPhotos.photos.length, 1);

      const realVoted = await client.putPhotoVote(SAMPLE_PHOTO_ID, 1);
      assert.equal(realVoted.myVote, 1);
      assert.equal(realVoted.realVotes, 3);

      const unvotedPhoto = await client.deletePhotoVote(SAMPLE_PHOTO_ID);
      assert.equal(unvotedPhoto.myVote, 0);

      await client.deletePhoto(SAMPLE_PHOTO_ID);

      const geocodeRes = await client.searchAddress('Gutenbergplatz Mainz', 'de');
      assert.equal(geocodeRes.results.length, 1);
      assert.equal(geocodeRes.results[0]?.placeId, '4711');

      const bugReportRes = await client.submitBugReport({
        description: 'Button label overlaps on narrow viewport.',
        contactEmail: 'tester@example.org',
        platform: 'web',
        pageUrl: 'https://app.open-unseal.de/',
      });
      assert.equal(bugReportRes.status, 'sent');

      // Forgot + Reset password
      const forgotRes = await client.forgotPassword('mapper@example.org');
      assert.equal(forgotRes.status, 'ok');

      const resetRes = await client.resetPassword({
        token: 'abcdef1234567890abcdef1234567890',
        newPassword: 'new-horse-battery-staple',
      });
      assert.equal(resetRes.status, 'password_reset');

      await client.logout();
      assert.equal(await storage.getToken(), null);

      await assert.rejects(
        () =>
          client.login({
            identifier: 'courtyard_mapper',
            password: 'wrongpassword',
          }),
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.statusCode, 401);
          assert.equal(err.code, 'AUTH_INVALID_CREDENTIALS');
          return true;
        },
      );

      nextConfigMode = 'invalid_schema';
      await assert.rejects(() => client.getConfig());
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('appReducer and viewModels v2', () => {
  it('supports 2-step drawing wizard, draft photo attachments, email verification pending state, admin controls, and municipality-bounded optimistic score updates', () => {
    let state: AppState = appReducer(initialAppState, {
      type: 'CONFIG_LOADED',
      config: SAMPLE_CONFIG_WITH_ORTHO,
    });
    assert.equal(deriveMapControlsModel(state).isAdmin, false);

    // Step 1: Draw vertices -> ADVANCE_TO_DETAILS closes ring and enters 'details'
    state = appReducer(state, { type: 'START_DRAW' });
    assert.equal(state.mode, 'drawing');
    assert.equal(state.drawingStep, 'geometry');

    for (const pt of COURTYARD_VERTICES) {
      state = appReducer(state, { type: 'ADD_VERTEX', point: pt });
    }
    assert.equal(deriveDrawingToolbarModel(state).canAdvanceToDetails, true);

    state = appReducer(state, { type: 'ADVANCE_TO_DETAILS' });
    assert.equal(state.isRingClosed, true);
    assert.equal(state.drawingStep, 'details');

    // Attach a draft photo in Step 2, step back to geometry, then return to details
    const sampleDraftPhoto = {
      id: 'draft-1',
      previewUri: 'file:///tmp/site.jpg',
      file: {
        uri: 'file:///tmp/site.jpg',
        name: 'site.jpg',
        mimeType: 'image/jpeg',
      },
    };
    state = appReducer(state, {
      type: 'ADD_DRAFT_PHOTO',
      photo: sampleDraftPhoto,
    });
    assert.equal(state.draftPhotos.length, 1);

    state = appReducer(state, { type: 'BACK_TO_GEOMETRY' });
    assert.equal(state.drawingStep, 'geometry');
    assert.equal(state.isRingClosed, true);

    state = appReducer(state, { type: 'ADVANCE_TO_DETAILS' });
    assert.equal(state.drawingStep, 'details');

    // Anonymous SUBMIT_DRAFT queues payload + draft photos and opens register modal
    state = appReducer(state, { type: 'SUBMIT_DRAFT' });
    assert.equal(state.authModalOpen, true);
    assert.equal(state.authModalView, 'register');
    assert.equal(state.pendingIntent?.type, 'SUBMIT_DRAFT');
    if (state.pendingIntent?.type === 'SUBMIT_DRAFT') {
      assert.equal(state.pendingIntent.photos.length, 1);
    }

    // Registration sends email confirmation -> transitions to 'verify_pending' while preserving pendingIntent
    state = appReducer(state, {
      type: 'REGISTRATION_VERIFICATION_SENT',
      email: 'mapper@example.org',
      pseudonym: 'courtyard_mapper',
    });
    const verifyModal = deriveAuthModalModel(state);
    assert.equal(verifyModal.view, 'verify_pending');
    assert.equal(verifyModal.pendingVerificationEmail, 'mapper@example.org');
    assert.equal(verifyModal.hasPendingIntent, true);

    // User verifies email and signs in as Admin -> modal closes, isAdmin === true, pendingIntent ready
    state = appReducer(state, {
      type: 'AUTH_SUCCEEDED',
      user: SAMPLE_ADMIN_USER,
    });
    assert.equal(state.authModalOpen, false);
    assert.equal(deriveMapControlsModel(state).isAdmin, true);
    assert.equal(state.pendingIntent?.type, 'SUBMIT_DRAFT');

    // Municipality-bounded score updates: Hamburg (02000000) vs Mainz (07315000)
    const hhTop = makePolygonFeature({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      municipalityAgs: '02000000',
      municipalityName: 'Hamburg',
      score: 4,
      municipalityMaxScore: 4,
      municipalityNormalizedScore: 1,
    });
    const hhRunnerUp = makePolygonFeature({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      municipalityAgs: '02000000',
      municipalityName: 'Hamburg',
      score: 3,
      municipalityMaxScore: 4,
      municipalityNormalizedScore: 0.75,
    });
    const mainzTop = makePolygonFeature({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      municipalityAgs: '07315000',
      municipalityName: 'Mainz',
      score: 3,
      municipalityMaxScore: 3,
      municipalityNormalizedScore: 1,
    });

    state = appReducer(state, {
      type: 'POLYGON_CREATED',
      feature: hhTop,
    });
    state = appReducer(state, {
      type: 'VIEWPORT_FEATURES_LOADED',
      features: [hhTop, hhRunnerUp, mainzTop],
      truncated: false,
    });

    // Admin marks hhTop as 'in_progress' -> hhRunnerUp automatically rises from 0.75 to 1.0 in Hamburg while Mainz stays independent!
    state = appReducer(state, {
      type: 'POLYGON_UPDATED',
      feature: {
        ...hhTop,
        properties: {
          ...hhTop.properties,
          status: 'in_progress',
          finishedAt: null,
          municipalityMaxScore: 3,
          municipalityNormalizedScore: 0,
        },
      },
    });

    const runnerUpAfterInProgress = state.features.find((f) => f.id === hhRunnerUp.id);
    assert.equal(runnerUpAfterInProgress?.properties.municipalityNormalizedScore, 1);

    // Admin marks hhTop as 'finished' -> hhRunnerUp stays at 1.0 in Hamburg while Mainz stays independent!
    state = appReducer(state, {
      type: 'POLYGON_UPDATED',
      feature: {
        ...hhTop,
        properties: {
          ...hhTop.properties,
          status: 'finished',
          finishedAt: '2026-11-13T11:00:00.000Z',
          municipalityMaxScore: 3,
          municipalityNormalizedScore: 0,
        },
      },
    });

    const updatedRunnerUp = state.features.find((f) => f.id === hhRunnerUp.id);
    const updatedMainz = state.features.find((f) => f.id === mainzTop.id);
    assert.equal(updatedRunnerUp?.properties.municipalityNormalizedScore, 1);
    assert.equal(updatedMainz?.properties.municipalityNormalizedScore, 1);
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
    assert.equal(
      htmlProxyClient.getPrivacyPolicyUrl(),
      'https://maps.example.org/auth/privacy',
    );

    // Relative DOP20 urlTemplate and relative apkDownloadUrl resolve against origin
    const relativeConfigClient = new PpgisApiClient(
      'https://maps.example.org/api/v1/',
      mem,
      async () =>
        new Response(
          JSON.stringify({
            ...SAMPLE_CONFIG_NO_ORTHO,
            orthophoto: {
              urlTemplate: '/api/v1/tiles/dop20/{z}/{x}/{y}.png',
              tileSize: 256,
              attribution: '© GeoBasis-DE',
              bounds: [5.8, 47.2, 15.1, 55.1],
              maxZoom: 20,
            },
            apkDownloadUrl: '/downloads/unseal.apk',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    const resolvedCfg = await relativeConfigClient.getConfig();
    assert.equal(
      resolvedCfg.orthophoto?.urlTemplate,
      'https://maps.example.org/api/v1/tiles/dop20/{z}/{x}/{y}.png',
    );
    assert.equal(
      resolvedCfg.apkDownloadUrl,
      'https://maps.example.org/downloads/unseal.apk',
    );
  });

  it('orders comments with highest-rated comment always on top, pins top-rated nested replies, prunes deleted subtrees, and exercises PpgisApiClient comment endpoints', async () => {
    const rootLow: PolygonComment = {
      id: 'c0000000-0000-4000-8000-000000000001',
      polygonId: SAMPLE_POLYGON_ID,
      parentId: null,
      body: 'Initial question about drainage potential',
      authorPseudonym: 'citizen_a',
      isAuthor: false,
      upvotes: 2,
      myVote: 0,
      createdAt: '2026-11-13T10:00:00.000Z',
      updatedAt: '2026-11-13T10:00:00.000Z',
    };
    const rootMid: PolygonComment = {
      id: 'c0000000-0000-4000-8000-000000000002',
      polygonId: SAMPLE_POLYGON_ID,
      parentId: null,
      body: 'Soil beneath the asphalt is sandy gravel',
      authorPseudonym: 'citizen_b',
      isAuthor: false,
      upvotes: 5,
      myVote: 1,
      createdAt: '2026-11-13T11:00:00.000Z',
      updatedAt: '2026-11-13T11:00:00.000Z',
    };
    const replyTop: PolygonComment = {
      id: 'c0000000-0000-4000-8000-000000000003',
      polygonId: SAMPLE_POLYGON_ID,
      parentId: rootLow.id,
      body: 'Municipal stormwater map confirms zero utility lines here!',
      authorPseudonym: 'hydro_engineer',
      isAuthor: true,
      upvotes: 9,
      myVote: 1,
      createdAt: '2026-11-13T12:00:00.000Z',
      updatedAt: '2026-11-13T12:00:00.000Z',
    };
    const subReply: PolygonComment = {
      id: 'c0000000-0000-4000-8000-000000000004',
      polygonId: SAMPLE_POLYGON_ID,
      parentId: replyTop.id,
      body: 'Thanks for checking the cadastre!',
      authorPseudonym: 'citizen_a',
      isAuthor: false,
      upvotes: 1,
      myVote: 0,
      createdAt: '2026-11-13T12:30:00.000Z',
      updatedAt: '2026-11-13T12:30:00.000Z',
    };

    // Case 1: When a root comment has the highest rating, it sits first in roots and pinnedTopReply is null
    const rootTopModel = buildCommentDisplayModel([rootLow, rootMid]);
    assert.equal(rootTopModel.topCommentId, rootMid.id);
    assert.equal(rootTopModel.pinnedTopReply, null);
    assert.equal(rootTopModel.roots[0]?.comment.id, rootMid.id);
    assert.equal(rootTopModel.roots[1]?.comment.id, rootLow.id);

    // Case 2: When a nested reply has the highest rating overall, pinnedTopReply pins it at the top of the list
    const replyTopModel = buildCommentDisplayModel([
      rootLow,
      rootMid,
      replyTop,
      subReply,
    ]);
    assert.equal(replyTopModel.topCommentId, replyTop.id);
    assert.equal(replyTopModel.pinnedTopReply?.comment.id, replyTop.id);
    assert.equal(
      replyTopModel.pinnedTopReply?.parentAuthorPseudonym,
      'citizen_a',
    );
    assert.equal(replyTopModel.roots[0]?.comment.id, rootMid.id);
    assert.equal(replyTopModel.roots[1]?.comment.id, rootLow.id);
    assert.equal(replyTopModel.roots[1]?.replies[0]?.comment.id, replyTop.id);
    assert.equal(
      replyTopModel.roots[1]?.replies[0]?.replies[0]?.comment.id,
      subReply.id,
    );

    // Deleting rootLow prunes rootLow + replyTop + subReply transitively
    const pruned = pruneDeletedCommentSubtree(
      [rootLow, rootMid, replyTop, subReply],
      rootLow.id,
    );
    assert.deepEqual(
      pruned.map((c) => c.id),
      [rootMid.id],
    );

    // Reducer updates polygon commentCount via POLYGON_COMMENT_COUNT_SET
    let state: AppState = appReducer(initialAppState, {
      type: 'VIEWPORT_FEATURES_LOADED',
      features: [makePolygonFeature({ commentCount: 0 })],
      truncated: false,
    });
    state = appReducer(state, {
      type: 'POLYGON_COMMENT_COUNT_SET',
      polygonId: SAMPLE_POLYGON_ID,
      commentCount: 4,
    });
    assert.equal(state.features[0]?.properties.commentCount, 4);

    // PpgisApiClient comment methods send expected paths, methods, and bodies
    const mem = createMemorySessionStorage();
    await mem.setToken('tok-123');
    const calls: { method: string; url: string; body: string | null }[] = [];
    const client = new PpgisApiClient(
      'https://maps.example.org',
      mem,
      async (input, init) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        const body = typeof init?.body === 'string' ? init.body : null;
        calls.push({ method, url, body });

        if (method === 'GET' && url.endsWith('/comments')) {
          return new Response(
            JSON.stringify({
              polygonId: SAMPLE_POLYGON_ID,
              topCommentId: replyTop.id,
              comments: [replyTop, rootLow],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (method === 'POST' && url.endsWith('/comments')) {
          return new Response(JSON.stringify(replyTop), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.endsWith('/vote')) {
          return new Response(
            JSON.stringify({
              commentId: replyTop.id,
              polygonId: SAMPLE_POLYGON_ID,
              upvotes: method === 'PUT' ? 10 : 9,
              myVote: method === 'PUT' ? 1 : 0,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(null, { status: 204 });
      },
    );

    const listed = await client.listPolygonComments(SAMPLE_POLYGON_ID);
    assert.equal(listed.topCommentId, replyTop.id);

    const created = await client.createPolygonComment(SAMPLE_POLYGON_ID, {
      body: 'Municipal stormwater map confirms zero utility lines here!',
      parentId: rootLow.id,
    });
    assert.equal(created.parentId, rootLow.id);

    const upvoted = await client.putCommentVote(replyTop.id);
    assert.equal(upvoted.myVote, 1);
    assert.equal(calls[2]?.body, JSON.stringify({ value: 1 }));

    const cleared = await client.deleteCommentVote(replyTop.id);
    assert.equal(cleared.myVote, 0);

    await client.deleteComment(replyTop.id);
    assert.equal(calls[4]?.method, 'DELETE');
  });

  it('solves ALTCHA challenges in pure TypeScript and manages Carbon filter and flag state transitions', async () => {
    for (const sample of [
      '',
      'abc',
      'a'.repeat(137),
      'Prüfbedarf 🌍 Entsiegelung 2026!',
    ]) {
      assert.equal(
        sha256Hex(sample),
        crypto.createHash('sha256').update(sample, 'utf8').digest('hex'),
      );
      assert.equal(
        encodeUtf8Base64(sample),
        Buffer.from(sample, 'utf8').toString('base64'),
      );
    }

    const sampleSalt = 'salt-0123456789abcdef?expires=4102444800';
    const targetNumber = 17;
    const sampleChallengeHash = crypto
      .createHash('sha256')
      .update(`${sampleSalt}${targetNumber}`, 'utf8')
      .digest('hex');
    const sampleSignature = 'a'.repeat(64);
    const solvedBase64 = solveAltchaChallengeClient({
      algorithm: 'SHA-256',
      challenge: sampleChallengeHash,
      maxnumber: 100,
      salt: sampleSalt,
      signature: sampleSignature,
    });
    const decodedSolved = JSON.parse(
      Buffer.from(solvedBase64, 'base64').toString('utf8'),
    ) as {
      algorithm: string;
      challenge: string;
      number: number;
      salt: string;
      signature: string;
    };
    assert.equal(decodedSolved.number, targetNumber);
    assert.equal(decodedSolved.challenge, sampleChallengeHash);

    // 1) Proactive ALTCHA solve after getConfig() sets authCaptchaRequired: true
    const mem = createMemorySessionStorage();
    await mem.setToken('tok_flag_tester');
    const calls: { method: string; url: string; body: string | null }[] = [];
    let requireRetryPath = false;

    const client = new PpgisApiClient(
      'https://maps.example.org',
      mem,
      async (input, init) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        const body = typeof init?.body === 'string' ? init.body : null;
        calls.push({ method, url, body });

        if (method === 'GET' && url.endsWith('/api/v1/config')) {
          return new Response(
            JSON.stringify({
              ...SAMPLE_CONFIG_WITH_ORTHO,
              authCaptchaRequired: true,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (method === 'GET' && url.endsWith('/api/v1/auth/challenge')) {
          return new Response(
            JSON.stringify({
              algorithm: 'SHA-256',
              challenge: sampleChallengeHash,
              maxnumber: 100,
              salt: sampleSalt,
              signature: sampleSignature,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (method === 'POST' && url.endsWith('/api/v1/auth/register')) {
          const parsedBody = JSON.parse(body ?? '{}') as {
            pseudonym: string;
            email: string;
            altchaPayload?: string;
          };
          if (requireRetryPath && !parsedBody.altchaPayload) {
            return new Response(
              JSON.stringify({
                error: {
                  code: 'AUTH_CAPTCHA_REQUIRED',
                  message: 'Verification required',
                  requestId: 'req-captcha-1',
                },
              }),
              { status: 422, headers: { 'Content-Type': 'application/json' } },
            );
          }
          assert.equal(parsedBody.altchaPayload, solvedBase64);
          return new Response(
            JSON.stringify({
              status: 'verification_email_sent',
              email: parsedBody.email,
              pseudonym: parsedBody.pseudonym,
            } satisfies RegisterResponse),
            { status: 202, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (method === 'GET' && url.includes('/api/v1/polygons?')) {
          return new Response(
            JSON.stringify({
              type: 'FeatureCollection',
              features: [],
              meta: { truncated: false, limit: 500 },
            } satisfies PolygonCollectionResponse),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (url.endsWith(`/api/v1/polygons/${SAMPLE_POLYGON_ID}/flag`)) {
          return new Response(
            JSON.stringify({
              polygonId: SAMPLE_POLYGON_ID,
              flagCount: method === 'POST' ? 2 : 1,
              isFlagged: true,
              myFlag: method === 'POST',
              myFlagReason: method === 'POST' ? 'already_unsealed' : null,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (url.endsWith(`/api/v1/polygons/${SAMPLE_POLYGON_ID}/flags`)) {
          return new Response(
            JSON.stringify({
              polygonId: SAMPLE_POLYGON_ID,
              flagCount: 0,
              isFlagged: false,
              myFlag: false,
              myFlagReason: null,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(null, { status: 204 });
      },
    );

    const loadedCfg = await client.getConfig();
    assert.equal(loadedCfg.authCaptchaRequired, true);
    const regProactive = await client.register({
      pseudonym: 'proactive_user',
      email: 'proactive@example.org',
      password: 'strong-password-123',
      acceptedPrivacyPolicy: true,
      acceptedTerms: true,
    });
    assert.equal(regProactive.status, 'verification_email_sent');

    // 2) Fallback retry when register() is called before getConfig() and server returns 422 AUTH_CAPTCHA_REQUIRED
    requireRetryPath = true;
    const coldClient = new PpgisApiClient(
      'https://maps.example.org',
      mem,
      client['fetchImpl'],
    );
    const regCold = await coldClient.register({
      pseudonym: 'cold_user',
      email: 'cold@example.org',
      password: 'strong-password-123',
      acceptedPrivacyPolicy: true,
      acceptedTerms: true,
    });
    assert.equal(regCold.status, 'verification_email_sent');

    // 3) listPolygons filter query parameters + flag/unflag/clearPolygonFlags endpoints
    calls.length = 0;
    await client.listPolygons({
      minLng: 9.99,
      minLat: 53.55,
      maxLng: 10.0,
      maxLat: 53.56,
    });
    assert.equal(
      calls[0]?.url,
      'https://maps.example.org/api/v1/polygons?bbox=9.99%2C53.55%2C10%2C53.56',
    );

    await client.listPolygons(
      { minLng: 9.99, minLat: 53.55, maxLng: 10.0, maxLat: 53.56 },
      { filter: 'new' },
    );
    assert.equal(
      calls[1]?.url,
      'https://maps.example.org/api/v1/polygons?bbox=9.99%2C53.55%2C10%2C53.56&filter=new',
    );

    await client.listPolygons(
      { minLng: 9.99, minLat: 53.55, maxLng: 10.0, maxLat: 53.56 },
      { filter: 'needs_review' },
    );
    assert.equal(
      calls[2]?.url,
      'https://maps.example.org/api/v1/polygons?bbox=9.99%2C53.55%2C10%2C53.56&filter=needs_review',
    );

    const flaggedRes = await client.flagPolygon(SAMPLE_POLYGON_ID, {
      reason: 'already_unsealed',
      note: 'Aerial imagery shows lawn',
    });
    assert.equal(flaggedRes.myFlag, true);
    assert.equal(flaggedRes.flagCount, 2);

    const unflaggedRes = await client.unflagPolygon(SAMPLE_POLYGON_ID);
    assert.equal(unflaggedRes.myFlag, false);
    assert.equal(unflaggedRes.flagCount, 1);

    const clearedFlagsRes = await client.clearPolygonFlags(SAMPLE_POLYGON_ID);
    assert.equal(clearedFlagsRes.flagCount, 0);
    assert.equal(clearedFlagsRes.isFlagged, false);

    // 4) appReducer filter & flag transitions + logout / account deletion flag cleanup
    const authoredNewPoly = makePolygonFeature({
      id: 'aaaa1111-1111-4111-8111-111111111111',
      isAuthor: true,
      authorIsNewUser: true,
      authorRecentlyActive: true,
    });
    const otherPoly = makePolygonFeature({
      id: SAMPLE_POLYGON_ID,
      isAuthor: false,
      authorPseudonym: 'other_mapper',
      flagCount: 0,
      isFlagged: false,
      myFlag: false,
    });

    let state: AppState = appReducer(initialAppState, {
      type: 'CONFIG_LOADED',
      config: SAMPLE_CONFIG_WITH_ORTHO,
    });
    state = appReducer(state, {
      type: 'AUTH_SUCCEEDED',
      user: SAMPLE_USER,
    });
    state = appReducer(state, {
      type: 'VIEWPORT_FEATURES_LOADED',
      features: [authoredNewPoly, otherPoly],
      truncated: false,
    });

    // Single-choice filter transitions (mutually exclusive: selecting one replaces previous)
    assert.equal(deriveMapControlsModel(state).polygonFilter, 'all');
    state = appReducer(state, {
      type: 'SET_POLYGON_FILTER',
      filter: 'new',
    });
    assert.equal(deriveMapControlsModel(state).polygonFilter, 'new');
    state = appReducer(state, {
      type: 'SET_POLYGON_FILTER',
      filter: 'established',
    });
    assert.equal(deriveMapControlsModel(state).polygonFilter, 'established');
    state = appReducer(state, {
      type: 'SET_POLYGON_FILTER',
      filter: 'needs_review',
    });
    const controls = deriveMapControlsModel(state);
    assert.equal(controls.polygonFilter, 'needs_review');

    state = appReducer(state, {
      type: 'POLYGON_FLAG_UPDATED',
      flag: {
        polygonId: SAMPLE_POLYGON_ID,
        flagCount: 1,
        isFlagged: true,
        myFlag: true,
        myFlagReason: 'implausible',
      },
    });
    const updatedOther = state.features.find((f) => f.id === SAMPLE_POLYGON_ID);
    assert.equal(updatedOther?.properties.flagCount, 1);
    assert.equal(updatedOther?.properties.isFlagged, true);
    assert.equal(updatedOther?.properties.myFlag, true);

    const loggedOutState = appReducer(state, { type: 'LOGOUT_SUCCEEDED' });
    const loggedOutOther = loggedOutState.features.find(
      (f) => f.id === SAMPLE_POLYGON_ID,
    );
    assert.equal(loggedOutOther?.properties.flagCount, 1);
    assert.equal(loggedOutOther?.properties.isFlagged, true);
    assert.equal(loggedOutOther?.properties.myFlag, false);

    const deletedState = appReducer(state, { type: 'ACCOUNT_DELETED' });
    const deletedAuthored = deletedState.features.find(
      (f) => f.id === authoredNewPoly.id,
    );
    assert.equal(deletedAuthored?.properties.authorPseudonym, 'deleted');
    assert.equal(deletedAuthored?.properties.authorIsNewUser, false);
    assert.equal(deletedAuthored?.properties.authorRecentlyActive, null);
    const deletedOther = deletedState.features.find(
      (f) => f.id === SAMPLE_POLYGON_ID,
    );
    assert.equal(deletedOther?.properties.flagCount, 0);
    assert.equal(deletedOther?.properties.isFlagged, false);
    assert.equal(deletedOther?.properties.myFlag, false);

    // CAST_VOTE reducer ignores self-votes and non-proposed ('in_progress' / 'finished') polygons
    const anonWithBlockedPolygons = appReducer(
      appReducer(initialAppState, {
        type: 'CONFIG_LOADED',
        config: SAMPLE_CONFIG_WITH_ORTHO,
      }),
      {
        type: 'VIEWPORT_FEATURES_LOADED',
        features: [
          authoredNewPoly,
          makePolygonFeature({
            id: '55555555-5555-4555-8555-555555555555',
            isAuthor: false,
            status: 'in_progress',
          }),
          makePolygonFeature({
            id: '66666666-6666-4666-8666-666666666666',
            isAuthor: false,
            status: 'finished',
          }),
        ],
        truncated: false,
      },
    );

    const afterSelfVoteAttempt = appReducer(anonWithBlockedPolygons, {
      type: 'CAST_VOTE',
      polygonId: authoredNewPoly.id,
      value: 1,
    });
    assert.equal(afterSelfVoteAttempt.authModalOpen, false);
    assert.equal(afterSelfVoteAttempt.pendingIntent, null);

    const afterInProgressVoteAttempt = appReducer(anonWithBlockedPolygons, {
      type: 'CAST_VOTE',
      polygonId: '55555555-5555-4555-8555-555555555555',
      value: 1,
    });
    assert.equal(afterInProgressVoteAttempt.authModalOpen, false);
    assert.equal(afterInProgressVoteAttempt.pendingIntent, null);

    const afterFinishedVoteAttempt = appReducer(anonWithBlockedPolygons, {
      type: 'CAST_VOTE',
      polygonId: '66666666-6666-4666-8666-666666666666',
      value: -1,
    });
    assert.equal(afterFinishedVoteAttempt.authModalOpen, false);
    assert.equal(afterFinishedVoteAttempt.pendingIntent, null);
  });
});
