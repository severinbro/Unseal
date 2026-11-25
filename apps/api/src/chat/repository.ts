// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 OpenUnseal Contributors

import {
  ApiError,
  CHAT_LIMITS,
  PHOTO_LIMITS,
  computeExteriorRingCentroid,
  computeRingBbox,
  type ChatMessage,
  type ChatPolygonReference,
  type ChatMessagesResponse,
  type ChatRequestState,
  type ChatThread,
} from '@openunseal/shared';

import { decodeTimeCursor, encodeTimeCursor } from '../util/timeCursor.js';

import type pg from 'pg';

type Db = pg.Pool | pg.PoolClient;

/** One answer for unknown, unverified, opted-out and blocking recipients. */
function chatUnavailable(): ApiError {
  return new ApiError(
    403,
    'FORBIDDEN_CHAT_ACCESS',
    'This person cannot be contacted by direct message.',
  );
}

function threadNotFound(): ApiError {
  return new ApiError(404, 'NOT_FOUND', 'Conversation not found.');
}

interface ThreadRow {
  id: string;
  user_low_id: string | null;
  user_high_id: string | null;
  initiator_is_low: boolean;
  opened_via_polygon_id: string | null;
  blocked_by_low: boolean;
  blocked_by_high: boolean;
  message_count: number;
  last_message_at: Date | null;
  request_sent_at: Date | null;
  accepted_at: Date | null;
}

interface ThreadViewRow extends ThreadRow {
  counterpart_pseudonym: string | null;
  unread_count: number;
  last_body: string | null;
  last_sender_pseudonym: string | null;
}

interface MessageRow {
  id: string;
  thread_id: string;
  sender_user_id: string;
  sender_pseudonym: string | null;
  body: string;
  created_at: Date;
  cursor_ts: string;
  poly_id: string | null;
  poly_geojson: string | null;
  surface_type: string | null;
  space_type: string | null;
  status: string | null;
  area_m2: number | null;
  municipality_name: string | null;
  thumb_name: string | null;
  thumb_uploader: string | null;
  comment_id: string | null;
  comment_polygon_id: string | null;
  comment_author: string | null;
  comment_body: string | null;
  comment_created_at: Date | null;
}

const THREAD_VIEW_SQL = `
  SELECT t.id, t.user_low_id, t.user_high_id, t.initiator_is_low,
         t.opened_via_polygon_id, t.blocked_by_low, t.blocked_by_high,
         t.message_count, t.last_message_at, t.request_sent_at, t.accepted_at,
         cu.pseudonym AS counterpart_pseudonym,
         (
           SELECT COUNT(*)::int FROM chat_messages m
           WHERE m.thread_id = t.id
             AND m.sender_user_id <> $1::uuid
             AND m.created_at > COALESCE(
               CASE WHEN t.user_low_id = $1::uuid THEN t.low_last_read_at ELSE t.high_last_read_at END,
               '-infinity'::timestamptz
             )
         ) AS unread_count,
         lm.body AS last_body,
         lm.pseudonym AS last_sender_pseudonym
  FROM chat_threads t
  LEFT JOIN users cu ON cu.id = CASE WHEN t.user_low_id = $1::uuid THEN t.user_high_id ELSE t.user_low_id END
  LEFT JOIN LATERAL (
    SELECT m.body, su.pseudonym
    FROM chat_messages m
    LEFT JOIN users su ON su.id = m.sender_user_id
    WHERE m.thread_id = t.id
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 1
  ) lm ON TRUE
  WHERE (t.user_low_id = $1::uuid OR t.user_high_id = $1::uuid)`;

const isLow = (row: ThreadRow, userId: string): boolean =>
  row.user_low_id === userId;

const isInitiator = (row: ThreadRow, userId: string): boolean =>
  row.initiator_is_low === isLow(row, userId);

/** A conversation stays a request until the person addressed has answered. */
function requestStateOf(row: ThreadRow, userId: string): ChatRequestState {
  if (row.accepted_at !== null || row.request_sent_at === null) {
    return 'none';
  }
  return isInitiator(row, userId) ? 'outgoing' : 'incoming';
}

function mapThread(row: ThreadViewRow, userId: string): ChatThread {
  const low = isLow(row, userId);
  const blockedByMe = low ? row.blocked_by_low : row.blocked_by_high;
  const blockedByOther = low ? row.blocked_by_high : row.blocked_by_low;
  const counterpartActive = row.counterpart_pseudonym !== null;
  const hasMessages = row.message_count > 0;
  const requestState = requestStateOf(row, userId);
  return {
    id: row.id,
    counterpartPseudonym: row.counterpart_pseudonym ?? 'deleted',
    counterpartActive,
    isBlockedByMe: blockedByMe,
    requestState,
    canSend:
      counterpartActive &&
      !blockedByMe &&
      !blockedByOther &&
      requestState !== 'outgoing',
    messageCount: row.message_count,
    unreadCount: row.unread_count,
    lastMessageAt: hasMessages ? (row.last_message_at?.toISOString() ?? null) : null,
    lastMessagePreview:
      row.last_body === null
        ? null
        : row.last_body.slice(0, CHAT_LIMITS.PREVIEW_MAX_LENGTH),
    lastMessageSenderPseudonym: hasMessages
      ? (row.last_sender_pseudonym ?? 'deleted')
      : null,
  };
}

function mapPolygonReference(row: MessageRow): ChatPolygonReference | null {
  if (row.poly_id === null || row.poly_geojson === null) {
    return null;
  }
  const ring = (
    JSON.parse(row.poly_geojson) as { coordinates: [number, number][][] }
  ).coordinates[0]!;
  return {
    id: row.poly_id,
    surfaceType: (row.surface_type ?? 'other') as ChatPolygonReference['surfaceType'],
    spaceType: (row.space_type ?? 'unknown') as ChatPolygonReference['spaceType'],
    status: (row.status ?? 'proposed') as ChatPolygonReference['status'],
    areaM2: Number(row.area_m2 ?? 0),
    municipalityName: row.municipality_name,
    bbox: computeRingBbox(ring),
    centroid: computeExteriorRingCentroid(ring),
    thumbUrl: row.thumb_name === null ? null : `/uploads/${row.thumb_name}`,
    thumbUploaderPseudonym:
      row.thumb_name === null ? null : (row.thumb_uploader ?? 'deleted'),
  };
}

function mapMessage(row: MessageRow, userId: string): ChatMessage {
  return {
    id: row.id,
    threadId: row.thread_id,
    senderPseudonym: row.sender_pseudonym ?? 'deleted',
    isOwnMessage: row.sender_user_id === userId,
    body: row.body,
    referencedPolygon: mapPolygonReference(row),
    referencedComment:
      row.comment_id === null ||
      row.comment_polygon_id === null ||
      row.comment_created_at === null
        ? null
        : {
            id: row.comment_id,
            polygonId: row.comment_polygon_id,
            authorPseudonym: row.comment_author ?? 'deleted',
            bodyExcerpt: (row.comment_body ?? '').slice(
              0,
              CHAT_LIMITS.COMMENT_EXCERPT_LENGTH,
            ),
            createdAt: row.comment_created_at.toISOString(),
          },
    createdAt: row.created_at.toISOString(),
  };
}

/** Recomputes counters and removes threads nobody can use any more. Locks in id order. */
export async function recomputeChatThreads(
  client: pg.PoolClient,
  threadIds: readonly string[],
): Promise<void> {
  if (threadIds.length === 0) {
    return;
  }
  const ids = [...new Set(threadIds)];
  await client.query(
    'SELECT id FROM chat_threads WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
    [ids],
  );
  await client.query(
    `UPDATE chat_threads t
     SET message_count = agg.n,
         last_message_at = agg.last_at,
         -- A withdrawn request leaves nothing behind: the person may ask again.
         request_sent_at = CASE
           WHEN agg.n = 0 AND t.accepted_at IS NULL THEN NULL
           ELSE t.request_sent_at
         END
     FROM (
       SELECT ids.id, COUNT(m.id)::int AS n, MAX(m.created_at) AS last_at
       FROM unnest($1::uuid[]) AS ids(id)
       LEFT JOIN chat_messages m ON m.thread_id = ids.id
       GROUP BY ids.id
     ) agg
     WHERE t.id = agg.id`,
    [ids],
  );
  // A fully blocked-off record must survive so that a block cannot be reset.
  await client.query(
    `DELETE FROM chat_threads
     WHERE id = ANY($1::uuid[])
       AND (
         (user_low_id IS NULL AND user_high_id IS NULL)
         OR (
           message_count = 0
           AND ((NOT blocked_by_low AND NOT blocked_by_high)
                OR user_low_id IS NULL OR user_high_id IS NULL)
         )
       )`,
    [ids],
  );
}

/**
 * Erases a user's messages and leaves their threads, before the account row is
 * deleted. Each thread is updated exactly once: a second update in the same
 * transaction would re-check the counterpart's foreign key and deadlock when
 * both participants delete their accounts at the same time.
 */
export async function detachUserFromChats(
  client: pg.PoolClient,
  userId: string,
): Promise<void> {
  const locked = await client.query<{ id: string }>(
    `SELECT id FROM chat_threads
     WHERE user_low_id = $1 OR user_high_id = $1
     ORDER BY id FOR UPDATE`,
    [userId],
  );
  const ids = locked.rows.map((row) => row.id);
  if (ids.length === 0) {
    return;
  }
  await client.query('DELETE FROM chat_messages WHERE sender_user_id = $1', [
    userId,
  ]);
  // Threads without remaining messages serve nobody once one side is gone.
  await client.query(
    `DELETE FROM chat_threads t
     WHERE t.id = ANY($1::uuid[])
       AND NOT EXISTS (SELECT 1 FROM chat_messages m WHERE m.thread_id = t.id)`,
    [ids],
  );
  await client.query(
    `UPDATE chat_threads t
     SET user_low_id = NULLIF(t.user_low_id, $2::uuid),
         user_high_id = NULLIF(t.user_high_id, $2::uuid),
         message_count = agg.n,
         last_message_at = agg.last_at
     FROM (
       SELECT m.thread_id, COUNT(*)::int AS n, MAX(m.created_at) AS last_at
       FROM chat_messages m
       WHERE m.thread_id = ANY($1::uuid[])
       GROUP BY m.thread_id
     ) agg
     WHERE t.id = agg.thread_id`,
    [ids, userId],
  );
}

export interface DeletedChatMessage {
  threadId: string;
  senderEmail: string | null;
  senderPseudonym: string | null;
}

/** Operator removal after a participant's report. */
export async function deleteChatMessageAsOperator(
  pool: pg.Pool,
  messageId: string,
): Promise<DeletedChatMessage> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query<{
      thread_id: string;
      email: string | null;
      pseudonym: string;
    }>(
      `SELECT m.thread_id, u.email, u.pseudonym
       FROM chat_messages m
       INNER JOIN users u ON u.id = m.sender_user_id
       WHERE m.id = $1`,
      [messageId],
    );
    const row = res.rows[0];
    if (!row) {
      throw new ApiError(404, 'NOT_FOUND', 'Chat message not found.');
    }
    await client.query('SELECT id FROM chat_threads WHERE id = $1 FOR UPDATE', [
      row.thread_id,
    ]);
    await client.query('DELETE FROM chat_messages WHERE id = $1', [messageId]);
    await recomputeChatThreads(client, [row.thread_id]);
    await client.query('COMMIT');
    return {
      threadId: row.thread_id,
      senderEmail: row.email,
      senderPseudonym: row.pseudonym,
    };
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export class ChatRepository {
  constructor(private readonly pool: pg.Pool) {}

  private async transaction<T>(
    run: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (err: unknown) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  private async loadThread(
    db: Db,
    threadId: string,
    userId: string,
  ): Promise<ThreadViewRow> {
    const res = await db.query<ThreadViewRow>(
      `${THREAD_VIEW_SQL} AND t.id = $2::uuid`,
      [userId, threadId],
    );
    const row = res.rows[0];
    // An empty thread does not exist for the person it was opened towards.
    if (
      !row ||
      (row.message_count === 0 && row.initiator_is_low !== isLow(row, userId))
    ) {
      throw threadNotFound();
    }
    return row;
  }

  /** Locks both participants (id order) before the thread itself. */
  private async lockThread(
    client: pg.PoolClient,
    threadId: string,
    userId: string,
  ): Promise<ThreadRow> {
    const peek = await client.query<ThreadRow>(
      `SELECT * FROM chat_threads
       WHERE id = $1 AND (user_low_id = $2::uuid OR user_high_id = $2::uuid)`,
      [threadId, userId],
    );
    const found = peek.rows[0];
    if (!found) {
      throw threadNotFound();
    }
    await client.query(
      'SELECT id FROM users WHERE id = ANY($1::uuid[]) ORDER BY id FOR KEY SHARE',
      [[found.user_low_id, found.user_high_id].filter((id) => id !== null)],
    );
    const locked = await client.query<ThreadRow>(
      'SELECT * FROM chat_threads WHERE id = $1 FOR UPDATE',
      [threadId],
    );
    const row = locked.rows[0];
    if (
      !row ||
      (row.message_count === 0 && row.initiator_is_low !== isLow(row, userId))
    ) {
      throw threadNotFound();
    }
    return row;
  }

  private async isContactable(
    db: Db,
    recipientId: string,
    viaPolygonId: string | null,
  ): Promise<boolean> {
    const res = await db.query<{ ok: boolean }>(
      `SELECT (
         u.email_verified_at IS NOT NULL
         AND (
           u.allow_direct_messages
           OR EXISTS (
             SELECT 1 FROM polygons p
             WHERE p.id = $2::uuid
               AND p.user_id = u.id
               AND p.space_type = 'private'
               AND p.allow_chat_contact
           )
         )
       ) AS ok
       FROM users u WHERE u.id = $1`,
      [recipientId, viaPolygonId],
    );
    return res.rows[0]?.ok === true;
  }

  /**
   * Caps how many new people an account can try to reach per day. Without it,
   * opening conversations would reveal who accepts messages, one name at a
   * time, and withdrawing and re-sending a request would have no limit. Only
   * a date and a number are stored, never who was looked up, and the count is
   * kept even when the attempt fails.
   */
  private async countContactAttempt(
    userId: string,
    target: { polygonId: string } | { recipientPseudonym: string },
  ): Promise<void> {
    const known = await this.pool.query<{ known: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM chat_threads t
         WHERE t.user_low_id = LEAST(r.id, $1::uuid)
           AND t.user_high_id = GREATEST(r.id, $1::uuid)
           AND (t.message_count > 0 OR t.initiator_is_low = (t.user_low_id = $1::uuid))
       ) OR r.id = $1::uuid AS known
       FROM (
         SELECT CASE
           WHEN $2::uuid IS NOT NULL THEN (SELECT p.user_id FROM polygons p WHERE p.id = $2::uuid)
           ELSE (SELECT u.id FROM users u WHERE LOWER(u.pseudonym) = LOWER($3::text))
         END AS id
       ) r`,
      [
        userId,
        'polygonId' in target ? target.polygonId : null,
        'recipientPseudonym' in target ? target.recipientPseudonym : null,
      ],
    );
    if (known.rows[0]?.known === true) {
      return;
    }
    const counted = await this.pool.query(
      `UPDATE users
       SET chat_contact_count = CASE
             WHEN chat_contact_day = CURRENT_DATE THEN chat_contact_count + 1
             ELSE 1
           END,
           chat_contact_day = CURRENT_DATE
       WHERE id = $1
         AND (chat_contact_day IS DISTINCT FROM CURRENT_DATE OR chat_contact_count < $2)`,
      [userId, CHAT_LIMITS.MAX_CONTACT_ATTEMPTS_PER_DAY],
    );
    if (counted.rowCount === 0) {
      throw new ApiError(
        429,
        'CHAT_CONTACT_LIMIT',
        'You have reached the daily limit for starting new conversations.',
      );
    }
  }

  public async openThread(
    userId: string,
    target: { polygonId: string } | { recipientPseudonym: string },
  ): Promise<{ thread: ChatThread; created: boolean }> {
    await this.countContactAttempt(userId, target);
    return this.transaction(async (client) => {
      let recipientId: string | null;
      let polygonId: string | null = null;
      if ('polygonId' in target) {
        polygonId = target.polygonId;
        const res = await client.query<{ user_id: string | null }>(
          'SELECT user_id FROM polygons WHERE id = $1',
          [polygonId],
        );
        if (!res.rows[0]) {
          throw new ApiError(404, 'NOT_FOUND', 'Polygon not found.');
        }
        recipientId = res.rows[0].user_id;
      } else {
        const res = await client.query<{ id: string }>(
          'SELECT id FROM users WHERE LOWER(pseudonym) = LOWER($1)',
          [target.recipientPseudonym],
        );
        recipientId = res.rows[0]?.id ?? null;
      }
      if (recipientId === null) {
        throw chatUnavailable();
      }
      if (recipientId === userId) {
        throw new ApiError(
          422,
          'FORBIDDEN_SELF_CONTACT',
          'You cannot message yourself.',
        );
      }
      const userIsLow = userId < recipientId;
      const low = userIsLow ? userId : recipientId;
      const high = userIsLow ? recipientId : userId;
      const lockedUsers = await client.query(
        'SELECT id FROM users WHERE id = ANY($1::uuid[]) ORDER BY id FOR KEY SHARE',
        [[low, high]],
      );
      if (lockedUsers.rowCount !== 2) {
        throw chatUnavailable();
      }
      const existingRes = await client.query<ThreadRow>(
        `SELECT * FROM chat_threads
         WHERE user_low_id = $1 AND user_high_id = $2 FOR UPDATE`,
        [low, high],
      );
      const existing = existingRes.rows[0];
      if (existing) {
        const blockedByOther = userIsLow
          ? existing.blocked_by_high
          : existing.blocked_by_low;
        if (blockedByOther) {
          throw chatUnavailable();
        }
        if (existing.message_count > 0) {
          return {
            thread: mapThread(
              await this.loadThread(client, existing.id, userId),
              userId,
            ),
            created: false,
          };
        }
      }
      if (!(await this.isContactable(client, recipientId, polygonId))) {
        throw chatUnavailable();
      }
      const upsert = await client.query<{ id: string }>(
        `INSERT INTO chat_threads (user_low_id, user_high_id, initiator_is_low, opened_via_polygon_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_low_id, user_high_id)
           WHERE user_low_id IS NOT NULL AND user_high_id IS NOT NULL
         DO UPDATE SET initiator_is_low = EXCLUDED.initiator_is_low,
                       opened_via_polygon_id = EXCLUDED.opened_via_polygon_id
         RETURNING id`,
        [low, high, userIsLow, polygonId],
      );
      return {
        thread: mapThread(
          await this.loadThread(client, upsert.rows[0]!.id, userId),
          userId,
        ),
        created: existing === undefined,
      };
    });
  }

  public async listThreads(userId: string): Promise<ChatThread[]> {
    const res = await this.pool.query<ThreadViewRow>(
      `${THREAD_VIEW_SQL}
         AND (t.message_count > 0 OR t.initiator_is_low = (t.user_low_id = $1::uuid))
       ORDER BY t.last_message_at DESC NULLS FIRST, t.id
       LIMIT 200`,
      [userId],
    );
    return res.rows.map((row) => mapThread(row, userId));
  }

  public async unreadCount(userId: string): Promise<number> {
    const res = await this.pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n
       FROM chat_threads t
       INNER JOIN chat_messages m ON m.thread_id = t.id
       WHERE ((t.user_low_id = $1::uuid AND NOT t.blocked_by_low
               AND m.created_at > COALESCE(t.low_last_read_at, '-infinity'::timestamptz))
           OR (t.user_high_id = $1::uuid AND NOT t.blocked_by_high
               AND m.created_at > COALESCE(t.high_last_read_at, '-infinity'::timestamptz)))
         AND m.sender_user_id <> $1::uuid`,
      [userId],
    );
    return res.rows[0]?.n ?? 0;
  }

  private async queryMessages(
    db: Db,
    whereSql: string,
    params: unknown[],
    order: 'ASC' | 'DESC',
    limit: number,
  ): Promise<MessageRow[]> {
    const res = await db.query<MessageRow>(
      `SELECT m.id, m.thread_id, m.sender_user_id, su.pseudonym AS sender_pseudonym,
              m.body, m.created_at, m.created_at::text AS cursor_ts,
              p.id AS poly_id, ST_AsGeoJSON(p.geom, 6) AS poly_geojson,
              p.surface_type, p.space_type, p.status, p.area_m2,
              mu.name AS municipality_name,
              photo.thumb_name, photo.uploader AS thumb_uploader,
              c.id AS comment_id, c.polygon_id AS comment_polygon_id,
              cu.pseudonym AS comment_author, c.body AS comment_body,
              c.created_at AS comment_created_at
       FROM chat_messages m
       LEFT JOIN users su ON su.id = m.sender_user_id
       LEFT JOIN polygons p ON p.id = m.referenced_polygon_id
       LEFT JOIN municipalities mu ON mu.id = p.municipality_id
       LEFT JOIN LATERAL (
         SELECT pp.thumb_name, pu.pseudonym AS uploader
         FROM polygon_photos pp
         LEFT JOIN users pu ON pu.id = pp.user_id
         WHERE pp.polygon_id = p.id
           AND NOT (
             pp.credibility_score <= ${Number(PHOTO_LIMITS.FAKE_BLUR_SCORE_THRESHOLD)}
             AND pp.fake_votes > pp.real_votes
           )
         ORDER BY pp.credibility_score DESC, pp.created_at DESC, pp.id ASC
         LIMIT 1
       ) photo ON TRUE
       LEFT JOIN polygon_comments c ON c.id = m.referenced_comment_id
       LEFT JOIN users cu ON cu.id = c.user_id
       WHERE ${whereSql}
       ORDER BY m.created_at ${order}, m.id ${order}
       LIMIT ${Math.trunc(limit)}`,
      params,
    );
    return res.rows;
  }

  public async listMessages(
    userId: string,
    threadId: string,
    query: { limit: number; before?: string | undefined; after?: string | undefined },
  ): Promise<ChatMessagesResponse> {
    await this.loadThread(this.pool, threadId, userId);
    const cursorRaw = query.after ?? query.before;
    const cursor = cursorRaw === undefined ? null : decodeTimeCursor(cursorRaw);
    const ascending = query.after !== undefined;
    const rows = await this.queryMessages(
      this.pool,
      cursor === null
        ? 'm.thread_id = $1'
        : `m.thread_id = $1 AND (m.created_at, m.id) ${ascending ? '>' : '<'} ($2::timestamptz, $3::uuid)`,
      cursor === null ? [threadId] : [threadId, cursor.timestamp, cursor.id],
      ascending ? 'ASC' : 'DESC',
      query.limit + 1,
    );
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    if (!ascending) {
      page.reverse();
    }
    const first = page[0];
    const last = page[page.length - 1];
    if (last && query.before === undefined) {
      // Stores the message's own timestamp and writes only when it advances.
      await this.pool.query(
        `UPDATE chat_threads
         SET low_last_read_at = CASE WHEN user_low_id = $2::uuid THEN $3::timestamptz ELSE low_last_read_at END,
             high_last_read_at = CASE WHEN user_high_id = $2::uuid THEN $3::timestamptz ELSE high_last_read_at END
         WHERE id = $1
           AND COALESCE(
             CASE WHEN user_low_id = $2::uuid THEN low_last_read_at ELSE high_last_read_at END,
             '-infinity'::timestamptz
           ) < $3::timestamptz`,
        [threadId, userId, last.cursor_ts],
      );
    }
    const thread = mapThread(
      await this.loadThread(this.pool, threadId, userId),
      userId,
    );
    return {
      thread,
      messages: page.map((row) => mapMessage(row, userId)),
      nextBeforeCursor:
        !ascending && hasMore && first
          ? encodeTimeCursor(first.cursor_ts, first.id)
          : null,
      nextAfterCursor: last
        ? encodeTimeCursor(last.cursor_ts, last.id)
        : (query.after ?? null),
    };
  }

  public async sendMessage(
    userId: string,
    threadId: string,
    input: {
      body: string;
      referencedPolygonId?: string | null | undefined;
      referencedCommentId?: string | null | undefined;
    },
  ): Promise<ChatMessage> {
    return this.transaction(async (client) => {
      const thread = await this.lockThread(client, threadId, userId);
      const recipientId = isLow(thread, userId)
        ? thread.user_high_id
        : thread.user_low_id;
      if (
        recipientId === null ||
        thread.blocked_by_low ||
        thread.blocked_by_high
      ) {
        throw chatUnavailable();
      }
      const startsRequest = thread.accepted_at === null && isInitiator(thread, userId);
      const acceptsRequest = thread.accepted_at === null && !startsRequest;
      if (startsRequest) {
        if (thread.request_sent_at !== null) {
          throw new ApiError(
            409,
            'CHAT_REQUEST_PENDING',
            'You can send one message until this person has answered.',
          );
        }
        // Consent may have been withdrawn between opening and the first message.
        if (
          !(await this.isContactable(
            client,
            recipientId,
            thread.opened_via_polygon_id,
          ))
        ) {
          throw chatUnavailable();
        }
      }
      let polygonId = input.referencedPolygonId ?? null;
      const commentId = input.referencedCommentId ?? null;
      if (commentId !== null) {
        const res = await client.query<{ polygon_id: string }>(
          'SELECT polygon_id FROM polygon_comments WHERE id = $1',
          [commentId],
        );
        const comment = res.rows[0];
        if (!comment) {
          throw new ApiError(404, 'NOT_FOUND', 'Referenced comment not found.');
        }
        if (polygonId !== null && polygonId !== comment.polygon_id) {
          throw new ApiError(
            422,
            'VALIDATION_ERROR',
            'The referenced comment belongs to a different area.',
          );
        }
        polygonId = comment.polygon_id;
      }
      if (polygonId !== null) {
        const res = await client.query('SELECT 1 FROM polygons WHERE id = $1', [
          polygonId,
        ]);
        if (res.rowCount === 0) {
          throw new ApiError(404, 'NOT_FOUND', 'Referenced area not found.');
        }
      }
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO chat_messages
           (thread_id, sender_user_id, body, referenced_polygon_id, referenced_comment_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [threadId, userId, input.body, polygonId, commentId],
      );
      if (startsRequest || acceptsRequest) {
        await client.query(
          `UPDATE chat_threads
           SET request_sent_at = CASE WHEN $2::boolean THEN NOW() ELSE request_sent_at END,
               accepted_at = CASE WHEN $3::boolean THEN NOW() ELSE accepted_at END
           WHERE id = $1`,
          [threadId, startsRequest, acceptsRequest],
        );
      }
      await recomputeChatThreads(client, [threadId]);
      const rows = await this.queryMessages(
        client,
        'm.id = $1',
        [inserted.rows[0]!.id],
        'ASC',
        1,
      );
      return mapMessage(rows[0]!, userId);
    });
  }

  public async setBlocked(
    userId: string,
    threadId: string,
    blocked: boolean,
  ): Promise<ChatThread> {
    return this.transaction(async (client) => {
      await this.lockThread(client, threadId, userId);
      await client.query(
        `UPDATE chat_threads
         SET blocked_by_low = CASE WHEN user_low_id = $2::uuid THEN $3 ELSE blocked_by_low END,
             blocked_by_high = CASE WHEN user_high_id = $2::uuid THEN $3 ELSE blocked_by_high END
         WHERE id = $1`,
        [threadId, userId, blocked],
      );
      return mapThread(await this.loadThread(client, threadId, userId), userId);
    });
  }

  /** Deletes one own message, or all own messages when `messageId` is omitted. */
  public async deleteOwnMessages(
    userId: string,
    threadId: string,
    messageId?: string,
  ): Promise<void> {
    await this.transaction(async (client) => {
      await this.lockThread(client, threadId, userId);
      const res = await client.query(
        `DELETE FROM chat_messages
         WHERE thread_id = $1 AND sender_user_id = $2
           AND ($3::uuid IS NULL OR id = $3::uuid)`,
        [threadId, userId, messageId ?? null],
      );
      if (messageId !== undefined && res.rowCount === 0) {
        throw new ApiError(404, 'NOT_FOUND', 'Message not found.');
      }
      await recomputeChatThreads(client, [threadId]);
    });
  }

  /** Only resolves for participants; used for reports. */
  public async findReportableMessage(
    userId: string,
    messageId: string,
  ): Promise<{
    threadId: string;
    body: string;
    senderPseudonym: string;
    isOwn: boolean;
    createdAt: string;
  } | null> {
    const res = await this.pool.query<{
      thread_id: string;
      body: string;
      pseudonym: string;
      is_own: boolean;
      created_at: Date;
    }>(
      `SELECT m.thread_id, m.body, u.pseudonym,
              m.sender_user_id = $2::uuid AS is_own, m.created_at
       FROM chat_messages m
       INNER JOIN chat_threads t ON t.id = m.thread_id
       INNER JOIN users u ON u.id = m.sender_user_id
       WHERE m.id = $1 AND (t.user_low_id = $2::uuid OR t.user_high_id = $2::uuid)`,
      [messageId, userId],
    );
    const row = res.rows[0];
    return row
      ? {
          threadId: row.thread_id,
          body: row.body,
          senderPseudonym: row.pseudonym,
          isOwn: row.is_own,
          createdAt: row.created_at.toISOString(),
        }
      : null;
  }
}
