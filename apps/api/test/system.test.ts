import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { after, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { z } from 'zod';

import {
  ApiErrorEnvelopeSchema,
  HealthResponseSchema,
  RuntimeConfigSchema,
} from '@entsiegelung/shared';

import { buildApp } from '../src/app.js';
import { loadEnvConfig } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';
import { createDbPool } from '../src/db/pool.js';
import { resetTestDb, setupTestDb } from '../src/db/testHarness.js';
import { createLogger } from '../src/logger.js';
import { normalizeRateLimitIp } from '../src/util/rateLimit.js';
import { BoundedSemaphore } from '../src/util/semaphore.js';

import type pg from 'pg';

describe('PPGIS-2: PostGIS migrations, runtime config, health, logger redaction, and API guards', () => {
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

  it('applies 001..008 migrations idempotently and resetTestDb truncates all application tables', async () => {
    const secondRun = await runMigrations(pool);
    assert.equal(secondRun.applied.length, 0);
    assert.equal(secondRun.totalApplied, 8);

    const indexRes = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
    );
    const indexNames = new Set(indexRes.rows.map((r) => r.indexname));
    for (const expectedIndex of [
      'idx_users_pseudonym_lower',
      'idx_sessions_user_id',
      'idx_polygons_geom',
      'idx_polygons_user_created',
      'idx_polygons_score_created',
      'idx_polygons_created_id',
      'idx_polygon_creations_user_created',
      'idx_votes_user_id',
    ]) {
      assert.ok(indexNames.has(expectedIndex), `Expected index ${expectedIndex} to exist`);
    }

    const userRes = await pool.query<{ id: string }>(
      `INSERT INTO users (pseudonym, password_hash, recovery_code_hash)
       VALUES ('TestMapper', '$argon2id$v=19$m=19456,t=2,p=1$salt$hash', decode('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff', 'hex'))
       RETURNING id`,
    );
    const userId = userRes.rows[0]!.id;

    await pool.query(
      `INSERT INTO reserved_pseudonyms (pseudonym_hash, reason)
       VALUES (decode('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'hex'), 'self_deleted')`,
    );
    await pool.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES ($1, decode('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'hex'), NOW() + INTERVAL '30 days')`,
      [userId],
    );
    const polyRes = await pool.query<{ id: string }>(
      `INSERT INTO polygons (user_id, geom, surface_type, note, area_m2)
       VALUES (
         $1,
         ST_GeomFromText('POLYGON((9.993 53.551, 9.9932 53.551, 9.9932 53.5512, 9.993 53.5512, 9.993 53.551))', 4326),
         'asphalt',
         'Courtyard',
         120.5
       )
       RETURNING id`,
      [userId],
    );
    const polygonId = polyRes.rows[0]!.id;

    await pool.query(`INSERT INTO polygon_creations (user_id) VALUES ($1)`, [userId]);
    await pool.query(
      `INSERT INTO votes (polygon_id, user_id, value) VALUES ($1, $2, 1)`,
      [polygonId, userId],
    );

    await resetTestDb(pool);

    const countsRes = await pool.query<{
      users_cnt: number;
      reserved_cnt: number;
      sessions_cnt: number;
      polygons_cnt: number;
      creations_cnt: number;
      votes_cnt: number;
      migrations_cnt: number;
    }>(`
      SELECT
        (SELECT COUNT(*)::int FROM users) AS users_cnt,
        (SELECT COUNT(*)::int FROM reserved_pseudonyms) AS reserved_cnt,
        (SELECT COUNT(*)::int FROM sessions) AS sessions_cnt,
        (SELECT COUNT(*)::int FROM polygons) AS polygons_cnt,
        (SELECT COUNT(*)::int FROM polygon_creations) AS creations_cnt,
        (SELECT COUNT(*)::int FROM votes) AS votes_cnt,
        (SELECT COUNT(*)::int FROM schema_migrations) AS migrations_cnt
    `);
    const counts = countsRes.rows[0]!;
    assert.equal(counts.users_cnt, 0);
    assert.equal(counts.reserved_cnt, 0);
    assert.equal(counts.sessions_cnt, 0);
    assert.equal(counts.polygons_cnt, 0);
    assert.equal(counts.creations_cnt, 0);
    assert.equal(counts.votes_cnt, 0);
    assert.equal(counts.migrations_cnt, 8);
  });

  it('GET /api/v1/health returns 200 against live PostGIS and 503 SERVICE_UNAVAILABLE when DB fails or migrations are incomplete', async () => {
    const config = loadEnvConfig({});
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
    });

    try {
      const okRes = await app.inject({
        method: 'GET',
        url: '/api/v1/health',
      });
      assert.equal(okRes.statusCode, 200);
      assert.ok(okRes.headers['x-request-id']);
      const health = HealthResponseSchema.parse(okRes.json());
      assert.equal(health.status, 'ok');
      assert.equal(health.migrationsApplied, 8);
      assert.match(health.postgisVersion, /^3\./);
    } finally {
      await app.close();
    }

    // DB query failure -> 503 SERVICE_UNAVAILABLE with matching x-request-id and error.requestId
    const brokenPool = createDbPool('postgresql://ppgis:ppgis@127.0.0.1:1/ppgis', {
      connectionTimeoutMillis: 250,
    });
    const brokenApp = await buildApp(config, brokenPool, {
      logger: createLogger({ enabled: false }),
    });
    try {
      const failRes = await brokenApp.inject({
        method: 'GET',
        url: '/api/v1/health',
      });
      assert.equal(failRes.statusCode, 503);
      const reqIdHeader = failRes.headers['x-request-id'];
      assert.equal(typeof reqIdHeader, 'string');
      const errBody = ApiErrorEnvelopeSchema.parse(failRes.json());
      assert.equal(errBody.error.code, 'SERVICE_UNAVAILABLE');
      assert.equal(errBody.error.requestId, reqIdHeader);
    } finally {
      await brokenApp.close();
      await brokenPool.end();
    }

    // Pending unapplied migration file -> 503 SERVICE_UNAVAILABLE
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ppgis-mig-'));
    try {
      const mig1Path = fileURLToPath(
        new URL('../migrations/001_initial_schema.sql', import.meta.url),
      );
      const mig2Path = fileURLToPath(
        new URL('../migrations/002_v2_features.sql', import.meta.url),
      );
      const mig3Path = fileURLToPath(
        new URL('../migrations/003_v3_adjustments.sql', import.meta.url),
      );
      const mig4Path = fileURLToPath(
        new URL('../migrations/004_polygon_comments.sql', import.meta.url),
      );
      const mig5Path = fileURLToPath(
        new URL('../migrations/005_carbon_anti_spam.sql', import.meta.url),
      );
      const mig6Path = fileURLToPath(
        new URL('../migrations/006_backfill_last_login.sql', import.meta.url),
      );
      const mig7Path = fileURLToPath(
        new URL('../migrations/007_legal_terms_consent.sql', import.meta.url),
      );
      const mig8Path = fileURLToPath(
        new URL('../migrations/008_privacy_hardening.sql', import.meta.url),
      );
      await fs.copyFile(mig1Path, path.join(tmpDir, '001_initial_schema.sql'));
      await fs.copyFile(mig2Path, path.join(tmpDir, '002_v2_features.sql'));
      await fs.copyFile(mig3Path, path.join(tmpDir, '003_v3_adjustments.sql'));
      await fs.copyFile(mig4Path, path.join(tmpDir, '004_polygon_comments.sql'));
      await fs.copyFile(mig5Path, path.join(tmpDir, '005_carbon_anti_spam.sql'));
      await fs.copyFile(mig6Path, path.join(tmpDir, '006_backfill_last_login.sql'));
      await fs.copyFile(mig7Path, path.join(tmpDir, '007_legal_terms_consent.sql'));
      await fs.copyFile(mig8Path, path.join(tmpDir, '008_privacy_hardening.sql'));
      await fs.writeFile(path.join(tmpDir, '009_pending.sql'), 'SELECT 1;\n', 'utf8');

      const unmigratedApp = await buildApp(config, pool, {
        logger: createLogger({ enabled: false }),
        migrationsDir: tmpDir,
      });
      try {
        const res = await unmigratedApp.inject({
          method: 'GET',
          url: '/api/v1/health',
        });
        assert.equal(res.statusCode, 503);
        const parsed = ApiErrorEnvelopeSchema.parse(res.json());
        assert.equal(parsed.error.code, 'SERVICE_UNAVAILABLE');
        assert.equal(parsed.error.requestId, res.headers['x-request-id']);
      } finally {
        await unmigratedApp.close();
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('maps 404 unknown routes, malformed JSON, >64 KiB payloads, ZodError, rate limits, and 500 errors to ApiErrorEnvelope', async () => {
    const config = loadEnvConfig({});
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
    });

    const BodyEchoSchema = z.object({ count: z.number().int().positive() }).strict();
    app.post(
      '/api/v1/test-echo',
      {
        config: {
          rateLimit: {
            max: 2,
            timeWindow: '1 minute',
          },
        },
      },
      async (req) => {
        return BodyEchoSchema.parse(req.body);
      },
    );
    app.get('/api/v1/test-boom', async () => {
      throw new Error('secret-db-internal-detail');
    });

    try {
      // 404 unknown route
      const notFoundRes = await app.inject({
        method: 'GET',
        url: '/api/v1/unknown-endpoint',
      });
      assert.equal(notFoundRes.statusCode, 404);
      const notFoundEnv = ApiErrorEnvelopeSchema.parse(notFoundRes.json());
      assert.equal(notFoundEnv.error.code, 'NOT_FOUND');
      assert.equal(notFoundEnv.error.requestId, notFoundRes.headers['x-request-id']);

      // 400 malformed JSON body
      const badJsonRes = await app.inject({
        method: 'POST',
        url: '/api/v1/test-echo',
        headers: { 'content-type': 'application/json' },
        remoteAddress: '198.51.100.10',
        payload: '{"count": ',
      });
      assert.equal(badJsonRes.statusCode, 400);
      const badJsonEnv = ApiErrorEnvelopeSchema.parse(badJsonRes.json());
      assert.equal(badJsonEnv.error.code, 'VALIDATION_ERROR');
      assert.equal(badJsonEnv.error.requestId, badJsonRes.headers['x-request-id']);

      // 413 payload > 64 KiB (65536 bytes)
      const hugePayload = JSON.stringify({ filler: 'x'.repeat(70_000) });
      const tooLargeRes = await app.inject({
        method: 'POST',
        url: '/api/v1/test-echo',
        headers: { 'content-type': 'application/json' },
        remoteAddress: '198.51.100.11',
        payload: hugePayload,
      });
      assert.equal(tooLargeRes.statusCode, 413);
      const tooLargeEnv = ApiErrorEnvelopeSchema.parse(tooLargeRes.json());
      assert.equal(tooLargeEnv.error.code, 'PAYLOAD_TOO_LARGE');
      assert.equal(tooLargeEnv.error.requestId, tooLargeRes.headers['x-request-id']);

      // 422 ZodError
      const zodRes = await app.inject({
        method: 'POST',
        url: '/api/v1/test-echo',
        remoteAddress: '198.51.100.12',
        payload: { count: -5 },
      });
      assert.equal(zodRes.statusCode, 422);
      const zodEnv = ApiErrorEnvelopeSchema.parse(zodRes.json());
      assert.equal(zodEnv.error.code, 'VALIDATION_ERROR');

      // 429 RATE_LIMITED collapsing IPv6 /64 hosts to the same bucket
      const ipv6HostA = '2001:db8:abcd:0042:1111:2222:3333:4444';
      const ipv6HostB = '2001:0DB8:ABCD:42:9999:8888:7777:6666';
      const rl1 = await app.inject({
        method: 'POST',
        url: '/api/v1/test-echo',
        remoteAddress: ipv6HostA,
        payload: { count: 1 },
      });
      assert.equal(rl1.statusCode, 200);
      const rl2 = await app.inject({
        method: 'POST',
        url: '/api/v1/test-echo',
        remoteAddress: ipv6HostB,
        payload: { count: 2 },
      });
      assert.equal(rl2.statusCode, 200);
      const rl3 = await app.inject({
        method: 'POST',
        url: '/api/v1/test-echo',
        remoteAddress: ipv6HostB,
        payload: { count: 3 },
      });
      assert.equal(rl3.statusCode, 429);
      const rlEnv = ApiErrorEnvelopeSchema.parse(rl3.json());
      assert.equal(rlEnv.error.code, 'RATE_LIMITED');
      assert.equal(rlEnv.error.requestId, rl3.headers['x-request-id']);

      // 500 fallback does not leak internal error message
      const boomRes = await app.inject({
        method: 'GET',
        url: '/api/v1/test-boom',
      });
      assert.equal(boomRes.statusCode, 500);
      const boomEnv = ApiErrorEnvelopeSchema.parse(boomRes.json());
      assert.equal(boomEnv.error.code, 'INTERNAL_ERROR');
      assert.equal(boomEnv.error.requestId, boomRes.headers['x-request-id']);
      assert.ok(!boomEnv.error.message.includes('secret-db-internal-detail'));
    } finally {
      await app.close();
    }
  });

  it('GET /api/v1/config serves clean-checkout defaults, supports XYZ & WMS orthophoto templates, and rejects invalid templates/bounds', async () => {
    const defaultConfig = loadEnvConfig({});
    const defaultApp = await buildApp(defaultConfig, pool, {
      logger: createLogger({ enabled: false }),
    });

    try {
      const res = await defaultApp.inject({
        method: 'GET',
        url: '/api/v1/config',
      });
      assert.equal(res.statusCode, 200);
      assert.ok(res.headers['x-request-id']);
      const cfg = RuntimeConfigSchema.parse(res.json());
      assert.equal(cfg.osmStyleUrl, 'https://tiles.openfreemap.org/styles/liberty');
      assert.ok(cfg.orthophoto);
      assert.equal(cfg.orthophoto.urlTemplate, '/api/v1/tiles/dop20/{z}/{x}/{y}.png');
      assert.equal(cfg.orthophoto.tileSize, 256);
      assert.equal(cfg.orthophoto.maxZoom, 20);
      assert.match(cfg.orthophoto.attribution, /GeoBasis-DE/);
      // Clean checkout has no APK (returns null); if a local dev release APK is built, it is advertised with SHA-256
      if (cfg.apkDownloadUrl === null) {
        assert.equal(cfg.apkSha256, null);
      } else {
        assert.equal(cfg.apkDownloadUrl, '/downloads/unseal.apk');
        assert.match(String(cfg.apkSha256), /^[a-f0-9]{64}$/);
      }
      assert.equal(cfg.impressumUrl, 'http://127.0.0.1:3000/auth/impressum');
      assert.equal(cfg.termsUrl, 'http://127.0.0.1:3000/auth/terms');
      assert.equal(cfg.licensesUrl, 'http://127.0.0.1:3000/auth/licenses');
      assert.equal(cfg.sourceCodeUrl, 'https://github.com/severinbro/Unseal');
      assert.deepEqual(cfg.initialView, {
        lng: 8.2739,
        lat: 49.9989,
        zoom: 15,
      });
      assert.deepEqual(cfg.limits, {
        minAreaM2: 2,
        maxAreaM2: 20_000,
        maxVertices: 200,
        maxPolygonSpanDeg: 0.05,
        maxBboxSpanDeg: 0.15,
        bboxFeatureLimit: 500,
        maxDailyPolygonsPerUser: 25,
      });
      assert.equal(
        cfg.disclaimerText,
        'Community unsealing suggestions - non-binding public input, regardless of property ownership.',
      );
      assert.equal(cfg.abuseContact, null);
    } finally {
      await defaultApp.close();
    }

    // Explicit opt-out ('none') disables built-in DOP20 orthophoto and APK download link
    const disabledExtrasCfg = loadEnvConfig({
      ORTHOPHOTO_URL_TEMPLATE: 'none',
      APK_DOWNLOAD_URL: 'none',
    });
    assert.equal(disabledExtrasCfg.orthophoto, null);
    assert.equal(disabledExtrasCfg.apkDownloadUrl, null);

    // XYZ {z}/{x}/{y} template + 512 tileSize + bounds + abuseContact
    const xyzConfig = loadEnvConfig({
      ORTHOPHOTO_URL_TEMPLATE: 'https://tiles.example.org/dop/{z}/{x}/{y}.jpg',
      ORTHOPHOTO_TILE_SIZE: '512',
      ORTHOPHOTO_ATTRIBUTION: '© Municipal Geodata',
      ORTHOPHOTO_BOUNDS: '9.70,53.35,10.35,53.75',
      ORTHOPHOTO_MAX_ZOOM: '19',
      ABUSE_CONTACT: 'moderation@example.org',
    });
    const xyzApp = await buildApp(xyzConfig, pool, {
      logger: createLogger({ enabled: false }),
    });
    try {
      const res = await xyzApp.inject({ method: 'GET', url: '/api/v1/config' });
      assert.equal(res.statusCode, 200);
      const cfg = RuntimeConfigSchema.parse(res.json());
      assert.deepEqual(cfg.orthophoto, {
        urlTemplate: 'https://tiles.example.org/dop/{z}/{x}/{y}.jpg',
        tileSize: 512,
        attribution: '© Municipal Geodata',
        bounds: [9.7, 53.35, 10.35, 53.75],
        maxZoom: 19,
      });
      assert.equal(cfg.abuseContact, 'moderation@example.org');
    } finally {
      await xyzApp.close();
    }

    // WMS {bbox-epsg-3857} template without bounds
    const wmsConfig = loadEnvConfig({
      ORTHOPHOTO_URL_TEMPLATE:
        'https://wms.example.org/service?SERVICE=WMS&CRS=EPSG:3857&BBOX={bbox-epsg-3857}',
    });
    const wmsApp = await buildApp(wmsConfig, pool, {
      logger: createLogger({ enabled: false }),
    });
    try {
      const res = await wmsApp.inject({ method: 'GET', url: '/api/v1/config' });
      assert.equal(res.statusCode, 200);
      const cfg = RuntimeConfigSchema.parse(res.json());
      assert.ok(cfg.orthophoto);
      assert.equal(
        cfg.orthophoto.urlTemplate,
        'https://wms.example.org/service?SERVICE=WMS&CRS=EPSG:3857&BBOX={bbox-epsg-3857}',
      );
      assert.equal(cfg.orthophoto.tileSize, 256);
      assert.equal(cfg.orthophoto.bounds, null);
    } finally {
      await wmsApp.close();
    }

    // Invalid orthophoto templates, tile sizes, and bounds throw descriptive errors
    assert.throws(
      () =>
        loadEnvConfig({
          ORTHOPHOTO_URL_TEMPLATE: 'https://tiles.example.org/static-image.jpg',
        }),
      /\{z\}\/\{x\}\/\{y\}|\{bbox-epsg-3857\}/,
    );
    assert.throws(
      () =>
        loadEnvConfig({
          ORTHOPHOTO_URL_TEMPLATE: 'https://tiles.example.org/{z}/{x}/{y}.png',
          ORTHOPHOTO_TILE_SIZE: '128',
        }),
      /256|512/,
    );
    assert.throws(
      () =>
        loadEnvConfig({
          ORTHOPHOTO_URL_TEMPLATE: 'https://tiles.example.org/{z}/{x}/{y}.png',
          ORTHOPHOTO_BOUNDS: '10.5,53.5,9.5,53.9',
        }),
      /bounds/i,
    );
  });

  it('createLogger omits client IPs, headers and query strings and redacts authorization, password, newPassword, recoveryCode, and sessionToken', async () => {
    const stream = new PassThrough();
    const lines: string[] = [];
    stream.on('data', (chunk: Buffer) => {
      lines.push(chunk.toString('utf8'));
    });

    const logger = createLogger({ stream, level: 'info' });
    const reqHeaders = {
      authorization: 'Bearer secret-bearer-value-123',
      'user-agent': 'ppgis-test-agent/1.0',
      'x-forwarded-for': '198.51.100.23, 10.0.0.2',
      'x-real-ip': '198.51.100.24',
      referer: 'https://referrer.example/private-page',
    };

    logger.info(
      {
        req: {
          id: 'req-42',
          method: 'POST',
          url: '/api/v1/auth/recover?q=Musterstrasse%2012&token=email-action-token-777',
          remoteAddress: '203.0.113.99',
          remotePort: 54123,
          headers: reqHeaders,
        },
        body: {
          pseudonym: 'CitizenOne',
          password: 'super-secret-password',
          newPassword: 'even-newer-secret-password',
          recoveryCode: 'ABCD-EF01-2345-6789-ABCD-EF01-2345-6789',
        },
        authResult: {
          sessionToken: 'raw-session-token-999',
        },
      },
      'Simulated auth event',
    );

    logger.info(
      {
        authorization: 'Bearer top-level-secret',
        password: 'top-level-password',
        newPassword: 'top-level-new-password',
        recoveryCode: 'top-level-recovery-code',
        sessionToken: 'top-level-session-token',
      },
      'Top-level fields check',
    );

    // Caller's live headers object must never be mutated by redaction
    assert.equal(reqHeaders.authorization, 'Bearer secret-bearer-value-123');

    const combinedOutput = lines.join('');
    for (const forbidden of [
      '203.0.113.99',
      '198.51.100.23',
      '198.51.100.24',
      'ppgis-test-agent',
      'referrer.example',
      'Musterstrasse',
      'email-action-token-777',
      'secret-bearer-value-123',
      'super-secret-password',
      'even-newer-secret-password',
      'ABCD-EF01-2345-6789-ABCD-EF01-2345-6789',
      'raw-session-token-999',
      'top-level-secret',
      'top-level-password',
      'top-level-new-password',
      'top-level-recovery-code',
      'top-level-session-token',
    ]) {
      assert.ok(
        !combinedOutput.includes(forbidden),
        `Expected logger output not to contain "${forbidden}"`,
      );
    }

    const parsedLines = combinedOutput
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const firstRecord = parsedLines[0]!;
    const serializedReq = firstRecord.req as Record<string, unknown>;
    assert.equal('remoteAddress' in serializedReq, false);
    assert.equal('remotePort' in serializedReq, false);
    assert.equal('headers' in serializedReq, false);
    assert.equal(serializedReq.url, '/api/v1/auth/recover');
    assert.equal(serializedReq.method, 'POST');
    assert.equal(serializedReq.id, 'req-42');
    assert.equal((firstRecord.body as Record<string, unknown>).password, '[Redacted]');
    assert.equal((firstRecord.body as Record<string, unknown>).newPassword, '[Redacted]');
    assert.equal((firstRecord.body as Record<string, unknown>).recoveryCode, '[Redacted]');
    assert.equal(
      (firstRecord.authResult as Record<string, unknown>).sessionToken,
      '[Redacted]',
    );
  });

  it('Fastify request logs behind a reverse proxy contain no client IP, user agent, referer or query string', async () => {
    const stream = new PassThrough();
    const lines: string[] = [];
    stream.on('data', (chunk: Buffer) => {
      lines.push(chunk.toString('utf8'));
    });

    const config = loadEnvConfig({ TRUST_PROXY: 'true' });
    const app = await buildApp(config, pool, {
      logger: createLogger({ stream, level: 'info' }),
    });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/health?q=Musterstrasse%2012',
        headers: {
          'x-forwarded-for': '198.51.100.77',
          'user-agent': 'proxied-agent/9.9',
          referer: 'https://referrer.example/secret',
        },
      });
      assert.equal(res.statusCode, 200);
    } finally {
      await app.close();
    }

    const combinedOutput = lines.join('');
    assert.match(combinedOutput, /incoming request/);
    assert.match(combinedOutput, /"url":"\/api\/v1\/health"/);
    for (const forbidden of [
      '198.51.100.77',
      'proxied-agent',
      'referrer.example',
      'Musterstrasse',
      'remoteAddress',
    ]) {
      assert.ok(
        !combinedOutput.includes(forbidden),
        `Expected request log not to contain "${forbidden}"`,
      );
    }
  });

  it('BoundedSemaphore enforces maxConcurrent + maxQueue with parameterized ErrorCode and normalizeRateLimitIp collapses IPv6 /64', async () => {
    const sem = new BoundedSemaphore(2, 1, 'AUTH_BUSY');
    const order: string[] = [];

    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });

    const p1 = sem.run(async () => {
      order.push('start-1');
      await firstGate;
      order.push('end-1');
      return 1;
    });
    const p2 = sem.run(async () => {
      order.push('start-2');
      await secondGate;
      order.push('end-2');
      return 2;
    });
    const p3 = sem.run(async () => {
      order.push('start-3');
      return 3;
    });

    assert.equal(sem.active, 2);
    assert.equal(sem.queued, 1);

    await assert.rejects(
      () => sem.run(async () => 4),
      (err: unknown) => {
        assert.equal((err as { statusCode?: number }).statusCode, 503);
        assert.equal((err as { code?: string }).code, 'AUTH_BUSY');
        return true;
      },
    );

    releaseFirst();
    assert.equal(await p1, 1);
    assert.equal(await p3, 3);
    releaseSecond();
    assert.equal(await p2, 2);
    assert.equal(sem.active, 0);
    assert.equal(sem.queued, 0);
    assert.deepEqual(order.slice(0, 4), ['start-1', 'start-2', 'end-1', 'start-3']);

    const exportSem = new BoundedSemaphore(1, 0, 'SERVICE_UNAVAILABLE');
    const releaseSlot = await exportSem.acquire();
    await assert.rejects(
      () => exportSem.acquire(),
      (err: unknown) => {
        assert.equal((err as { statusCode?: number }).statusCode, 503);
        assert.equal((err as { code?: string }).code, 'SERVICE_UNAVAILABLE');
        return true;
      },
    );
    releaseSlot();
    releaseSlot(); // idempotent double release
    assert.equal(exportSem.active, 0);

    // IPv4, IPv4-mapped IPv6, and IPv6 /64 normalization
    assert.equal(normalizeRateLimitIp('203.0.113.7'), '203.0.113.7');
    assert.equal(normalizeRateLimitIp('::ffff:203.0.113.7'), '203.0.113.7');
    assert.equal(
      normalizeRateLimitIp('2001:db8:85a3:42:1000:8a2e:370:7334'),
      '2001:0db8:85a3:0042::/64',
    );
    assert.equal(
      normalizeRateLimitIp('2001:0DB8:85A3:0042::1'),
      '2001:0db8:85a3:0042::/64',
    );
    assert.notEqual(
      normalizeRateLimitIp('2001:db8:85a3:42::1'),
      normalizeRateLimitIp('2001:db8:85a3:43::1'),
    );
  });

  it('serves Germany DOP20 orthophoto proxy tiles (/api/v1/tiles/dop20/:z/:x/:y.png) and local APK downloads (/downloads/unseal.apk)', async () => {
    const tmpUploads = await fs.mkdtemp(path.join(os.tmpdir(), 'ppgis-apk-dop-'));
    const samplePng = await sharp({
      create: {
        width: 256,
        height: 256,
        channels: 4,
        background: { r: 60, g: 130, b: 80, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    let wmsFetchCalls = 0;
    const wmsFetchUrls: string[] = [];
    const config = loadEnvConfig({ UPLOADS_DIR: tmpUploads });
    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
      dop20TileFetch: async (input) => {
        wmsFetchCalls += 1;
        wmsFetchUrls.push(String(input));
        return new Response(new Uint8Array(samplePng), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      },
    });

    try {
      // Low zoom (< 11) returns immediate transparent PNG without hitting upstream WMS
      const lowZoomRes = await app.inject({
        method: 'GET',
        url: '/api/v1/tiles/dop20/8/135/83.png',
      });
      assert.equal(lowZoomRes.statusCode, 200);
      assert.equal(lowZoomRes.headers['content-type'], 'image/png');
      assert.equal(wmsFetchCalls, 0);

      // Zoom 16 tile over Hamburg fetches state DOP20 WMS once and caches subsequent hits
      const hhTileRes1 = await app.inject({
        method: 'GET',
        url: '/api/v1/tiles/dop20/16/34588/21172.png',
      });
      assert.equal(hhTileRes1.statusCode, 200);
      assert.equal(hhTileRes1.headers['content-type'], 'image/png');
      const meta = await sharp(hhTileRes1.rawPayload).metadata();
      assert.equal(meta.width, 256);
      assert.equal(meta.height, 256);
      const callsAfterFirst = wmsFetchCalls;
      assert.ok(callsAfterFirst >= 1);

      const hhTileRes2 = await app.inject({
        method: 'GET',
        url: '/api/v1/tiles/dop20/16/34588/21172.png',
      });
      assert.equal(hhTileRes2.statusCode, 200);
      assert.equal(wmsFetchCalls, callsAfterFirst);

      // Zoom 15 tile over Frankfurt (Hessen) uses Hessen's scale-adaptive he_dop_rgb layer
      const heTileRes = await app.inject({
        method: 'GET',
        url: '/api/v1/tiles/dop20/15/17174/11097.png',
      });
      assert.equal(heTileRes.statusCode, 200);
      assert.ok(
        wmsFetchUrls.some(
          (u) =>
            u.includes('gds-srv.hessen.de') && u.includes('LAYERS=he_dop_rgb'),
        ),
        `Expected Hessen DOP20 URL to request LAYERS=he_dop_rgb, got: ${wmsFetchUrls.join(', ')}`,
      );

      // Missing APK -> 404 NOT_FOUND and /api/v1/config omits apkDownloadUrl
      const beforeCfgRes = await app.inject({
        method: 'GET',
        url: '/api/v1/config',
      });
      assert.equal(beforeCfgRes.statusCode, 200);
      assert.equal(RuntimeConfigSchema.parse(beforeCfgRes.json()).apkDownloadUrl, null);
      assert.equal(RuntimeConfigSchema.parse(beforeCfgRes.json()).apkSha256, null);

      const missingApkRes = await app.inject({
        method: 'GET',
        url: '/downloads/unseal.apk',
      });
      assert.equal(missingApkRes.statusCode, 404);

      // Present APK -> 200 application/vnd.android.package-archive + ETag + exposed in /api/v1/config
      const fakeApkBytes = Buffer.from('PK\x03\x04unseal-test-apk-payload', 'binary');
      await fs.writeFile(path.join(tmpUploads, 'unseal.apk'), fakeApkBytes);
      const afterCfgRes = await app.inject({
        method: 'GET',
        url: '/api/v1/config',
      });
      assert.equal(afterCfgRes.statusCode, 200);
      const afterCfg = RuntimeConfigSchema.parse(afterCfgRes.json());
      assert.equal(afterCfg.apkDownloadUrl, '/downloads/unseal.apk');
      assert.match(String(afterCfg.apkSha256), /^[a-f0-9]{64}$/);

      const presentApkRes = await app.inject({
        method: 'GET',
        url: '/downloads/unseal.apk',
      });
      assert.equal(presentApkRes.statusCode, 200);
      assert.match(
        String(presentApkRes.headers['content-type']),
        /application\/vnd\.android\.package-archive/,
      );
      assert.equal(presentApkRes.headers.etag, `"sha256-${afterCfg.apkSha256}"`);
      assert.equal(presentApkRes.rawPayload.length, fakeApkBytes.length);
    } finally {
      await app.close();
      await fs.rm(tmpUploads, { recursive: true, force: true });
    }
  });
});
