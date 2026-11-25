// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 OpenUnseal Contributors

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
  type SpaceType,
  type SurfaceType,
} from '@openunseal/shared';

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
  spaceType?: SpaceType | null;
}

export interface ExtractedImportDataset {
  format: 'geojson' | 'gpkg';
  candidates: RawImportedCandidate[];
  preErrors: Array<{ featureIndex: number; reason: string }>;
  embeddedLicense?: string | null;
  embeddedAttribution?: string | null;
}

export interface ExtractImportDatasetOptions {
  waiverConfirmed?: boolean | undefined;
  sourceAttribution?: string | null | undefined;
}

export interface ImportLicenseValidationOptions {
  sourceAttribution?: string | null | undefined;
  waiverConfirmed?: boolean | undefined;
}

export interface ResolvedImportLicensePolicy {
  canonicalLicense: string;
  requiresAttribution: boolean;
  requiresWaiver: boolean;
}

const SQLITE_MAGIC = 'SQLite format 3\0';

const DIRECT_PUBLIC_DOMAIN_LICENSES: Readonly<Record<string, string>> = {
  'cc0-1.0': 'CC0-1.0',
  cc0: 'CC0-1.0',
  'cc0 1.0': 'CC0-1.0',
  'cc0 1.0 universal': 'CC0-1.0',
  'public domain': 'Public Domain',
  'pddl-1.0': 'PDDL-1.0',
  pddl: 'PDDL-1.0',
  'odc-pddl': 'PDDL-1.0',
  'dl-de/zero-2-0': 'dl-de/zero-2-0',
  'dl-de-zero-2.0': 'dl-de/zero-2-0',
};

const DIRECT_ATTRIBUTED_ODBL_LICENSES: Readonly<Record<string, string>> = {
  'odbl-1.0': 'ODbL-1.0',
  odbl: 'ODbL-1.0',
  'odbl 1.0': 'ODbL-1.0',
  'odc-odbl': 'ODbL-1.0',
};

const WAIVER_REQUIRED_IMPORT_LICENSES: Readonly<Record<string, string>> = {
  'dl-de/by-2-0': 'dl-de/by-2-0',
  'dl-de-by-2.0': 'dl-de/by-2-0',
  'cc-by-4.0': 'CC-BY-4.0',
  'cc by 4.0': 'CC-BY-4.0',
};

const INCOMPATIBLE_EMBEDDED_LICENSE_RE =
  /\b(?:cc[- ]?by[- ]?(?:nc|nd|sa)(?:[- ]?\d(?:\.\d)?)?|cc[- ]?by[- ]?[123](?:\.\d)?|dl[- ]?de\/by[- ]?1[- ]?0|odc[- ]?by(?:[- ]?1\.0)?|geonutzv|eupl(?:[- ]?\d(?:\.\d)?)?|(?:a|l)?gpl(?:[- ]?v?\d(?:\.\d)?)?|mpl[- ]?2\.0|non[- ]?commercial|no[- ]?derivatives|kommerziell\S*\s+ausgeschlossen|keine\s+bearbeitung|all\s+rights\s+reserved|alle\s+rechte\s+vorbehalten|proprietary|other[- ]closed|closed[- ]source|internal[- ]only|confidential)\b/i;

const WAIVER_REQUIRED_EMBEDDED_LICENSE_RE =
  /\b(?:cc[- ]?by[- ]?4\.0|dl[- ]?de\/by[- ]?2[- ]?0|datenlizenz\s+deutschland[^\n]{0,60}namensnennung)\b/i;

const ODBL_EMBEDDED_LICENSE_RE = /\b(?:odbl(?:[- ]?1\.0)?|odc[- ]?odbl)\b/i;

export function assertCompatibleImportLicenseParam(
  rawLicense: string,
  options: ImportLicenseValidationOptions = {},
): ResolvedImportLicensePolicy {
  const normalized = rawLicense.trim().toLowerCase().replace(/\s+/g, ' ');
  const attribution = options.sourceAttribution?.trim() ?? '';

  const publicDomainCanonical = DIRECT_PUBLIC_DOMAIN_LICENSES[normalized];
  if (publicDomainCanonical) {
    return {
      canonicalLicense: publicDomainCanonical,
      requiresAttribution: false,
      requiresWaiver: false,
    };
  }

  const odblCanonical = DIRECT_ATTRIBUTED_ODBL_LICENSES[normalized];
  if (odblCanonical) {
    if (attribution.length === 0) {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'Importing an ODbL-1.0 dataset requires a non-empty "attribution" (or "sourceAttribution") parameter or embedded GeoJSON attribution so upstream credits are preserved in export.geojson.',
      );
    }
    return {
      canonicalLicense: odblCanonical,
      requiresAttribution: true,
      requiresWaiver: false,
    };
  }

  const waiverCanonical = WAIVER_REQUIRED_IMPORT_LICENSES[normalized];
  if (waiverCanonical) {
    if (options.waiverConfirmed !== true) {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        `License "${waiverCanonical}" is not directly compatible with ODbL-1.0 without an explicit licensor waiver (per OSMF LWG guidance). Confirm a documented ODbL-1.0 waiver via waiverConfirmed=true together with attribution/sourceAttribution, or use CC0-1.0 / PDDL-1.0 / dl-de/zero-2-0 / ODbL-1.0 data.`,
      );
    }
    if (attribution.length === 0) {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        `Importing a waiver-confirmed "${waiverCanonical}" dataset requires a non-empty "attribution" (or "sourceAttribution") parameter or embedded GeoJSON attribution so upstream credits are preserved in export.geojson.`,
      );
    }
    return {
      canonicalLicense: waiverCanonical,
      requiresAttribution: true,
      requiresWaiver: true,
    };
  }

  throw new ApiError(
    422,
    'VALIDATION_ERROR',
    `Incompatible or unrecognized import license "${rawLicense.trim()}". Imported datasets enter the public ODbL-1.0 export and must be licensed under CC0-1.0, PDDL-1.0, dl-de/zero-2-0, Public Domain, attributed ODbL-1.0, or waiver-confirmed CC-BY-4.0 / dl-de/by-2-0.`,
  );
}

function assertCompatibleEmbeddedLicenseMetadata(
  rawValue: unknown,
  fieldLabel: string,
  options: ExtractImportDatasetOptions = {},
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
  if (WAIVER_REQUIRED_EMBEDDED_LICENSE_RE.test(trimmed)) {
    if (options.waiverConfirmed !== true) {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        `Uploaded dataset declares a waiver-gated license in ${fieldLabel} ("${trimmed.slice(0, 120)}"). Importing CC BY 4.0 or dl-de/by-2-0 data into the ODbL-1.0 export requires waiverConfirmed=true and a non-empty attribution.`,
      );
    }
    if (!options.sourceAttribution || options.sourceAttribution.trim().length === 0) {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        `Uploaded dataset declares an attributed license in ${fieldLabel} ("${trimmed.slice(0, 120)}") and requires a non-empty attribution so upstream credits are preserved in export.geojson.`,
      );
    }
  } else if (
    ODBL_EMBEDDED_LICENSE_RE.test(trimmed) &&
    (!options.sourceAttribution || options.sourceAttribution.trim().length === 0)
  ) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      `Uploaded dataset declares ODbL in ${fieldLabel} ("${trimmed.slice(0, 120)}") and requires a non-empty attribution so upstream credits are preserved in export.geojson.`,
    );
  }
}

function resolveSpaceTypeFromProps(
  props: Record<string, unknown> | null | undefined,
): SpaceType | null {
  const raw = props?.space_type ?? props?.spaceType;
  return raw === 'public' || raw === 'private' ? raw : null;
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

function extractFromGeoJsonBuffer(
  buffer: Buffer,
  options: ExtractImportDatasetOptions = {},
): ExtractedImportDataset {
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
  const embeddedAttribution =
    typeof rootRecord.attribution === 'string' &&
    rootRecord.attribution.trim().length > 0
      ? rootRecord.attribution.trim().slice(0, 500)
      : null;
  if (
    rootRecord.license !== undefined &&
    rootRecord.license !== null &&
    typeof rootRecord.license !== 'string'
  ) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'GeoJSON license field must be a string when present.',
    );
  }
  const rawEmbeddedLicense =
    typeof rootRecord.license === 'string' && rootRecord.license.trim().length > 0
      ? rootRecord.license.trim().slice(0, 120)
      : null;
  const effectiveOptions: ExtractImportDatasetOptions = {
    waiverConfirmed: options.waiverConfirmed,
    sourceAttribution: options.sourceAttribution?.trim() || embeddedAttribution,
  };
  let embeddedLicense: string | null = null;
  if (rawEmbeddedLicense !== null) {
    assertCompatibleEmbeddedLicenseMetadata(
      rawEmbeddedLicense,
      'GeoJSON license',
      effectiveOptions,
    );
    const policy = assertCompatibleImportLicenseParam(rawEmbeddedLicense, {
      sourceAttribution: effectiveOptions.sourceAttribution,
      waiverConfirmed: effectiveOptions.waiverConfirmed,
    });
    embeddedLicense = policy.canonicalLicense;
  }
  assertCompatibleEmbeddedLicenseMetadata(
    rootRecord.rights,
    'GeoJSON rights',
    effectiveOptions,
  );
  assertCompatibleEmbeddedLicenseMetadata(
    rootRecord.accessConstraints,
    'GeoJSON accessConstraints',
    effectiveOptions,
  );
  assertCompatibleEmbeddedLicenseMetadata(
    rootRecord.useLimitation,
    'GeoJSON useLimitation',
    effectiveOptions,
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
      spaceType: resolveSpaceTypeFromProps(entry.properties),
      note: resolveNoteFromProps(entry.properties),
    });
  });

  return {
    format: 'geojson',
    candidates,
    preErrors,
    embeddedLicense,
    embeddedAttribution,
  };
}

async function extractFromGpkgBuffer(
  buffer: Buffer,
  options: ExtractImportDatasetOptions = {},
): Promise<ExtractedImportDataset> {
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
    let metaRows: Array<{ metadata: string | null }> = [];
    try {
      metaRows = db
        .prepare('SELECT metadata FROM gpkg_metadata LIMIT 20')
        .all() as Array<{ metadata: string | null }>;
    } catch {
      // Optional gpkg_metadata table is absent in most GeoPackages
    }
    let contentDescRows: Array<{ description: string | null }> = [];
    try {
      contentDescRows = db
        .prepare('SELECT description FROM gpkg_contents LIMIT 20')
        .all() as Array<{ description: string | null }>;
    } catch {
      // Optional description column in gpkg_contents
    }

    let embeddedAttribution: string | null = null;
    for (const row of metaRows) {
      const raw = row.metadata?.trim() ?? '';
      if (!raw) {
        continue;
      }
      const creditXml = /<(?:[\w-]+:)?credit[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?credit>/i.exec(raw);
      const attrLine = /(?:^|\n)\s*(?:attribution|source|quelle)\s*:\s*([^\r\n<]+)/i.exec(raw);
      const copyrightLine = /(©[^\r\n<]{3,240})/.exec(raw);
      const extracted = (
        creditXml?.[1]?.replace(/<[^>]+>/g, ' ') ??
        attrLine?.[1] ??
        copyrightLine?.[1] ??
        ''
      )
        .replace(/\s+/g, ' ')
        .trim();
      if (extracted.length > 0) {
        embeddedAttribution = extracted.slice(0, 500);
        break;
      }
    }

    const effectiveGpkgOptions: ExtractImportDatasetOptions = {
      waiverConfirmed: options.waiverConfirmed,
      sourceAttribution: options.sourceAttribution?.trim() || embeddedAttribution,
    };

    let embeddedLicense: string | null = null;
    const allMetaEntries: Array<{ text: string; label: string }> = [
      ...metaRows
        .filter((r): r is { metadata: string } => typeof r.metadata === 'string' && r.metadata.trim().length > 0)
        .map((r) => ({ text: r.metadata, label: 'GeoPackage gpkg_metadata' })),
      ...contentDescRows
        .filter((r): r is { description: string } => typeof r.description === 'string' && r.description.trim().length > 0)
        .map((r) => ({ text: r.description, label: 'GeoPackage gpkg_contents.description' })),
    ];

    for (const entry of allMetaEntries) {
      assertCompatibleEmbeddedLicenseMetadata(
        entry.text,
        entry.label,
        effectiveGpkgOptions,
      );
      if (embeddedLicense !== null) {
        continue;
      }
      const plain = entry.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      let candidateToken: string | null = null;
      if (
        /\b(?:dl[- ]?de\/by[- ]?2[- ]?0|datenlizenz\s+deutschland[^\n]{0,60}namensnennung)\b/i.test(
          plain,
        )
      ) {
        candidateToken = 'dl-de/by-2-0';
      } else if (/\bcc[- ]?by[- ]?4\.0\b/i.test(plain)) {
        candidateToken = 'CC-BY-4.0';
      } else if (ODBL_EMBEDDED_LICENSE_RE.test(plain)) {
        candidateToken = 'ODbL-1.0';
      } else if (
        /\b(?:dl[- ]?de\/zero[- ]?2[- ]?0|datenlizenz\s+deutschland[^\n]{0,60}zero)\b/i.test(
          plain,
        )
      ) {
        candidateToken = 'dl-de/zero-2-0';
      } else if (/\b(?:pddl(?:[- ]?1\.0)?|odc[- ]?pddl)\b/i.test(plain)) {
        candidateToken = 'PDDL-1.0';
      } else if (/\bcc0(?:[- ]?1\.0)?\b/i.test(plain)) {
        candidateToken = 'CC0-1.0';
      } else if (/\bpublic\s+domain\b/i.test(plain)) {
        candidateToken = 'Public Domain';
      } else {
        const explicitLicMatch = /(?:^|\n|\s)(?:licen[cs]e|lizenz)\s*:\s*([^\r\n<,;]+)/i.exec(
          entry.text,
        );
        if (explicitLicMatch?.[1]?.trim()) {
          candidateToken = explicitLicMatch[1].trim();
        }
      }

      if (candidateToken !== null) {
        const policy = assertCompatibleImportLicenseParam(candidateToken, {
          sourceAttribution: effectiveGpkgOptions.sourceAttribution,
          waiverConfirmed: effectiveGpkgOptions.waiverConfirmed,
        });
        embeddedLicense = policy.canonicalLicense;
      }
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
          spaceType: resolveSpaceTypeFromProps(nonGeomProps),
          note: resolveNoteFromProps(nonGeomProps),
        });
      }
    }

    return {
      format: 'gpkg',
      candidates,
      preErrors,
      embeddedLicense,
      embeddedAttribution,
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
  options: ExtractImportDatasetOptions = {},
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
    return extractFromGpkgBuffer(buffer, options);
  }

  if (
    lowerName.endsWith('.geojson') ||
    lowerName.endsWith('.json') ||
    buffer.toString('utf8', 0, 64).trimStart().startsWith('{')
  ) {
    return extractFromGeoJsonBuffer(buffer, options);
  }

  throw new ApiError(
    415,
    'UNSUPPORTED_MEDIA_TYPE',
    'Unsupported file format. Please upload a .geojson or .gpkg file.',
  );
}
