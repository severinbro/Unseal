import { AUTH_LIMITS, GEOMETRY_LIMITS, RESERVED_PSEUDONYMS, SURFACE_TYPES, type SurfaceType } from './constants.js';
import { ApiError, ApiErrorEnvelopeSchema, ERROR_CODES, ErrorCodeSchema, type ApiErrorEnvelope, type ErrorCode } from './errors.js';
import { checkPolygonRingStructure, closeRingIfNeeded, dedupeConsecutivePoints, validateDraftPolygon, type DraftValidationResult, type RingStructureCheckResult } from './geometry.js';
import { AuthUserSchema, BboxQuerySchema, CreatePolygonRequestSchema, HealthResponseSchema, LoginRequestSchema, PatchPolygonRequestSchema, PolygonCollectionResponseSchema, PolygonFeatureSchema, RecoverRequestSchema, RegisterRequestSchema, RegisterResponseSchema, RuntimeConfigSchema, SessionResponseSchema, UuidParamSchema, VoteRequestSchema, VoteResponseSchema, checkBboxSpan, normalizeRecoveryCode, type AuthUser, type BboxBounds, type BboxQuery, type CreatePolygonRequest, type HealthResponse, type LoginRequest, type PatchPolygonRequest, type PolygonCollectionResponse, type PolygonFeature, type RecoverRequest, type RegisterRequest, type RegisterResponse, type RuntimeConfig, type SessionResponse, type UuidParam, type VoteRequest, type VoteResponse } from './schemas.js';

export { SURFACE_TYPES, GEOMETRY_LIMITS, AUTH_LIMITS, RESERVED_PSEUDONYMS, type SurfaceType };
export { ERROR_CODES, ErrorCodeSchema, ApiError, ApiErrorEnvelopeSchema, type ErrorCode, type ApiErrorEnvelope };
export { checkPolygonRingStructure, dedupeConsecutivePoints, closeRingIfNeeded, validateDraftPolygon, type DraftValidationResult, type RingStructureCheckResult };
export {
  RegisterRequestSchema,
  LoginRequestSchema,
  RecoverRequestSchema,
  AuthUserSchema,
  RegisterResponseSchema,
  SessionResponseSchema,
  HealthResponseSchema,
  RuntimeConfigSchema,
  UuidParamSchema,
  CreatePolygonRequestSchema,
  PatchPolygonRequestSchema,
  VoteRequestSchema,
  VoteResponseSchema,
  PolygonFeatureSchema,
  PolygonCollectionResponseSchema,
  BboxQuerySchema,
  checkBboxSpan,
  normalizeRecoveryCode, type RuntimeConfig, type PolygonFeature, type RegisterRequest, type LoginRequest, type RecoverRequest, type AuthUser, type RegisterResponse, type SessionResponse, type HealthResponse, type UuidParam, type CreatePolygonRequest, type PatchPolygonRequest, type VoteRequest, type VoteResponse, type PolygonCollectionResponse, type BboxBounds, type BboxQuery,
};
