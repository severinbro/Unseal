export const SURFACE_TYPES = ['asphalt', 'concrete', 'pavers', 'other'] as const;

export type SurfaceType = (typeof SURFACE_TYPES)[number];

export const POLYGON_STATUSES = ['proposed', 'finished'] as const;

export type PolygonStatus = (typeof POLYGON_STATUSES)[number];

export const USER_ROLES = ['user', 'admin'] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const PHOTO_LIMITS = {
  MAX_UPLOAD_BYTES: 8 * 1024 * 1024,
  MAX_DIMENSION_PX: 1600,
  THUMB_DIMENSION_PX: 360,
  GPS_VERIFY_DISTANCE_M: 250,
  FAKE_BLUR_SCORE_THRESHOLD: -3,
  MAX_PHOTOS_PER_POLYGON: 24,
} as const;

export const IMPORT_LIMITS = {
  MAX_FILE_BYTES: 25 * 1024 * 1024,
  MAX_FEATURES_PER_IMPORT: 2_000,
} as const;

export const MUNICIPALITY_NORMS = {
  MIN_POSITIVE_SCORE_FLOOR: 3,
  UNBOUNDED_FALLBACK_FLOOR: 10,
} as const;

export const GEOMETRY_LIMITS = {
  MIN_AREA_M2: 2,
  MAX_AREA_M2: 500_000,
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
  MAX_NOTE_LENGTH: 500,
} as const;

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
