// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 OpenUnseal Contributors

import { CHAT_LIMITS } from '@openunseal/shared';

import type pg from 'pg';

/** Unconfirmed registrations are erased after this many hours (stated in the privacy policy). */
export const UNVERIFIED_ACCOUNT_RETENTION_HOURS = 48;
/** Used or expired email confirmation/reset tokens are kept this long for troubleshooting. */
export const EMAIL_TOKEN_RETENTION_DAYS = 7;

export interface RetentionOptions {
  pseudonymReservationDays: number;
  chatRetentionDays?: number | undefined;
}

export interface RetentionResult {
  unverifiedUsers: number;
  expiredSessions: number;
  staleEmailTokens: number;
  expiredPseudonymReservations: number;
  expiredChatMessages: number;
  emptyChatThreads: number;
  clearedContactCounters: number;
}

type Queryable = pg.Pool | pg.PoolClient;

/**
 * GDPR Art. 5(1)(e) storage limitation: erase unconfirmed registrations whose
 * confirmation link has expired and that are older than 48 hours.
 */
export async function purgeAbandonedUnverifiedAccounts(db: Queryable): Promise<number> {
  const res = await db.query(
    `DELETE FROM users u
     WHERE u.email_verified_at IS NULL
       AND u.created_at < NOW() - make_interval(hours => $1)
       AND NOT EXISTS (
         SELECT 1 FROM email_tokens et
         WHERE et.user_id = u.id
           AND et.purpose = 'verify_email'
           AND et.consumed_at IS NULL
           AND et.expires_at > NOW()
       )`,
    [UNVERIFIED_ACCOUNT_RETENTION_HOURS],
  );
  return res.rowCount ?? 0;
}

/**
 * Periodic storage-limitation job (GDPR Art. 5(1)(e)). Runs hourly from the
 * server and is safe to run concurrently from several instances when guarded
 * by an advisory lock.
 */
export async function purgeExpiredPersonalData(
  db: Queryable,
  options: RetentionOptions,
): Promise<RetentionResult> {
  const unverifiedUsers = await purgeAbandonedUnverifiedAccounts(db);

  const sessionsRes = await db.query(
    'DELETE FROM sessions WHERE expires_at <= NOW()',
  );

  const tokensRes = await db.query(
    `DELETE FROM email_tokens
     WHERE (consumed_at IS NOT NULL AND consumed_at < NOW() - make_interval(days => $1))
        OR expires_at < NOW() - make_interval(days => $1)`,
    [EMAIL_TOKEN_RETENTION_DAYS],
  );

  // Self-deletion tombstones only exist to stop impersonation for a limited time.
  // Ban tombstones are kept until an operator lifts them (`admin lift-ban`).
  const reservationsRes = await db.query(
    `DELETE FROM reserved_pseudonyms
     WHERE reason = 'self_deleted'
       AND created_at < NOW() - make_interval(days => $1)`,
    [options.pseudonymReservationDays],
  );

  const chatRes = await db.query<{ deleted: number }>(
    `WITH expired AS (
       DELETE FROM chat_messages m
       USING chat_threads t
       WHERE t.id = m.thread_id
         AND (
           m.created_at < NOW() - make_interval(days => $1)
           -- A first message nobody answered does not wait for the general limit.
           OR (
             t.accepted_at IS NULL
             AND t.request_sent_at < NOW() - make_interval(days => $2)
           )
         )
       RETURNING m.id, m.thread_id
     ),
     remaining AS (
       SELECT t.id, COUNT(m.id)::int AS n, MAX(m.created_at) AS last_at
       FROM (SELECT DISTINCT thread_id AS id FROM expired) t
       LEFT JOIN chat_messages m
         ON m.thread_id = t.id AND m.id NOT IN (SELECT id FROM expired)
       GROUP BY t.id
     ),
     updated AS (
       UPDATE chat_threads t
       SET message_count = r.n,
           last_message_at = r.last_at,
           request_sent_at = CASE
             WHEN r.n = 0 AND t.accepted_at IS NULL THEN NULL
             ELSE t.request_sent_at
           END
       FROM remaining r WHERE t.id = r.id
     )
     SELECT COUNT(*)::int AS deleted FROM expired`,
    [
      options.chatRetentionDays ?? CHAT_LIMITS.DEFAULT_RETENTION_DAYS,
      CHAT_LIMITS.REQUEST_RETENTION_DAYS,
    ],
  );
  // Blocks between two existing accounts are kept so they cannot be reset.
  const threadsRes = await db.query(
    `DELETE FROM chat_threads
     WHERE message_count = 0
       AND created_at < NOW() - make_interval(days => $1)
       AND ((NOT blocked_by_low AND NOT blocked_by_high)
            OR user_low_id IS NULL OR user_high_id IS NULL)`,
    [CHAT_LIMITS.EMPTY_THREAD_RETENTION_DAYS],
  );

  // The per-day counter of new conversations has served its purpose a day later.
  const countersRes = await db.query(
    `UPDATE users
     SET chat_contact_day = NULL, chat_contact_count = 0
     WHERE chat_contact_day < CURRENT_DATE`,
  );
  // A lapsed call for help is not kept as a past statement about the ground.
  await db.query(
    `UPDATE polygons SET help_wanted_until = NULL
     WHERE help_wanted_until IS NOT NULL AND help_wanted_until <= NOW()`,
  );

  return {
    unverifiedUsers,
    expiredSessions: sessionsRes.rowCount ?? 0,
    staleEmailTokens: tokensRes.rowCount ?? 0,
    expiredPseudonymReservations: reservationsRes.rowCount ?? 0,
    expiredChatMessages: chatRes.rows[0]?.deleted ?? 0,
    emptyChatThreads: threadsRes.rowCount ?? 0,
    clearedContactCounters: countersRes.rowCount ?? 0,
  };
}
