import {
  ApiError,
  GEOMETRY_LIMITS,
  SURFACE_TYPES,
  type BboxBounds,
  type CreatePolygonRequest,
  type PolygonFeature,
  type SurfaceType,
} from '@entsiegelung/shared';

import { lockUserForWrite } from '../db/integrity.js';

import type pg from 'pg';

export interface CreatePolygonParams {
  userId: string;
  geometry: CreatePolygonRequest['geometry'];
  surfaceType: SurfaceType;
  note?: string | null | undefined;
  maxDailyPolygonsPerUser: number;
  minAreaM2?: number | undefined;
  maxAreaM2?: number | undefined;
}

export interface ListPolygonsByBboxParams {
  bbox: BboxBounds;
  viewerUserId: string | null;
  limit?: number | undefined;
}

export interface ListPolygonsByBboxResult {
  features: PolygonFeature[];
  truncated: boolean;
  limit: number;
}

export interface PatchPolygonParams {
  polygonId: string;
  userId: string;
  surfaceType?: SurfaceType | undefined;
  note?: string | null | undefined;
}

export interface ExportCursor {
  createdAtRaw: string;
  id: string;
}

export interface ExportBatchResult {
  features: PolygonFeature[];
  nextCursor: ExportCursor | undefined;
}

interface PolygonQueryRow {
  id: string;
  user_id: string | null;
  geom_geojson: string;
  surface_type: string;
  note: string | null;
  area_m2: number;
  author_pseudonym: string;
  upvotes: number;
  downvotes: number;
  score: number;
  my_vote: number;
  is_author: boolean;
  created_at: Date;
  updated_at: Date;
}

interface ExportPolygonRow {
  id: string;
  geom_geojson: string;
  surface_type: string;
  note: string | null;
  area_m2: number;
  author_pseudonym: string;
  upvotes: number;
  downvotes: number;
  score: number;
  created_at: Date;
  updated_at: Date;
  cursor_created_at: string;
}

interface GeometryValidationRow {
  geom_type: string;
  interior_rings: number;
  n_points: number;
  is_valid: boolean;
  invalid_reason: string | null;
  invalid_location_geojson: string | null;
  area_m2: number | null;
}

interface LockedPolygonRow {
  id: string;
  user_id: string | null;
  surface_type: string;
  note: string | null;
}

const DEFAULT_EXPORT_BATCH_SIZE = 1_000;
const DEFAULT_EXPORT_STATEMENT_TIMEOUT_MS = 10_000;

function normalizeNote(note: string | null | undefined): string | null {
  if (note === undefined || note === null || note.trim().length === 0) {
    return null;
  }
  return note;
}

function coerceSurfaceType(raw: string): SurfaceType {
  return (SURFACE_TYPES as readonly string[]).includes(raw)
    ? (raw as SurfaceType)
    : 'other';
}

function coerceVoteValue(raw: number): -1 | 0 | 1 {
  if (raw === 1) {
    return 1;
  }
  if (raw === -1) {
    return -1;
  }
  return 0;
}

function parsePolygonGeoJson(raw: string): PolygonFeature['geometry'] {
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('type' in parsed) ||
    !('coordinates' in parsed) ||
    (parsed as { type: unknown }).type !== 'Polygon' ||
    !Array.isArray((parsed as { coordinates: unknown }).coordinates)
  ) {
    throw new ApiError(
      500,
      'INTERNAL_ERROR',
      'Unexpected GeoJSON polygon representation returned from database.',
    );
  }
  return {
    type: 'Polygon',
    coordinates: (parsed as { coordinates: [number, number][][] }).coordinates,
  };
}

function parseInvalidLocationPoint(raw: string | null): [number, number] | null {
  if (raw === null) {
    return null;
  }
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('coordinates' in parsed) ||
    !Array.isArray((parsed as { coordinates: unknown }).coordinates)
  ) {
    return null;
  }
  const coords = (parsed as { coordinates: unknown[] }).coordinates;
  const lng = coords[0];
  const lat = coords[1];
  if (
    typeof lng === 'number' &&
    typeof lat === 'number' &&
    Number.isFinite(lng) &&
    Number.isFinite(lat)
  ) {
    return [lng, lat];
  }
  return null;
}

function mapRowToPolygonFeature(row: PolygonQueryRow): PolygonFeature {
  return {
    type: 'Feature',
    id: row.id,
    geometry: parsePolygonGeoJson(row.geom_geojson),
    properties: {
      id: row.id,
      surfaceType: coerceSurfaceType(row.surface_type),
      note: row.note,
      areaM2: Number(row.area_m2),
      authorPseudonym: row.author_pseudonym,
      upvotes: row.upvotes,
      downvotes: row.downvotes,
      score: row.score,
      myVote: coerceVoteValue(row.my_vote),
      isAuthor: Boolean(row.is_author),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    },
  };
}

function mapExportRowToPolygonFeature(row: ExportPolygonRow): PolygonFeature {
  return {
    type: 'Feature',
    id: row.id,
    geometry: parsePolygonGeoJson(row.geom_geojson),
    properties: {
      id: row.id,
      surfaceType: coerceSurfaceType(row.surface_type),
      note: row.note,
      areaM2: Number(row.area_m2),
      authorPseudonym: row.author_pseudonym,
      upvotes: row.upvotes,
      downvotes: row.downvotes,
      score: row.score,
      myVote: 0,
      isAuthor: false,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    },
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

export class PolygonRepository {
  private readonly pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  public async create(params: CreatePolygonParams): Promise<PolygonFeature> {
    const minAreaM2 = params.minAreaM2 ?? GEOMETRY_LIMITS.MIN_AREA_M2;
    const maxAreaM2 = params.maxAreaM2 ?? GEOMETRY_LIMITS.MAX_AREA_M2;
    const normalizedNote = normalizeNote(params.note);
    const geoJsonInput = JSON.stringify(params.geometry);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Global lock order: lock users row BEFORE touching polygons or polygon_creations
      await lockUserForWrite(client, params.userId);

      const quotaRes = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
         FROM polygon_creations
         WHERE user_id = $1
           AND created_at > NOW() - INTERVAL '24 hours'`,
        [params.userId],
      );
      const recentCount = quotaRes.rows[0]?.count ?? 0;
      if (recentCount >= params.maxDailyPolygonsPerUser) {
        throw new ApiError(
          429,
          'RATE_LIMITED',
          `Daily limit of ${params.maxDailyPolygonsPerUser} polygon proposals per 24 hours reached.`,
          { maxDailyPolygonsPerUser: params.maxDailyPolygonsPerUser },
        );
      }

      let validationRow: GeometryValidationRow | undefined;
      try {
        const validationRes = await client.query<GeometryValidationRow>(
          `WITH parsed AS (
             SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS g
           ),
           inspected AS (
             SELECT
               g,
               GeometryType(g) AS geom_type,
               ST_NumInteriorRings(g) AS interior_rings,
               ST_NPoints(g) AS n_points,
               ST_IsValidDetail(g) AS d
             FROM parsed
           )
           SELECT
             geom_type,
             interior_rings,
             n_points,
             (d).valid AS is_valid,
             (d).reason AS invalid_reason,
             CASE
               WHEN (d).location IS NOT NULL THEN ST_AsGeoJSON((d).location, 6)
               ELSE NULL
             END AS invalid_location_geojson,
             CASE
               WHEN (d).valid AND geom_type = 'POLYGON' AND interior_rings = 0 AND n_points <= $2
                 THEN ST_Area(g::geography)
               ELSE NULL
             END AS area_m2
           FROM inspected`,
          [geoJsonInput, GEOMETRY_LIMITS.MAX_RING_POSITIONS],
        );
        validationRow = validationRes.rows[0];
      } catch (pgErr: unknown) {
        const pgCode =
          typeof pgErr === 'object' && pgErr !== null && 'code' in pgErr
            ? (pgErr as { code?: unknown }).code
            : undefined;
        if (pgCode === 'XX000' || pgCode === '22023') {
          const reason =
            pgErr instanceof Error ? pgErr.message : 'Invalid GeoJSON polygon geometry';
          throw new ApiError(
            422,
            'GEOMETRY_INVALID',
            `Invalid polygon geometry: ${reason}`,
            { reason, location: null },
          );
        }
        throw pgErr;
      }

      if (!validationRow) {
        throw new ApiError(500, 'INTERNAL_ERROR', 'Failed to evaluate polygon geometry.');
      }

      if (
        validationRow.geom_type !== 'POLYGON' ||
        validationRow.interior_rings !== 0 ||
        validationRow.n_points < GEOMETRY_LIMITS.MIN_RING_POSITIONS ||
        validationRow.n_points > GEOMETRY_LIMITS.MAX_RING_POSITIONS
      ) {
        throw new ApiError(
          422,
          'GEOMETRY_INVALID',
          'Polygon geometry must have 1 exterior ring (4..201 positions) and 0 interior rings.',
          { reason: 'Invalid ring structure', location: null },
        );
      }

      if (!validationRow.is_valid) {
        const reason = validationRow.invalid_reason ?? 'Invalid polygon geometry';
        const location = parseInvalidLocationPoint(
          validationRow.invalid_location_geojson,
        );
        throw new ApiError(
          422,
          'GEOMETRY_INVALID',
          `Invalid polygon geometry: ${reason}.`,
          { reason, location },
        );
      }

      const areaM2 = validationRow.area_m2;
      if (
        areaM2 === null ||
        !Number.isFinite(areaM2) ||
        areaM2 < minAreaM2 ||
        areaM2 > maxAreaM2
      ) {
        throw new ApiError(
          422,
          'AREA_OUT_OF_BOUNDS',
          `Polygon area must be between ${minAreaM2} m² and ${maxAreaM2} m².`,
          { areaM2, minAreaM2, maxAreaM2 },
        );
      }

      const insertRes = await client.query<PolygonQueryRow>(
        `INSERT INTO polygons (
           user_id,
           geom,
           surface_type,
           note,
           area_m2
         )
         VALUES (
           $1,
           ST_ForcePolygonCCW(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)),
           $3,
           $4,
           $5
         )
         RETURNING
           id,
           user_id,
           ST_AsGeoJSON(geom, 6) AS geom_geojson,
           surface_type,
           note,
           area_m2,
           (SELECT COALESCE(u.pseudonym, 'deleted') FROM users u WHERE u.id = $1) AS author_pseudonym,
           upvotes,
           downvotes,
           score,
           0::int AS my_vote,
           TRUE AS is_author,
           created_at,
           updated_at`,
        [
          params.userId,
          geoJsonInput,
          params.surfaceType,
          normalizedNote,
          areaM2,
        ],
      );

      const insertedRow = insertRes.rows[0];
      if (!insertedRow) {
        throw new ApiError(500, 'INTERNAL_ERROR', 'Failed to persist polygon.');
      }

      await client.query(
        'INSERT INTO polygon_creations (user_id) VALUES ($1)',
        [params.userId],
      );

      await client.query('COMMIT');
      return mapRowToPolygonFeature(insertedRow);
    } catch (err: unknown) {
      await rollbackPreservingError(client, err);
      throw err;
    } finally {
      client.release();
    }
  }

  public async listByBbox(
    params: ListPolygonsByBboxParams,
  ): Promise<ListPolygonsByBboxResult> {
    const limit = params.limit ?? GEOMETRY_LIMITS.BBOX_FEATURE_LIMIT;
    const queryLimit = limit + 1;

    const res = await this.pool.query<PolygonQueryRow>(
      `SELECT
         p.id,
         p.user_id,
         ST_AsGeoJSON(p.geom, 6) AS geom_geojson,
         p.surface_type,
         p.note,
         p.area_m2,
         COALESCE(u.pseudonym, 'deleted') AS author_pseudonym,
         p.upvotes,
         p.downvotes,
         p.score,
         COALESCE(v.value, 0)::int AS my_vote,
         CASE
           WHEN $5::uuid IS NOT NULL AND p.user_id = $5::uuid THEN TRUE
           ELSE FALSE
         END AS is_author,
         p.created_at,
         p.updated_at
       FROM polygons p
       LEFT JOIN users u ON u.id = p.user_id
       LEFT JOIN votes v
         ON v.polygon_id = p.id
        AND $5::uuid IS NOT NULL
        AND v.user_id = $5::uuid
       WHERE ST_Intersects(
         p.geom,
         ST_MakeEnvelope($1, $2, $3, $4, 4326)
       )
       ORDER BY p.score DESC, p.created_at DESC, p.id ASC
       LIMIT $6`,
      [
        params.bbox.minLng,
        params.bbox.minLat,
        params.bbox.maxLng,
        params.bbox.maxLat,
        params.viewerUserId,
        queryLimit,
      ],
    );

    const truncated = res.rows.length > limit;
    const features = res.rows
      .slice(0, limit)
      .map((row) => mapRowToPolygonFeature(row));

    return {
      features,
      truncated,
      limit,
    };
  }

  public async getById(
    polygonId: string,
    viewerUserId: string | null,
  ): Promise<PolygonFeature | null> {
    const res = await this.pool.query<PolygonQueryRow>(
      `SELECT
         p.id,
         p.user_id,
         ST_AsGeoJSON(p.geom, 6) AS geom_geojson,
         p.surface_type,
         p.note,
         p.area_m2,
         COALESCE(u.pseudonym, 'deleted') AS author_pseudonym,
         p.upvotes,
         p.downvotes,
         p.score,
         COALESCE(v.value, 0)::int AS my_vote,
         CASE
           WHEN $2::uuid IS NOT NULL AND p.user_id = $2::uuid THEN TRUE
           ELSE FALSE
         END AS is_author,
         p.created_at,
         p.updated_at
       FROM polygons p
       LEFT JOIN users u ON u.id = p.user_id
       LEFT JOIN votes v
         ON v.polygon_id = p.id
        AND $2::uuid IS NOT NULL
        AND v.user_id = $2::uuid
       WHERE p.id = $1
       LIMIT 1`,
      [polygonId, viewerUserId],
    );

    const row = res.rows[0];
    if (!row) {
      return null;
    }
    return mapRowToPolygonFeature(row);
  }

  public async patch(params: PatchPolygonParams): Promise<PolygonFeature> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Global lock order: lock users row BEFORE locking polygons FOR UPDATE
      await lockUserForWrite(client, params.userId);

      const lockRes = await client.query<LockedPolygonRow>(
        `SELECT id, user_id, surface_type, note
         FROM polygons
         WHERE id = $1
         FOR UPDATE`,
        [params.polygonId],
      );
      const existing = lockRes.rows[0];
      if (!existing) {
        throw new ApiError(404, 'NOT_FOUND', 'Polygon not found.');
      }
      if (existing.user_id === null || existing.user_id !== params.userId) {
        throw new ApiError(
          403,
          'FORBIDDEN_NOT_AUTHOR',
          'Only the author of this polygon may update it.',
        );
      }

      const nextSurfaceType = params.surfaceType ?? existing.surface_type;
      const nextNote =
        params.note === undefined ? existing.note : normalizeNote(params.note);

      const updateRes = await client.query<PolygonQueryRow>(
        `UPDATE polygons AS p
         SET
           surface_type = $2,
           note = $3,
           updated_at = NOW()
         WHERE p.id = $1
         RETURNING
           p.id,
           p.user_id,
           ST_AsGeoJSON(p.geom, 6) AS geom_geojson,
           p.surface_type,
           p.note,
           p.area_m2,
           (SELECT COALESCE(u.pseudonym, 'deleted') FROM users u WHERE u.id = p.user_id) AS author_pseudonym,
           p.upvotes,
           p.downvotes,
           p.score,
           COALESCE(
             (SELECT v.value FROM votes v WHERE v.polygon_id = p.id AND v.user_id = $4),
             0
           )::int AS my_vote,
           TRUE AS is_author,
           p.created_at,
           p.updated_at`,
        [params.polygonId, nextSurfaceType, nextNote, params.userId],
      );

      const updatedRow = updateRes.rows[0];
      if (!updatedRow) {
        throw new ApiError(404, 'NOT_FOUND', 'Polygon not found.');
      }

      await client.query('COMMIT');
      return mapRowToPolygonFeature(updatedRow);
    } catch (err: unknown) {
      await rollbackPreservingError(client, err);
      throw err;
    } finally {
      client.release();
    }
  }

  public async delete(polygonId: string, userId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Global lock order: lock users row BEFORE locking polygons FOR UPDATE
      await lockUserForWrite(client, userId);

      const lockRes = await client.query<{ id: string; user_id: string | null }>(
        `SELECT id, user_id
         FROM polygons
         WHERE id = $1
         FOR UPDATE`,
        [polygonId],
      );
      const existing = lockRes.rows[0];
      if (!existing) {
        throw new ApiError(404, 'NOT_FOUND', 'Polygon not found.');
      }
      if (existing.user_id === null || existing.user_id !== userId) {
        throw new ApiError(
          403,
          'FORBIDDEN_NOT_AUTHOR',
          'Only the author of this polygon may delete it.',
        );
      }

      await client.query('DELETE FROM polygons WHERE id = $1', [polygonId]);
      await client.query('COMMIT');
    } catch (err: unknown) {
      await rollbackPreservingError(client, err);
      throw err;
    } finally {
      client.release();
    }
  }

  public async fetchExportBatch(
    cursor?: ExportCursor,
    batchSize: number = DEFAULT_EXPORT_BATCH_SIZE,
    statementTimeoutMs: number = DEFAULT_EXPORT_STATEMENT_TIMEOUT_MS,
  ): Promise<ExportBatchResult> {
    const safeTimeoutMs = Math.max(1, Math.trunc(statementTimeoutMs));
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      await client.query(`SET LOCAL statement_timeout = '${safeTimeoutMs}ms'`);

      const res = cursor
        ? await client.query<ExportPolygonRow>(
            `SELECT
               p.id,
               ST_AsGeoJSON(p.geom, 6) AS geom_geojson,
               p.surface_type,
               p.note,
               p.area_m2,
               COALESCE(u.pseudonym, 'deleted') AS author_pseudonym,
               p.upvotes,
               p.downvotes,
               p.score,
               p.created_at,
               p.updated_at,
               p.created_at::text AS cursor_created_at
             FROM polygons p
             LEFT JOIN users u ON u.id = p.user_id
             WHERE (p.created_at, p.id) > ($1::timestamptz, $2::uuid)
             ORDER BY p.created_at ASC, p.id ASC
             LIMIT $3`,
            [cursor.createdAtRaw, cursor.id, batchSize],
          )
        : await client.query<ExportPolygonRow>(
            `SELECT
               p.id,
               ST_AsGeoJSON(p.geom, 6) AS geom_geojson,
               p.surface_type,
               p.note,
               p.area_m2,
               COALESCE(u.pseudonym, 'deleted') AS author_pseudonym,
               p.upvotes,
               p.downvotes,
               p.score,
               p.created_at,
               p.updated_at,
               p.created_at::text AS cursor_created_at
             FROM polygons p
             LEFT JOIN users u ON u.id = p.user_id
             ORDER BY p.created_at ASC, p.id ASC
             LIMIT $1`,
            [batchSize],
          );

      await client.query('COMMIT');

      const features = res.rows.map((row) => mapExportRowToPolygonFeature(row));
      const lastRow = res.rows[res.rows.length - 1];
      const nextCursor =
        res.rows.length === batchSize && lastRow
          ? {
              createdAtRaw: lastRow.cursor_created_at,
              id: lastRow.id,
            }
          : undefined;

      return { features, nextCursor };
    } catch (err: unknown) {
      await rollbackPreservingError(client, err);
      throw err;
    } finally {
      client.release();
    }
  }
}
