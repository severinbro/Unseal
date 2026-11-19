// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Unseal Contributors

import fs from 'node:fs/promises';

import type { FastifyBaseLogger } from 'fastify';
import type pg from 'pg';

export const DEFAULT_BKG_VG250_WFS_URL =
  'https://sgx.geodatenzentrum.de/wfs_vg250';

export interface MunicipalitySeedInput {
  ags: string;
  name: string;
  designation?: string | null;
  stateCode?: string | null;
  geoJsonGeometry: string;
}

export interface LoadVg250Result {
  upsertedMunicipalities: number;
  backfilledPolygons: number;
}

const WFS_PAGE_SIZE = 2_500;

interface WfsFeatureCollection {
  features?: Array<{
    geometry?: unknown;
    properties?: Record<string, unknown> | null;
  }>;
}

export async function upsertMunicipalitiesAndBackfill(
  pool: pg.Pool,
  entries: readonly MunicipalitySeedInput[],
): Promise<LoadVg250Result> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let upserted = 0;
    const batchSize = 250;
    for (let offset = 0; offset < entries.length; offset += batchSize) {
      const slice = entries.slice(offset, offset + batchSize);
      const agsArr: string[] = [];
      const nameArr: string[] = [];
      const desigArr: Array<string | null> = [];
      const stateArr: Array<string | null> = [];
      const geomJsonArr: string[] = [];

      for (const item of slice) {
        agsArr.push(item.ags);
        nameArr.push(item.name);
        desigArr.push(item.designation ?? null);
        stateArr.push(item.stateCode ?? null);
        geomJsonArr.push(item.geoJsonGeometry);
      }

      const res = await client.query(
        `WITH raw AS (
           SELECT *
           FROM unnest(
             $1::text[],
             $2::text[],
             $3::text[],
             $4::text[],
             $5::text[]
           ) AS t(ags, name, designation, state_code, geom_json)
         ),
         grouped AS (
           SELECT
             ags,
             MAX(name) AS name,
             MAX(designation) AS designation,
             MAX(state_code) AS state_code,
             ST_Multi(
               ST_CollectionExtract(
                 ST_MakeValid(
                   ST_Union(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(geom_json), 4326)))
                 ),
                 3
               )
             ) AS geom
           FROM raw
           GROUP BY ags
         )
         INSERT INTO municipalities (ags, name, designation, state_code, geom, updated_at)
         SELECT ags, name, designation, state_code, geom, NOW()
         FROM grouped
         WHERE geom IS NOT NULL AND NOT ST_IsEmpty(geom)
         ON CONFLICT (ags) DO UPDATE
         SET
           name = EXCLUDED.name,
           designation = COALESCE(EXCLUDED.designation, municipalities.designation),
           state_code = COALESCE(EXCLUDED.state_code, municipalities.state_code),
           geom = ST_Multi(
             ST_CollectionExtract(
               ST_MakeValid(ST_Union(municipalities.geom, EXCLUDED.geom)),
               3
             )
           ),
           updated_at = NOW()`,
        [agsArr, nameArr, desigArr, stateArr, geomJsonArr],
      );
      upserted += res.rowCount ?? 0;
    }

    const backfillRes = await client.query(
      `UPDATE polygons AS p
       SET municipality_id = m.id
       FROM municipalities AS m
       WHERE p.municipality_id IS NULL
         AND ST_Covers(m.geom, ST_PointOnSurface(p.geom))`,
    );

    await client.query('COMMIT');
    return {
      upsertedMunicipalities: upserted,
      backfilledPolygons: backfillRes.rowCount ?? 0,
    };
  } catch (err: unknown) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback error
    }
    throw err;
  } finally {
    client.release();
  }
}

function parseVg250Features(fc: WfsFeatureCollection): MunicipalitySeedInput[] {
  const out: MunicipalitySeedInput[] = [];
  if (!Array.isArray(fc.features)) {
    return out;
  }

  for (const feature of fc.features) {
    if (!feature || typeof feature.geometry !== 'object' || feature.geometry === null) {
      continue;
    }
    const props = feature.properties ?? {};
    const agsRaw = props.ags ?? props.AGS;
    const nameRaw = props.gen ?? props.GEN ?? props.name ?? props.NAME;
    const bezRaw = props.bez ?? props.BEZ ?? null;
    const lkzRaw = props.lkz ?? props.LKZ ?? props.sn_l ?? null;
    const gfRaw = props.gf ?? props.GF;

    if (typeof gfRaw === 'number' && gfRaw !== 4) {
      continue;
    }
    if (typeof agsRaw !== 'string' || agsRaw.trim().length === 0) {
      continue;
    }
    if (typeof nameRaw !== 'string' || nameRaw.trim().length === 0) {
      continue;
    }

    out.push({
      ags: agsRaw.trim(),
      name: nameRaw.trim(),
      designation: typeof bezRaw === 'string' ? bezRaw.trim() : null,
      stateCode: typeof lkzRaw === 'string' ? lkzRaw.trim() : null,
      geoJsonGeometry: JSON.stringify(feature.geometry),
    });
  }

  return out;
}

export async function loadVg250Municipalities(
  pool: pg.Pool,
  source?: string,
  logger?: FastifyBaseLogger,
): Promise<LoadVg250Result> {
  const trimmedSource = source?.trim() ?? '';

  if (trimmedSource.length > 0 && !/^https?:\/\//i.test(trimmedSource)) {
    const rawJson = await fs.readFile(trimmedSource, 'utf8');
    const fc = JSON.parse(rawJson) as WfsFeatureCollection;
    const entries = parseVg250Features(fc);
    logger?.info(
      { file: trimmedSource, parsedCount: entries.length },
      'Parsed local BKG VG250 GeoJSON file',
    );
    return upsertMunicipalitiesAndBackfill(pool, entries);
  }

  const baseWfsUrl =
    trimmedSource.length > 0 ? trimmedSource : DEFAULT_BKG_VG250_WFS_URL;
  const allEntries: MunicipalitySeedInput[] = [];
  let startIndex = 0;

  for (let page = 0; page < 20; page++) {
    const url = new URL(baseWfsUrl);
    url.searchParams.set('SERVICE', 'WFS');
    url.searchParams.set('VERSION', '2.0.0');
    url.searchParams.set('REQUEST', 'GetFeature');
    url.searchParams.set('TYPENAMES', 'vg250:vg250_gem');
    url.searchParams.set('SRSNAME', 'EPSG:4326');
    url.searchParams.set('OUTPUTFORMAT', 'application/json');
    url.searchParams.set('CQL_FILTER', 'gf=4');
    url.searchParams.set('STARTINDEX', String(startIndex));
    url.searchParams.set('COUNT', String(WFS_PAGE_SIZE));

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `BKG VG250 WFS request failed with HTTP ${response.status} at startIndex=${startIndex}.`,
      );
    }

    const fc = (await response.json()) as WfsFeatureCollection;
    const batch = parseVg250Features(fc);
    allEntries.push(...batch);

    logger?.info(
      { page: page + 1, fetched: batch.length, totalSoFar: allEntries.length },
      'Fetched BKG VG250 WFS municipality batch',
    );

    const rawCount = Array.isArray(fc.features) ? fc.features.length : 0;
    if (rawCount < WFS_PAGE_SIZE) {
      break;
    }
    startIndex += rawCount;
  }

  return upsertMunicipalitiesAndBackfill(pool, allEntries);
}

export async function ensureMunicipalitiesSeededIfEnabled(
  pool: pg.Pool,
  autoSeed: boolean,
  logger: FastifyBaseLogger,
): Promise<void> {
  if (!autoSeed) {
    return;
  }
  const countRes = await pool.query<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM municipalities',
  );
  const existingCount = countRes.rows[0]?.count ?? 0;
  if (existingCount > 0) {
    logger.info(
      { municipalityCount: existingCount },
      'BKG VG250 municipalities already populated; skipping auto-seed',
    );
    return;
  }

  logger.info(
    'AUTO_SEED_VG250 enabled and municipalities table is empty; downloading BKG VG250 German municipalities...',
  );
  const res = await loadVg250Municipalities(pool, undefined, logger);
  logger.info(
    {
      upsertedMunicipalities: res.upsertedMunicipalities,
      backfilledPolygons: res.backfilledPolygons,
    },
    'Completed BKG VG250 municipality auto-seed',
  );
}
