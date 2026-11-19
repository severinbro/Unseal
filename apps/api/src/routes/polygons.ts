// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Unseal Contributors

import { Readable } from 'node:stream';

import {
  ApiError,
  CreatePolygonRequestSchema,
  FlagPolygonRequestSchema,
  FlagPolygonResponseSchema,
  IMPORT_LIMITS,
  ImportPolygonsResponseSchema,
  POLYGON_ORIGINS,
  PatchPolygonRequestSchema,
  PatchPolygonStatusRequestSchema,
  PolygonFeatureSchema,
  PolygonListQuerySchema,
  UuidParamSchema,
  checkBboxSpan,
  type PolygonCollectionResponse,
  type ExportPolygonFeature,
  type PolygonOrigin,
} from '@entsiegelung/shared';

import { optionalAuth, requireAdmin, requireAuth } from '../auth/session.js';
import { recordTelemetryBestEffort } from '../db/telemetry.js';
import {
  BKG_VG250_DATENQUELLEN_URL,
  getMunicipalitiesStatus,
} from '../municipalities/vg250.js';
import {
  assertCompatibleImportLicenseParam,
  extractImportDataset,
} from '../polygons/gpkgReader.js';
import { PolygonRepository, type ExportCursor } from '../polygons/repository.js';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export interface RegisterPolygonRoutesOptions {
  exportBatchSize?: number | undefined;
  exportStatementTimeoutMs?: number | undefined;
  exportStreamTimeoutMs?: number | undefined;
}

const DEFAULT_EXPORT_BATCH_SIZE = 1_000;
const DEFAULT_EXPORT_STATEMENT_TIMEOUT_MS = 10_000;
const DEFAULT_EXPORT_STREAM_TIMEOUT_MS = 30_000;

function applyOptionalAuthCacheHeaders(
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  reply.header('Vary', 'Authorization');
  reply.header(
    'Cache-Control',
    request.headers.authorization !== undefined
      ? 'no-store'
      : 'public, max-age=5',
  );
}

function serializeFeatureBatch(
  features: readonly ExportPolygonFeature[],
  isFirstFeature: boolean,
): { chunk: string; nextIsFirstFeature: boolean } {
  let chunk = '';
  let first = isFirstFeature;
  for (const feature of features) {
    chunk += (first ? '' : ',') + JSON.stringify(feature);
    first = false;
  }
  return { chunk, nextIsFirstFeature: first };
}

function mapExportQueryError(err: unknown, timedOut: boolean): unknown {
  if (err instanceof ApiError) {
    return err;
  }
  const pgCode =
    typeof err === 'object' && err !== null && 'code' in err
      ? (err as { code?: unknown }).code
      : undefined;
  if (timedOut || pgCode === '57014') {
    return new ApiError(
      503,
      'SERVICE_UNAVAILABLE',
      'GeoJSON export timed out.',
    );
  }
  return err;
}

export function registerPolygonRoutes(
  app: FastifyInstance,
  repository: PolygonRepository = new PolygonRepository(
    app.pool,
    app.config.uploadsDir,
    {
      minAccountDays: app.config.newUserMinAccountDays,
      minCleanPolygons: app.config.newUserMinCleanPolygons,
    },
  ),
  options: RegisterPolygonRoutesOptions = {},
): void {
  if (!app.hasRequestDecorator('auth')) {
    app.decorateRequest('auth', null);
  }

  const createPolygonLimit = app.rateLimitOverrides.createPolygon ?? {
    max: 30,
    timeWindow: '1 minute',
  };
  const mutatePolygonLimit = app.rateLimitOverrides.mutatePolygon ?? {
    max: 30,
    timeWindow: '1 minute',
  };
  const exportGeoJsonLimit = app.rateLimitOverrides.exportGeoJson ?? {
    max: 6,
    timeWindow: '1 minute',
  };

  const exportBatchSize = options.exportBatchSize ?? DEFAULT_EXPORT_BATCH_SIZE;
  const exportStreamTimeoutMs =
    options.exportStreamTimeoutMs ?? DEFAULT_EXPORT_STREAM_TIMEOUT_MS;
  const exportStatementTimeoutMs = Math.min(
    options.exportStatementTimeoutMs ?? DEFAULT_EXPORT_STATEMENT_TIMEOUT_MS,
    exportStreamTimeoutMs,
  );

  app.get(
    '/api/v1/polygons',
    {
      preHandler: optionalAuth,
    },
    async (request, reply) => {
      applyOptionalAuthCacheHeaders(request, reply);
      const query = PolygonListQuerySchema.parse(request.query);
      checkBboxSpan(query.bbox, app.config.runtimeConfig.limits.maxBboxSpanDeg);

      const viewerUserId = request.auth?.user.id ?? null;
      const result = await repository.listByBbox({
        bbox: query.bbox,
        viewerUserId,
        limit: app.config.runtimeConfig.limits.bboxFeatureLimit,
        filter: query.filter,
      });

      const response: PolygonCollectionResponse = {
        type: 'FeatureCollection',
        features: result.features,
        meta: {
          truncated: result.truncated,
          limit: result.limit,
        },
      };
      return response;
    },
  );

  app.get(
    '/api/v1/polygons/export.geojson',
    {
      config: {
        rateLimit: exportGeoJsonLimit,
      },
    },
    async (_request, reply) => {
      const releasePermit = await app.exportSemaphore.acquire();
      let released = false;
      let timedOut = false;
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

      const releaseOnce = (): void => {
        if (released) {
          return;
        }
        released = true;
        if (timeoutHandle !== null) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        releasePermit();
      };

      try {
        const muniStatus = await getMunicipalitiesStatus(app.pool).catch(() => ({
          seeded: false,
          dataYear: null,
        }));
        const vg250Active = app.config.autoSeedVg250 || muniStatus.seeded;
        async function* generateGeoJsonStream(): AsyncGenerator<
          Buffer,
          void,
          undefined
        > {
          try {
            let cursor: ExportCursor | undefined;
            let isFirstFeature = true;

            const firstBatch = await repository
              .fetchExportBatch(undefined, exportBatchSize, exportStatementTimeoutMs)
              .catch((err: unknown) => {
                throw mapExportQueryError(err, timedOut);
              });

            if (timedOut) {
              throw new ApiError(
                503,
                'SERVICE_UNAVAILABLE',
                'GeoJSON export stream timed out.',
              );
            }

            const exportYear = new Date().getUTCFullYear();
            const vg250Year = muniStatus.dataYear ?? exportYear;
            const attributionClauses: string[] = [
              'Compiled polygon dataset licensed under Open Data Commons Open Database License 1.0 (ODbL-1.0, https://opendatacommons.org/licenses/odbl/1-0/); contributors waive their own copyright and database rights in submitted geometries, surface classifications, and notes via CC0 1.0 Universal (https://creativecommons.org/publicdomain/zero/1.0/) to the extent not derived from attributed basemaps.',
              'Basemap reference: © OpenStreetMap contributors (ODbL, https://www.openstreetmap.org/copyright).',
            ];
            if (app.config.orthophoto !== null) {
              if (
                app.config.orthophoto.urlTemplate.includes('/api/v1/tiles/dop20/')
              ) {
                attributionClauses.push(
                  `Aerial orthophoto reference: © GeoBasis-DE / German State Survey Offices (${exportYear}; DOP20/DOP10 under dl-de/by-2-0 https://www.govdata.de/dl-de/by-2-0, CC BY 4.0 https://creativecommons.org/licenses/by/4.0/, dl-de/zero-2-0 https://www.govdata.de/dl-de/zero-2-0; Daten verändert).`,
                );
              } else if (app.config.orthophoto.attribution.trim().length > 0) {
                attributionClauses.push(
                  `Aerial orthophoto reference: ${app.config.orthophoto.attribution.trim()}.`,
                );
              }
            }
            if (vg250Active) {
              attributionClauses.push(
                `Municipality codes/names derived from VG250: © GeoBasis-DE / BKG (${vg250Year}) dl-de/by-2-0 (https://www.govdata.de/dl-de/by-2-0), Datenquellen: ${BKG_VG250_DATENQUELLEN_URL} (Daten verändert).`,
              );
            }
            const exportAttribution = attributionClauses.join(' ');
            const collectionPrefix = `{"type":"FeatureCollection","license":"ODbL-1.0","licenseUrl":"https://opendatacommons.org/licenses/odbl/1-0/","contributorRights":"CC0-1.0","contributorRightsUrl":"https://creativecommons.org/publicdomain/zero/1.0/","attribution":${JSON.stringify(
              exportAttribution,
            )},"features":[`;

            if (firstBatch.features.length === 0) {
              yield Buffer.from(`${collectionPrefix}]}`, 'utf8');
              return;
            }

            const firstSerialized = serializeFeatureBatch(
              firstBatch.features,
              isFirstFeature,
            );
            isFirstFeature = firstSerialized.nextIsFirstFeature;
            cursor = firstBatch.nextCursor;

            yield Buffer.from(
              `${collectionPrefix}${firstSerialized.chunk}`,
              'utf8',
            );

            while (cursor !== undefined) {
              if (timedOut) {
                throw new ApiError(
                  503,
                  'SERVICE_UNAVAILABLE',
                  'GeoJSON export stream timed out.',
                );
              }

              const nextBatch = await repository
                .fetchExportBatch(cursor, exportBatchSize, exportStatementTimeoutMs)
                .catch((err: unknown) => {
                  throw mapExportQueryError(err, timedOut);
                });

              if (timedOut) {
                throw new ApiError(
                  503,
                  'SERVICE_UNAVAILABLE',
                  'GeoJSON export stream timed out.',
                );
              }

              if (nextBatch.features.length === 0) {
                break;
              }

              const serialized = serializeFeatureBatch(
                nextBatch.features,
                isFirstFeature,
              );
              isFirstFeature = serialized.nextIsFirstFeature;
              cursor = nextBatch.nextCursor;

              yield Buffer.from(serialized.chunk, 'utf8');
            }

            yield Buffer.from(']}', 'utf8');
          } finally {
            releaseOnce();
          }
        }

        const stream = Readable.from(generateGeoJsonStream(), {
          objectMode: false,
        });
        stream.once('close', releaseOnce);
        stream.once('error', releaseOnce);
        reply.raw.once('close', releaseOnce);

        timeoutHandle = setTimeout(() => {
          timedOut = true;
          stream.destroy(
            new ApiError(
              503,
              'SERVICE_UNAVAILABLE',
              'GeoJSON export stream timed out.',
            ),
          );
          releaseOnce();
        }, exportStreamTimeoutMs);
        timeoutHandle.unref();

        reply.header('Content-Type', 'application/geo+json');
        reply.header('Content-License', 'ODbL-1.0');
        reply.header(
          'Link',
          `<https://opendatacommons.org/licenses/odbl/1-0/>; rel="license", <${app.config.licensesUrl}>; rel="describedby", <${app.config.termsUrl}>; rel="terms-of-service"`,
        );
        reply.header(
          'Content-Disposition',
          'attachment; filename="entsiegelung-proposals.geojson"',
        );
        return reply.send(stream);
      } catch (err: unknown) {
        releaseOnce();
        throw err;
      }
    },
  );

  app.get(
    '/api/v1/polygons/:id',
    {
      preHandler: optionalAuth,
    },
    async (request, reply) => {
      applyOptionalAuthCacheHeaders(request, reply);
      const { id } = UuidParamSchema.parse(request.params);
      const viewerUserId = request.auth?.user.id ?? null;

      const feature = await repository.getById(id, viewerUserId);
      if (!feature) {
        throw new ApiError(404, 'NOT_FOUND', 'Polygon not found.');
      }
      return feature;
    },
  );

  app.post(
    '/api/v1/polygons',
    {
      config: {
        rateLimit: createPolygonLimit,
      },
      preHandler: requireAuth,
    },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) {
        throw new ApiError(
          401,
          'AUTH_REQUIRED',
          'Valid bearer session token is required.',
        );
      }

      const parsedBody = CreatePolygonRequestSchema.safeParse(request.body);
      if (!parsedBody.success) {
        const hasGeometryIssue = parsedBody.error.issues.some(
          (issue) => issue.path[0] === 'geometry',
        );
        if (hasGeometryIssue) {
          await recordTelemetryBestEffort(
            app.pool,
            'polygon_rejected',
            'schema_geometry',
          );
        }
        throw parsedBody.error;
      }
      const body = parsedBody.data;
      const created = await repository.create({
        userId: auth.user.id,
        geometry: body.geometry,
        surfaceType: body.surfaceType,
        note: body.note,
        maxDailyPolygonsPerUser: app.config.maxDailyPolygonsPerUser,
        minAreaM2: app.config.runtimeConfig.limits.minAreaM2,
        maxAreaM2: app.config.runtimeConfig.limits.maxAreaM2,
        requireJurisdiction: app.config.requireJurisdiction,
      });

      return reply.status(201).send(PolygonFeatureSchema.parse(created));
    },
  );

  app.patch(
    '/api/v1/polygons/:id',
    {
      config: {
        rateLimit: mutatePolygonLimit,
      },
      preHandler: requireAuth,
    },
    async (request) => {
      const auth = request.auth;
      if (!auth) {
        throw new ApiError(
          401,
          'AUTH_REQUIRED',
          'Valid bearer session token is required.',
        );
      }

      const { id } = UuidParamSchema.parse(request.params);
      const body = PatchPolygonRequestSchema.parse(request.body);
      const updated = await repository.patch({
        polygonId: id,
        userId: auth.user.id,
        surfaceType: body.surfaceType,
        note: body.note,
      });

      return PolygonFeatureSchema.parse(updated);
    },
  );

  app.post(
    '/api/v1/polygons/import',
    {
      bodyLimit: IMPORT_LIMITS.MAX_FILE_BYTES + 1024 * 1024,
      preHandler: requireAdmin,
    },
    async (request) => {
      const auth = request.auth!;
      if (!request.isMultipart()) {
        throw new ApiError(
          415,
          'UNSUPPORTED_MEDIA_TYPE',
          'Multipart form-data upload is required for GeoJSON / GeoPackage import.',
        );
      }

      const uploaded = await request.file({
        limits: {
          fileSize: IMPORT_LIMITS.MAX_FILE_BYTES,
          files: 1,
        },
      });
      if (!uploaded) {
        throw new ApiError(
          422,
          'VALIDATION_ERROR',
          'No file uploaded in multipart field.',
        );
      }

      const buffer = await uploaded.toBuffer();
      if (uploaded.file.truncated) {
        throw new ApiError(
          413,
          'PAYLOAD_TOO_LARGE',
          `Import file exceeds ${Math.round(IMPORT_LIMITS.MAX_FILE_BYTES / (1024 * 1024))} MB limit.`,
        );
      }

      const queryObj =
        typeof request.query === 'object' && request.query !== null
          ? (request.query as { origin?: unknown; license?: unknown })
          : {};
      let importOrigin: PolygonOrigin = 'initiative_import';
      if (queryObj.origin !== undefined) {
        const rawOrigin =
          typeof queryObj.origin === 'string'
            ? queryObj.origin.trim().toLowerCase()
            : '';
        if (!(POLYGON_ORIGINS as readonly string[]).includes(rawOrigin)) {
          throw new ApiError(
            422,
            'VALIDATION_ERROR',
            'Import origin must be "citizen", "initiative_import", or "remote_sensing".',
          );
        }
        importOrigin = rawOrigin as PolygonOrigin;
      }
      if (queryObj.license !== undefined) {
        if (typeof queryObj.license !== 'string' || queryObj.license.trim().length === 0) {
          throw new ApiError(
            422,
            'VALIDATION_ERROR',
            'When specified, import license query parameter must be a non-empty ODbL-compatible license identifier.',
          );
        }
        assertCompatibleImportLicenseParam(queryObj.license);
      }

      const dataset = await extractImportDataset(
        buffer,
        uploaded.filename || 'import.geojson',
      );
      const imported = await repository.importBatch({
        adminUserId: auth.user.id,
        dataset,
        origin: importOrigin,
        minAreaM2: app.config.runtimeConfig.limits.minAreaM2,
        maxAreaM2: Math.max(
          IMPORT_LIMITS.MAX_AREA_M2,
          app.config.runtimeConfig.limits.maxAreaM2,
        ),
      });

      return ImportPolygonsResponseSchema.parse(imported);
    },
  );

  app.patch(
    '/api/v1/polygons/:id/status',
    {
      config: {
        rateLimit: mutatePolygonLimit,
      },
      preHandler: requireAdmin,
    },
    async (request) => {
      const auth = request.auth!;
      const { id } = UuidParamSchema.parse(request.params);
      const body = PatchPolygonStatusRequestSchema.parse(request.body);

      const updated = await repository.setStatus({
        polygonId: id,
        adminUserId: auth.user.id,
        status: body.status,
      });

      return PolygonFeatureSchema.parse(updated);
    },
  );

  app.post(
    '/api/v1/polygons/:id/flag',
    {
      config: {
        rateLimit: mutatePolygonLimit,
      },
      preHandler: requireAuth,
    },
    async (request) => {
      const auth = request.auth;
      if (!auth) {
        throw new ApiError(
          401,
          'AUTH_REQUIRED',
          'Valid bearer session token is required.',
        );
      }

      const { id } = UuidParamSchema.parse(request.params);
      const body = FlagPolygonRequestSchema.parse(request.body);
      const flagged = await repository.flagPolygon({
        polygonId: id,
        userId: auth.user.id,
        actorIsAdmin: auth.user.role === 'admin',
        reason: body.reason,
        note: 'note' in body ? body.note : undefined,
      });

      return FlagPolygonResponseSchema.parse(flagged);
    },
  );

  app.delete(
    '/api/v1/polygons/:id/flag',
    {
      config: {
        rateLimit: mutatePolygonLimit,
      },
      preHandler: requireAuth,
    },
    async (request) => {
      const auth = request.auth;
      if (!auth) {
        throw new ApiError(
          401,
          'AUTH_REQUIRED',
          'Valid bearer session token is required.',
        );
      }

      const { id } = UuidParamSchema.parse(request.params);
      const unflagged = await repository.unflagPolygon({
        polygonId: id,
        userId: auth.user.id,
        actorIsAdmin: auth.user.role === 'admin',
      });

      return FlagPolygonResponseSchema.parse(unflagged);
    },
  );

  app.delete(
    '/api/v1/polygons/:id/flags',
    {
      config: {
        rateLimit: mutatePolygonLimit,
      },
      preHandler: requireAdmin,
    },
    async (request) => {
      const auth = request.auth!;
      const { id } = UuidParamSchema.parse(request.params);
      const cleared = await repository.clearFlagsAsAdmin({
        polygonId: id,
        adminUserId: auth.user.id,
      });

      return FlagPolygonResponseSchema.parse(cleared);
    },
  );

  app.delete(
    '/api/v1/polygons/:id',
    {
      config: {
        rateLimit: mutatePolygonLimit,
      },
      preHandler: requireAuth,
    },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) {
        throw new ApiError(
          401,
          'AUTH_REQUIRED',
          'Valid bearer session token is required.',
        );
      }

      const { id } = UuidParamSchema.parse(request.params);
      await repository.delete(id, auth.user.id, auth.user.role === 'admin');
      return reply.status(204).send();
    },
  );
}
