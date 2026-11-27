// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 OpenUnseal Contributors

import {
  CLUSTER_LIMITS,
  type PolygonClusterItem,
  type PolygonStatus,
} from '@openunseal/shared';

const EARTH_CIRCUMFERENCE_M = 40_075_016.68557849;
const TILE_SIZE_PX = 512;

export interface RawClusterCell {
  readonly count: number;
  readonly sumMercX: number;
  readonly sumMercY: number;
  readonly sumLng: number;
  readonly sumLat: number;
  readonly minLng: number;
  readonly minLat: number;
  readonly maxLng: number;
  readonly maxLat: number;
  readonly samplePolygonId: string | null;
  readonly sampleStatus: PolygonStatus | null;
  readonly sampleScore: number | null;
  readonly sampleIsAuthor: boolean;
}

export function resolveClusterMode(zoom: number): 'bubble' | 'dot' {
  if (!Number.isFinite(zoom)) {
    return 'bubble';
  }
  return zoom < CLUSTER_LIMITS.BUBBLE_MAX_ZOOM ? 'bubble' : 'dot';
}

export function resolveClusterZoomBucket(zoom: number): number {
  if (!Number.isFinite(zoom)) {
    return CLUSTER_LIMITS.MIN_ZOOM;
  }
  return Math.min(
    CLUSTER_LIMITS.MAX_ZOOM,
    Math.max(CLUSTER_LIMITS.MIN_ZOOM, Math.floor(zoom)),
  );
}

export function computeMercatorSpacingMeters(
  zoomBucket: number,
  spacingPx: number,
): number {
  const metersPerPx =
    EARTH_CIRCUMFERENCE_M / (TILE_SIZE_PX * 2 ** zoomBucket);
  return metersPerPx * spacingPx;
}

interface WorkingCluster {
  count: number;
  sumMercX: number;
  sumMercY: number;
  sumLng: number;
  sumLat: number;
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
  samplePolygonId: string | null;
  sampleStatus: PolygonStatus | null;
  sampleScore: number | null;
  sampleIsAuthor: boolean;
}

export function mergeClusterCells(
  cells: readonly RawClusterCell[],
  options: {
    mergeRadiusM: number;
    mode: 'bubble' | 'dot';
    maxClusters: number;
  },
): PolygonClusterItem[] {
  if (cells.length === 0 || options.maxClusters <= 0) {
    return [];
  }

  const sorted = [...cells].sort((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count;
    }
    if (a.minLng !== b.minLng) {
      return a.minLng - b.minLng;
    }
    return a.minLat - b.minLat;
  });

  const radiusSq = Math.max(0, options.mergeRadiusM) ** 2;
  const merged: WorkingCluster[] = [];

  for (const cell of sorted) {
    if (cell.count <= 0) {
      continue;
    }
    const cellX = cell.sumMercX / cell.count;
    const cellY = cell.sumMercY / cell.count;

    let bestIndex = -1;
    let bestDistSq = radiusSq;

    for (let i = 0; i < merged.length; i += 1) {
      const target = merged[i]!;
      const targetX = target.sumMercX / target.count;
      const targetY = target.sumMercY / target.count;
      const dx = cellX - targetX;
      const dy = cellY - targetY;
      const distSq = dx * dx + dy * dy;
      if (distSq <= bestDistSq) {
        bestDistSq = distSq;
        bestIndex = i;
      }
    }

    if (bestIndex >= 0) {
      const target = merged[bestIndex]!;
      target.count += cell.count;
      target.sumMercX += cell.sumMercX;
      target.sumMercY += cell.sumMercY;
      target.sumLng += cell.sumLng;
      target.sumLat += cell.sumLat;
      target.minLng = Math.min(target.minLng, cell.minLng);
      target.minLat = Math.min(target.minLat, cell.minLat);
      target.maxLng = Math.max(target.maxLng, cell.maxLng);
      target.maxLat = Math.max(target.maxLat, cell.maxLat);
      target.samplePolygonId = null;
      target.sampleStatus = null;
      target.sampleScore = null;
      target.sampleIsAuthor = false;
    } else {
      merged.push({
        count: cell.count,
        sumMercX: cell.sumMercX,
        sumMercY: cell.sumMercY,
        sumLng: cell.sumLng,
        sumLat: cell.sumLat,
        minLng: cell.minLng,
        minLat: cell.minLat,
        maxLng: cell.maxLng,
        maxLat: cell.maxLat,
        samplePolygonId: cell.count === 1 ? cell.samplePolygonId : null,
        sampleStatus: cell.count === 1 ? cell.sampleStatus : null,
        sampleScore: cell.count === 1 ? cell.sampleScore : null,
        sampleIsAuthor: cell.count === 1 ? cell.sampleIsAuthor : false,
      });
    }
  }

  const items: PolygonClusterItem[] = merged.map((cluster) => {
    const isSingle = cluster.count === 1;
    const isDot = options.mode === 'dot' && isSingle;
    const mercX = Math.round(cluster.sumMercX / cluster.count);
    const mercY = Math.round(cluster.sumMercY / cluster.count);
    const id =
      isSingle && cluster.samplePolygonId !== null
        ? cluster.samplePolygonId
        : `cluster-${mercX}-${mercY}`;

    return {
      id,
      kind: isDot ? 'dot' : 'bubble',
      count: cluster.count,
      lng: cluster.sumLng / cluster.count,
      lat: cluster.sumLat / cluster.count,
      bbox: [
        cluster.minLng,
        cluster.minLat,
        cluster.maxLng,
        cluster.maxLat,
      ],
      polygonId: isSingle ? cluster.samplePolygonId : null,
      status: isSingle ? cluster.sampleStatus : null,
      score: isSingle ? cluster.sampleScore : null,
      isAuthor: isSingle ? cluster.sampleIsAuthor : false,
    };
  });

  items.sort((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count;
    }
    return a.id.localeCompare(b.id);
  });

  return items.slice(0, options.maxClusters);
}
