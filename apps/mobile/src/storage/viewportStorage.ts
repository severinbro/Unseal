// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import type { BboxBounds } from '@openunseal/shared';

export const LAST_VIEWPORT_KEY = 'entsiegelung.last_viewport';

export interface SavedViewport {
  readonly bbox: BboxBounds;
  readonly zoom: number;
}

export interface ViewportStorage {
  getViewport(): Promise<SavedViewport | null>;
  setViewport(viewport: SavedViewport): Promise<void>;
  clearViewport(): Promise<void>;
}

export function isValidSavedViewport(value: unknown): value is SavedViewport {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as {
    bbox?: unknown;
    zoom?: unknown;
  };
  if (
    typeof candidate.zoom !== 'number' ||
    !Number.isFinite(candidate.zoom) ||
    candidate.zoom < 0 ||
    candidate.zoom > 24
  ) {
    return false;
  }
  if (typeof candidate.bbox !== 'object' || candidate.bbox === null) {
    return false;
  }
  const bbox = candidate.bbox as Record<string, unknown>;
  const minLng = bbox['minLng'];
  const minLat = bbox['minLat'];
  const maxLng = bbox['maxLng'];
  const maxLat = bbox['maxLat'];
  if (
    typeof minLng !== 'number' ||
    typeof minLat !== 'number' ||
    typeof maxLng !== 'number' ||
    typeof maxLat !== 'number' ||
    !Number.isFinite(minLng) ||
    !Number.isFinite(minLat) ||
    !Number.isFinite(maxLng) ||
    !Number.isFinite(maxLat)
  ) {
    return false;
  }
  if (
    minLng < -180 ||
    maxLng > 180 ||
    minLat < -90 ||
    maxLat > 90 ||
    minLng >= maxLng ||
    minLat >= maxLat
  ) {
    return false;
  }
  return true;
}

export function serializeSavedViewport(viewport: SavedViewport): string | null {
  if (!isValidSavedViewport(viewport)) {
    return null;
  }
  return JSON.stringify({
    bbox: {
      minLng: Number(viewport.bbox.minLng.toFixed(6)),
      minLat: Number(viewport.bbox.minLat.toFixed(6)),
      maxLng: Number(viewport.bbox.maxLng.toFixed(6)),
      maxLat: Number(viewport.bbox.maxLat.toFixed(6)),
    },
    zoom: Number(viewport.zoom.toFixed(2)),
  });
}

export function parseSavedViewport(raw: string | null): SavedViewport | null {
  if (!raw || raw.trim().length === 0) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isValidSavedViewport(parsed)) {
      return null;
    }
    return {
      bbox: {
        minLng: parsed.bbox.minLng,
        minLat: parsed.bbox.minLat,
        maxLng: parsed.bbox.maxLng,
        maxLat: parsed.bbox.maxLat,
      },
      zoom: parsed.zoom,
    };
  } catch {
    return null;
  }
}

export function createMemoryViewportStorage(): ViewportStorage {
  let current: SavedViewport | null = null;
  return {
    async getViewport(): Promise<SavedViewport | null> {
      return current;
    },
    async setViewport(viewport: SavedViewport): Promise<void> {
      if (isValidSavedViewport(viewport)) {
        current = {
          bbox: { ...viewport.bbox },
          zoom: viewport.zoom,
        };
      }
    },
    async clearViewport(): Promise<void> {
      current = null;
    },
  };
}
