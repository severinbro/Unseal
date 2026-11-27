// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 OpenUnseal Contributors

import fs from 'node:fs/promises';
import path from 'node:path';

import {
  AUTHOR_ACTIVITY,
  ApiError,
  CLUSTER_LIMITS,
  FEED_LIMITS,
  GEOMETRY_LIMITS,
  HELP_WANTED_DAYS,
  IMPORT_LIMITS,
  LAND_COVER_MAX_OVERLAP_RATIO,
  PHOTO_LIMITS,
  POLYGON_ORIGINS,
  POLYGON_STATUSES,
  STORED_SPACE_TYPES,
  SURFACE_TYPES,
  SPACE_VERIFICATION_SOURCES,
  SPACE_VERIFICATION_STATUSES,
  TRUST_AND_MODERATION_LIMITS,
  computeMunicipalityNormalizedScore,
  type BboxBounds,
  type CreatePolygonRequest,
  type ExportPolygonFeature,
  type FeedActivity,
  type FlagPolygonResponse,
  type ImportPolygonsResponse,
  type LandCoverCategory,
  type PersonalStatsResponse,
  type PolygonClusterResponse,
  type PolygonFeature,
  type PolygonFilter,
  type PolygonFlagReason,
  type PolygonOrigin,
  type PolygonStatus,
  type PublicStatsResponse,
  type SpaceBreakdown,
  type SpaceFilter,
  type SpaceType,
  type SpaceVerification,
  type SpaceVerificationSource,
  type SpaceZoneCollection,
  type StoredSpaceType,
  type SurfaceType,
} from '@openunseal/shared';

import { lockUserForWrite } from '../db/integrity.js';
import { decodeTimeCursor, encodeTimeCursor } from '../util/timeCursor.js';
import {
  recordTelemetryBestEffort,
  recordTelemetryCounter,
} from '../db/telemetry.js';
import type { ExtractedImportDataset } from './gpkgReader.js';
import {
  type SpaceClassification,
  type SpaceClassifier,
} from './spaceClassifier.js';
import {
  OSM_ZONE_ATTRIBUTION,
  listZoneAttributions,
  overlayToFeatures,
} from './spaceZones.js';
import {
  computeMercatorSpacingMeters,
  mergeClusterCells,
  resolveClusterMode,
  resolveClusterZoomBucket,
} from './clusters.js';

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
  origin?: PolygonOrigin | undefined;
  maxDailyPolygonsPerUser: number;
  minAreaM2?: number | undefined;
  maxAreaM2?: number | undefined;
  requireJurisdiction?: 'when_seeded' | 'strict' | 'off' | undefined;
  spaceType?: SpaceType | undefined;
  openForPublicAccess?: boolean | undefined;
  allowChatContact?: boolean | undefined;
  helpWanted?: boolean | undefined;
  entitlementConfirmed?: boolean | undefined;
  classifier?: SpaceClassifier | undefined;
}

export type ClassifyGeometryParams = Pick<
  CreatePolygonParams,
  'userId' | 'geometry' | 'minAreaM2' | 'maxAreaM2' | 'requireJurisdiction'
> & { classifier: SpaceClassifier };

interface PreparedCandidate {
  finalGeoJson: string;
  areaM2: number;
  wasAutoClipped: boolean;
  clippedAreaM2: number;
  matchedMuniId: number | null;
}

export interface SetPolygonSpaceTypeParams {
  polygonId: string;
  adminUserId: string | null;
  spaceType: SpaceType;
}

export interface FeedParams {
  viewerUserId: string | null;
  limit: number;
  cursor?: string | undefined;
  filter: PolygonFilter;
  spaceFilter: SpaceFilter;
  citizenOnly: boolean;
  /** Narrows the feed to a map section. */
  bbox?: BboxBounds | undefined;
  /** Narrows the feed to one municipality (AGS). */
  ags?: string | undefined;
}

export interface FeedEntry {
  feature: PolygonFeature;
  activity: FeedActivity;
  activityAt: string;
}

export interface ListPolygonsByBboxParams {
  bbox: BboxBounds;
  viewerUserId: string | null;
  limit?: number | undefined;
  filter?: PolygonFilter | undefined;
  spaceFilter?: SpaceFilter | undefined;
}

export interface ListPolygonClustersParams {
  bbox: BboxBounds;
  zoom: number;
  viewerUserId: string | null;
  filter?: PolygonFilter | undefined;
  spaceFilter?: SpaceFilter | undefined;
  mineOnly?: boolean | undefined;
}

export interface FlagPolygonParams {
  polygonId: string;
  userId: string;
  actorIsAdmin?: boolean | undefined;
  reason: PolygonFlagReason;
  note?: string | null | undefined;
}

export interface UnflagPolygonParams {
  polygonId: string;
  userId: string;
  actorIsAdmin?: boolean | undefined;
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
  openForPublicAccess?: boolean | undefined;
  allowChatContact?: boolean | undefined;
  helpWanted?: boolean | undefined;
  entitlementConfirmed?: boolean | undefined;
}

export interface SetPolygonStatusParams {
  polygonId: string;
  actorUserId: string;
  actorIsAdmin: boolean;
  status: PolygonStatus;
  entitlementConfirmed?: boolean | undefined;
}

export interface ImportAttributionMetadata {
  license: string;
  attributionText: string;
  sourceUrl?: string | null | undefined;
  waiverConfirmed?: boolean | undefined;
}

export interface ActiveImportAttribution {
  license: string;
  attributionText: string;
  sourceUrl: string | null;
  waiverConfirmed: boolean;
}

export interface DeletedTargetAuthorInfo {
  deletedByAdmin: boolean;
  authorEmail: string | null;
  authorPseudonym: string | null;
}

export interface ImportPolygonsParams {
  adminUserId: string;
  dataset: ExtractedImportDataset;
  origin?: PolygonOrigin | undefined;
  importAttribution?: ImportAttributionMetadata | null | undefined;
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
  origin: string;
  was_auto_clipped: boolean;
  clipped_area_m2: number;
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
  space_type: string;
  space_verification: string;
  open_for_public_access: boolean;
  can_message_author: boolean;
  is_privileged_viewer: boolean;
  detected_space_type: string;
  private_overlap_ratio: number | null;
  space_verification_source: string | null;
  allow_chat_contact: boolean;
  help_wanted: boolean;
  help_wanted_until: Date | null;
  entitlement_confirmed: boolean;
  created_at: Date;
  updated_at: Date;
}

interface ExportPolygonRow {
  id: string;
  geom_geojson: string;
  surface_type: string;
  status: string;
  origin: string;
  was_auto_clipped: boolean;
  clipped_area_m2: number;
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
  space_type: string;
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
  space_type: string;
  open_for_public_access: boolean;
  allow_chat_contact: boolean;
  help_wanted_active: boolean;
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

function coercePolygonOrigin(raw: string): PolygonOrigin {
  return (POLYGON_ORIGINS as readonly string[]).includes(raw)
    ? (raw as PolygonOrigin)
    : 'citizen';
}

function oneOf<T extends string>(
  allowed: readonly T[],
  raw: string | null,
  fallback: T,
): T {
  return raw !== null && (allowed as readonly string[]).includes(raw)
    ? (raw as T)
    : fallback;
}

/** Consequential statements about private ground need an explicit confirmation. */
function assertEntitlement(
  wantsOwnerFlags: boolean,
  entitlementConfirmed: boolean | undefined,
): void {
  if (wantsOwnerFlags && entitlementConfirmed !== true) {
    throw new ApiError(
      422,
      'ENTITLEMENT_REQUIRED',
      'Please confirm that you own this parcel or are entitled to make this statement.',
    );
  }
}

/** A call for help only counts on private ground that is not unsealed yet. */
const HELP_WANTED_SQL = `(
    p.space_type = 'private'
    AND p.status <> 'finished'
    AND p.help_wanted_until IS NOT NULL
    AND p.help_wanted_until > NOW()
  )`;

const FILTER_SQL = (filterParam: string, spaceParam: string): string => `(
    ${filterParam}::text = 'all'
    OR (${filterParam}::text = 'new' AND p.created_at > NOW() - INTERVAL '7 days')
    OR (${filterParam}::text = 'established' AND p.created_at <= NOW() - INTERVAL '7 days')
    OR (${filterParam}::text = 'in_progress' AND p.status = 'in_progress')
    OR (${filterParam}::text = 'finished' AND p.status = 'finished')
    OR (${filterParam}::text = 'help_wanted' AND ${HELP_WANTED_SQL})
    OR (${filterParam}::text = 'needs_review' AND (
      p.space_verification = 'user_override'
      OR (p.status = 'proposed' AND p.score = 0 AND p.upvotes = 0 AND p.downvotes = 0)
    ))
  )
  AND (${spaceParam}::text = 'all' OR p.space_type = ${spaceParam}::text)`;

/**
 * `can_message_author` is computed per viewer so that neither the account-wide
 * opt-in nor the per-parcel opt-in becomes public information.
 */
function buildSpaceColumnsSql(viewerParam: string): string {
  return `p.space_type,
       p.space_verification,
       p.open_for_public_access,
       p.detected_space_type,
       p.private_overlap_ratio,
       p.space_verification_source,
       p.allow_chat_contact,
       ${HELP_WANTED_SQL} AS help_wanted,
       p.help_wanted_until,
       (p.entitlement_confirmed_at IS NOT NULL) AS entitlement_confirmed,
       COALESCE(
         ${viewerParam}::uuid IS NOT NULL AND (
           p.user_id = ${viewerParam}::uuid
           OR EXISTS (
             SELECT 1 FROM users u_priv
             WHERE u_priv.id = ${viewerParam}::uuid AND u_priv.role = 'admin'
           )
         ),
         FALSE
       ) AS is_privileged_viewer,
       COALESCE(
         ${viewerParam}::uuid IS NOT NULL
         AND u.id IS NOT NULL
         AND u.id <> ${viewerParam}::uuid
         AND u.email_verified_at IS NOT NULL
         AND (u.allow_direct_messages OR (p.space_type = 'private' AND p.allow_chat_contact))
         AND NOT EXISTS (
           SELECT 1 FROM chat_threads ct
           WHERE ct.user_low_id = LEAST(u.id, ${viewerParam}::uuid)
             AND ct.user_high_id = GREATEST(u.id, ${viewerParam}::uuid)
             AND (ct.blocked_by_low OR ct.blocked_by_high)
         ),
         FALSE
       ) AS can_message_author,`;
}

function classifyPolygonRejectionDimension(err: unknown): string | null {
  if (!(err instanceof ApiError)) {
    return null;
  }
  switch (err.code) {
    case 'RATE_LIMITED':
      return 'daily_quota';
    case 'GEOMETRY_INVALID':
      return 'geometry_invalid';
    case 'AREA_OUT_OF_BOUNDS':
      return 'area_out_of_bounds';
    case 'GEOMETRY_NOT_COMPACT':
      return 'geometry_not_compact';
    case 'GEOMETRY_SLIVER':
      return 'geometry_sliver';
    case 'POLYGON_OVERLAP':
      return 'polygon_overlap';
    case 'SPATIAL_CLUSTER_LIMIT':
      return 'spatial_cluster_limit';
    case 'OUTSIDE_JURISDICTION':
      return 'outside_jurisdiction';
    case 'LAND_COVER_EXCLUDED': {
      const cat =
        typeof err.details === 'object' &&
        err.details !== null &&
        'category' in err.details &&
        typeof (err.details as { category?: unknown }).category === 'string'
          ? (err.details as { category: string }).category
          : 'unknown';
      return `land_cover:${cat}`;
    }
    default:
      return null;
  }
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
      origin: coercePolygonOrigin(row.origin),
      wasAutoClipped: Boolean(row.was_auto_clipped),
      clippedAreaM2: Math.max(0, Number(row.clipped_area_m2 ?? 0)),
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
      spaceType: oneOf<StoredSpaceType>(STORED_SPACE_TYPES, row.space_type, 'unknown'),
      spaceVerification: oneOf<SpaceVerification>(
        SPACE_VERIFICATION_STATUSES,
        row.space_verification,
        'unverified',
      ),
      openForPublicAccess: Boolean(row.open_for_public_access),
      helpWanted: Boolean(row.help_wanted),
      canMessageAuthor: Boolean(row.can_message_author),
      detectedSpaceType: row.is_privileged_viewer
        ? oneOf<StoredSpaceType>(STORED_SPACE_TYPES, row.detected_space_type, 'unknown')
        : null,
      privateOverlapRatio: row.is_privileged_viewer
        ? row.private_overlap_ratio
        : null,
      spaceVerificationSource:
        row.is_privileged_viewer && row.space_verification_source !== null
          ? oneOf<SpaceVerificationSource>(
              SPACE_VERIFICATION_SOURCES,
              row.space_verification_source,
              'osm_local',
            )
          : null,
      allowChatContact: row.is_privileged_viewer
        ? Boolean(row.allow_chat_contact)
        : null,
      helpWantedUntil:
        row.is_privileged_viewer && row.help_wanted && row.help_wanted_until
          ? row.help_wanted_until.toISOString()
          : null,
      entitlementConfirmed: row.is_privileged_viewer
        ? Boolean(row.entitlement_confirmed)
        : null,
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
      origin: coercePolygonOrigin(row.origin),
      wasAutoClipped: Boolean(row.was_auto_clipped),
      clippedAreaM2: Math.max(0, Number(row.clipped_area_m2 ?? 0)),
      finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
      note: row.note,
      areaM2: Number(row.area_m2),
      municipalityAgs,
      municipalityName: row.municipality_name ?? null,
      municipalityMaxScore,
      municipalityNormalizedScore,
      photoCount: Math.max(0, Number(row.photo_count ?? 0)),
      commentCount: Math.max(0, Number(row.comment_count ?? 0)),
      flagCount: 0,
      isFlagged: false,
      upvotes: row.upvotes,
      downvotes: row.downvotes,
      score: row.score,
      spaceType: oneOf<StoredSpaceType>(STORED_SPACE_TYPES, row.space_type, 'unknown'),
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
    WHEN ${userAlias}.id IS NULL
      OR ${userAlias}.role = 'admin'
      OR ${userAlias}.trusted_at IS NOT NULL
      THEN FALSE
    WHEN ${userAlias}.created_at <= NOW() - make_interval(days => ${minDaysParam}::int)
      AND (
        SELECT COUNT(*)
        FROM polygons p_clean
        WHERE p_clean.user_id = ${userAlias}.id
          AND p_clean.score > 0
      ) >= ${minCleanParam}::int
      THEN FALSE
    ELSE TRUE
  END`;
}

function buildVisibleFlagCountSql(viewerParam: string): string {
  return `CASE
    WHEN ${viewerParam}::uuid IS NOT NULL AND (
      p.user_id = ${viewerParam}::uuid
      OR EXISTS (
        SELECT 1
        FROM users u_viewer
        WHERE u_viewer.id = ${viewerParam}::uuid
          AND u_viewer.role = 'admin'
      )
    ) THEN p.flag_count
    ELSE 0
  END`;
}

async function querySinglePolygonById(
  db: pg.Pool | pg.PoolClient,
  polygonId: string,
  viewerUserId: string | null,
  trust: PolygonTrustConfig,
): Promise<PolygonFeature | null> {
  return (await queryPolygonsByIds(db, [polygonId], viewerUserId, trust))[0] ?? null;
}

/** One query for any number of areas; the order of the result is unspecified. */
async function queryPolygonsByIds(
  db: pg.Pool | pg.PoolClient,
  polygonIds: readonly string[],
  viewerUserId: string | null,
  trust: PolygonTrustConfig,
): Promise<PolygonFeature[]> {
  if (polygonIds.length === 0) {
    return [];
  }
  const res = await db.query<PolygonQueryRow>(
    `SELECT
       p.id,
       p.user_id,
       ST_AsGeoJSON(p.geom, 6) AS geom_geojson,
       p.surface_type,
       p.status,
       p.origin,
       p.was_auto_clipped,
       p.clipped_area_m2,
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
       ${buildVisibleFlagCountSql('$2')} AS flag_count,
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
       ${buildSpaceColumnsSql('$2')}
       p.created_at,
       p.updated_at
     FROM polygons p
     LEFT JOIN users u ON u.id = p.user_id
     LEFT JOIN municipalities m ON m.id = p.municipality_id
     LEFT JOIN votes v
       ON v.polygon_id = p.id
      AND $2::uuid IS NOT NULL
      AND v.user_id = $2::uuid
     WHERE p.id = ANY($1::uuid[])`,
    [polygonIds, viewerUserId, trust.minAccountDays, trust.minCleanPolygons],
  );
  return res.rows.map((row) => mapRowToPolygonFeature(row));
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

  /** Validates, clips and locates a candidate; `enforceCluster` is for real submissions. */
  private async prepareCandidate(
    client: pg.PoolClient,
    params: Pick<
      CreatePolygonParams,
      'userId' | 'geometry' | 'minAreaM2' | 'maxAreaM2' | 'requireJurisdiction'
    >,
    enforceCluster: boolean,
  ): Promise<PreparedCandidate> {
    const minAreaM2 = params.minAreaM2 ?? GEOMETRY_LIMITS.MIN_AREA_M2;
    const maxAreaM2 = params.maxAreaM2 ?? GEOMETRY_LIMITS.MAX_AREA_M2;
    const requireJurisdiction = params.requireJurisdiction ?? 'when_seeded';
    const geoJsonInput = JSON.stringify(params.geometry);
    let wasAutoClipped = false;
    let clippedAreaM2 = 0;

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

        wasAutoClipped = true;
        clippedAreaM2 = Math.max(
          0,
          Number((areaM2 - clipped.largest_area_m2).toFixed(2)),
        );
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
        enforceCluster &&
        (userClusterCount >= GEOMETRY_LIMITS.CLUSTER_MAX_PER_USER ||
          globalClusterCount >= GEOMETRY_LIMITS.CLUSTER_MAX_GLOBAL)
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

      return {
        finalGeoJson,
        areaM2,
        wasAutoClipped,
        clippedAreaM2,
        matchedMuniId,
      };
  }

  private async withRollback<T>(
    run: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('ROLLBACK');
      return result;
    } catch (err: unknown) {
      await rollbackPreservingError(client, err);
      throw err;
    } finally {
      client.release();
    }
  }

  public async classifyGeometry(
    params: ClassifyGeometryParams,
  ): Promise<
    SpaceClassification & {
      wasAutoClipped: boolean;
      overlay: SpaceZoneCollection | null;
    }
  > {
    const prepared = await this.withRollback((client) =>
      this.prepareCandidate(client, params, false),
    );
    const upstream = await params.classifier.prefetch(params.geometry);
    const { classification, overlay } = await params.classifier.classifyWithOverlay(
      this.pool,
      prepared.finalGeoJson,
      upstream,
    );
    const features =
      classification.detectedSpaceType === 'unknown'
        ? []
        : overlayToFeatures(overlay);
    return {
      ...classification,
      wasAutoClipped: prepared.wasAutoClipped,
      overlay:
        features.length === 0
          ? null
          : {
              type: 'FeatureCollection',
              features,
              // The shown parts derive from these sources (ODbL-1.0 § 4.3).
              attributions: [
                ...(classification.source === 'osm_overpass'
                  ? [OSM_ZONE_ATTRIBUTION]
                  : []),
                ...(await listZoneAttributions(this.pool, prepared.finalGeoJson, {
                  includeLandCover: true,
                })),
              ],
              available: true,
              truncated: false,
            },
    };
  }

  public async create(params: CreatePolygonParams): Promise<PolygonFeature> {
    const origin: PolygonOrigin = params.origin ?? 'citizen';
    const normalizedNote = normalizeNote(params.note);
    let wasAutoClipped = false;
    let clippedAreaM2 = 0;

    // Network access happens before BEGIN, and only for geometry that is valid.
    let upstreamFeatures: Awaited<ReturnType<SpaceClassifier['prefetch']>> = null;
    if (params.classifier?.hasUpstream) {
      await this.withRollback((client) =>
        this.prepareCandidate(client, params, false),
      );
      upstreamFeatures = await params.classifier.prefetch(params.geometry);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Global lock order: lock users row BEFORE touching polygons or polygon_creations
      await lockUserForWrite(client, params.userId);
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
        [params.userId, this.trust.minAccountDays, this.trust.minCleanPolygons],
      );

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

      const {
        finalGeoJson,
        areaM2,
        wasAutoClipped: clippedFlag,
        clippedAreaM2: clippedArea,
        matchedMuniId,
      } = await this.prepareCandidate(client, params, true);
      wasAutoClipped = clippedFlag;
      clippedAreaM2 = clippedArea;

      const classification: SpaceClassification | null =
        params.classifier !== undefined
          ? await params.classifier.classify(client, finalGeoJson, upstreamFeatures)
          : null;
      const spaceType: StoredSpaceType =
        params.spaceType ?? 'unknown';
      const spaceVerification: SpaceVerification =
        classification === null ||
        params.spaceType === undefined ||
        classification.detectedSpaceType === 'unknown'
          ? 'unverified'
          : params.spaceType === classification.proposedSpaceType
            ? 'gis_verified'
            : 'user_override';
      const openForPublicAccess =
        spaceType === 'private' && params.openForPublicAccess === true;
      const allowChatContact =
        spaceType === 'private' && params.allowChatContact === true;
      const helpWanted = spaceType === 'private' && params.helpWanted === true;
      assertEntitlement(
        openForPublicAccess || allowChatContact || helpWanted,
        params.entitlementConfirmed,
      );

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
           municipality_id,
           origin,
           was_auto_clipped,
           clipped_area_m2,
           space_type,
           detected_space_type,
           private_overlap_ratio,
           space_verification,
           space_verification_source,
           open_for_public_access,
           allow_chat_contact,
           entitlement_confirmed_at,
           help_wanted_until
         )
         SELECT
           $1,
           prepared.geom,
           $3,
           $4,
           $5,
           $6,
           $7,
           $8,
           $9,
           $10,
           $11,
           $12,
           $13,
           $14,
           $15,
           $16,
           CASE WHEN $17::boolean THEN NOW() ELSE NULL END,
           CASE WHEN $18::boolean THEN NOW() + make_interval(days => $19::int) ELSE NULL END
         FROM prepared
         RETURNING id`,
        [
          params.userId,
          finalGeoJson,
          params.surfaceType,
          normalizedNote,
          areaM2,
          matchedMuniId,
          origin,
          wasAutoClipped,
          clippedAreaM2,
          spaceType,
          classification?.detectedSpaceType ?? 'unknown',
          classification?.privateOverlapRatio ?? null,
          spaceVerification,
          classification?.source ?? null,
          openForPublicAccess,
          allowChatContact,
          openForPublicAccess || allowChatContact || helpWanted,
          helpWanted,
          HELP_WANTED_DAYS,
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

      await recordTelemetryCounter(client, 'polygon_created', origin, {
        areaM2,
      });
      if (wasAutoClipped) {
        await recordTelemetryCounter(
          client,
          'polygon_auto_clipped',
          'minor_overlap',
          { areaM2: clippedAreaM2 },
        );
      }

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
      const rejectionDim = classifyPolygonRejectionDimension(err);
      if (rejectionDim !== null) {
        await recordTelemetryBestEffort(
          this.pool,
          'polygon_rejected',
          rejectionDim,
        );
      }
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
    const visibleFlagCountSql = buildVisibleFlagCountSql('$5');

    await this.pool.query(
      `UPDATE users u
       SET trusted_at = COALESCE(u.trusted_at, NOW())
       WHERE u.trusted_at IS NULL
         AND EXISTS (
           SELECT 1
           FROM polygons p
           WHERE p.user_id = u.id
             AND ST_Intersects(
               p.geom,
               ST_MakeEnvelope($1, $2, $3, $4, 4326)
             )
         )
         AND (
           u.role = 'admin'
           OR (
             u.created_at <= NOW() - make_interval(days => $5::int)
             AND (
               SELECT COUNT(*)
               FROM polygons p_clean
               WHERE p_clean.user_id = u.id
                 AND p_clean.score > 0
             ) >= $6::int
           )
         )`,
      [
        params.bbox.minLng,
        params.bbox.minLat,
        params.bbox.maxLng,
        params.bbox.maxLat,
        this.trust.minAccountDays,
        this.trust.minCleanPolygons,
      ],
    );

    const res = await this.pool.query<PolygonQueryRow>(
      `WITH bbox_polys AS (
         SELECT
           p.id,
           p.user_id,
           ST_AsGeoJSON(p.geom, 6) AS geom_geojson,
           p.surface_type,
           p.status,
           p.origin,
           p.was_auto_clipped,
           p.clipped_area_m2,
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
           ${visibleFlagCountSql} AS flag_count,
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
           ${buildSpaceColumnsSql('$5')}
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
           AND ${FILTER_SQL('$9', '$10')}
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
         bp.origin,
         bp.was_auto_clipped,
         bp.clipped_area_m2,
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
         bp.space_type,
         bp.space_verification,
         bp.open_for_public_access,
         bp.detected_space_type,
         bp.private_overlap_ratio,
         bp.space_verification_source,
         bp.allow_chat_contact,
         bp.help_wanted,
         bp.help_wanted_until,
         bp.entitlement_confirmed,
         bp.is_privileged_viewer,
         bp.can_message_author,
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
        params.spaceFilter ?? 'all',
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
    await this.pool.query(
      `UPDATE users u
       SET trusted_at = COALESCE(u.trusted_at, NOW())
       FROM polygons p
       WHERE p.id = $1
         AND u.id = p.user_id
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
      [polygonId, this.trust.minAccountDays, this.trust.minCleanPolygons],
    );

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
        `SELECT id, user_id, surface_type, note, space_type,
                open_for_public_access, allow_chat_contact,
                (help_wanted_until IS NOT NULL AND help_wanted_until > NOW()) AS help_wanted_active
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

      const isPrivate = existing.space_type === 'private';
      const nextOpen =
        isPrivate && (params.openForPublicAccess ?? existing.open_for_public_access);
      const nextContact =
        isPrivate && (params.allowChatContact ?? existing.allow_chat_contact);
      // true renews the 90 days, false ends the call, undefined leaves it alone.
      const helpChange =
        params.helpWanted === undefined ? null : isPrivate && params.helpWanted;
      const enablesOwnerFlag =
        (nextOpen && !existing.open_for_public_access) ||
        (nextContact && !existing.allow_chat_contact) ||
        (helpChange === true && !existing.help_wanted_active);
      assertEntitlement(enablesOwnerFlag, params.entitlementConfirmed);

      await client.query(
        `UPDATE polygons
         SET
           surface_type = $2,
           note = $3,
           open_for_public_access = $4,
           allow_chat_contact = $5,
           entitlement_confirmed_at = CASE
             WHEN $6::boolean THEN NOW()
             ELSE entitlement_confirmed_at
           END,
           help_wanted_until = CASE
             WHEN $7::boolean IS NULL THEN help_wanted_until
             WHEN $7::boolean THEN NOW() + make_interval(days => $8::int)
             ELSE NULL
           END,
           updated_at = NOW()
         WHERE id = $1`,
        [
          params.polygonId,
          nextSurfaceType,
          nextNote,
          nextOpen,
          nextContact,
          enablesOwnerFlag,
          helpChange,
          HELP_WANTED_DAYS,
        ],
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
      await lockUserForWrite(client, params.actorUserId);

      const lockRes = await client.query<{
        user_id: string | null;
        space_type: string;
        entitled: boolean;
      }>(
        `SELECT user_id, space_type, entitlement_confirmed_at IS NOT NULL AS entitled
         FROM polygons WHERE id = $1 FOR UPDATE`,
        [params.polygonId],
      );
      let confirmsEntitlement = false;
      const existing = lockRes.rows[0];
      if (!existing) {
        throw new ApiError(404, 'NOT_FOUND', 'Polygon not found.');
      }
      if (!params.actorIsAdmin) {
        if (existing.space_type !== 'private') {
          throw new ApiError(
            403,
            'FORBIDDEN_ADMIN_ONLY',
            'Administrator privileges are required for this action.',
          );
        }
        if (existing.user_id === null || existing.user_id !== params.actorUserId) {
          throw new ApiError(
            403,
            'FORBIDDEN_NOT_AUTHOR',
            'Only the author may change the status of a private area.',
          );
        }
        if (params.status !== 'proposed') {
          // Reporting progress is a statement about somebody's ground.
          confirmsEntitlement = !existing.entitled;
          assertEntitlement(confirmsEntitlement, params.entitlementConfirmed);
          const photoRes = await client.query(
            `SELECT 1 FROM polygon_photos
             WHERE polygon_id = $1
               AND NOT (credibility_score <= $2 AND fake_votes > real_votes)
             LIMIT 1`,
            [params.polygonId, PHOTO_LIMITS.FAKE_BLUR_SCORE_THRESHOLD],
          );
          if (photoRes.rowCount === 0) {
            throw new ApiError(
              422,
              'PHOTO_REQUIRED_FOR_STATUS',
              'At least one credible photo is required for this status.',
            );
          }
        }
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
           -- Progress moves the area up in the feed; a reset puts it back.
           feed_at = CASE
             WHEN $2 = 'proposed' THEN created_at
             WHEN status IS DISTINCT FROM $2 THEN NOW()
             ELSE feed_at
           END,
           help_wanted_until = CASE
             WHEN $2 = 'finished' THEN NULL
             ELSE help_wanted_until
           END,
           entitlement_confirmed_at = CASE
             WHEN $4::boolean THEN NOW()
             ELSE entitlement_confirmed_at
           END,
           updated_at = NOW()
         WHERE id = $1`,
        [params.polygonId, params.status, params.actorUserId, confirmsEntitlement],
      );

      const updated = await querySinglePolygonById(
        client,
        params.polygonId,
        params.actorUserId,
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

  public async setSpaceTypeAsAdmin(
    params: SetPolygonSpaceTypeParams,
  ): Promise<PolygonFeature> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (params.adminUserId !== null) {
        await lockUserForWrite(client, params.adminUserId);
      }
      const updatedRes = await client.query(
        `UPDATE polygons p
         SET space_type = $2,
             space_verification = 'admin_override',
             open_for_public_access = $2 = 'private' AND open_for_public_access,
             allow_chat_contact = $2 = 'private' AND allow_chat_contact,
             help_wanted_until = CASE WHEN $2 = 'private' THEN help_wanted_until ELSE NULL END,
             feed_at = CASE WHEN reset.applies THEN p.created_at ELSE p.feed_at END,
             status = CASE WHEN reset.applies THEN 'proposed' ELSE p.status END,
             finished_at = CASE WHEN reset.applies THEN NULL ELSE p.finished_at END,
             finished_by = CASE WHEN reset.applies THEN NULL ELSE p.finished_by END,
             updated_at = NOW()
         FROM (
           SELECT q.id, (
             q.space_type = 'private' AND $2 = 'public'
             AND NOT EXISTS (
               SELECT 1 FROM users fu WHERE fu.id = q.finished_by AND fu.role = 'admin'
             )
           ) AS applies
           FROM polygons q WHERE q.id = $1 FOR UPDATE
         ) reset
         WHERE p.id = reset.id`,
        [params.polygonId, params.spaceType],
      );
      if (updatedRes.rowCount === 0) {
        throw new ApiError(404, 'NOT_FOUND', 'Polygon not found.');
      }
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

  /**
   * Latest activity first, limited to recent entries (see FEED_LIMITS). A page
   * costs two queries however many entries it holds.
   */
  public async listFeed(
    params: FeedParams,
  ): Promise<{ entries: FeedEntry[]; nextCursor: string | null }> {
    const cursor =
      params.cursor === undefined ? null : decodeTimeCursor(params.cursor);
    const res = await this.pool.query<{
      id: string;
      cursor_ts: string;
      feed_at: Date;
      created_at: Date;
      status: string;
    }>(
      `SELECT p.id, p.feed_at::text AS cursor_ts, p.feed_at, p.created_at, p.status
       FROM polygons p
       WHERE p.feed_at > NOW() - make_interval(days => $1::int)
         AND ($2::timestamptz IS NULL OR (p.feed_at, p.id) < ($2::timestamptz, $3::uuid))
         AND ${FILTER_SQL('$4', '$5')}
         AND (NOT $6::boolean OR p.origin = 'citizen')
         AND (
           $8::float8 IS NULL
           OR p.geom && ST_MakeEnvelope($8::float8, $9::float8, $10::float8, $11::float8, 4326)
         )
         AND (
           $12::text IS NULL
           OR p.municipality_id IN (SELECT m.id FROM municipalities m WHERE m.ags = $12::text)
         )
       ORDER BY p.feed_at DESC, p.id DESC
       LIMIT $7`,
      [
        FEED_LIMITS.MAX_AGE_DAYS,
        cursor?.timestamp ?? null,
        cursor?.id ?? null,
        params.filter,
        params.spaceFilter,
        params.citizenOnly,
        params.limit + 1,
        params.bbox?.minLng ?? null,
        params.bbox?.minLat ?? null,
        params.bbox?.maxLng ?? null,
        params.bbox?.maxLat ?? null,
        params.ags ?? null,
      ],
    );
    const page = res.rows.slice(0, params.limit);
    const byId = new Map(
      (
        await queryPolygonsByIds(
          this.pool,
          page.map((row) => row.id),
          params.viewerUserId,
          this.trust,
        )
      ).map((feature) => [feature.id, feature]),
    );
    const entries: FeedEntry[] = [];
    for (const row of page) {
      const feature = byId.get(row.id);
      if (feature) {
        const status = coercePolygonStatus(row.status);
        entries.push({
          feature,
          activity:
            status === 'proposed' || row.feed_at.getTime() <= row.created_at.getTime()
              ? 'created'
              : status,
          activityAt: row.feed_at.toISOString(),
        });
      }
    }
    const last = page[page.length - 1];
    return {
      entries,
      nextCursor:
        res.rows.length > params.limit && last
          ? encodeTimeCursor(last.cursor_ts, last.id)
          : null,
    };
  }

  public async listClusters(
    params: ListPolygonClustersParams,
  ): Promise<PolygonClusterResponse> {
    const mode = resolveClusterMode(params.zoom);
    const mineOnly = params.mineOnly === true;
    if (mineOnly && params.viewerUserId === null) {
      return {
        mode,
        totalCount: 0,
        clusters: [],
      };
    }

    const filter: PolygonFilter = params.filter ?? 'all';
    const spaceFilter: SpaceFilter = params.spaceFilter ?? 'all';
    const zoomBucket = resolveClusterZoomBucket(params.zoom);
    const spacingPx =
      mode === 'bubble'
        ? CLUSTER_LIMITS.BUBBLE_SPACING_PX
        : CLUSTER_LIMITS.CITY_DOT_SPACING_PX;
    const mergeRadiusM = computeMercatorSpacingMeters(zoomBucket, spacingPx);
    const fineCellM = Math.max(1, mergeRadiusM / 2);

    const res = await this.pool.query<{
      cell_count: number;
      sum_merc_x: number;
      sum_merc_y: number;
      sum_lng: number;
      sum_lat: number;
      min_lng: number;
      min_lat: number;
      max_lng: number;
      max_lat: number;
      sample_polygon_id: string | null;
      sample_status: string | null;
      sample_score: number | null;
      sample_is_author: boolean;
    }>(
      `WITH pts AS (
         SELECT
           p.id,
           p.status,
           p.score,
           ($7::uuid IS NOT NULL AND p.user_id = $7::uuid) AS is_author,
           ST_PointOnSurface(p.geom) AS pt4326,
           ST_Transform(ST_PointOnSurface(p.geom), 3857) AS pt3857,
           p.geom
         FROM polygons p
         WHERE ST_Intersects(
           p.geom,
           ST_MakeEnvelope($1, $2, $3, $4, 4326)
         )
           AND ${FILTER_SQL('$5', '$6')}
           AND (NOT $8::boolean OR ($7::uuid IS NOT NULL AND p.user_id = $7::uuid))
       )
       SELECT
         COUNT(*)::int AS cell_count,
         SUM(ST_X(pt3857))::float8 AS sum_merc_x,
         SUM(ST_Y(pt3857))::float8 AS sum_merc_y,
         SUM(ST_X(pt4326))::float8 AS sum_lng,
         SUM(ST_Y(pt4326))::float8 AS sum_lat,
         MIN(ST_XMin(geom))::float8 AS min_lng,
         MIN(ST_YMin(geom))::float8 AS min_lat,
         MAX(ST_XMax(geom))::float8 AS max_lng,
         MAX(ST_YMax(geom))::float8 AS max_lat,
         (ARRAY_AGG(id::text))[1] AS sample_polygon_id,
         (ARRAY_AGG(status))[1] AS sample_status,
         (ARRAY_AGG(score))[1]::int AS sample_score,
         BOOL_OR(is_author) AS sample_is_author
       FROM pts
       GROUP BY FLOOR(ST_X(pt3857) / $9::float8), FLOOR(ST_Y(pt3857) / $9::float8)`,
      [
        params.bbox.minLng,
        params.bbox.minLat,
        params.bbox.maxLng,
        params.bbox.maxLat,
        filter,
        spaceFilter,
        params.viewerUserId,
        mineOnly,
        fineCellM,
      ],
    );

    let totalCount = 0;
    const cells = res.rows.map((row) => {
      const count = Number(row.cell_count);
      totalCount += count;
      return {
        count,
        sumMercX: Number(row.sum_merc_x),
        sumMercY: Number(row.sum_merc_y),
        sumLng: Number(row.sum_lng),
        sumLat: Number(row.sum_lat),
        minLng: Number(row.min_lng),
        minLat: Number(row.min_lat),
        maxLng: Number(row.max_lng),
        maxLat: Number(row.max_lat),
        samplePolygonId: row.sample_polygon_id,
        sampleStatus:
          row.sample_status !== null
            ? coercePolygonStatus(row.sample_status)
            : null,
        sampleScore:
          row.sample_score !== null ? Number(row.sample_score) : null,
        sampleIsAuthor: Boolean(row.sample_is_author),
      };
    });

    return {
      mode,
      totalCount,
      clusters: mergeClusterCells(cells, {
        mergeRadiusM,
        mode,
        maxClusters: CLUSTER_LIMITS.MAX_CLUSTERS,
      }),
    };
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
      const canSeeFlags =
        Boolean(params.actorIsAdmin) ||
        (existing.user_id !== null && existing.user_id === params.userId);
      const visibleFlagCount = canSeeFlags ? flagCount : 0;

      await client.query('COMMIT');
      return {
        polygonId: params.polygonId,
        flagCount: visibleFlagCount,
        isFlagged: visibleFlagCount > 0,
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

      const lockRes = await client.query<{ id: string; user_id: string | null }>(
        'SELECT id, user_id FROM polygons WHERE id = $1 FOR UPDATE',
        [params.polygonId],
      );
      const existing = lockRes.rows[0];
      if (!existing) {
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
      const canSeeFlags =
        Boolean(params.actorIsAdmin) ||
        (existing.user_id !== null && existing.user_id === params.userId);
      const visibleFlagCount = canSeeFlags ? flagCount : 0;

      await client.query('COMMIT');
      return {
        polygonId: params.polygonId,
        flagCount: visibleFlagCount,
        isFlagged: visibleFlagCount > 0,
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
        `SELECT p.id
         FROM polygons p
         WHERE p.status = 'proposed'
           AND p.upvotes = 0
           AND p.downvotes = 0
           AND p.photo_count = 0
           AND p.comment_count = 0
           AND p.created_at < NOW() - make_interval(days => $1::int)
           AND NOT EXISTS (
             SELECT 1 FROM votes v WHERE v.polygon_id = p.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM polygon_photos pp WHERE pp.polygon_id = p.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM polygon_comments pc WHERE pc.polygon_id = p.id
           )
         FOR UPDATE OF p SKIP LOCKED`,
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
    const origin: PolygonOrigin = params.origin ?? 'initiative_import';
    const errors = [...params.dataset.preErrors];
    let importedCount = 0;
    let importedAreaSum = 0;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await lockUserForWrite(client, params.adminUserId);

      let importAttributionId: string | null = null;
      if (params.importAttribution && params.dataset.candidates.length > 0) {
        const attrRes = await client.query<{ id: string }>(
          `INSERT INTO import_attributions (
             license,
             attribution_text,
             source_url,
             waiver_confirmed,
             created_by
           )
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [
            params.importAttribution.license,
            params.importAttribution.attributionText,
            params.importAttribution.sourceUrl ?? null,
            Boolean(params.importAttribution.waiverConfirmed),
            params.adminUserId,
          ],
        );
        importAttributionId = attrRes.rows[0]?.id ?? null;
      }

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
                 municipality_id,
                 origin,
                 import_attribution_id,
                 space_type,
                 space_verification
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
                 ),
                 $6,
                 $7,
                 COALESCE($8::text, 'unknown'),
                 CASE WHEN $8::text IS NULL THEN 'unverified' ELSE 'admin_override' END
               FROM prepared`,
              [
                params.adminUserId,
                part.poly_wkb,
                candidate.surfaceType,
                candidate.note,
                part.area_m2,
                origin,
                importAttributionId,
                candidate.spaceType ?? null,
              ],
            );
            importedCount += 1;
            importedAreaSum += part.area_m2;
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

      if (importedCount === 0 && importAttributionId !== null) {
        await client.query('DELETE FROM import_attributions WHERE id = $1', [
          importAttributionId,
        ]);
      }

      if (importedCount > 0) {
        await recordTelemetryCounter(client, 'polygon_imported', origin, {
          count: importedCount,
          areaM2: importedAreaSum,
        });
      }
      if (errors.length > 0) {
        await recordTelemetryCounter(
          client,
          'polygon_import_skipped',
          origin,
          { count: errors.length },
        );
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
      origin,
      importedCount,
      skippedCount: errors.length,
      errors,
    };
  }

  public async listActiveImportAttributions(
    statementTimeoutMs: number = DEFAULT_EXPORT_STATEMENT_TIMEOUT_MS,
  ): Promise<ActiveImportAttribution[]> {
    const safeTimeoutMs = Math.max(1, Math.trunc(statementTimeoutMs));
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      await client.query(`SET LOCAL statement_timeout = '${safeTimeoutMs}ms'`);
      const res = await client.query<{
        license: string;
        attribution_text: string;
        source_url: string | null;
        waiver_confirmed: boolean;
      }>(
        `SELECT DISTINCT
           ia.license,
           ia.attribution_text,
           ia.source_url,
           ia.waiver_confirmed
         FROM import_attributions ia
         INNER JOIN polygons p ON p.import_attribution_id = ia.id
         WHERE ia.purpose = 'polygon_import'
         ORDER BY ia.license ASC, ia.attribution_text ASC`,
      );
      await client.query('COMMIT');
      return res.rows.map((row) => ({
        license: row.license,
        attributionText: row.attribution_text,
        sourceUrl: row.source_url,
        waiverConfirmed: Boolean(row.waiver_confirmed),
      }));
    } catch (err: unknown) {
      await rollbackPreservingError(client, err);
      throw err;
    } finally {
      client.release();
    }
  }

  public async delete(
    polygonId: string,
    userId: string,
    actorIsAdmin: boolean = false,
  ): Promise<DeletedTargetAuthorInfo> {
    const client = await this.pool.connect();
    let photoFilesToDelete: Array<{ file_name: string; thumb_name: string }> = [];
    let moderationInfo: DeletedTargetAuthorInfo = {
      deletedByAdmin: false,
      authorEmail: null,
      authorPseudonym: null,
    };
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
      const isAuthor =
        existing.user_id !== null && existing.user_id === userId;
      if (!isAuthor && !actorIsAdmin) {
        throw new ApiError(
          403,
          'FORBIDDEN_NOT_AUTHOR',
          'Only the author or an administrator may delete this polygon.',
        );
      }

      if (actorIsAdmin && !isAuthor && existing.user_id !== null) {
        const authorRes = await client.query<{
          email: string | null;
          pseudonym: string;
        }>('SELECT email, pseudonym FROM users WHERE id = $1', [
          existing.user_id,
        ]);
        const author = authorRes.rows[0];
        moderationInfo = {
          deletedByAdmin: true,
          authorEmail: author?.email ?? null,
          authorPseudonym: author?.pseudonym ?? null,
        };
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

    return moderationInfo;
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
               p.origin,
               p.was_auto_clipped,
               p.clipped_area_m2,
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
               p.space_type,
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
               p.origin,
               p.was_auto_clipped,
               p.clipped_area_m2,
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
               p.space_type,
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

  private async querySpaceBreakdown(
    userId: string | null,
  ): Promise<SpaceBreakdown> {
    const res = await this.pool.query<{
      space_type: string;
      total: number;
      proposed: number;
      in_progress: number;
      finished: number;
      area: number;
      unsealed: number;
    }>(
      `SELECT space_type,
              COUNT(*)::int AS total,
              (COUNT(*) FILTER (WHERE status = 'proposed'))::int AS proposed,
              (COUNT(*) FILTER (WHERE status = 'in_progress'))::int AS in_progress,
              (COUNT(*) FILTER (WHERE status = 'finished'))::int AS finished,
              COALESCE(SUM(area_m2), 0)::float8 AS area,
              COALESCE(SUM(area_m2) FILTER (WHERE status = 'finished'), 0)::float8 AS unsealed
       FROM polygons
       WHERE space_type <> 'unknown' AND ($1::uuid IS NULL OR user_id = $1::uuid)
       GROUP BY space_type`,
      [userId],
    );
    const round = (value: number): number => Math.round(value * 100) / 100;
    const item = (type: SpaceType): SpaceBreakdown['public'] => {
      const row = res.rows.find((r) => r.space_type === type);
      return {
        totalPolygons: row?.total ?? 0,
        proposedCount: row?.proposed ?? 0,
        inProgressCount: row?.in_progress ?? 0,
        finishedCount: row?.finished ?? 0,
        totalAreaM2: round(row?.area ?? 0),
        unsealedAreaM2: round(row?.unsealed ?? 0),
      };
    };
    return { public: item('public'), private: item('private') };
  }

  public async getPublicStats(): Promise<PublicStatsResponse> {
    const res = await this.pool.query<{
      total_polygons: string | number;
      proposed_count: string | number;
      in_progress_count: string | number;
      finished_count: string | number;
      needs_review_count: string | number;
      total_area_m2: number;
      unsealed_area_m2: number;
      total_upvotes: string | number;
      total_downvotes: string | number;
      asphalt_count: string | number;
      asphalt_area_m2: number;
      concrete_count: string | number;
      concrete_area_m2: number;
      pavers_count: string | number;
      pavers_area_m2: number;
      other_count: string | number;
      other_area_m2: number;
    }>(
      `SELECT
         COUNT(*)::bigint AS total_polygons,
         COUNT(*) FILTER (WHERE status = 'proposed')::bigint AS proposed_count,
         COUNT(*) FILTER (WHERE status = 'in_progress')::bigint AS in_progress_count,
         COUNT(*) FILTER (WHERE status = 'finished')::bigint AS finished_count,
         COUNT(*) FILTER (
           WHERE status = 'proposed'
             AND upvotes = 0
             AND downvotes = 0
         )::bigint AS needs_review_count,
         COALESCE(SUM(area_m2), 0)::float8 AS total_area_m2,
         COALESCE(SUM(area_m2) FILTER (WHERE status = 'finished'), 0)::float8 AS unsealed_area_m2,
         COALESCE(SUM(upvotes), 0)::bigint AS total_upvotes,
         COALESCE(SUM(downvotes), 0)::bigint AS total_downvotes,
         COUNT(*) FILTER (WHERE surface_type = 'asphalt')::bigint AS asphalt_count,
         COALESCE(SUM(area_m2) FILTER (WHERE surface_type = 'asphalt'), 0)::float8 AS asphalt_area_m2,
         COUNT(*) FILTER (WHERE surface_type = 'concrete')::bigint AS concrete_count,
         COALESCE(SUM(area_m2) FILTER (WHERE surface_type = 'concrete'), 0)::float8 AS concrete_area_m2,
         COUNT(*) FILTER (WHERE surface_type = 'pavers')::bigint AS pavers_count,
         COALESCE(SUM(area_m2) FILTER (WHERE surface_type = 'pavers'), 0)::float8 AS pavers_area_m2,
         COUNT(*) FILTER (
           WHERE surface_type NOT IN ('asphalt', 'concrete', 'pavers')
         )::bigint AS other_count,
         COALESCE(
           SUM(area_m2) FILTER (WHERE surface_type NOT IN ('asphalt', 'concrete', 'pavers')),
           0
         )::float8 AS other_area_m2
       FROM polygons`,
    );

    const row = res.rows[0];
    const roundArea = (val: number | undefined): number =>
      Math.round(Math.max(0, Number(val ?? 0)) * 100) / 100;
    const toCount = (val: string | number | undefined): number =>
      Math.max(0, Math.trunc(Number(val ?? 0)));

    const totalUpvotes = toCount(row?.total_upvotes);
    const totalDownvotes = toCount(row?.total_downvotes);

    return {
      totalPolygons: toCount(row?.total_polygons),
      proposedCount: toCount(row?.proposed_count),
      inProgressCount: toCount(row?.in_progress_count),
      finishedCount: toCount(row?.finished_count),
      needsReviewCount: toCount(row?.needs_review_count),
      totalAreaM2: roundArea(row?.total_area_m2),
      unsealedAreaM2: roundArea(row?.unsealed_area_m2),
      totalVotes: totalUpvotes + totalDownvotes,
      totalUpvotes,
      totalDownvotes,
      surfaceBreakdown: {
        asphalt: {
          count: toCount(row?.asphalt_count),
          areaM2: roundArea(row?.asphalt_area_m2),
        },
        concrete: {
          count: toCount(row?.concrete_count),
          areaM2: roundArea(row?.concrete_area_m2),
        },
        pavers: {
          count: toCount(row?.pavers_count),
          areaM2: roundArea(row?.pavers_area_m2),
        },
        other: {
          count: toCount(row?.other_count),
          areaM2: roundArea(row?.other_area_m2),
        },
      },
      spaceBreakdown: await this.querySpaceBreakdown(null),
    };
  }

  public async getPersonalStats(userId: string): Promise<PersonalStatsResponse> {
    const res = await this.pool.query<{
      total_polygons: string | number;
      proposed_count: string | number;
      in_progress_count: string | number;
      finished_count: string | number;
      total_area_m2: number;
      unsealed_area_m2: number;
      rated_polygons_count: string | number;
    }>(
      `SELECT
         COUNT(*)::bigint AS total_polygons,
         COUNT(*) FILTER (WHERE status = 'proposed')::bigint AS proposed_count,
         COUNT(*) FILTER (WHERE status = 'in_progress')::bigint AS in_progress_count,
         COUNT(*) FILTER (WHERE status = 'finished')::bigint AS finished_count,
         COALESCE(SUM(area_m2), 0)::float8 AS total_area_m2,
         COALESCE(SUM(area_m2) FILTER (WHERE status = 'finished'), 0)::float8 AS unsealed_area_m2,
         (SELECT COUNT(*)::bigint FROM votes WHERE user_id = $1::uuid) AS rated_polygons_count
       FROM polygons
       WHERE user_id = $1::uuid`,
      [userId],
    );

    const row = res.rows[0];
    const roundArea = (val: number | undefined): number =>
      Math.round(Math.max(0, Number(val ?? 0)) * 100) / 100;
    const toCount = (val: string | number | undefined): number =>
      Math.max(0, Math.trunc(Number(val ?? 0)));

    return {
      totalPolygons: toCount(row?.total_polygons),
      proposedCount: toCount(row?.proposed_count),
      inProgressCount: toCount(row?.in_progress_count),
      finishedCount: toCount(row?.finished_count),
      totalAreaM2: roundArea(row?.total_area_m2),
      unsealedAreaM2: roundArea(row?.unsealed_area_m2),
      ratedPolygonsCount: toCount(row?.rated_polygons_count),
      spaceBreakdown: await this.querySpaceBreakdown(userId),
    };
  }
}
