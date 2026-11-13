import {
  ApiError,
  ApiErrorEnvelopeSchema,
  AuthUserSchema,
  EmailActionResponseSchema,
  ImportPolygonsResponseSchema,
  PhotoVoteResponseSchema,
  PolygonCollectionResponseSchema,
  PolygonFeatureSchema,
  PolygonPhotoListResponseSchema,
  PolygonPhotoSchema,
  RegisterResponseSchema,
  ResetPasswordResponseSchema,
  RuntimeConfigSchema,
  SessionResponseSchema,
  VerifyEmailResponseSchema,
  VoteResponseSchema,
  type AuthUser,
  type BboxBounds,
  type CreatePolygonRequest,
  type EmailActionResponse,
  type ErrorCode,
  type ImportPolygonsResponse,
  type LoginRequest,
  type PatchPolygonRequest,
  type PhotoVoteResponse,
  type PolygonCollectionResponse,
  type PolygonFeature,
  type PolygonPhoto,
  type PolygonPhotoListResponse,
  type PolygonStatus,
  type RegisterRequest,
  type RegisterResponse,
  type ResetPasswordRequest,
  type ResetPasswordResponse,
  type RuntimeConfig,
  type SessionResponse,
  type VerifyEmailResponse,
  type VoteResponse,
} from '@entsiegelung/shared';

import type { SessionStorage } from '../storage/tokenStorage';

export type FetchLike = typeof fetch;

export type BboxInput =
  | BboxBounds
  | readonly [number, number, number, number]
  | string;

export interface UploadableFileInput {
  readonly uri?: string;
  readonly name: string;
  readonly mimeType: string;
  readonly webFile?: Blob;
}

interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  formData?: FormData;
  includeAuth?: boolean;
}

function normalizeBaseUrl(rawBaseUrl: string): string {
  return rawBaseUrl.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
}

function formatBboxQueryParam(bbox: BboxInput): string {
  if (typeof bbox === 'string') {
    return bbox;
  }
  if (Array.isArray(bbox)) {
    const tuple = bbox as readonly [number, number, number, number];
    return `${tuple[0]},${tuple[1]},${tuple[2]},${tuple[3]}`;
  }
  const bounds = bbox as BboxBounds;
  return `${bounds.minLng},${bounds.minLat},${bounds.maxLng},${bounds.maxLat}`;
}

function statusToFallbackErrorCode(status: number): ErrorCode {
  switch (status) {
    case 401:
      return 'AUTH_REQUIRED';
    case 403:
      return 'FORBIDDEN_NOT_AUTHOR';
    case 404:
      return 'NOT_FOUND';
    case 413:
      return 'PAYLOAD_TOO_LARGE';
    case 415:
      return 'UNSUPPORTED_MEDIA_TYPE';
    case 422:
      return 'VALIDATION_ERROR';
    case 429:
      return 'RATE_LIMITED';
    case 502:
    case 503:
    case 504:
      return 'SERVICE_UNAVAILABLE';
    default:
      return 'INTERNAL_ERROR';
  }
}

function assertNonEmptyId(id: string): string {
  const trimmed = id.trim();
  if (trimmed.length === 0) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Resource identifier must not be empty.',
    );
  }
  return encodeURIComponent(trimmed);
}

function buildUploadFormData(
  fieldName: string,
  file: UploadableFileInput,
): FormData {
  const form = new FormData();
  if (file.webFile !== undefined) {
    form.append(fieldName, file.webFile, file.name);
    return form;
  }
  if (!file.uri || file.uri.trim().length === 0) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Selected file is missing a readable URI or Blob.',
    );
  }
  const rnFilePart = {
    uri: file.uri,
    name: file.name,
    type: file.mimeType,
  };
  form.append(fieldName, rnFilePart as unknown as Blob);
  return form;
}

export class PpgisApiClient {
  private readonly baseUrl: string;
  private readonly sessionStorage: SessionStorage;
  private readonly fetchImpl: FetchLike;

  constructor(
    baseUrl: string,
    sessionStorage: SessionStorage,
    fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.sessionStorage = sessionStorage;
    this.fetchImpl = (input, init) => fetchImpl(input, init);
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public getExportGeoJsonUrl(): string {
    return `${this.baseUrl}/api/v1/polygons/export.geojson`;
  }

  public getPrivacyPolicyUrl(): string {
    return `${this.baseUrl}/auth/privacy`;
  }

  public resolveUploadUrl(relativeOrAbsoluteUrl: string): string {
    if (/^https?:\/\//i.test(relativeOrAbsoluteUrl)) {
      return relativeOrAbsoluteUrl;
    }
    const prefix = relativeOrAbsoluteUrl.startsWith('/') ? '' : '/';
    return `${this.baseUrl}${prefix}${relativeOrAbsoluteUrl}`;
  }

  public async getConfig(): Promise<RuntimeConfig> {
    const json = await this.requestJson({
      method: 'GET',
      path: '/api/v1/config',
      includeAuth: false,
    });
    return RuntimeConfigSchema.parse(json);
  }

  public async listPolygons(
    bbox: BboxInput,
  ): Promise<PolygonCollectionResponse> {
    const bboxParam = encodeURIComponent(formatBboxQueryParam(bbox));
    const json = await this.requestJson({
      method: 'GET',
      path: `/api/v1/polygons?bbox=${bboxParam}`,
      includeAuth: true,
    });
    return PolygonCollectionResponseSchema.parse(json);
  }

  public async getPolygon(id: string): Promise<PolygonFeature> {
    const encodedId = assertNonEmptyId(id);
    const json = await this.requestJson({
      method: 'GET',
      path: `/api/v1/polygons/${encodedId}`,
      includeAuth: true,
    });
    return PolygonFeatureSchema.parse(json);
  }

  public async createPolygon(
    input: CreatePolygonRequest,
  ): Promise<PolygonFeature> {
    const json = await this.requestJson({
      method: 'POST',
      path: '/api/v1/polygons',
      body: input,
      includeAuth: true,
    });
    return PolygonFeatureSchema.parse(json);
  }

  public async patchPolygon(
    id: string,
    input: PatchPolygonRequest,
  ): Promise<PolygonFeature> {
    const encodedId = assertNonEmptyId(id);
    const json = await this.requestJson({
      method: 'PATCH',
      path: `/api/v1/polygons/${encodedId}`,
      body: input,
      includeAuth: true,
    });
    return PolygonFeatureSchema.parse(json);
  }

  public async patchPolygonStatus(
    id: string,
    status: PolygonStatus,
  ): Promise<PolygonFeature> {
    const encodedId = assertNonEmptyId(id);
    const json = await this.requestJson({
      method: 'PATCH',
      path: `/api/v1/polygons/${encodedId}/status`,
      body: { status },
      includeAuth: true,
    });
    return PolygonFeatureSchema.parse(json);
  }

  public async importPolygonsFile(
    file: UploadableFileInput,
  ): Promise<ImportPolygonsResponse> {
    const formData = buildUploadFormData('file', file);
    const json = await this.requestJson({
      method: 'POST',
      path: '/api/v1/polygons/import',
      formData,
      includeAuth: true,
    });
    return ImportPolygonsResponseSchema.parse(json);
  }

  public async deletePolygon(id: string): Promise<void> {
    const encodedId = assertNonEmptyId(id);
    await this.requestVoid({
      method: 'DELETE',
      path: `/api/v1/polygons/${encodedId}`,
      includeAuth: true,
    });
  }

  public async putVote(id: string, value: 1 | -1): Promise<VoteResponse> {
    const encodedId = assertNonEmptyId(id);
    const json = await this.requestJson({
      method: 'PUT',
      path: `/api/v1/polygons/${encodedId}/vote`,
      body: { value },
      includeAuth: true,
    });
    return VoteResponseSchema.parse(json);
  }

  public async deleteVote(id: string): Promise<VoteResponse> {
    const encodedId = assertNonEmptyId(id);
    const json = await this.requestJson({
      method: 'DELETE',
      path: `/api/v1/polygons/${encodedId}/vote`,
      includeAuth: true,
    });
    return VoteResponseSchema.parse(json);
  }

  public async listPolygonPhotos(
    polygonId: string,
  ): Promise<PolygonPhotoListResponse> {
    const encodedId = assertNonEmptyId(polygonId);
    const json = await this.requestJson({
      method: 'GET',
      path: `/api/v1/polygons/${encodedId}/photos`,
      includeAuth: true,
    });
    return PolygonPhotoListResponseSchema.parse(json);
  }

  public async uploadPolygonPhoto(
    polygonId: string,
    file: UploadableFileInput,
  ): Promise<PolygonPhoto> {
    const encodedId = assertNonEmptyId(polygonId);
    const formData = buildUploadFormData('photo', file);
    const json = await this.requestJson({
      method: 'POST',
      path: `/api/v1/polygons/${encodedId}/photos`,
      formData,
      includeAuth: true,
    });
    return PolygonPhotoSchema.parse(json);
  }

  public async putPhotoVote(
    photoId: string,
    value: 1 | -1,
  ): Promise<PhotoVoteResponse> {
    const encodedId = assertNonEmptyId(photoId);
    const json = await this.requestJson({
      method: 'PUT',
      path: `/api/v1/photos/${encodedId}/vote`,
      body: { value },
      includeAuth: true,
    });
    return PhotoVoteResponseSchema.parse(json);
  }

  public async deletePhotoVote(photoId: string): Promise<PhotoVoteResponse> {
    const encodedId = assertNonEmptyId(photoId);
    const json = await this.requestJson({
      method: 'DELETE',
      path: `/api/v1/photos/${encodedId}/vote`,
      includeAuth: true,
    });
    return PhotoVoteResponseSchema.parse(json);
  }

  public async deletePhoto(photoId: string): Promise<void> {
    const encodedId = assertNonEmptyId(photoId);
    await this.requestVoid({
      method: 'DELETE',
      path: `/api/v1/photos/${encodedId}`,
      includeAuth: true,
    });
  }

  public async register(input: RegisterRequest): Promise<RegisterResponse> {
    const json = await this.requestJson({
      method: 'POST',
      path: '/api/v1/auth/register',
      body: input,
      includeAuth: false,
    });
    return RegisterResponseSchema.parse(json);
  }

  public async resendVerification(email: string): Promise<EmailActionResponse> {
    const json = await this.requestJson({
      method: 'POST',
      path: '/api/v1/auth/resend-verification',
      body: { email },
      includeAuth: false,
    });
    return EmailActionResponseSchema.parse(json);
  }

  public async verifyEmail(token: string): Promise<VerifyEmailResponse> {
    const json = await this.requestJson({
      method: 'POST',
      path: '/api/v1/auth/verify-email',
      body: { token },
      includeAuth: false,
    });
    return VerifyEmailResponseSchema.parse(json);
  }

  public async login(input: LoginRequest): Promise<SessionResponse> {
    const json = await this.requestJson({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: input,
      includeAuth: false,
    });
    const parsed = SessionResponseSchema.parse(json);
    await this.sessionStorage.setToken(parsed.sessionToken);
    return parsed;
  }

  public async forgotPassword(email: string): Promise<EmailActionResponse> {
    const json = await this.requestJson({
      method: 'POST',
      path: '/api/v1/auth/forgot-password',
      body: { email },
      includeAuth: false,
    });
    return EmailActionResponseSchema.parse(json);
  }

  public async resetPassword(
    input: ResetPasswordRequest,
  ): Promise<ResetPasswordResponse> {
    const json = await this.requestJson({
      method: 'POST',
      path: '/api/v1/auth/reset-password',
      body: input,
      includeAuth: false,
    });
    return ResetPasswordResponseSchema.parse(json);
  }

  public async logout(): Promise<void> {
    try {
      await this.requestVoid({
        method: 'POST',
        path: '/api/v1/auth/logout',
        includeAuth: true,
      });
    } catch (err: unknown) {
      if (err instanceof ApiError && err.statusCode === 401) {
        await this.sessionStorage.clearToken();
      }
      throw err;
    }
    await this.sessionStorage.clearToken();
  }

  public async getMe(): Promise<AuthUser> {
    const json = await this.requestJson({
      method: 'GET',
      path: '/api/v1/auth/me',
      includeAuth: true,
    });
    return AuthUserSchema.parse(json);
  }

  public async deleteMe(): Promise<void> {
    await this.requestVoid({
      method: 'DELETE',
      path: '/api/v1/auth/me',
      includeAuth: true,
    });
    await this.sessionStorage.clearToken();
  }

  private async executeFetch(options: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/json, application/geo+json',
    };

    if (options.includeAuth) {
      const token = await this.sessionStorage.getToken();
      if (token && token.length > 0) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    const init: RequestInit = {
      method: options.method,
      headers,
    };

    if (options.formData !== undefined) {
      init.body = options.formData;
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${options.path}`, init);
    } catch (networkErr: unknown) {
      const message =
        networkErr instanceof Error
          ? networkErr.message
          : 'Network request failed.';
      throw new ApiError(503, 'SERVICE_UNAVAILABLE', message);
    }

    if (!response.ok) {
      await this.throwApiErrorFromResponse(response);
    }

    return response;
  }

  private async requestJson(options: RequestOptions): Promise<unknown> {
    const response = await this.executeFetch(options);
    try {
      return await response.json();
    } catch {
      throw new ApiError(
        502,
        'SERVICE_UNAVAILABLE',
        'Invalid JSON response received from API server.',
      );
    }
  }

  private async requestVoid(options: RequestOptions): Promise<void> {
    await this.executeFetch(options);
  }

  private async throwApiErrorFromResponse(response: Response): Promise<never> {
    let rawBody = '';
    try {
      rawBody = await response.text();
    } catch {
      rawBody = '';
    }

    if (rawBody.trim().length > 0) {
      try {
        const parsedJson: unknown = JSON.parse(rawBody);
        const envelope = ApiErrorEnvelopeSchema.safeParse(parsedJson);
        if (envelope.success) {
          throw new ApiError(
            response.status,
            envelope.data.error.code,
            envelope.data.error.message,
            envelope.data.error.details,
          );
        }
      } catch (err: unknown) {
        if (err instanceof ApiError) {
          throw err;
        }
      }
    }

    const fallbackCode = statusToFallbackErrorCode(response.status);
    const fallbackMessage =
      rawBody.trim().length > 0 && rawBody.length <= 240
        ? rawBody.trim()
        : `Request failed with HTTP ${response.status}.`;
    throw new ApiError(response.status, fallbackCode, fallbackMessage);
  }
}
