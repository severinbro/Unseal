import {
  ApiError,
  VoteResponseSchema,
  type PolygonStatus,
  type VoteRequest,
  type VoteResponse,
} from '@entsiegelung/shared';

import { lockUserForWrite, recomputePolygonScores } from '../db/integrity.js';

import type pg from 'pg';

export interface PutVoteParams {
  polygonId: string;
  userId: string;
  value: VoteRequest['value'];
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

  constructor(pool: pg.Pool) {
    this.pool = pool;
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
        status: PolygonStatus;
      }>(
        'SELECT id, status FROM polygons WHERE id = $1 FOR UPDATE',
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

      await client.query(
        'DELETE FROM votes WHERE polygon_id = $1 AND user_id = $2',
        [lockedPolygon.id, userId],
      );

      await recomputePolygonScores(client, [lockedPolygon.id]);

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
