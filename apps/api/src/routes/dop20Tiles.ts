// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 OpenUnseal Contributors

import sharp from 'sharp';
import { z } from 'zod';

import {
  ApiError,
  GERMAN_STATE_DOP20_PROVIDERS,
  GERMANY_DOP20_BOUNDS as SHARED_GERMANY_DOP20_BOUNDS,
  formatDefaultDop20Attribution,
  selectDop20ProvidersForBounds,
  type Dop20LicenseId,
  type StateDop20Provider,
} from '@openunseal/shared';

import type { FastifyInstance } from 'fastify';

const WEB_MERCATOR_ORIGIN_SHIFT = 20_037_508.342789244;
const TILE_SIZE_PX = 256;
const MIN_UPSTREAM_ZOOM = 11;
const MAX_TILE_ZOOM = 22;
const UPSTREAM_TIMEOUT_MS = 8_000;
const TILE_CACHE_MAX_ENTRIES = 256;
const TILE_CACHE_TTL_MS = 15 * 60 * 1000;

export {
  GERMAN_STATE_DOP20_PROVIDERS,
  formatDefaultDop20Attribution,
  type Dop20LicenseId,
  type StateDop20Provider,
};

export function getDefaultDop20Attribution(
  year: number = new Date().getUTCFullYear(),
): string {
  return formatDefaultDop20Attribution(year);
}

/**
 * Convenience string for static defaults; prefer `getDefaultDop20Attribution()`
 * for dynamic year resolution across calendar rollovers.
 */
export const DEFAULT_DOP20_ATTRIBUTION = getDefaultDop20Attribution();

export const GERMANY_DOP20_BOUNDS: [number, number, number, number] = [
  SHARED_GERMANY_DOP20_BOUNDS[0],
  SHARED_GERMANY_DOP20_BOUNDS[1],
  SHARED_GERMANY_DOP20_BOUNDS[2],
  SHARED_GERMANY_DOP20_BOUNDS[3],
];

function buildDop20UserAgent(
  publicBaseUrl: string,
  contactEmail: string | null,
): string {
  const details = [publicBaseUrl, contactEmail].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  );
  return details.length > 0
    ? `OpenUnseal-PPGIS/0.2 (${details.join('; ')})`
    : 'OpenUnseal-PPGIS/0.2';
}

let cachedTransparentTilePng: Buffer | null = null;

async function getTransparentTilePng(): Promise<Buffer> {
  if (cachedTransparentTilePng) {
    return cachedTransparentTilePng;
  }
  cachedTransparentTilePng = await sharp({
    create: {
      width: TILE_SIZE_PX,
      height: TILE_SIZE_PX,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return cachedTransparentTilePng;
}

export interface SlippyTileBounds {
  wgs84: [number, number, number, number];
  epsg3857: [number, number, number, number];
}

export function slippyTileToBounds(
  z: number,
  x: number,
  y: number,
): SlippyTileBounds {
  const n = 2 ** z;
  const minLng = (x / n) * 360 - 180;
  const maxLng = ((x + 1) / n) * 360 - 180;

  const latRadMax = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const latRadMin = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n)));
  const minLat = (latRadMin * 180) / Math.PI;
  const maxLat = (latRadMax * 180) / Math.PI;

  const spanMeters = (2 * WEB_MERCATOR_ORIGIN_SHIFT) / n;
  const minX = -WEB_MERCATOR_ORIGIN_SHIFT + x * spanMeters;
  const maxX = minX + spanMeters;
  const maxY = WEB_MERCATOR_ORIGIN_SHIFT - y * spanMeters;
  const minY = maxY - spanMeters;

  return {
    wgs84: [minLng, minLat, maxLng, maxLat],
    epsg3857: [minX, minY, maxX, maxY],
  };
}

export function selectStateProvidersForBounds(
  wgs84Bounds: readonly [number, number, number, number],
): StateDop20Provider[] {
  return selectDop20ProvidersForBounds(wgs84Bounds);
}

export function buildStateWmsGetMapUrl(
  provider: StateDop20Provider,
  epsg3857Bounds: readonly [number, number, number, number],
): string {
  const separator = provider.baseUrl.includes('?') ? '&' : '?';
  const bboxParam = `${epsg3857Bounds[0].toFixed(3)},${epsg3857Bounds[1].toFixed(3)},${epsg3857Bounds[2].toFixed(3)},${epsg3857Bounds[3].toFixed(3)}`;
  return (
    `${provider.baseUrl}${separator}` +
    `SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap` +
    `&LAYERS=${encodeURIComponent(provider.layers)}` +
    `&STYLES=&CRS=EPSG:3857` +
    `&BBOX=${bboxParam}` +
    `&WIDTH=${TILE_SIZE_PX}&HEIGHT=${TILE_SIZE_PX}` +
    `&FORMAT=image%2Fpng&TRANSPARENT=TRUE`
  );
}

interface CachedTileEntry {
  buffer: Buffer;
  expiresAtMs: number;
}

class BoundedTileCache {
  private readonly entries = new Map<string, CachedTileEntry>();

  public get(key: string, nowMs: number): Buffer | null {
    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }
    if (nowMs >= entry.expiresAtMs) {
      this.entries.delete(key);
      return null;
    }
    // Refresh LRU order
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.buffer;
  }

  public set(key: string, buffer: Buffer, nowMs: number): void {
    if (this.entries.has(key)) {
      this.entries.delete(key);
    } else if (this.entries.size >= TILE_CACHE_MAX_ENTRIES) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      }
    }
    this.entries.set(key, {
      buffer,
      expiresAtMs: nowMs + TILE_CACHE_TTL_MS,
    });
  }
}

const TileParamsSchema = z.object({
  z: z.coerce.number().int().min(0).max(MAX_TILE_ZOOM),
  x: z.coerce.number().int().min(0),
  yFile: z.string().regex(/^\d+(?:\.(?:png|jpg|jpeg|webp))?$/i),
});

export interface Dop20TileRoutesOptions {
  fetchImpl?: typeof fetch;
}

export function registerDop20TileRoutes(
  app: FastifyInstance,
  options: Dop20TileRoutesOptions = {},
): void {
  const fetchFn = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const tileCache = new BoundedTileCache();
  const userAgent = buildDop20UserAgent(
    app.config.publicBaseUrl,
    app.config.operatorEmail ?? app.config.abuseContact,
  );

  app.get(
    '/api/v1/tiles/dop20/:z/:x/:yFile',
    {
      config: {
        compress: false,
        rateLimit: {
          max: 800,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const parsed = TileParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid tile coordinates.');
      }

      const { z, x, yFile } = parsed.data;
      const y = Number(yFile.split('.')[0]);
      const maxIndex = 2 ** z - 1;
      if (!Number.isInteger(y) || x > maxIndex || y < 0 || y > maxIndex) {
        throw new ApiError(
          400,
          'VALIDATION_ERROR',
          'Tile coordinates exceed zoom matrix bounds.',
        );
      }

      if (z < MIN_UPSTREAM_ZOOM) {
        const blank = await getTransparentTilePng();
        return reply
          .status(200)
          .header('Content-Type', 'image/png')
          .header('Cache-Control', 'public, max-age=86400')
          .send(blank);
      }

      const bounds = slippyTileToBounds(z, x, y);
      const providers = selectStateProvidersForBounds(bounds.wgs84);
      if (providers.length === 0) {
        const blank = await getTransparentTilePng();
        return reply
          .status(200)
          .header('Content-Type', 'image/png')
          .header('Cache-Control', 'public, max-age=86400')
          .send(blank);
      }

      const cacheKey = `${z}/${x}/${y}`;
      const nowMs = Date.now();
      const cached = tileCache.get(cacheKey, nowMs);
      if (cached) {
        return reply
          .status(200)
          .header('Content-Type', 'image/png')
          .header('Cache-Control', 'public, max-age=86400')
          .send(cached);
      }

      const settled = await Promise.allSettled(
        providers.map(async (provider) => {
          const url = buildStateWmsGetMapUrl(provider, bounds.epsg3857);
          const response = await fetchFn(url, {
            signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
            headers: {
              Accept: 'image/png,image/*;q=0.9',
              'User-Agent': userAgent,
            },
          });
          if (!response.ok) {
            throw new Error(
              `DOP20 upstream ${provider.code} returned HTTP ${response.status}`,
            );
          }
          const contentType = (
            response.headers.get('content-type') ?? ''
          ).toLowerCase();
          if (!contentType.startsWith('image/')) {
            throw new Error(
              `DOP20 upstream ${provider.code} returned non-image ${contentType}`,
            );
          }
          const arrayBuf = await response.arrayBuffer();
          if (arrayBuf.byteLength === 0) {
            throw new Error(`DOP20 upstream ${provider.code} returned empty body`);
          }
          return Buffer.from(arrayBuf);
        }),
      );

      const validBuffers: Buffer[] = [];
      for (const item of settled) {
        if (item.status === 'fulfilled') {
          validBuffers.push(item.value);
        }
      }

      if (validBuffers.length === 0) {
        throw new ApiError(
          502,
          'SERVICE_UNAVAILABLE',
          'Upstream DOP20 orthophoto WMS temporarily unavailable.',
        );
      }

      let outputPng: Buffer;
      if (validBuffers.length === 1) {
        outputPng = validBuffers[0]!;
      } else {
        outputPng = await sharp(validBuffers[0]!)
          .ensureAlpha()
          .composite(
            validBuffers.slice(1).map((buf) => ({
              input: buf,
              blend: 'over' as const,
            })),
          )
          .png()
          .toBuffer();
      }

      tileCache.set(cacheKey, outputPng, Date.now());

      return reply
        .status(200)
        .header('Content-Type', 'image/png')
        .header('Cache-Control', 'public, max-age=86400')
        .send(outputPng);
    },
  );
}
