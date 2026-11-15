import { ApiError } from '@entsiegelung/shared';

import {
  emailTombstoneCandidates,
  hashCanonicalEmail,
  pseudonymTombstoneCandidates,
} from './crypto.js';

import type pg from 'pg';

interface ReservedRow {
  reason: string;
}

/**
 * Rejects pseudonyms reserved by a self-deleted account (409) or a ban (403).
 * Matches keyed HMAC digests as well as legacy SHA-256 rows.
 */
export async function assertPseudonymNotReserved(
  db: pg.Pool | pg.PoolClient,
  tombstoneSecret: string,
  pseudonym: string,
): Promise<void> {
  const reservedRes = await db.query<ReservedRow>(
    `SELECT reason
     FROM reserved_pseudonyms
     WHERE pseudonym_hash = ANY($1::bytea[])
     ORDER BY (reason = 'self_deleted') ASC
     LIMIT 1`,
    [pseudonymTombstoneCandidates(tombstoneSecret, pseudonym)],
  );
  const reservedRow = reservedRes.rows[0];
  if (!reservedRow) {
    return;
  }
  if (reservedRow.reason !== 'self_deleted') {
    throw new ApiError(
      403,
      'FORBIDDEN_PSEUDONYM_BANNED',
      'This pseudonym is not permitted.',
    );
  }
  throw new ApiError(
    409,
    'AUTH_PSEUDONYM_TAKEN',
    'This pseudonym is unavailable.',
  );
}

/** Whether an email address (or its canonical alias) belongs to a banned account. */
export async function isEmailReserved(
  db: pg.Pool | pg.PoolClient,
  tombstoneSecret: string,
  email: string,
): Promise<boolean> {
  const reservedRes = await db.query<ReservedRow>(
    'SELECT reason FROM reserved_emails WHERE email_hash = ANY($1::bytea[]) LIMIT 1',
    [emailTombstoneCandidates(tombstoneSecret, email)],
  );
  return (reservedRes.rowCount ?? 0) > 0;
}

/** Rejects email addresses (or their canonical alias) that belong to a banned account. */
export async function assertEmailNotReserved(
  db: pg.Pool | pg.PoolClient,
  tombstoneSecret: string,
  email: string,
): Promise<void> {
  if (await isEmailReserved(db, tombstoneSecret, email)) {
    throw new ApiError(
      403,
      'FORBIDDEN_PSEUDONYM_BANNED',
      'Registration with this email address is not permitted.',
    );
  }
}

/**
 * Re-keys `users.canonical_email_hash` with the current HMAC secret.
 *
 * Runs at startup (idempotent): rows written before keyed hashing (plain SHA-256)
 * are upgraded from the stored plaintext email. Rows whose hash is NULL (accounts
 * created before migration 005) are left untouched, exactly as before.
 */
export async function rekeyCanonicalEmailHashes(
  pool: pg.Pool,
  tombstoneSecret: string,
): Promise<number> {
  const res = await pool.query<{ id: string; email: string; canonical_email_hash: Buffer }>(
    `SELECT id, email, canonical_email_hash
     FROM users
     WHERE email IS NOT NULL
       AND canonical_email_hash IS NOT NULL`,
  );
  let updated = 0;
  for (const row of res.rows) {
    const expected = hashCanonicalEmail(tombstoneSecret, row.email);
    if (expected.equals(row.canonical_email_hash)) {
      continue;
    }
    await pool.query(
      'UPDATE users SET canonical_email_hash = $2 WHERE id = $1',
      [row.id, expected],
    );
    updated += 1;
  }
  return updated;
}
