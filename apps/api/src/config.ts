// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Unseal Contributors

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  AUTH_LIMITS,
  GEOMETRY_LIMITS,
  RuntimeConfigSchema,
  TRUST_AND_MODERATION_LIMITS,
  type RuntimeConfig,
} from '@entsiegelung/shared';

import {
  DEFAULT_DOP20_ATTRIBUTION,
  GERMANY_DOP20_BOUNDS,
} from './routes/dop20Tiles.js';

export interface SmtpConfig {
  host: string | null;
  port: number;
  secure: boolean;
  user: string | null;
  pass: string | null;
  from: string;
  /** Refuse to send over an unencrypted connection when STARTTLS is unavailable (GDPR Art. 32). */
  requireTls: boolean;
  /** Development fallback without SMTP may log links; production never does. */
  logFallbackContent: boolean;
}

export interface EnvConfig {
  host: string;
  port: number;
  databaseUrl: string;
  trustProxy: boolean;
  corsOrigin: string;
  publicBaseUrl: string;
  uploadsDir: string;
  apkFilePath: string;
  smtp: SmtpConfig;
  autoSeedVg250: boolean;
  osmStyleUrl: string;
  osmDarkStyleUrl: string;
  orthophoto: RuntimeConfig['orthophoto'];
  initialView: RuntimeConfig['initialView'];
  maxDailyPolygonsPerUser: number;
  sessionTtlDays: number;
  disclaimerText: string;
  abuseContact: string | null;
  operatorName: string | null;
  operatorAddress: string | null;
  operatorEmail: string | null;
  operatorPhone: string | null;
  bugReportEmail: string | null;
  privacyPolicyUrl: string;
  impressumUrl: string;
  termsUrl: string;
  licensesUrl: string;
  sourceCodeUrl: string;
  apkMode: 'auto' | 'explicit' | 'disabled';
  apkDefaultUrl: string;
  apkExplicitSha256: string | null;
  apkDownloadUrl: string | null;
  apkSha256: string | null;
  authCaptchaEnabled: boolean;
  authCaptchaSecret: string;
  authCaptchaMaxNumber: number;
  tombstoneSecret: string;
  pseudonymReservationDays: number;
  /** Named in the privacy policy as processors (Art. 13(1)(e) GDPR); optional. */
  privacyHostingProvider: string | null;
  privacyEmailProvider: string | null;
  /** Backup retention stated in the privacy policy; null shows an operator warning. */
  backupRetentionDays: number | null;
  disposableEmailBlocklistExtra: string[];
  requireJurisdiction: 'when_seeded' | 'strict' | 'off';
  staleUnratedPruneDays: number;
  newUserMinAccountDays: number;
  newUserMinCleanPolygons: number;
  runtimeConfig: RuntimeConfig;
}

const EPHEMERAL_FALLBACK_CAPTCHA_SECRET = crypto
  .randomBytes(32)
  .toString('hex');

/** Deterministic development/test fallback; never accepted when NODE_ENV=production. */
export const DEV_TOMBSTONE_SECRET = 'unseal-dev-only-insecure-tombstone-secret';
const MIN_TOMBSTONE_SECRET_LENGTH = 32;
const DEFAULT_PSEUDONYM_RESERVATION_DAYS = 365;

/**
 * Resolves the HMAC key for pseudonym/email tombstones (GDPR Art. 32 pseudonymisation).
 * It must stay stable across restarts: rotating it lifts existing email bans and
 * pseudonym reservations, so production refuses to start without an explicit value.
 */
export function resolveTombstoneSecret(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.TOMBSTONE_SECRET?.trim() ?? '';
  if (raw.length > 0) {
    if (/^change[_-]?me/i.test(raw)) {
      throw new Error(
        'TOMBSTONE_SECRET still contains the example placeholder; generate one with: openssl rand -hex 32.',
      );
    }
    if (raw.length < MIN_TOMBSTONE_SECRET_LENGTH) {
      throw new Error(
        `TOMBSTONE_SECRET must be at least ${MIN_TOMBSTONE_SECRET_LENGTH} characters (generate one with: openssl rand -hex 32).`,
      );
    }
    return raw;
  }
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'TOMBSTONE_SECRET must be set in production (generate one with: openssl rand -hex 32). It keys the HMAC tombstones of deleted pseudonyms and banned email addresses.',
    );
  }
  return DEV_TOMBSTONE_SECRET;
}

const DEFAULT_DISCLAIMER_TEXT =
  'Community unsealing suggestions - non-binding public input, regardless of property ownership.';
const DEFAULT_OSM_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const DEFAULT_OSM_DARK_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';
const DEFAULT_SOURCE_CODE_URL = 'https://github.com/severinbro/Unseal';

function resolveDefaultDarkStyleUrl(lightStyleUrl: string): string {
  try {
    if (new URL(lightStyleUrl).host === 'tiles.openfreemap.org') {
      return DEFAULT_OSM_DARK_STYLE_URL;
    }
  } catch {
    // Non-URL string; let RuntimeConfigSchema report validation issues.
  }
  return lightStyleUrl;
}
const DISABLED_SETTING_RE = /^(?:none|off|false|disabled|0)$/i;
const STRICT_NUMBER_RE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/i;

export function resolveCandidateApkPaths(apkFilePath: string): string[] {
  const defaultDevApkPath = path.join(
    path.resolve(process.cwd(), 'uploads'),
    'unseal.apk',
  );
  if (apkFilePath === defaultDevApkPath) {
    return [
      apkFilePath,
      path.resolve(process.cwd(), 'downloads', 'unseal.apk'),
      path.resolve(
        process.cwd(),
        'apps/mobile/android/app/build/outputs/apk/release/app-release.apk',
      ),
      path.resolve(
        process.cwd(),
        '../mobile/android/app/build/outputs/apk/release/app-release.apk',
      ),
    ];
  }
  return [apkFilePath];
}

export function findExistingApkInfo(
  apkFilePath: string,
): { filePath: string; size: number; sha256: string } | null {
  for (const candidate of resolveCandidateApkPaths(apkFilePath)) {
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile() && stat.size > 0) {
        const hash = crypto
          .createHash('sha256')
          .update(fs.readFileSync(candidate))
          .digest('hex');
        return { filePath: candidate, size: stat.size, sha256: hash };
      }
    } catch {
      // Try next candidate path
    }
  }
  return null;
}

export function resolveRuntimeApkAvailability(config: Pick<
  EnvConfig,
  'apkMode' | 'apkDefaultUrl' | 'apkFilePath' | 'apkExplicitSha256' | 'apkDownloadUrl'
>): { apkDownloadUrl: string | null; apkSha256: string | null } {
  if (config.apkMode === 'disabled') {
    return { apkDownloadUrl: null, apkSha256: null };
  }
  if (config.apkMode === 'explicit') {
    const localApk = config.apkExplicitSha256
      ? null
      : findExistingApkInfo(config.apkFilePath);
    return {
      apkDownloadUrl: config.apkDownloadUrl,
      apkSha256: config.apkExplicitSha256 ?? localApk?.sha256 ?? null,
    };
  }
  const existing = findExistingApkInfo(config.apkFilePath);
  if (!existing) {
    return { apkDownloadUrl: null, apkSha256: null };
  }
  return {
    apkDownloadUrl: config.apkDefaultUrl,
    apkSha256: config.apkExplicitSha256 ?? existing.sha256,
  };
}

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
  const osmDarkStyleUrl =
    env.OSM_DARK_STYLE_URL?.trim() || resolveDefaultDarkStyleUrl(osmStyleUrl);

  const hasExplicitPublicBaseUrl = Boolean(env.PUBLIC_BASE_URL?.trim());
  const defaultBasePort = port === 80 || port === 443 ? '' : `:${port || 3000}`;
  const rawPublicBaseUrl =
    env.PUBLIC_BASE_URL?.trim() || `http://127.0.0.1${defaultBasePort}`;
  const publicBaseUrl = rawPublicBaseUrl.replace(/\/+$/, '');

  const uploadsDir = env.UPLOADS_DIR?.trim()
    ? path.resolve(env.UPLOADS_DIR.trim())
    : path.resolve(process.cwd(), 'uploads');
  const apkFilePath = env.APK_FILE_PATH?.trim()
    ? path.resolve(env.APK_FILE_PATH.trim())
    : path.join(uploadsDir, 'unseal.apk');

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
  const smtpRequireTls = parseBooleanSetting(
    env.SMTP_REQUIRE_TLS,
    !smtpSecure,
    'SMTP_REQUIRE_TLS',
  );

  const smtp: SmtpConfig = {
    host: smtpHostRaw.length > 0 ? smtpHostRaw : null,
    port: smtpPort,
    secure: smtpSecure,
    user: smtpUserRaw.length > 0 ? smtpUserRaw : null,
    pass: smtpPassRaw.length > 0 ? smtpPassRaw : null,
    from: smtpFrom,
    requireTls: smtpRequireTls,
    logFallbackContent: env.NODE_ENV !== 'production',
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
  if (DISABLED_SETTING_RE.test(orthophotoUrlTemplate)) {
    orthophoto = null;
  } else if (orthophotoUrlTemplate.length > 0) {
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
  } else {
    const builtinDop20Path = '/api/v1/tiles/dop20/{z}/{x}/{y}.png';
    orthophoto = {
      urlTemplate: hasExplicitPublicBaseUrl
        ? `${publicBaseUrl}${builtinDop20Path}`
        : builtinDop20Path,
      tileSize,
      attribution: orthophotoAttribution || DEFAULT_DOP20_ATTRIBUTION,
      bounds: orthophotoBounds ?? GERMANY_DOP20_BOUNDS,
      maxZoom: orthophotoMaxZoom,
    };
  }

  const initialLng = parseFiniteNumber(env.INITIAL_LNG, 8.2739, 'INITIAL_LNG');
  const initialLat = parseFiniteNumber(env.INITIAL_LAT, 49.9989, 'INITIAL_LAT');
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
  const rawOperatorName = env.OPERATOR_NAME?.trim() ?? '';
  const operatorName = rawOperatorName.length > 0 ? rawOperatorName : null;
  const rawOperatorAddress = env.OPERATOR_ADDRESS?.trim() ?? '';
  const operatorAddress =
    rawOperatorAddress.length > 0
      ? rawOperatorAddress.replace(/\\n/g, '\n')
      : null;
  const rawOperatorEmail = env.OPERATOR_EMAIL?.trim() ?? '';
  const operatorEmail =
    rawOperatorEmail.length > 0 ? rawOperatorEmail : abuseContact;
  const rawOperatorPhone = env.OPERATOR_PHONE?.trim() ?? '';
  const operatorPhone = rawOperatorPhone.length > 0 ? rawOperatorPhone : null;

  const rawBugReportTo = env.BUG_REPORT_TO?.trim() ?? '';
  const bugReportEmail = DISABLED_SETTING_RE.test(rawBugReportTo)
    ? null
    : rawBugReportTo.length > 0
      ? rawBugReportTo
      : operatorEmail;

  const privacyPolicyUrl =
    env.PRIVACY_POLICY_URL?.trim() || `${publicBaseUrl}/auth/privacy`;
  const impressumUrl =
    env.IMPRESSUM_URL?.trim() || `${publicBaseUrl}/auth/impressum`;
  const termsUrl = env.TERMS_URL?.trim() || `${publicBaseUrl}/auth/terms`;
  const licensesUrl =
    env.LICENSES_URL?.trim() || `${publicBaseUrl}/auth/licenses`;
  const sourceCodeUrl =
    env.SOURCE_CODE_URL?.trim() || DEFAULT_SOURCE_CODE_URL;

  const rawApkDownloadUrl = env.APK_DOWNLOAD_URL?.trim() ?? '';
  const defaultApkPath = '/downloads/unseal.apk';
  const apkDefaultUrl = hasExplicitPublicBaseUrl
    ? `${publicBaseUrl}${defaultApkPath}`
    : defaultApkPath;
  const rawApkSha256 = env.APK_SHA256?.trim() ?? '';
  if (rawApkSha256.length > 0 && !SHA256_HEX_RE.test(rawApkSha256)) {
    throw new Error(
      'APK_SHA256 must be a 64-character hexadecimal SHA-256 digest.',
    );
  }
  const apkExplicitSha256 =
    rawApkSha256.length > 0 ? rawApkSha256.toLowerCase() : null;

  const apkMode: 'auto' | 'explicit' | 'disabled' = DISABLED_SETTING_RE.test(
    rawApkDownloadUrl,
  )
    ? 'disabled'
    : rawApkDownloadUrl.length > 0
      ? 'explicit'
      : 'auto';

  const resolvedApk = resolveRuntimeApkAvailability({
    apkMode,
    apkDefaultUrl,
    apkFilePath,
    apkExplicitSha256,
    apkDownloadUrl: apkMode === 'explicit' ? rawApkDownloadUrl : apkDefaultUrl,
  });
  const apkDownloadUrl = resolvedApk.apkDownloadUrl;
  const apkSha256 = resolvedApk.apkSha256;

  const authCaptchaEnabled = parseBooleanSetting(
    env.AUTH_CAPTCHA_ENABLED,
    false,
    'AUTH_CAPTCHA_ENABLED',
  );
  // A publicly known secret would let anyone sign their own trivially solvable
  // challenge, so the example placeholder is treated like an unset value
  // (random per-process secret; only in-flight challenges are lost on restart).
  const rawCaptchaSecret = env.AUTH_CAPTCHA_SECRET?.trim() ?? '';
  const authCaptchaSecret =
    rawCaptchaSecret.length > 0 && !/^change[_-]?me/i.test(rawCaptchaSecret)
      ? rawCaptchaSecret
      : EPHEMERAL_FALLBACK_CAPTCHA_SECRET;
  const authCaptchaMaxNumber = parseIntSetting(
    env.AUTH_CAPTCHA_MAX_NUMBER,
    15_000,
    'AUTH_CAPTCHA_MAX_NUMBER',
  );
  if (authCaptchaMaxNumber < 100) {
    throw new Error('AUTH_CAPTCHA_MAX_NUMBER must be at least 100.');
  }

  const tombstoneSecret = resolveTombstoneSecret(env);
  const pseudonymReservationDays = parseIntSetting(
    env.PSEUDONYM_RESERVATION_DAYS,
    DEFAULT_PSEUDONYM_RESERVATION_DAYS,
    'PSEUDONYM_RESERVATION_DAYS',
  );
  if (pseudonymReservationDays < 1) {
    throw new Error('PSEUDONYM_RESERVATION_DAYS must be at least 1.');
  }

  const privacyHostingProvider = env.PRIVACY_HOSTING_PROVIDER?.trim() || null;
  const privacyEmailProvider = env.PRIVACY_EMAIL_PROVIDER?.trim() || null;
  const rawBackupRetention = env.BACKUP_RETENTION_DAYS?.trim() ?? '';
  let backupRetentionDays: number | null = null;
  if (rawBackupRetention.length > 0) {
    backupRetentionDays = parseIntSetting(
      rawBackupRetention,
      0,
      'BACKUP_RETENTION_DAYS',
    );
    if (backupRetentionDays < 1) {
      throw new Error('BACKUP_RETENTION_DAYS must be at least 1 when set.');
    }
  }

  // DISPOSABLE_EMAIL_BLOCKLIST_EXTRA is the documented name; the older
  // DISPOSABLE_EMAIL_DOMAINS_EXTRA is still accepted for existing deployments.
  const disposableEmailBlocklistExtra = (
    env.DISPOSABLE_EMAIL_BLOCKLIST_EXTRA?.trim() ||
    env.DISPOSABLE_EMAIL_DOMAINS_EXTRA ||
    ''
  )
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0);

  const rawRequireJurisdiction =
    env.REQUIRE_JURISDICTION?.trim().toLowerCase() ?? '';
  let requireJurisdiction: 'when_seeded' | 'strict' | 'off' = 'when_seeded';
  if (
    rawRequireJurisdiction === '' ||
    rawRequireJurisdiction === 'true' ||
    rawRequireJurisdiction === '1' ||
    rawRequireJurisdiction === 'when_seeded'
  ) {
    requireJurisdiction = 'when_seeded';
  } else if (rawRequireJurisdiction === 'strict') {
    requireJurisdiction = 'strict';
  } else if (DISABLED_SETTING_RE.test(rawRequireJurisdiction)) {
    requireJurisdiction = 'off';
  } else {
    throw new Error(
      `REQUIRE_JURISDICTION must be "when_seeded", "strict", "true", or "false" (received "${env.REQUIRE_JURISDICTION}").`,
    );
  }

  const staleUnratedPruneDays = parseIntSetting(
    env.STALE_UNRATED_PRUNE_DAYS,
    TRUST_AND_MODERATION_LIMITS.STALE_UNRATED_PRUNE_DAYS,
    'STALE_UNRATED_PRUNE_DAYS',
  );
  if (staleUnratedPruneDays < 1) {
    throw new Error('STALE_UNRATED_PRUNE_DAYS must be at least 1.');
  }

  const newUserMinAccountDays = parseIntSetting(
    env.NEW_USER_MIN_ACCOUNT_DAYS,
    TRUST_AND_MODERATION_LIMITS.NEW_USER_MIN_ACCOUNT_DAYS,
    'NEW_USER_MIN_ACCOUNT_DAYS',
  );
  const newUserMinCleanPolygons = parseIntSetting(
    env.NEW_USER_MIN_CLEAN_POLYGONS,
    TRUST_AND_MODERATION_LIMITS.NEW_USER_MIN_CLEAN_POLYGONS,
    'NEW_USER_MIN_CLEAN_POLYGONS',
  );

  const runtimeConfig = RuntimeConfigSchema.parse({
    osmStyleUrl,
    osmDarkStyleUrl,
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
    impressumUrl,
    termsUrl,
    licensesUrl,
    sourceCodeUrl,
    bugReportContact: bugReportEmail,
    apkDownloadUrl,
    apkSha256,
    authCaptchaRequired: authCaptchaEnabled,
  });

  return {
    host,
    port,
    databaseUrl,
    trustProxy,
    corsOrigin,
    publicBaseUrl,
    uploadsDir,
    apkFilePath,
    smtp,
    autoSeedVg250,
    osmStyleUrl: runtimeConfig.osmStyleUrl,
    osmDarkStyleUrl: runtimeConfig.osmDarkStyleUrl ?? osmDarkStyleUrl,
    orthophoto: runtimeConfig.orthophoto,
    initialView: runtimeConfig.initialView,
    maxDailyPolygonsPerUser: runtimeConfig.limits.maxDailyPolygonsPerUser,
    sessionTtlDays,
    disclaimerText: runtimeConfig.disclaimerText,
    abuseContact: runtimeConfig.abuseContact,
    operatorName,
    operatorAddress,
    operatorEmail,
    operatorPhone,
    bugReportEmail,
    privacyPolicyUrl,
    impressumUrl,
    termsUrl,
    licensesUrl,
    sourceCodeUrl,
    apkMode,
    apkDefaultUrl,
    apkExplicitSha256,
    apkDownloadUrl: runtimeConfig.apkDownloadUrl,
    apkSha256: runtimeConfig.apkSha256,
    authCaptchaEnabled,
    authCaptchaSecret,
    authCaptchaMaxNumber,
    tombstoneSecret,
    pseudonymReservationDays,
    privacyHostingProvider,
    privacyEmailProvider,
    backupRetentionDays,
    disposableEmailBlocklistExtra,
    requireJurisdiction,
    staleUnratedPruneDays,
    newUserMinAccountDays,
    newUserMinCleanPolygons,
    runtimeConfig,
  };
}
