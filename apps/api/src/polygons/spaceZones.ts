// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 OpenUnseal Contributors

import {
  SPACE_ZONE_LIMITS,
  type BboxBounds,
  type SpaceZoneAttribution,
  type SpaceZoneCollection,
  type SpaceZoneKind,
} from '@openunseal/shared';

import type { ClassificationOverlay } from './spaceClassifier.js';
import type pg from 'pg';

type Db = pg.Pool | pg.PoolClient;
type ZoneFeature = SpaceZoneCollection['features'][number];

export const OSM_ZONE_ATTRIBUTION: SpaceZoneAttribution = {
  text: '© OpenStreetMap contributors',
  license: 'ODbL-1.0',
  sourceUrl: 'https://www.openstreetmap.org/copyright',
};

function toFeature(kind: SpaceZoneKind, geoJson: string): ZoneFeature | null {
  const geometry = JSON.parse(geoJson) as { type?: unknown; coordinates?: unknown };
  if (
    (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') ||
    !Array.isArray(geometry.coordinates) ||
    geometry.coordinates.length === 0
  ) {
    return null;
  }
  return {
    type: 'Feature',
    geometry: geometry as ZoneFeature['geometry'],
    properties: { kind },
  };
}

export function overlayToFeatures(overlay: ClassificationOverlay): ZoneFeature[] {
  return overlay
    .map((part) => toFeature(part.kind, part.geoJson))
    .filter((feature): feature is ZoneFeature => feature !== null);
}

function dedupe(rows: SpaceZoneAttribution[]): SpaceZoneAttribution[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.text}|${row.license}|${row.sourceUrl ?? ''}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * Credits of every reference dataset that touches the geometry. Land-cover
 * datasets shape the comparison everywhere, so all of them are named.
 */
export async function listZoneAttributions(
  db: Db,
  geoJson: string,
  options: { includeLandCover: boolean },
): Promise<SpaceZoneAttribution[]> {
  const res = await db.query<{
    attribution_text: string;
    license: string;
    source_url: string | null;
  }>(
    `SELECT ia.attribution_text, ia.license, ia.source_url
     FROM import_attributions ia
     WHERE (
       ia.purpose = 'space_zones'
       AND EXISTS (
         SELECT 1 FROM space_reference_zones z
         WHERE z.import_attribution_id = ia.id
           AND ST_Intersects(z.geom, ST_SetSRID(ST_GeomFromGeoJSON($1), 4326))
       )
     ) OR ($2::boolean AND ia.purpose = 'land_cover')
     ORDER BY ia.created_at ASC, ia.id ASC`,
    [geoJson, options.includeLandCover],
  );
  return dedupe(
    res.rows.map((row) => ({
      text: row.attribution_text,
      license: row.license,
      sourceUrl: row.source_url,
    })),
  );
}

function bboxGeoJson(bbox: BboxBounds): string {
  return JSON.stringify({
    type: 'Polygon',
    coordinates: [
      [
        [bbox.minLng, bbox.minLat],
        [bbox.maxLng, bbox.minLat],
        [bbox.maxLng, bbox.maxLat],
        [bbox.minLng, bbox.maxLat],
        [bbox.minLng, bbox.minLat],
      ],
    ],
  });
}

/**
 * Locally loaded land-use reference zones inside a small map section, merged
 * the way the comparison weighs them: explicit private beats public, public
 * beats general private land use. Live Overpass results are never served here.
 */
export async function listSpaceZones(
  db: Db,
  bbox: BboxBounds,
): Promise<SpaceZoneCollection> {
  const res = await db.query<{
    kind: SpaceZoneKind;
    geojson: string | null;
    zone_count: number;
    any_zone: boolean;
  }>(
    `WITH env AS (
       SELECT ST_MakeEnvelope($1, $2, $3, $4, 4326) AS g
     ),
     hit AS (
       SELECT z.tier, z.geom
       FROM space_reference_zones z, env
       WHERE z.geom && env.g
       LIMIT $5
     ),
     sets AS (
       SELECT
         COALESCE((SELECT ST_UnaryUnion(ST_Collect(geom)) FROM hit WHERE tier = 'explicit_private'), ST_GeomFromText('POLYGON EMPTY', 4326)) AS priv_explicit,
         COALESCE((SELECT ST_UnaryUnion(ST_Collect(geom)) FROM hit WHERE tier = 'public'), ST_GeomFromText('POLYGON EMPTY', 4326)) AS pub,
         COALESCE((SELECT ST_UnaryUnion(ST_Collect(geom)) FROM hit WHERE tier = 'landuse_private'), ST_GeomFromText('POLYGON EMPTY', 4326)) AS priv_landuse
     ),
     eff AS (
       SELECT ST_Difference(pub, priv_explicit) AS pub_eff, priv_explicit, priv_landuse
       FROM sets
     ),
     shaped AS (
       SELECT 'public'::text AS kind, ST_Intersection(pub_eff, env.g) AS geom
       FROM eff, env
       UNION ALL
       SELECT 'private'::text,
              ST_Intersection(ST_Union(priv_explicit, ST_Difference(priv_landuse, pub_eff)), env.g)
       FROM eff, env
     )
     SELECT
       s.kind,
       CASE WHEN ST_IsEmpty(v.geom) THEN NULL ELSE ST_AsGeoJSON(v.geom, 6) END AS geojson,
       (SELECT COUNT(*)::int FROM hit) AS zone_count,
       EXISTS (SELECT 1 FROM space_reference_zones) AS any_zone
     FROM shaped s
     CROSS JOIN LATERAL (
       SELECT ST_CollectionExtract(
         ST_MakeValid(ST_SimplifyPreserveTopology(s.geom, 0.000004)), 3
       ) AS geom
     ) v`,
    [
      bbox.minLng,
      bbox.minLat,
      bbox.maxLng,
      bbox.maxLat,
      SPACE_ZONE_LIMITS.MAX_FEATURES + 1,
    ],
  );
  const features = res.rows
    .map((row) => (row.geojson === null ? null : toFeature(row.kind, row.geojson)))
    .filter((feature): feature is ZoneFeature => feature !== null);
  return {
    type: 'FeatureCollection',
    features,
    attributions:
      features.length === 0
        ? []
        : await listZoneAttributions(db, bboxGeoJson(bbox), {
            includeLandCover: false,
          }),
    available: res.rows[0]?.any_zone === true,
    truncated: (res.rows[0]?.zone_count ?? 0) > SPACE_ZONE_LIMITS.MAX_FEATURES,
  };
}
