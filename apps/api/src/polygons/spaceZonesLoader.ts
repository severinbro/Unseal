// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 OpenUnseal Contributors

import fs from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

import {
  ApiError,
  SPACE_REFERENCE_TIERS,
  type SpaceReferenceTier,
} from '@openunseal/shared';

import {
  assertCompatibleImportLicenseParam,
  parseGeoPackageBinary,
} from './gpkgReader.js';
import { classifyOsmSpaceTags } from './spaceClassifier.js';

import type pg from 'pg';

export type SpaceZoneSource = 'alkis' | 'osm_local';

export interface LoadSpaceZonesOptions {
  source: SpaceZoneSource;
  license: string;
  attribution?: string | null | undefined;
  sourceUrl?: string | null | undefined;
  waiverConfirmed?: boolean | undefined;
  replaceSource?: boolean | undefined;
}

export interface LoadSpaceZonesResult {
  source: SpaceZoneSource;
  importedCount: number;
  skippedCount: number;
}

type Props = Record<string, unknown>;

/**
 * Owner data from the cadastre or land register must never enter the database,
 * not even aggregated ownership classes such as ALKIS `eigentuemerart`.
 */
const OWNERSHIP_ATTRIBUTE_RE =
  /eigent(?:ue|ü|u)mer|namensnummer|grundbuch|buchungsblatt|^owner(?:_?name)?$/i;

export function assertNoOwnershipAttributes(props: Props): void {
  for (const key of Object.keys(props)) {
    if (OWNERSHIP_ATTRIBUTE_RE.test(key)) {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        `Space-zone dataset contains the ownership attribute "${key}". Remove owner data before loading; only land-use attributes are accepted.`,
      );
    }
  }
}

const ALKIS_PUBLIC_RE = /^(?:42001|42006|42009)$|strassenverkehr|straßenverkehr/;
const ALKIS_PRIVATE_RE =
  /^(?:41001|41002|41006)$|wohnbauflaeche|wohnbaufläche|industrieundgewerbe|gemischternutzung/;

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim().toLowerCase()
    : '';
}

export function classifySpaceZoneProperties(
  props: Props,
  source: SpaceZoneSource,
  isArea: boolean = true,
): { tier: SpaceReferenceTier; category: string } | null {
  const tier = text(props.tier);
  if ((SPACE_REFERENCE_TIERS as readonly string[]).includes(tier)) {
    return {
      tier: tier as SpaceReferenceTier,
      category: text(props.category) || tier,
    };
  }
  if (source === 'osm_local') {
    const match = classifyOsmSpaceTags(props, isArea);
    return match && match.tier !== 'excluded'
      ? { tier: match.tier, category: 'osm' }
      : null;
  }
  // 41003 (spoil heap) and 41007 (public-function land) are deliberately unmapped.
  for (const key of ['objektart', 'nutzungsart', 'art', 'kennung', 'layer']) {
    const token = text(props[key]);
    const compact = token.replace(/[\s_-]/g, '');
    if (!compact) {
      continue;
    }
    if (ALKIS_PUBLIC_RE.test(compact) || compact === 'weg' || compact === 'platz') {
      return { tier: 'public', category: token.slice(0, 80) };
    }
    if (ALKIS_PRIVATE_RE.test(compact)) {
      return { tier: 'landuse_private', category: token.slice(0, 80) };
    }
  }
  return null;
}

interface ZoneCandidate {
  tier: SpaceReferenceTier;
  category: string;
  wkb: Uint8Array | null;
  geoJson: string | null;
  srid: number;
}

const ident = (name: string): string => `"${name.replace(/"/g, '""')}"`;

function readGeoPackage(
  filePath: string,
  source: SpaceZoneSource,
): { zones: ZoneCandidate[]; skipped: number } {
  const db = new DatabaseSync(filePath, { open: true, readOnly: true });
  const zones: ZoneCandidate[] = [];
  let skipped = 0;
  try {
    db.exec('PRAGMA trusted_schema = OFF; PRAGMA query_only = ON;');
    const layers = db
      .prepare(
        `SELECT c.table_name, g.column_name, s.organization, s.organization_coordsys_id
         FROM gpkg_contents c
         INNER JOIN gpkg_geometry_columns g ON g.table_name = c.table_name
         LEFT JOIN gpkg_spatial_ref_sys s ON s.srs_id = g.srs_id
         WHERE LOWER(c.data_type) = 'features'`,
      )
      .all() as Array<{
      table_name: string;
      column_name: string;
      organization: string | null;
      organization_coordsys_id: number | null;
    }>;
    for (const layer of layers) {
      for (const row of db
        .prepare(`SELECT * FROM ${ident(layer.table_name)}`)
        .iterate() as Iterable<Props>) {
        const { [layer.column_name]: blob, ...attrs } = row;
        assertNoOwnershipAttributes(attrs);
        const zone = classifySpaceZoneProperties(
          { layer: layer.table_name, ...attrs },
          source,
        );
        const parsed = blob instanceof Uint8Array ? parseGeoPackageBinary(blob) : null;
        if (!zone || !parsed) {
          skipped += 1;
          continue;
        }
        zones.push({
          ...zone,
          wkb: parsed.wkb,
          geoJson: null,
          srid:
            layer.organization?.toUpperCase() === 'EPSG' &&
            typeof layer.organization_coordsys_id === 'number'
              ? layer.organization_coordsys_id
              : parsed.srsId > 0
                ? parsed.srsId
                : 4326,
        });
      }
    }
  } finally {
    db.close();
  }
  return { zones, skipped };
}

function readGeoJson(
  buffer: Buffer,
  source: SpaceZoneSource,
): { zones: ZoneCandidate[]; skipped: number } {
  let root: { features?: unknown };
  try {
    root = JSON.parse(buffer.toString('utf8')) as { features?: unknown };
  } catch {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Space-zone file is not valid GeoJSON or GeoPackage.',
    );
  }
  const zones: ZoneCandidate[] = [];
  let skipped = 0;
  const features = Array.isArray(root?.features) ? root.features : [];
  for (const raw of features as Array<{
    geometry?: { type?: unknown } | null;
    properties?: Props | null;
  }>) {
    const props = raw?.properties ?? {};
    assertNoOwnershipAttributes(props);
    const type = raw?.geometry?.type;
    const zone =
      type === 'Polygon' || type === 'MultiPolygon'
        ? classifySpaceZoneProperties(props, source)
        : null;
    if (!zone) {
      skipped += 1;
      continue;
    }
    zones.push({
      ...zone,
      wkb: null,
      geoJson: JSON.stringify(raw.geometry),
      srid: 4326,
    });
  }
  return { zones, skipped };
}

export async function loadSpaceZonesFile(
  pool: pg.Pool,
  filePath: string,
  options: LoadSpaceZonesOptions,
): Promise<LoadSpaceZonesResult> {
  const attribution = options.attribution?.trim() ?? '';
  const policy = assertCompatibleImportLicenseParam(options.license, {
    sourceAttribution: attribution,
    waiverConfirmed: options.waiverConfirmed,
  });
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      `Unable to read space-zone file at "${filePath}".`,
    );
  }
  const isGpkg =
    buffer.subarray(0, 16).toString('latin1') === 'SQLite format 3\0';
  const { zones, skipped } = isGpkg
    ? readGeoPackage(filePath, options.source)
    : readGeoJson(buffer, options.source);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (options.replaceSource) {
      // Attribution rows stay: stored classifications still derive from them.
      await client.query('DELETE FROM space_reference_zones WHERE source = $1', [
        options.source,
      ]);
    }
    const attrRes = await client.query<{ id: string }>(
      `INSERT INTO import_attributions
         (license, attribution_text, source_url, waiver_confirmed, purpose)
       VALUES ($1, $2, $3, $4, 'space_zones')
       RETURNING id`,
      [
        policy.canonicalLicense,
        attribution || policy.canonicalLicense,
        options.sourceUrl ?? null,
        policy.requiresWaiver,
      ],
    );
    const attributionId = attrRes.rows[0]!.id;
    let importedCount = 0;
    for (const zone of zones) {
      const res = await client.query(
        `INSERT INTO space_reference_zones
           (source, tier, category, import_attribution_id, geom)
         SELECT $1, $2, $3, $4, g FROM (
           SELECT ST_CollectionExtract(ST_MakeValid(ST_Transform(ST_Force2D(
             CASE WHEN $5::bytea IS NOT NULL
               THEN ST_GeomFromWKB($5::bytea, $7::int)
               ELSE ST_SetSRID(ST_GeomFromGeoJSON($6::text), $7::int)
             END
           ), 4326)), 3) AS g
         ) prepared
         WHERE NOT ST_IsEmpty(g)`,
        [
          options.source,
          zone.tier,
          zone.category,
          attributionId,
          zone.wkb,
          zone.geoJson,
          zone.srid,
        ],
      );
      importedCount += res.rowCount ?? 0;
    }
    if (importedCount === 0) {
      await client.query('DELETE FROM import_attributions WHERE id = $1', [
        attributionId,
      ]);
    }
    await client.query('COMMIT');
    return {
      source: options.source,
      importedCount,
      skippedCount: skipped + (zones.length - importedCount),
    };
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
