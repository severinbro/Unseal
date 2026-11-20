// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 OpenUnseal Contributors

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
} from '@openunseal/shared';

import { optionalAuth, requireAdmin, requireAuth } from '../auth/session.js';
import { recordTelemetryBestEffort } from '../db/telemetry.js';
import {
  BKG_VG250_DATENQUELLEN_URL,
  getMunicipalitiesStatus,
} from '../municipalities/vg250.js';
import {
  assertCompatibleImportLicenseParam,
  extractImportDataset,
  type ResolvedImportLicensePolicy,
} from '../polygons/gpkgReader.js';
import {
  PolygonRepository,
  type ExportCursor,
  type ImportAttributionMetadata,
} from '../polygons/repository.js';
import {
  extractOptionalModerationReason,
  notifyAuthorOfModerationActionBestEffort,
} from '../util/moderationNotice.js';
import { buildPublicPolygonWebhookData } from '../util/webhooks.js';

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
  includeMunicipality: boolean = true,
): { chunk: string; nextIsFirstFeature: boolean } {
  let chunk = '';
  let first = isFirstFeature;
  for (const feature of features) {
    const outFeature: ExportPolygonFeature = includeMunicipality
      ? feature
      : {
          ...feature,
          properties: {
            ...feature.properties,
            municipalityAgs: null,
            municipalityName: null,
            municipalityMaxScore: 0,
            municipalityNormalizedScore: 0,
          },
        };
    chunk += (first ? '' : ',') + JSON.stringify(outFeature);
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
    async (request, reply) => {
      const exportQuery =
        typeof request.query === 'object' && request.query !== null
          ? (request.query as { includeMunicipality?: unknown })
          : {};
      let includeMunicipality = true;
      if (exportQuery.includeMunicipality !== undefined) {
        const rawInc =
          typeof exportQuery.includeMunicipality === 'string'
            ? exportQuery.includeMunicipality.trim().toLowerCase()
            : exportQuery.includeMunicipality === true
              ? 'true'
              : exportQuery.includeMunicipality === false
                ? 'false'
                : '';
        if (rawInc === 'true' || rawInc === '1') {
          includeMunicipality = true;
        } else if (rawInc === 'false' || rawInc === '0') {
          includeMunicipality = false;
        } else {
          throw new ApiError(
            422,
            'VALIDATION_ERROR',
            'Query parameter "includeMunicipality" must be "true" or "false".',
          );
        }
      }

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
        const vg250Active =
          includeMunicipality && (app.config.autoSeedVg250 || muniStatus.seeded);
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

            const activeImportAttributions =
              firstBatch.features.length > 0
                ? await repository
                    .listActiveImportAttributions(exportStatementTimeoutMs)
                    .catch(() => [])
                : [];

            const exportYear = new Date().getUTCFullYear();
            const vg250Year = muniStatus.dataYear ?? exportYear;
            const usesBuiltinDop20 = Boolean(
              app.config.orthophoto?.urlTemplate.includes('/api/v1/tiles/dop20/'),
            );
            const hasCcBy40Import = activeImportAttributions.some(
              (item) => item.license === 'CC-BY-4.0',
            );
            const hasDlDeBy20Import = activeImportAttributions.some(
              (item) => item.license === 'dl-de/by-2-0',
            );

            const upstreamConditionParts: string[] = [];
            if (usesBuiltinDop20 || hasCcBy40Import) {
              upstreamConditionParts.push(
                'Upstream CC BY 4.0 conditions (https://creativecommons.org/licenses/by/4.0/, including §§ 2(a)(5)(B) & 3(b) prohibiting Effective Technological Measures / DRM; ODbL-1.0 § 4.7(b) parallel-distribution DRM does not override upstream CC BY 4.0) remain concurrently binding on Adapted Material derived from CC BY 4.0 aerial orthophotos or imports.',
              );
            }
            if (usesBuiltinDop20 || vg250Active || hasDlDeBy20Import) {
              upstreamConditionParts.push(
                'Upstream Datenlizenz Deutschland – Namensnennung 2.0 (dl-de/by-2-0, https://www.govdata.de/dl-de/by-2-0) source-attribution obligations remain concurrently binding on municipality attributes and elements derived from dl-de/by-2-0 sources; OpenStreetMap-specific agency waivers/addenda apply solely when contributing directly to OpenStreetMap.',
              );
            }

            const attributionClauses: string[] = [
              'Compiled polygon dataset licensed under Open Data Commons Open Database License 1.0 (ODbL-1.0, https://opendatacommons.org/licenses/odbl/1-0/), subject to concurrent upstream open-data conditions where applicable; contributors waive their own copyright and database rights in submitted geometries, surface classifications, and notes via CC0 1.0 Universal (https://creativecommons.org/publicdomain/zero/1.0/, incl. Section 3 Public License Fallback) to the extent not derived from attributed basemaps.',
              'Basemap reference: © OpenStreetMap contributors (ODbL, https://www.openstreetmap.org/copyright).',
            ];
            if (app.config.orthophoto !== null) {
              if (usesBuiltinDop20) {
                attributionClauses.push(
                  `Aerial orthophoto reference: © GeoBasis-DE / German State Survey Offices (${exportYear}; DOP20/DOP10 under dl-de/by-2-0 https://www.govdata.de/dl-de/by-2-0, CC BY 4.0 https://creativecommons.org/licenses/by/4.0/, dl-de/zero-2-0 https://www.govdata.de/dl-de/zero-2-0; Daten verändert; upstream CC BY 4.0 no-DRM and dl-de/by-2-0 attribution terms remain concurrently binding alongside ODbL-1.0).`,
                );
              } else if (app.config.orthophoto.attribution.trim().length > 0) {
                attributionClauses.push(
                  `Aerial orthophoto reference: ${app.config.orthophoto.attribution.trim()}.`,
                );
              }
            }
            if (vg250Active) {
              attributionClauses.push(
                `Municipality codes/names derived from VG250: © BKG (${vg250Year}) dl-de/by-2-0 (https://www.govdata.de/dl-de/by-2-0), Datenquellen: ${BKG_VG250_DATENQUELLEN_URL} (Daten verändert; upstream dl-de/by-2-0 attribution remains concurrently binding alongside ODbL-1.0 — pass ?includeMunicipality=false to omit VG250 attributes).`,
              );
            }
            if (activeImportAttributions.length > 0) {
              const formattedImports = activeImportAttributions.map((item) => {
                const details = [
                  item.license,
                  ...(item.sourceUrl ? [item.sourceUrl] : []),
                  ...(item.waiverConfirmed ? ['ODbL-1.0 waiver confirmed'] : []),
                ].join('; ');
                return `${item.attributionText} (${details})`;
              });
              attributionClauses.push(
                `Imported open datasets: ${formattedImports.join(' | ')}.`,
              );
            }
            attributionClauses.push(
              `Full license and source notices: ${app.config.licensesUrl}.`,
            );
            const exportAttribution = attributionClauses.join(' ');
            const upstreamConditionsJsonField =
              upstreamConditionParts.length > 0
                ? `"upstreamConditions":${JSON.stringify(upstreamConditionParts.join(' '))},`
                : '';
            const collectionPrefix = `{"type":"FeatureCollection","license":"ODbL-1.0","licenseUrl":"https://opendatacommons.org/licenses/odbl/1-0/","contributorRights":"CC0-1.0","contributorRightsUrl":"https://creativecommons.org/publicdomain/zero/1.0/",${upstreamConditionsJsonField}"attribution":${JSON.stringify(
              exportAttribution,
            )},"features":[`;

            if (firstBatch.features.length === 0) {
              yield Buffer.from(`${collectionPrefix}]}`, 'utf8');
              return;
            }

            const firstSerialized = serializeFeatureBatch(
              firstBatch.features,
              isFirstFeature,
              includeMunicipality,
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
                includeMunicipality,
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

      const parsed = PolygonFeatureSchema.parse(created);
      app.webhookDispatcher.emit(
        'polygon.created',
        buildPublicPolygonWebhookData(parsed),
      );
      return reply.status(201).send(parsed);
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
          ? (request.query as {
              origin?: unknown;
              license?: unknown;
              attribution?: unknown;
              sourceAttribution?: unknown;
              sourceUrl?: unknown;
              waiverConfirmed?: unknown;
            })
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

      const rawQueryAttribution =
        typeof queryObj.sourceAttribution === 'string' &&
        queryObj.sourceAttribution.trim().length > 0
          ? queryObj.sourceAttribution.trim()
          : typeof queryObj.attribution === 'string' &&
              queryObj.attribution.trim().length > 0
            ? queryObj.attribution.trim()
            : null;
      if (rawQueryAttribution && rawQueryAttribution.length > 500) {
        throw new ApiError(
          422,
          'VALIDATION_ERROR',
          'Import attribution must not exceed 500 characters.',
        );
      }

      let sourceUrl: string | null = null;
      if (
        typeof queryObj.sourceUrl === 'string' &&
        queryObj.sourceUrl.trim().length > 0
      ) {
        const trimmedUrl = queryObj.sourceUrl.trim();
        if (
          trimmedUrl.length > 500 ||
          (!trimmedUrl.startsWith('https://') &&
            !trimmedUrl.startsWith('http://'))
        ) {
          throw new ApiError(
            422,
            'VALIDATION_ERROR',
            'Import sourceUrl must be a valid http(s) URL up to 500 characters.',
          );
        }
        sourceUrl = trimmedUrl;
      }

      const rawWaiver =
        typeof queryObj.waiverConfirmed === 'string'
          ? queryObj.waiverConfirmed.trim().toLowerCase()
          : queryObj.waiverConfirmed === true
            ? 'true'
            : '';
      const waiverConfirmed = rawWaiver === 'true' || rawWaiver === '1';

      if (queryObj.license !== undefined) {
        if (
          typeof queryObj.license !== 'string' ||
          queryObj.license.trim().length === 0
        ) {
          throw new ApiError(
            422,
            'VALIDATION_ERROR',
            'When specified, import license query parameter must be a non-empty ODbL-compatible license identifier.',
          );
        }
      }

      const dataset = await extractImportDataset(
        buffer,
        uploaded.filename || 'import.geojson',
        {
          waiverConfirmed,
          sourceAttribution: rawQueryAttribution,
        },
      );

      const effectiveAttribution =
        rawQueryAttribution ?? dataset.embeddedAttribution ?? null;

      let queryLicensePolicy: ResolvedImportLicensePolicy | null = null;
      if (typeof queryObj.license === 'string') {
        queryLicensePolicy = assertCompatibleImportLicenseParam(
          queryObj.license,
          {
            sourceAttribution: effectiveAttribution,
            waiverConfirmed,
          },
        );
      }

      let embeddedLicensePolicy: ResolvedImportLicensePolicy | null = null;
      if (dataset.embeddedLicense) {
        embeddedLicensePolicy = assertCompatibleImportLicenseParam(
          dataset.embeddedLicense,
          {
            sourceAttribution: effectiveAttribution,
            waiverConfirmed,
          },
        );
      }

      if (
        queryLicensePolicy &&
        embeddedLicensePolicy &&
        queryLicensePolicy.canonicalLicense !==
          embeddedLicensePolicy.canonicalLicense
      ) {
        throw new ApiError(
          422,
          'VALIDATION_ERROR',
          `Query license "${queryLicensePolicy.canonicalLicense}" conflicts with embedded dataset license "${embeddedLicensePolicy.canonicalLicense}".`,
        );
      }

      const resolvedLicensePolicy = queryLicensePolicy ?? embeddedLicensePolicy;
      if (!resolvedLicensePolicy) {
        throw new ApiError(
          422,
          'VALIDATION_ERROR',
          'Bulk import requires an explicit compatible "license" query parameter (CC0-1.0, dl-de/zero-2-0, PDDL-1.0, Public Domain, attributed ODbL-1.0, or waiver-confirmed CC-BY-4.0 / dl-de/by-2-0) when the uploaded file does not embed a recognized open license.',
        );
      }

      const importAttribution: ImportAttributionMetadata | null =
        effectiveAttribution !== null && effectiveAttribution.length > 0
          ? {
              license: resolvedLicensePolicy.canonicalLicense,
              attributionText: effectiveAttribution,
              sourceUrl,
              waiverConfirmed: resolvedLicensePolicy.requiresWaiver
                ? waiverConfirmed
                : false,
            }
          : null;

      const imported = await repository.importBatch({
        adminUserId: auth.user.id,
        dataset,
        origin: importOrigin,
        importAttribution,
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

      const parsed = PolygonFeatureSchema.parse(updated);
      app.webhookDispatcher.emit(
        'polygon.status_changed',
        buildPublicPolygonWebhookData(parsed),
      );
      return parsed;
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
      const deletedInfo = await repository.delete(
        id,
        auth.user.id,
        auth.user.role === 'admin',
      );
      if (deletedInfo.deletedByAdmin) {
        await notifyAuthorOfModerationActionBestEffort(app, request, {
          action: 'polygon_deleted',
          targetId: id,
          authorEmail: deletedInfo.authorEmail,
          authorPseudonym: deletedInfo.authorPseudonym,
          reason: extractOptionalModerationReason(request),
          automatedMeansUsed: false,
        });
      }
      app.webhookDispatcher.emit('polygon.deleted', {
        id,
        deletedByAdmin: deletedInfo.deletedByAdmin,
        deletedAt: new Date().toISOString(),
      });
      return reply.status(204).send();
    },
  );
}
