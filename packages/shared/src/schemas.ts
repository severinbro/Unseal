import { z } from 'zod';

import { AUTH_LIMITS, GEOMETRY_LIMITS, SURFACE_TYPES } from './constants.js';
import { ApiError } from './errors.js';
import { checkPolygonRingStructure } from './geometry.js';

const utf8Encoder = new TextEncoder();
const STRICT_NUMBER_RE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const BBOX_SPAN_TOLERANCE = 1e-9;

const IsoDateTimeSchema = z.string().datetime({ offset: true });

const PseudonymSchema = z
  .string()
  .regex(
    AUTH_LIMITS.PSEUDONYM_REGEX,
    'Pseudonym must be 3 to 32 characters containing only letters, digits, underscores, or hyphens.',
  );

const PasswordSchema = z.string().superRefine((password, ctx) => {
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

export function normalizeRecoveryCode(input: string): string {
  return input.replace(/[-\s]/g, '').toUpperCase();
}

export const RegisterRequestSchema = z
  .object({
    pseudonym: PseudonymSchema,
    password: PasswordSchema,
  })
  .strict();

export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z
  .object({
    pseudonym: PseudonymSchema,
    password: PasswordSchema,
  })
  .strict();

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const RecoverRequestSchema = z
  .object({
    pseudonym: PseudonymSchema,
    recoveryCode: z.string().min(1).max(128),
    newPassword: PasswordSchema,
  })
  .strict();

export type RecoverRequest = z.infer<typeof RecoverRequestSchema>;

export const AuthUserSchema = z.object({
  id: z.string().uuid(),
  pseudonym: PseudonymSchema,
  createdAt: IsoDateTimeSchema,
});

export type AuthUser = z.infer<typeof AuthUserSchema>;

export const RegisterResponseSchema = z.object({
  user: AuthUserSchema,
  sessionToken: z.string().min(1),
  expiresAt: IsoDateTimeSchema,
  recoveryCode: z.string().min(1),
});

export type RegisterResponse = z.infer<typeof RegisterResponseSchema>;

export const SessionResponseSchema = z.object({
  user: AuthUserSchema,
  sessionToken: z.string().min(1),
  expiresAt: IsoDateTimeSchema,
});

export type SessionResponse = z.infer<typeof SessionResponseSchema>;

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
  orthophoto: OrthophotoConfigSchema.nullable(),
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
});

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

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
    note: z.string().nullable(),
    areaM2: z.number().finite().nonnegative(),
    authorPseudonym: z.string().min(1),
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

export const PolygonCollectionResponseSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(PolygonFeatureSchema),
  meta: z.object({
    truncated: z.boolean(),
    limit: z.number().int().nonnegative(),
  }),
});

export type PolygonCollectionResponse = z.output<typeof PolygonCollectionResponseSchema>;
