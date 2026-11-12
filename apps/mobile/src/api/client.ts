import {
  ApiError,
  ApiErrorEnvelopeSchema,
  AuthUserSchema,
  PolygonCollectionResponseSchema,
  PolygonFeatureSchema,
  RegisterResponseSchema,
  RuntimeConfigSchema,
  SessionResponseSchema,
  VoteResponseSchema,
  type AuthUser,
  type BboxBounds,
  type CreatePolygonRequest,
  type ErrorCode,
  type LoginRequest,
  type PatchPolygonRequest,
  type PolygonCollectionResponse,
  type PolygonFeature,
  type RecoverRequest,
  type RegisterRequest,
  type RegisterResponse,
  type RuntimeConfig,
  type SessionResponse,
  type VoteResponse,
} from '@entsiegelung/shared';

import type { SessionStorage } from '../storage/tokenStorage';

export type FetchLike = typeof fetch;

export type BboxInput =
  | BboxBounds
  | readonly [number, number, number, number]
  | string;

interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
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
    throw new ApiError(422, 'VALIDATION_ERROR', 'Resource identifier must not be empty.');
  }
  return encodeURIComponent(trimmed);
}

export class PpgisApiClient {
  private readonly baseUrl: string;
  private readonly sessionStorage: SessionStorage;
  private readonly fetchImpl: FetchLike;

  constructor(
    baseUrl: string,
    sessionStorage: SessionStorage,
    fetchImpl: FetchLike = fetch,
  ) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.sessionStorage = sessionStorage;
    this.fetchImpl = fetchImpl;
  }

  public getExportGeoJsonUrl(): string {
    return `${this.baseUrl}/api/v1/polygons/export.geojson`;
  }

  public async getConfig(): Promise<RuntimeConfig> {
    const json = await this.requestJson({
      method: 'GET',
      path: '/api/v1/config',
      includeAuth: false,
    });
    return RuntimeConfigSchema.parse(json);
  }

  public async listPolygons(bbox: BboxInput): Promise<PolygonCollectionResponse> {
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

  public async createPolygon(input: CreatePolygonRequest): Promise<PolygonFeature> {
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

  public async register(input: RegisterRequest): Promise<RegisterResponse> {
    const json = await this.requestJson({
      method: 'POST',
      path: '/api/v1/auth/register',
      body: input,
      includeAuth: false,
    });
    const parsed = RegisterResponseSchema.parse(json);
    await this.sessionStorage.setToken(parsed.sessionToken);
    return parsed;
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

  public async recover(input: RecoverRequest): Promise<RegisterResponse> {
    const json = await this.requestJson({
      method: 'POST',
      path: '/api/v1/auth/recover',
      body: input,
      includeAuth: false,
    });
    const parsed = RegisterResponseSchema.parse(json);
    await this.sessionStorage.setToken(parsed.sessionToken);
    return parsed;
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

    if (options.body !== undefined) {
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
    const rawText = await response.text();
    try {
      return JSON.parse(rawText) as unknown;
    } catch (parseErr: unknown) {
      const detail =
        parseErr instanceof Error ? parseErr.message : 'Malformed JSON';
      throw new ApiError(
        502,
        'SERVICE_UNAVAILABLE',
        `Invalid JSON response from server: ${detail}`,
      );
    }
  }

  private async requestVoid(options: RequestOptions): Promise<void> {
    await this.executeFetch(options);
  }

  private async throwApiErrorFromResponse(response: Response): Promise<never> {
    const rawText = await response.text();
    if (rawText.length > 0) {
      let parsedBody: unknown = null;
      let isJson = false;
      try {
        parsedBody = JSON.parse(rawText) as unknown;
        isJson = true;
      } catch (jsonErr: unknown) {
        isJson = Boolean(jsonErr) && false;
      }

      if (isJson) {
        const envelope = ApiErrorEnvelopeSchema.safeParse(parsedBody);
        if (envelope.success) {
          throw new ApiError(
            response.status,
            envelope.data.error.code,
            envelope.data.error.message,
            envelope.data.error.details,
          );
        }
      }
    }

    const fallbackCode = statusToFallbackErrorCode(response.status);
    const fallbackMessage =
      rawText.trim().slice(0, 300) || `HTTP ${response.status}`;
    throw new ApiError(response.status, fallbackCode, fallbackMessage);
  }
}
