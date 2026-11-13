import path from 'node:path';

import {
  AUTH_LIMITS,
  GEOMETRY_LIMITS,
  RuntimeConfigSchema,
  type RuntimeConfig,
} from '@entsiegelung/shared';

export interface SmtpConfig {
  host: string | null;
  port: number;
  secure: boolean;
  user: string | null;
  pass: string | null;
  from: string;
}

export interface EnvConfig {
  host: string;
  port: number;
  databaseUrl: string;
  trustProxy: boolean;
  corsOrigin: string;
  publicBaseUrl: string;
  uploadsDir: string;
  smtp: SmtpConfig;
  autoSeedVg250: boolean;
  osmStyleUrl: string;
  orthophoto: RuntimeConfig['orthophoto'];
  initialView: RuntimeConfig['initialView'];
  maxDailyPolygonsPerUser: number;
  sessionTtlDays: number;
  disclaimerText: string;
  abuseContact: string | null;
  privacyPolicyUrl: string;
  runtimeConfig: RuntimeConfig;
}

const DEFAULT_DISCLAIMER_TEXT =
  'Community unsealing suggestions — non-binding public input, regardless of property ownership.';
const DEFAULT_OSM_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const STRICT_NUMBER_RE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function parseFiniteNumber(raw: string | undefined, fallback: number, name: string): number {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return fallback;
  }
  if (!STRICT_NUMBER_RE.test(trimmed)) {
    throw new Error(`Invalid numeric environment variable ${name}: "${raw}"`);
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    throw new Error(`Environment variable ${name} must be a finite number.`);
  }
  return value;
}

function parseIntSetting(raw: string | undefined, fallback: number, name: string): number {
  const value = parseFiniteNumber(raw, fallback, name);
  if (!Number.isInteger(value)) {
    throw new Error(`Environment variable ${name} must be an integer.`);
  }
  return value;
}

function parseBooleanSetting(raw: string | undefined, fallback: boolean, name: string): boolean {
  const trimmed = raw?.trim().toLowerCase();
  if (!trimmed) {
    return fallback;
  }
  if (trimmed === 'true' || trimmed === '1') {
    return true;
  }
  if (trimmed === 'false' || trimmed === '0') {
    return false;
  }
  throw new Error(`Environment variable ${name} must be "true" or "false" (received "${raw}").`);
}

function parseOrthophotoTileSize(raw: string | undefined): 256 | 512 {
  const size = parseIntSetting(raw, 256, 'ORTHOPHOTO_TILE_SIZE');
  if (size !== 256 && size !== 512) {
    throw new Error(
      `ORTHOPHOTO_TILE_SIZE must be 256 or 512 (received ${size}).`,
    );
  }
  return size;
}

function parseOrthophotoBounds(
  raw: string | undefined,
): [number, number, number, number] | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }
  const parts = trimmed.split(',');
  if (parts.length !== 4) {
    throw new Error(
      'ORTHOPHOTO_BOUNDS must contain 4 comma-separated numbers: minLng,minLat,maxLng,maxLat.',
    );
  }
  const coords = parts.map((part) => {
    const token = part.trim();
    if (!STRICT_NUMBER_RE.test(token)) {
      throw new Error(`ORTHOPHOTO_BOUNDS contains invalid coordinate "${part}".`);
    }
    const num = Number(token);
    if (!Number.isFinite(num)) {
      throw new Error(`ORTHOPHOTO_BOUNDS contains non-finite coordinate "${part}".`);
    }
    return num;
  });

  const minLng = coords[0]!;
  const minLat = coords[1]!;
  const maxLng = coords[2]!;
  const maxLat = coords[3]!;

  if (minLng < -180 || maxLng > 180 || minLat < -90 || maxLat > 90) {
    throw new Error('ORTHOPHOTO_BOUNDS coordinates are outside WGS 84 geographic bounds.');
  }
  if (minLng >= maxLng || minLat >= maxLat) {
    throw new Error(
      'ORTHOPHOTO_BOUNDS must satisfy minLng < maxLng and minLat < maxLat.',
    );
  }
  return [minLng, minLat, maxLng, maxLat];
}

export function loadEnvConfig(env: NodeJS.ProcessEnv = process.env): EnvConfig {
  const host = env.HOST?.trim() || '0.0.0.0';
  const port = parseIntSetting(env.PORT, 3000, 'PORT');
  if (port < 0 || port > 65535) {
    throw new Error(`PORT must be between 0 and 65535 (received ${port}).`);
  }

  const pgUser = env.POSTGRES_USER?.trim() || 'ppgis';
  const pgPassword = env.POSTGRES_PASSWORD?.trim() || 'ppgis';
  const pgDb = env.POSTGRES_DB?.trim() || 'ppgis';
  const databaseUrl =
    env.DATABASE_URL?.trim() ||
    `postgresql://${encodeURIComponent(pgUser)}:${encodeURIComponent(pgPassword)}@127.0.0.1:5432/${encodeURIComponent(pgDb)}`;

  const trustProxy = parseBooleanSetting(env.TRUST_PROXY, false, 'TRUST_PROXY');
  const corsOrigin = env.CORS_ORIGIN?.trim() || '*';
  const osmStyleUrl = env.OSM_STYLE_URL?.trim() || DEFAULT_OSM_STYLE_URL;

  const defaultBasePort = port === 80 || port === 443 ? '' : `:${port || 3000}`;
  const rawPublicBaseUrl =
    env.PUBLIC_BASE_URL?.trim() || `http://127.0.0.1${defaultBasePort}`;
  const publicBaseUrl = rawPublicBaseUrl.replace(/\/+$/, '');

  const uploadsDir = env.UPLOADS_DIR?.trim()
    ? path.resolve(env.UPLOADS_DIR.trim())
    : path.resolve(process.cwd(), 'uploads');

  const smtpHostRaw = env.SMTP_HOST?.trim() ?? '';
  const smtpPort = parseIntSetting(env.SMTP_PORT, 587, 'SMTP_PORT');
  const smtpSecure = parseBooleanSetting(
    env.SMTP_SECURE,
    smtpPort === 465,
    'SMTP_SECURE',
  );
  const smtpUserRaw = env.SMTP_USER?.trim() ?? '';
  const smtpPassRaw = env.SMTP_PASS ?? '';
  const smtpFrom =
    env.SMTP_FROM?.trim() || 'Unseal <noreply@localhost>';

  const smtp: SmtpConfig = {
    host: smtpHostRaw.length > 0 ? smtpHostRaw : null,
    port: smtpPort,
    secure: smtpSecure,
    user: smtpUserRaw.length > 0 ? smtpUserRaw : null,
    pass: smtpPassRaw.length > 0 ? smtpPassRaw : null,
    from: smtpFrom,
  };

  const autoSeedVg250 = parseBooleanSetting(
    env.AUTO_SEED_VG250,
    false,
    'AUTO_SEED_VG250',
  );

  const tileSize = parseOrthophotoTileSize(env.ORTHOPHOTO_TILE_SIZE);
  const orthophotoBounds = parseOrthophotoBounds(env.ORTHOPHOTO_BOUNDS);
  const orthophotoMaxZoom = parseIntSetting(env.ORTHOPHOTO_MAX_ZOOM, 20, 'ORTHOPHOTO_MAX_ZOOM');
  const orthophotoAttribution = env.ORTHOPHOTO_ATTRIBUTION?.trim() ?? '';
  const orthophotoUrlTemplate = env.ORTHOPHOTO_URL_TEMPLATE?.trim() ?? '';

  let orthophoto: RuntimeConfig['orthophoto'] = null;
  if (orthophotoUrlTemplate.length > 0) {
    if (
      !orthophotoUrlTemplate.includes('{z}/{x}/{y}') &&
      !orthophotoUrlTemplate.includes('{bbox-epsg-3857}')
    ) {
      throw new Error(
        'ORTHOPHOTO_URL_TEMPLATE must contain "{z}/{x}/{y}" or "{bbox-epsg-3857}".',
      );
    }
    orthophoto = {
      urlTemplate: orthophotoUrlTemplate,
      tileSize,
      attribution: orthophotoAttribution,
      bounds: orthophotoBounds,
      maxZoom: orthophotoMaxZoom,
    };
  }

  const initialLng = parseFiniteNumber(env.INITIAL_LNG, 9.9937, 'INITIAL_LNG');
  const initialLat = parseFiniteNumber(env.INITIAL_LAT, 53.5511, 'INITIAL_LAT');
  const initialZoom = parseFiniteNumber(env.INITIAL_ZOOM, 15, 'INITIAL_ZOOM');

  const maxDailyPolygonsPerUser = parseIntSetting(
    env.MAX_DAILY_POLYGONS_PER_USER,
    25,
    'MAX_DAILY_POLYGONS_PER_USER',
  );
  const sessionTtlDays = parseIntSetting(
    env.SESSION_TTL_DAYS,
    AUTH_LIMITS.SESSION_TTL_DAYS,
    'SESSION_TTL_DAYS',
  );
  if (sessionTtlDays < 1) {
    throw new Error('SESSION_TTL_DAYS must be at least 1.');
  }

  const disclaimerText = env.DISCLAIMER_TEXT?.trim() || DEFAULT_DISCLAIMER_TEXT;
  const rawAbuseContact = env.ABUSE_CONTACT?.trim() ?? '';
  const abuseContact = rawAbuseContact.length > 0 ? rawAbuseContact : null;
  const privacyPolicyUrl =
    env.PRIVACY_POLICY_URL?.trim() || `${publicBaseUrl}/auth/privacy`;

  const runtimeConfig = RuntimeConfigSchema.parse({
    osmStyleUrl,
    orthophoto,
    initialView: {
      lng: initialLng,
      lat: initialLat,
      zoom: initialZoom,
    },
    limits: {
      minAreaM2: GEOMETRY_LIMITS.MIN_AREA_M2,
      maxAreaM2: GEOMETRY_LIMITS.MAX_AREA_M2,
      maxVertices: GEOMETRY_LIMITS.MAX_VERTICES,
      maxPolygonSpanDeg: GEOMETRY_LIMITS.MAX_POLYGON_SPAN_DEG,
      maxBboxSpanDeg: GEOMETRY_LIMITS.MAX_BBOX_SPAN_DEG,
      bboxFeatureLimit: GEOMETRY_LIMITS.BBOX_FEATURE_LIMIT,
      maxDailyPolygonsPerUser,
    },
    disclaimerText,
    abuseContact,
    privacyPolicyUrl,
  });

  return {
    host,
    port,
    databaseUrl,
    trustProxy,
    corsOrigin,
    publicBaseUrl,
    uploadsDir,
    smtp,
    autoSeedVg250,
    osmStyleUrl: runtimeConfig.osmStyleUrl,
    orthophoto: runtimeConfig.orthophoto,
    initialView: runtimeConfig.initialView,
    maxDailyPolygonsPerUser: runtimeConfig.limits.maxDailyPolygonsPerUser,
    sessionTtlDays,
    disclaimerText: runtimeConfig.disclaimerText,
    abuseContact: runtimeConfig.abuseContact,
    privacyPolicyUrl,
    runtimeConfig,
  };
}
