// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import type { ChatMessage, ChatThread } from '@openunseal/shared';

/** Adds new messages without duplicates, oldest first. */
export function mergeMessages(
  current: readonly ChatMessage[],
  incoming: readonly ChatMessage[],
): ChatMessage[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const message of incoming) {
    byId.set(message.id, message);
  }
  return [...byId.values()].sort((a, b) =>
    a.createdAt === b.createdAt
      ? a.id.localeCompare(b.id)
      : a.createdAt.localeCompare(b.createdAt),
  );
}

/** Filters threads case-insensitively against counterpart pseudonym or preview. */
export function filterThreads(
  threads: readonly ChatThread[],
  query: string,
): ChatThread[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return [...threads];
  }
  return threads.filter(
    (thread) =>
      thread.counterpartPseudonym.toLowerCase().includes(needle) ||
      (thread.lastMessagePreview?.toLowerCase().includes(needle) ?? false),
  );
}

/** Single-character avatar monogram, or '?' for deleted/empty pseudonyms. */
export function avatarInitial(pseudonym: string): string {
  const trimmed = pseudonym.trim();
  if (trimmed.length === 0 || trimmed === 'deleted') {
    return '?';
  }
  return trimmed.charAt(0).toUpperCase();
}

/** True when two ISO timestamps fall on the same local calendar day. */
export function isSameCalendarDay(aIso: string, bIso: string): boolean {
  const aMs = Date.parse(aIso);
  const bMs = Date.parse(bIso);
  if (!Number.isFinite(aMs) || !Number.isFinite(bMs)) {
    return false;
  }
  const a = new Date(aMs);
  const b = new Date(bMs);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Human-readable calendar day label (Today / Yesterday / DD.MM.YYYY). */
export function formatChatDayLabel(
  iso: string,
  locale: 'de' | 'en',
  labels: { today: string; yesterday: string },
  nowMs: number = Date.now(),
): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    return '';
  }
  const date = new Date(ms);
  const today = new Date(nowMs);
  const yesterday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - 1,
  );
  if (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  ) {
    return labels.today;
  }
  if (
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  ) {
    return labels.yesterday;
  }
  return date.toLocaleDateString(locale === 'de' ? 'de-DE' : 'en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** Formats HH:MM message timestamp in the active locale. */
export function formatChatTime(iso: string, locale: 'de' | 'en'): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    return '';
  }
  return new Date(ms).toLocaleTimeString(locale === 'de' ? 'de-DE' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Inserts or updates a thread and keeps `lastMessageAt DESC NULLS FIRST`, then `id ASC`. */
export function upsertThreadInList(
  threads: readonly ChatThread[],
  updated: ChatThread,
): ChatThread[] {
  const next = threads.filter((thread) => thread.id !== updated.id);
  next.push(updated);
  return next.sort((a, b) => {
    if (a.lastMessageAt === null && b.lastMessageAt === null) {
      return a.id.localeCompare(b.id);
    }
    if (a.lastMessageAt === null) {
      return -1;
    }
    if (b.lastMessageAt === null) {
      return 1;
    }
    if (a.lastMessageAt !== b.lastMessageAt) {
      return b.lastMessageAt.localeCompare(a.lastMessageAt);
    }
    return a.id.localeCompare(b.id);
  });
}
