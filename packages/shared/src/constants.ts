export const SURFACE_TYPES = ['asphalt', 'concrete', 'pavers', 'other'] as const;

export type SurfaceType = (typeof SURFACE_TYPES)[number];

export const POLYGON_STATUSES = ['proposed', 'in_progress', 'finished'] as const;

export type PolygonStatus = (typeof POLYGON_STATUSES)[number];

export const USER_ROLES = ['user', 'admin'] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const PHOTO_LIMITS = {
  MAX_UPLOAD_BYTES: 8 * 1024 * 1024,
  MAX_DIMENSION_PX: 1600,
  THUMB_DIMENSION_PX: 360,
  GPS_VERIFY_DISTANCE_M: 3,
  FAKE_BLUR_SCORE_THRESHOLD: -3,
  MAX_PHOTOS_PER_POLYGON: 24,
} as const;

export const COMMENT_LIMITS = {
  MAX_BODY_LENGTH: 1_000,
  MAX_REPLY_DEPTH: 8,
  MAX_COMMENTS_PER_POLYGON: 500,
} as const;

export const IMPORT_LIMITS = {
  MAX_FILE_BYTES: 25 * 1024 * 1024,
  MAX_FEATURES_PER_IMPORT: 2_000,
  MAX_AREA_M2: 500_000,
} as const;

export const MUNICIPALITY_NORMS = {
  MIN_POSITIVE_SCORE_FLOOR: 3,
  UNBOUNDED_FALLBACK_FLOOR: 10,
} as const;

export const GEOMETRY_LIMITS = {
  MIN_AREA_M2: 2,
  MAX_AREA_M2: 20_000,
  MIN_VERTICES: 3,
  MAX_VERTICES: 200,
  MIN_RING_POSITIONS: 4,
  MAX_RING_POSITIONS: 201,
  MAX_POLYGON_SPAN_DEG: 0.05,
  MAX_ABS_LAT: 85,
  MAX_BBOX_SPAN_DEG: 0.15,
  BBOX_FEATURE_LIMIT: 500,
  DEDUPE_EPSILON_DEG: 1e-7,
  MIN_TURN_ANGLE_DEG: 2,
  MIN_COMPACTNESS_PP: 0.05,
  MIN_WIDTH_BUFFER_M: 0.5,
  OVERLAP_REJECT_RATIO: 0.5,
  CLUSTER_RADIUS_M: 50,
  CLUSTER_WINDOW_HOURS: 24,
  CLUSTER_MAX_PER_USER: 5,
  CLUSTER_MAX_GLOBAL: 15,
  MAX_NOTE_LENGTH: 500,
} as const;

export const POLYGON_FLAG_REASONS = [
  'implausible',
  'already_unsealed',
  'duplicate',
  'spam',
] as const;

export type PolygonFlagReason = (typeof POLYGON_FLAG_REASONS)[number];

export const POLYGON_FILTERS = [
  'all',
  'new',
  'established',
  'needs_review',
] as const;

export type PolygonFilter = (typeof POLYGON_FILTERS)[number];

export const POLYGON_AUTHOR_FILTERS = [
  'all',
  'new_user',
  'established',
] as const;

export type PolygonAuthorFilter = (typeof POLYGON_AUTHOR_FILTERS)[number];

export const LAND_COVER_SOURCES = ['osm', 'alkis'] as const;

export type LandCoverSource = (typeof LAND_COVER_SOURCES)[number];

export const LAND_COVER_CATEGORIES = [
  'water',
  'forest_wood',
  'park_green',
  'farmland',
  'railway',
  'building',
] as const;

export type LandCoverCategory = (typeof LAND_COVER_CATEGORIES)[number];

export const LAND_COVER_MAX_OVERLAP_RATIO: Readonly<
  Record<LandCoverCategory, number>
> = {
  water: 0.25,
  railway: 0.3,
  building: 0.35,
  forest_wood: 0.5,
  park_green: 0.5,
  farmland: 0.5,
} as const;

export const TRUST_AND_MODERATION_LIMITS = {
  NEW_USER_MIN_ACCOUNT_DAYS: 14,
  NEW_USER_MIN_CLEAN_POLYGONS: 3,
  STALE_UNRATED_PRUNE_DAYS: 14,
  MAX_FLAG_NOTE_LENGTH: 300,
} as const;

export const DISPOSABLE_EMAIL_DOMAINS = [
  '10minutemail.com',
  'dispostable.com',
  'fakeinbox.com',
  'getnada.com',
  'guerrillamail.com',
  'maildrop.cc',
  'mailinator.com',
  'mohmal.com',
  'sharklasers.com',
  'temp-mail.org',
  'tempmail.com',
  'throwawaymail.com',
  'trashmail.com',
  'yopmail.com',
] as const;

export const AUTH_LIMITS = {
  PSEUDONYM_REGEX: /^[a-zA-Z0-9_-]{3,32}$/,
  MAX_EMAIL_LENGTH: 254,
  MIN_PASSWORD_LENGTH: 8,
  MAX_PASSWORD_LENGTH: 128,
  MAX_PASSWORD_BYTES: 1024,
  RECOVERY_CODE_BYTES: 16,
  RECOVERY_CODE_HEX_LENGTH: 32,
  EMAIL_VERIFY_TTL_HOURS: 24,
  PASSWORD_RESET_TTL_MINUTES: 60,
  SESSION_TTL_DAYS: 30,
  MAX_SESSIONS_PER_USER: 10,
} as const;

export const RESERVED_PSEUDONYMS = ['deleted'] as const;
