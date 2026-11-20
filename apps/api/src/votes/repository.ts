// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 OpenUnseal Contributors

import {
  ApiError,
  TRUST_AND_MODERATION_LIMITS,
  VoteResponseSchema,
  type PolygonStatus,
  type VoteRequest,
  type VoteResponse,
} from '@openunseal/shared';

import { lockUserForWrite, recomputePolygonScores } from '../db/integrity.js';
import { recordTelemetryCounter } from '../db/telemetry.js';

import type pg from 'pg';

export interface PutVoteParams {
  polygonId: string;
  userId: string;
  value: VoteRequest['value'];
}

export interface VoteTrustConfig {
  minAccountDays: number;
  minCleanPolygons: number;
}

interface PolygonVoteTotalsRow {
  id: string;
  upvotes: number;
  downvotes: number;
  score: number;
}

async function rollbackPreservingError(
  client: pg.PoolClient,
  originalError: unknown,
): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch (rollbackErr: unknown) {
    if (originalError instanceof Error && !('rollbackError' in originalError)) {
      Object.assign(originalError, { rollbackError: rollbackErr });
    }
  }
}

export class VoteRepository {
  private readonly pool: pg.Pool;
  private readonly trust: VoteTrustConfig;

  constructor(pool: pg.Pool, trust: Partial<VoteTrustConfig> = {}) {
    this.pool = pool;
    this.trust = {
      minAccountDays:
        trust.minAccountDays ??
        TRUST_AND_MODERATION_LIMITS.NEW_USER_MIN_ACCOUNT_DAYS,
      minCleanPolygons:
        trust.minCleanPolygons ??
        TRUST_AND_MODERATION_LIMITS.NEW_USER_MIN_CLEAN_POLYGONS,
    };
  }

  public async putVote(params: PutVoteParams): Promise<VoteResponse> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Global lock order: lock users row FOR KEY SHARE before locking polygons FOR UPDATE
      await lockUserForWrite(client, params.userId);

      const lockRes = await client.query<{
        id: string;
        user_id: string | null;
        status: PolygonStatus;
      }>(
        'SELECT id, user_id, status FROM polygons WHERE id = $1 FOR UPDATE',
        [params.polygonId],
      );
      const lockedPolygon = lockRes.rows[0];
      if (!lockedPolygon) {
        throw new ApiError(404, 'NOT_FOUND', 'Polygon not found.');
      }

      if (lockedPolygon.status !== 'proposed') {
        throw new ApiError(
          409,
          'VOTING_CLOSED',
          'Voting is closed for areas marked as in progress or finished.',
        );
      }

      if (
        lockedPolygon.user_id !== null &&
        lockedPolygon.user_id === params.userId
      ) {
        throw new ApiError(
          403,
          'FORBIDDEN_SELF_VOTE',
          'You cannot vote on your own proposal.',
        );
      }

      const prevVoteRes = await client.query<{ value: number }>(
        'SELECT value FROM votes WHERE polygon_id = $1 AND user_id = $2',
        [lockedPolygon.id, params.userId],
      );
      const prevValue = prevVoteRes.rows[0]?.value;

      await client.query(
        `INSERT INTO votes (polygon_id, user_id, value, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (polygon_id, user_id)
         DO UPDATE SET
           value = EXCLUDED.value,
           updated_at = NOW()`,
        [lockedPolygon.id, params.userId, params.value],
      );

      await recomputePolygonScores(client, [lockedPolygon.id]);

      if (prevValue === undefined) {
        await recordTelemetryCounter(
          client,
          'vote_cast',
          params.value === 1 ? 'upvote' : 'downvote',
        );
      } else if (prevValue !== params.value) {
        await recordTelemetryCounter(
          client,
          'vote_flipped',
          params.value === 1 ? 'down_to_up' : 'up_to_down',
        );
      }

      const totalsRes = await client.query<PolygonVoteTotalsRow>(
        `SELECT id, upvotes, downvotes, score
         FROM polygons
         WHERE id = $1`,
        [lockedPolygon.id],
      );
      const totals = totalsRes.rows[0];
      if (!totals) {
        throw new ApiError(404, 'NOT_FOUND', 'Polygon not found.');
      }

      await client.query('COMMIT');

      if (lockedPolygon.user_id !== null && totals.score > 0) {
        await client.query(
          `UPDATE users u
           SET trusted_at = COALESCE(u.trusted_at, NOW())
           WHERE u.id = $1
             AND u.trusted_at IS NULL
             AND (
               u.role = 'admin'
               OR (
                 u.created_at <= NOW() - make_interval(days => $2::int)
                 AND (
                   SELECT COUNT(*)
                   FROM polygons p_clean
                   WHERE p_clean.user_id = u.id
                     AND p_clean.score > 0
                 ) >= $3::int
               )
             )`,
          [
            lockedPolygon.user_id,
            this.trust.minAccountDays,
            this.trust.minCleanPolygons,
          ],
        );
      }

      return VoteResponseSchema.parse({
        polygonId: totals.id,
        upvotes: totals.upvotes,
        downvotes: totals.downvotes,
        score: totals.score,
        myVote: params.value,
      });
    } catch (err: unknown) {
      await rollbackPreservingError(client, err);
      throw err;
    } finally {
      client.release();
    }
  }

  public async deleteVote(
    polygonId: string,
    userId: string,
  ): Promise<VoteResponse> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Global lock order: lock users row FOR KEY SHARE before locking polygons FOR UPDATE
      await lockUserForWrite(client, userId);

      const lockRes = await client.query<{
        id: string;
        user_id: string | null;
        status: PolygonStatus;
      }>(
        'SELECT id, user_id, status FROM polygons WHERE id = $1 FOR UPDATE',
        [polygonId],
      );
      const lockedPolygon = lockRes.rows[0];
      if (!lockedPolygon) {
        throw new ApiError(404, 'NOT_FOUND', 'Polygon not found.');
      }

      if (lockedPolygon.status !== 'proposed') {
        throw new ApiError(
          409,
          'VOTING_CLOSED',
          'Voting is closed for areas marked as in progress or finished.',
        );
      }

      const delRes = await client.query<{ value: number }>(
        'DELETE FROM votes WHERE polygon_id = $1 AND user_id = $2 RETURNING value',
        [lockedPolygon.id, userId],
      );

      await recomputePolygonScores(client, [lockedPolygon.id]);

      const deletedVote = delRes.rows[0];
      if (deletedVote !== undefined) {
        await recordTelemetryCounter(
          client,
          'vote_removed',
          deletedVote.value === 1 ? 'from_upvote' : 'from_downvote',
        );
      }

      const totalsRes = await client.query<PolygonVoteTotalsRow>(
        `SELECT id, upvotes, downvotes, score
         FROM polygons
         WHERE id = $1`,
        [lockedPolygon.id],
      );
      const totals = totalsRes.rows[0];
      if (!totals) {
        throw new ApiError(404, 'NOT_FOUND', 'Polygon not found.');
      }

      await client.query('COMMIT');

      if (lockedPolygon.user_id !== null && totals.score > 0) {
        await client.query(
          `UPDATE users u
           SET trusted_at = COALESCE(u.trusted_at, NOW())
           WHERE u.id = $1
             AND u.trusted_at IS NULL
             AND (
               u.role = 'admin'
               OR (
                 u.created_at <= NOW() - make_interval(days => $2::int)
                 AND (
                   SELECT COUNT(*)
                   FROM polygons p_clean
                   WHERE p_clean.user_id = u.id
                     AND p_clean.score > 0
                 ) >= $3::int
               )
             )`,
          [
            lockedPolygon.user_id,
            this.trust.minAccountDays,
            this.trust.minCleanPolygons,
          ],
        );
      }

      return VoteResponseSchema.parse({
        polygonId: totals.id,
        upvotes: totals.upvotes,
        downvotes: totals.downvotes,
        score: totals.score,
        myVote: 0,
      });
    } catch (err: unknown) {
      await rollbackPreservingError(client, err);
      throw err;
    } finally {
      client.release();
    }
  }
}
