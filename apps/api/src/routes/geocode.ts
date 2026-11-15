import {
  ApiError,
  GeocodeQuerySchema,
  GeocodeResponseSchema,
  type GeocodeResponse,
  type GeocodeResultItem,
} from '@entsiegelung/shared';

import { normalizeRateLimitIp } from '../util/rateLimit.js';

import type { FastifyInstance } from 'fastify';

const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_USER_AGENT =
  'Unseal-PPGIS/0.1 (https://app.open-unseal.de; info@open-unseal.de)';
const UPSTREAM_TIMEOUT_MS = 8_000;
const GEOCODE_CACHE_MAX_ENTRIES = 500;
const GEOCODE_CACHE_TTL_MS = 10 * 60 * 1000;

export interface GeocodeRoutesOptions {
  fetchImpl?: typeof fetch;
}

interface NominatimRawItem {
  place_id?: unknown;
  display_name?: unknown;
  lat?: unknown;
  lon?: unknown;
  boundingbox?: unknown;
}

interface CacheEntry {
  expiresAt: number;
  response: GeocodeResponse;
}

function parseNominatimBoundingBox(
  raw: unknown,
): [number, number, number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 4) {
    return null;
  }
  const southLat = Number(raw[0]);
  const northLat = Number(raw[1]);
  const westLng = Number(raw[2]);
  const eastLng = Number(raw[3]);
  if (
    !Number.isFinite(southLat) ||
    !Number.isFinite(northLat) ||
    !Number.isFinite(westLng) ||
    !Number.isFinite(eastLng)
  ) {
    return null;
  }
  if (
    westLng < -180 ||
    eastLng > 180 ||
    southLat < -90 ||
    northLat > 90 ||
    westLng >= eastLng ||
    southLat >= northLat
  ) {
    return null;
  }
  return [westLng, southLat, eastLng, northLat];
}

function normalizeNominatimItem(raw: unknown): GeocodeResultItem | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const item = raw as NominatimRawItem;
  const displayName =
    typeof item.display_name === 'string' ? item.display_name.trim() : '';
  if (displayName.length === 0) {
    return null;
  }
  const lat = Number(item.lat);
  const lng = Number(item.lon);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    return null;
  }
  const placeId =
    item.place_id !== undefined && item.place_id !== null
      ? String(item.place_id)
      : `${lat.toFixed(6)},${lng.toFixed(6)}`;

  return {
    placeId,
    displayName,
    lat,
    lng,
    boundingBox: parseNominatimBoundingBox(item.boundingbox),
  };
}

export function registerGeocodeRoutes(
  app: FastifyInstance,
  options: GeocodeRoutesOptions = {},
): void {
  const fetchImpl = options.fetchImpl ?? fetch;
  const cache = new Map<string, CacheEntry>();

  const geocodeRateLimit = app.rateLimitOverrides.geocode ?? {
    max: 30,
    timeWindow: '1 minute',
  };

  app.get(
    '/api/v1/geocode',
    {
      config: {
        rateLimit: {
          max: geocodeRateLimit.max,
          timeWindow: geocodeRateLimit.timeWindow,
          keyGenerator: (request) => normalizeRateLimitIp(request.ip),
        },
      },
    },
    async (request, reply) => {
      const parsed = GeocodeQuerySchema.parse(request.query);
      const cacheKey = `${parsed.lang}:${parsed.q.toLowerCase()}`;
      const now = Date.now();
      const cached = cache.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        return reply.status(200).send(cached.response);
      }
      if (cached) {
        cache.delete(cacheKey);
      }

      const url = new URL(NOMINATIM_SEARCH_URL);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('limit', '5');
      url.searchParams.set('addressdetails', '1');
      url.searchParams.set('q', parsed.q);

      const controller = new AbortController();
      const timeoutHandle = setTimeout(
        () => controller.abort(),
        UPSTREAM_TIMEOUT_MS,
      );

      let upstreamRes: Response;
      try {
        upstreamRes = await fetchImpl(url.toString(), {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'Accept-Language':
              parsed.lang === 'en' ? 'en,de;q=0.8' : 'de,en;q=0.8',
            'User-Agent': NOMINATIM_USER_AGENT,
          },
          signal: controller.signal,
        });
      } catch (err: unknown) {
        request.log.warn({ err, query: parsed.q }, 'Nominatim request failed');
        throw new ApiError(
          503,
          'SERVICE_UNAVAILABLE',
          'Address search service is temporarily unavailable.',
        );
      } finally {
        clearTimeout(timeoutHandle);
      }

      if (!upstreamRes.ok) {
        request.log.warn(
          { status: upstreamRes.status, query: parsed.q },
          'Nominatim returned non-OK status',
        );
        throw new ApiError(
          503,
          'SERVICE_UNAVAILABLE',
          'Address search service is temporarily unavailable.',
        );
      }

      let rawJson: unknown;
      try {
        rawJson = await upstreamRes.json();
      } catch {
        throw new ApiError(
          503,
          'SERVICE_UNAVAILABLE',
          'Address search service returned an invalid response.',
        );
      }

      const rawList = Array.isArray(rawJson) ? rawJson : [];
      const results: GeocodeResultItem[] = [];
      for (const entry of rawList) {
        const normalized = normalizeNominatimItem(entry);
        if (normalized) {
          results.push(normalized);
        }
      }

      const validated = GeocodeResponseSchema.parse({ results });
      if (cache.size >= GEOCODE_CACHE_MAX_ENTRIES) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey !== undefined) {
          cache.delete(oldestKey);
        }
      }
      cache.set(cacheKey, {
        expiresAt: now + GEOCODE_CACHE_TTL_MS,
        response: validated,
      });

      return reply.status(200).send(validated);
    },
  );
}
