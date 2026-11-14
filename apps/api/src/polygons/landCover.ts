import fs from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

import {
  ApiError,
  LAND_COVER_CATEGORIES,
  LAND_COVER_SOURCES,
  type LandCoverCategory,
  type LandCoverSource,
} from '@entsiegelung/shared';

import { parseGeoPackageBinary } from './gpkgReader.js';

import type pg from 'pg';

export interface LandCoverSeedItem {
  source: LandCoverSource;
  category: LandCoverCategory;
  geoJsonGeometry: Record<string, unknown> | string;
  srid?: number | undefined;
}

export interface LoadLandCoverOptions {
  source: LandCoverSource;
  defaultCategory?: LandCoverCategory | undefined;
  replaceSource?: boolean | undefined;
}

export interface LoadLandCoverResult {
  source: LandCoverSource;
  importedCount: number;
  skippedCount: number;
}

function quoteSqliteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

function asLowerTrimmedString(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim().toLowerCase();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return '';
}

export function classifyLandCoverFeatureProperties(
  props: Record<string, unknown> | null | undefined,
  source: LandCoverSource,
  defaultCategory?: LandCoverCategory,
): LandCoverCategory | null {
  if (!props) {
    return defaultCategory ?? null;
  }

  const explicitCategory = asLowerTrimmedString(props.category);
  if (
    (LAND_COVER_CATEGORIES as readonly string[]).includes(explicitCategory)
  ) {
    return explicitCategory as LandCoverCategory;
  }

  if (source === 'osm') {
    const building = asLowerTrimmedString(props.building);
    if (building && building !== 'no' && building !== 'false' && building !== '0') {
      return 'building';
    }

    const natural = asLowerTrimmedString(props.natural);
    const waterway = asLowerTrimmedString(props.waterway);
    const landuse = asLowerTrimmedString(props.landuse);
    const leisure = asLowerTrimmedString(props.leisure);
    const railway = asLowerTrimmedString(props.railway);

    if (
      natural === 'water' ||
      natural === 'wetland' ||
      waterway === 'riverbank' ||
      waterway === 'dock' ||
      waterway === 'canal' ||
      waterway === 'river' ||
      landuse === 'reservoir' ||
      landuse === 'basin'
    ) {
      return 'water';
    }

    if (
      railway === 'rail' ||
      railway === 'light_rail' ||
      railway === 'subway' ||
      railway === 'tram' ||
      landuse === 'railway'
    ) {
      return 'railway';
    }

    if (natural === 'wood' || natural === 'scrub' || landuse === 'forest') {
      return 'forest_wood';
    }

    if (
      leisure === 'park' ||
      leisure === 'garden' ||
      leisure === 'nature_reserve' ||
      landuse === 'grass' ||
      landuse === 'village_green' ||
      landuse === 'recreation_ground' ||
      landuse === 'allotments' ||
      landuse === 'cemetery'
    ) {
      return 'park_green';
    }

    if (
      landuse === 'farmland' ||
      landuse === 'meadow' ||
      landuse === 'orchard' ||
      landuse === 'vineyard' ||
      landuse === 'plant_nursery'
    ) {
      return 'farmland';
    }

    return defaultCategory ?? null;
  }

  // ALKIS classification (objektart / nutzungsart / kennung / layer)
  const alkisTokens = [
    asLowerTrimmedString(props.objektart),
    asLowerTrimmedString(props.nutzungsart),
    asLowerTrimmedString(props.art),
    asLowerTrimmedString(props.kennung),
    asLowerTrimmedString(props.layer),
  ].filter(Boolean);

  for (const token of alkisTokens) {
    if (
      token.includes('gebaeude') ||
      token.includes('gebäude') ||
      token === '31001'
    ) {
      return 'building';
    }
    if (
      token.includes('gewaesser') ||
      token.includes('gewässer') ||
      token.includes('fliessgewaesser') ||
      token.includes('stehendesgewaesser') ||
      token.includes('meer') ||
      /^4400[1-7]$/.test(token)
    ) {
      return 'water';
    }
    if (token.includes('bahnverkehr') || token === '42010') {
      return 'railway';
    }
    if (
      token.includes('wald') ||
      token.includes('gehoelz') ||
      token.includes('gehölz') ||
      token === '43002' ||
      token === '43003'
    ) {
      return 'forest_wood';
    }
    if (
      token.includes('gruenanlage') ||
      token.includes('grünanlage') ||
      token.includes('friedhof') ||
      token.includes('erholungsflaeche')
    ) {
      return 'park_green';
    }
    if (token.includes('landwirtschaft') || token === '43001') {
      return 'farmland';
    }
  }

  return defaultCategory ?? null;
}

export async function seedLandCoverExclusions(
  pool: pg.Pool,
  items: readonly LandCoverSeedItem[],
  options: { replaceSource?: LandCoverSource | undefined } = {},
): Promise<number> {
  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query('BEGIN');
    if (options.replaceSource) {
      await client.query(
        'DELETE FROM land_cover_exclusions WHERE source = $1',
        [options.replaceSource],
      );
    }

    for (const item of items) {
      const geoJsonText =
        typeof item.geoJsonGeometry === 'string'
          ? item.geoJsonGeometry
          : JSON.stringify(item.geoJsonGeometry);
      const srid = item.srid ?? 4326;
      const res = await client.query(
        `WITH raw AS (
           SELECT ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON($3::text), $4::int)) AS g
         ),
         reproj AS (
           SELECT CASE
             WHEN $4::int = 4326 THEN ST_MakeValid(g)
             ELSE ST_MakeValid(ST_Transform(g, 4326))
           END AS g4326
           FROM raw
         )
         INSERT INTO land_cover_exclusions (source, category, geom)
         SELECT $1, $2, g4326
         FROM reproj
         WHERE g4326 IS NOT NULL AND NOT ST_IsEmpty(g4326)`,
        [item.source, item.category, geoJsonText, srid],
      );
      inserted += res.rowCount ?? 0;
    }

    await client.query('COMMIT');
    return inserted;
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function loadLandCoverFile(
  pool: pg.Pool,
  filePath: string,
  options: LoadLandCoverOptions,
): Promise<LoadLandCoverResult> {
  if (!(LAND_COVER_SOURCES as readonly string[]).includes(options.source)) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Land-cover source must be "osm" or "alkis".',
    );
  }
  if (
    options.defaultCategory !== undefined &&
    !(LAND_COVER_CATEGORIES as readonly string[]).includes(
      options.defaultCategory,
    )
  ) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      `Invalid land-cover category "${options.defaultCategory}".`,
    );
  }

  let fileBuf: Buffer;
  try {
    fileBuf = await fs.readFile(filePath);
  } catch {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      `Unable to read land-cover file at "${filePath}".`,
    );
  }

  const isGpkg =
    filePath.toLowerCase().endsWith('.gpkg') ||
    fileBuf.subarray(0, 16).toString('latin1') === 'SQLite format 3\0';

  if (isGpkg) {
    const db = new DatabaseSync(filePath, { open: true, readOnly: true });
    let importedCount = 0;
    let skippedCount = 0;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (options.replaceSource) {
        await client.query(
          'DELETE FROM land_cover_exclusions WHERE source = $1',
          [options.source],
        );
      }

      const layerRows = db
        .prepare(
          `SELECT c.table_name, g.column_name, g.srs_id, s.organization, s.organization_coordsys_id
           FROM gpkg_contents c
           INNER JOIN gpkg_geometry_columns g ON g.table_name = c.table_name
           LEFT JOIN gpkg_spatial_ref_sys s ON s.srs_id = g.srs_id
           WHERE LOWER(c.data_type) = 'features'`,
        )
        .all() as Array<{
        table_name: string;
        column_name: string;
        srs_id: number;
        organization: string | null;
        organization_coordsys_id: number | null;
      }>;

      for (const layer of layerRows) {
        const tableIdent = quoteSqliteIdent(layer.table_name);
        const rows = db.prepare(`SELECT * FROM ${tableIdent}`).all() as Array<
          Record<string, unknown>
        >;

        for (const row of rows) {
          const rawBlob = row[layer.column_name];
          if (!(rawBlob instanceof Uint8Array)) {
            skippedCount += 1;
            continue;
          }
          const props: Record<string, unknown> = { layer: layer.table_name };
          for (const [k, v] of Object.entries(row)) {
            if (k !== layer.column_name) {
              props[k] = v;
            }
          }
          const category = classifyLandCoverFeatureProperties(
            props,
            options.source,
            options.defaultCategory,
          );
          if (!category) {
            skippedCount += 1;
            continue;
          }
          const parsedGpb = parseGeoPackageBinary(rawBlob);
          if (!parsedGpb) {
            skippedCount += 1;
            continue;
          }
          const epsgSrid =
            layer.organization?.toUpperCase() === 'EPSG' &&
            typeof layer.organization_coordsys_id === 'number'
              ? layer.organization_coordsys_id
              : parsedGpb.srsId > 0
                ? parsedGpb.srsId
                : 4326;

          const res = await client.query(
            `WITH raw AS (
               SELECT ST_Force2D(ST_GeomFromWKB($3::bytea, $4::int)) AS g
             ),
             reproj AS (
               SELECT CASE
                 WHEN $4::int = 4326 THEN ST_MakeValid(g)
                 ELSE ST_MakeValid(ST_Transform(g, 4326))
               END AS g4326
               FROM raw
             )
             INSERT INTO land_cover_exclusions (source, category, geom)
             SELECT $1, $2, g4326
             FROM reproj
             WHERE g4326 IS NOT NULL AND NOT ST_IsEmpty(g4326)`,
            [options.source, category, parsedGpb.wkb, epsgSrid],
          );
          if ((res.rowCount ?? 0) > 0) {
            importedCount += res.rowCount ?? 0;
          } else {
            skippedCount += 1;
          }
        }
      }

      await client.query('COMMIT');
      return { source: options.source, importedCount, skippedCount };
    } catch (err: unknown) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
      db.close();
    }
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(fileBuf.toString('utf8'));
  } catch {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Land-cover file is not valid GeoJSON or GeoPackage.',
    );
  }

  const root = parsedJson as {
    type?: unknown;
    features?: unknown[];
    geometry?: Record<string, unknown>;
    properties?: Record<string, unknown>;
  };

  const rawFeatures: Array<{
    geometry?: Record<string, unknown> | null;
    properties?: Record<string, unknown> | null;
  }> =
    root && root.type === 'FeatureCollection' && Array.isArray(root.features)
      ? (root.features as Array<{
          geometry?: Record<string, unknown> | null;
          properties?: Record<string, unknown> | null;
        }>)
      : root && root.type === 'Feature'
        ? [root]
        : [];

  const seedItems: LandCoverSeedItem[] = [];
  let skippedCount = 0;

  for (const feat of rawFeatures) {
    if (!feat || !feat.geometry || typeof feat.geometry !== 'object') {
      skippedCount += 1;
      continue;
    }
    const category = classifyLandCoverFeatureProperties(
      feat.properties ?? undefined,
      options.source,
      options.defaultCategory,
    );
    if (!category) {
      skippedCount += 1;
      continue;
    }
    seedItems.push({
      source: options.source,
      category,
      geoJsonGeometry: feat.geometry,
      srid: 4326,
    });
  }

  const importedCount = await seedLandCoverExclusions(
    pool,
    seedItems,
    options.replaceSource ? { replaceSource: options.source } : {},
  );
  return {
    source: options.source,
    importedCount,
    skippedCount,
  };
}
