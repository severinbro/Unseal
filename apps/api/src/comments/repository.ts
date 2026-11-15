import {
  ApiError,
  COMMENT_LIMITS,
  findTopRatedCommentId,
  sortPolygonCommentsByRating,
  type CommentVoteResponse,
  type PolygonComment,
  type PolygonCommentListResponse,
} from '@entsiegelung/shared';

import { lockUserForWrite } from '../db/integrity.js';

import type pg from 'pg';

export interface CreateCommentParams {
  polygonId: string;
  userId: string;
  body: string;
  parentId?: string | null | undefined;
}

export interface CastCommentVoteParams {
  commentId: string;
  userId: string;
}

export interface DeleteCommentParams {
  commentId: string;
  actorUserId: string;
  actorIsAdmin: boolean;
}

interface CommentQueryRow {
  id: string;
  polygon_id: string;
  parent_id: string | null;
  user_id: string | null;
  body: string;
  author_pseudonym: string;
  is_author: boolean;
  upvotes: number;
  my_vote: number;
  created_at: Date;
  updated_at: Date;
}

function coerceUpvoteValue(raw: number): 0 | 1 {
  return raw === 1 ? 1 : 0;
}

function mapRowToPolygonComment(row: CommentQueryRow): PolygonComment {
  return {
    id: row.id,
    polygonId: row.polygon_id,
    parentId: row.parent_id ?? null,
    body: row.body,
    authorPseudonym: row.author_pseudonym,
    isAuthor: Boolean(row.is_author),
    upvotes: Math.max(0, Number(row.upvotes)),
    myVote: coerceUpvoteValue(Number(row.my_vote)),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
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

export class CommentRepository {
  private readonly pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  public async listByPolygon(
    polygonId: string,
    viewerUserId: string | null,
  ): Promise<PolygonCommentListResponse> {
    const existsRes = await this.pool.query<{ id: string }>(
      'SELECT id FROM polygons WHERE id = $1 LIMIT 1',
      [polygonId],
    );
    if (existsRes.rowCount === 0) {
      throw new ApiError(404, 'NOT_FOUND', 'Polygon not found.');
    }

    const res = await this.pool.query<CommentQueryRow>(
      `SELECT
         c.id,
         c.polygon_id,
         c.parent_id,
         c.user_id,
         c.body,
         COALESCE(u.pseudonym, 'deleted') AS author_pseudonym,
         CASE
           WHEN $2::uuid IS NOT NULL AND c.user_id = $2::uuid THEN TRUE
           ELSE FALSE
         END AS is_author,
         c.upvotes,
         CASE
           WHEN cv.user_id IS NOT NULL THEN 1
           ELSE 0
         END::int AS my_vote,
         c.created_at,
         c.updated_at
       FROM polygon_comments c
       LEFT JOIN users u ON u.id = c.user_id
       LEFT JOIN polygon_comment_votes cv
         ON cv.comment_id = c.id
        AND $2::uuid IS NOT NULL
        AND cv.user_id = $2::uuid
       WHERE c.polygon_id = $1
       ORDER BY c.upvotes DESC, c.created_at DESC, c.id ASC`,
      [polygonId, viewerUserId],
    );

    const mapped = res.rows.map((row) => mapRowToPolygonComment(row));
    const comments = sortPolygonCommentsByRating(mapped);
    const topCommentId = findTopRatedCommentId(comments);

    return {
      polygonId,
      topCommentId,
      comments,
    };
  }

  public async createComment(
    params: CreateCommentParams,
  ): Promise<PolygonComment> {
    const trimmedBody = params.body.trim();
    if (
      trimmedBody.length < 1 ||
      trimmedBody.length > COMMENT_LIMITS.MAX_BODY_LENGTH
    ) {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        `Comment body must be between 1 and ${COMMENT_LIMITS.MAX_BODY_LENGTH} characters.`,
      );
    }

    const parentId = params.parentId ?? null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Global lock order: users -> polygons -> polygon_comments
      await lockUserForWrite(client, params.userId);

      const polyRes = await client.query<{
        id: string;
        comment_count: number;
        status: string;
      }>(
        `SELECT id, comment_count, status
         FROM polygons
         WHERE id = $1
         FOR UPDATE`,
        [params.polygonId],
      );
      const polyRow = polyRes.rows[0];
      if (!polyRow) {
        throw new ApiError(404, 'NOT_FOUND', 'Polygon not found.');
      }

      if (polyRow.status === 'finished') {
        throw new ApiError(
          409,
          'COMMENTS_CLOSED',
          'Comments can no longer be added to finished areas.',
        );
      }

      if (polyRow.comment_count >= COMMENT_LIMITS.MAX_COMMENTS_PER_POLYGON) {
        throw new ApiError(
          422,
          'VALIDATION_ERROR',
          `Maximum of ${COMMENT_LIMITS.MAX_COMMENTS_PER_POLYGON} comments per polygon reached.`,
        );
      }

      if (parentId !== null) {
        const parentCheckRes = await client.query<{
          found_parent: boolean;
          same_polygon: boolean;
          depth: number;
        }>(
          `WITH RECURSIVE chain AS (
             SELECT id, parent_id, polygon_id, 1 AS depth
             FROM polygon_comments
             WHERE id = $1
             UNION ALL
             SELECT p.id, p.parent_id, p.polygon_id, chain.depth + 1
             FROM polygon_comments p
             INNER JOIN chain ON p.id = chain.parent_id
             WHERE chain.depth <= $3
           )
           SELECT
             EXISTS (SELECT 1 FROM chain WHERE depth = 1) AS found_parent,
             COALESCE((SELECT polygon_id = $2::uuid FROM chain WHERE depth = 1), FALSE) AS same_polygon,
             COALESCE(MAX(depth), 0)::int AS depth
           FROM chain`,
          [parentId, params.polygonId, COMMENT_LIMITS.MAX_REPLY_DEPTH + 1],
        );

        const parentInfo = parentCheckRes.rows[0];
        if (!parentInfo || !parentInfo.found_parent || !parentInfo.same_polygon) {
          throw new ApiError(
            404,
            'NOT_FOUND',
            'Parent comment not found on this polygon.',
          );
        }
        if (parentInfo.depth >= COMMENT_LIMITS.MAX_REPLY_DEPTH) {
          throw new ApiError(
            422,
            'VALIDATION_ERROR',
            `Maximum reply nesting depth of ${COMMENT_LIMITS.MAX_REPLY_DEPTH} reached.`,
          );
        }
      }

      const insertRes = await client.query<CommentQueryRow>(
        `INSERT INTO polygon_comments (
           polygon_id,
           parent_id,
           user_id,
           body
         )
         VALUES ($1, $2, $3, $4)
         RETURNING
           id,
           polygon_id,
           parent_id,
           user_id,
           body,
           (SELECT COALESCE(u.pseudonym, 'deleted') FROM users u WHERE u.id = $3) AS author_pseudonym,
           TRUE AS is_author,
           upvotes,
           0::int AS my_vote,
           created_at,
           updated_at`,
        [params.polygonId, parentId, params.userId, trimmedBody],
      );
      const inserted = insertRes.rows[0];
      if (!inserted) {
        throw new ApiError(500, 'INTERNAL_ERROR', 'Failed to persist comment.');
      }

      await client.query(
        `UPDATE polygons
         SET comment_count = (
           SELECT COUNT(*)::int FROM polygon_comments WHERE polygon_id = $1
         )
         WHERE id = $1`,
        [params.polygonId],
      );

      await client.query('COMMIT');
      return mapRowToPolygonComment(inserted);
    } catch (err: unknown) {
      await rollbackPreservingError(client, err);
      throw err;
    } finally {
      client.release();
    }
  }

  public async castUpvote(
    params: CastCommentVoteParams,
  ): Promise<CommentVoteResponse> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Global lock order: users -> polygon_comments
      await lockUserForWrite(client, params.userId);

      const lockComment = await client.query<{
        id: string;
        polygon_id: string;
        user_id: string | null;
      }>(
        'SELECT id, polygon_id, user_id FROM polygon_comments WHERE id = $1 FOR UPDATE',
        [params.commentId],
      );
      const commentRow = lockComment.rows[0];
      if (!commentRow) {
        throw new ApiError(404, 'NOT_FOUND', 'Comment not found.');
      }

      if (commentRow.user_id !== null && commentRow.user_id === params.userId) {
        throw new ApiError(
          403,
          'FORBIDDEN_SELF_VOTE',
          'You cannot upvote your own comment.',
        );
      }

      await client.query(
        `INSERT INTO polygon_comment_votes (comment_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (comment_id, user_id) DO NOTHING`,
        [params.commentId, params.userId],
      );

      const updateRes = await client.query<{ upvotes: number }>(
        `UPDATE polygon_comments AS c
         SET upvotes = (
           SELECT COUNT(*)::int
           FROM polygon_comment_votes cv
           WHERE cv.comment_id = $1
         )
         WHERE c.id = $1
         RETURNING c.upvotes`,
        [params.commentId],
      );
      const upvotes = Math.max(0, Number(updateRes.rows[0]?.upvotes ?? 0));

      await client.query('COMMIT');
      return {
        commentId: params.commentId,
        polygonId: commentRow.polygon_id,
        upvotes,
        myVote: 1,
      };
    } catch (err: unknown) {
      await rollbackPreservingError(client, err);
      throw err;
    } finally {
      client.release();
    }
  }

  public async removeUpvote(
    params: CastCommentVoteParams,
  ): Promise<CommentVoteResponse> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Global lock order: users -> polygon_comments
      await lockUserForWrite(client, params.userId);

      const lockComment = await client.query<{
        id: string;
        polygon_id: string;
      }>(
        'SELECT id, polygon_id FROM polygon_comments WHERE id = $1 FOR UPDATE',
        [params.commentId],
      );
      const commentRow = lockComment.rows[0];
      if (!commentRow) {
        throw new ApiError(404, 'NOT_FOUND', 'Comment not found.');
      }

      await client.query(
        'DELETE FROM polygon_comment_votes WHERE comment_id = $1 AND user_id = $2',
        [params.commentId, params.userId],
      );

      const updateRes = await client.query<{ upvotes: number }>(
        `UPDATE polygon_comments AS c
         SET upvotes = (
           SELECT COUNT(*)::int
           FROM polygon_comment_votes cv
           WHERE cv.comment_id = $1
         )
         WHERE c.id = $1
         RETURNING c.upvotes`,
        [params.commentId],
      );
      const upvotes = Math.max(0, Number(updateRes.rows[0]?.upvotes ?? 0));

      await client.query('COMMIT');
      return {
        commentId: params.commentId,
        polygonId: commentRow.polygon_id,
        upvotes,
        myVote: 0,
      };
    } catch (err: unknown) {
      await rollbackPreservingError(client, err);
      throw err;
    } finally {
      client.release();
    }
  }

  public async deleteComment(params: DeleteCommentParams): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Global lock order: users -> polygons -> polygon_comments
      await lockUserForWrite(client, params.actorUserId);

      const lookupRes = await client.query<{ polygon_id: string }>(
        'SELECT polygon_id FROM polygon_comments WHERE id = $1',
        [params.commentId],
      );
      const lookup = lookupRes.rows[0];
      if (!lookup) {
        throw new ApiError(404, 'NOT_FOUND', 'Comment not found.');
      }

      await client.query('SELECT id FROM polygons WHERE id = $1 FOR UPDATE', [
        lookup.polygon_id,
      ]);

      const lockCommentRes = await client.query<{
        id: string;
        user_id: string | null;
      }>(
        'SELECT id, user_id FROM polygon_comments WHERE id = $1 FOR UPDATE',
        [params.commentId],
      );
      const commentRow = lockCommentRes.rows[0];
      if (!commentRow) {
        throw new ApiError(404, 'NOT_FOUND', 'Comment not found.');
      }

      const isAuthor =
        commentRow.user_id !== null &&
        commentRow.user_id === params.actorUserId;
      if (!isAuthor && !params.actorIsAdmin) {
        throw new ApiError(
          403,
          'FORBIDDEN_NOT_AUTHOR',
          'Only the comment author or an administrator can delete this comment.',
        );
      }

      await client.query('DELETE FROM polygon_comments WHERE id = $1', [
        params.commentId,
      ]);
      await client.query(
        `UPDATE polygons
         SET comment_count = (
           SELECT COUNT(*)::int FROM polygon_comments WHERE polygon_id = $1
         )
         WHERE id = $1`,
        [lookup.polygon_id],
      );

      await client.query('COMMIT');
    } catch (err: unknown) {
      await rollbackPreservingError(client, err);
      throw err;
    } finally {
      client.release();
    }
  }
}
