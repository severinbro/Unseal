// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Unseal Contributors

import {
  POLYGON_ORIGINS,
  type PolygonOrigin,
} from '@entsiegelung/shared';

import type pg from 'pg';

export type TelemetryMetric =
  | 'polygon_created'
  | 'polygon_imported'
  | 'polygon_import_skipped'
  | 'polygon_auto_clipped'
  | 'polygon_rejected'
  | 'vote_cast'
  | 'vote_flipped'
  | 'vote_removed'
  | 'photo_uploaded';

export interface RecordTelemetryOptions {
  count?: number | undefined;
  areaM2?: number | undefined;
}

export interface TelemetryMetricTotal {
  metric: string;
  dimension: string;
  eventCount: number;
  areaSumM2: number;
}

export interface TelemetryDailySeriesItem extends TelemetryMetricTotal {
  day: string;
}

export interface PolygonOriginSummary {
  origin: PolygonOrigin;
  polygonCount: number;
  totalAreaM2: number;
  medianAreaM2: number;
  meanCompactnessPp: number;
  autoClippedCount: number;
  totalClippedAreaM2: number;
  photoCount: number;
  gpsVerifiedPhotoCount: number;
  upvotes: number;
  downvotes: number;
  meanScore: number;
}

export interface TelemetryExportReport {
  format: 'unseal-research-telemetry';
  version: 1;
  exportedAt: string;
  window: {
    since: string | null;
    until: string | null;
  };
  totalsByMetric: TelemetryMetricTotal[];
  dailySeries: TelemetryDailySeriesItem[];
  polygonStatsByOrigin: PolygonOriginSummary[];
}

type Queryable = pg.Pool | pg.PoolClient;

function sanitizeDimension(raw: string | undefined): string {
  const trimmed = raw?.trim().toLowerCase() ?? '';
  if (trimmed.length === 0) {
    return 'none';
  }
  return trimmed.slice(0, 80);
}

/**
 * Increments a zero-PII daily research telemetry counter inside an existing
 * transaction or pool query. Stores UTC calendar date + event count + area delta only.
 */
export async function recordTelemetryCounter(
  db: Queryable,
  metric: TelemetryMetric,
  dimension: string = 'none',
  options: RecordTelemetryOptions = {},
): Promise<void> {
  const safeCount =
    options.count !== undefined && Number.isFinite(options.count)
      ? Math.max(0, Math.trunc(options.count))
      : 1;
  if (safeCount === 0) {
    return;
  }
  const safeArea =
    options.areaM2 !== undefined && Number.isFinite(options.areaM2)
      ? Math.max(0, Number(options.areaM2))
      : 0;

  await db.query(
    `INSERT INTO daily_telemetry_counters (day, metric, dimension, event_count, area_sum_m2)
     VALUES ((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, $1, $2, $3, $4)
     ON CONFLICT (day, metric, dimension)
     DO UPDATE SET
       event_count = daily_telemetry_counters.event_count + EXCLUDED.event_count,
       area_sum_m2 = daily_telemetry_counters.area_sum_m2 + EXCLUDED.area_sum_m2`,
    [metric, sanitizeDimension(dimension), safeCount, safeArea],
  );
}

/**
 * Best-effort pool-level counter increment for recording validation rejections
 * outside rolled-back write transactions without ever masking API errors.
 */
export async function recordTelemetryBestEffort(
  pool: pg.Pool,
  metric: TelemetryMetric,
  dimension: string = 'none',
  options: RecordTelemetryOptions = {},
): Promise<void> {
  try {
    await recordTelemetryCounter(pool, metric, dimension, options);
  } catch {
    // Never let telemetry recording interrupt request handling
  }
}

export async function collectTelemetryExport(
  db: Queryable,
  filter: { since?: string | null; until?: string | null } = {},
): Promise<TelemetryExportReport> {
  const since = filter.since ?? null;
  const until = filter.until ?? null;

  const [totalsRes, dailyRes, originStatsRes] = await Promise.all([
    db.query<{
      metric: string;
      dimension: string;
      event_count: string | number;
      area_sum_m2: number;
    }>(
      `SELECT
         metric,
         dimension,
         SUM(event_count)::bigint AS event_count,
         COALESCE(SUM(area_sum_m2), 0)::double precision AS area_sum_m2
       FROM daily_telemetry_counters
       WHERE ($1::date IS NULL OR day >= $1::date)
         AND ($2::date IS NULL OR day <= $2::date)
       GROUP BY metric, dimension
       ORDER BY metric ASC, dimension ASC`,
      [since, until],
    ),
    db.query<{
      day_iso: string;
      metric: string;
      dimension: string;
      event_count: string | number;
      area_sum_m2: number;
    }>(
      `SELECT
         day::text AS day_iso,
         metric,
         dimension,
         event_count,
         area_sum_m2
       FROM daily_telemetry_counters
       WHERE ($1::date IS NULL OR day >= $1::date)
         AND ($2::date IS NULL OR day <= $2::date)
       ORDER BY day ASC, metric ASC, dimension ASC`,
      [since, until],
    ),
    db.query<{
      origin: string;
      polygon_count: number;
      total_area_m2: number;
      median_area_m2: number;
      mean_compactness_pp: number;
      auto_clipped_count: number;
      total_clipped_area_m2: number;
      photo_count: number;
      gps_verified_photo_count: number;
      upvotes: number;
      downvotes: number;
      mean_score: number;
    }>(
      `WITH poly_metrics AS (
         SELECT
           p.id,
           p.origin,
           p.area_m2,
           p.was_auto_clipped,
           p.clipped_area_m2,
           p.photo_count,
           p.upvotes,
           p.downvotes,
           p.score,
           ST_Perimeter(p.geom::geography) AS perimeter_m,
           (
             SELECT COUNT(*)::int
             FROM polygon_photos pp
             WHERE pp.polygon_id = p.id AND pp.gps_verified = TRUE
           ) AS gps_verified_photos
         FROM polygons p
         WHERE ($1::date IS NULL OR (p.created_at AT TIME ZONE 'UTC')::date >= $1::date)
           AND ($2::date IS NULL OR (p.created_at AT TIME ZONE 'UTC')::date <= $2::date)
       )
       SELECT
         origin,
         COUNT(*)::int AS polygon_count,
         COALESCE(SUM(area_m2), 0)::double precision AS total_area_m2,
         COALESCE(
           percentile_cont(0.5) WITHIN GROUP (ORDER BY area_m2),
           0
         )::double precision AS median_area_m2,
         COALESCE(
           AVG(
             CASE
               WHEN perimeter_m > 0 THEN (4.0 * pi() * area_m2) / (perimeter_m * perimeter_m)
               ELSE 0
             END
           ),
           0
         )::double precision AS mean_compactness_pp,
         COUNT(*) FILTER (WHERE was_auto_clipped)::int AS auto_clipped_count,
         COALESCE(SUM(clipped_area_m2), 0)::double precision AS total_clipped_area_m2,
         COALESCE(SUM(photo_count), 0)::int AS photo_count,
         COALESCE(SUM(gps_verified_photos), 0)::int AS gps_verified_photo_count,
         COALESCE(SUM(upvotes), 0)::int AS upvotes,
         COALESCE(SUM(downvotes), 0)::int AS downvotes,
         COALESCE(AVG(score), 0)::double precision AS mean_score
       FROM poly_metrics
       GROUP BY origin
       ORDER BY origin ASC`,
      [since, until],
    ),
  ]);

  const originMap = new Map<string, PolygonOriginSummary>();
  for (const row of originStatsRes.rows) {
    const coercedOrigin: PolygonOrigin = (
      POLYGON_ORIGINS as readonly string[]
    ).includes(row.origin)
      ? (row.origin as PolygonOrigin)
      : 'citizen';
    originMap.set(coercedOrigin, {
      origin: coercedOrigin,
      polygonCount: Number(row.polygon_count),
      totalAreaM2: Number(Number(row.total_area_m2).toFixed(2)),
      medianAreaM2: Number(Number(row.median_area_m2).toFixed(2)),
      meanCompactnessPp: Number(Number(row.mean_compactness_pp).toFixed(4)),
      autoClippedCount: Number(row.auto_clipped_count),
      totalClippedAreaM2: Number(Number(row.total_clipped_area_m2).toFixed(2)),
      photoCount: Number(row.photo_count),
      gpsVerifiedPhotoCount: Number(row.gps_verified_photo_count),
      upvotes: Number(row.upvotes),
      downvotes: Number(row.downvotes),
      meanScore: Number(Number(row.mean_score).toFixed(4)),
    });
  }

  return {
    format: 'unseal-research-telemetry',
    version: 1,
    exportedAt: new Date().toISOString(),
    window: {
      since,
      until,
    },
    totalsByMetric: totalsRes.rows.map((r) => ({
      metric: r.metric,
      dimension: r.dimension,
      eventCount: Number(r.event_count),
      areaSumM2: Number(Number(r.area_sum_m2).toFixed(2)),
    })),
    dailySeries: dailyRes.rows.map((r) => ({
      day: r.day_iso,
      metric: r.metric,
      dimension: r.dimension,
      eventCount: Number(r.event_count),
      areaSumM2: Number(Number(r.area_sum_m2).toFixed(2)),
    })),
    polygonStatsByOrigin: POLYGON_ORIGINS.map(
      (origin) =>
        originMap.get(origin) ?? {
          origin,
          polygonCount: 0,
          totalAreaM2: 0,
          medianAreaM2: 0,
          meanCompactnessPp: 0,
          autoClippedCount: 0,
          totalClippedAreaM2: 0,
          photoCount: 0,
          gpsVerifiedPhotoCount: 0,
          upvotes: 0,
          downvotes: 0,
          meanScore: 0,
        },
    ),
  };
}
