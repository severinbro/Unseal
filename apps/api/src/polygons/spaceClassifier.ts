// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 OpenUnseal Contributors

import {
  SPACE_CLASSIFICATION_THRESHOLDS,
  computeRingBbox,
  type CreatePolygonRequest,
  type SpaceReferenceTier,
  type SpaceType,
  type SpaceVerificationSource,
  type SpaceZoneKind,
  type StoredSpaceType,
} from '@openunseal/shared';

import { classifyLandCoverFeatureProperties } from './landCover.js';

import type { FastifyBaseLogger } from 'fastify';
import type pg from 'pg';

const BBOX_PADDING_M = 20;
const BBOX_GRID_DEG = 0.005;
const METERS_PER_DEG_LAT = 111_320;
const CACHE_MAX_ENTRIES = 500;
const CACHE_TTL_MS = 30 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 4_500;
const UPSTREAM_MIN_INTERVAL_MS = 500;
const BREAKER_FAILURES = 2;
const BREAKER_OPEN_MS = 30_000;
const MAX_UPSTREAM_BYTES = 4 * 1024 * 1024;

const DRIVEWAY_HALF_WIDTH_M = 2.5;
const PRIVATE_ACCESS = new Set([
  'private',
  'no',
  'customers',
  'residents',
  'employees',
  'delivery',
  'permit',
  'members',
]);
const PRIVATE_LANDUSE = new Set([
  'residential',
  'commercial',
  'industrial',
  'retail',
  'garages',
  'farmyard',
]);
const PUBLIC_HIGHWAY_HALF_WIDTH_M: Readonly<Record<string, number>> = {
  trunk: 6.5,
  primary: 6.5,
  secondary: 6.5,
  tertiary: 3.25,
  residential: 3.25,
  unclassified: 3.25,
  living_street: 3.25,
  pedestrian: 2,
  footway: 2,
  cycleway: 2,
  path: 2,
  steps: 2,
};

export type ClassifierTier = SpaceReferenceTier | 'excluded';

export interface ClassifierFeature {
  tier: ClassifierTier;
  /** Assemble polygons from loose member lines (OSM multipolygon relations). */
  buildArea: boolean;
  /** Half width in metres for line features; 0 for areas. */
  bufferM: number;
  geometry: Record<string, unknown>;
}

export interface SpaceClassification {
  proposedSpaceType: SpaceType;
  detectedSpaceType: StoredSpaceType;
  privateOverlapRatio: number | null;
  source: SpaceVerificationSource | null;
}

/** The matched parts of a candidate, as GeoJSON geometry text per kind. */
export type ClassificationOverlay = Array<{ kind: SpaceZoneKind; geoJson: string }>;

type Tags = Record<string, unknown>;

function tag(tags: Tags, key: string): string {
  const value = tags[key];
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/** Maps OSM tags to a tier; `bufferM` is only set for line features. */
export function classifyOsmSpaceTags(
  tags: Tags,
  isArea: boolean,
): { tier: ClassifierTier; bufferM: number } | null {
  if (isArea && classifyLandCoverFeatureProperties(tags, 'osm') !== null) {
    return { tier: 'excluded', bufferM: 0 };
  }
  const access = tag(tags, 'access');
  const isPrivate =
    PRIVATE_ACCESS.has(access) ||
    tag(tags, 'ownership') === 'private' ||
    tag(tags, 'operator:type') === 'private';
  const highway = tag(tags, 'highway');
  const landuse = tag(tags, 'landuse');
  const amenity = tag(tags, 'amenity');

  if (!isArea) {
    if (highway === 'service') {
      return isPrivate
        ? { tier: 'explicit_private', bufferM: DRIVEWAY_HALF_WIDTH_M }
        : null;
    }
    const halfWidth = PUBLIC_HIGHWAY_HALF_WIDTH_M[highway];
    return halfWidth !== undefined && !isPrivate
      ? { tier: 'public', bufferM: halfWidth }
      : null;
  }

  const isPaved =
    amenity === 'parking' ||
    highway === 'service' ||
    tag(tags, 'man_made') === 'courtyard' ||
    landuse === 'garages' ||
    tag(tags, 'area') === 'yes';
  if (isPaved && isPrivate) {
    return { tier: 'explicit_private', bufferM: 0 };
  }
  const isCivic =
    tag(tags, 'place') === 'square' ||
    highway in PUBLIC_HIGHWAY_HALF_WIDTH_M ||
    ['school', 'kindergarten', 'townhall', 'community_centre', 'library'].includes(
      amenity,
    ) ||
    tag(tags, 'leisure') === 'playground';
  if (isCivic && !isPrivate) {
    return { tier: 'public', bufferM: 0 };
  }
  return PRIVATE_LANDUSE.has(landuse)
    ? { tier: 'landuse_private', bufferM: 0 }
    : null;
}

/**
 * Bounding box sent upstream. It is always widened to the 0.005° grid so the
 * exact parcel somebody is drawing never leaves this server.
 */
export function roundedOverpassBbox(
  ring: readonly (readonly [number, number])[],
): [number, number, number, number] {
  const [minLng, minLat, maxLng, maxLat] = computeRingBbox(ring);
  const padLat = BBOX_PADDING_M / METERS_PER_DEG_LAT;
  const padLng =
    padLat / Math.max(0.1, Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180));
  const down = (v: number): number =>
    Number((Math.floor(v / BBOX_GRID_DEG) * BBOX_GRID_DEG).toFixed(3));
  const up = (v: number): number =>
    Number((Math.ceil(v / BBOX_GRID_DEG) * BBOX_GRID_DEG).toFixed(3));
  return [
    down(minLng - padLng),
    down(minLat - padLat),
    up(maxLng + padLng),
    up(maxLat + padLat),
  ];
}

function buildOverpassQuery(bbox: readonly number[]): string {
  const b = `${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]}`;
  const keys = [
    'landuse',
    'highway',
    'amenity',
    'building',
    'natural',
    'leisure',
    'railway',
    'waterway',
    'place',
    'man_made',
  ];
  return `[out:json][timeout:3];(${keys
    .map((k) => `way["${k}"](${b});`)
    .join('')}relation["type"="multipolygon"]["landuse"](${b}););out tags geom;`;
}

interface OverpassElement {
  type?: unknown;
  tags?: unknown;
  geometry?: unknown;
  members?: unknown;
}

function toLine(raw: unknown): [number, number][] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: [number, number][] = [];
  for (const point of raw as Array<{ lat?: unknown; lon?: unknown } | null>) {
    if (
      point &&
      typeof point.lat === 'number' &&
      typeof point.lon === 'number' &&
      Number.isFinite(point.lat) &&
      Number.isFinite(point.lon)
    ) {
      out.push([point.lon, point.lat]);
    }
  }
  return out;
}

export function parseOverpassFeatures(payload: unknown): ClassifierFeature[] {
  const elements =
    typeof payload === 'object' && payload !== null
      ? (payload as { elements?: unknown }).elements
      : undefined;
  if (!Array.isArray(elements)) {
    return [];
  }
  const out: ClassifierFeature[] = [];
  for (const element of elements as OverpassElement[]) {
    if (!element || typeof element.tags !== 'object' || element.tags === null) {
      continue;
    }
    const tags = element.tags as Tags;
    if (element.type === 'relation' && Array.isArray(element.members)) {
      const lines = (element.members as Array<{ geometry?: unknown } | null>)
        .map((m) => toLine(m?.geometry))
        .filter((line) => line.length >= 2);
      const match = classifyOsmSpaceTags(tags, true);
      if (match && lines.length > 0) {
        out.push({
          tier: match.tier,
          buildArea: true,
          bufferM: 0,
          geometry: { type: 'MultiLineString', coordinates: lines },
        });
      }
      continue;
    }
    if (element.type !== 'way') {
      continue;
    }
    const line = toLine(element.geometry);
    const first = line[0];
    const last = line[line.length - 1];
    const closed =
      line.length >= 4 &&
      first !== undefined &&
      last !== undefined &&
      first[0] === last[0] &&
      first[1] === last[1];
    const isLinearHighway =
      typeof tags.highway === 'string' && tag(tags, 'area') !== 'yes';
    const isArea = closed && !isLinearHighway;
    const match = classifyOsmSpaceTags(tags, isArea);
    if (!match || line.length < 2) {
      continue;
    }
    out.push({
      tier: match.tier,
      buildArea: false,
      bufferM: match.bufferM,
      geometry: isArea
        ? { type: 'Polygon', coordinates: [line] }
        : { type: 'LineString', coordinates: line },
    });
  }
  return out;
}

export interface SpaceClassifierOptions {
  /** Null disables live lookups; only locally loaded zones are used. */
  overpassApiUrl: string | null;
  publicBaseUrl: string;
  logger?: FastifyBaseLogger | undefined;
  fetchImpl?: typeof fetch | undefined;
  minIntervalMs?: number | undefined;
}

type Geometry = CreatePolygonRequest['geometry'];

export class SpaceClassifier {
  private readonly cache = new Map<
    string,
    { expiresAt: number; features: ClassifierFeature[] }
  >();
  private queue: Promise<void> = Promise.resolve();
  private lastRequestMs = 0;
  private failures = 0;
  private openUntilMs = 0;

  constructor(private readonly options: SpaceClassifierOptions) {}

  public get hasUpstream(): boolean {
    return this.options.overpassApiUrl !== null;
  }

  /** Never call this inside a database transaction. Failures degrade to null. */
  public async prefetch(geometry: Geometry): Promise<ClassifierFeature[] | null> {
    const url = this.options.overpassApiUrl;
    const ring = geometry.coordinates[0];
    if (url === null || !ring || ring.length === 0) {
      return null;
    }
    const bbox = roundedOverpassBbox(ring);
    const key = bbox.join(',');
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.features;
    }
    const run = this.queue.then(async () => {
      const raced = this.cache.get(key);
      if (raced && raced.expiresAt > Date.now()) {
        return raced.features;
      }
      if (Date.now() < this.openUntilMs) {
        return null;
      }
      return this.fetchBbox(url, bbox, key);
    });
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async fetchBbox(
    url: string,
    bbox: readonly number[],
    key: string,
  ): Promise<ClassifierFeature[] | null> {
    const wait =
      (this.options.minIntervalMs ?? UPSTREAM_MIN_INTERVAL_MS) -
      (Date.now() - this.lastRequestMs);
    if (wait > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, wait));
    }
    this.lastRequestMs = Date.now();
    try {
      const response = await (this.options.fetchImpl ?? fetch)(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          // Identifies the instance, deliberately without a personal contact address.
          'User-Agent': `OpenUnseal-PPGIS/1.0 (${this.options.publicBaseUrl})`,
        },
        body: new URLSearchParams({ data: buildOverpassQuery(bbox) }).toString(),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`Overpass returned HTTP ${response.status}`);
      }
      const text = await response.text();
      if (text.length > MAX_UPSTREAM_BYTES) {
        throw new Error('Overpass response too large');
      }
      const features = parseOverpassFeatures(JSON.parse(text));
      this.failures = 0;
      if (this.cache.size >= CACHE_MAX_ENTRIES) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) {
          this.cache.delete(oldest);
        }
      }
      this.cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, features });
      return features;
    } catch (err: unknown) {
      this.failures += 1;
      if (this.failures >= BREAKER_FAILURES) {
        this.openUntilMs = Date.now() + BREAKER_OPEN_MS;
        this.failures = 0;
      }
      // Location data is never logged (GDPR Art. 5(1)(c)).
      this.options.logger?.warn(
        { reason: err instanceof Error ? err.message : 'unknown' },
        'Overpass land-use lookup failed',
      );
      return null;
    }
  }

  public async classify(
    db: pg.Pool | pg.PoolClient,
    geoJson: string,
    upstream: readonly ClassifierFeature[] | null,
  ): Promise<SpaceClassification> {
    return (await this.classifyWithOverlay(db, geoJson, upstream)).classification;
  }

  /** Like `classify`, plus the matched parts for showing them to the author. */
  public async classifyWithOverlay(
    db: pg.Pool | pg.PoolClient,
    geoJson: string,
    upstream: readonly ClassifierFeature[] | null,
  ): Promise<{
    classification: SpaceClassification;
    overlay: ClassificationOverlay;
  }> {
    const local = await this.evaluate(db, geoJson, []);
    const localCovered =
      local.hasPublicNearby &&
      local.hasPrivateNearby &&
      local.rPriv + local.rPub >=
        SPACE_CLASSIFICATION_THRESHOLDS.LOCAL_SHORT_CIRCUIT_COVERAGE;
    const localSource: SpaceVerificationSource | null =
      local.alkisAreaM2 === 0 && local.osmAreaM2 === 0
        ? null
        : local.alkisAreaM2 >= local.osmAreaM2
          ? 'alkis'
          : 'osm_local';
    if (localCovered || !upstream || upstream.length === 0) {
      return {
        classification: decide(local.rPriv, local.rPub, localSource),
        overlay: local.overlay,
      };
    }
    const merged = await this.evaluate(db, geoJson, upstream);
    return {
      classification: decide(merged.rPriv, merged.rPub, 'osm_overpass'),
      overlay: merged.overlay,
    };
  }

  private async evaluate(
    db: pg.Pool | pg.PoolClient,
    geoJson: string,
    upstream: readonly ClassifierFeature[],
  ): Promise<{
    rPriv: number;
    rPub: number;
    alkisAreaM2: number;
    osmAreaM2: number;
    hasPublicNearby: boolean;
    hasPrivateNearby: boolean;
    overlay: ClassificationOverlay;
  }> {
    const res = await db.query<{
      priv_geojson: string | null;
      pub_geojson: string | null;
      r_priv: number;
      r_pub: number;
      alkis_area: number;
      osm_area: number;
      has_public: boolean;
      has_private: boolean;
    }>(
      `WITH cand AS (
         SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS g
       ),
       ext AS (
         SELECT
           f->>'tier' AS tier,
           CASE
             WHEN (f->>'buildArea')::boolean THEN ST_BuildArea(raw.geom)
             WHEN (f->>'bufferM')::float8 > 0
               THEN ST_Buffer(raw.geom::geography, (f->>'bufferM')::float8)::geometry
             ELSE ST_CollectionExtract(ST_MakeValid(raw.geom), 3)
           END AS geom
         FROM jsonb_array_elements($2::jsonb) AS f
         CROSS JOIN LATERAL (
           SELECT ST_SetSRID(ST_GeomFromGeoJSON(f->>'geometry'), 4326) AS geom
         ) raw
       ),
       zones AS (
         SELECT z.source, z.tier, z.geom
         FROM space_reference_zones z, cand
         WHERE ST_Intersects(z.geom, cand.g)
         UNION ALL
         SELECT 'ext', e.tier, e.geom
         FROM ext e, cand
         WHERE e.tier <> 'excluded' AND e.geom IS NOT NULL AND ST_Intersects(e.geom, cand.g)
       ),
       excluded AS (
         SELECT lce.geom
         FROM land_cover_exclusions lce, cand
         WHERE ST_Intersects(lce.geom, cand.g)
         UNION ALL
         SELECT e.geom
         FROM ext e, cand
         WHERE e.tier = 'excluded' AND e.geom IS NOT NULL AND ST_Intersects(e.geom, cand.g)
       ),
       sets AS (
         SELECT
           cand.g,
           COALESCE((SELECT ST_UnaryUnion(ST_Collect(geom)) FROM zones WHERE tier = 'explicit_private'), ST_GeomFromText('POLYGON EMPTY', 4326)) AS priv_explicit,
           COALESCE((SELECT ST_UnaryUnion(ST_Collect(geom)) FROM zones WHERE tier = 'public'), ST_GeomFromText('POLYGON EMPTY', 4326)) AS pub,
           COALESCE((SELECT ST_UnaryUnion(ST_Collect(geom)) FROM zones WHERE tier = 'landuse_private'), ST_GeomFromText('POLYGON EMPTY', 4326)) AS priv_landuse,
           COALESCE((SELECT ST_UnaryUnion(ST_Collect(geom)) FROM excluded), ST_GeomFromText('POLYGON EMPTY', 4326)) AS excl
         FROM cand
       ),
       free AS (
         SELECT
           ST_MakeValid(ST_Difference(g, excl)) AS p,
           priv_explicit,
           ST_Difference(pub, priv_explicit) AS pub_eff,
           priv_landuse
         FROM sets
       ),
       parts AS (
         SELECT
           p,
           ST_Intersection(p, pub_eff) AS pub_part,
           ST_Intersection(
             p,
             ST_Union(priv_explicit, ST_Difference(priv_landuse, pub_eff))
           ) AS priv_part
         FROM free
       ),
       shapes AS (
         SELECT
           p,
           ST_CollectionExtract(ST_MakeValid(pub_part), 3) AS pub_shape,
           ST_CollectionExtract(ST_MakeValid(priv_part), 3) AS priv_shape
         FROM parts
       ),
       areas AS (
         SELECT
           GREATEST(0.01, ST_Area(ST_CollectionExtract(p, 3)::geography)) AS total,
           ST_Area(pub_shape::geography) AS pub_area,
           ST_Area(priv_shape::geography) AS priv_area,
           CASE WHEN ST_IsEmpty(pub_shape) THEN NULL ELSE ST_AsGeoJSON(pub_shape, 6) END AS pub_geojson,
           CASE WHEN ST_IsEmpty(priv_shape) THEN NULL ELSE ST_AsGeoJSON(priv_shape, 6) END AS priv_geojson
         FROM shapes
       )
       SELECT
         areas.pub_geojson,
         areas.priv_geojson,
         LEAST(1, areas.priv_area / areas.total) AS r_priv,
         LEAST(1, areas.pub_area / areas.total) AS r_pub,
         COALESCE((SELECT SUM(ST_Area(ST_Intersection(z.geom, cand.g)::geography)) FROM zones z, cand WHERE z.source = 'alkis'), 0)::float8 AS alkis_area,
         COALESCE((SELECT SUM(ST_Area(ST_Intersection(z.geom, cand.g)::geography)) FROM zones z, cand WHERE z.source = 'osm_local'), 0)::float8 AS osm_area,
         EXISTS (SELECT 1 FROM space_reference_zones z, cand WHERE z.tier = 'public' AND z.geom && ST_Expand(cand.g, 0.01)) AS has_public,
         EXISTS (SELECT 1 FROM space_reference_zones z, cand WHERE z.tier <> 'public' AND z.geom && ST_Expand(cand.g, 0.01)) AS has_private
       FROM areas`,
      [geoJson, JSON.stringify(upstream)],
    );
    const row = res.rows[0];
    const overlay: ClassificationOverlay = [];
    if (row?.priv_geojson) {
      overlay.push({ kind: 'private', geoJson: row.priv_geojson });
    }
    if (row?.pub_geojson) {
      overlay.push({ kind: 'public', geoJson: row.pub_geojson });
    }
    return {
      overlay,
      rPriv: Number(row?.r_priv ?? 0),
      rPub: Number(row?.r_pub ?? 0),
      alkisAreaM2: Number(row?.alkis_area ?? 0),
      osmAreaM2: Number(row?.osm_area ?? 0),
      hasPublicNearby: Boolean(row?.has_public),
      hasPrivateNearby: Boolean(row?.has_private),
    };
  }
}

export function decide(
  rPriv: number,
  rPub: number,
  source: SpaceVerificationSource | null,
): SpaceClassification {
  const t = SPACE_CLASSIFICATION_THRESHOLDS;
  // Rounding first keeps float noise from deciding borderline cases.
  const priv = Math.min(1, Math.round(rPriv * 10_000) / 10_000);
  const pub = Math.min(1, Math.round(rPub * 10_000) / 10_000);
  if (priv >= t.PRIVATE_PROPOSAL_MIN_RATIO) {
    return {
      proposedSpaceType: 'private',
      detectedSpaceType: 'private',
      privateOverlapRatio: priv,
      source,
    };
  }
  if (pub >= t.PUBLIC_MIN_RATIO || priv + pub >= t.PRIVATE_PROPOSAL_MIN_RATIO) {
    return {
      proposedSpaceType: 'public',
      detectedSpaceType: 'public',
      privateOverlapRatio: priv,
      source,
    };
  }
  return {
    proposedSpaceType: 'public',
    detectedSpaceType: 'unknown',
    privateOverlapRatio: null,
    source: null,
  };
}
