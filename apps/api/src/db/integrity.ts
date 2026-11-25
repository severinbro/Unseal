// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 OpenUnseal Contributors

import { ApiError } from '@openunseal/shared';

import { detachUserFromChats } from '../chat/repository.js';
import {
  hashCanonicalEmail,
  hashEmailTombstone,
  hashPseudonymTombstone,
} from '../auth/crypto.js';

import type pg from 'pg';

export interface DeleteOrBanUserParams {
  userId: string;
  pseudonymLower: string;
  /**
   * - `self_delete`: account and direct messages erased, public contributions stay as "deleted".
   * - `self_delete_purge`: account erased together with all own polygons, photos and
   *   comments (GDPR Art. 17 at the user's choice); no email tombstone is written.
   * - `ban`: like `self_delete_purge`, plus pseudonym/email ban tombstones.
   */
  mode: 'self_delete' | 'self_delete_purge' | 'ban';
  reason?: string | undefined;
  /** HMAC key for pseudonym/email tombstones (`EnvConfig.tombstoneSecret`). */
  tombstoneSecret: string;
}

export interface DeleteOrBanUserResult {
  deletedUser: boolean;
  deletedPolygonCount: number;
  recomputedPolygonIds: string[];
  deletedPhotoFiles: string[];
}

function uniqueSortedUuids(ids: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const id of ids) {
    unique.add(id.toLowerCase());
  }
  return Array.from(unique).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export async function lockUserForWrite(
  client: pg.PoolClient,
  userId: string,
): Promise<void> {
  const res = await client.query<{ id: string }>(
    'SELECT id FROM users WHERE id = $1 FOR KEY SHARE',
    [userId],
  );
  if (res.rowCount === 0) {
    throw new ApiError(
      401,
      'AUTH_REQUIRED',
      'Authenticated account no longer exists.',
    );
  }
}

export async function recomputePolygonScores(
  client: pg.PoolClient,
  polygonIds: readonly string[],
): Promise<void> {
  const sortedIds = uniqueSortedUuids(polygonIds);
  if (sortedIds.length === 0) {
    return;
  }

  const lockRes = await client.query<{ id: string }>(
    `SELECT id
     FROM polygons
     WHERE id = ANY($1::uuid[])
     ORDER BY id ASC
     FOR UPDATE`,
    [sortedIds],
  );

  const lockedIds = lockRes.rows.map((row) => row.id);
  if (lockedIds.length === 0) {
    return;
  }

  await client.query(
    `WITH agg AS (
       SELECT
         target.id AS polygon_id,
         COALESCE(COUNT(*) FILTER (WHERE v.value = 1), 0)::int AS upvotes,
         COALESCE(COUNT(*) FILTER (WHERE v.value = -1), 0)::int AS downvotes,
         COALESCE(SUM(v.value), 0)::int AS score,
         COALESCE((SELECT COUNT(*) FROM polygon_photos pp WHERE pp.polygon_id = target.id), 0)::int AS photo_count,
         COALESCE((SELECT COUNT(*) FROM polygon_comments pc WHERE pc.polygon_id = target.id), 0)::int AS comment_count,
         COALESCE((SELECT COUNT(*) FROM polygon_flags pf WHERE pf.polygon_id = target.id), 0)::int AS flag_count
       FROM unnest($1::uuid[]) AS target(id)
       LEFT JOIN votes v ON v.polygon_id = target.id
       GROUP BY target.id
     )
     UPDATE polygons AS p
     SET
       upvotes = agg.upvotes,
       downvotes = agg.downvotes,
       score = agg.score,
       photo_count = agg.photo_count,
       comment_count = agg.comment_count,
       flag_count = agg.flag_count
     FROM agg
     WHERE p.id = agg.polygon_id`,
    [lockedIds],
  );
}

export async function recomputePhotoScores(
  client: pg.PoolClient,
  photoIds: readonly string[],
): Promise<void> {
  const sortedIds = uniqueSortedUuids(photoIds);
  if (sortedIds.length === 0) {
    return;
  }

  const lockRes = await client.query<{ id: string }>(
    `SELECT id
     FROM polygon_photos
     WHERE id = ANY($1::uuid[])
     ORDER BY id ASC
     FOR UPDATE`,
    [sortedIds],
  );
  const lockedIds = lockRes.rows.map((row) => row.id);
  if (lockedIds.length === 0) {
    return;
  }

  await client.query(
    `WITH agg AS (
       SELECT
         target.id AS photo_id,
         COALESCE(COUNT(*) FILTER (WHERE pv.value = 1), 0)::int AS real_votes,
         COALESCE(COUNT(*) FILTER (WHERE pv.value = -1), 0)::int AS fake_votes,
         COALESCE(SUM(pv.value), 0)::int AS credibility_score
       FROM unnest($1::uuid[]) AS target(id)
       LEFT JOIN polygon_photo_votes pv ON pv.photo_id = target.id
       GROUP BY target.id
     )
     UPDATE polygon_photos AS pp
     SET
       real_votes = agg.real_votes,
       fake_votes = agg.fake_votes,
       credibility_score = agg.credibility_score
     FROM agg
     WHERE pp.id = agg.photo_id`,
    [lockedIds],
  );
}

export async function recomputeCommentScores(
  client: pg.PoolClient,
  commentIds: readonly string[],
): Promise<void> {
  const sortedIds = uniqueSortedUuids(commentIds);
  if (sortedIds.length === 0) {
    return;
  }

  const lockRes = await client.query<{ id: string }>(
    `SELECT id
     FROM polygon_comments
     WHERE id = ANY($1::uuid[])
     ORDER BY id ASC
     FOR UPDATE`,
    [sortedIds],
  );
  const lockedIds = lockRes.rows.map((row) => row.id);
  if (lockedIds.length === 0) {
    return;
  }

  await client.query(
    `WITH agg AS (
       SELECT
         target.id AS comment_id,
         COALESCE(COUNT(cv.user_id), 0)::int AS upvotes
       FROM unnest($1::uuid[]) AS target(id)
       LEFT JOIN polygon_comment_votes cv ON cv.comment_id = target.id
       GROUP BY target.id
     )
     UPDATE polygon_comments AS pc
     SET upvotes = agg.upvotes
     FROM agg
     WHERE pc.id = agg.comment_id`,
    [lockedIds],
  );
}

export async function deleteOrBanUserAccount(
  client: pg.PoolClient,
  params: DeleteOrBanUserParams,
): Promise<DeleteOrBanUserResult> {
  const userRes = await client.query<{
    id: string;
    pseudonym: string;
    email: string | null;
  }>('SELECT id, pseudonym, email FROM users WHERE id = $1 FOR UPDATE', [
    params.userId,
  ]);
  const userRow = userRes.rows[0];

  const isSelfDeletion =
    params.mode === 'self_delete' || params.mode === 'self_delete_purge';
  const purgesContent =
    params.mode === 'ban' || params.mode === 'self_delete_purge';

  const trimmedReason = params.reason?.trim() ?? '';
  const resolvedReason = isSelfDeletion
    ? 'self_deleted'
    : trimmedReason.length > 0 && trimmedReason !== 'self_deleted'
      ? trimmedReason
      : 'banned';

  if (!userRow) {
    if (isSelfDeletion) {
      throw new ApiError(
        401,
        'AUTH_REQUIRED',
        'Authenticated account no longer exists.',
      );
    }

    const fallbackTombstone = hashPseudonymTombstone(
      params.tombstoneSecret,
      params.pseudonymLower,
    );
    await client.query(
      `INSERT INTO reserved_pseudonyms (pseudonym_hash, reason)
       VALUES ($1, $2)
       ON CONFLICT (pseudonym_hash) DO UPDATE
       SET reason = CASE
         WHEN reserved_pseudonyms.reason <> 'self_deleted' THEN reserved_pseudonyms.reason
         ELSE EXCLUDED.reason
       END`,
      [fallbackTombstone, resolvedReason],
    );

    return {
      deletedUser: false,
      deletedPolygonCount: 0,
      recomputedPolygonIds: [],
      deletedPhotoFiles: [],
    };
  }

  const canonicalLower = userRow.pseudonym.toLowerCase();
  const tombstoneHash = hashPseudonymTombstone(params.tombstoneSecret, canonicalLower);

  await client.query(
    `INSERT INTO reserved_pseudonyms (pseudonym_hash, reason)
     VALUES ($1, $2)
     ON CONFLICT (pseudonym_hash) DO UPDATE
     SET reason = CASE
       WHEN reserved_pseudonyms.reason <> 'self_deleted' THEN reserved_pseudonyms.reason
       ELSE EXCLUDED.reason
     END`,
    [tombstoneHash, resolvedReason],
  );

  if (params.mode === 'ban' && userRow.email) {
    const emailHash = hashEmailTombstone(params.tombstoneSecret, userRow.email);
    const canonicalHash = hashCanonicalEmail(params.tombstoneSecret, userRow.email);
    const digests = emailHash.equals(canonicalHash)
      ? [emailHash]
      : [emailHash, canonicalHash];
    for (const digest of digests) {
      await client.query(
        `INSERT INTO reserved_emails (email_hash, reason)
         VALUES ($1, $2)
         ON CONFLICT (email_hash) DO UPDATE
         SET reason = EXCLUDED.reason`,
        [digest, resolvedReason],
      );
    }
  }

  const votedRes = await client.query<{ polygon_id: string }>(
    'SELECT polygon_id FROM votes WHERE user_id = $1',
    [userRow.id],
  );
  const flaggedRes = await client.query<{ polygon_id: string }>(
    'SELECT polygon_id FROM polygon_flags WHERE user_id = $1',
    [userRow.id],
  );
  const authoredRes = await client.query<{ id: string }>(
    'SELECT id FROM polygons WHERE user_id = $1',
    [userRow.id],
  );
  const uploadedPhotoPolygonsRes = await client.query<{
    id: string;
    polygon_id: string;
    file_name: string;
    thumb_name: string;
  }>(
    'SELECT id, polygon_id, file_name, thumb_name FROM polygon_photos WHERE user_id = $1',
    [userRow.id],
  );
  const votedPhotosRes = await client.query<{ photo_id: string }>(
    'SELECT photo_id FROM polygon_photo_votes WHERE user_id = $1',
    [userRow.id],
  );
  const commentedPolygonsRes = await client.query<{ polygon_id: string }>(
    'SELECT DISTINCT polygon_id FROM polygon_comments WHERE user_id = $1',
    [userRow.id],
  );
  const votedCommentsRes = await client.query<{ comment_id: string }>(
    'SELECT comment_id FROM polygon_comment_votes WHERE user_id = $1',
    [userRow.id],
  );

  const votedPolygonIds = votedRes.rows.map((r) => r.polygon_id.toLowerCase());
  const flaggedPolygonIds = flaggedRes.rows.map((r) =>
    r.polygon_id.toLowerCase(),
  );
  const authoredPolygonIds = authoredRes.rows.map((r) => r.id.toLowerCase());
  const uploadedPhotoPolygonIds = uploadedPhotoPolygonsRes.rows.map((r) =>
    r.polygon_id.toLowerCase(),
  );
  const votedPhotoIds = votedPhotosRes.rows.map((r) => r.photo_id.toLowerCase());
  const commentedPolygonIds = commentedPolygonsRes.rows.map((r) =>
    r.polygon_id.toLowerCase(),
  );
  const votedCommentIds = votedCommentsRes.rows.map((r) =>
    r.comment_id.toLowerCase(),
  );

  const allTouchedPolygonIds = uniqueSortedUuids([
    ...votedPolygonIds,
    ...flaggedPolygonIds,
    ...authoredPolygonIds,
    ...uploadedPhotoPolygonIds,
    ...commentedPolygonIds,
  ]);

  if (allTouchedPolygonIds.length > 0) {
    await client.query(
      `SELECT id
       FROM polygons
       WHERE id = ANY($1::uuid[])
       ORDER BY id ASC
       FOR UPDATE`,
      [allTouchedPolygonIds],
    );
  }

  let deletedPolygonCount = 0;
  let remainingPolygonIdsToRecompute: string[];
  const deletedPhotoFiles: string[] = [];

  if (purgesContent) {
    for (const photoRow of uploadedPhotoPolygonsRes.rows) {
      deletedPhotoFiles.push(photoRow.file_name, photoRow.thumb_name);
    }
    const authoredPolyPhotosRes = await client.query<{
      file_name: string;
      thumb_name: string;
    }>(
      `SELECT pp.file_name, pp.thumb_name
       FROM polygon_photos pp
       INNER JOIN polygons p ON p.id = pp.polygon_id
       WHERE p.user_id = $1`,
      [userRow.id],
    );
    for (const row of authoredPolyPhotosRes.rows) {
      if (!deletedPhotoFiles.includes(row.file_name)) {
        deletedPhotoFiles.push(row.file_name);
      }
      if (!deletedPhotoFiles.includes(row.thumb_name)) {
        deletedPhotoFiles.push(row.thumb_name);
      }
    }

    await client.query('DELETE FROM polygon_comments WHERE user_id = $1', [
      userRow.id,
    ]);
    await client.query('DELETE FROM polygon_photos WHERE user_id = $1', [
      userRow.id,
    ]);
    const delPolyRes = await client.query(
      'DELETE FROM polygons WHERE user_id = $1',
      [userRow.id],
    );
    deletedPolygonCount = delPolyRes.rowCount ?? 0;
    const authoredSet = new Set(authoredPolygonIds);
    remainingPolygonIdsToRecompute = uniqueSortedUuids(
      [
        ...votedPolygonIds,
        ...flaggedPolygonIds,
        ...uploadedPhotoPolygonIds,
        ...commentedPolygonIds,
      ].filter((id) => !authoredSet.has(id)),
    );
  } else {
    remainingPolygonIdsToRecompute = uniqueSortedUuids([
      ...votedPolygonIds,
      ...flaggedPolygonIds,
    ]);
  }

  // Direct messages are erased with the account in every mode.
  await detachUserFromChats(client, userRow.id);

  await client.query('DELETE FROM users WHERE id = $1', [userRow.id]);

  await recomputePolygonScores(client, remainingPolygonIdsToRecompute);
  await recomputePhotoScores(client, votedPhotoIds);
  await recomputeCommentScores(client, votedCommentIds);

  return {
    deletedUser: true,
    deletedPolygonCount,
    recomputedPolygonIds: remainingPolygonIdsToRecompute,
    deletedPhotoFiles,
  };
}
