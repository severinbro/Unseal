// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import {
  FEED_LIMITS,
  type BboxBounds,
  type ChatMessage,
  type PolygonFeedItem,
  type PolygonFeedResponse,
} from '@openunseal/shared';

export type FeedScope =
  | { kind: 'all' }
  /** The section is taken once, when it is chosen, so the list stays put. */
  | { kind: 'near'; bbox: BboxBounds }
  | { kind: 'municipality'; ags: string; name: string };

/**
 * The section a "nearby" feed asks for: around the map view, at least
 * MIN_NEAR_SPAN_DEG wide and widened to a coarse grid, so the server only
 * learns a rough area. The device position is never involved.
 */
export function computeFeedBbox(view: BboxBounds): BboxBounds {
  const grid = FEED_LIMITS.BBOX_GRID_DEG;
  const maxHalf = FEED_LIMITS.MAX_BBOX_SPAN_DEG / 2 - grid;
  const half = (span: number): number =>
    Math.min(maxHalf, Math.max(span / 2, FEED_LIMITS.MIN_NEAR_SPAN_DEG / 2));
  const centreLng = (view.minLng + view.maxLng) / 2;
  const centreLat = (view.minLat + view.maxLat) / 2;
  const halfLng = half(view.maxLng - view.minLng);
  const halfLat = half(view.maxLat - view.minLat);
  const down = (value: number): number =>
    Number((Math.floor(value / grid + 1e-9) * grid).toFixed(2));
  const up = (value: number): number =>
    Number((Math.ceil(value / grid - 1e-9) * grid).toFixed(2));
  return {
    minLng: Math.max(-180, down(centreLng - halfLng)),
    minLat: Math.max(-90, down(centreLat - halfLat)),
    maxLng: Math.min(180, up(centreLng + halfLng)),
    maxLat: Math.min(90, up(centreLat + halfLat)),
  };
}

/** Whether voting on an area is open to this viewer; mirrors the server rules. */
export function describeVoteAccess(properties: {
  status: string;
  spaceVerification: string;
  isAuthor: boolean;
}): 'open' | 'own' | 'closed' {
  if (properties.isAuthor) {
    return 'own';
  }
  return properties.status === 'proposed' ||
    properties.spaceVerification === 'user_override'
    ? 'open'
    : 'closed';
}

/**
 * Index of the first message that was unread when the conversation was opened,
 * or -1. Only the reader sees this; nothing is reported to the other person.
 */
export function firstUnreadIndex(
  messages: readonly ChatMessage[],
  unreadCount: number,
): number {
  if (unreadCount <= 0) {
    return -1;
  }
  let remaining = unreadCount;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (!messages[i]!.isOwnMessage) {
      remaining -= 1;
      if (remaining === 0) {
        return i;
      }
    }
  }
  return messages.findIndex((message) => !message.isOwnMessage);
}

/**
 * "2 hours ago" for the first week, a date afterwards. Written out by hand
 * because Intl.RelativeTimeFormat is not available on every device.
 */
export function formatRelativeTime(
  iso: string,
  locale: 'de' | 'en',
  nowMs: number,
): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) {
    return '';
  }
  const minutes = Math.max(0, Math.floor((nowMs - then) / 60_000));
  const de = locale === 'de';
  if (minutes < 1) {
    return de ? 'gerade eben' : 'just now';
  }
  if (minutes < 60) {
    return de ? `vor ${minutes} Min.` : `${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return de ? `vor ${hours} Std.` : `${hours} h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return de
      ? `vor ${days} ${days === 1 ? 'Tag' : 'Tagen'}`
      : `${days} ${days === 1 ? 'day' : 'days'} ago`;
  }
  return new Date(then).toLocaleDateString(de ? 'de-DE' : 'en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** When an entry got its place in the feed. */
function activityMs(item: PolygonFeedItem): number {
  return Date.parse(item.activityAt ?? item.feature.properties.createdAt);
}

const entryKey = (item: PolygonFeedItem): string =>
  `${item.feature.id}@${activityMs(item)}`;

/**
 * Entries of a freshly loaded first page that came in after the list was
 * loaded: new areas, and known ones with a newer status change.
 */
export function findNewEntries(
  items: readonly PolygonFeedItem[],
  fresh: readonly PolygonFeedItem[],
): PolygonFeedItem[] {
  if (items.length === 0) {
    return [...fresh];
  }
  const known = new Set(items.map(entryKey));
  const newest = activityMs(items[0]!);
  return fresh.filter(
    (item) => !known.has(entryKey(item)) && activityMs(item) >= newest,
  );
}

/**
 * Brings votes and counts of entries on screen up to date without moving
 * anything: order, photos and comments stay until the reader asks for more.
 */
export function refreshKnownEntries(
  items: readonly PolygonFeedItem[],
  fresh: readonly PolygonFeedItem[],
): PolygonFeedItem[] {
  const byKey = new Map(fresh.map((item) => [entryKey(item), item]));
  return items.map((item) => {
    const update = byKey.get(entryKey(item));
    return update ? { ...item, feature: update.feature } : item;
  });
}

/**
 * Puts a fresh first page on top of the loaded list. Entries that are gone
 * from the stretch it covers are dropped. Without any overlap there may be a
 * gap in between, so the list starts over with the fresh page.
 */
export function mergeFreshPage(
  items: readonly PolygonFeedItem[],
  cursor: string | null,
  fresh: PolygonFeedResponse,
): { items: PolygonFeedItem[]; cursor: string | null } {
  const freshKeys = new Set(fresh.items.map(entryKey));
  const overlaps = items.some((item) => freshKeys.has(entryKey(item)));
  const last = fresh.items[fresh.items.length - 1];
  if (fresh.nextCursor === null || !overlaps || last === undefined) {
    return { items: [...fresh.items], cursor: fresh.nextCursor };
  }
  const freshIds = new Set(fresh.items.map((item) => item.feature.id));
  const older = items.filter(
    (item) => !freshIds.has(item.feature.id) && activityMs(item) <= activityMs(last),
  );
  return {
    items: [...fresh.items, ...older],
    cursor: older.length > 0 ? cursor : fresh.nextCursor,
  };
}
