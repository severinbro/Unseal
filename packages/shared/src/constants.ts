// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

export const SURFACE_TYPES = ['asphalt', 'concrete', 'pavers', 'other'] as const;

export type SurfaceType = (typeof SURFACE_TYPES)[number];

export const POLYGON_STATUSES = ['proposed', 'in_progress', 'finished'] as const;

export type PolygonStatus = (typeof POLYGON_STATUSES)[number];

export const POLYGON_ORIGINS = [
  'citizen',
  'initiative_import',
  'remote_sensing',
] as const;

export type PolygonOrigin = (typeof POLYGON_ORIGINS)[number];

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

export const IMPORT_LICENSES = [
  'CC0-1.0',
  'dl-de/zero-2-0',
  'PDDL-1.0',
  'Public Domain',
  'ODbL-1.0',
  'dl-de/by-2-0',
  'CC-BY-4.0',
] as const;

export type ImportLicense = (typeof IMPORT_LICENSES)[number];

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

/** `[[west, south], [east, north]]` camera bounds around Germany. */
export const GERMANY_MAX_BOUNDS = [
  [4.8, 46.6],
  [16.0, 55.6],
] as const;

export const GERMANY_MIN_ZOOM = 5.2;

export const POLYGON_FLAG_REASONS = [
  'implausible',
  'already_unsealed',
  'duplicate',
  'spam',
] as const;

export type PolygonFlagReason = (typeof POLYGON_FLAG_REASONS)[number];

export const CONTENT_REPORT_TARGET_TYPES = [
  'polygon',
  'photo',
  'comment',
  'chat_message',
] as const;

export type ContentReportTargetType =
  (typeof CONTENT_REPORT_TARGET_TYPES)[number];

export const CONTENT_REPORT_REASONS = [
  'privacy_personal_data',
  'photo_rights',
  'copyright',
  'defamation_illegal',
  'property_dispute',
  'other',
] as const;

export type ContentReportReason = (typeof CONTENT_REPORT_REASONS)[number];

export const SPACE_TYPES = ['public', 'private'] as const;

export type SpaceType = (typeof SPACE_TYPES)[number];

/** Stored values also include 'unknown' for ground that was never classified. */
export const STORED_SPACE_TYPES = ['public', 'private', 'unknown'] as const;

export type StoredSpaceType = (typeof STORED_SPACE_TYPES)[number];

/** 'unknown' selects areas that predate the classification. */
export const SPACE_FILTERS = ['all', 'private', 'public', 'unknown'] as const;

export type SpaceFilter = (typeof SPACE_FILTERS)[number];

export const SPACE_VERIFICATION_STATUSES = [
  'gis_verified',
  'user_override',
  'admin_override',
  'unverified',
] as const;

export type SpaceVerification = (typeof SPACE_VERIFICATION_STATUSES)[number];

export const SPACE_VERIFICATION_SOURCES = [
  'alkis',
  'osm_local',
  'osm_overpass',
] as const;

export type SpaceVerificationSource =
  (typeof SPACE_VERIFICATION_SOURCES)[number];

export const SPACE_REFERENCE_TIERS = [
  'explicit_private',
  'public',
  'landuse_private',
] as const;

export type SpaceReferenceTier = (typeof SPACE_REFERENCE_TIERS)[number];

export const SPACE_CLASSIFICATION_THRESHOLDS = {
  PRIVATE_PROPOSAL_MIN_RATIO: 0.75,
  PUBLIC_MIN_RATIO: 0.15,
  LOCAL_SHORT_CIRCUIT_COVERAGE: 0.85,
} as const;

/** Bump when terms or licence scope change; older acceptances must be renewed. */
export const CURRENT_TERMS_VERSION = 2;

export const FEED_LIMITS = {
  DEFAULT_LIMIT: 15,
  MAX_LIMIT: 40,
  MAX_AGE_DAYS: 180,
  /** Largest map section the feed can be narrowed to. */
  MAX_BBOX_SPAN_DEG: 3,
  /** A narrowed feed never covers less than this, so it stays "nearby". */
  MIN_NEAR_SPAN_DEG: 0.3,
  /** Sections are widened to this grid before they are sent (data minimisation). */
  BBOX_GRID_DEG: 0.05,
} as const;

/** What put an area into the feed at its position. */
export const FEED_ACTIVITIES = ['created', 'in_progress', 'finished'] as const;

export type FeedActivity = (typeof FEED_ACTIVITIES)[number];

/** A public call for help on private ground ends by itself after this time. */
export const HELP_WANTED_DAYS = 90;

export const SPACE_ZONE_LIMITS = {
  MIN_ZOOM: 15,
  MAX_BBOX_SPAN_DEG: 0.06,
  MAX_FEATURES: 1_500,
} as const;

export const SPACE_ZONE_KINDS = ['private', 'public'] as const;

export type SpaceZoneKind = (typeof SPACE_ZONE_KINDS)[number];

export const FEED_ORIGIN_FILTERS = ['all', 'citizen'] as const;

export type FeedOriginFilter = (typeof FEED_ORIGIN_FILTERS)[number];

export const CHAT_LIMITS = {
  MAX_MESSAGE_LENGTH: 2_000,
  MESSAGES_PAGE_LIMIT: 50,
  PREVIEW_MAX_LENGTH: 140,
  COMMENT_EXCERPT_LENGTH: 240,
  DEFAULT_RETENTION_DAYS: 365,
  EMPTY_THREAD_RETENTION_DAYS: 7,
  /** An unanswered first message is erased after this time. */
  REQUEST_RETENTION_DAYS: 30,
  /** New people one account may try to contact per calendar day. */
  MAX_CONTACT_ATTEMPTS_PER_DAY: 20,
} as const;

/**
 * Until the recipient answers, a conversation is a request: the person who
 * started it may send one message only.
 */
export const CHAT_REQUEST_STATES = ['none', 'incoming', 'outgoing'] as const;

export type ChatRequestState = (typeof CHAT_REQUEST_STATES)[number];

export const POLYGON_FILTERS = [
  'all',
  'new',
  'in_progress',
  'finished',
  'established',
  'needs_review',
  'help_wanted',
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
  STALE_UNRATED_PRUNE_DAYS: 30,
  MAX_FLAG_NOTE_LENGTH: 300,
} as const;

/**
 * GDPR data minimisation: author activity is stored with day precision only and
 * published solely as a coarse "active within the last N days" flag.
 */
export const AUTHOR_ACTIVITY = {
  RECENT_DAYS: 30,
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
  MAX_FAILED_LOGIN_ATTEMPTS: 5,
} as const;

export const RESERVED_PSEUDONYMS = ['deleted'] as const;

export const DEFAULT_APP_NAME = 'OpenUnseal';

export const WEBHOOK_EVENT_TYPES = [
  'polygon.created',
  'polygon.status_changed',
  'polygon.deleted',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export const CLUSTER_LIMITS = {
  /** Below this zoom (beyond a whole-city view like Mainz), polygons are summarized into count bubbles. */
  BUBBLE_MAX_ZOOM: 11.5,
  MIN_ZOOM: 4,
  MAX_ZOOM: 16,
  MAX_CLUSTERS: 1_500,
  /** Minimum screen-space spacing (px at 512px tiles) between count bubbles. */
  BUBBLE_SPACING_PX: 56,
  /** Tight screen-space spacing (px) in city-dot overview mode (zoom >= BUBBLE_MAX_ZOOM). */
  CITY_DOT_SPACING_PX: 10,
} as const;
