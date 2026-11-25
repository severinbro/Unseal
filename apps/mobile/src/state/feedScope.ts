// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import { FEED_LIMITS, type BboxBounds, type ChatMessage } from '@openunseal/shared';

export type FeedScope =
  | { kind: 'all' }
  /** The section is taken once, when chosen or refreshed, so the list stays put. */
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
