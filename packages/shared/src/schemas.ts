// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Unseal Contributors

import { z } from 'zod';

import {
  AUTH_LIMITS,
  COMMENT_LIMITS,
  GEOMETRY_LIMITS,
  MUNICIPALITY_NORMS,
  POLYGON_AUTHOR_FILTERS,
  POLYGON_FILTERS,
  POLYGON_FLAG_REASONS,
  POLYGON_ORIGINS,
  POLYGON_STATUSES,
  SURFACE_TYPES,
  TRUST_AND_MODERATION_LIMITS,
  USER_ROLES,
  type PolygonFilter,
  type PolygonStatus,
} from './constants.js';
import { ApiError } from './errors.js';
import { checkPolygonRingStructure } from './geometry.js';

const utf8Encoder = new TextEncoder();
const STRICT_NUMBER_RE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const BBOX_SPAN_TOLERANCE = 1e-9;

const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const PseudonymSchema = z
  .string()
  .regex(
    AUTH_LIMITS.PSEUDONYM_REGEX,
    'Pseudonym must be 3 to 32 characters containing only letters, digits, underscores, or hyphens.',
  );

export const EmailSchema = z
  .string()
  .trim()
  .min(3, 'Email address is required.')
  .max(
    AUTH_LIMITS.MAX_EMAIL_LENGTH,
    `Email must be at most ${AUTH_LIMITS.MAX_EMAIL_LENGTH} characters.`,
  )
  .email('A valid email address is required.')
  .transform((email) => email.toLowerCase());

export const PasswordSchema = z.string().superRefine((password, ctx) => {
  if (password.length < AUTH_LIMITS.MIN_PASSWORD_LENGTH) {
    ctx.addIssue({
      code: z.ZodIssueCode.too_small,
      minimum: AUTH_LIMITS.MIN_PASSWORD_LENGTH,
      type: 'string',
      inclusive: true,
      message: `Password must be at least ${AUTH_LIMITS.MIN_PASSWORD_LENGTH} characters.`,
    });
  }
  const byteLength = utf8Encoder.encode(password).byteLength;
  if (byteLength > AUTH_LIMITS.MAX_PASSWORD_BYTES) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Password must not exceed ${AUTH_LIMITS.MAX_PASSWORD_BYTES} UTF-8 bytes.`,
    });
  }
  if (password.length > AUTH_LIMITS.MAX_PASSWORD_LENGTH) {
    ctx.addIssue({
      code: z.ZodIssueCode.too_big,
      maximum: AUTH_LIMITS.MAX_PASSWORD_LENGTH,
      type: 'string',
      inclusive: true,
      message: `Password must be at most ${AUTH_LIMITS.MAX_PASSWORD_LENGTH} characters.`,
    });
  }
});

const LoginIdentifierSchema = z
  .string()
  .trim()
  .min(3, 'Pseudonym or email must be at least 3 characters.')
  .max(AUTH_LIMITS.MAX_EMAIL_LENGTH)
  .superRefine((value, ctx) => {
    if (value.includes('@')) {
      const emailCheck = z.string().email().safeParse(value);
      if (!emailCheck.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Please enter a valid email address or pseudonym.',
        });
      }
      return;
    }
    if (!AUTH_LIMITS.PSEUDONYM_REGEX.test(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Pseudonym must be 3 to 32 characters containing only letters, digits, underscores, or hyphens.',
      });
    }
  });

export function normalizeRecoveryCode(input: string): string {
  return input.replace(/[-\s]/g, '').toUpperCase();
}

export const AltchaChallengeResponseSchema = z.object({
  algorithm: z.literal('SHA-256'),
  challenge: z.string().min(16).max(128),
  maxnumber: z.number().int().positive(),
  salt: z.string().min(8).max(256),
  signature: z.string().min(16).max(256),
});

export type AltchaChallengeResponse = z.infer<
  typeof AltchaChallengeResponseSchema
>;

export const RegisterRequestSchema = z
  .object({
    pseudonym: PseudonymSchema,
    email: EmailSchema,
    password: PasswordSchema,
    acceptedPrivacyPolicy: z.literal(true, {
      errorMap: () => ({
        // Acknowledgement of the privacy notice (Art. 13 GDPR), not consent: the account
        // itself is processed to provide the service (Art. 6(1)(b) GDPR).
        message: 'Please confirm that you have read the privacy policy to register.',
      }),
    }),
    acceptedTerms: z.literal(true, {
      errorMap: () => ({
        message: 'Please accept the terms of use and content licenses to register.',
      }),
    }),
    altchaPayload: z.string().trim().min(1).max(4096).optional(),
  })
  .strict();

export type RegisterRequest = z.input<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z
  .union([
    z
      .object({
        identifier: LoginIdentifierSchema,
        password: PasswordSchema,
      })
      .strict()
      .transform((val) => ({
        identifier: val.identifier,
        password: val.password,
      })),
    z
      .object({
        pseudonym: PseudonymSchema,
        password: PasswordSchema,
      })
      .strict()
      .transform((val) => ({
        identifier: val.pseudonym,
        password: val.password,
      })),
  ]);

export type LoginRequest = z.input<typeof LoginRequestSchema>;
export type ParsedLoginRequest = z.output<typeof LoginRequestSchema>;

export const RecoverRequestSchema = z
  .object({
    pseudonym: PseudonymSchema,
    recoveryCode: z.string().min(1).max(128),
    newPassword: PasswordSchema,
  })
  .strict();

export type RecoverRequest = z.infer<typeof RecoverRequestSchema>;

/** `DELETE /api/v1/auth/me?purgeContent=true` also erases own polygons, photos and comments. */
export const DeleteAccountQuerySchema = z.object({
  purgeContent: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((value) => value === 'true' || value === '1'),
});

export type DeleteAccountQuery = z.output<typeof DeleteAccountQuerySchema>;

export const EmailActionRequestSchema = z
  .object({
    email: EmailSchema,
  })
  .strict();

export type EmailActionRequest = z.input<typeof EmailActionRequestSchema>;

export const ResendVerificationRequestSchema = z.union([
  z
    .object({
      email: EmailSchema,
    })
    .strict()
    .transform((val) => ({
      identifier: val.email.toLowerCase(),
    })),
  z
    .object({
      identifier: LoginIdentifierSchema,
    })
    .strict()
    .transform((val) => ({
      identifier: val.identifier.trim().toLowerCase(),
    })),
]);

export type ResendVerificationRequest = z.input<
  typeof ResendVerificationRequestSchema
>;
export type ParsedResendVerificationRequest = z.output<
  typeof ResendVerificationRequestSchema
>;

export const EmailActionResponseSchema = z.object({
  status: z.literal('ok'),
  message: z.string().min(1),
});

export type EmailActionResponse = z.infer<typeof EmailActionResponseSchema>;

export const VerifyEmailRequestSchema = z
  .object({
    token: z.string().trim().min(16).max(256),
  })
  .strict();

export type VerifyEmailRequest = z.infer<typeof VerifyEmailRequestSchema>;

export const VerifyEmailResponseSchema = z.object({
  status: z.literal('verified'),
  pseudonym: PseudonymSchema,
});

export type VerifyEmailResponse = z.infer<typeof VerifyEmailResponseSchema>;

export const ResetPasswordRequestSchema = z
  .object({
    token: z.string().trim().min(16).max(256),
    newPassword: PasswordSchema,
  })
  .strict();

export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;

export const ResetPasswordResponseSchema = z.object({
  status: z.literal('password_reset'),
});

export type ResetPasswordResponse = z.infer<typeof ResetPasswordResponseSchema>;

export const AuthUserSchema = z.object({
  id: z.string().uuid(),
  pseudonym: PseudonymSchema,
  email: z.string().email().nullable().optional().default(null),
  role: z.enum(USER_ROLES).optional().default('user'),
  createdAt: IsoDateTimeSchema,
});

export type AuthUser = z.output<typeof AuthUserSchema>;

export const RegisterResponseSchema = z.object({
  status: z.literal('verification_email_sent'),
  pseudonym: PseudonymSchema,
  email: z.string().email(),
});

export type RegisterResponse = z.infer<typeof RegisterResponseSchema>;

export const SessionResponseSchema = z.object({
  user: AuthUserSchema,
  sessionToken: z.string().min(1),
  expiresAt: IsoDateTimeSchema,
});

export type SessionResponse = z.output<typeof SessionResponseSchema>;

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  postgisVersion: z.string(),
  migrationsApplied: z.number().int().min(1),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

const OrthophotoBoundsTupleSchema = z
  .tuple([
    z.number().finite().min(-180).max(180),
    z.number().finite().min(-90).max(90),
    z.number().finite().min(-180).max(180),
    z.number().finite().min(-90).max(90),
  ])
  .refine(([minLng, minLat, maxLng, maxLat]) => minLng < maxLng && minLat < maxLat, {
    message: 'Orthophoto bounds must satisfy minLng < maxLng and minLat < maxLat.',
  });

const OrthophotoConfigSchema = z.object({
  urlTemplate: z
    .string()
    .min(1)
    .refine(
      (tpl) => tpl.includes('{z}/{x}/{y}') || tpl.includes('{bbox-epsg-3857}'),
      {
        message:
          'Orthophoto urlTemplate must include {z}/{x}/{y} or {bbox-epsg-3857}.',
      },
    ),
  tileSize: z.union([z.literal(256), z.literal(512)]),
  attribution: z.string(),
  bounds: OrthophotoBoundsTupleSchema.nullable(),
  maxZoom: z.number().int().min(0).max(24),
});

export const RuntimeConfigSchema = z.object({
  osmStyleUrl: z.string().url(),
  osmDarkStyleUrl: z.string().url().optional(),
  orthophoto: OrthophotoConfigSchema.nullable(),
  vg250AttributionEnabled: z.boolean().optional(),
  vg250DataYear: z.number().int().min(2000).max(2100).nullable().optional(),
  initialView: z.object({
    lng: z.number().finite().min(-180).max(180),
    lat: z.number().finite().min(-GEOMETRY_LIMITS.MAX_ABS_LAT).max(GEOMETRY_LIMITS.MAX_ABS_LAT),
    zoom: z.number().finite().min(0).max(24),
  }),
  limits: z.object({
    minAreaM2: z.number().positive(),
    maxAreaM2: z.number().positive(),
    maxVertices: z.number().int().min(GEOMETRY_LIMITS.MIN_VERTICES),
    maxPolygonSpanDeg: z.number().positive(),
    maxBboxSpanDeg: z.number().positive(),
    bboxFeatureLimit: z.number().int().positive(),
    maxDailyPolygonsPerUser: z.number().int().positive(),
  }),
  disclaimerText: z.string().min(1),
  abuseContact: z.string().nullable(),
  privacyPolicyUrl: z.string().url().nullable().optional().default(null),
  impressumUrl: z.string().url().nullable().optional().default(null),
  termsUrl: z.string().url().nullable().optional().default(null),
  licensesUrl: z.string().url().nullable().optional().default(null),
  sourceCodeUrl: z.string().url().nullable().optional().default(null),
  bugReportContact: z.string().nullable().optional().default(null),
  apkDownloadUrl: z.string().min(1).nullable().optional().default(null),
  apkSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/i)
    .nullable()
    .optional()
    .default(null),
  authCaptchaRequired: z.boolean().optional().default(false),
});

export type RuntimeConfig = z.output<typeof RuntimeConfigSchema>;

export const UuidParamSchema = z.union([
  z.object({ id: z.string().uuid() }),
  z.string().uuid().transform((id) => ({ id })),
]);

export type UuidParam = z.output<typeof UuidParamSchema>;

const CreatePolygonGeometrySchema = z
  .object({
    type: z.literal('Polygon'),
    coordinates: z.array(z.array(z.tuple([z.number().finite(), z.number().finite()]))),
  })
  .strict()
  .superRefine((geom, ctx) => {
    const check = checkPolygonRingStructure(geom.coordinates);
    if (!check.valid) {
      for (const message of check.errors) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message,
          path: ['coordinates'],
        });
      }
    }
  });

export const CreatePolygonRequestSchema = z
  .object({
    geometry: CreatePolygonGeometrySchema,
    surfaceType: z.enum(SURFACE_TYPES),
    note: z.string().max(GEOMETRY_LIMITS.MAX_NOTE_LENGTH).nullable().optional(),
  })
  .strict();

export type CreatePolygonRequest = z.infer<typeof CreatePolygonRequestSchema>;

export const PatchPolygonRequestSchema = z
  .object({
    surfaceType: z.enum(SURFACE_TYPES).optional(),
    note: z.string().max(GEOMETRY_LIMITS.MAX_NOTE_LENGTH).nullable().optional(),
  })
  .strict()
  .refine(
    (payload) => payload.surfaceType !== undefined || payload.note !== undefined,
    { message: 'At least one of surfaceType or note must be provided.' },
  );

export type PatchPolygonRequest = z.infer<typeof PatchPolygonRequestSchema>;

export const PatchPolygonStatusRequestSchema = z
  .object({
    status: z.enum(POLYGON_STATUSES),
  })
  .strict();

export type PatchPolygonStatusRequest = z.infer<typeof PatchPolygonStatusRequestSchema>;

export const VoteRequestSchema = z
  .object({
    value: z.union([z.literal(1), z.literal(-1)]),
  })
  .strict();

export type VoteRequest = z.infer<typeof VoteRequestSchema>;

export const VoteResponseSchema = z.object({
  polygonId: z.string().uuid(),
  upvotes: z.number().int().min(0),
  downvotes: z.number().int().min(0),
  score: z.number().int(),
  myVote: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
});

export type VoteResponse = z.infer<typeof VoteResponseSchema>;

export const FlagPolygonRequestSchema = z
  .union([
    z
      .object({
        reason: z.enum(POLYGON_FLAG_REASONS).optional().default('implausible'),
        note: z
          .string()
          .trim()
          .max(
            TRUST_AND_MODERATION_LIMITS.MAX_FLAG_NOTE_LENGTH,
            `Flag note must not exceed ${TRUST_AND_MODERATION_LIMITS.MAX_FLAG_NOTE_LENGTH} characters.`,
          )
          .nullable()
          .optional(),
      })
      .strict(),
    z.undefined().transform(() => ({ reason: 'implausible' as const })),
    z.null().transform(() => ({ reason: 'implausible' as const })),
  ]);

export type FlagPolygonRequest = z.input<typeof FlagPolygonRequestSchema>;

export const FlagPolygonResponseSchema = z.object({
  polygonId: z.string().uuid(),
  flagCount: z.number().int().nonnegative(),
  isFlagged: z.boolean(),
  myFlag: z.boolean(),
  myFlagReason: z.enum(POLYGON_FLAG_REASONS).nullable().optional().default(null),
});

export type FlagPolygonResponse = z.output<typeof FlagPolygonResponseSchema>;

export const PolygonPhotoSchema = z.object({
  id: z.string().uuid(),
  polygonId: z.string().uuid(),
  url: z.string().min(1),
  thumbUrl: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  gpsVerified: z.boolean(),
  uploaderPseudonym: z.string().min(1),
  isUploader: z.boolean(),
  realVotes: z.number().int().nonnegative(),
  fakeVotes: z.number().int().nonnegative(),
  credibilityScore: z.number().int(),
  myVote: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  isFlaggedFake: z.boolean(),
  createdAt: IsoDateTimeSchema,
});

export type PolygonPhoto = z.infer<typeof PolygonPhotoSchema>;

export const PolygonPhotoListResponseSchema = z.object({
  photos: z.array(PolygonPhotoSchema),
});

export type PolygonPhotoListResponse = z.infer<typeof PolygonPhotoListResponseSchema>;

export const PhotoVoteRequestSchema = z
  .object({
    value: z.union([z.literal(1), z.literal(-1)]),
  })
  .strict();

export type PhotoVoteRequest = z.infer<typeof PhotoVoteRequestSchema>;

export const PhotoVoteResponseSchema = z.object({
  photoId: z.string().uuid(),
  polygonId: z.string().uuid(),
  realVotes: z.number().int().nonnegative(),
  fakeVotes: z.number().int().nonnegative(),
  credibilityScore: z.number().int(),
  myVote: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  isFlaggedFake: z.boolean(),
});

export type PhotoVoteResponse = z.infer<typeof PhotoVoteResponseSchema>;

export const PolygonCommentSchema = z.object({
  id: z.string().uuid(),
  polygonId: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  body: z.string().min(1).max(COMMENT_LIMITS.MAX_BODY_LENGTH),
  authorPseudonym: z.string().min(1),
  isAuthor: z.boolean(),
  upvotes: z.number().int().nonnegative(),
  myVote: z.union([z.literal(0), z.literal(1)]),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type PolygonComment = z.infer<typeof PolygonCommentSchema>;

export const PolygonCommentListResponseSchema = z.object({
  polygonId: z.string().uuid(),
  topCommentId: z.string().uuid().nullable(),
  comments: z.array(PolygonCommentSchema),
});

export type PolygonCommentListResponse = z.infer<
  typeof PolygonCommentListResponseSchema
>;

export const CreatePolygonCommentRequestSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(1, 'Comment text must not be empty.')
      .max(
        COMMENT_LIMITS.MAX_BODY_LENGTH,
        `Comment must not exceed ${COMMENT_LIMITS.MAX_BODY_LENGTH} characters.`,
      ),
    parentId: z.string().uuid().nullable().optional(),
  })
  .strict();

export type CreatePolygonCommentRequest = z.input<
  typeof CreatePolygonCommentRequestSchema
>;

export const CommentVoteRequestSchema = z
  .union([
    z.object({ value: z.literal(1).optional() }).strict(),
    z.undefined(),
    z.null(),
  ])
  .transform(() => ({ value: 1 as const }));

export type CommentVoteRequest = z.input<typeof CommentVoteRequestSchema>;

export const CommentVoteResponseSchema = z.object({
  commentId: z.string().uuid(),
  polygonId: z.string().uuid(),
  upvotes: z.number().int().nonnegative(),
  myVote: z.union([z.literal(0), z.literal(1)]),
});

export type CommentVoteResponse = z.infer<typeof CommentVoteResponseSchema>;

export function sortPolygonCommentsByRating<
  T extends { id: string; upvotes: number; createdAt: string },
>(comments: readonly T[]): T[] {
  return [...comments].sort((a, b) => {
    if (b.upvotes !== a.upvotes) {
      return b.upvotes - a.upvotes;
    }
    if (b.createdAt !== a.createdAt) {
      return b.createdAt.localeCompare(a.createdAt);
    }
    return a.id.localeCompare(b.id);
  });
}

export function findTopRatedCommentId(
  comments: readonly { id: string; upvotes: number; createdAt: string }[],
): string | null {
  if (comments.length === 0) {
    return null;
  }
  const sorted = sortPolygonCommentsByRating(comments);
  const top = sorted[0];
  return top && top.upvotes > 0 ? top.id : null;
}

export const ImportPolygonsResponseSchema = z.object({
  format: z.enum(['geojson', 'gpkg']),
  origin: z.enum(POLYGON_ORIGINS).optional(),
  importedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  errors: z.array(
    z.object({
      featureIndex: z.number().int().nonnegative(),
      reason: z.string(),
    }),
  ),
});

export type ImportPolygonsResponse = z.infer<typeof ImportPolygonsResponseSchema>;

export function computeMunicipalityNormalizedScore(
  score: number,
  status: PolygonStatus,
  municipalityAgs: string | null,
  municipalityMaxScore: number,
): number {
  if (status !== 'proposed' || score <= 0) {
    return 0;
  }
  const floor =
    municipalityAgs !== null
      ? MUNICIPALITY_NORMS.MIN_POSITIVE_SCORE_FLOOR
      : MUNICIPALITY_NORMS.UNBOUNDED_FALLBACK_FLOOR;
  const denom = Math.max(municipalityMaxScore, score, floor);
  return Math.min(1, Math.max(0, Number((score / denom).toFixed(4))));
}

export interface BboxBounds {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

const BboxStringSchema = z.string().superRefine((raw, ctx) => {
  const parts = raw.split(',');
  if (parts.length !== 4) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'bbox must contain 4 comma-separated numbers: minLng,minLat,maxLng,maxLat.',
    });
    return;
  }

  const nums: number[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!STRICT_NUMBER_RE.test(trimmed)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'bbox coordinates must be valid finite numbers.',
      });
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'bbox coordinates must be valid finite numbers.',
      });
      return;
    }
    nums.push(parsed);
  }

  const minLng = nums[0]!;
  const minLat = nums[1]!;
  const maxLng = nums[2]!;
  const maxLat = nums[3]!;

  if (minLng < -180 || maxLng > 180) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'bbox longitude bounds must be within [-180, 180].',
    });
  }
  if (minLat < -90 || maxLat > 90) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'bbox latitude bounds must be within [-90, 90].',
    });
  }
  if (minLng >= maxLng) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'bbox must satisfy minLng < maxLng.',
    });
  }
  if (minLat >= maxLat) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'bbox must satisfy minLat < maxLat.',
    });
  }
}).transform((raw): BboxBounds => {
  const parts = raw.split(',').map((p) => Number(p.trim()));
  return {
    minLng: parts[0]!,
    minLat: parts[1]!,
    maxLng: parts[2]!,
    maxLat: parts[3]!,
  };
});

export const BboxQuerySchema = z.union([
  z.object({ bbox: BboxStringSchema }).transform((q) => q.bbox),
  BboxStringSchema,
]);

export type BboxQuery = z.output<typeof BboxQuerySchema>;

const OptionalBooleanQueryParamSchema = z
  .union([
    z.boolean(),
    z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1'),
    z.undefined().transform(() => false),
  ])
  .optional()
  .default(false);

export const PolygonListQuerySchema = z
  .object({
    bbox: BboxStringSchema,
    filter: z.enum(POLYGON_FILTERS).optional(),
    authorType: z.enum(POLYGON_AUTHOR_FILTERS).optional(),
    unratedFlaggedOnly: OptionalBooleanQueryParamSchema,
  })
  .transform((q): { bbox: BboxBounds; filter: PolygonFilter } => {
    const resolvedFilter: PolygonFilter =
      q.filter ??
      (q.unratedFlaggedOnly
        ? 'needs_review'
        : q.authorType === 'new_user'
          ? 'new'
          : q.authorType === 'established'
            ? 'established'
            : 'all');
    return {
      bbox: q.bbox,
      filter: resolvedFilter,
    };
  });

export type PolygonListQuery = z.output<typeof PolygonListQuerySchema>;

export function checkBboxSpan(
  bbox: BboxBounds | readonly [number, number, number, number],
  maxSpanDeg: number = GEOMETRY_LIMITS.MAX_BBOX_SPAN_DEG,
): void {
  const bounds: BboxBounds = Array.isArray(bbox)
    ? {
        minLng: (bbox as readonly [number, number, number, number])[0],
        minLat: (bbox as readonly [number, number, number, number])[1],
        maxLng: (bbox as readonly [number, number, number, number])[2],
        maxLat: (bbox as readonly [number, number, number, number])[3],
      }
    : (bbox as BboxBounds);

  const lngSpan = bounds.maxLng - bounds.minLng;
  const latSpan = bounds.maxLat - bounds.minLat;

  if (lngSpan > maxSpanDeg + BBOX_SPAN_TOLERANCE || latSpan > maxSpanDeg + BBOX_SPAN_TOLERANCE) {
    throw new ApiError(
      422,
      'BBOX_TOO_LARGE',
      `Viewport bounding-box span must not exceed ${maxSpanDeg}° in longitude or latitude.`,
      {
        lngSpan,
        latSpan,
        maxBboxSpanDeg: maxSpanDeg,
      },
    );
  }
}

const PolygonResponseGeometrySchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(z.tuple([z.number().finite(), z.number().finite()]))),
});

export const PolygonFeatureSchema = z.object({
  type: z.literal('Feature'),
  id: z.string().uuid(),
  geometry: PolygonResponseGeometrySchema,
  properties: z.object({
    id: z.string().uuid(),
    surfaceType: z.enum(SURFACE_TYPES).catch('other'),
    status: z.enum(POLYGON_STATUSES).optional().default('proposed'),
    origin: z.enum(POLYGON_ORIGINS).catch('citizen').optional(),
    wasAutoClipped: z.boolean().optional(),
    clippedAreaM2: z.number().finite().nonnegative().optional(),
    finishedAt: IsoDateTimeSchema.nullable().optional().default(null),
    note: z.string().nullable(),
    areaM2: z.number().finite().nonnegative(),
    municipalityAgs: z.string().nullable().optional().default(null),
    municipalityName: z.string().nullable().optional().default(null),
    municipalityMaxScore: z.number().int().nonnegative().optional().default(0),
    municipalityNormalizedScore: z.number().min(0).max(1).optional().default(0),
    photoCount: z.number().int().nonnegative().optional().default(0),
    commentCount: z.number().int().nonnegative().optional().default(0),
    authorPseudonym: z.string().min(1),
    authorIsNewUser: z.boolean().optional().default(false),
    authorRecentlyActive: z.boolean().nullable().optional().default(null),
    flagCount: z.number().int().nonnegative().optional().default(0),
    isFlagged: z.boolean().optional().default(false),
    myFlag: z.boolean().optional().default(false),
    upvotes: z.number().int().min(0),
    downvotes: z.number().int().min(0),
    score: z.number().int(),
    myVote: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
    isAuthor: z.boolean(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  }),
});

export type PolygonFeature = z.output<typeof PolygonFeatureSchema>;

/**
 * Feature of the public ODbL-1.0 bulk export (`GET /api/v1/polygons/export.geojson`).
 *
 * GDPR data minimisation (Art. 5(1)(c)) and erasure (Art. 17(2)): exported copies
 * leave the operator's control, so the export carries no author pseudonym, author
 * trust/activity signal or viewer-specific fields. Unknown keys are rejected.
 */
export const ExportPolygonFeatureSchema = z.object({
  type: z.literal('Feature'),
  id: z.string().uuid(),
  geometry: PolygonResponseGeometrySchema,
  properties: PolygonFeatureSchema.shape.properties
    .omit({
      authorPseudonym: true,
      authorIsNewUser: true,
      authorRecentlyActive: true,
      myVote: true,
      myFlag: true,
      isAuthor: true,
    })
    .strict(),
});

export type ExportPolygonFeature = z.output<typeof ExportPolygonFeatureSchema>;

export const PolygonCollectionResponseSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(PolygonFeatureSchema),
  meta: z.object({
    truncated: z.boolean(),
    limit: z.number().int().nonnegative(),
  }),
});

export type PolygonCollectionResponse = z.output<typeof PolygonCollectionResponseSchema>;

export const GeocodeQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(2, 'Search query must be at least 2 characters.')
    .max(200, 'Search query must not exceed 200 characters.'),
  lang: z.enum(['de', 'en']).optional().default('de'),
});

export type GeocodeQuery = z.output<typeof GeocodeQuerySchema>;

export const GeocodeResultItemSchema = z.object({
  placeId: z.string().min(1),
  displayName: z.string().min(1),
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  boundingBox: z
    .tuple([
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
    ])
    .nullable(),
});

export type GeocodeResultItem = z.infer<typeof GeocodeResultItemSchema>;

export const GeocodeResponseSchema = z.object({
  results: z.array(GeocodeResultItemSchema),
});

export type GeocodeResponse = z.infer<typeof GeocodeResponseSchema>;

export const CreateBugReportRequestSchema = z
  .object({
    description: z
      .string()
      .trim()
      .min(5, 'Bug description must be at least 5 characters.')
      .max(4000, 'Bug description must not exceed 4000 characters.'),
    contactEmail: z.preprocess(
      (val) => (typeof val === 'string' && val.trim() === '' ? null : val),
      EmailSchema.nullable().optional(),
    ),
    platform: z.string().trim().max(64).nullable().optional(),
    pageUrl: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export type CreateBugReportRequest = z.input<typeof CreateBugReportRequestSchema>;

export const CreateBugReportResponseSchema = z.object({
  status: z.literal('sent'),
});

export type CreateBugReportResponse = z.infer<typeof CreateBugReportResponseSchema>;

export const SurfaceStatItemSchema = z.object({
  count: z.number().int().nonnegative(),
  areaM2: z.number().finite().nonnegative(),
});

export type SurfaceStatItem = z.output<typeof SurfaceStatItemSchema>;

export const SurfaceBreakdownSchema = z.object({
  asphalt: SurfaceStatItemSchema,
  concrete: SurfaceStatItemSchema,
  pavers: SurfaceStatItemSchema,
  other: SurfaceStatItemSchema,
});

export type SurfaceBreakdown = z.output<typeof SurfaceBreakdownSchema>;

export const PublicStatsResponseSchema = z.object({
  totalPolygons: z.number().int().nonnegative(),
  proposedCount: z.number().int().nonnegative(),
  inProgressCount: z.number().int().nonnegative(),
  finishedCount: z.number().int().nonnegative(),
  needsReviewCount: z.number().int().nonnegative(),
  totalAreaM2: z.number().finite().nonnegative(),
  unsealedAreaM2: z.number().finite().nonnegative(),
  totalVotes: z.number().int().nonnegative(),
  totalUpvotes: z.number().int().nonnegative(),
  totalDownvotes: z.number().int().nonnegative(),
  surfaceBreakdown: SurfaceBreakdownSchema,
});

export type PublicStatsResponse = z.output<typeof PublicStatsResponseSchema>;

export const PersonalStatsResponseSchema = z.object({
  totalPolygons: z.number().int().nonnegative(),
  proposedCount: z.number().int().nonnegative(),
  inProgressCount: z.number().int().nonnegative(),
  finishedCount: z.number().int().nonnegative(),
  totalAreaM2: z.number().finite().nonnegative(),
  unsealedAreaM2: z.number().finite().nonnegative(),
  ratedPolygonsCount: z.number().int().nonnegative(),
});

export type PersonalStatsResponse = z.output<typeof PersonalStatsResponseSchema>;
