// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PolygonFeatureSchema,
  type ChatMessage,
  type ChatThread,
  type PolygonFeature,
  type PolygonFeedItem,
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
        polygonFilter: 'finished',
      },
      { type: 'SHOW_POLYGON', feature: feature({ spaceType: 'private' }) },
    );
    assert.equal(state.activeMainTab, 'map');
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
      { ...initialAppState, polygonFilter: 'finished' },
      { type: 'SHOW_POLYGON', feature: shown, keepFilters: keep },
    );
    assert.equal(state.polygonFilter, 'finished');
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

  it('announces new feed entries and adds them without losing the list', async () => {
    const { findNewEntries, mergeFreshPage, refreshKnownEntries } = await import(
      '../src/state/feedScope'
    );
    const at = (minute: number): string =>
      new Date(Date.parse('2026-11-20T10:00:00.000Z') + minute * 60_000).toISOString();
    const entry = (n: number, minute: number, upvotes = 0): PolygonFeedItem => {
      const id = `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`;
      return {
        feature: { ...feature({ id, upvotes }), id },
        activity: 'created',
        activityAt: at(minute),
        photos: [],
        topComment: null,
      };
    };
    const ids = (list: readonly PolygonFeedItem[]): number[] =>
      list.map((item) => Number(item.feature.id.slice(-12)));
    const list = [entry(4, 40), entry(3, 30), entry(2, 20), entry(1, 10)];

    // Nothing new: only the votes of known entries are brought up to date.
    const same = [entry(4, 40, 7), entry(3, 30)];
    assert.deepEqual(findNewEntries(list, same), []);
    const refreshed = refreshKnownEntries(list, same);
    assert.deepEqual(ids(refreshed), [4, 3, 2, 1]);
    assert.equal(refreshed[0]!.feature.properties.upvotes, 7);

    // A new area and a status change of a known one are both new entries.
    const fresh = [entry(5, 60), entry(2, 50), entry(4, 40)];
    assert.deepEqual(ids(findNewEntries(list, fresh)), [5, 2]);
    // They are announced, not inserted.
    assert.deepEqual(ids(refreshKnownEntries(list, fresh)), [4, 3, 2, 1]);
    const merged = mergeFreshPage(list, 'older', { items: fresh, nextCursor: 'c' });
    assert.deepEqual(ids(merged.items), [5, 2, 4, 3, 1]);
    assert.equal(merged.cursor, 'older');

    // An older entry that moves up into the page because one was removed is not new.
    const afterRemoval = [entry(4, 40), entry(2, 20), entry(0, 5)];
    assert.deepEqual(findNewEntries([entry(4, 40), entry(3, 30), entry(2, 20)], afterRemoval), []);
    // The removed entry disappears with the next merge.
    const cleaned = mergeFreshPage(list, 'older', {
      items: [entry(5, 60), entry(4, 40), entry(2, 20)],
      nextCursor: 'c',
    });
    assert.deepEqual(ids(cleaned.items), [5, 4, 2, 1]);

    // More new entries than a page holds: no gap, the list starts over.
    const far = mergeFreshPage(list, 'older', {
      items: [entry(9, 90), entry(8, 80)],
      nextCursor: 'c2',
    });
    assert.deepEqual(ids(far.items), [9, 8]);
    assert.equal(far.cursor, 'c2');
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

  it('filters, formats, and sorts messenger threads and timestamps', async () => {
    const {
      avatarInitial,
      filterThreads,
      formatChatDayLabel,
      formatChatTime,
      isSameCalendarDay,
      upsertThreadInList,
    } = await import('../src/state/chatMessages');

    const makeThread = (
      id: string,
      counterpartPseudonym: string,
      lastMessageAt: string | null,
      lastMessagePreview: string | null = null,
    ): ChatThread => ({
      id,
      counterpartPseudonym,
      counterpartActive: counterpartPseudonym !== 'deleted',
      isBlockedByMe: false,
      canSend: true,
      messageCount: lastMessageAt ? 1 : 0,
      unreadCount: 0,
      lastMessageAt,
      lastMessagePreview,
      lastMessageSenderPseudonym: null,
      requestState: 'none',
    });

    const t1 = makeThread('t1', 'Alice_M', '2026-11-26T10:00:00.000Z', 'Courtyard photo');
    const t2 = makeThread('t2', 'Bob_K', '2026-11-27T09:15:00.000Z', 'Hello neighbour');
    const t3 = makeThread('t3', 'Clara', null, null);

    assert.equal(filterThreads([t1, t2], '   ').length, 2);
    assert.deepEqual(filterThreads([t1, t2], 'alice').map((t) => t.id), ['t1']);
    assert.deepEqual(filterThreads([t1, t2], 'NEIGHBOUR').map((t) => t.id), ['t2']);

    assert.equal(avatarInitial('alice'), 'A');
    assert.equal(avatarInitial('deleted'), '?');
    assert.equal(avatarInitial('   '), '?');

    const nowMs = new Date(2026, 10, 27, 15, 0, 0).getTime();
    const todayIso = new Date(2026, 10, 27, 9, 5, 0).toISOString();
    const yesterdayIso = new Date(2026, 10, 26, 18, 30, 0).toISOString();
    const olderIso = new Date(2026, 10, 10, 12, 0, 0).toISOString();

    assert.equal(isSameCalendarDay(todayIso, new Date(nowMs).toISOString()), true);
    assert.equal(isSameCalendarDay(todayIso, yesterdayIso), false);
    assert.equal(isSameCalendarDay('invalid', todayIso), false);

    assert.equal(
      formatChatDayLabel(todayIso, 'de', { today: 'Heute', yesterday: 'Gestern' }, nowMs),
      'Heute',
    );
    assert.equal(
      formatChatDayLabel(yesterdayIso, 'en', { today: 'Today', yesterday: 'Yesterday' }, nowMs),
      'Yesterday',
    );
    assert.match(
      formatChatDayLabel(olderIso, 'de', { today: 'Heute', yesterday: 'Gestern' }, nowMs),
      /^10\.11\.2026$/,
    );
    assert.equal(
      formatChatDayLabel('not-a-date', 'en', { today: 'Today', yesterday: 'Yesterday' }, nowMs),
      '',
    );

    assert.match(formatChatTime(todayIso, 'de'), /^\d{2}:\d{2}$/);
    assert.equal(formatChatTime('bad', 'en'), '');

    const ordered = upsertThreadInList([t1, t2], t3);
    assert.deepEqual(ordered.map((t) => t.id), ['t3', 't2', 't1']);
    const updatedT1 = makeThread('t1', 'Alice_M', '2026-11-27T12:00:00.000Z', 'Updated');
    assert.deepEqual(
      upsertThreadInList([t2, t1], updatedT1).map((t) => t.id),
      ['t1', 't2'],
    );
  });
});
