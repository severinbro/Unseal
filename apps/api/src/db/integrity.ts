import { ApiError } from '@entsiegelung/shared';

import { hashPseudonymTombstone } from '../auth/crypto.js';

import type pg from 'pg';

export interface DeleteOrBanUserParams {
  userId: string;
  pseudonymLower: string;
  mode: 'self_delete' | 'ban';
  reason?: string | undefined;
}

export interface DeleteOrBanUserResult {
  deletedUser: boolean;
  deletedPolygonCount: number;
  recomputedPolygonIds: string[];
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
         COALESCE(SUM(v.value), 0)::int AS score
       FROM unnest($1::uuid[]) AS target(id)
       LEFT JOIN votes v ON v.polygon_id = target.id
       GROUP BY target.id
     )
     UPDATE polygons AS p
     SET
       upvotes = agg.upvotes,
       downvotes = agg.downvotes,
       score = agg.score
     FROM agg
     WHERE p.id = agg.polygon_id`,
    [lockedIds],
  );
}

export async function deleteOrBanUserAccount(
  client: pg.PoolClient,
  params: DeleteOrBanUserParams,
): Promise<DeleteOrBanUserResult> {
  const userRes = await client.query<{ id: string; pseudonym: string }>(
    'SELECT id, pseudonym FROM users WHERE id = $1 FOR UPDATE',
    [params.userId],
  );
  const userRow = userRes.rows[0];

  const resolvedReason =
    params.mode === 'self_delete'
      ? 'self_deleted'
      : params.reason &&
          params.reason.trim().length > 0 &&
          params.reason.trim() !== 'self_deleted'
        ? params.reason.trim()
        : 'banned';

  if (!userRow) {
    if (params.mode === 'self_delete') {
      throw new ApiError(
        401,
        'AUTH_REQUIRED',
        'Authenticated account no longer exists.',
      );
    }

    const fallbackTombstone = hashPseudonymTombstone(params.pseudonymLower);
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
    };
  }

  const canonicalLower = userRow.pseudonym.toLowerCase();
  const tombstoneHash = hashPseudonymTombstone(canonicalLower);

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

  const votedRes = await client.query<{ polygon_id: string }>(
    'SELECT polygon_id FROM votes WHERE user_id = $1',
    [userRow.id],
  );
  const authoredRes = await client.query<{ id: string }>(
    'SELECT id FROM polygons WHERE user_id = $1',
    [userRow.id],
  );

  const votedPolygonIds = votedRes.rows.map((r) => r.polygon_id.toLowerCase());
  const authoredPolygonIds = authoredRes.rows.map((r) => r.id.toLowerCase());
  const allTouchedPolygonIds = uniqueSortedUuids([
    ...votedPolygonIds,
    ...authoredPolygonIds,
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
  let remainingVotedPolygonIds: string[];

  if (params.mode === 'ban') {
    const delPolyRes = await client.query(
      'DELETE FROM polygons WHERE user_id = $1',
      [userRow.id],
    );
    deletedPolygonCount = delPolyRes.rowCount ?? 0;
    const authoredSet = new Set(authoredPolygonIds);
    remainingVotedPolygonIds = uniqueSortedUuids(
      votedPolygonIds.filter((id) => !authoredSet.has(id)),
    );
  } else {
    remainingVotedPolygonIds = uniqueSortedUuids(votedPolygonIds);
  }

  await client.query('DELETE FROM users WHERE id = $1', [userRow.id]);

  await recomputePolygonScores(client, remainingVotedPolygonIds);

  return {
    deletedUser: true,
    deletedPolygonCount,
    recomputedPolygonIds: remainingVotedPolygonIds,
  };
}
