// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Unseal Contributors

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  ApiError,
  PHOTO_LIMITS,
  type PhotoVoteResponse,
  type PolygonPhoto,
} from '@entsiegelung/shared';

import { lockUserForWrite } from '../db/integrity.js';
import { recordTelemetryCounter } from '../db/telemetry.js';
import type { ProcessedPhotoBuffers } from './processor.js';

import type pg from 'pg';

interface PhotoQueryRow {
  id: string;
  polygon_id: string;
  user_id: string | null;
  file_name: string;
  thumb_name: string;
  width: number;
  height: number;
  gps_verified: boolean;
  uploader_pseudonym: string;
  is_uploader: boolean;
  real_votes: number;
  fake_votes: number;
  credibility_score: number;
  my_vote: number;
  created_at: Date;
}

function coerceVote(raw: number): -1 | 0 | 1 {
  if (raw === 1) {
    return 1;
  }
  if (raw === -1) {
    return -1;
  }
  return 0;
}

function isPhotoFlaggedFake(realVotes: number, fakeVotes: number, score: number): boolean {
  return (
    score <= PHOTO_LIMITS.FAKE_BLUR_SCORE_THRESHOLD && fakeVotes > realVotes
  );
}

function mapRowToPolygonPhoto(row: PhotoQueryRow): PolygonPhoto {
  return {
    id: row.id,
    polygonId: row.polygon_id,
    url: `/uploads/${row.file_name}`,
    thumbUrl: `/uploads/${row.thumb_name}`,
    width: row.width,
    height: row.height,
    gpsVerified: Boolean(row.gps_verified),
    uploaderPseudonym: row.uploader_pseudonym,
    isUploader: Boolean(row.is_uploader),
    realVotes: row.real_votes,
    fakeVotes: row.fake_votes,
    credibilityScore: row.credibility_score,
    myVote: coerceVote(row.my_vote),
    isFlaggedFake: isPhotoFlaggedFake(
      row.real_votes,
      row.fake_votes,
      row.credibility_score,
    ),
    createdAt: row.created_at.toISOString(),
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

export class PhotoRepository {
  private readonly pool: pg.Pool;
  private readonly uploadsDir: string;

  constructor(pool: pg.Pool, uploadsDir: string) {
    this.pool = pool;
    this.uploadsDir = uploadsDir;
  }

  public async listByPolygon(
    polygonId: string,
    viewerUserId: string | null,
  ): Promise<PolygonPhoto[]> {
    const existsRes = await this.pool.query<{ id: string }>(
      'SELECT id FROM polygons WHERE id = $1 LIMIT 1',
      [polygonId],
    );
    if (existsRes.rowCount === 0) {
      throw new ApiError(404, 'NOT_FOUND', 'Polygon not found.');
    }

    const res = await this.pool.query<PhotoQueryRow>(
      `SELECT
         pp.id,
         pp.polygon_id,
         pp.user_id,
         pp.file_name,
         pp.thumb_name,
         pp.width,
         pp.height,
         pp.gps_verified,
         COALESCE(u.pseudonym, 'deleted') AS uploader_pseudonym,
         CASE
           WHEN $2::uuid IS NOT NULL AND pp.user_id = $2::uuid THEN TRUE
           ELSE FALSE
         END AS is_uploader,
         pp.real_votes,
         pp.fake_votes,
         pp.credibility_score,
         COALESCE(pv.value, 0)::int AS my_vote,
         pp.created_at
       FROM polygon_photos pp
       LEFT JOIN users u ON u.id = pp.user_id
       LEFT JOIN polygon_photo_votes pv
         ON pv.photo_id = pp.id
        AND $2::uuid IS NOT NULL
        AND pv.user_id = $2::uuid
       WHERE pp.polygon_id = $1
       ORDER BY pp.credibility_score DESC, pp.created_at DESC, pp.id ASC`,
      [polygonId, viewerUserId],
    );

    return res.rows.map(mapRowToPolygonPhoto);
  }

  public async createPhoto(params: {
    polygonId: string;
    userId: string;
    processed: ProcessedPhotoBuffers;
  }): Promise<PolygonPhoto> {
    const photoId = crypto.randomUUID();
    const fileName = `${photoId}.webp`;
    const thumbName = `${photoId}_thumb.webp`;
    const fullPath = path.join(this.uploadsDir, fileName);
    const thumbPath = path.join(this.uploadsDir, thumbName);

    await fs.mkdir(this.uploadsDir, { recursive: true });
    await fs.writeFile(fullPath, params.processed.fullWebp, { mode: 0o644 });
    await fs.writeFile(thumbPath, params.processed.thumbWebp, { mode: 0o644 });

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await lockUserForWrite(client, params.userId);

      const polyRes = await client.query<{
        id: string;
        photo_count: number;
        gps_ok: boolean;
      }>(
        `SELECT
           id,
           photo_count,
           CASE
             WHEN $2::double precision IS NOT NULL AND $3::double precision IS NOT NULL
               THEN ST_DWithin(
                 geom::geography,
                 ST_SetSRID(ST_MakePoint($2::double precision, $3::double precision), 4326)::geography,
                 $4::double precision
               )
             ELSE FALSE
           END AS gps_ok
         FROM polygons
         WHERE id = $1
         FOR UPDATE`,
        [
          params.polygonId,
          params.processed.exifGps?.lng ?? null,
          params.processed.exifGps?.lat ?? null,
          PHOTO_LIMITS.GPS_VERIFY_DISTANCE_M,
        ],
      );
      const polyRow = polyRes.rows[0];
      if (!polyRow) {
        throw new ApiError(404, 'NOT_FOUND', 'Polygon not found.');
      }
      if (polyRow.photo_count >= PHOTO_LIMITS.MAX_PHOTOS_PER_POLYGON) {
        throw new ApiError(
          422,
          'VALIDATION_ERROR',
          `Maximum of ${PHOTO_LIMITS.MAX_PHOTOS_PER_POLYGON} photos per polygon reached.`,
        );
      }

      const insertRes = await client.query<PhotoQueryRow>(
        `INSERT INTO polygon_photos (
           id,
           polygon_id,
           user_id,
           file_name,
           thumb_name,
           width,
           height,
           gps_verified
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING
           id,
           polygon_id,
           user_id,
           file_name,
           thumb_name,
           width,
           height,
           gps_verified,
           (SELECT COALESCE(u.pseudonym, 'deleted') FROM users u WHERE u.id = $3) AS uploader_pseudonym,
           TRUE AS is_uploader,
           real_votes,
           fake_votes,
           credibility_score,
           0::int AS my_vote,
           created_at`,
        [
          photoId,
          params.polygonId,
          params.userId,
          fileName,
          thumbName,
          params.processed.width,
          params.processed.height,
          Boolean(polyRow.gps_ok),
        ],
      );
      const inserted = insertRes.rows[0];
      if (!inserted) {
        throw new ApiError(500, 'INTERNAL_ERROR', 'Failed to persist photo.');
      }

      await client.query(
        'UPDATE polygons SET photo_count = photo_count + 1, updated_at = NOW() WHERE id = $1',
        [params.polygonId],
      );

      const gpsDimension = polyRow.gps_ok
        ? 'gps_verified'
        : params.processed.exifGps !== null
          ? 'gps_outside_polygon'
          : 'no_exif_gps';
      await recordTelemetryCounter(client, 'photo_uploaded', gpsDimension);

      await client.query('COMMIT');
      return mapRowToPolygonPhoto(inserted);
    } catch (err: unknown) {
      await rollbackPreservingError(client, err);
      await fs.unlink(fullPath).catch(() => undefined);
      await fs.unlink(thumbPath).catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  public async castVote(params: {
    photoId: string;
    userId: string;
    value: 1 | -1;
  }): Promise<PhotoVoteResponse> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await lockUserForWrite(client, params.userId);

      const lockRes = await client.query<{
        id: string;
        polygon_id: string;
        user_id: string | null;
      }>(
        'SELECT id, polygon_id, user_id FROM polygon_photos WHERE id = $1 FOR UPDATE',
        [params.photoId],
      );
      const photo = lockRes.rows[0];
      if (!photo) {
        throw new ApiError(404, 'NOT_FOUND', 'Photo not found.');
      }

      if (photo.user_id !== null && photo.user_id === params.userId) {
        throw new ApiError(
          403,
          'FORBIDDEN_SELF_VOTE',
          'You cannot vote on your own photo.',
        );
      }

      await client.query(
        `INSERT INTO polygon_photo_votes (photo_id, user_id, value, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         ON CONFLICT (photo_id, user_id) DO UPDATE
         SET value = EXCLUDED.value, updated_at = NOW()`,
        [params.photoId, params.userId, params.value],
      );

      const aggRes = await client.query<{
        real_votes: number;
        fake_votes: number;
        credibility_score: number;
      }>(
        `WITH agg AS (
           SELECT
             COALESCE(COUNT(*) FILTER (WHERE value = 1), 0)::int AS real_votes,
             COALESCE(COUNT(*) FILTER (WHERE value = -1), 0)::int AS fake_votes,
             COALESCE(SUM(value), 0)::int AS credibility_score
           FROM polygon_photo_votes
           WHERE photo_id = $1
         )
         UPDATE polygon_photos AS pp
         SET
           real_votes = agg.real_votes,
           fake_votes = agg.fake_votes,
           credibility_score = agg.credibility_score
         FROM agg
         WHERE pp.id = $1
         RETURNING pp.real_votes, pp.fake_votes, pp.credibility_score`,
        [params.photoId],
      );
      const counts = aggRes.rows[0]!;
      await client.query('COMMIT');

      return {
        photoId: photo.id,
        polygonId: photo.polygon_id,
        realVotes: counts.real_votes,
        fakeVotes: counts.fake_votes,
        credibilityScore: counts.credibility_score,
        myVote: params.value,
        isFlaggedFake: isPhotoFlaggedFake(
          counts.real_votes,
          counts.fake_votes,
          counts.credibility_score,
        ),
      };
    } catch (err: unknown) {
      await rollbackPreservingError(client, err);
      throw err;
    } finally {
      client.release();
    }
  }

  public async removeVote(params: {
    photoId: string;
    userId: string;
  }): Promise<PhotoVoteResponse> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await lockUserForWrite(client, params.userId);

      const lockRes = await client.query<{
        id: string;
        polygon_id: string;
      }>('SELECT id, polygon_id FROM polygon_photos WHERE id = $1 FOR UPDATE', [
        params.photoId,
      ]);
      const photo = lockRes.rows[0];
      if (!photo) {
        throw new ApiError(404, 'NOT_FOUND', 'Photo not found.');
      }

      await client.query(
        'DELETE FROM polygon_photo_votes WHERE photo_id = $1 AND user_id = $2',
        [params.photoId, params.userId],
      );

      const aggRes = await client.query<{
        real_votes: number;
        fake_votes: number;
        credibility_score: number;
      }>(
        `WITH agg AS (
           SELECT
             COALESCE(COUNT(*) FILTER (WHERE value = 1), 0)::int AS real_votes,
             COALESCE(COUNT(*) FILTER (WHERE value = -1), 0)::int AS fake_votes,
             COALESCE(SUM(value), 0)::int AS credibility_score
           FROM polygon_photo_votes
           WHERE photo_id = $1
         )
         UPDATE polygon_photos AS pp
         SET
           real_votes = agg.real_votes,
           fake_votes = agg.fake_votes,
           credibility_score = agg.credibility_score
         FROM agg
         WHERE pp.id = $1
         RETURNING pp.real_votes, pp.fake_votes, pp.credibility_score`,
        [params.photoId],
      );
      const counts = aggRes.rows[0]!;
      await client.query('COMMIT');

      return {
        photoId: photo.id,
        polygonId: photo.polygon_id,
        realVotes: counts.real_votes,
        fakeVotes: counts.fake_votes,
        credibilityScore: counts.credibility_score,
        myVote: 0,
        isFlaggedFake: isPhotoFlaggedFake(
          counts.real_votes,
          counts.fake_votes,
          counts.credibility_score,
        ),
      };
    } catch (err: unknown) {
      await rollbackPreservingError(client, err);
      throw err;
    } finally {
      client.release();
    }
  }

  public async deletePhoto(params: {
    photoId: string;
    actorUserId: string;
    actorIsAdmin: boolean;
  }): Promise<void> {
    const client = await this.pool.connect();
    let filesToUnlink: { file_name: string; thumb_name: string } | null = null;
    try {
      await client.query('BEGIN');
      await lockUserForWrite(client, params.actorUserId);

      const photoRes = await client.query<{
        id: string;
        polygon_id: string;
        user_id: string | null;
        file_name: string;
        thumb_name: string;
      }>(
        `SELECT id, polygon_id, user_id, file_name, thumb_name
         FROM polygon_photos
         WHERE id = $1
         FOR UPDATE`,
        [params.photoId],
      );
      const photo = photoRes.rows[0];
      if (!photo) {
        throw new ApiError(404, 'NOT_FOUND', 'Photo not found.');
      }

      const isUploader =
        photo.user_id !== null && photo.user_id === params.actorUserId;
      if (!isUploader && !params.actorIsAdmin) {
        throw new ApiError(
          403,
          'FORBIDDEN_NOT_AUTHOR',
          'Only the uploader or an administrator may delete this photo.',
        );
      }

      await client.query('SELECT id FROM polygons WHERE id = $1 FOR UPDATE', [
        photo.polygon_id,
      ]);

      await client.query('DELETE FROM polygon_photos WHERE id = $1', [
        params.photoId,
      ]);
      await client.query(
        `UPDATE polygons
         SET
           photo_count = (SELECT COUNT(*)::int FROM polygon_photos WHERE polygon_id = $1),
           updated_at = NOW()
         WHERE id = $1`,
        [photo.polygon_id],
      );

      filesToUnlink = {
        file_name: photo.file_name,
        thumb_name: photo.thumb_name,
      };

      await client.query('COMMIT');
    } catch (err: unknown) {
      await rollbackPreservingError(client, err);
      throw err;
    } finally {
      client.release();
    }

    if (filesToUnlink) {
      await fs
        .unlink(path.join(this.uploadsDir, filesToUnlink.file_name))
        .catch(() => undefined);
      await fs
        .unlink(path.join(this.uploadsDir, filesToUnlink.thumb_name))
        .catch(() => undefined);
    }
  }
}
