import fs from 'node:fs/promises';
import path from 'node:path';

import {
  AUTHOR_ACTIVITY,
  ApiError,
  GEOMETRY_LIMITS,
  IMPORT_LIMITS,
  LAND_COVER_MAX_OVERLAP_RATIO,
  POLYGON_STATUSES,
  SURFACE_TYPES,
  TRUST_AND_MODERATION_LIMITS,
  computeMunicipalityNormalizedScore,
  type BboxBounds,
  type CreatePolygonRequest,
  type ExportPolygonFeature,
  type FlagPolygonResponse,
  type ImportPolygonsResponse,
  type LandCoverCategory,
  type PolygonFeature,
  type PolygonFilter,
  type PolygonFlagReason,
  type PolygonStatus,
  type SurfaceType,
} from '@entsiegelung/shared';

import { lockUserForWrite } from '../db/integrity.js';
import type { ExtractedImportDataset } from './gpkgReader.js';

import type pg from 'pg';

export interface PolygonTrustConfig {
  minAccountDays: number;
  minCleanPolygons: number;
}

export interface CreatePolygonParams {
  userId: string;
  geometry: CreatePolygonRequest['geometry'];
  surfaceType: SurfaceType;
  note?: string | null | undefined;
  maxDailyPolygonsPerUser: number;
  minAreaM2?: number | undefined;
  maxAreaM2?: number | undefined;
  requireJurisdiction?: 'when_seeded' | 'strict' | 'off' | undefined;
}

export interface ListPolygonsByBboxParams {
  bbox: BboxBounds;
  viewerUserId: string | null;
  limit?: number | undefined;
  filter?: PolygonFilter | undefined;
}

export interface FlagPolygonParams {
  polygonId: string;
  userId: string;
  reason: PolygonFlagReason;
  note?: string | null | undefined;
}

export interface UnflagPolygonParams {
  polygonId: string;
  userId: string;
}

export interface ClearPolygonFlagsParams {
  polygonId: string;
  adminUserId: string;
}

export interface PruneStalePolygonsResult {
  deletedCount: number;
  deletedIds: string[];
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

export interface SetPolygonStatusParams {
  polygonId: string;
  adminUserId: string;
  status: PolygonStatus;
}

export interface ImportPolygonsParams {
  adminUserId: string;
  dataset: ExtractedImportDataset;
  minAreaM2?: number | undefined;
  maxAreaM2?: number | undefined;
}

export interface ExportCursor {
  createdAtRaw: string;
  id: string;
}

export interface ExportBatchResult {
  features: ExportPolygonFeature[];
  nextCursor: ExportCursor | undefined;
}

interface PolygonQueryRow {
  id: string;
  user_id: string | null;
  geom_geojson: string;
  surface_type: string;
  status: string;
  finished_at: Date | null;
  note: string | null;
  area_m2: number;
  municipality_ags: string | null;
  municipality_name: string | null;
  municipality_max_score: number;
  photo_count: number;
  comment_count: number;
  author_pseudonym: string;
  author_is_new_user: boolean;
  author_recently_active: boolean | null;
  flag_count: number;
  my_flag: boolean;
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
  status: string;
  finished_at: Date | null;
  note: string | null;
  area_m2: number;
  municipality_ags: string | null;
  municipality_name: string | null;
  municipality_max_score: number;
  photo_count: number;
  comment_count: number;
  flag_count: number;
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
  perimeter_m: number | null;
  compactness_pp: number | null;
  is_sliver: boolean | null;
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

function coercePolygonStatus(raw: string): PolygonStatus {
  return (POLYGON_STATUSES as readonly string[]).includes(raw)
    ? (raw as PolygonStatus)
    : 'proposed';
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
  const status = coercePolygonStatus(row.status);
  const municipalityAgs = row.municipality_ags ?? null;
  const municipalityMaxScore = Math.max(0, Number(row.municipality_max_score ?? 0));
  const municipalityNormalizedScore = computeMunicipalityNormalizedScore(
    row.score,
    status,
    municipalityAgs,
    municipalityMaxScore,
  );

  return {
    type: 'Feature',
    id: row.id,
    geometry: parsePolygonGeoJson(row.geom_geojson),
    properties: {
      id: row.id,
      surfaceType: coerceSurfaceType(row.surface_type),
      status,
      finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
      note: row.note,
      areaM2: Number(row.area_m2),
      municipalityAgs,
      municipalityName: row.municipality_name ?? null,
      municipalityMaxScore,
      municipalityNormalizedScore,
      photoCount: Math.max(0, Number(row.photo_count ?? 0)),
      commentCount: Math.max(0, Number(row.comment_count ?? 0)),
      authorPseudonym: row.author_pseudonym,
      authorIsNewUser: Boolean(row.author_is_new_user),
      authorRecentlyActive: row.author_recently_active ?? null,
      flagCount: Math.max(0, Number(row.flag_count ?? 0)),
      isFlagged: Number(row.flag_count ?? 0) > 0,
      myFlag: Boolean(row.my_flag),
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

function mapExportRowToExportFeature(row: ExportPolygonRow): ExportPolygonFeature {
  const status = coercePolygonStatus(row.status);
  const municipalityAgs = row.municipality_ags ?? null;
  const municipalityMaxScore = Math.max(0, Number(row.municipality_max_score ?? 0));
  const municipalityNormalizedScore = computeMunicipalityNormalizedScore(
    row.score,
    status,
    municipalityAgs,
    municipalityMaxScore,
  );

  return {
    type: 'Feature',
    id: row.id,
    geometry: parsePolygonGeoJson(row.geom_geojson),
    properties: {
      id: row.id,
      surfaceType: coerceSurfaceType(row.surface_type),
      status,
      finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
      note: row.note,
      areaM2: Number(row.area_m2),
      municipalityAgs,
      municipalityName: row.municipality_name ?? null,
      municipalityMaxScore,
      municipalityNormalizedScore,
      photoCount: Math.max(0, Number(row.photo_count ?? 0)),
      commentCount: Math.max(0, Number(row.comment_count ?? 0)),
      flagCount: Math.max(0, Number(row.flag_count ?? 0)),
      isFlagged: Number(row.flag_count ?? 0) > 0,
      upvotes: row.upvotes,
      downvotes: row.downvotes,
      score: row.score,
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

/**
 * GDPR data minimisation (Art. 5(1)(c), Art. 25): the author's activity date is
 * never published. Public responses only carry whether the author was active
 * within the last `AUTHOR_ACTIVITY.RECENT_DAYS` days (NULL for deleted authors).
 * Expects the users table to be joined as `u`.
 */
const AUTHOR_RECENTLY_ACTIVE_SQL = `CASE
    WHEN u.id IS NULL THEN NULL
    ELSE COALESCE(
      u.last_login_at >= date_trunc('day', NOW()) - make_interval(days => ${Number(AUTHOR_ACTIVITY.RECENT_DAYS)}),
      FALSE
    )
  END`;

function buildAuthorIsNewUserSql(
  userAlias: string,
  minDaysParam: string,
  minCleanParam: string,
): string {
  return `CASE
    WHEN ${userAlias}.id IS NULL OR ${userAlias}.role = 'admin' THEN FALSE
    WHEN ${userAlias}.created_at <= NOW() - make_interval(days => ${minDaysParam}::int)
      AND (
        SELECT COUNT(*)
        FROM polygons p_clean
        WHERE p_clean.user_id = ${userAlias}.id
          AND p_clean.flag_count = 0
          AND p_clean.score > 0
      ) >= ${minCleanParam}::int
      THEN FALSE
    ELSE TRUE
  END`;
}

async function querySinglePolygonById(
  db: pg.Pool | pg.PoolClient,
  polygonId: string,
  viewerUserId: string | null,
  trust: PolygonTrustConfig,
): Promise<PolygonFeature | null> {
  const res = await db.query<PolygonQueryRow>(
    `SELECT
       p.id,
       p.user_id,
       ST_AsGeoJSON(p.geom, 6) AS geom_geojson,
       p.surface_type,
       p.status,
       p.finished_at,
       p.note,
       p.area_m2,
       m.ags AS municipality_ags,
       m.name AS municipality_name,
       CASE
         WHEN p.municipality_id IS NOT NULL THEN COALESCE(
           (
             SELECT MAX(p2.score)
             FROM polygons p2
             WHERE p2.municipality_id = p.municipality_id
               AND p2.status = 'proposed'
               AND p2.score > 0
           ),
           0
         )::int
         ELSE 0
       END AS municipality_max_score,
       p.photo_count,
       p.comment_count,
       COALESCE(u.pseudonym, 'deleted') AS author_pseudonym,
       ${buildAuthorIsNewUserSql('u', '$3', '$4')} AS author_is_new_user,
       ${AUTHOR_RECENTLY_ACTIVE_SQL} AS author_recently_active,
       p.flag_count,
       CASE
         WHEN $2::uuid IS NOT NULL THEN EXISTS (
           SELECT 1
           FROM polygon_flags pf
           WHERE pf.polygon_id = p.id
             AND pf.user_id = $2::uuid
         )
         ELSE FALSE
       END AS my_flag,
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
     LEFT JOIN municipalities m ON m.id = p.municipality_id
     LEFT JOIN votes v
       ON v.polygon_id = p.id
      AND $2::uuid IS NOT NULL
      AND v.user_id = $2::uuid
     WHERE p.id = $1
     LIMIT 1`,
    [polygonId, viewerUserId, trust.minAccountDays, trust.minCleanPolygons],
  );

  const row = res.rows[0];
  return row ? mapRowToPolygonFeature(row) : null;
}

export class PolygonRepository {
  private readonly pool: pg.Pool;
  private readonly uploadsDir: string | undefined;
  private readonly trust: PolygonTrustConfig;

  constructor(
    pool: pg.Pool,
    uploadsDir?: string,
    trust: Partial<PolygonTrustConfig> = {},
  ) {
    this.pool = pool;
    this.uploadsDir = uploadsDir;
    this.trust = {
      minAccountDays:
        trust.minAccountDays ??
        TRUST_AND_MODERATION_LIMITS.NEW_USER_MIN_ACCOUNT_DAYS,
      minCleanPolygons:
        trust.minCleanPolygons ??
        TRUST_AND_MODERATION_LIMITS.NEW_USER_MIN_CLEAN_POLYGONS,
    };
  }

  public async create(params: CreatePolygonParams): Promise<PolygonFeature> {
    const minAreaM2 = params.minAreaM2 ?? GEOMETRY_LIMITS.MIN_AREA_M2;
    const maxAreaM2 = params.maxAreaM2 ?? GEOMETRY_LIMITS.MAX_AREA_M2;
    const requireJurisdiction = params.requireJurisdiction ?? 'when_seeded';
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
           ),
           metrics AS (
             SELECT
               g,
               geom_type,
               interior_rings,
               n_points,
               d,
               CASE
                 WHEN (d).valid AND geom_type = 'POLYGON' AND interior_rings = 0 AND n_points <= $2
                   THEN ST_Area(g::geography)
                 ELSE NULL
               END AS area_m2,
               CASE
                 WHEN (d).valid AND geom_type = 'POLYGON' AND interior_rings = 0 AND n_points <= $2
                   THEN ST_Perimeter(g::geography)
                 ELSE NULL
               END AS perimeter_m,
               CASE
                 WHEN (d).valid AND geom_type = 'POLYGON' AND interior_rings = 0 AND n_points <= $2
                   THEN ST_IsEmpty(ST_Buffer(g::geography, -($3::double precision))::geometry)
                 ELSE NULL
               END AS is_sliver
             FROM inspected
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
             area_m2,
             perimeter_m,
             CASE
               WHEN area_m2 IS NOT NULL AND perimeter_m IS NOT NULL AND perimeter_m > 0
                 THEN (4.0 * pi() * area_m2) / (perimeter_m * perimeter_m)
               ELSE NULL
             END AS compactness_pp,
             is_sliver
           FROM metrics`,
          [
            geoJsonInput,
            GEOMETRY_LIMITS.MAX_RING_POSITIONS,
            GEOMETRY_LIMITS.MIN_WIDTH_BUFFER_M,
          ],
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

      let finalGeoJson = geoJsonInput;
      let areaM2 = validationRow.area_m2;
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

      if (
        validationRow.compactness_pp === null ||
        validationRow.compactness_pp < GEOMETRY_LIMITS.MIN_COMPACTNESS_PP
      ) {
        throw new ApiError(
          422,
          'GEOMETRY_NOT_COMPACT',
          `Polygon shape is too thin or irregular (compactness must be at least ${GEOMETRY_LIMITS.MIN_COMPACTNESS_PP}).`,
          {
            compactnessPp: validationRow.compactness_pp,
            minCompactnessPp: GEOMETRY_LIMITS.MIN_COMPACTNESS_PP,
          },
        );
      }

      if (validationRow.is_sliver) {
        throw new ApiError(
          422,
          'GEOMETRY_SLIVER',
          `Polygon is too narrow; minimum width must exceed ${(GEOMETRY_LIMITS.MIN_WIDTH_BUFFER_M * 2).toFixed(1)} m.`,
          { minWidthMeters: GEOMETRY_LIMITS.MIN_WIDTH_BUFFER_M * 2 },
        );
      }

      // Serialize concurrent spatial writes in the same ~500m grid cell
      await client.query(
        `WITH cand AS (
           SELECT ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)) AS c
         )
         SELECT pg_advisory_xact_lock(
           hashtext(
             'poly_cell:' || floor(ST_X(c) * 200)::text || ':' || floor(ST_Y(c) * 200)::text
           )
         )
         FROM cand`,
        [finalGeoJson],
      );

      // Overlap blocking & auto-clipping against existing polygons
      const overlapRes = await client.query<{
        id: string;
        existing_area_m2: number;
        inter_area_m2: number;
      }>(
        `WITH cand AS (
           SELECT ST_ForcePolygonCCW(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)) AS g
         )
         SELECT
           p.id,
           p.area_m2 AS existing_area_m2,
           ST_Area(
             ST_CollectionExtract(ST_MakeValid(ST_Intersection(p.geom, cand.g)), 3)::geography
           ) AS inter_area_m2
         FROM polygons p, cand
         WHERE ST_Intersects(p.geom, cand.g)`,
        [finalGeoJson],
      );

      const significantOverlaps = overlapRes.rows.filter(
        (r) => Number.isFinite(r.inter_area_m2) && r.inter_area_m2 > 0.01,
      );

      if (significantOverlaps.length > 0) {
        let maxOverlapRatio = 0;
        const conflictingPolygonIds: string[] = [];
        for (const ov of significantOverlaps) {
          const denom = Math.max(0.01, Math.min(ov.existing_area_m2, areaM2));
          const ratio = ov.inter_area_m2 / denom;
          if (ratio > maxOverlapRatio) {
            maxOverlapRatio = ratio;
          }
          if (ratio >= GEOMETRY_LIMITS.OVERLAP_REJECT_RATIO) {
            conflictingPolygonIds.push(ov.id);
          }
        }

        if (maxOverlapRatio >= GEOMETRY_LIMITS.OVERLAP_REJECT_RATIO) {
          throw new ApiError(
            409,
            'POLYGON_OVERLAP',
            'This area significantly overlaps an existing unsealing proposal.',
            {
              conflictingPolygonIds,
              maxOverlapRatio: Number(maxOverlapRatio.toFixed(4)),
            },
          );
        }

        // Minor overlap (< OVERLAP_REJECT_RATIO): auto-clip against existing polygons
        const overlapIds = significantOverlaps.map((o) => o.id);
        const clipRes = await client.query<{
          clipped_geojson: string | null;
          total_parts: number;
          total_area_m2: number | null;
          largest_area_m2: number | null;
          interior_rings: number | null;
          n_points: number | null;
          is_valid: boolean | null;
          compactness_pp: number | null;
          is_sliver: boolean | null;
        }>(
          `WITH cand AS (
             SELECT ST_ForcePolygonCCW(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)) AS g
           ),
           diff AS (
             SELECT ST_CollectionExtract(
               ST_MakeValid(
                 ST_Difference(
                   cand.g,
                   (SELECT ST_UnaryUnion(ST_Collect(p.geom)) FROM polygons p WHERE p.id = ANY($2::uuid[]))
                 )
               ),
               3
             ) AS dg
             FROM cand
           ),
           parts AS (
             SELECT
               (ST_Dump(dg)).geom AS poly,
               ST_Area((ST_Dump(dg)).geom::geography) AS part_area
             FROM diff
             WHERE dg IS NOT NULL AND NOT ST_IsEmpty(dg)
           ),
           ranked AS (
             SELECT
               CASE
                 WHEN ST_NPoints(poly) > $3::int
                   THEN ST_SimplifyPreserveTopology(poly, 0.000005)
                 ELSE poly
               END AS poly,
               part_area,
               COUNT(*) OVER ()::int AS total_parts,
               SUM(part_area) OVER () AS total_area_m2,
               ROW_NUMBER() OVER (ORDER BY part_area DESC) AS rn
             FROM parts
             WHERE GeometryType(poly) = 'POLYGON'
           ),
           chosen AS (
             SELECT
               ST_ForcePolygonCCW(poly) AS poly,
               total_parts,
               total_area_m2,
               ST_Area(poly::geography) AS largest_area_m2,
               ST_Perimeter(poly::geography) AS perimeter_m
             FROM ranked
             WHERE rn = 1
           )
           SELECT
             ST_AsGeoJSON(poly, 6) AS clipped_geojson,
             total_parts,
             total_area_m2,
             largest_area_m2,
             ST_NumInteriorRings(poly) AS interior_rings,
             ST_NPoints(poly) AS n_points,
             ST_IsValid(poly) AS is_valid,
             CASE
               WHEN perimeter_m > 0 THEN (4.0 * pi() * largest_area_m2) / (perimeter_m * perimeter_m)
               ELSE 0
             END AS compactness_pp,
             ST_IsEmpty(ST_Buffer(poly::geography, -($4::double precision))::geometry) AS is_sliver
           FROM chosen`,
          [
            finalGeoJson,
            overlapIds,
            GEOMETRY_LIMITS.MAX_RING_POSITIONS,
            GEOMETRY_LIMITS.MIN_WIDTH_BUFFER_M,
          ],
        );

        const clipped = clipRes.rows[0];
        if (
          !clipped ||
          !clipped.clipped_geojson ||
          clipped.largest_area_m2 === null ||
          clipped.total_area_m2 === null ||
          clipped.interior_rings !== 0 ||
          !clipped.is_valid ||
          clipped.n_points === null ||
          clipped.n_points < GEOMETRY_LIMITS.MIN_RING_POSITIONS ||
          clipped.n_points > GEOMETRY_LIMITS.MAX_RING_POSITIONS ||
          (clipped.total_parts > 1 &&
            clipped.largest_area_m2 / Math.max(0.01, clipped.total_area_m2) < 0.9)
        ) {
          throw new ApiError(
            409,
            'POLYGON_OVERLAP',
            'Overlapping existing proposals splits or invalidates this polygon; please outline the remaining area directly.',
            { conflictingPolygonIds: overlapIds },
          );
        }

        if (clipped.largest_area_m2 < minAreaM2 || clipped.largest_area_m2 > maxAreaM2) {
          throw new ApiError(
            422,
            'AREA_OUT_OF_BOUNDS',
            `Remaining non-overlapping area (${clipped.largest_area_m2.toFixed(1)} m²) must be between ${minAreaM2} m² and ${maxAreaM2} m².`,
            { areaM2: clipped.largest_area_m2, minAreaM2, maxAreaM2 },
          );
        }
        if (
          clipped.compactness_pp === null ||
          clipped.compactness_pp < GEOMETRY_LIMITS.MIN_COMPACTNESS_PP
        ) {
          throw new ApiError(
            422,
            'GEOMETRY_NOT_COMPACT',
            'Remaining non-overlapping polygon shape is too thin or irregular.',
            { compactnessPp: clipped.compactness_pp },
          );
        }
        if (clipped.is_sliver) {
          throw new ApiError(
            422,
            'GEOMETRY_SLIVER',
            'Remaining non-overlapping polygon is too narrow.',
          );
        }

        finalGeoJson = clipped.clipped_geojson;
        areaM2 = clipped.largest_area_m2;
      }

      // Spatial clustering cap (micro-spam prevention within radius & rolling window)
      const clusterRes = await client.query<{
        user_cluster_count: number;
        global_cluster_count: number;
      }>(
        `WITH cand AS (
           SELECT ST_PointOnSurface(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)) AS pt
         )
         SELECT
           COUNT(*) FILTER (WHERE p.user_id = $2::uuid)::int AS user_cluster_count,
           COUNT(*)::int AS global_cluster_count
         FROM polygons p, cand
         WHERE p.created_at > NOW() - make_interval(hours => $3::int)
           AND ST_DWithin(p.geom::geography, cand.pt::geography, $4::double precision)`,
        [
          finalGeoJson,
          params.userId,
          GEOMETRY_LIMITS.CLUSTER_WINDOW_HOURS,
          GEOMETRY_LIMITS.CLUSTER_RADIUS_M,
        ],
      );
      const userClusterCount = clusterRes.rows[0]?.user_cluster_count ?? 0;
      const globalClusterCount = clusterRes.rows[0]?.global_cluster_count ?? 0;
      if (
        userClusterCount >= GEOMETRY_LIMITS.CLUSTER_MAX_PER_USER ||
        globalClusterCount >= GEOMETRY_LIMITS.CLUSTER_MAX_GLOBAL
      ) {
        throw new ApiError(
          429,
          'SPATIAL_CLUSTER_LIMIT',
          `Too many recent proposals within ${GEOMETRY_LIMITS.CLUSTER_RADIUS_M} m; please combine adjacent surfaces or retry later.`,
          {
            radiusMeters: GEOMETRY_LIMITS.CLUSTER_RADIUS_M,
            windowHours: GEOMETRY_LIMITS.CLUSTER_WINDOW_HOURS,
            userClusterCount,
            globalClusterCount,
          },
        );
      }

      // Jurisdiction lookup & enforcement
      const muniRes = await client.query<{
        municipality_id: number | null;
        has_any_municipalities: boolean;
      }>(
        `WITH cand AS (
           SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS g
         )
         SELECT
           (
             SELECT m.id
             FROM municipalities m
             WHERE ST_Covers(m.geom, ST_PointOnSurface(cand.g))
             LIMIT 1
           ) AS municipality_id,
           EXISTS (SELECT 1 FROM municipalities LIMIT 1) AS has_any_municipalities
         FROM cand`,
        [finalGeoJson],
      );
      const matchedMuniId = muniRes.rows[0]?.municipality_id ?? null;
      const hasAnyMunicipalities =
        muniRes.rows[0]?.has_any_municipalities ?? false;

      if (
        matchedMuniId === null &&
        (requireJurisdiction === 'strict' ||
          (requireJurisdiction === 'when_seeded' && hasAnyMunicipalities))
      ) {
        throw new ApiError(
          422,
          'OUTSIDE_JURISDICTION',
          'Polygon lies outside the supported municipal boundaries.',
        );
      }

      // OSM / ALKIS land-cover exclusion validation
      const landCoverRes = await client.query<{
        category: string;
        sources: string[];
        excluded_area_m2: number;
      }>(
        `WITH cand AS (
           SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS g
         )
         SELECT
           lce.category,
           ARRAY_AGG(DISTINCT lce.source) AS sources,
           ST_Area(
             ST_CollectionExtract(
               ST_MakeValid(ST_Intersection(cand.g, ST_UnaryUnion(ST_Collect(lce.geom)))),
               3
             )::geography
           ) AS excluded_area_m2
         FROM cand
         INNER JOIN land_cover_exclusions lce ON ST_Intersects(lce.geom, cand.g)
         GROUP BY lce.category, cand.g`,
        [finalGeoJson],
      );

      for (const lcRow of landCoverRes.rows) {
        const cat = lcRow.category as LandCoverCategory;
        const maxRatio = LAND_COVER_MAX_OVERLAP_RATIO[cat] ?? 0.5;
        const overlapRatio = lcRow.excluded_area_m2 / Math.max(0.01, areaM2);
        if (overlapRatio >= maxRatio) {
          throw new ApiError(
            422,
            'LAND_COVER_EXCLUDED',
            `Polygon overlaps excluded ${cat.replace('_', '/')} land cover (${(overlapRatio * 100).toFixed(0)}%).`,
            {
              category: cat,
              sources: lcRow.sources,
              overlapRatio: Number(overlapRatio.toFixed(4)),
              maxAllowedRatio: maxRatio,
            },
          );
        }
      }

      const insertRes = await client.query<{ id: string }>(
        `WITH prepared AS (
           SELECT ST_ForcePolygonCCW(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)) AS geom
         )
         INSERT INTO polygons (
           user_id,
           geom,
           surface_type,
           note,
           area_m2,
           municipality_id
         )
         SELECT
           $1,
           prepared.geom,
           $3,
           $4,
           $5,
           $6
         FROM prepared
         RETURNING id`,
        [
          params.userId,
          finalGeoJson,
          params.surfaceType,
          normalizedNote,
          areaM2,
          matchedMuniId,
        ],
      );

      const insertedId = insertRes.rows[0]?.id;
      if (!insertedId) {
        throw new ApiError(500, 'INTERNAL_ERROR', 'Failed to persist polygon.');
      }

      await client.query(
        'INSERT INTO polygon_creations (user_id) VALUES ($1)',
        [params.userId],
      );

      const createdFeature = await querySinglePolygonById(
        client,
        insertedId,
        params.userId,
        this.trust,
      );
      if (!createdFeature) {
        throw new ApiError(500, 'INTERNAL_ERROR', 'Failed to load created polygon.');
      }

      await client.query('COMMIT');
      return createdFeature;
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
    const filter: PolygonFilter = params.filter ?? 'all';
    const authorIsNewSql = buildAuthorIsNewUserSql('u', '$7', '$8');

    const res = await this.pool.query<PolygonQueryRow>(
      `WITH bbox_polys AS (
         SELECT
           p.id,
           p.user_id,
           ST_AsGeoJSON(p.geom, 6) AS geom_geojson,
           p.surface_type,
           p.status,
           p.finished_at,
           p.note,
           p.area_m2,
           p.municipality_id,
           m.ags AS municipality_ags,
           m.name AS municipality_name,
           p.photo_count,
           p.comment_count,
           COALESCE(u.pseudonym, 'deleted') AS author_pseudonym,
           ${authorIsNewSql} AS author_is_new_user,
           ${AUTHOR_RECENTLY_ACTIVE_SQL} AS author_recently_active,
           p.flag_count,
           CASE
             WHEN $5::uuid IS NOT NULL THEN EXISTS (
               SELECT 1
               FROM polygon_flags pf
               WHERE pf.polygon_id = p.id
                 AND pf.user_id = $5::uuid
             )
             ELSE FALSE
           END AS my_flag,
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
         LEFT JOIN municipalities m ON m.id = p.municipality_id
         LEFT JOIN votes v
           ON v.polygon_id = p.id
          AND $5::uuid IS NOT NULL
          AND v.user_id = $5::uuid
         WHERE ST_Intersects(
           p.geom,
           ST_MakeEnvelope($1, $2, $3, $4, 4326)
         )
           AND (
             $9::text = 'all'
             OR ($9::text = 'new' AND p.created_at > NOW() - INTERVAL '7 days')
             OR ($9::text = 'established' AND p.created_at <= NOW() - INTERVAL '7 days')
             OR ($9::text = 'needs_review' AND p.score = 0 AND p.upvotes = 0 AND p.downvotes = 0)
           )
         ORDER BY p.score DESC, p.created_at DESC, p.id ASC
         LIMIT $6
       ),
       muni_stats AS (
         SELECT
           p2.municipality_id,
           COALESCE(
             MAX(p2.score) FILTER (WHERE p2.status = 'proposed' AND p2.score > 0),
             0
           )::int AS max_score
         FROM polygons p2
         WHERE p2.municipality_id IN (
           SELECT DISTINCT bp.municipality_id
           FROM bbox_polys bp
           WHERE bp.municipality_id IS NOT NULL
         )
         GROUP BY p2.municipality_id
       )
       SELECT
         bp.id,
         bp.user_id,
         bp.geom_geojson,
         bp.surface_type,
         bp.status,
         bp.finished_at,
         bp.note,
         bp.area_m2,
         bp.municipality_ags,
         bp.municipality_name,
         COALESCE(ms.max_score, 0)::int AS municipality_max_score,
         bp.photo_count,
         bp.comment_count,
         bp.author_pseudonym,
         bp.author_is_new_user,
         bp.author_recently_active,
         bp.flag_count,
         bp.my_flag,
         bp.upvotes,
         bp.downvotes,
         bp.score,
         bp.my_vote,
         bp.is_author,
         bp.created_at,
         bp.updated_at
       FROM bbox_polys bp
       LEFT JOIN muni_stats ms ON ms.municipality_id = bp.municipality_id
       ORDER BY bp.score DESC, bp.created_at DESC, bp.id ASC`,
      [
        params.bbox.minLng,
        params.bbox.minLat,
        params.bbox.maxLng,
        params.bbox.maxLat,
        params.viewerUserId,
        queryLimit,
        this.trust.minAccountDays,
        this.trust.minCleanPolygons,
        filter,
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
    return querySinglePolygonById(
      this.pool,
      polygonId,
      viewerUserId,
      this.trust,
    );
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

      await client.query(
        `UPDATE polygons
         SET
           surface_type = $2,
           note = $3,
           updated_at = NOW()
         WHERE id = $1`,
        [params.polygonId, nextSurfaceType, nextNote],
      );

      const updated = await querySinglePolygonById(
        client,
        params.polygonId,
        params.userId,
        this.trust,
      );
      if (!updated) {
        throw new ApiError(404, 'NOT_FOUND', 'Polygon not found.');
      }

      await client.query('COMMIT');
      return updated;
    } catch (err: unknown) {
      await rollbackPreservingError(client, err);
      throw err;
    } finally {
      client.release();
    }
  }

  public async setStatus(params: SetPolygonStatusParams): Promise<PolygonFeature> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await lockUserForWrite(client, params.adminUserId);

      const lockRes = await client.query<{ id: string }>(
        'SELECT id FROM polygons WHERE id = $1 FOR UPDATE',
        [params.polygonId],
      );
      if (lockRes.rowCount === 0) {
        throw new ApiError(404, 'NOT_FOUND', 'Polygon not found.');
      }

      await client.query(
        `UPDATE polygons
         SET
           status = $2,
           finished_at = CASE
             WHEN $2 = 'finished' THEN COALESCE(finished_at, NOW())
             ELSE NULL
           END,
           finished_by = CASE
             WHEN $2 = 'finished' THEN $3::uuid
             ELSE NULL
           END,
           updated_at = NOW()
         WHERE id = $1`,
        [params.polygonId, params.status, params.adminUserId],
      );

      const updated = await querySinglePolygonById(
        client,
        params.polygonId,
        params.adminUserId,
        this.trust,
      );
      if (!updated) {
        throw new ApiError(404, 'NOT_FOUND', 'Polygon not found.');
      }

      await client.query('COMMIT');
      return updated;
    } catch (err: unknown) {
      await rollbackPreservingError(client, err);
      throw err;
    } finally {
      client.release();
    }
  }

  public async flagPolygon(
    params: FlagPolygonParams,
  ): Promise<FlagPolygonResponse> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await lockUserForWrite(client, params.userId);

      const lockRes = await client.query<{ id: string; user_id: string | null }>(
        `SELECT id, user_id
         FROM polygons
         WHERE id = $1
         FOR UPDATE`,
        [params.polygonId],
      );
      const existing = lockRes.rows[0];
      if (!existing) {
        throw new ApiError(404, 'NOT_FOUND', 'Polygon not found.');
      }
      if (existing.user_id !== null && existing.user_id === params.userId) {
        throw new ApiError(
          422,
          'FORBIDDEN_SELF_FLAG',
          'You cannot flag your own polygon proposal.',
        );
      }

      const normalizedNote = normalizeNote(params.note);
      await client.query(
        `INSERT INTO polygon_flags (polygon_id, user_id, reason, note)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (polygon_id, user_id)
         DO UPDATE SET
           reason = EXCLUDED.reason,
           note = EXCLUDED.note,
           created_at = NOW()`,
        [params.polygonId, params.userId, params.reason, normalizedNote],
      );

      const countRes = await client.query<{ flag_count: number }>(
        `UPDATE polygons p
         SET flag_count = (
           SELECT COUNT(*)::int FROM polygon_flags pf WHERE pf.polygon_id = p.id
         )
         WHERE p.id = $1
         RETURNING p.flag_count`,
        [params.polygonId],
      );
      const flagCount = Math.max(0, Number(countRes.rows[0]?.flag_count ?? 0));

      await client.query('COMMIT');
      return {
        polygonId: params.polygonId,
        flagCount,
        isFlagged: flagCount > 0,
        myFlag: true,
        myFlagReason: params.reason,
      };
    } catch (err: unknown) {
      await rollbackPreservingError(client, err);
      throw err;
    } finally {
      client.release();
    }
  }

  public async unflagPolygon(
    params: UnflagPolygonParams,
  ): Promise<FlagPolygonResponse> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await lockUserForWrite(client, params.userId);

      const lockRes = await client.query<{ id: string }>(
        'SELECT id FROM polygons WHERE id = $1 FOR UPDATE',
        [params.polygonId],
      );
      if (lockRes.rowCount === 0) {
        throw new ApiError(404, 'NOT_FOUND', 'Polygon not found.');
      }

      await client.query(
        'DELETE FROM polygon_flags WHERE polygon_id = $1 AND user_id = $2',
        [params.polygonId, params.userId],
      );

      const countRes = await client.query<{ flag_count: number }>(
        `UPDATE polygons p
         SET flag_count = (
           SELECT COUNT(*)::int FROM polygon_flags pf WHERE pf.polygon_id = p.id
         )
         WHERE p.id = $1
         RETURNING p.flag_count`,
        [params.polygonId],
      );
      const flagCount = Math.max(0, Number(countRes.rows[0]?.flag_count ?? 0));

      await client.query('COMMIT');
      return {
        polygonId: params.polygonId,
        flagCount,
        isFlagged: flagCount > 0,
        myFlag: false,
        myFlagReason: null,
      };
    } catch (err: unknown) {
      await rollbackPreservingError(client, err);
      throw err;
    } finally {
      client.release();
    }
  }

  public async clearFlagsAsAdmin(
    params: ClearPolygonFlagsParams,
  ): Promise<FlagPolygonResponse> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await lockUserForWrite(client, params.adminUserId);

      const lockRes = await client.query<{ id: string }>(
        'SELECT id FROM polygons WHERE id = $1 FOR UPDATE',
        [params.polygonId],
      );
      if (lockRes.rowCount === 0) {
        throw new ApiError(404, 'NOT_FOUND', 'Polygon not found.');
      }

      await client.query('DELETE FROM polygon_flags WHERE polygon_id = $1', [
        params.polygonId,
      ]);
      await client.query(
        'UPDATE polygons SET flag_count = 0 WHERE id = $1',
        [params.polygonId],
      );

      await client.query('COMMIT');
      return {
        polygonId: params.polygonId,
        flagCount: 0,
        isFlagged: false,
        myFlag: false,
        myFlagReason: null,
      };
    } catch (err: unknown) {
      await rollbackPreservingError(client, err);
      throw err;
    } finally {
      client.release();
    }
  }

  public async pruneStaleUnratedPolygons(
    retentionDays: number = TRUST_AND_MODERATION_LIMITS.STALE_UNRATED_PRUNE_DAYS,
  ): Promise<PruneStalePolygonsResult> {
    const safeDays = Math.max(1, Math.trunc(retentionDays));
    const client = await this.pool.connect();
    let photoFilesToDelete: Array<{ file_name: string; thumb_name: string }> = [];
    let deletedIds: string[] = [];

    try {
      await client.query('BEGIN');

      const lockRes = await client.query<{ id: string }>(
        `SELECT id
         FROM polygons
         WHERE status = 'proposed'
           AND upvotes = 0
           AND downvotes = 0
           AND created_at < NOW() - make_interval(days => $1::int)
         FOR UPDATE SKIP LOCKED`,
        [safeDays],
      );
      deletedIds = lockRes.rows.map((r) => r.id);

      if (deletedIds.length > 0) {
        const photosRes = await client.query<{
          file_name: string;
          thumb_name: string;
        }>(
          'SELECT file_name, thumb_name FROM polygon_photos WHERE polygon_id = ANY($1::uuid[])',
          [deletedIds],
        );
        photoFilesToDelete = photosRes.rows;

        await client.query(
          'DELETE FROM polygons WHERE id = ANY($1::uuid[])',
          [deletedIds],
        );
      }

      await client.query('COMMIT');
    } catch (err: unknown) {
      await rollbackPreservingError(client, err);
      throw err;
    } finally {
      client.release();
    }

    if (this.uploadsDir && photoFilesToDelete.length > 0) {
      for (const pf of photoFilesToDelete) {
        await fs
          .unlink(path.join(this.uploadsDir, pf.file_name))
          .catch(() => undefined);
        await fs
          .unlink(path.join(this.uploadsDir, pf.thumb_name))
          .catch(() => undefined);
      }
    }

    return {
      deletedCount: deletedIds.length,
      deletedIds,
    };
  }

  public async importBatch(
    params: ImportPolygonsParams,
  ): Promise<ImportPolygonsResponse> {
    const minAreaM2 = params.minAreaM2 ?? GEOMETRY_LIMITS.MIN_AREA_M2;
    const maxAreaM2 = params.maxAreaM2 ?? IMPORT_LIMITS.MAX_AREA_M2;
    const errors = [...params.dataset.preErrors];
    let importedCount = 0;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await lockUserForWrite(client, params.adminUserId);

      for (const candidate of params.dataset.candidates) {
        await client.query('SAVEPOINT import_item');
        try {
          const sourceExpr =
            candidate.kind === 'wkb'
              ? 'ST_GeomFromWKB($1::bytea, $2::int)'
              : 'ST_SetSRID(ST_GeomFromGeoJSON($1::text), $2::int)';
          const rawValue =
            candidate.kind === 'wkb'
              ? candidate.wkb!
              : candidate.geoJsonGeometry!;

          const dumpRes = await client.query<{
            poly_wkb: Buffer;
            interior_rings: number;
            n_points: number;
            is_valid: boolean;
            invalid_reason: string | null;
            area_m2: number | null;
            span_ok: boolean;
          }>(
            `WITH src AS (
               SELECT ST_Force2D(${sourceExpr}) AS g
             ),
             reproj AS (
               SELECT CASE
                 WHEN $6::text IS NOT NULL THEN ST_Transform(ST_SetSRID(g, 0), $6::text, 4326)
                 WHEN $2::int = 4326 THEN g
                 ELSE ST_Transform(g, 4326)
               END AS g4326
               FROM src
             ),
             dumped AS (
               SELECT (ST_Dump(ST_CollectionExtract(ST_MakeValid(g4326), 3))).geom AS poly
               FROM reproj
             ),
             simplified AS (
               SELECT CASE
                 WHEN ST_NPoints(poly) > $3::int
                   THEN ST_SimplifyPreserveTopology(poly, 0.00001)
                 ELSE poly
               END AS poly
               FROM dumped
             ),
             exterior_only AS (
               SELECT ST_MakePolygon(ST_ExteriorRing(poly)) AS poly,
                      ST_NumInteriorRings(poly) AS orig_holes
               FROM simplified
               WHERE GeometryType(poly) = 'POLYGON'
             )
             SELECT
               ST_AsBinary(ST_ForcePolygonCCW(poly)) AS poly_wkb,
               orig_holes AS interior_rings,
               ST_NPoints(poly) AS n_points,
               ST_IsValid(poly) AS is_valid,
               ST_IsValidReason(poly) AS invalid_reason,
               CASE
                 WHEN ST_IsValid(poly) THEN ST_Area(poly::geography)
                 ELSE NULL
               END AS area_m2,
               (
                 (ST_XMax(poly) - ST_XMin(poly)) <= $4::double precision
                 AND (ST_YMax(poly) - ST_YMin(poly)) <= $4::double precision
                 AND ABS(ST_YMax(poly)) <= $5::double precision
                 AND ABS(ST_YMin(poly)) <= $5::double precision
               ) AS span_ok
             FROM exterior_only`,
            [
              rawValue,
              candidate.srid,
              GEOMETRY_LIMITS.MAX_RING_POSITIONS,
              GEOMETRY_LIMITS.MAX_POLYGON_SPAN_DEG,
              GEOMETRY_LIMITS.MAX_ABS_LAT,
              candidate.srsWkt ?? null,
            ],
          );

          if (dumpRes.rows.length === 0) {
            await client.query('ROLLBACK TO SAVEPOINT import_item');
            errors.push({
              featureIndex: candidate.featureIndex,
              reason: 'Geometry did not produce any valid polygon part.',
            });
            continue;
          }

          let featureInsertedAny = false;
          for (const part of dumpRes.rows) {
            if (
              !part.is_valid ||
              part.n_points < GEOMETRY_LIMITS.MIN_RING_POSITIONS ||
              part.n_points > GEOMETRY_LIMITS.MAX_RING_POSITIONS
            ) {
              errors.push({
                featureIndex: candidate.featureIndex,
                reason:
                  part.invalid_reason && part.invalid_reason !== 'Valid Geometry'
                    ? part.invalid_reason
                    : `Polygon has ${part.n_points} positions (must be 4..${GEOMETRY_LIMITS.MAX_RING_POSITIONS}).`,
              });
              continue;
            }
            if (!part.span_ok) {
              errors.push({
                featureIndex: candidate.featureIndex,
                reason: `Polygon span exceeds ${GEOMETRY_LIMITS.MAX_POLYGON_SPAN_DEG}° or ±${GEOMETRY_LIMITS.MAX_ABS_LAT}° latitude.`,
              });
              continue;
            }
            if (
              part.area_m2 === null ||
              !Number.isFinite(part.area_m2) ||
              part.area_m2 < minAreaM2 ||
              part.area_m2 > maxAreaM2
            ) {
              errors.push({
                featureIndex: candidate.featureIndex,
                reason: `Polygon area (${part.area_m2 !== null ? part.area_m2.toFixed(1) : 'N/A'} m²) outside [${minAreaM2}, ${maxAreaM2}] m².`,
              });
              continue;
            }

            await client.query(
              `WITH prepared AS (
                 SELECT ST_SetSRID(ST_GeomFromWKB($2::bytea), 4326) AS geom
               )
               INSERT INTO polygons (
                 user_id,
                 geom,
                 surface_type,
                 note,
                 area_m2,
                 municipality_id
               )
               SELECT
                 $1,
                 prepared.geom,
                 $3,
                 $4,
                 $5,
                 (
                   SELECT m.id
                   FROM municipalities m
                   WHERE ST_Covers(m.geom, ST_PointOnSurface(prepared.geom))
                   LIMIT 1
                 )
               FROM prepared`,
              [
                params.adminUserId,
                part.poly_wkb,
                candidate.surfaceType,
                candidate.note,
                part.area_m2,
              ],
            );
            importedCount += 1;
            featureInsertedAny = true;
          }

          if (!featureInsertedAny) {
            await client.query('ROLLBACK TO SAVEPOINT import_item');
          } else {
            await client.query('RELEASE SAVEPOINT import_item');
          }
        } catch (itemErr: unknown) {
          await client.query('ROLLBACK TO SAVEPOINT import_item');
          errors.push({
            featureIndex: candidate.featureIndex,
            reason:
              itemErr instanceof Error
                ? itemErr.message.slice(0, 200)
                : 'Geometry import failed.',
          });
        }
      }

      await client.query('COMMIT');
    } catch (err: unknown) {
      await rollbackPreservingError(client, err);
      throw err;
    } finally {
      client.release();
    }

    return {
      format: params.dataset.format,
      importedCount,
      skippedCount: errors.length,
      errors,
    };
  }

  public async delete(polygonId: string, userId: string): Promise<void> {
    const client = await this.pool.connect();
    let photoFilesToDelete: Array<{ file_name: string; thumb_name: string }> = [];
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

      const photosRes = await client.query<{
        file_name: string;
        thumb_name: string;
      }>(
        'SELECT file_name, thumb_name FROM polygon_photos WHERE polygon_id = $1',
        [polygonId],
      );
      photoFilesToDelete = photosRes.rows;

      await client.query('DELETE FROM polygons WHERE id = $1', [polygonId]);
      await client.query('COMMIT');
    } catch (err: unknown) {
      await rollbackPreservingError(client, err);
      throw err;
    } finally {
      client.release();
    }

    if (this.uploadsDir && photoFilesToDelete.length > 0) {
      for (const pf of photoFilesToDelete) {
        await fs
          .unlink(path.join(this.uploadsDir, pf.file_name))
          .catch(() => undefined);
        await fs
          .unlink(path.join(this.uploadsDir, pf.thumb_name))
          .catch(() => undefined);
      }
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

      const baseCte = cursor
        ? `WITH batch AS (
             SELECT
               p.id,
               ST_AsGeoJSON(p.geom, 6) AS geom_geojson,
               p.surface_type,
               p.status,
               p.finished_at,
               p.note,
               p.area_m2,
               p.municipality_id,
               m.ags AS municipality_ags,
               m.name AS municipality_name,
               p.photo_count,
               p.comment_count,
               p.flag_count,
               p.upvotes,
               p.downvotes,
               p.score,
               p.created_at,
               p.updated_at,
               p.created_at::text AS cursor_created_at
             FROM polygons p
             LEFT JOIN municipalities m ON m.id = p.municipality_id
             WHERE (p.created_at, p.id) > ($1::timestamptz, $2::uuid)
             ORDER BY p.created_at ASC, p.id ASC
             LIMIT $3
           )`
        : `WITH batch AS (
             SELECT
               p.id,
               ST_AsGeoJSON(p.geom, 6) AS geom_geojson,
               p.surface_type,
               p.status,
               p.finished_at,
               p.note,
               p.area_m2,
               p.municipality_id,
               m.ags AS municipality_ags,
               m.name AS municipality_name,
               p.photo_count,
               p.comment_count,
               p.flag_count,
               p.upvotes,
               p.downvotes,
               p.score,
               p.created_at,
               p.updated_at,
               p.created_at::text AS cursor_created_at
             FROM polygons p
             LEFT JOIN municipalities m ON m.id = p.municipality_id
             ORDER BY p.created_at ASC, p.id ASC
             LIMIT $1
           )`;

      const tailSql = `,
        muni_stats AS (
          SELECT
            p2.municipality_id,
            COALESCE(MAX(p2.score) FILTER (WHERE p2.status = 'proposed' AND p2.score > 0), 0)::int AS max_score
          FROM polygons p2
          WHERE p2.municipality_id IN (
            SELECT DISTINCT b.municipality_id FROM batch b WHERE b.municipality_id IS NOT NULL
          )
          GROUP BY p2.municipality_id
        )
        SELECT
          b.*,
          COALESCE(ms.max_score, 0)::int AS municipality_max_score
        FROM batch b
        LEFT JOIN muni_stats ms ON ms.municipality_id = b.municipality_id
        ORDER BY b.created_at ASC, b.id ASC`;

      const res = cursor
        ? await client.query<ExportPolygonRow>(baseCte + tailSql, [
            cursor.createdAtRaw,
            cursor.id,
            batchSize,
          ])
        : await client.query<ExportPolygonRow>(baseCte + tailSql, [batchSize]);

      await client.query('COMMIT');

      const features = res.rows.map((row) => mapExportRowToExportFeature(row));
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
