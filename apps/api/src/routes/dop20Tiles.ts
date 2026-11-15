import sharp from 'sharp';
import { z } from 'zod';

import { ApiError } from '@entsiegelung/shared';

import type { FastifyInstance } from 'fastify';

const WEB_MERCATOR_ORIGIN_SHIFT = 20_037_508.342789244;
const TILE_SIZE_PX = 256;
const MIN_UPSTREAM_ZOOM = 11;
const MAX_TILE_ZOOM = 22;
const UPSTREAM_TIMEOUT_MS = 8_000;
const TILE_CACHE_MAX_ENTRIES = 256;
const TILE_CACHE_TTL_MS = 15 * 60 * 1000;

export const DEFAULT_DOP20_ATTRIBUTION =
  '© GeoBasis-DE / Vermessungsverwaltungen der Bundesländer (DOP20, dl-de/by-2-0)';

export const GERMANY_DOP20_BOUNDS: [number, number, number, number] = [
  5.86,
  47.27,
  15.05,
  55.06,
];

export interface StateDop20Provider {
  readonly code: string;
  readonly name: string;
  readonly boundsWgs84: readonly [number, number, number, number];
  readonly baseUrl: string;
  readonly layers: string;
}

/**
 * Official OpenData DOP20 / DOP10 RGB WMS 1.3.0 services of the 16 German Bundesländer
 * (Berlin and Brandenburg share the joint ISK GeoBasis-BB `bebb_dop20c` service).
 */
export const GERMAN_STATE_DOP20_PROVIDERS: readonly StateDop20Provider[] = [
  {
    code: 'RP',
    name: 'Rheinland-Pfalz',
    boundsWgs84: [6.11, 48.96, 8.51, 50.95],
    baseUrl: 'https://geo4.service24.rlp.de/wms/rp_dop20.fcgi',
    layers: 'rp_dop20',
  },
  {
    code: 'HE',
    name: 'Hessen',
    boundsWgs84: [7.77, 49.39, 10.24, 51.66],
    baseUrl:
      'https://www.gds-srv.hessen.de/cgi-bin/lika-services/ogc-free-images.ows',
    layers: 'he_dop_rgb',
  },
  {
    code: 'NW',
    name: 'Nordrhein-Westfalen',
    boundsWgs84: [5.86, 50.32, 9.47, 52.54],
    baseUrl: 'https://www.wms.nrw.de/geobasis/wms_nw_dop',
    layers: 'nw_dop_rgb',
  },
  {
    code: 'BW',
    name: 'Baden-Württemberg',
    boundsWgs84: [7.51, 47.53, 10.5, 49.8],
    baseUrl:
      'https://owsproxy.lgl-bw.de/owsproxy/ows/WMS_INSP_BW_Orthofoto_DOP20',
    layers: 'OI.OrthoimageCoverage',
  },
  {
    code: 'BY',
    name: 'Bayern',
    boundsWgs84: [8.97, 47.27, 13.84, 50.57],
    baseUrl: 'https://geoservices.bayern.de/od/wms/dop/v1/dop20',
    layers: 'by_dop20c',
  },
  {
    code: 'SL',
    name: 'Saarland',
    boundsWgs84: [6.34, 49.08, 7.44, 49.66],
    baseUrl: 'https://geoportal.saarland.de/freewms/dop2023',
    layers: 'sl_dop20_rgb',
  },
  {
    code: 'BE_BB',
    name: 'Berlin / Brandenburg',
    boundsWgs84: [11.26, 51.35, 14.77, 53.56],
    baseUrl: 'https://isk.geobasis-bb.de/mapproxy/dop20c/service/wms',
    layers: 'bebb_dop20c',
  },
  {
    code: 'HH',
    name: 'Hamburg',
    boundsWgs84: [8.42, 53.39, 10.33, 53.97],
    baseUrl: 'https://geodienste.hamburg.de/wms_dop_zeitreihe_unbelaubt',
    layers: 'dop_zeitreihe_unbelaubt',
  },
  {
    code: 'NI',
    name: 'Niedersachsen',
    boundsWgs84: [6.65, 51.29, 11.6, 53.9],
    baseUrl: 'https://opendata.lgln.niedersachsen.de/doorman/noauth/dop_wms',
    layers: 'ni_dop20',
  },
  {
    code: 'HB',
    name: 'Bremen / Bremerhaven',
    boundsWgs84: [8.48, 53.01, 8.99, 53.62],
    baseUrl: 'https://geodienste.bremen.de/wms_dop10_2023',
    layers: 'DOP10_2023_HB,DOP10_2023_BHV',
  },
  {
    code: 'SH',
    name: 'Schleswig-Holstein',
    boundsWgs84: [7.86, 53.35, 11.32, 55.06],
    baseUrl: 'https://dienste.gdi-sh.de/WMS_SH_DOP20col_OpenGBD',
    layers: 'sh_dop20_rgb',
  },
  {
    code: 'MV',
    name: 'Mecklenburg-Vorpommern',
    boundsWgs84: [10.59, 53.11, 14.42, 54.69],
    baseUrl: 'https://www.geodaten-mv.de/dienste/adv_dop',
    layers: 'mv_dop',
  },
  {
    code: 'SN',
    name: 'Sachsen',
    boundsWgs84: [11.87, 50.17, 15.05, 51.69],
    baseUrl: 'https://geodienste.sachsen.de/wms_geosn_dop-rgb/guest',
    layers: 'sn_dop_020',
  },
  {
    code: 'ST',
    name: 'Sachsen-Anhalt',
    boundsWgs84: [10.56, 50.93, 13.19, 53.05],
    baseUrl:
      'https://www.geodatenportal.sachsen-anhalt.de/wss/service/ST_LVermGeo_DOP_WMS_OpenData/guest',
    layers: 'lsa_lvermgeo_dop20_2',
  },
  {
    code: 'TH',
    name: 'Thüringen',
    boundsWgs84: [9.87, 50.2, 12.66, 51.65],
    baseUrl: 'https://www.geoproxy.geoportal-th.de/geoproxy/services/DOP',
    layers: 'th_dop',
  },
];

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

function boxesIntersect(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): boolean {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}

export function selectStateProvidersForBounds(
  wgs84Bounds: readonly [number, number, number, number],
): StateDop20Provider[] {
  return GERMAN_STATE_DOP20_PROVIDERS.filter((provider) =>
    boxesIntersect(wgs84Bounds, provider.boundsWgs84),
  );
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
