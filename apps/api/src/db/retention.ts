// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 OpenUnseal Contributors

import type pg from 'pg';

/** Unconfirmed registrations are erased after this many hours (stated in the privacy policy). */
export const UNVERIFIED_ACCOUNT_RETENTION_HOURS = 48;
/** Used or expired email confirmation/reset tokens are kept this long for troubleshooting. */
export const EMAIL_TOKEN_RETENTION_DAYS = 7;

export interface RetentionOptions {
  pseudonymReservationDays: number;
}

export interface RetentionResult {
  unverifiedUsers: number;
  expiredSessions: number;
  staleEmailTokens: number;
  expiredPseudonymReservations: number;
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

  return {
    unverifiedUsers,
    expiredSessions: sessionsRes.rowCount ?? 0,
    staleEmailTokens: tokensRes.rowCount ?? 0,
    expiredPseudonymReservations: reservationsRes.rowCount ?? 0,
  };
}
