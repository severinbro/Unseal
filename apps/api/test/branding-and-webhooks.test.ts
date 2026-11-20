// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 OpenUnseal Contributors

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import sharp from 'sharp';

import {
  DEFAULT_APP_NAME,
  RuntimeConfigSchema,
  SessionResponseSchema,
  type PolygonFeature,
} from '@openunseal/shared';

import {
  buildApp,
  createMemoryMailer,
  isPrivateOrReservedIp,
  signWebhookPayload,
} from '../src/app.js';
import {
  renderAuthEmailMessage,
  renderBugReportEmailMessage,
  renderContentReportEmailMessage,
  renderContentReportReceiptEmailMessage,
  renderModerationReasonEmailMessage,
} from '../src/auth/mailer.js';
import { loadEnvConfig } from '../src/config.js';
import { resetTestDb, setupTestDb } from '../src/db/testHarness.js';
import { createLogger } from '../src/logger.js';

import type pg from 'pg';

const COURTYARD_RING: [number, number][] = [
  [8.2735, 49.9985],
  [8.2738, 49.9985],
  [8.2738, 49.9987],
  [8.2735, 49.9987],
  [8.2735, 49.9985],
];

async function registerVerifiedUser(
  app: Awaited<ReturnType<typeof buildApp>>,
  mailer: ReturnType<typeof createMemoryMailer>,
  pseudonym: string,
  email: string,
  role: 'user' | 'admin' = 'user',
): Promise<{ token: string; userId: string }> {
  const regRes = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      pseudonym,
      email,
      password: 'StrongPassword123!',
      acceptedPrivacyPolicy: true,
      acceptedTerms: true,
    },
  });
  assert.equal(regRes.statusCode, 201);

  const verifyMail = mailer.outbox.find(
    (m) => m.to === email && m.purpose === 'verify_email',
  );
  assert.ok(verifyMail, 'Expected verification email');
  const verifyToken = new URL(verifyMail.actionUrl).searchParams.get('token');
  assert.ok(verifyToken, 'Expected verify token in URL');

  const verifyRes = await app.inject({
    method: 'POST',
    url: '/auth/verify-email',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: `token=${encodeURIComponent(verifyToken)}`,
  });
  assert.equal(verifyRes.statusCode, 200);

  if (role === 'admin') {
    await app.pool.query(
      `UPDATE users SET role = 'admin' WHERE LOWER(pseudonym) = LOWER($1)`,
      [pseudonym],
    );
  }

  const loginRes = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: {
      identifier: email,
      password: 'StrongPassword123!',
    },
  });
  assert.equal(loginRes.statusCode, 200);
  const session = SessionResponseSchema.parse(loginRes.json());
  return { token: session.sessionToken, userId: session.user.id };
}

describe('Municipal white-label branding & outbound webhooks (Option 2 Phase 1)', () => {
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

  it('parses branding and webhook environment variables safely and keeps stock defaults unchanged', () => {
    const stock = loadEnvConfig({});
    assert.equal(stock.branding.appName, DEFAULT_APP_NAME);
    assert.equal(stock.branding.subtitleDe, null);
    assert.equal(stock.branding.subtitleEn, null);
    assert.equal(stock.branding.logoFilePath, null);
    assert.equal(stock.branding.logoExternalUrl, null);
    assert.equal(stock.branding.accentColor, null);
    assert.equal(stock.branding.accentDarkColor, null);
    assert.equal(stock.branding.introEnabled, true);
    assert.equal(stock.branding.portalUrl, null);
    assert.equal(stock.branding.portalLabel, null);
    assert.equal(stock.webhook, null);
    assert.equal(stock.runtimeConfig.branding?.appName, 'OpenUnseal');
    assert.equal(stock.runtimeConfig.branding?.logoUrl, null);

    const municipal = loadEnvConfig({
      APP_NAME: '  Entsiegelung Musterstadt  ',
      APP_SUBTITLE_DE: 'Bürgerbeteiligung der Stadt Musterstadt',
      APP_SUBTITLE_EN: 'Civic Unsealing Map of Musterstadt',
      BRAND_LOGO_URL: 'https://cdn.musterstadt.de/wappen.svg',
      BRAND_ACCENT_COLOR: '#005A9C',
      BRAND_ACCENT_DARK_COLOR: '#4FA3E0',
      INTRO_ENABLED: 'false',
      MUNICIPAL_PORTAL_URL: 'https://www.musterstadt.de/klimaschutz',
      MUNICIPAL_PORTAL_LABEL: 'Klimaschutzportal Musterstadt',
      WEBHOOK_URL: 'https://gis.musterstadt.de/hooks/openunseal',
      WEBHOOK_SECRET: 'super-secret-municipal-key-123456',
      WEBHOOK_EVENTS: 'polygon.created, polygon.status_changed',
      WEBHOOK_TIMEOUT_MS: '8000',
      WEBHOOK_ALLOW_PRIVATE_NETWORKS: 'true',
    });
    assert.equal(municipal.branding.appName, 'Entsiegelung Musterstadt');
    assert.equal(municipal.branding.accentColor, '#005a9c');
    assert.equal(municipal.branding.accentDarkColor, '#4fa3e0');
    assert.equal(municipal.branding.introEnabled, false);
    assert.equal(
      municipal.branding.portalUrl,
      'https://www.musterstadt.de/klimaschutz',
    );
    assert.equal(municipal.branding.portalLabel, 'Klimaschutzportal Musterstadt');
    assert.deepEqual(municipal.webhook, {
      url: 'https://gis.musterstadt.de/hooks/openunseal',
      secret: 'super-secret-municipal-key-123456',
      events: ['polygon.created', 'polygon.status_changed'],
      timeoutMs: 8000,
      allowPrivateNetworks: true,
    });

    // Disabled webhook sentinel
    assert.equal(loadEnvConfig({ WEBHOOK_URL: 'none' }).webhook, null);

    // Invalid inputs throw clear errors
    assert.throws(
      () => loadEnvConfig({ BRAND_ACCENT_COLOR: '#fff' }),
      /BRAND_ACCENT_COLOR/,
    );
    assert.throws(
      () => loadEnvConfig({ BRAND_LOGO_URL: 'javascript:alert(1)' }),
      /BRAND_LOGO_URL/,
    );
    assert.throws(
      () => loadEnvConfig({ BRAND_LOGO_URL: '//evil.example/logo.png' }),
      /BRAND_LOGO_URL/,
    );
    assert.throws(
      () =>
        loadEnvConfig({
          WEBHOOK_URL: 'https://hooks.example.org/unseal',
          WEBHOOK_SECRET: 'CHANGE_ME_SECRET',
        }),
      /WEBHOOK_SECRET/,
    );
    assert.throws(
      () =>
        loadEnvConfig({
          WEBHOOK_URL: 'https://hooks.example.org/unseal',
          WEBHOOK_EVENTS: 'polygon.created,polygon.unknown',
        }),
      /WEBHOOK_EVENTS/,
    );
    assert.throws(
      () =>
        loadEnvConfig({
          WEBHOOK_URL: 'https://hooks.example.org/unseal',
          WEBHOOK_TIMEOUT_MS: '100',
        }),
      /WEBHOOK_TIMEOUT_MS/,
    );
  });

  it('serves validated local BRAND_LOGO_FILE (PNG & SVG) with sandboxed headers and rejects forged files', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openunseal-logo-'));
    const logoPngPath = path.join(tmpDir, 'wappen.png');
    const logoSvgPath = path.join(tmpDir, 'wappen.svg');
    const forgedPngPath = path.join(tmpDir, 'forged.png');

    const validPng = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 4,
        background: { r: 0, g: 90, b: 156, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const validSvg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#005a9c"/></svg>',
      'utf8',
    );

    const pngConfig = loadEnvConfig({
      UPLOADS_DIR: tmpDir,
      BRAND_LOGO_FILE: logoPngPath,
      APP_NAME: 'Stadtwerke Musterstadt',
      BRAND_ACCENT_COLOR: '#005a9c',
    });
    const app = await buildApp(pngConfig, pool, {
      logger: createLogger({ enabled: false }),
    });

    try {
      // Before file exists -> 404 & config logoUrl is null
      const beforeRes = await app.inject({
        method: 'GET',
        url: '/api/v1/branding/logo',
      });
      assert.equal(beforeRes.statusCode, 404);
      const beforeCfg = RuntimeConfigSchema.parse(
        (await app.inject({ method: 'GET', url: '/api/v1/config' })).json(),
      );
      assert.equal(beforeCfg.branding?.logoUrl, null);

      // Write valid PNG -> dynamically served at /api/v1/branding/logo and advertised in /api/v1/config
      await fs.writeFile(logoPngPath, validPng);
      const afterCfg = RuntimeConfigSchema.parse(
        (await app.inject({ method: 'GET', url: '/api/v1/config' })).json(),
      );
      assert.match(
        String(afterCfg.branding?.logoUrl),
        /^\/api\/v1\/branding\/logo\?v=[0-9a-f]{12}$/,
      );

      const pngRes = await app.inject({
        method: 'GET',
        url: '/api/v1/branding/logo',
      });
      assert.equal(pngRes.statusCode, 200);
      assert.equal(pngRes.headers['content-type'], 'image/png');
      assert.equal(pngRes.headers['x-content-type-options'], 'nosniff');
      assert.equal(
        pngRes.headers['cross-origin-resource-policy'],
        'cross-origin',
      );
      assert.equal(
        pngRes.headers['content-security-policy'],
        "default-src 'none'; sandbox",
      );
      assert.equal(pngRes.rawPayload.length, validPng.length);
    } finally {
      await app.close();
    }

    // Valid SVG file
    await fs.writeFile(logoSvgPath, validSvg);
    const svgApp = await buildApp(
      loadEnvConfig({ UPLOADS_DIR: tmpDir, BRAND_LOGO_FILE: logoSvgPath }),
      pool,
      { logger: createLogger({ enabled: false }) },
    );
    try {
      const svgRes = await svgApp.inject({
        method: 'GET',
        url: '/api/v1/branding/logo',
      });
      assert.equal(svgRes.statusCode, 200);
      assert.match(String(svgRes.headers['content-type']), /^image\/svg\+xml/);
      assert.equal(
        svgRes.headers['content-security-policy'],
        "default-src 'none'; sandbox",
      );
    } finally {
      await svgApp.close();
    }

    // Forged PNG (HTML text with .png extension) must be rejected
    await fs.writeFile(forgedPngPath, '<html><script>alert(1)</script></html>');
    const forgedApp = await buildApp(
      loadEnvConfig({ UPLOADS_DIR: tmpDir, BRAND_LOGO_FILE: forgedPngPath }),
      pool,
      { logger: createLogger({ enabled: false }) },
    );
    try {
      const forgedRes = await forgedApp.inject({
        method: 'GET',
        url: '/api/v1/branding/logo',
      });
      assert.equal(forgedRes.statusCode, 404);
    } finally {
      await forgedApp.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('brands hosted /auth/* pages and transactional emails while preserving AGPL/MPL OpenUnseal attribution and GDPR disclosures', async () => {
    // 1. Stock defaults preserve exact original CSP (no img-src)
    const stockApp = await buildApp(loadEnvConfig({}), pool, {
      logger: createLogger({ enabled: false }),
    });
    try {
      const stockImp = await stockApp.inject({
        method: 'GET',
        url: '/auth/impressum',
      });
      assert.equal(stockImp.statusCode, 200);
      assert.equal(
        stockImp.headers['content-security-policy'],
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      );
      assert.match(stockImp.body, /<title>Impressum – OpenUnseal<\/title>/);
    } finally {
      await stockApp.close();
    }

    // 2. Custom municipal instance with external logo + portal link + webhook
    const brandedApp = await buildApp(
      loadEnvConfig({
        PUBLIC_BASE_URL: 'https://map.musterstadt.de',
        APP_NAME: 'Entsiegelung Musterstadt',
        BRAND_LOGO_URL: 'https://assets.musterstadt.de/logo.svg',
        BRAND_ACCENT_COLOR: '#005a9c',
        MUNICIPAL_PORTAL_URL: 'https://www.musterstadt.de/klimaschutz',
        MUNICIPAL_PORTAL_LABEL: 'Klimaschutzportal Musterstadt',
        WEBHOOK_URL: 'https://gis.musterstadt.de/hooks/openunseal',
      }),
      pool,
      { logger: createLogger({ enabled: false }) },
    );
    try {
      const impRes = await brandedApp.inject({
        method: 'GET',
        url: '/auth/impressum',
      });
      assert.equal(impRes.statusCode, 200);
      assert.match(
        String(impRes.headers['content-security-policy']),
        /img-src 'self' https:\/\/assets\.musterstadt\.de;/,
      );
      assert.match(
        impRes.body,
        /<title>Impressum – Entsiegelung Musterstadt<\/title>/,
      );
      assert.match(impRes.body, /#005a9c/);
      assert.match(
        impRes.body,
        /src="https:\/\/assets\.musterstadt\.de\/logo\.svg"/,
      );
      assert.match(impRes.body, /Klimaschutzportal Musterstadt/);
      assert.match(impRes.body, /https:\/\/www\.musterstadt\.de\/klimaschutz/);
      // Upstream AGPLv3 / MPL-2.0 software notice MUST stay preserved!
      assert.match(impRes.body, /Open-Source-Software <strong>OpenUnseal<\/strong>/);
      assert.match(impRes.body, /AGPL-3\.0-or-later/);

      const privRes = await brandedApp.inject({
        method: 'GET',
        url: '/auth/privacy',
      });
      assert.equal(privRes.statusCode, 200);
      assert.match(privRes.body, /<html lang="de">/);
      assert.match(privRes.body, /assets\.musterstadt\.de/);
      assert.match(privRes.body, /Automatisierte Benachrichtigungen \(Webhooks, ohne Personenbezug\)/);
      assert.match(privRes.body, /Outbound webhooks transmit exclusively public, non-PII polygon data/);

      // Explicit ?theme=light and ?theme=dark override system prefers-color-scheme and persist across legal nav links
      const privLightRes = await brandedApp.inject({
        method: 'GET',
        url: '/auth/privacy?theme=light',
      });
      assert.equal(privLightRes.statusCode, 200);
      assert.match(privLightRes.body, /<html lang="de" data-theme="light">/);
      assert.match(privLightRes.body, /:root:not\(\[data-theme="light"\]\)/);
      assert.match(
        privLightRes.body,
        /href="https:\/\/map\.musterstadt\.de\/auth\/licenses\?theme=light"/,
      );
      assert.match(
        privLightRes.body,
        /href="https:\/\/map\.musterstadt\.de\/auth\/terms\?theme=light"/,
      );

      const licDarkRes = await brandedApp.inject({
        method: 'GET',
        url: '/auth/licenses?theme=dark',
      });
      assert.equal(licDarkRes.statusCode, 200);
      assert.match(licDarkRes.body, /<html lang="de" data-theme="dark">/);
      assert.match(
        licDarkRes.body,
        /href="https:\/\/map\.musterstadt\.de\/auth\/impressum\?theme=dark"/,
      );
      assert.match(
        licDarkRes.body,
        /href="https:\/\/map\.musterstadt\.de\/auth\/privacy\?theme=dark"/,
      );
      assert.doesNotMatch(licDarkRes.body, /third-party-notices\?theme=/);
      assert.doesNotMatch(
        String(licDarkRes.headers['content-security-policy']),
        /script-src/,
      );

      // Invalid theme values fall back gracefully to OS preference
      const invalidThemeRes = await brandedApp.inject({
        method: 'GET',
        url: '/auth/terms?theme=sepia',
      });
      assert.equal(invalidThemeRes.statusCode, 200);
      assert.match(invalidThemeRes.body, /<html lang="de">/);
      assert.doesNotMatch(invalidThemeRes.body, /<html[^>]*data-theme=/);
    } finally {
      await brandedApp.close();
    }

    // 3. Branded vs default email rendering
    const defaultAuthMail = renderAuthEmailMessage({
      to: 'citizen@example.org',
      pseudonym: 'Anna',
      purpose: 'verify_email',
      actionUrl: 'https://openunseal.example.org/auth/verify-email?token=abc',
    });
    assert.match(defaultAuthMail.subject, /^OpenUnseal – /);
    assert.match(defaultAuthMail.html, /color:#176642/);

    const brandOpts = {
      appName: 'Entsiegelung Musterstadt',
      accentColor: '#005a9c',
    };
    const brandedAuthMail = renderAuthEmailMessage(
      {
        to: 'citizen@example.org',
        pseudonym: 'Anna',
        purpose: 'verify_email',
        actionUrl: 'https://map.musterstadt.de/auth/verify-email?token=abc',
      },
      brandOpts,
    );
    assert.match(brandedAuthMail.subject, /^Entsiegelung Musterstadt – /);
    assert.match(brandedAuthMail.text, /Entsiegelung Musterstadt/);
    assert.match(brandedAuthMail.html, /color:#005a9c/);
    assert.match(brandedAuthMail.html, /background:#005a9c/);

    const brandedBug = renderBugReportEmailMessage(
      {
        to: 'ops@musterstadt.de',
        description: 'Map zoom button clipped on mobile',
        contactEmail: null,
        reporterPseudonym: 'Anna',
        reporterUserId: 'u-1',
        platform: 'web',
        pageUrl: 'https://map.musterstadt.de',
        submittedAtIso: '2026-11-20T10:00:00Z',
      },
      brandOpts,
    );
    assert.match(brandedBug.subject, /^Entsiegelung Musterstadt Bug-Meldung/);
    assert.match(brandedBug.html, /color:#005a9c/);

    const brandedReport = renderContentReportEmailMessage(
      {
        to: 'ops@musterstadt.de',
        reportId: '550e8400-e29b-41d4-a716-446655440001',
        targetType: 'polygon',
        targetId: '550e8400-e29b-41d4-a716-446655440002',
        reason: 'spam',
        explanation: 'Duplicate spam entry',
        reporterName: null,
        reporterEmail: null,
        reporterPseudonym: null,
        reporterUserId: null,
        pageUrl: null,
        submittedAtIso: '2026-11-20T10:00:00Z',
      },
      brandOpts,
    );
    assert.match(brandedReport.subject, /^Entsiegelung Musterstadt DSA-Meldung/);

    const brandedReceipt = renderContentReportReceiptEmailMessage(
      {
        to: 'reporter@example.org',
        reportId: '550e8400-e29b-41d4-a716-446655440001',
        targetType: 'polygon',
        targetId: '550e8400-e29b-41d4-a716-446655440002',
        reason: 'spam',
        submittedAtIso: '2026-11-20T10:00:00Z',
        contactEmail: 'ops@musterstadt.de',
        impressumUrl: 'https://map.musterstadt.de/auth/impressum',
      },
      brandOpts,
    );
    assert.match(brandedReceipt.subject, /^Entsiegelung Musterstadt – /);
    assert.match(brandedReceipt.html, /color:#005a9c/);

    const brandedMod = renderModerationReasonEmailMessage(
      {
        to: 'author@example.org',
        pseudonym: 'Anna',
        action: 'polygon_deleted',
        targetId: '550e8400-e29b-41d4-a716-446655440002',
        reason: 'Off-topic test polygon',
        automatedMeansUsed: false,
        contactEmail: 'ops@musterstadt.de',
        termsUrl: 'https://map.musterstadt.de/auth/terms',
        impressumUrl: 'https://map.musterstadt.de/auth/impressum',
        actedAtIso: '2026-11-20T10:00:00Z',
      },
      brandOpts,
    );
    assert.match(brandedMod.subject, /^Entsiegelung Musterstadt – /);
    assert.match(brandedMod.html, /Entsiegelung Musterstadt-Instanz/);
    assert.match(brandedMod.html, /color:#005a9c/);
  });

  it('delivers signed, zero-PII webhooks for polygon lifecycle events, enforces SSRF protection, and stays non-blocking on failures', async () => {
    // 1. SSRF IP classification unit checks
    for (const blocked of [
      '127.0.0.1',
      '10.0.0.5',
      '172.16.0.1',
      '192.168.1.10',
      '169.254.169.254',
      '100.64.0.1',
      '::1',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '::ffff:169.254.169.254',
    ]) {
      assert.equal(
        isPrivateOrReservedIp(blocked),
        true,
        `Expected ${blocked} to be treated as private/reserved`,
      );
    }
    assert.equal(isPrivateOrReservedIp('93.184.216.34'), false);
    assert.equal(isPrivateOrReservedIp('2606:2800:220:1:248:1893:25c8:1946'), false);

    // 2. End-to-end signed lifecycle delivery with retry & zero PII
    const webhookSecret = 'municipal-webhook-hmac-secret-999';
    interface CapturedWebhook {
      url: string;
      headers: Record<string, string>;
      rawBody: string;
    }
    const captured: CapturedWebhook[] = [];
    let attemptCount = 0;

    const mailer = createMemoryMailer();
    const config = loadEnvConfig({
      PUBLIC_BASE_URL: 'https://map.musterstadt.de',
      APP_NAME: 'Entsiegelung Musterstadt',
      REQUIRE_JURISDICTION: 'off',
      WEBHOOK_URL: 'https://gis.musterstadt.de/hooks/openunseal',
      WEBHOOK_SECRET: webhookSecret,
      WEBHOOK_EVENTS: 'polygon.created,polygon.status_changed,polygon.deleted',
    });

    const app = await buildApp(config, pool, {
      logger: createLogger({ enabled: false }),
      mailer,
      webhookLookup: async () => [{ address: '93.184.216.34', family: 4 }],
      webhookRetryDelayMs: 0,
      webhookFetch: async (input, init) => {
        attemptCount += 1;
        // Fail the very first HTTP attempt with 503 to verify single automatic retry
        if (attemptCount === 1) {
          return new Response('temporary overload', { status: 503 });
        }
        const rawHeaders = new Headers(init?.headers);
        const headersObj: Record<string, string> = {};
        rawHeaders.forEach((v, k) => {
          headersObj[k.toLowerCase()] = v;
        });
        captured.push({
          url: String(input),
          headers: headersObj,
          rawBody: typeof init?.body === 'string' ? init.body : '',
        });
        return new Response('ok', { status: 202 });
      },
    });

    try {
      const admin = await registerVerifiedUser(
        app,
        mailer,
        'SecretAuthorPseudo',
        'secret-author@musterstadt.de',
        'admin',
      );

      // Create polygon -> triggers polygon.created (retries once after 503 -> succeeds)
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        headers: { authorization: `Bearer ${admin.token}` },
        payload: {
          geometry: { type: 'Polygon', coordinates: [COURTYARD_RING] },
          surfaceType: 'asphalt',
          note: 'Grauer Parkplatz am Rathaus',
        },
      });
      assert.equal(createRes.statusCode, 201);
      const created = createRes.json() as PolygonFeature;

      // Update status -> triggers polygon.status_changed
      const statusRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/polygons/${created.id}/status`,
        headers: { authorization: `Bearer ${admin.token}` },
        payload: { status: 'in_progress' },
      });
      assert.equal(statusRes.statusCode, 200);

      // Delete polygon -> triggers polygon.deleted
      const delRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/polygons/${created.id}`,
        headers: { authorization: `Bearer ${admin.token}` },
      });
      assert.equal(delRes.statusCode, 204);

      await app.webhookDispatcher.flush();

      assert.equal(attemptCount, 4, '1 retry on created + status_changed + deleted = 4 fetches');
      assert.equal(captured.length, 3);

      const events = captured.map((c) => c.headers['x-openunseal-event']);
      assert.deepEqual(events, [
        'polygon.created',
        'polygon.status_changed',
        'polygon.deleted',
      ]);

      for (const req of captured) {
        assert.equal(req.url, 'https://gis.musterstadt.de/hooks/openunseal');
        const ts = req.headers['x-openunseal-timestamp'] ?? '';
        const sig = req.headers['x-openunseal-signature-256'] ?? '';
        assert.match(ts, /^\d+$/);
        assert.equal(
          sig,
          signWebhookPayload(webhookSecret, ts, req.rawBody),
        );
        // Verify manual HMAC calculation matches documented formula
        const expectedDigest = crypto
          .createHmac('sha256', webhookSecret)
          .update(`${ts}.${req.rawBody}`)
          .digest('hex');
        assert.equal(sig, `sha256=${expectedDigest}`);

        // Strictly zero PII anywhere in raw JSON payload!
        assert.equal(req.rawBody.includes('SecretAuthorPseudo'), false);
        assert.equal(req.rawBody.includes('secret-author@musterstadt.de'), false);
        assert.equal(req.rawBody.includes(admin.userId), false);
      }

      const createdPayload = JSON.parse(captured[0]!.rawBody) as {
        event: string;
        instance: { appName: string; publicBaseUrl: string };
        data: {
          id: string;
          surfaceType: string;
          status: string;
          note: string;
          areaM2: number;
          geometry: { type: string };
        };
      };
      assert.equal(createdPayload.instance.appName, 'Entsiegelung Musterstadt');
      assert.equal(
        createdPayload.instance.publicBaseUrl,
        'https://map.musterstadt.de',
      );
      assert.equal(createdPayload.data.id, created.id);
      assert.equal(createdPayload.data.surfaceType, 'asphalt');
      assert.equal(createdPayload.data.status, 'proposed');
      assert.equal(createdPayload.data.geometry.type, 'Polygon');

      const statusPayload = JSON.parse(captured[1]!.rawBody) as {
        data: { status: string };
      };
      assert.equal(statusPayload.data.status, 'in_progress');

      const deletedPayload = JSON.parse(captured[2]!.rawBody) as {
        data: { id: string; deletedByAdmin: boolean; deletedAt: string };
      };
      assert.equal(deletedPayload.data.id, created.id);
      assert.equal(deletedPayload.data.deletedByAdmin, false);
      assert.ok(deletedPayload.data.deletedAt.length > 0);
    } finally {
      await app.close();
    }

    // 3. SSRF blocks private IP when WEBHOOK_ALLOW_PRIVATE_NETWORKS=false and mutation still succeeds
    let blockedFetchCalls = 0;
    const ssrfMailer = createMemoryMailer();
    const ssrfApp = await buildApp(
      loadEnvConfig({
        REQUIRE_JURISDICTION: 'off',
        WEBHOOK_URL: 'https://internal.musterstadt.local/hook',
        WEBHOOK_ALLOW_PRIVATE_NETWORKS: 'false',
      }),
      pool,
      {
        logger: createLogger({ enabled: false }),
        mailer: ssrfMailer,
        webhookLookup: async () => [{ address: '10.0.0.42', family: 4 }],
        webhookRetryDelayMs: 0,
        webhookFetch: async () => {
          blockedFetchCalls += 1;
          return new Response('should never be called', { status: 200 });
        },
      },
    );

    try {
      const user = await registerVerifiedUser(
        ssrfApp,
        ssrfMailer,
        'SsrfTestUser',
        'ssrf-test@musterstadt.de',
      );
      const createRes = await ssrfApp.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        headers: { authorization: `Bearer ${user.token}` },
        payload: {
          geometry: { type: 'Polygon', coordinates: [COURTYARD_RING] },
          surfaceType: 'concrete',
        },
      });
      assert.equal(createRes.statusCode, 201);
      await ssrfApp.webhookDispatcher.flush();
      assert.equal(
        blockedFetchCalls,
        0,
        'SSRF guard must block fetch to RFC 1918 IP when allowPrivateNetworks=false',
      );
    } finally {
      await ssrfApp.close();
    }

    // 4. Event filter + unreachable downstream server never breaks POST /api/v1/polygons
    let filteredFetchCalls = 0;
    const filterMailer = createMemoryMailer();
    const filterApp = await buildApp(
      loadEnvConfig({
        REQUIRE_JURISDICTION: 'off',
        WEBHOOK_URL: 'http://127.0.0.1:9999/internal-hook',
        WEBHOOK_EVENTS: 'polygon.status_changed',
        WEBHOOK_ALLOW_PRIVATE_NETWORKS: 'true',
      }),
      pool,
      {
        logger: createLogger({ enabled: false }),
        mailer: filterMailer,
        webhookRetryDelayMs: 0,
        webhookFetch: async () => {
          filteredFetchCalls += 1;
          throw new Error('ECONNREFUSED');
        },
      },
    );

    try {
      const admin = await registerVerifiedUser(
        filterApp,
        filterMailer,
        'FilterAdminUser',
        'filter-admin@musterstadt.de',
        'admin',
      );
      const createRes = await filterApp.inject({
        method: 'POST',
        url: '/api/v1/polygons',
        headers: { authorization: `Bearer ${admin.token}` },
        payload: {
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [8.2745, 49.9995],
                [8.2748, 49.9995],
                [8.2748, 49.9997],
                [8.2745, 49.9997],
                [8.2745, 49.9995],
              ],
            ],
          },
          surfaceType: 'pavers',
        },
      });
      assert.equal(createRes.statusCode, 201);
      await filterApp.webhookDispatcher.flush();
      assert.equal(
        filteredFetchCalls,
        0,
        'polygon.created must be skipped when WEBHOOK_EVENTS only subscribes to polygon.status_changed',
      );

      const poly = createRes.json() as PolygonFeature;
      const patchRes = await filterApp.inject({
        method: 'PATCH',
        url: `/api/v1/polygons/${poly.id}/status`,
        headers: { authorization: `Bearer ${admin.token}` },
        payload: { status: 'finished' },
      });
      assert.equal(patchRes.statusCode, 200);
      await filterApp.webhookDispatcher.flush();
      assert.equal(
        filteredFetchCalls,
        2,
        'Failed delivery to private network target retries once and still keeps API status 200',
      );
    } finally {
      await filterApp.close();
    }
  });
});
