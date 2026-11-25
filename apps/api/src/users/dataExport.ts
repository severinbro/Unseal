// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 OpenUnseal Contributors

import { ApiError } from '@openunseal/shared';

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
  format: 'openunseal-user-data-export';
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
    allowDirectMessages: boolean;
    termsVersion: number;
    /** Attempts to start a conversation with somebody new on that day. */
    newConversationAttempts: { date: string; count: number } | null;
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
    spaceType: string;
    detectedSpaceType: string;
    privateOverlapRatio: number | null;
    spaceVerification: string;
    spaceVerificationSource: string | null;
    openForPublicAccess: boolean;
    allowChatContact: boolean;
    entitlementConfirmedAt: string | null;
    helpWantedUntil: string | null;
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
  chatThreads: Array<{
    id: string;
    counterpartPseudonym: string;
    openedByYou: boolean;
    openedViaPolygonId: string | null;
    isBlockedByYou: boolean;
    lastReadMessageAt: string | null;
    messageCount: number;
    lastMessageAt: string | null;
    firstMessageSentAt: string | null;
    answeredAt: string | null;
    createdAt: string;
  }>;
  chatMessages: Array<{
    id: string;
    threadId: string;
    direction: 'sent' | 'received';
    senderPseudonym: string;
    body: string;
    referencedPolygonId: string | null;
    referencedCommentId: string | null;
    createdAt: string;
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
    allow_direct_messages: boolean;
    terms_version: number;
    chat_contact_day: string | null;
    chat_contact_count: number;
  }>(
    `SELECT id, pseudonym, email, role, created_at, email_verified_at,
            privacy_accepted_at, terms_accepted_at, last_login_at,
            failed_login_attempts, login_blocked_at, trusted_at,
            allow_direct_messages, terms_version,
            chat_contact_day::text AS chat_contact_day, chat_contact_count
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
    threadsRes,
    messagesRes,
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
      space_type: string;
      detected_space_type: string;
      private_overlap_ratio: number | null;
      space_verification: string;
      space_verification_source: string | null;
      open_for_public_access: boolean;
      allow_chat_contact: boolean;
      entitlement_confirmed_at: Date | null;
      help_wanted_until: Date | null;
    }>(
      `SELECT id, status, surface_type, note, area_m2,
              ST_AsGeoJSON(geom, 7) AS geometry,
              created_at, updated_at, finished_at, space_type, detected_space_type,
              private_overlap_ratio, space_verification, space_verification_source,
              open_for_public_access, allow_chat_contact, entitlement_confirmed_at,
              help_wanted_until
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
    // Includes empty threads. Ones opened towards this user are part of the stored data too.
    db.query<{
      id: string;
      counterpart: string;
      opened_by_you: boolean;
      opened_via_polygon_id: string | null;
      blocked_by_you: boolean;
      last_read_at: Date | null;
      message_count: number;
      last_message_at: Date | null;
      request_sent_at: Date | null;
      accepted_at: Date | null;
      created_at: Date;
    }>(
      `SELECT t.id, COALESCE(cu.pseudonym, 'deleted') AS counterpart,
              t.initiator_is_low = (t.user_low_id IS NOT DISTINCT FROM $1) AS opened_by_you,
              CASE WHEN t.initiator_is_low = (t.user_low_id IS NOT DISTINCT FROM $1)
                THEN t.opened_via_polygon_id END AS opened_via_polygon_id,
              CASE WHEN t.user_low_id = $1 THEN t.blocked_by_low ELSE t.blocked_by_high END AS blocked_by_you,
              CASE WHEN t.user_low_id = $1 THEN t.low_last_read_at ELSE t.high_last_read_at END AS last_read_at,
              t.message_count, t.last_message_at, t.request_sent_at, t.accepted_at,
              t.created_at
       FROM chat_threads t
       LEFT JOIN users cu ON cu.id = CASE WHEN t.user_low_id = $1 THEN t.user_high_id ELSE t.user_low_id END
       WHERE t.user_low_id = $1 OR t.user_high_id = $1
       ORDER BY t.created_at, t.id`,
      [userId],
    ),
    db.query<{
      id: string;
      thread_id: string;
      sent: boolean;
      pseudonym: string;
      body: string;
      referenced_polygon_id: string | null;
      referenced_comment_id: string | null;
      created_at: Date;
    }>(
      `SELECT m.id, m.thread_id, m.sender_user_id = $1 AS sent, u.pseudonym, m.body,
              m.referenced_polygon_id, m.referenced_comment_id, m.created_at
       FROM chat_messages m
       INNER JOIN chat_threads t ON t.id = m.thread_id
       INNER JOIN users u ON u.id = m.sender_user_id
       WHERE t.user_low_id = $1 OR t.user_high_id = $1
       ORDER BY m.created_at, m.id`,
      [userId],
    ),
  ]);

  return {
    format: 'openunseal-user-data-export',
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
      allowDirectMessages: user.allow_direct_messages,
      termsVersion: user.terms_version,
      newConversationAttempts:
        user.chat_contact_day === null
          ? null
          : { date: user.chat_contact_day, count: user.chat_contact_count },
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
      spaceType: r.space_type,
      detectedSpaceType: r.detected_space_type,
      privateOverlapRatio: r.private_overlap_ratio,
      spaceVerification: r.space_verification,
      spaceVerificationSource: r.space_verification_source,
      openForPublicAccess: r.open_for_public_access,
      allowChatContact: r.allow_chat_contact,
      entitlementConfirmedAt: isoOrNull(r.entitlement_confirmed_at),
      helpWantedUntil: isoOrNull(r.help_wanted_until),
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
    chatThreads: threadsRes.rows.map((r) => ({
      id: r.id,
      counterpartPseudonym: r.counterpart,
      openedByYou: r.opened_by_you,
      openedViaPolygonId: r.opened_via_polygon_id,
      isBlockedByYou: r.blocked_by_you,
      lastReadMessageAt: isoOrNull(r.last_read_at),
      messageCount: r.message_count,
      lastMessageAt: isoOrNull(r.last_message_at),
      firstMessageSentAt: isoOrNull(r.request_sent_at),
      answeredAt: isoOrNull(r.accepted_at),
      createdAt: iso(r.created_at),
    })),
    chatMessages: messagesRes.rows.map((r) => ({
      id: r.id,
      threadId: r.thread_id,
      direction: r.sent ? ('sent' as const) : ('received' as const),
      senderPseudonym: r.pseudonym,
      body: r.body,
      referencedPolygonId: r.referenced_polygon_id,
      referencedCommentId: r.referenced_comment_id,
      createdAt: iso(r.created_at),
    })),
    excludedSecurityData: [
      'Password hash (Argon2id) – needed to verify your password, useless to you and risky if leaked',
      'Hashed session and email-link tokens – security credentials',
      'Keyed hash of your canonical email address – used only to block duplicate/alias registrations',
    ],
  };
}
