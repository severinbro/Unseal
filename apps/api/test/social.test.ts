// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 OpenUnseal Contributors

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import {
  CHAT_LIMITS,
  CURRENT_TERMS_VERSION,
  HELP_WANTED_DAYS,
  PHOTO_LIMITS,
  SPACE_ZONE_LIMITS,
  type ChatMessagesResponse,
  type ChatThread,
  type ClassifySpaceResponse,
  type PolygonCollectionResponse,
  type PolygonFeature,
  type PolygonFeedResponse,
  type SpaceZoneCollection,
} from '@openunseal/shared';
import sharp from 'sharp';

import { buildApp } from '../src/app.js';
import { createMemoryMailer } from '../src/auth/mailer.js';
import { loadEnvConfig } from '../src/config.js';
import { purgeExpiredPersonalData } from '../src/db/retention.js';
import { resetTestDb, setupTestDb } from '../src/db/testHarness.js';
import {
  createLogger,
  serializeErrorWithoutAddresses,
  toLoggablePath,
} from '../src/logger.js';
import { decide, roundedOverpassBbox } from '../src/polygons/spaceClassifier.js';
import { buildPublicPolygonWebhookData } from '../src/util/webhooks.js';

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

interface TestUser {
  id: string;
  name: string;
  token: string;
}

const LNG = 8.2739;
const LAT = 49.9989;

function box(index: number, size = 0.0002): [number, number][] {
  const x = Number((LNG + index * 0.002).toFixed(6));
  const y = LAT;
  const x2 = Number((x + size).toFixed(6));
  const y2 = Number((y + size).toFixed(6));
  return [
    [x, y],
    [x2, y],
    [x2, y2],
    [x, y2],
    [x, y],
  ];
}

const polygon = (ring: [number, number][]) => ({
  type: 'Polygon' as const,
  coordinates: [ring],
});

describe('Public/private ground, feed and direct messages', () => {
  let pool: pg.Pool;
  let uploadsDir: string;
  let app: FastifyInstance;
  let mailer: ReturnType<typeof createMemoryMailer>;
  let overpassCalls: { url: string; body: string; userAgent: string }[];
  let overpassElements: unknown[];

  before(async () => {
    pool = await setupTestDb();
    uploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'social-uploads-'));
  });

  after(async () => {
    await pool.end();
    await fs.rm(uploadsDir, { recursive: true, force: true });
  });

  async function start(overpassApiUrl: string | null = null): Promise<void> {
    if (app) {
      await app.close().catch(() => undefined);
    }
    mailer = createMemoryMailer();
    overpassCalls = [];
    overpassElements = [];
    const wide = { max: 10_000, timeWindow: '1 minute' };
    app = await buildApp(
      {
        ...loadEnvConfig({}),
        uploadsDir,
        authCaptchaEnabled: false,
        requireJurisdiction: 'off',
        overpassApiUrl,
        operatorEmail: 'operator@example.org',
        abuseContact: 'abuse@example.org',
      },
      pool,
      {
        logger: createLogger({ enabled: false }),
        mailer,
        rateLimits: {
          register: wide,
          loginIp: wide,
          createPolygon: wide,
          mutatePolygon: wide,
          contentReport: wide,
          deleteAccount: wide,
        } as NonNullable<Parameters<typeof buildApp>[2]>['rateLimits'],
        overpassFetch: (async (url: unknown, init?: RequestInit) => {
          overpassCalls.push({
            url: String(url),
            body: String(init?.body),
            userAgent: new Headers(init?.headers).get('user-agent') ?? '',
          });
          return new Response(JSON.stringify({ elements: overpassElements }));
        }) as typeof fetch,
      },
    );
  }

  beforeEach(async () => {
    await resetTestDb(pool);
    await start();
  });

  async function call<T = unknown>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    user?: TestUser | null,
    payload?: unknown,
  ): Promise<{ status: number; body: T; code: string | undefined; raw: string }> {
    const res = await app.inject({
      method,
      url,
      remoteAddress: '198.51.100.77',
      ...(user ? { headers: { authorization: `Bearer ${user.token}` } } : {}),
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
    const body = res.body.length > 0 && res.headers['content-type']?.toString().includes('json')
      ? (res.json() as { error?: { code: string } })
      : undefined;
    return {
      status: res.statusCode,
      body: body as T,
      code: body?.error?.code,
      raw: res.body,
    };
  }

  async function user(name: string): Promise<TestUser> {
    const registered = await call('POST', '/api/v1/auth/register', null, {
      pseudonym: name,
      email: `${name}@example.org`,
      password: 'valid-password-123',
      acceptedPrivacyPolicy: true,
      acceptedTerms: true,
    });
    assert.equal(registered.status, 201);
    await pool.query(
      'UPDATE users SET email_verified_at = clock_timestamp() WHERE pseudonym = $1',
      [name],
    );
    const login = await call<{ sessionToken: string; user: { id: string } }>(
      'POST',
      '/api/v1/auth/login',
      null,
      { identifier: name, password: 'valid-password-123' },
    );
    assert.equal(login.status, 200);
    return { id: login.body.user.id, name, token: login.body.sessionToken };
  }

  async function admin(name: string): Promise<TestUser> {
    const created = await user(name);
    await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [created.id]);
    return created;
  }

  async function create(
    author: TestUser,
    index: number,
    extra: Record<string, unknown> = {},
  ): Promise<PolygonFeature> {
    const res = await call<PolygonFeature>('POST', '/api/v1/polygons', author, {
      geometry: polygon(box(index)),
      surfaceType: 'asphalt',
      ...extra,
    });
    assert.equal(res.status, 201, res.raw);
    return res.body;
  }

  async function uploadPhoto(author: TestUser, polygonId: string): Promise<string> {
    const image = await sharp({
      create: { width: 60, height: 60, channels: 3, background: '#777777' },
    })
      .jpeg()
      .toBuffer();
    const boundary = '----SocialBoundary';
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/polygons/${polygonId}/photos`,
      headers: {
        authorization: `Bearer ${author.token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="p.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
        ),
        image,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
    assert.equal(res.statusCode, 201, res.body);
    return (res.json() as { id: string }).id;
  }

  async function zone(tier: string, ring: [number, number][], source = 'alkis') {
    await pool.query(
      `INSERT INTO space_reference_zones (source, tier, category, geom)
       VALUES ($1, $2, 'test', ST_SetSRID(ST_GeomFromGeoJSON($3), 4326))`,
      [source, tier, JSON.stringify(polygon(ring))],
    );
  }

  it('decides at the documented thresholds', () => {
    assert.equal(decide(0.75, 0, 'alkis').detectedSpaceType, 'private');
    assert.equal(decide(0.7499, 0.2, 'alkis').detectedSpaceType, 'public');
    const unknown = decide(0.6, 0, 'alkis');
    assert.equal(unknown.detectedSpaceType, 'unknown');
    assert.equal(unknown.privateOverlapRatio, null);
    assert.equal(unknown.source, null);
  });

  it('classifies locally, subtracting excluded land cover, without network access', async () => {
    const u = await user('zoner');
    const ring = box(0);
    await zone('landuse_private', ring);
    await zone('public', box(1));
    // Half of the parcel is a building: it must not dilute the private share.
    const half = ring.map(([x, y]) => [x === ring[1]![0] ? x - 0.0001 : x, y]) as [
      number,
      number,
    ][];
    await pool.query(
      `INSERT INTO land_cover_exclusions (source, category, geom)
       VALUES ('osm', 'farmland', ST_SetSRID(ST_GeomFromGeoJSON($1), 4326))`,
      [JSON.stringify(polygon(half.map(([x, y]) => [x - 0.00003, y])))],
    );
    const res = await call<{
      detectedSpaceType: string;
      privateOverlapRatio: number;
      source: string;
    }>('POST', '/api/v1/polygons/classify-space', u, { geometry: polygon(ring) });
    assert.equal(res.status, 200, res.raw);
    assert.equal(res.body.detectedSpaceType, 'private');
    assert.equal(res.body.privateOverlapRatio, 1);
    assert.equal(res.body.source, 'alkis');
    assert.equal(overpassCalls.length, 0);
    const anonymous = await call('POST', '/api/v1/polygons/classify-space', null, {
      geometry: polygon(ring),
    });
    assert.equal(anonymous.status, 401);
  });

  it('sends only a grid-aligned bbox upstream and no contact address', async () => {
    await start('https://overpass.example.org/api/interpreter');
    const u = await user('remote');
    const ring = box(0);
    overpassElements = [
      {
        type: 'way',
        tags: { landuse: 'residential' },
        geometry: [
          { lat: LAT - 0.01, lon: LNG - 0.01 },
          { lat: LAT - 0.01, lon: LNG + 0.01 },
          { lat: LAT + 0.01, lon: LNG + 0.01 },
          { lat: LAT + 0.01, lon: LNG - 0.01 },
          { lat: LAT - 0.01, lon: LNG - 0.01 },
        ],
      },
    ];
    const res = await call<{ detectedSpaceType: string; source: string }>(
      'POST',
      '/api/v1/polygons/classify-space',
      u,
      { geometry: polygon(ring) },
    );
    assert.equal(res.body.detectedSpaceType, 'private');
    assert.equal(res.body.source, 'osm_overpass');
    const created = await create(u, 0, { spaceType: 'private' });
    assert.equal(created.properties.spaceVerification, 'gis_verified');
    assert.equal(overpassCalls.length, 1, 'second lookup comes from the cache');

    const bbox = roundedOverpassBbox(ring);
    for (const value of bbox) {
      assert.ok(Math.abs(value / 0.005 - Math.round(value / 0.005)) < 1e-6);
    }
    const query = new URLSearchParams(overpassCalls[0]!.body).get('data')!;
    assert.ok(query.includes(`(${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]})`));
    assert.ok(!query.includes(String(ring[1]![0])));
    assert.ok(!overpassCalls[0]!.userAgent.includes('@'));
  });

  it('rejects invalid geometry before any upstream call', async () => {
    await start('https://overpass.example.org/api/interpreter');
    const u = await user('invalid');
    const tiny = await call('POST', '/api/v1/polygons/classify-space', u, {
      geometry: polygon(box(0, 0.000002)),
    });
    assert.equal(tiny.status, 422);
    assert.equal(overpassCalls.length, 0);
  });

  it('keeps space type immutable, requires entitlement and hides opt-ins', async () => {
    const author = await user('owner');
    const other = await user('visitor');
    const denied = await call('POST', '/api/v1/polygons', author, {
      geometry: polygon(box(0)),
      surfaceType: 'asphalt',
      spaceType: 'private',
      openForPublicAccess: true,
    });
    assert.equal(denied.code, 'ENTITLEMENT_REQUIRED');

    const p = await create(author, 0, {
      spaceType: 'private',
      openForPublicAccess: true,
      allowChatContact: true,
      entitlementConfirmed: true,
    });
    assert.equal(p.properties.allowChatContact, true);
    const pub = await create(author, 1, {
      spaceType: 'public',
      openForPublicAccess: true,
      allowChatContact: true,
    });
    assert.equal(pub.properties.openForPublicAccess, false);

    assert.equal(
      (await call('PATCH', `/api/v1/polygons/${p.id}`, author, { spaceType: 'public' }))
        .code,
      'SPACE_TYPE_IMMUTABLE',
    );
    const legacy = await create(author, 2);
    assert.equal(legacy.properties.spaceType, 'unknown');

    const seen = (await call<PolygonFeature>('GET', `/api/v1/polygons/${p.id}`, other))
      .body.properties;
    assert.equal(seen.canMessageAuthor, true);
    assert.equal(seen.allowChatContact, null);
    assert.equal(seen.detectedSpaceType, null);
    const anon = await call<PolygonFeature>('GET', `/api/v1/polygons/${p.id}`);
    assert.equal(anon.body.properties.canMessageAuthor, false);
    assert.ok(!anon.raw.includes('allowDirectMessages'));
  });

  it('exports and sends by webhook only the space type', async () => {
    const author = await user('exporter');
    const p = await create(author, 0, {
      spaceType: 'private',
      openForPublicAccess: true,
      entitlementConfirmed: true,
    });
    const exported = await call('GET', '/api/v1/polygons/export.geojson');
    assert.equal(exported.status, 200);
    const properties = (
      JSON.parse(exported.raw) as { features: { properties: Record<string, unknown> }[] }
    ).features[0]!.properties;
    const webhook = buildPublicPolygonWebhookData(p);
    for (const data of [properties, webhook]) {
      assert.equal(data.spaceType, 'private');
      for (const key of [
        'openForPublicAccess',
        'allowChatContact',
        'canMessageAuthor',
        'detectedSpaceType',
        'privateOverlapRatio',
        'spaceVerification',
        'spaceVerificationSource',
      ]) {
        assert.equal(key in data, false, key);
      }
    }
  });

  it('lets private authors change status with a photo and never blocks photo deletion', async () => {
    const author = await user('builder');
    const helper = await user('helper');
    const p = await create(author, 0, { spaceType: 'private' });
    const status = (actor: TestUser, value: string, id = p.id, entitled = false) =>
      call<PolygonFeature>('PATCH', `/api/v1/polygons/${id}/status`, actor, {
        status: value,
        ...(entitled ? { entitlementConfirmed: true } : {}),
      });
    // Reporting progress on somebody's ground needs the confirmation first.
    assert.equal((await status(author, 'finished')).code, 'ENTITLEMENT_REQUIRED');
    assert.equal(
      (await status(author, 'finished', p.id, true)).code,
      'PHOTO_REQUIRED_FOR_STATUS',
    );
    // A third person's photo carries the status and stays deletable by them.
    const photoId = await uploadPhoto(helper, p.id);
    assert.equal((await status(helper, 'finished')).code, 'FORBIDDEN_NOT_AUTHOR');
    // The failed attempt above did not store the confirmation.
    assert.equal((await status(author, 'in_progress')).code, 'ENTITLEMENT_REQUIRED');
    const progress = await status(author, 'in_progress', p.id, true);
    assert.equal(progress.body.properties.status, 'in_progress');
    assert.equal(progress.body.properties.entitlementConfirmed, true);
    // Once given, it covers later changes of the same area.
    assert.equal((await status(author, 'finished')).body.properties.status, 'finished');
    assert.equal(
      (await call<PolygonFeature>('GET', `/api/v1/polygons/${p.id}`, helper)).body
        .properties.entitlementConfirmed,
      null,
    );
    const comment = await call('POST', `/api/v1/polygons/${p.id}/comments`, helper, {
      body: 'Schön geworden',
    });
    assert.equal(comment.status, 201, comment.raw);

    assert.equal(
      (await call('DELETE', `/api/v1/photos/${photoId}`, helper)).status,
      204,
    );
    const after = await call<PolygonFeature>('GET', `/api/v1/polygons/${p.id}`);
    assert.equal(after.body.properties.status, 'proposed');
    assert.equal(after.body.properties.finishedAt, null);

    const pub = await create(author, 1, { spaceType: 'public' });
    assert.equal((await status(author, 'finished', pub.id)).code, 'FORBIDDEN_ADMIN_ONLY');
  });

  it('keeps voting open and review visible for overrides until an admin decides', async () => {
    const author = await user('override');
    const voter = await user('voter');
    const boss = await admin('boss');
    await zone('public', box(0));
    const p = await create(author, 0, { spaceType: 'private' });
    assert.equal(p.properties.spaceVerification, 'user_override');
    await uploadPhoto(author, p.id);
    await call('PATCH', `/api/v1/polygons/${p.id}/status`, author, { status: 'finished' });
    const vote = await call('PUT', `/api/v1/polygons/${p.id}/vote`, voter, { value: -1 });
    assert.equal(vote.status, 200, vote.raw);
    const review = await call<PolygonFeedResponse>(
      'GET',
      '/api/v1/polygons/feed?filter=needs_review',
    );
    assert.deepEqual(review.body.items.map((i) => i.feature.id), [p.id]);

    assert.equal(
      (await call('PATCH', `/api/v1/polygons/${p.id}/space-type`, author, { spaceType: 'public' })).code,
      'FORBIDDEN_ADMIN_ONLY',
    );
    const fixed = await call<PolygonFeature>(
      'PATCH',
      `/api/v1/polygons/${p.id}/space-type`,
      boss,
      { spaceType: 'public' },
    );
    assert.equal(fixed.body.properties.spaceVerification, 'admin_override');
    assert.equal(fixed.body.properties.status, 'proposed');
  });

  it('rejects ownership data and keeps attributions after --replace', async () => {
    const file = path.join(uploadsDir, 'zones.geojson');
    const write = (props: Record<string, unknown>) =>
      fs.writeFile(
        file,
        JSON.stringify({
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: props, geometry: polygon(box(0)) }],
        }),
      );
    const load = (...args: string[]) =>
      app.runAdminCommand(['load-space-zones', 'alkis', file, ...args]);

    await write({ kennung: '41001', eigentuemerart: 'privat' });
    await assert.rejects(load('--license=dl-de/zero-2-0'), /ownership attribute/);
    await write({ kennung: '41001' });
    await assert.rejects(load('--license=dl-de/by-2-0', '--attribution=© Land'), /waiver/i);
    await assert.rejects(load(), /Usage/);
    const first = await load(
      '--license=dl-de/by-2-0',
      '--attribution=© Erste Quelle',
      '--waiver-confirmed',
    );
    assert.equal(first.importedSpaceZoneCount, 1);
    await load('--license=CC0-1.0', '--attribution=Zweite Quelle', '--replace');
    const page = await call('GET', '/auth/licenses');
    assert.match(page.raw, /Erste Quelle/);
    assert.match(page.raw, /Zweite Quelle/);

    await write({ kennung: '41007' });
    assert.equal((await load('--license=CC0-1.0')).importedSpaceZoneCount, 0);
    await write({ kennung: '41006' });
    assert.equal((await load('--license=CC0-1.0')).importedSpaceZoneCount, 1);
  });

  it('pages the feed stably, limits its age and sends licence links', async () => {
    const author = await user('feeder');
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      ids.push((await create(author, i, { spaceType: i % 2 ? 'private' : 'public' })).id);
    }
    await pool.query(
      "UPDATE polygons SET created_at = NOW() - INTERVAL '1 day', feed_at = NOW() - INTERVAL '1 day'",
    );
    await pool.query(
      `UPDATE polygons
       SET created_at = NOW() - INTERVAL '181 days', feed_at = NOW() - INTERVAL '181 days'
       WHERE id = $1`,
      [ids[0]],
    );
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res: { status: number; body: PolygonFeedResponse } = await call(
        'GET',
        `/api/v1/polygons/feed?limit=2${cursor ? `&cursor=${cursor}` : ''}`,
      );
      assert.equal(res.status, 200);
      seen.push(...res.body.items.map((i) => i.feature.id));
      cursor = res.body.nextCursor;
    } while (cursor !== null);
    assert.deepEqual([...seen].sort(), ids.slice(1).sort());

    const res = await app.inject({ url: '/api/v1/polygons/feed?spaceFilter=private' });
    assert.match(String(res.headers.link), /creativecommons\.org\/licenses\/by\/4\.0/);
    assert.match(String(res.headers['x-ratelimit-limit']), /60/);
    assert.equal((res.json() as PolygonFeedResponse).items.length, 2);
    for (const bad of ['abc', Buffer.from('2026-13-45 00:00:00+00|x').toString('base64url')]) {
      assert.equal((await call('GET', `/api/v1/polygons/feed?cursor=${bad}`)).status, 422);
    }
  });

  it('splits statistics by ground type', async () => {
    const author = await user('counter');
    await create(author, 0, { spaceType: 'public' });
    await create(author, 1, { spaceType: 'private' });
    await create(author, 2);
    const stats = await call<{
      totalPolygons: number;
      spaceBreakdown: Record<'public' | 'private', { totalPolygons: number }>;
    }>('GET', '/api/v1/stats');
    assert.equal(stats.body.totalPolygons, 3);
    assert.equal(stats.body.spaceBreakdown.public.totalPolygons, 1);
    assert.equal(stats.body.spaceBreakdown.private.totalPolygons, 1);
  });

  it('requires renewed acceptance for accounts on older terms, but not for erasure', async () => {
    const u = await user('veteran');
    await pool.query('UPDATE users SET terms_version = $2 WHERE id = $1', [
      u.id,
      CURRENT_TERMS_VERSION - 1,
    ]);
    const blocked = await call('POST', '/api/v1/polygons', u, {
      geometry: polygon(box(0)),
      surfaceType: 'asphalt',
    });
    assert.equal(blocked.code, 'TERMS_UPDATE_REQUIRED');
    // Photos and comments fall under the new terms too; voting does not.
    const target = await create(await user('neighbour'), 3);
    assert.equal(
      (await call('POST', `/api/v1/polygons/${target.id}/comments`, u, { body: 'Hallo' })).code,
      'TERMS_UPDATE_REQUIRED',
    );
    assert.equal(
      (await call('PUT', `/api/v1/polygons/${target.id}/vote`, u, { value: 1 })).status,
      200,
    );
    const me = await call<{ termsUpdateRequired: boolean }>('GET', '/api/v1/auth/me', u);
    assert.equal(me.body.termsUpdateRequired, true);
    assert.equal((await call('GET', '/api/v1/auth/me/export', u)).status, 200);
    assert.equal(
      (await call('POST', '/api/v1/auth/me/accept-terms', u, { acceptedTerms: true })).status,
      422,
    );
    const accepted = await call<{ termsUpdateRequired: boolean }>(
      'POST',
      '/api/v1/auth/me/accept-terms',
      u,
      { acceptedTerms: true, acceptedPrivacyPolicy: true },
    );
    assert.equal(accepted.body.termsUpdateRequired, false);
    await create(u, 0);
  });

  it('keeps addresses out of logged errors and creation times only as long as the quota needs them', async () => {
    const mailError = Object.assign(
      new Error('550 <anna@example.org>: Recipient address rejected'),
      { rejected: ['anna@example.org'], response: '550 anna@example.org rejected' },
    );
    const logged = JSON.stringify(serializeErrorWithoutAddresses(mailError));
    assert.ok(!logged.includes('anna@example.org'), logged);
    assert.match(logged, /550 <\[email\]>/);

    const author = await user('quota');
    await create(author, 0);
    await pool.query(
      `INSERT INTO polygon_creations (user_id, created_at) VALUES ($1, NOW() - INTERVAL '3 days')`,
      [author.id],
    );
    await purgeExpiredPersonalData(pool, { pseudonymReservationDays: 365 });
    const left = await pool.query<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM polygon_creations WHERE user_id = $1',
      [author.id],
    );
    assert.equal(left.rows[0]?.n, 1);
  });

  it('withdraws owner statements and announces removed areas when an account is deleted', async () => {
    const owner = await user('leaving');
    const kept = await create(owner, 0, {
      spaceType: 'private',
      helpWanted: true,
      openForPublicAccess: true,
      allowChatContact: true,
      entitlementConfirmed: true,
    });
    assert.equal(kept.properties.helpWanted, true);
    assert.equal((await call('DELETE', '/api/v1/auth/me', owner)).status, 204);
    // The area stays, but nobody is left who could withdraw these statements.
    const flags = await pool.query<{
      open_for_public_access: boolean;
      allow_chat_contact: boolean;
      help_wanted_until: Date | null;
      entitlement_confirmed_at: Date | null;
    }>(
      `SELECT open_for_public_access, allow_chat_contact, help_wanted_until, entitlement_confirmed_at
       FROM polygons WHERE id = $1`,
      [kept.id],
    );
    assert.deepEqual(flags.rows[0], {
      open_for_public_access: false,
      allow_chat_contact: false,
      help_wanted_until: null,
      entitlement_confirmed_at: null,
    });
    const shown = (await call<PolygonFeature>('GET', `/api/v1/polygons/${kept.id}`)).body
      .properties;
    assert.equal(shown.helpWanted, false);

    const purging = await user('purging');
    const gone = await create(purging, 1);
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    app.webhookDispatcher.emit = (event, data) => {
      events.push({ event, data });
    };
    assert.equal(
      (await call('DELETE', '/api/v1/auth/me?purgeContent=true', purging)).status,
      204,
    );
    assert.deepEqual(
      events.map((e) => [e.event, e.data.id, e.data.deletedByAdmin]),
      [['polygon.deleted', gone.id, false]],
    );
  });

  it('publishes a call for help only with confirmation, keeps it out of open data and lets it lapse', async () => {
    const owner = await user('needshelp');
    const denied = await call('POST', '/api/v1/polygons', owner, {
      geometry: polygon(box(0)),
      surfaceType: 'asphalt',
      spaceType: 'private',
      helpWanted: true,
    });
    assert.equal(denied.code, 'ENTITLEMENT_REQUIRED');
    const p = await create(owner, 0, {
      spaceType: 'private',
      helpWanted: true,
      entitlementConfirmed: true,
    });
    assert.equal(p.properties.helpWanted, true);
    const days = (Date.parse(p.properties.helpWantedUntil!) - Date.now()) / 86_400_000;
    assert.ok(days > HELP_WANTED_DAYS - 1 && days <= HELP_WANTED_DAYS, String(days));
    const pub = await create(owner, 1, { spaceType: 'public', helpWanted: true });
    assert.equal(pub.properties.helpWanted, false);

    // Everybody sees the call; only the author sees when it ends.
    const anon = (await call<PolygonFeature>('GET', `/api/v1/polygons/${p.id}`)).body
      .properties;
    assert.equal(anon.helpWanted, true);
    assert.equal(anon.helpWantedUntil, null);

    const bbox = `${LNG - 0.01},${LAT - 0.01},${LNG + 0.01},${LAT + 0.01}`;
    const onMap = await call<PolygonCollectionResponse>(
      'GET',
      `/api/v1/polygons?bbox=${bbox}&filter=help_wanted`,
    );
    assert.deepEqual(onMap.body.features.map((f) => f.id), [p.id]);
    const inFeed = await call<PolygonFeedResponse>(
      'GET',
      '/api/v1/polygons/feed?filter=help_wanted',
    );
    assert.deepEqual(inFeed.body.items.map((i) => i.feature.id), [p.id]);

    // It is a statement about somebody's ground, not open data.
    const exported = await call('GET', '/api/v1/polygons/export.geojson');
    assert.equal(exported.status, 200);
    assert.ok(!exported.raw.includes('helpWanted'));
    assert.equal('helpWanted' in buildPublicPolygonWebhookData(p), false);
    const mine = (
      await call<{ polygons: Record<string, unknown>[] }>(
        'GET',
        '/api/v1/auth/me/export',
        owner,
      )
    ).body;
    assert.equal(typeof mine.polygons[0]!.helpWantedUntil, 'string');

    const patch = (body: unknown) =>
      call<PolygonFeature>('PATCH', `/api/v1/polygons/${p.id}`, owner, body);
    assert.equal((await patch({ helpWanted: false })).body.properties.helpWanted, false);
    assert.equal((await patch({ helpWanted: true })).code, 'ENTITLEMENT_REQUIRED');
    assert.equal(
      (await patch({ helpWanted: true, entitlementConfirmed: true })).body.properties
        .helpWanted,
      true,
    );
    // Renewing a running call needs no new confirmation.
    assert.equal((await patch({ helpWanted: true })).status, 200);

    // It lapses by itself, and the past statement is not kept.
    await pool.query(
      "UPDATE polygons SET help_wanted_until = NOW() - INTERVAL '1 minute' WHERE id = $1",
      [p.id],
    );
    assert.equal(
      (await call<PolygonFeature>('GET', `/api/v1/polygons/${p.id}`, owner)).body
        .properties.helpWanted,
      false,
    );
    await purgeExpiredPersonalData(pool, { pseudonymReservationDays: 365 });
    const stored = await pool.query<{ help_wanted_until: Date | null }>(
      'SELECT help_wanted_until FROM polygons WHERE id = $1',
      [p.id],
    );
    assert.equal(stored.rows[0]!.help_wanted_until, null);

    // Unsealed ground no longer asks for help.
    await patch({ helpWanted: true, entitlementConfirmed: true });
    await uploadPhoto(owner, p.id);
    const done = await call<PolygonFeature>(
      'PATCH',
      `/api/v1/polygons/${p.id}/status`,
      owner,
      { status: 'finished' },
    );
    assert.equal(done.body.properties.status, 'finished', done.raw);
    assert.equal(done.body.properties.helpWanted, false);
  });

  it('moves progress to the top of the feed and narrows it to a section or municipality', async () => {
    const author = await user('localfeed');
    const boss = await admin('feedadmin');
    const near = await create(author, 0, { spaceType: 'public' });
    const far = await create(author, 400, { spaceType: 'public' });
    const legacy = await create(author, 2);
    const feed = () => call<PolygonFeedResponse>('GET', '/api/v1/polygons/feed');
    const setStatus = (status: string) =>
      call('PATCH', `/api/v1/polygons/${near.id}/status`, boss, { status });

    await pool.query(
      `UPDATE polygons
       SET created_at = NOW() - INTERVAL '200 days', feed_at = NOW() - INTERVAL '200 days'
       WHERE id = $1`,
      [near.id],
    );
    // Too old for the feed, until somebody reports progress on it.
    assert.ok(!(await feed()).body.items.some((i) => i.feature.id === near.id));
    assert.equal((await setStatus('finished')).status, 200);
    const afterProgress = (await feed()).body.items;
    assert.equal(afterProgress[0]!.feature.id, near.id);
    assert.equal(afterProgress[0]!.activity, 'finished');
    assert.equal(afterProgress[1]!.activity, 'created');
    assert.ok(Date.now() - Date.parse(afterProgress[0]!.activityAt!) < 60_000);
    // A reset puts it back where its creation date belongs.
    await setStatus('proposed');
    assert.ok(!(await feed()).body.items.some((i) => i.feature.id === near.id));
    await setStatus('in_progress');
    assert.equal((await feed()).body.items[0]!.activity, 'in_progress');

    const section = `${LNG - 0.1},${LAT - 0.1},${LNG + 0.1},${LAT + 0.1}`;
    const local = await call<PolygonFeedResponse>(
      'GET',
      `/api/v1/polygons/feed?bbox=${section}`,
    );
    assert.deepEqual(
      local.body.items.map((i) => i.feature.id).sort(),
      [near.id, legacy.id].sort(),
    );
    assert.equal(
      (await call('GET', '/api/v1/polygons/feed?bbox=5,47,10,52')).code,
      'BBOX_TOO_LARGE',
    );

    const muni = await pool.query<{ id: number }>(
      `INSERT INTO municipalities (ags, name, geom)
       VALUES ('07315000', 'Teststadt', ST_Multi(ST_MakeEnvelope($1, $2, $3, $4, 4326)))
       ON CONFLICT (ags) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [LNG + 0.7, LAT - 0.1, LNG + 0.9, LAT + 0.1],
    );
    await pool.query('UPDATE polygons SET municipality_id = $1 WHERE id = $2', [
      muni.rows[0]!.id,
      far.id,
    ]);
    const town = await call<PolygonFeedResponse>(
      'GET',
      '/api/v1/polygons/feed?ags=07315000',
    );
    assert.deepEqual(town.body.items.map((i) => i.feature.id), [far.id]);
    assert.equal((await call('GET', '/api/v1/polygons/feed?ags=123')).status, 422);

    // Areas from before the classification have their own filter.
    const unknown = await call<PolygonFeedResponse>(
      'GET',
      '/api/v1/polygons/feed?spaceFilter=unknown',
    );
    assert.deepEqual(unknown.body.items.map((i) => i.feature.id), [legacy.id]);
  });

  it('loads a feed page with the same number of queries whatever its size', async () => {
    const author = await user('counter');
    for (let i = 0; i < 4; i++) {
      await create(author, i, { spaceType: 'public' });
    }
    const countQueries = async (limit: number): Promise<number> => {
      const original = pool.query;
      let count = 0;
      (pool as { query: unknown }).query = function counted(
        this: pg.Pool,
        ...args: unknown[]
      ) {
        count += 1;
        return (original as (...a: unknown[]) => unknown).apply(this, args);
      };
      try {
        const res = await call<PolygonFeedResponse>(
          'GET',
          `/api/v1/polygons/feed?limit=${limit}`,
        );
        assert.equal(res.body.items.length, limit);
      } finally {
        (pool as { query: unknown }).query = original;
      }
      return count;
    };
    assert.equal(await countQueries(4), await countQueries(1));
  });

  it('serves land-use zones with licence and credits and shows what a comparison matched', async () => {
    const u = await user('zonesviewer');
    const ring = box(0);
    const [x, y] = ring[0]!;
    const rect = (x1: number, y1: number, x2: number, y2: number) =>
      JSON.stringify(
        polygon([
          [x1, y1],
          [x2, y1],
          [x2, y2],
          [x1, y2],
          [x1, y1],
        ]),
      );
    const small = `${x - 0.001},${y - 0.001},${x + 0.002},${y + 0.002}`;
    const zones = () =>
      call<SpaceZoneCollection>('GET', `/api/v1/space-zones?bbox=${small}`);

    const none = await zones();
    assert.equal(none.status, 200, none.raw);
    assert.equal(none.body.available, false);
    assert.deepEqual(none.body.features, []);

    const credit = await pool.query<{ id: string }>(
      `INSERT INTO import_attributions (license, attribution_text, source_url, purpose)
       VALUES ('ODbL-1.0', '© Testquelle', 'https://example.org/data', 'space_zones')
       RETURNING id`,
    );
    const insertZone = (tier: string, geoJson: string) =>
      pool.query(
        `INSERT INTO space_reference_zones (source, tier, category, import_attribution_id, geom)
         VALUES ('osm_local', $1, 'test', $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326))`,
        [tier, credit.rows[0]!.id, geoJson],
      );
    // Private land use everywhere, a public strip over the left half of the area.
    await insertZone('landuse_private', rect(x - 0.0005, y - 0.0005, x + 0.001, y + 0.001));
    await insertZone('public', rect(x - 0.0005, y - 0.0005, x + 0.0001, y + 0.001));

    const res = await app.inject({ url: `/api/v1/space-zones?bbox=${small}` });
    const body = res.json() as SpaceZoneCollection;
    assert.deepEqual(body.features.map((f) => f.properties.kind).sort(), [
      'private',
      'public',
    ]);
    assert.deepEqual(body.attributions, [
      { text: '© Testquelle', license: 'ODbL-1.0', sourceUrl: 'https://example.org/data' },
    ]);
    assert.equal(body.available, true);
    assert.match(String(res.headers.link), /opendatacommons\.org\/licenses\/odbl/);
    // Nothing about owners or people is part of it.
    assert.deepEqual(Object.keys(body.features[0]!.properties), ['kind']);

    const span = SPACE_ZONE_LIMITS.MAX_BBOX_SPAN_DEG * 2;
    assert.equal(
      (await call('GET', `/api/v1/space-zones?bbox=${x},${y},${x + span},${y + span}`)).code,
      'BBOX_TOO_LARGE',
    );

    const classified = await call<ClassifySpaceResponse>(
      'POST',
      '/api/v1/polygons/classify-space',
      u,
      { geometry: polygon(ring) },
    );
    assert.equal(classified.status, 200, classified.raw);
    assert.equal(classified.body.detectedSpaceType, 'public');
    assert.equal(classified.body.privateOverlapRatio, 0.5);
    assert.deepEqual(
      classified.body.overlay?.features.map((f) => f.properties.kind).sort(),
      ['private', 'public'],
    );
    assert.equal(classified.body.overlay?.attributions[0]?.text, '© Testquelle');
  });

  describe('direct messages', () => {
    let anna: TestUser;
    let ben: TestUser;

    beforeEach(async () => {
      anna = await user('anna');
      ben = await user('ben');
    });

    const optIn = (u: TestUser, allowDirectMessages = true) =>
      call('PATCH', '/api/v1/auth/me/preferences', u, { allowDirectMessages });
    const open = (u: TestUser, body: unknown) =>
      call<ChatThread>('POST', '/api/v1/chats/open', u, body);
    const send = (u: TestUser, id: string, body: string, extra = {}) =>
      call<{ id: string }>('POST', `/api/v1/chats/${id}/messages`, u, { body, ...extra });
    const list = (u: TestUser) =>
      call<{ threads: ChatThread[] }>('GET', '/api/v1/chats', u);
    const read = (u: TestUser, id: string, query = '') =>
      call<ChatMessagesResponse>('GET', `/api/v1/chats/${id}/messages${query}`, u);

    async function conversation(): Promise<string> {
      await optIn(ben);
      const thread = await open(anna, { recipientPseudonym: '@ben' });
      assert.equal(thread.status, 201, thread.raw);
      assert.equal((await send(anna, thread.body.id, 'Hallo Ben')).status, 201);
      return thread.body.id;
    }

    it('is off by default and answers alike for unknown, opted-out and blocking people', async () => {
      const optedOut = await open(anna, { recipientPseudonym: 'ben' });
      const unknown = await open(anna, { recipientPseudonym: 'nobody_here' });
      const id = await conversation();
      await call('PATCH', `/api/v1/chats/${id}/block`, ben, { blocked: true });
      const blocking = await open(anna, { recipientPseudonym: 'ben' });
      for (const res of [optedOut, unknown, blocking]) {
        assert.equal(res.status, 403);
        assert.equal(res.code, 'FORBIDDEN_CHAT_ACCESS');
      }
      const message = (raw: string) =>
        (JSON.parse(raw) as { error: { message: string } }).error.message;
      assert.equal(message(optedOut.raw), message(unknown.raw));
      assert.equal(message(optedOut.raw), message(blocking.raw));
      assert.equal((await send(anna, id, 'noch da?')).code, 'FORBIDDEN_CHAT_ACCESS');
      assert.equal((await open(anna, { recipientPseudonym: 'anna' })).code, 'FORBIDDEN_SELF_CONTACT');
      assert.equal((await list(anna)).body.threads[0]!.canSend, false);
    });

    it('hides empty threads and re-checks consent before the first message', async () => {
      const p = await create(ben, 0, {
        spaceType: 'private',
        allowChatContact: true,
        entitlementConfirmed: true,
      });
      const thread = await open(anna, { polygonId: p.id });
      assert.equal(thread.status, 201, thread.raw);
      assert.equal((await list(ben)).body.threads.length, 0);
      assert.equal((await read(ben, thread.body.id)).status, 404);
      await call('PATCH', `/api/v1/polygons/${p.id}`, ben, { allowChatContact: false });
      assert.equal((await send(anna, thread.body.id, 'Hi')).code, 'FORBIDDEN_CHAT_ACCESS');
    });

    it('supports replies, references with photo credit, unread counts and pagination', async () => {
      const id = await conversation();
      const p = await create(ben, 0, { spaceType: 'public' });
      await uploadPhoto(anna, p.id);
      const comment = await call<{ id: string }>(
        'POST',
        `/api/v1/polygons/${p.id}/comments`,
        anna,
        { body: 'Gute Idee' },
      );
      const other = await create(ben, 1);
      // Until Ben answers, the conversation is a request with one message.
      const second = await send(anna, id, 'Noch etwas');
      assert.equal(second.status, 409);
      assert.equal(second.code, 'CHAT_REQUEST_PENDING');
      const pending = (await list(anna)).body.threads[0]!;
      assert.equal(pending.requestState, 'outgoing');
      assert.equal(pending.canSend, false);
      assert.equal((await list(ben)).body.threads[0]!.requestState, 'incoming');
      assert.equal((await send(ben, id, 'Gern')).status, 201);
      assert.equal((await list(anna)).body.threads[0]!.requestState, 'none');
      assert.equal(
        (await send(anna, id, 'x', {
          referencedCommentId: comment.body.id,
          referencedPolygonId: other.id,
        })).status,
        422,
      );
      await send(anna, id, 'Siehe hier', { referencedCommentId: comment.body.id });
      const unread = await call<{ unreadCount: number }>('GET', '/api/v1/chats/unread-count', ben);
      assert.equal(unread.body.unreadCount, 2);
      const page = await read(ben, id);
      const last = page.body.messages[2]!;
      assert.equal(last.referencedPolygon?.id, p.id);
      assert.equal(last.referencedPolygon?.thumbUploaderPseudonym, 'anna');
      assert.equal(last.referencedComment?.authorPseudonym, 'anna');
      assert.equal(page.body.thread.unreadCount, 0);

      const first = await read(ben, id, '?limit=1');
      assert.ok(first.body.nextBeforeCursor);
      const older = await read(ben, id, `?limit=1&before=${first.body.nextBeforeCursor}`);
      assert.equal(older.body.messages[0]!.body, 'Gern');
      await send(ben, id, 'Antwort');
      const newer = await read(anna, id, `?after=${page.body.nextAfterCursor}`);
      assert.deepEqual(newer.body.messages.map((m) => m.body), ['Antwort']);
      assert.equal((await read(anna, id, '?before=a&after=b')).status, 422);
      const stranger = await user('stranger');
      assert.equal((await read(stranger, id)).status, 404);
    });

    it('does not write on idle polls', async () => {
      const id = await conversation();
      await read(ben, id);
      const xmin = async () =>
        (await pool.query<{ v: string }>('SELECT xmin::text AS v FROM chat_threads WHERE id = $1', [id]))
          .rows[0]!.v;
      const before = await xmin();
      await read(ben, id);
      assert.equal(await xmin(), before);
    });

    it('lets people delete their own messages only', async () => {
      const id = await conversation();
      const reply = await send(ben, id, 'Antwort');
      assert.equal(
        (await call('DELETE', `/api/v1/chats/${id}/messages/${reply.body.id}`, anna)).status,
        404,
      );
      assert.equal((await call('DELETE', `/api/v1/chats/${id}/messages`, anna)).status, 204);
      const rest = await read(ben, id);
      assert.deepEqual(rest.body.messages.map((m) => m.body), ['Antwort']);
      assert.equal(rest.body.thread.messageCount, 1);
      assert.equal(
        (await call('DELETE', `/api/v1/chats/${id}/messages/${reply.body.id}`, ben)).status,
        204,
      );
      assert.equal((await list(ben)).body.threads.length, 0);
    });

    it('keeps a block when all messages are deleted', async () => {
      const id = await conversation();
      await call('PATCH', `/api/v1/chats/${id}/block`, ben, { blocked: true });
      await call('DELETE', `/api/v1/chats/${id}/messages`, anna);
      assert.equal((await open(anna, { recipientPseudonym: 'ben' })).status, 403);
    });

    for (const purge of [false, true]) {
      it(`erases sent messages on account deletion (purge=${purge})`, async () => {
        const id = await conversation();
        await send(ben, id, 'Antwort');
        assert.equal(
          (await call('DELETE', `/api/v1/auth/me${purge ? '?purgeContent=true' : ''}`, anna)).status,
          204,
        );
        const rest = await read(ben, id);
        assert.deepEqual(rest.body.messages.map((m) => m.body), ['Antwort']);
        assert.equal(rest.body.thread.counterpartPseudonym, 'deleted');
        assert.equal(rest.body.thread.canSend, false);
        assert.equal((await call('DELETE', '/api/v1/auth/me', ben)).status, 204);
        const left = await pool.query('SELECT 1 FROM chat_threads UNION ALL SELECT 1 FROM chat_messages');
        assert.equal(left.rowCount, 0);
      });
    }

    it('survives simultaneous deletion of both accounts', async () => {
      await conversation();
      const results = await Promise.all([
        call('DELETE', '/api/v1/auth/me', anna),
        call('DELETE', '/api/v1/auth/me?purgeContent=true', ben),
      ]);
      assert.deepEqual(results.map((r) => r.status), [204, 204]);
      const left = await pool.query('SELECT 1 FROM chat_threads');
      assert.equal(left.rowCount, 0);
    });

    it('exports sent and received messages and empty threads', async () => {
      const id = await conversation();
      await send(ben, id, 'Antwort');
      const carl = await user('carl');
      await optIn(carl);
      await open(anna, { recipientPseudonym: 'carl' });
      const data = (
        await call<{
          account: { allowDirectMessages: boolean };
          chatThreads: { messageCount: number }[];
          chatMessages: { direction: string; body: string }[];
        }>('GET', '/api/v1/auth/me/export', anna)
      ).body;
      assert.equal(data.account.allowDirectMessages, false);
      assert.deepEqual(data.chatThreads.map((t) => t.messageCount).sort(), [0, 2]);
      assert.deepEqual(
        data.chatMessages.map((m) => [m.direction, m.body]),
        [
          ['sent', 'Hallo Ben'],
          ['received', 'Antwort'],
        ],
      );
    });

    it('expires old messages and empty threads', async () => {
      const id = await conversation();
      await send(ben, id, 'neu');
      await pool.query(
        "UPDATE chat_messages SET created_at = NOW() - INTERVAL '400 days' WHERE body = 'Hallo Ben'",
      );
      const carl = await user('carl2');
      await optIn(carl);
      const empty = await open(anna, { recipientPseudonym: 'carl2' });
      await pool.query(
        "UPDATE chat_threads SET created_at = NOW() - INTERVAL '8 days' WHERE id = $1",
        [empty.body.id],
      );
      const result = await purgeExpiredPersonalData(pool, {
        pseudonymReservationDays: 365,
      });
      assert.equal(result.expiredChatMessages, 1);
      assert.equal(result.emptyChatThreads, 1);
      const thread = (await list(anna)).body.threads[0]!;
      assert.equal(thread.messageCount, 1);
    });

    it('accepts reports from participants only and notifies after removal', async () => {
      const id = await conversation();
      const messageId = (await read(ben, id)).body.messages[0]!.id;
      const report = (u: TestUser | null) =>
        call('POST', '/api/v1/content-reports', u, {
          targetType: 'chat_message',
          targetId: messageId,
          reason: 'defamation_illegal',
          explanation: 'Beleidigender Inhalt in der Nachricht.',
          goodFaithConfirmed: true,
          reporterEmail: 'someone.else@example.org',
        });
      const stranger = await user('onlooker');
      assert.equal((await report(null)).status, 401);
      assert.equal((await report(stranger)).status, 404);
      assert.equal((await report(anna)).status, 422);
      assert.equal((await report(ben)).status, 201);
      assert.equal(mailer.contentReports.length, 1);
      assert.equal(mailer.contentReports[0]!.reportedMessage?.body, 'Hallo Ben');
      assert.equal(mailer.contentReportReceipts[0]!.to, 'ben@example.org');

      const removed = await app.runAdminCommand([
        'delete-chat-message',
        messageId,
        'Beleidigung',
      ]);
      assert.equal(removed.deletedChatMessage, true);
      assert.equal(mailer.moderationReasons[0]!.action, 'chat_message_deleted');
      assert.equal(mailer.moderationReasons[0]!.to, 'anna@example.org');
    });

    it('lets people withdraw a request and ask again, within the daily cap', async () => {
      const id = await conversation();
      await call('DELETE', `/api/v1/chats/${id}/messages`, anna);
      // Withdrawn: nothing of it is left for either side.
      assert.equal((await list(ben)).body.threads.length, 0);
      assert.equal((await list(anna)).body.threads.length, 0);
      assert.equal((await pool.query('SELECT 1 FROM chat_threads')).rowCount, 0);

      const again = await open(anna, { recipientPseudonym: 'ben' });
      assert.equal(again.status, 201);
      assert.equal((await send(anna, again.body.id, 'Besser formuliert')).status, 201);
      assert.equal(
        (await send(anna, again.body.id, 'und noch eine')).code,
        'CHAT_REQUEST_PENDING',
      );
      // Starting over counts as a new attempt, so it cannot be repeated without end.
      const attempts = await pool.query<{ n: number }>(
        'SELECT chat_contact_count AS n FROM users WHERE id = $1',
        [anna.id],
      );
      assert.equal(attempts.rows[0]!.n, 2);

      assert.equal((await send(ben, again.body.id, 'Hallo Anna')).status, 201);
      assert.equal((await send(anna, again.body.id, 'Jetzt geht es')).status, 201);
      assert.equal((await list(ben)).body.threads[0]!.requestState, 'none');
    });

    it('erases an unanswered request after the request period', async () => {
      const id = await conversation();
      await pool.query(
        `UPDATE chat_threads
         SET request_sent_at = NOW() - make_interval(days => $2::int),
             created_at = NOW() - make_interval(days => $2::int)
         WHERE id = $1`,
        [id, CHAT_LIMITS.REQUEST_RETENTION_DAYS + 1],
      );
      const result = await purgeExpiredPersonalData(pool, {
        pseudonymReservationDays: 365,
      });
      assert.equal(result.expiredChatMessages, 1);
      assert.equal(result.emptyChatThreads, 1);
      const left = await pool.query(
        'SELECT 1 FROM chat_threads UNION ALL SELECT 1 FROM chat_messages',
      );
      assert.equal(left.rowCount, 0);
      const fresh = await open(anna, { recipientPseudonym: 'ben' });
      assert.equal(fresh.status, 201);
      assert.equal((await send(anna, fresh.body.id, 'Neuer Versuch')).status, 201);
    });

    it('limits how many new people an account can try to reach per day', async () => {
      const id = await conversation();
      const attempts = async () =>
        (
          await pool.query<{ n: number; day: string | null }>(
            'SELECT chat_contact_count AS n, chat_contact_day::text AS day FROM users WHERE id = $1',
            [anna.id],
          )
        ).rows[0]!;
      assert.equal((await attempts()).n, 1);
      // Failed lookups count too; a conversation that exists does not.
      await open(anna, { recipientPseudonym: 'nobody_here' });
      await open(anna, { recipientPseudonym: 'ben' });
      assert.equal((await attempts()).n, 2);

      await pool.query('UPDATE users SET chat_contact_count = $2 WHERE id = $1', [
        anna.id,
        CHAT_LIMITS.MAX_CONTACT_ATTEMPTS_PER_DAY,
      ]);
      const limited = await open(anna, { recipientPseudonym: 'someone_else' });
      assert.equal(limited.status, 429);
      assert.equal(limited.code, 'CHAT_CONTACT_LIMIT');
      assert.equal((await open(anna, { recipientPseudonym: 'ben' })).body.id, id);
      const exported = (
        await call<{
          account: { newConversationAttempts: { date: string; count: number } | null };
        }>('GET', '/api/v1/auth/me/export', anna)
      ).body;
      assert.equal(
        exported.account.newConversationAttempts?.count,
        CHAT_LIMITS.MAX_CONTACT_ATTEMPTS_PER_DAY,
      );

      // A new day starts a new count; the retention job erases the old one.
      await pool.query(
        'UPDATE users SET chat_contact_day = CURRENT_DATE - 1 WHERE id = $1',
        [anna.id],
      );
      assert.equal((await open(anna, { recipientPseudonym: 'someone_else' })).status, 403);
      assert.equal((await attempts()).n, 1);
      await pool.query(
        'UPDATE users SET chat_contact_day = CURRENT_DATE - 1 WHERE id = $1',
        [anna.id],
      );
      const purged = await purgeExpiredPersonalData(pool, {
        pseudonymReservationDays: 365,
      });
      assert.equal(purged.clearedContactCounters, 1);
      assert.deepEqual(await attempts(), { n: 0, day: null });
    });

    it('does not preview photos that were flagged as fake', async () => {
      const id = await conversation();
      await send(ben, id, 'Hi');
      const p = await create(ben, 0, { spaceType: 'public' });
      await uploadPhoto(anna, p.id);
      await pool.query(
        `UPDATE polygon_photos
         SET credibility_score = $2, fake_votes = 3, real_votes = 0
         WHERE polygon_id = $1`,
        [p.id, PHOTO_LIMITS.FAKE_BLUR_SCORE_THRESHOLD],
      );
      await send(anna, id, 'Schau', { referencedPolygonId: p.id });
      const last = (await read(ben, id)).body.messages.at(-1)!;
      assert.equal(last.referencedPolygon?.id, p.id);
      assert.equal(last.referencedPolygon?.thumbUrl, null);
      assert.equal(last.referencedPolygon?.thumbUploaderPseudonym, null);
    });

    it('redacts conversation ids in log paths', () => {
      const id = '0b7c1d0e-1111-4222-8333-444455556666';
      assert.equal(
        toLoggablePath(`/api/v1/chats/${id}/messages?after=x`),
        '/api/v1/chats/[redacted]',
      );
      assert.equal(toLoggablePath('/api/v1/chats/unread-count'), '/api/v1/chats/unread-count');
      assert.equal(toLoggablePath(`/api/v1/polygons/${id}`), `/api/v1/polygons/${id}`);
    });
  });
});
