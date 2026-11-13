import { z } from 'zod';

export const ERROR_CODES = [
  'AUTH_REQUIRED',
  'AUTH_INVALID_CREDENTIALS',
  'AUTH_PSEUDONYM_TAKEN',
  'AUTH_EMAIL_TAKEN',
  'AUTH_EMAIL_UNVERIFIED',
  'AUTH_TOKEN_INVALID',
  'FORBIDDEN_PSEUDONYM_BANNED',
  'AUTH_RECOVERY_INVALID',
  'AUTH_BUSY',
  'FORBIDDEN_NOT_AUTHOR',
  'FORBIDDEN_ADMIN_ONLY',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'UNSUPPORTED_MEDIA_TYPE',
  'GEOMETRY_INVALID',
  'AREA_OUT_OF_BOUNDS',
  'BBOX_TOO_LARGE',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ErrorCodeSchema = z.enum(ERROR_CODES);

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details?: unknown;

  constructor(statusCode: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export const ApiErrorEnvelopeSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string(),
  }),
});

export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelopeSchema>;
