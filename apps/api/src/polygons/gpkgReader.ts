// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Unseal Contributors

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  ApiError,
  GEOMETRY_LIMITS,
  IMPORT_LIMITS,
  SURFACE_TYPES,
  type SurfaceType,
} from '@entsiegelung/shared';

export interface ParsedGpbGeometry {
  srsId: number;
  wkb: Buffer;
}

export interface RawImportedCandidate {
  featureIndex: number;
  kind: 'geojson' | 'wkb';
  srid: number;
  srsWkt?: string;
  geoJsonGeometry?: string;
  wkb?: Buffer;
  surfaceType: SurfaceType;
  note: string | null;
}

export interface ExtractedImportDataset {
  format: 'geojson' | 'gpkg';
  candidates: RawImportedCandidate[];
  preErrors: Array<{ featureIndex: number; reason: string }>;
}

const SQLITE_MAGIC = 'SQLite format 3\0';

const COMPATIBLE_EXPLICIT_IMPORT_LICENSES = new Set([
  'odbl-1.0',
  'odbl',
  'odc-odbl',
  'cc0-1.0',
  'cc0',
  'cc0 1.0',
  'public domain',
  'pddl-1.0',
  'pddl',
  'dl-de/zero-2-0',
  'dl-de/by-2-0',
  'cc-by-4.0',
  'cc by 4.0',
]);

const INCOMPATIBLE_EMBEDDED_LICENSE_RE =
  /\b(?:cc[- ]?by[- ]?(?:nc|nd|sa)(?:[- ]?\d(?:\.\d)?)?|non[- ]?commercial|no[- ]?derivatives|kommerziell\S*\s+ausgeschlossen|keine\s+bearbeitung|all\s+rights\s+reserved|alle\s+rechte\s+vorbehalten|proprietary|other[- ]closed|closed[- ]source|internal[- ]only|confidential)\b/i;

export function assertCompatibleImportLicenseParam(rawLicense: string): void {
  const normalized = rawLicense.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!COMPATIBLE_EXPLICIT_IMPORT_LICENSES.has(normalized)) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      `Incompatible or unrecognized import license "${rawLicense.trim()}". Imported datasets enter the public ODbL-1.0 export and must be licensed under ODbL-1.0, CC0-1.0, dl-de/zero-2-0, dl-de/by-2-0, or CC-BY-4.0.`,
    );
  }
}

function assertCompatibleEmbeddedLicenseMetadata(
  rawValue: unknown,
  fieldLabel: string,
): void {
  if (typeof rawValue !== 'string') {
    return;
  }
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    return;
  }
  if (INCOMPATIBLE_EMBEDDED_LICENSE_RE.test(trimmed)) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      `Uploaded dataset declares an incompatible license/restriction in ${fieldLabel} ("${trimmed.slice(0, 120)}"). Imported datasets enter the public ODbL-1.0 export and cannot include non-commercial, no-derivatives, share-alike-incompatible, or proprietary restrictions.`,
    );
  }
}

function quoteSqliteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

function envelopeByteLength(indicator: number): number {
  switch (indicator) {
    case 0:
      return 0;
    case 1:
      return 32;
    case 2:
    case 3:
      return 48;
    case 4:
      return 64;
    default:
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        `Unsupported GeoPackage binary envelope indicator: ${indicator}.`,
      );
  }
}

export function parseGeoPackageBinary(blob: Uint8Array): ParsedGpbGeometry | null {
  if (blob.byteLength < 8) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'GeoPackage geometry blob is shorter than the 8-byte GPB header.',
    );
  }
  if (blob[0] !== 0x47 || blob[1] !== 0x50) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Invalid GeoPackage geometry magic header (expected "GP").',
    );
  }

  const flags = blob[3]!;
  const isEmpty = (flags & 0x10) !== 0;
  if (isEmpty) {
    return null;
  }

  const littleEndian = (flags & 0x01) === 1;
  const indicator = (flags >> 1) & 0x07;
  const envBytes = envelopeByteLength(indicator);
  const wkbOffset = 8 + envBytes;

  if (blob.byteLength <= wkbOffset) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'GeoPackage geometry blob contains no WKB payload.',
    );
  }

  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const srsId = view.getInt32(4, littleEndian);
  const wkb = Buffer.from(blob.subarray(wkbOffset));

  return { srsId, wkb };
}

function resolveSurfaceTypeFromProps(props: Record<string, unknown>): SurfaceType {
  const keys = [
    'surfaceType',
    'surface_type',
    'surfacetype',
    'belag',
    'material',
    'surface',
  ];
  for (const key of keys) {
    const val = props[key];
    if (typeof val === 'string') {
      const normalized = val.trim().toLowerCase();
      if ((SURFACE_TYPES as readonly string[]).includes(normalized)) {
        return normalized as SurfaceType;
      }
      if (normalized === 'beton') {
        return 'concrete';
      }
      if (normalized === 'pflaster' || normalized === 'pflastersteine') {
        return 'pavers';
      }
      if (normalized === 'sonstiges') {
        return 'other';
      }
    }
  }
  return 'other';
}

function resolveNoteFromProps(props: Record<string, unknown>): string | null {
  const keys = [
    'note',
    'notiz',
    'beschreibung',
    'description',
    'kommentar',
    'comment',
    'name',
  ];
  for (const key of keys) {
    const val = props[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim().slice(0, GEOMETRY_LIMITS.MAX_NOTE_LENGTH);
    }
  }
  return null;
}

function parseEpsgCodeFromCrsObject(crs: unknown): number {
  if (typeof crs !== 'object' || crs === null) {
    return 4326;
  }
  const props = (crs as { properties?: unknown }).properties;
  if (typeof props !== 'object' || props === null) {
    return 4326;
  }
  const name = (props as { name?: unknown }).name;
  if (typeof name !== 'string') {
    return 4326;
  }
  if (/CRS84/i.test(name)) {
    return 4326;
  }
  const match = /EPSG(?:[:/]+[\d.]*)?[:/]+(\d{4,6})/i.exec(name);
  if (match && match[1]) {
    const code = Number(match[1]);
    if (Number.isInteger(code) && code > 0) {
      return code;
    }
  }
  return 4326;
}

function extractFromGeoJsonBuffer(buffer: Buffer): ExtractedImportDataset {
  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Uploaded GeoJSON file contains invalid JSON.',
    );
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'GeoJSON root must be an object.',
    );
  }

  const rootRecord = parsed as Record<string, unknown>;
  assertCompatibleEmbeddedLicenseMetadata(rootRecord.license, 'GeoJSON license');
  assertCompatibleEmbeddedLicenseMetadata(rootRecord.rights, 'GeoJSON rights');
  assertCompatibleEmbeddedLicenseMetadata(
    rootRecord.accessConstraints,
    'GeoJSON accessConstraints',
  );
  assertCompatibleEmbeddedLicenseMetadata(
    rootRecord.useLimitation,
    'GeoJSON useLimitation',
  );
  const rootSrid = parseEpsgCodeFromCrsObject(rootRecord.crs);
  const rootType = rootRecord.type;

  const rawFeatures: Array<{
    geometry: unknown;
    properties: Record<string, unknown>;
  }> = [];

  if (rootType === 'FeatureCollection') {
    if (!Array.isArray(rootRecord.features)) {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'GeoJSON FeatureCollection is missing a features array.',
      );
    }
    for (const item of rootRecord.features) {
      if (typeof item === 'object' && item !== null) {
        const rec = item as Record<string, unknown>;
        const props =
          typeof rec.properties === 'object' && rec.properties !== null
            ? (rec.properties as Record<string, unknown>)
            : {};
        rawFeatures.push({ geometry: rec.geometry, properties: props });
      } else {
        rawFeatures.push({ geometry: null, properties: {} });
      }
    }
  } else if (rootType === 'Feature') {
    const props =
      typeof rootRecord.properties === 'object' &&
      rootRecord.properties !== null
        ? (rootRecord.properties as Record<string, unknown>)
        : {};
    rawFeatures.push({ geometry: rootRecord.geometry, properties: props });
  } else if (rootType === 'Polygon' || rootType === 'MultiPolygon') {
    rawFeatures.push({ geometry: rootRecord, properties: {} });
  } else {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'GeoJSON must be a FeatureCollection, Feature, Polygon, or MultiPolygon.',
    );
  }

  if (rawFeatures.length > IMPORT_LIMITS.MAX_FEATURES_PER_IMPORT) {
    throw new ApiError(
      422,
      'PAYLOAD_TOO_LARGE',
      `Import exceeds maximum of ${IMPORT_LIMITS.MAX_FEATURES_PER_IMPORT} features per upload.`,
    );
  }

  const candidates: RawImportedCandidate[] = [];
  const preErrors: Array<{ featureIndex: number; reason: string }> = [];

  rawFeatures.forEach((entry, index) => {
    if (typeof entry.geometry !== 'object' || entry.geometry === null) {
      preErrors.push({
        featureIndex: index,
        reason: 'Missing geometry object.',
      });
      return;
    }
    const geomType = (entry.geometry as { type?: unknown }).type;
    if (geomType !== 'Polygon' && geomType !== 'MultiPolygon') {
      preErrors.push({
        featureIndex: index,
        reason: `Unsupported geometry type "${String(geomType)}" (expected Polygon or MultiPolygon).`,
      });
      return;
    }
    candidates.push({
      featureIndex: index,
      kind: 'geojson',
      srid: rootSrid,
      geoJsonGeometry: JSON.stringify(entry.geometry),
      surfaceType: resolveSurfaceTypeFromProps(entry.properties),
      note: resolveNoteFromProps(entry.properties),
    });
  });

  return {
    format: 'geojson',
    candidates,
    preErrors,
  };
}

async function extractFromGpkgBuffer(buffer: Buffer): Promise<ExtractedImportDataset> {
  const tempPath = path.join(
    os.tmpdir(),
    `ppgis-import-${crypto.randomUUID()}.gpkg`,
  );
  await fs.writeFile(tempPath, buffer, { mode: 0o600 });

  let db: DatabaseSync | null = null;
  try {
    try {
      db = new DatabaseSync(tempPath, { readOnly: true });
      db.exec('PRAGMA trusted_schema = OFF; PRAGMA query_only = ON;');
    } catch {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'Invalid or corrupted GeoPackage (.gpkg) SQLite file.',
      );
    }

    const srsMap = new Map<number, number>();
    const srsWktMap = new Map<number, string>();
    try {
      const metaRows = db
        .prepare('SELECT metadata FROM gpkg_metadata LIMIT 20')
        .all() as Array<{ metadata: string | null }>;
      for (const metaRow of metaRows) {
        assertCompatibleEmbeddedLicenseMetadata(
          metaRow.metadata,
          'GeoPackage gpkg_metadata',
        );
      }
    } catch {
      // Optional gpkg_metadata table is absent in most GeoPackages
    }
    try {
      const srsRows = db
        .prepare(
          'SELECT srs_name, srs_id, organization, organization_coordsys_id, definition FROM gpkg_spatial_ref_sys',
        )
        .all() as Array<{
        srs_name: string | null;
        srs_id: number;
        organization: string | null;
        organization_coordsys_id: number | null;
        definition: string | null;
      }>;
      for (const srs of srsRows) {
        if (typeof srs.srs_id !== 'number') {
          continue;
        }
        if (
          typeof srs.organization_coordsys_id === 'number' &&
          srs.organization_coordsys_id > 0 &&
          (!srs.organization || /^epsg$/i.test(srs.organization))
        ) {
          srsMap.set(srs.srs_id, srs.organization_coordsys_id);
          continue;
        }
        if (
          (/^ogc$/i.test(srs.organization ?? '') &&
            srs.organization_coordsys_id === 84) ||
          /CRS84/i.test(srs.srs_name ?? '')
        ) {
          srsMap.set(srs.srs_id, 4326);
          continue;
        }
        const trimmedDef = srs.definition?.trim() ?? '';
        if (
          trimmedDef.length > 0 &&
          !/^undefined$/i.test(trimmedDef)
        ) {
          srsWktMap.set(srs.srs_id, trimmedDef);
        }
      }
    } catch {
      // Optional table lookup fallback
    }

    let geomTables: Array<{
      table_name: string;
      column_name: string;
      srs_id: number;
    }> = [];
    try {
      geomTables = db
        .prepare(
          `SELECT gc.table_name, gc.column_name, gc.srs_id
           FROM gpkg_geometry_columns gc
           INNER JOIN sqlite_master sm
             ON sm.type = 'table' AND sm.name = gc.table_name`,
        )
        .all() as Array<{
        table_name: string;
        column_name: string;
        srs_id: number;
      }>;
    } catch {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'GeoPackage is missing the required gpkg_geometry_columns metadata table.',
      );
    }

    if (geomTables.length === 0) {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'GeoPackage contains no vector feature tables.',
      );
    }

    const candidates: RawImportedCandidate[] = [];
    const preErrors: Array<{ featureIndex: number; reason: string }> = [];
    let globalIndex = 0;

    for (const layer of geomTables) {
      const quotedTable = quoteSqliteIdent(layer.table_name);
      const rows = db
        .prepare(
          `SELECT * FROM ${quotedTable} LIMIT ${IMPORT_LIMITS.MAX_FEATURES_PER_IMPORT + 1}`,
        )
        .all() as Array<Record<string, unknown>>;

      if (globalIndex + rows.length > IMPORT_LIMITS.MAX_FEATURES_PER_IMPORT) {
        throw new ApiError(
          422,
          'PAYLOAD_TOO_LARGE',
          `Import exceeds maximum of ${IMPORT_LIMITS.MAX_FEATURES_PER_IMPORT} features per upload.`,
        );
      }

      const defaultEpsg =
        srsMap.get(layer.srs_id) ?? (layer.srs_id > 0 ? layer.srs_id : 4326);

      for (const row of rows) {
        const currentIndex = globalIndex++;
        const rawGeom = row[layer.column_name];
        if (!(rawGeom instanceof Uint8Array)) {
          preErrors.push({
            featureIndex: currentIndex,
            reason: 'Missing binary geometry value in GeoPackage row.',
          });
          continue;
        }

        let parsedGpb: ParsedGpbGeometry | null;
        try {
          parsedGpb = parseGeoPackageBinary(rawGeom);
        } catch (gpbErr: unknown) {
          preErrors.push({
            featureIndex: currentIndex,
            reason:
              gpbErr instanceof Error
                ? gpbErr.message
                : 'Invalid GeoPackage binary geometry.',
          });
          continue;
        }

        if (parsedGpb === null) {
          preErrors.push({
            featureIndex: currentIndex,
            reason: 'Empty geometry in GeoPackage row.',
          });
          continue;
        }

        const explicitEpsg =
          srsMap.get(parsedGpb.srsId) ?? srsMap.get(layer.srs_id);
        const customWkt =
          explicitEpsg === undefined
            ? (srsWktMap.get(parsedGpb.srsId) ?? srsWktMap.get(layer.srs_id))
            : undefined;
        const resolvedSrid =
          explicitEpsg ??
          (customWkt !== undefined
            ? 0
            : parsedGpb.srsId > 0
              ? parsedGpb.srsId
              : defaultEpsg);

        const nonGeomProps: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row)) {
          if (k !== layer.column_name) {
            nonGeomProps[k] = v;
          }
        }

        candidates.push({
          featureIndex: currentIndex,
          kind: 'wkb',
          srid: resolvedSrid,
          ...(customWkt !== undefined ? { srsWkt: customWkt } : {}),
          wkb: parsedGpb.wkb,
          surfaceType: resolveSurfaceTypeFromProps(nonGeomProps),
          note: resolveNoteFromProps(nonGeomProps),
        });
      }
    }

    return {
      format: 'gpkg',
      candidates,
      preErrors,
    };
  } finally {
    try {
      db?.close();
    } catch {
      // ignore close errors
    }
    await fs.unlink(tempPath).catch(() => undefined);
  }
}

export async function extractImportDataset(
  buffer: Buffer,
  fileName: string,
): Promise<ExtractedImportDataset> {
  if (buffer.byteLength === 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Uploaded file is empty.');
  }
  if (buffer.byteLength > IMPORT_LIMITS.MAX_FILE_BYTES) {
    throw new ApiError(
      413,
      'PAYLOAD_TOO_LARGE',
      `Import file exceeds ${Math.round(IMPORT_LIMITS.MAX_FILE_BYTES / (1024 * 1024))} MB limit.`,
    );
  }

  const lowerName = fileName.trim().toLowerCase();
  const hasSqliteHeader =
    buffer.byteLength >= 16 &&
    buffer.subarray(0, 16).toString('latin1') === SQLITE_MAGIC;

  if (hasSqliteHeader || lowerName.endsWith('.gpkg')) {
    if (!hasSqliteHeader) {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'File has .gpkg extension but is not a valid SQLite GeoPackage.',
      );
    }
    return extractFromGpkgBuffer(buffer);
  }

  if (
    lowerName.endsWith('.geojson') ||
    lowerName.endsWith('.json') ||
    buffer.toString('utf8', 0, 64).trimStart().startsWith('{')
  ) {
    return extractFromGeoJsonBuffer(buffer);
  }

  throw new ApiError(
    415,
    'UNSUPPORTED_MEDIA_TYPE',
    'Unsupported file format. Please upload a .geojson or .gpkg file.',
  );
}
