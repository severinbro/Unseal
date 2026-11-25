// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import { area } from '@turf/area';
import { polygon } from '@turf/helpers';
import { kinks } from '@turf/kinks';

import { GEOMETRY_LIMITS } from './constants.js';

const FLOAT_SPAN_TOLERANCE = 1e-9;
const NEAR_AREA_RATIO = 0.1;
const EARTH_RADIUS_M = 6_371_008.8;

export interface DraftValidationResult {
  valid: boolean;
  closedRing: [number, number][] | null;
  vertexCount: number;
  areaM2: number;
  compactnessPp?: number;
  nearAreaBound: boolean;
  crossingPoint: [number, number] | null;
  errors: string[];
}

export function computeRingPerimeterMeters(
  closedRing: readonly [number, number][],
): number {
  let total = 0;
  for (let i = 0; i < closedRing.length - 1; i++) {
    const [lng1, lat1] = closedRing[i]!;
    const [lng2, lat2] = closedRing[i + 1]!;
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const dPhi = phi2 - phi1;
    const dLambda = ((lng2 - lng1) * Math.PI) / 180;
    const sinHalfPhi = Math.sin(dPhi / 2);
    const sinHalfLambda = Math.sin(dLambda / 2);
    const a =
      sinHalfPhi * sinHalfPhi +
      Math.cos(phi1) * Math.cos(phi2) * sinHalfLambda * sinHalfLambda;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
    total += EARTH_RADIUS_M * c;
  }
  return total;
}

export function computePolsbyPopperCompactness(
  areaM2: number,
  perimeterM: number,
): number {
  if (!Number.isFinite(areaM2) || !Number.isFinite(perimeterM) || perimeterM <= 0 || areaM2 <= 0) {
    return 0;
  }
  return (4 * Math.PI * areaM2) / (perimeterM * perimeterM);
}

export interface RingStructureCheckResult {
  valid: boolean;
  errors: string[];
}

export function dedupeConsecutivePoints(
  vertices: readonly [number, number][],
  eps: number = GEOMETRY_LIMITS.DEDUPE_EPSILON_DEG,
): [number, number][] {
  const deduped: [number, number][] = [];
  for (const pt of vertices) {
    const prev = deduped[deduped.length - 1];
    if (!prev || Math.hypot(pt[0] - prev[0], pt[1] - prev[1]) > eps) {
      deduped.push([pt[0], pt[1]]);
    }
  }
  return deduped;
}

export function closeRingIfNeeded(vertices: readonly [number, number][]): [number, number][] {
  if (vertices.length === 0) {
    return [];
  }
  const ring: [number, number][] = vertices.map(([lng, lat]) => [lng, lat]);
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (ring.length < 2 || first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]]);
  }
  return ring;
}

export function checkPolygonRingStructure(
  coordinates: readonly (readonly (readonly number[])[])[],
): RingStructureCheckResult {
  const errors: string[] = [];

  if (!Array.isArray(coordinates) || coordinates.length !== 1) {
    errors.push(
      'Polygon geometry must contain exactly 1 exterior ring and 0 interior holes.',
    );
    return { valid: false, errors };
  }

  const ring = coordinates[0];
  if (
    !Array.isArray(ring) ||
    ring.length < GEOMETRY_LIMITS.MIN_RING_POSITIONS ||
    ring.length > GEOMETRY_LIMITS.MAX_RING_POSITIONS
  ) {
    errors.push(
      `Exterior ring must contain between ${GEOMETRY_LIMITS.MIN_RING_POSITIONS} and ${GEOMETRY_LIMITS.MAX_RING_POSITIONS} positions.`,
    );
    return { valid: false, errors };
  }

  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  for (let i = 0; i < ring.length; i++) {
    const pos = ring[i];
    if (!Array.isArray(pos) || pos.length !== 2) {
      errors.push('Every ring position must be a 2-element [lng, lat] coordinate pair.');
      return { valid: false, errors };
    }
    const lng = pos[0];
    const lat = pos[1];
    if (typeof lng !== 'number' || typeof lat !== 'number' || !Number.isFinite(lng) || !Number.isFinite(lat)) {
      errors.push('Ring coordinates must be finite numbers.');
      return { valid: false, errors };
    }
    if (Math.abs(lng) > 180) {
      errors.push('Longitude must be within [-180, 180] degrees.');
    }
    if (Math.abs(lat) > GEOMETRY_LIMITS.MAX_ABS_LAT) {
      errors.push(
        `Latitude must be within [-${GEOMETRY_LIMITS.MAX_ABS_LAT}, ${GEOMETRY_LIMITS.MAX_ABS_LAT}] degrees.`,
      );
    }
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) {
    errors.push('Exterior ring must be closed (first position must equal last position).');
  }

  if (
    maxLng - minLng > GEOMETRY_LIMITS.MAX_POLYGON_SPAN_DEG + FLOAT_SPAN_TOLERANCE ||
    maxLat - minLat > GEOMETRY_LIMITS.MAX_POLYGON_SPAN_DEG + FLOAT_SPAN_TOLERANCE
  ) {
    errors.push(
      `Polygon bounding-box span must not exceed ${GEOMETRY_LIMITS.MAX_POLYGON_SPAN_DEG}° in longitude or latitude.`,
    );
  }

  const uniqueErrors = Array.from(new Set(errors));
  return {
    valid: uniqueErrors.length === 0,
    errors: uniqueErrors,
  };
}

function hasTurnBackSpike(ringVertices: readonly [number, number][]): boolean {
  const n = ringVertices.length;
  for (let i = 0; i < n; i++) {
    const prev = ringVertices[(i - 1 + n) % n]!;
    const curr = ringVertices[i]!;
    const next = ringVertices[(i + 1) % n]!;

    const clampedLat = Math.min(Math.max(curr[1], -GEOMETRY_LIMITS.MAX_ABS_LAT), GEOMETRY_LIMITS.MAX_ABS_LAT);
    const cosLat = Math.cos((clampedLat * Math.PI) / 180);

    const ux = (prev[0] - curr[0]) * cosLat;
    const uy = prev[1] - curr[1];
    const vx = (next[0] - curr[0]) * cosLat;
    const vy = next[1] - curr[1];

    const cross = ux * vy - uy * vx;
    const dot = ux * vx + uy * vy;
    const angleDeg = (Math.atan2(Math.abs(cross), dot) * 180) / Math.PI;

    if (angleDeg < GEOMETRY_LIMITS.MIN_TURN_ANGLE_DEG) {
      return true;
    }
  }
  return false;
}

function findRepeatedVertex(
  ringVertices: readonly [number, number][],
  eps: number,
): [number, number] | null {
  for (let i = 0; i < ringVertices.length; i++) {
    const a = ringVertices[i]!;
    for (let j = i + 1; j < ringVertices.length; j++) {
      const b = ringVertices[j]!;
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= eps) {
        return [a[0], a[1]];
      }
    }
  }
  return null;
}

export function validateDraftPolygon(
  vertices: readonly [number, number][],
): DraftValidationResult {
  for (const pt of vertices) {
    if (!Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) {
      return {
        valid: false,
        closedRing: null,
        vertexCount: vertices.length,
        areaM2: 0,
        nearAreaBound: false,
        crossingPoint: null,
        errors: ['Coordinates must be finite numbers.'],
      };
    }
  }

  const deduped = dedupeConsecutivePoints(vertices, GEOMETRY_LIMITS.DEDUPE_EPSILON_DEG);
  const errors: string[] = [];

  let ringVertices = deduped;
  if (deduped.length >= 2) {
    const first = deduped[0]!;
    const last = deduped[deduped.length - 1]!;
    if (Math.hypot(last[0] - first[0], last[1] - first[1]) <= GEOMETRY_LIMITS.DEDUPE_EPSILON_DEG) {
      if (deduped.length === 3) {
        errors.push(
          `Polygon contains a fold-back spike with interior turn angle below ${GEOMETRY_LIMITS.MIN_TURN_ANGLE_DEG}°.`,
        );
      }
      ringVertices = deduped.slice(0, -1);
    }
  }

  const vertexCount = ringVertices.length;

  let hasOutOfRangeLng = false;
  let hasOutOfRangeLat = false;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  for (const [lng, lat] of ringVertices) {
    if (Math.abs(lng) > 180) {
      hasOutOfRangeLng = true;
    }
    if (Math.abs(lat) > GEOMETRY_LIMITS.MAX_ABS_LAT) {
      hasOutOfRangeLat = true;
    }
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  if (hasOutOfRangeLng) {
    errors.push('Longitude must be within [-180, 180] degrees.');
  }
  if (hasOutOfRangeLat) {
    errors.push(
      `Latitude must be within [-${GEOMETRY_LIMITS.MAX_ABS_LAT}, ${GEOMETRY_LIMITS.MAX_ABS_LAT}] degrees.`,
    );
  }

  if (vertexCount < GEOMETRY_LIMITS.MIN_VERTICES) {
    errors.unshift(`Polygon requires at least ${GEOMETRY_LIMITS.MIN_VERTICES} distinct vertices.`);
    return {
      valid: false,
      closedRing: null,
      vertexCount,
      areaM2: 0,
      nearAreaBound: false,
      crossingPoint: null,
      errors,
    };
  }

  if (vertexCount > GEOMETRY_LIMITS.MAX_VERTICES) {
    errors.push(`Polygon must have at most ${GEOMETRY_LIMITS.MAX_VERTICES} distinct vertices.`);
  }

  if (
    maxLng - minLng > GEOMETRY_LIMITS.MAX_POLYGON_SPAN_DEG + FLOAT_SPAN_TOLERANCE ||
    maxLat - minLat > GEOMETRY_LIMITS.MAX_POLYGON_SPAN_DEG + FLOAT_SPAN_TOLERANCE
  ) {
    errors.push(
      `Polygon span exceeds maximum of ${GEOMETRY_LIMITS.MAX_POLYGON_SPAN_DEG}° in longitude or latitude.`,
    );
  }

  if (hasTurnBackSpike(ringVertices)) {
    errors.push(
      `Polygon contains a fold-back spike with interior turn angle below ${GEOMETRY_LIMITS.MIN_TURN_ANGLE_DEG}°.`,
    );
  }

  const candidateClosedRing = closeRingIfNeeded(ringVertices);
  const turfPoly = polygon([candidateClosedRing]);

  let crossingPoint: [number, number] | null = null;
  const kinksResult = kinks(turfPoly);
  const firstKink = kinksResult.features[0];
  if (firstKink) {
    const coords = firstKink.geometry.coordinates;
    if (coords[0] !== undefined && coords[1] !== undefined) {
      crossingPoint = [coords[0], coords[1]];
    }
    errors.push('Polygon edges must not cross or self-intersect.');
  } else {
    const repeated = findRepeatedVertex(ringVertices, GEOMETRY_LIMITS.DEDUPE_EPSILON_DEG);
    if (repeated) {
      crossingPoint = repeated;
      errors.push('Polygon vertices must not touch or self-intersect.');
    }
  }

  const rawArea = area(turfPoly);
  const areaM2 = Number.isFinite(rawArea) ? rawArea : 0;
  const perimeterM = computeRingPerimeterMeters(candidateClosedRing);
  const compactnessPp = computePolsbyPopperCompactness(areaM2, perimeterM);

  if (areaM2 < GEOMETRY_LIMITS.MIN_AREA_M2) {
    errors.push(
      `Polygon area (${areaM2.toFixed(1)} m²) is below minimum of ${GEOMETRY_LIMITS.MIN_AREA_M2} m².`,
    );
  } else if (areaM2 > GEOMETRY_LIMITS.MAX_AREA_M2) {
    errors.push(
      `Polygon area (${areaM2.toFixed(1)} m²) exceeds maximum of ${GEOMETRY_LIMITS.MAX_AREA_M2.toLocaleString('en-US')} m².`,
    );
  } else if (compactnessPp < GEOMETRY_LIMITS.MIN_COMPACTNESS_PP) {
    errors.push(
      `Polygon shape is too thin or irregular (compactness ${compactnessPp.toFixed(3)} is below ${GEOMETRY_LIMITS.MIN_COMPACTNESS_PP}).`,
    );
  } else if (
    perimeterM > 0 &&
    (2 * areaM2) / perimeterM < GEOMETRY_LIMITS.MIN_WIDTH_BUFFER_M
  ) {
    errors.push(
      `Polygon is too narrow (minimum width must exceed ${(GEOMETRY_LIMITS.MIN_WIDTH_BUFFER_M * 2).toFixed(1)} m).`,
    );
  }

  const nearAreaBound =
    areaM2 > 0 &&
    (Math.abs(areaM2 - GEOMETRY_LIMITS.MIN_AREA_M2) / GEOMETRY_LIMITS.MIN_AREA_M2 <=
      NEAR_AREA_RATIO ||
      Math.abs(areaM2 - GEOMETRY_LIMITS.MAX_AREA_M2) / GEOMETRY_LIMITS.MAX_AREA_M2 <=
        NEAR_AREA_RATIO);

  const valid = errors.length === 0;
  return {
    valid,
    closedRing: valid ? candidateClosedRing : null,
    vertexCount,
    areaM2,
    compactnessPp,
    nearAreaBound,
    crossingPoint,
    errors,
  };
}

/** Area-weighted centroid of a (closed or open) exterior ring. */
export function computeExteriorRingCentroid(
  exteriorRing: readonly (readonly [number, number])[] | undefined,
): [number, number] {
  if (!exteriorRing || exteriorRing.length === 0) {
    return [0, 0];
  }

  const n = exteriorRing.length;
  const first = exteriorRing[0]!;
  const last = exteriorRing[n - 1]!;
  const uniqueCount =
    n > 1 && first[0] === last[0] && first[1] === last[1] ? n - 1 : n;

  if (uniqueCount === 0) {
    return [first[0], first[1]];
  }

  const [refLng, refLat] = first;
  let twiceArea = 0;
  let cxAcc = 0;
  let cyAcc = 0;

  for (let i = 0; i < uniqueCount; i++) {
    const [lng0, lat0] = exteriorRing[i]!;
    const [lng1, lat1] = exteriorRing[(i + 1) % uniqueCount]!;
    const x0 = lng0 - refLng;
    const y0 = lat0 - refLat;
    const x1 = lng1 - refLng;
    const y1 = lat1 - refLat;
    const cross = x0 * y1 - x1 * y0;
    twiceArea += cross;
    cxAcc += (x0 + x1) * cross;
    cyAcc += (y0 + y1) * cross;
  }

  const sixArea = 3 * twiceArea;
  if (Math.abs(sixArea) > 1e-18) {
    return [refLng + cxAcc / sixArea, refLat + cyAcc / sixArea];
  }

  let sumLng = 0;
  let sumLat = 0;
  for (let i = 0; i < uniqueCount; i++) {
    const [lng, lat] = exteriorRing[i]!;
    sumLng += lng;
    sumLat += lat;
  }
  return [sumLng / uniqueCount, sumLat / uniqueCount];
}

/** `[minLng, minLat, maxLng, maxLat]` of a non-empty ring. */
export function computeRingBbox(
  exteriorRing: readonly (readonly [number, number])[],
): [number, number, number, number] {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of exteriorRing) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }
  return [minLng, minLat, maxLng, maxLat];
}
