// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PolygonFeatureSchema,
  type ChatMessage,
  type PolygonFeature,
} from '@openunseal/shared';

import { getSocialCopy } from '../src/i18n/social';
import {
  appReducer,
  EMPTY_DRAFT_SPACE,
  initialAppState,
  isDraftSpaceComplete,
  type AppState,
} from '../src/state/appState';

const ID = '22222222-2222-4222-8222-222222222222';

function feature(overrides: Record<string, unknown> = {}): PolygonFeature {
  return PolygonFeatureSchema.parse({
    type: 'Feature',
    id: ID,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [9.9935, 53.551],
          [9.9936, 53.551],
          [9.9936, 53.5511],
          [9.9935, 53.551],
        ],
      ],
    },
    properties: {
      id: ID,
      surfaceType: 'asphalt',
      note: null,
      areaM2: 40,
      authorPseudonym: 'someone',
      upvotes: 0,
      downvotes: 0,
      score: 0,
      myVote: 0,
      isAuthor: false,
      createdAt: '2026-11-12T10:00:00.000Z',
      updatedAt: '2026-11-12T10:00:00.000Z',
      ...overrides,
    },
  });
}

describe('social client state', () => {
  it('needs an explicit ground type and confirmation for owner statements', () => {
    assert.equal(isDraftSpaceComplete(EMPTY_DRAFT_SPACE), false);
    let state: AppState = appReducer(initialAppState, { type: 'START_DRAW' });
    state = appReducer(state, {
      type: 'SET_DRAFT_SPACE',
      patch: { spaceType: 'private', allowChatContact: true },
    });
    assert.equal(isDraftSpaceComplete(state.draftSpace), false);
    state = appReducer(state, {
      type: 'SET_DRAFT_SPACE',
      patch: { entitlementConfirmed: true },
    });
    assert.equal(isDraftSpaceComplete(state.draftSpace), true);
    // Switching to public drops owner statements.
    state = appReducer(state, {
      type: 'SET_DRAFT_SPACE',
      patch: { spaceType: 'public' },
    });
    assert.deepEqual(state.draftSpace, { ...EMPTY_DRAFT_SPACE, spaceType: 'public' });
  });

  it('shows a polygon from feed or chat and lifts filters that would hide it', () => {
    const state = appReducer(
      {
        ...initialAppState,
        activeMainTab: 'feed',
        spaceFilter: 'public',
        polygonFilter: 'finished',
      },
      { type: 'SHOW_POLYGON', feature: feature({ spaceType: 'private' }) },
    );
    assert.equal(state.activeMainTab, 'map');
    assert.equal(state.spaceFilter, 'all');
    assert.equal(state.polygonFilter, 'all');
    assert.equal(state.selectedFeatureId, ID);
    assert.equal(state.cameraTarget?.seq, 1);
  });

  it('keeps voting open for overrides only', () => {
    const vote = (overrides: Record<string, unknown>) =>
      appReducer(
        { ...initialAppState, features: [feature(overrides)] },
        { type: 'CAST_VOTE', polygonId: ID, value: -1 },
      ).pendingIntent;
    assert.equal(vote({ status: 'finished' }), null);
    assert.notEqual(
      vote({ status: 'finished', spaceVerification: 'user_override' }),
      null,
    );
  });

  it('scrubs viewer-specific fields on logout', () => {
    const state = appReducer(
      {
        ...initialAppState,
        features: [
          feature({
            canMessageAuthor: true,
            allowChatContact: true,
            detectedSpaceType: 'private',
            privateOverlapRatio: 1,
          }),
        ],
      },
      { type: 'LOGOUT_SUCCEEDED' },
    );
    const p = state.features[0]!.properties;
    assert.equal(p.canMessageAuthor, false);
    assert.equal(p.allowChatContact, null);
    assert.equal(p.detectedSpaceType, null);
    assert.equal(p.privateOverlapRatio, null);
  });

  it('ships the same texts in both languages', () => {
    const de = getSocialCopy('de') as unknown as Record<string, unknown>;
    const en = getSocialCopy('en') as unknown as Record<string, unknown>;
    assert.deepEqual(Object.keys(de).sort(), Object.keys(en).sort());
  });

  it('merges chat messages without duplicates', async () => {
    const message = (id: string, createdAt: string) =>
      ({ id, createdAt }) as ChatMessage;
    const { mergeMessages } = await import('../src/state/chatMessages');
    const merged = mergeMessages(
      [message('b', '2026-11-12T10:00:01.000Z')],
      [
        message('a', '2026-11-12T10:00:00.000Z'),
        message('b', '2026-11-12T10:00:01.000Z'),
      ],
    );
    assert.deepEqual(merged.map((m) => m.id), ['a', 'b']);
  });

  it('keeps an area selected while the map travels to it', () => {
    const target = feature();
    const elsewhere = { minLng: 13.4, minLat: 52.5, maxLng: 13.41, maxLat: 52.51 };
    let state: AppState = appReducer(
      { ...initialAppState, viewport: { bbox: elsewhere, zoom: 17 } },
      { type: 'SHOW_POLYGON', feature: target },
    );
    // The reload of the section the map is still showing does not contain it.
    state = appReducer(state, {
      type: 'VIEWPORT_FEATURES_LOADED',
      features: [],
      truncated: false,
    });
    assert.equal(state.selectedFeatureId, ID);
    assert.deepEqual(state.features.map((f) => f.id), [ID]);

    // Arrived: from now on the loaded section decides again.
    const there = { minLng: 9.99, minLat: 53.55, maxLng: 10.0, maxLat: 53.56 };
    state = appReducer(state, { type: 'SET_VIEWPORT', bbox: there, zoom: 18 });
    state = appReducer(state, {
      type: 'VIEWPORT_FEATURES_LOADED',
      features: [target],
      truncated: false,
    });
    assert.equal(state.selectedFeatureId, ID);
    assert.equal(state.pinnedFeature, null);
    state = appReducer(state, {
      type: 'VIEWPORT_FEATURES_LOADED',
      features: [],
      truncated: false,
    });
    assert.equal(state.selectedFeatureId, null);

    // An area that is gone on arrival does not stay selected.
    state = appReducer(
      { ...initialAppState, viewport: { bbox: there, zoom: 18 } },
      { type: 'SHOW_POLYGON', feature: target },
    );
    state = appReducer(state, {
      type: 'VIEWPORT_FEATURES_LOADED',
      features: [],
      truncated: false,
    });
    assert.equal(state.selectedFeatureId, null);

    // Nothing of a signed-in viewer survives in the pinned copy after logout.
    state = appReducer(
      { ...initialAppState, viewport: { bbox: elsewhere, zoom: 17 } },
      { type: 'SHOW_POLYGON', feature: feature({ isAuthor: true }) },
    );
    state = appReducer(state, { type: 'LOGOUT_SUCCEEDED' });
    assert.equal(state.pinnedFeature, null);
  });

  it('keeps the filters when the shown area passes them', async () => {
    const { polygonMatchesFilters } = await import('@openunseal/shared');
    const shown = feature({ status: 'finished', spaceType: 'public' });
    const now = Date.parse('2026-11-20T10:00:00.000Z');
    const keep = polygonMatchesFilters(shown.properties, 'finished', 'public', now);
    assert.equal(keep, true);
    const state = appReducer(
      { ...initialAppState, spaceFilter: 'public', polygonFilter: 'finished' },
      { type: 'SHOW_POLYGON', feature: shown, keepFilters: keep },
    );
    assert.equal(state.polygonFilter, 'finished');
    assert.equal(state.spaceFilter, 'public');
    assert.equal(state.selectedFeatureId, ID);

    const p = shown.properties;
    assert.equal(polygonMatchesFilters(p, 'in_progress', 'all', now), false);
    assert.equal(polygonMatchesFilters(p, 'all', 'unknown', now), false);
    assert.equal(polygonMatchesFilters(p, 'established', 'all', now), true);
    assert.equal(polygonMatchesFilters(p, 'new', 'all', now), false);
    assert.equal(polygonMatchesFilters(p, 'help_wanted', 'all', now), false);
    assert.equal(
      polygonMatchesFilters(
        feature({ helpWanted: true, spaceType: 'private' }).properties,
        'help_wanted',
        'private',
        now,
      ),
      true,
    );
    assert.equal(
      polygonMatchesFilters(
        feature({ status: 'finished', spaceVerification: 'user_override' }).properties,
        'needs_review',
        'all',
        now,
      ),
      true,
    );
  });

  it('sends a call for help only together with the confirmation', () => {
    let state: AppState = appReducer(initialAppState, { type: 'START_DRAW' });
    state = appReducer(state, {
      type: 'SET_DRAFT_SPACE',
      patch: { spaceType: 'private', helpWanted: true },
    });
    assert.equal(isDraftSpaceComplete(state.draftSpace), false);
    state = appReducer(state, {
      type: 'SET_DRAFT_SPACE',
      patch: { entitlementConfirmed: true },
    });
    assert.equal(isDraftSpaceComplete(state.draftSpace), true);
  });

  it('asks for a coarse section around the map view, never a precise one', async () => {
    const { computeFeedBbox } = await import('../src/state/feedScope');
    const { FEED_LIMITS } = await import('@openunseal/shared');
    // A street-level view of a few hundred metres ...
    const bbox = computeFeedBbox({
      minLng: 8.2731,
      minLat: 49.9984,
      maxLng: 8.2752,
      maxLat: 49.9996,
    });
    // ... becomes a section of at least MIN_NEAR_SPAN_DEG on the 0.05° grid.
    assert.deepEqual(bbox, { minLng: 8.1, minLat: 49.8, maxLng: 8.45, maxLat: 50.15 });
    for (const value of Object.values(bbox)) {
      const steps = value / FEED_LIMITS.BBOX_GRID_DEG;
      assert.ok(Math.abs(steps - Math.round(steps)) < 1e-6, String(value));
    }
    // A view of all of Germany is cut down to what the server accepts.
    const wide = computeFeedBbox({ minLng: 5, minLat: 47, maxLng: 15, maxLat: 55 });
    assert.ok(wide.maxLng - wide.minLng <= FEED_LIMITS.MAX_BBOX_SPAN_DEG + 1e-9);
    assert.ok(wide.maxLat - wide.minLat <= FEED_LIMITS.MAX_BBOX_SPAN_DEG + 1e-9);
  });

  it('offers voting on feed cards only where the server allows it', async () => {
    const { describeVoteAccess } = await import('../src/state/feedScope');
    const access = (overrides: Record<string, unknown>) =>
      describeVoteAccess(feature(overrides).properties);
    assert.equal(access({}), 'open');
    assert.equal(access({ isAuthor: true }), 'own');
    assert.equal(access({ status: 'in_progress' }), 'closed');
    assert.equal(
      access({ status: 'finished', spaceVerification: 'user_override' }),
      'open',
    );
  });

  it('marks where the unread messages of a conversation start', async () => {
    const { firstUnreadIndex } = await import('../src/state/feedScope');
    const messages = [true, false, true, false, false].map(
      (isOwnMessage, i) => ({ id: String(i), isOwnMessage }) as ChatMessage,
    );
    assert.equal(firstUnreadIndex(messages, 0), -1);
    assert.equal(firstUnreadIndex(messages, 1), 4);
    assert.equal(firstUnreadIndex(messages, 2), 3);
    // More unread than loaded: start at the first message of the other person.
    assert.equal(firstUnreadIndex(messages, 9), 1);
  });

  it('tells how long ago something happened, then switches to the date', async () => {
    const { formatRelativeTime } = await import('../src/state/feedScope');
    const now = Date.parse('2026-11-25T12:00:00.000Z');
    const ago = (ms: number, locale: 'de' | 'en' = 'de') =>
      formatRelativeTime(new Date(now - ms).toISOString(), locale, now);
    const minute = 60_000;
    assert.equal(ago(20_000), 'gerade eben');
    assert.equal(ago(5 * minute), 'vor 5 Min.');
    assert.equal(ago(3 * 60 * minute), 'vor 3 Std.');
    assert.equal(ago(24 * 60 * minute), 'vor 1 Tag');
    assert.equal(ago(3 * 24 * 60 * minute), 'vor 3 Tagen');
    assert.equal(ago(3 * 24 * 60 * minute, 'en'), '3 days ago');
    assert.match(ago(10 * 24 * 60 * minute), /^15\.11\.2026$/);
    // A clock that runs behind never produces a negative age.
    assert.equal(ago(-5 * minute), 'gerade eben');
    assert.equal(formatRelativeTime('not a date', 'de', now), '');
  });

  it('draws land use beneath the proposals in two distinguishable colours', async () => {
    const {
      SPACE_ZONES_SOURCE_ID,
      SPACE_ZONE_COLORS,
      buildSpaceZoneLayerSpecs,
      buildSpaceZonesGeoJson,
    } = await import('../src/map/styleBuilder');
    const [fill, line] = buildSpaceZoneLayerSpecs();
    assert.equal(fill.source, SPACE_ZONES_SOURCE_ID);
    assert.equal(line.source, SPACE_ZONES_SOURCE_ID);
    assert.deepEqual(fill.paint['fill-color'], [
      'match',
      ['get', 'kind'],
      'private',
      SPACE_ZONE_COLORS.private,
      SPACE_ZONE_COLORS.public,
    ]);
    assert.notEqual(SPACE_ZONE_COLORS.private, SPACE_ZONE_COLORS.public);
    assert.deepEqual(buildSpaceZonesGeoJson(null), {
      type: 'FeatureCollection',
      features: [],
    });
  });

  it('draws a closed silhouette inside its box', async () => {
    const { computeSilhouetteSegments } = await import('../src/state/silhouette');
    const ring = feature().geometry.coordinates[0]!;
    const segments = computeSilhouetteSegments(ring, 120, 90);
    assert.equal(segments.length, 3);
    for (const s of segments) {
      assert.ok(s.width > 0 && s.width < 150);
    }
    assert.deepEqual(computeSilhouetteSegments([], 120, 90), []);
  });
});
