// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 OpenUnseal Contributors

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { buildApp } from '../src/app.js';
import { loadEnvConfig } from '../src/config.js';
import { setupTestDb } from '../src/db/testHarness.js';
import { createLogger } from '../src/logger.js';

import type pg from 'pg';

describe('GET /api/v1/geocode country scope', () => {
  let pool: pg.Pool;

  before(async () => {
    pool = await setupTestDb();
  });

  after(async () => {
    await pool.end();
  });

  for (const [mode, expected] of [
    ['when_seeded', 'de'],
    ['strict', 'de'],
    ['off', null],
  ] as const) {
    it(`REQUIRE_JURISDICTION=${mode}`, async () => {
      const urls: URL[] = [];
      const config = loadEnvConfig({ REQUIRE_JURISDICTION: mode });
      assert.equal(
        config.runtimeConfig.germanyConfinementEnabled,
        expected === 'de',
      );
      const app = await buildApp(config, pool, {
        logger: createLogger({ enabled: false }),
        geocodeFetch: (async (url: unknown) => {
          urls.push(new URL(String(url)));
          return new Response('[]');
        }) as typeof fetch,
      });
      try {
        const res = await app.inject({ url: '/api/v1/geocode?q=Mainz' });
        assert.equal(res.statusCode, 200);
        assert.equal(urls[0]!.searchParams.get('countrycodes'), expected);
      } finally {
        await app.close();
      }
    });
  }

  it('validates OVERPASS_API_URL and CHAT_RETENTION_DAYS', () => {
    assert.equal(loadEnvConfig({}).overpassApiUrl, null);
    assert.equal(loadEnvConfig({}).chatRetentionDays, 365);
    assert.throws(() => loadEnvConfig({ OVERPASS_API_URL: 'ftp://x' }), /OVERPASS/);
    assert.throws(() => loadEnvConfig({ CHAT_RETENTION_DAYS: '0' }), /CHAT_RET/);
  });
});
