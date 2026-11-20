// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Unseal Contributors

import { ApiError } from '@entsiegelung/shared';

import type pg from 'pg';

/**
 * GDPR Art. 15 (access) and Art. 20 (portability): everything stored about one
 * account, in a structured, machine-readable format.
 *
 * Deliberately excluded are security secrets that would weaken the account if
 * leaked (Argon2id password hash, hashed session/email tokens, the keyed
 * canonical-email hash); `excludedSecurityData` lists them so the export stays
 * transparent about their existence.
 */
export interface UserDataExport {
  format: 'unseal-user-data-export';
  version: 1;
  exportedAt: string;
  account: {
    id: string;
    pseudonym: string;
    email: string | null;
    role: string;
    createdAt: string;
    emailVerifiedAt: string | null;
    privacyPolicyAcknowledgedAt: string | null;
    termsAcceptedAt: string | null;
    lastActiveDate: string | null;
    failedLoginAttempts: number;
    loginBlockedAt: string | null;
    trustedAt: string | null;
  };
  sessions: Array<{ createdAt: string; expiresAt: string }>;
  emailActionLinks: Array<{
    purpose: string;
    createdAt: string;
    expiresAt: string;
    consumedAt: string | null;
  }>;
  polygonCreationTimestamps: string[];
  polygons: Array<{
    id: string;
    status: string;
    surfaceType: string;
    note: string | null;
    areaM2: number;
    geometry: unknown;
    createdAt: string;
    updatedAt: string;
    finishedAt: string | null;
  }>;
  polygonsMarkedFinishedByYou: string[];
  photos: Array<{
    id: string;
    polygonId: string;
    url: string;
    thumbUrl: string;
    width: number;
    height: number;
    gpsVerified: boolean;
    createdAt: string;
  }>;
  comments: Array<{
    id: string;
    polygonId: string;
    parentId: string | null;
    body: string;
    createdAt: string;
    updatedAt: string;
  }>;
  polygonVotes: Array<{
    polygonId: string;
    value: number;
    createdAt: string;
    updatedAt: string;
  }>;
  photoVotes: Array<{
    photoId: string;
    value: number;
    createdAt: string;
    updatedAt: string;
  }>;
  commentUpvotes: Array<{ commentId: string; createdAt: string }>;
  polygonFlags: Array<{
    polygonId: string;
    reason: string;
    note: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  excludedSecurityData: string[];
}

type Queryable = pg.Pool | pg.PoolClient;

function iso(value: Date): string {
  return value.toISOString();
}

function isoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function isoDateOrNull(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** Looks up an account by pseudonym or email (case-insensitive). */
export async function findUserIdByIdentifier(
  db: Queryable,
  identifierLower: string,
): Promise<string> {
  const res = await db.query<{ id: string }>(
    `SELECT id FROM users
     WHERE LOWER(pseudonym) = $1 OR LOWER(email) = $1
     LIMIT 1`,
    [identifierLower],
  );
  const row = res.rows[0];
  if (!row) {
    throw new ApiError(404, 'NOT_FOUND', 'User account not found.');
  }
  return row.id;
}

export async function collectUserData(
  db: Queryable,
  userId: string,
  options: { publicBaseUrl: string },
): Promise<UserDataExport> {
  const userRes = await db.query<{
    id: string;
    pseudonym: string;
    email: string | null;
    role: string;
    created_at: Date;
    email_verified_at: Date | null;
    privacy_accepted_at: Date | null;
    terms_accepted_at: Date | null;
    last_login_at: Date | null;
    failed_login_attempts: number;
    login_blocked_at: Date | null;
    trusted_at: Date | null;
  }>(
    `SELECT id, pseudonym, email, role, created_at, email_verified_at,
            privacy_accepted_at, terms_accepted_at, last_login_at,
            failed_login_attempts, login_blocked_at, trusted_at
     FROM users WHERE id = $1`,
    [userId],
  );
  const user = userRes.rows[0];
  if (!user) {
    throw new ApiError(404, 'NOT_FOUND', 'User account not found.');
  }

  const baseUrl = options.publicBaseUrl.replace(/\/+$/, '');

  const [
    sessionsRes,
    tokensRes,
    creationsRes,
    polygonsRes,
    finishedRes,
    photosRes,
    commentsRes,
    votesRes,
    photoVotesRes,
    commentVotesRes,
    flagsRes,
  ] = await Promise.all([
    db.query<{ created_at: Date; expires_at: Date }>(
      'SELECT created_at, expires_at FROM sessions WHERE user_id = $1 ORDER BY created_at',
      [userId],
    ),
    db.query<{
      purpose: string;
      created_at: Date;
      expires_at: Date;
      consumed_at: Date | null;
    }>(
      `SELECT purpose, created_at, expires_at, consumed_at
       FROM email_tokens WHERE user_id = $1 ORDER BY created_at`,
      [userId],
    ),
    db.query<{ created_at: Date }>(
      'SELECT created_at FROM polygon_creations WHERE user_id = $1 ORDER BY created_at',
      [userId],
    ),
    db.query<{
      id: string;
      status: string;
      surface_type: string;
      note: string | null;
      area_m2: number;
      geometry: string;
      created_at: Date;
      updated_at: Date;
      finished_at: Date | null;
    }>(
      `SELECT id, status, surface_type, note, area_m2,
              ST_AsGeoJSON(geom, 7) AS geometry,
              created_at, updated_at, finished_at
       FROM polygons WHERE user_id = $1 ORDER BY created_at, id`,
      [userId],
    ),
    db.query<{ id: string }>(
      'SELECT id FROM polygons WHERE finished_by = $1 ORDER BY finished_at, id',
      [userId],
    ),
    db.query<{
      id: string;
      polygon_id: string;
      file_name: string;
      thumb_name: string;
      width: number;
      height: number;
      gps_verified: boolean;
      created_at: Date;
    }>(
      `SELECT id, polygon_id, file_name, thumb_name, width, height, gps_verified, created_at
       FROM polygon_photos WHERE user_id = $1 ORDER BY created_at, id`,
      [userId],
    ),
    db.query<{
      id: string;
      polygon_id: string;
      parent_id: string | null;
      body: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, polygon_id, parent_id, body, created_at, updated_at
       FROM polygon_comments WHERE user_id = $1 ORDER BY created_at, id`,
      [userId],
    ),
    db.query<{ polygon_id: string; value: number; created_at: Date; updated_at: Date }>(
      `SELECT polygon_id, value, created_at, updated_at
       FROM votes WHERE user_id = $1 ORDER BY created_at, polygon_id`,
      [userId],
    ),
    db.query<{ photo_id: string; value: number; created_at: Date; updated_at: Date }>(
      `SELECT photo_id, value, created_at, updated_at
       FROM polygon_photo_votes WHERE user_id = $1 ORDER BY created_at, photo_id`,
      [userId],
    ),
    db.query<{ comment_id: string; created_at: Date }>(
      `SELECT comment_id, created_at
       FROM polygon_comment_votes WHERE user_id = $1 ORDER BY created_at, comment_id`,
      [userId],
    ),
    db.query<{
      polygon_id: string;
      reason: string;
      note: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT polygon_id, reason, note, created_at, updated_at
       FROM polygon_flags WHERE user_id = $1 ORDER BY created_at, polygon_id`,
      [userId],
    ),
  ]);

  return {
    format: 'unseal-user-data-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    account: {
      id: user.id,
      pseudonym: user.pseudonym,
      email: user.email,
      role: user.role,
      createdAt: iso(user.created_at),
      emailVerifiedAt: isoOrNull(user.email_verified_at),
      privacyPolicyAcknowledgedAt: isoOrNull(user.privacy_accepted_at),
      termsAcceptedAt: isoOrNull(user.terms_accepted_at),
      lastActiveDate: isoDateOrNull(user.last_login_at),
      failedLoginAttempts: Number(user.failed_login_attempts ?? 0),
      loginBlockedAt: isoOrNull(user.login_blocked_at),
      trustedAt: isoOrNull(user.trusted_at),
    },
    sessions: sessionsRes.rows.map((r) => ({
      createdAt: iso(r.created_at),
      expiresAt: iso(r.expires_at),
    })),
    emailActionLinks: tokensRes.rows.map((r) => ({
      purpose: r.purpose,
      createdAt: iso(r.created_at),
      expiresAt: iso(r.expires_at),
      consumedAt: isoOrNull(r.consumed_at),
    })),
    polygonCreationTimestamps: creationsRes.rows.map((r) => iso(r.created_at)),
    polygons: polygonsRes.rows.map((r) => ({
      id: r.id,
      status: r.status,
      surfaceType: r.surface_type,
      note: r.note,
      areaM2: Number(r.area_m2),
      geometry: JSON.parse(r.geometry) as unknown,
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
      finishedAt: isoOrNull(r.finished_at),
    })),
    polygonsMarkedFinishedByYou: finishedRes.rows.map((r) => r.id),
    photos: photosRes.rows.map((r) => ({
      id: r.id,
      polygonId: r.polygon_id,
      url: `${baseUrl}/uploads/${r.file_name}`,
      thumbUrl: `${baseUrl}/uploads/${r.thumb_name}`,
      width: r.width,
      height: r.height,
      gpsVerified: r.gps_verified,
      createdAt: iso(r.created_at),
    })),
    comments: commentsRes.rows.map((r) => ({
      id: r.id,
      polygonId: r.polygon_id,
      parentId: r.parent_id,
      body: r.body,
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
    })),
    polygonVotes: votesRes.rows.map((r) => ({
      polygonId: r.polygon_id,
      value: r.value,
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
    })),
    photoVotes: photoVotesRes.rows.map((r) => ({
      photoId: r.photo_id,
      value: r.value,
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
    })),
    commentUpvotes: commentVotesRes.rows.map((r) => ({
      commentId: r.comment_id,
      createdAt: iso(r.created_at),
    })),
    polygonFlags: flagsRes.rows.map((r) => ({
      polygonId: r.polygon_id,
      reason: r.reason,
      note: r.note,
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
    })),
    excludedSecurityData: [
      'Password hash (Argon2id) – needed to verify your password, useless to you and risky if leaked',
      'Hashed session and email-link tokens – security credentials',
      'Keyed hash of your canonical email address – used only to block duplicate/alias registrations',
    ],
  };
}
