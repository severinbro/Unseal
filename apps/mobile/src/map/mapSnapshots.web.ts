// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import {
  Map as MapLibreMap,
  type GeoJSONSource,
  type LngLatBoundsLike,
} from 'maplibre-gl';
import { computeRingBbox } from '@openunseal/shared';

import {
  applyDarkBasemapTuning,
  buildWebCustomAttributions,
  isOpenFreeMapDarkStyleUrl,
  resolveBasemapStyleUrl,
} from './styleBuilder';
import type { MapPreviewProps } from './MapPreview.types';

/**
 * Still pictures of the basemap for the feed. One hidden map draws them one
 * after another: a live map per card would exhaust the browser's WebGL
 * contexts. The tiles come from the same provider as those of the main map.
 */
export interface MapSnapshot {
  src: string;
  /** Credit of the basemap as plain text; has to be shown with the picture. */
  credit: string;
}

export interface SnapshotRequest
  extends Pick<MapPreviewProps, 'geometry' | 'color' | 'dashed' | 'config' | 'colorScheme'> {
  width: number;
  height: number;
}

interface Job {
  request: SnapshotRequest;
  key: string;
  isWanted: () => boolean;
  resolve: (snapshot: MapSnapshot | null) => void;
}

const AREA_SOURCE_ID = 'preview-area';
const SNAPSHOT_TIMEOUT_MS = 10_000;
const RELEASE_AFTER_MS = 30_000;
const MAX_CACHED = 80;
/** Close enough to read street names, far enough to see where it is. */
const MAX_ZOOM = 16.8;

const cache = new Map<string, MapSnapshot>();
const queue: Job[] = [];
let running = false;
let map: MapLibreMap | null = null;
let container: HTMLDivElement | null = null;
let loadedStyleUrl: string | null = null;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;

function releaseMap(): void {
  map?.remove();
  container?.remove();
  map = null;
  container = null;
  loadedStyleUrl = null;
}

function snapshotKey(request: SnapshotRequest): string {
  return JSON.stringify([
    request.geometry.coordinates[0],
    request.color,
    request.dashed,
    resolveBasemapStyleUrl(request.config, request.colorScheme),
    request.width,
    request.height,
  ]);
}

export function getCachedSnapshot(request: SnapshotRequest): MapSnapshot | null {
  return cache.get(snapshotKey(request)) ?? null;
}

/** Resolves when the map has settled, or with false after the timeout. */
function settled(target: MapLibreMap): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (ok: boolean): void => {
      clearTimeout(timer);
      target.off('idle', onIdle);
      resolve(ok);
    };
    const onIdle = (): void => done(true);
    const timer = setTimeout(() => done(false), SNAPSHOT_TIMEOUT_MS);
    target.on('idle', onIdle);
    target.triggerRepaint();
  });
}

function readCredit(target: MapLibreMap, request: SnapshotRequest): string {
  const entries = new Set<string>();
  for (const id of Object.keys(target.getStyle().sources)) {
    const html = target.getSource(id)?.attribution;
    if (html) {
      entries.add(html);
    }
  }
  for (const html of buildWebCustomAttributions({
    config: { ...request.config, vg250AttributionEnabled: false },
    basemapMode: 'osm',
    colorScheme: request.colorScheme,
    activeStyleUrl: resolveBasemapStyleUrl(request.config, request.colorScheme),
    viewportBbox: null,
  })) {
    entries.add(html);
  }
  // Parsed without running anything; only the text is used.
  return [...entries]
    .map((html) =>
      (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((text) => text.length > 0)
    .join(' | ');
}

async function draw(request: SnapshotRequest): Promise<MapSnapshot | null> {
  const styleUrl = resolveBasemapStyleUrl(request.config, request.colorScheme);
  if (container === null) {
    container = document.createElement('div');
    container.setAttribute('aria-hidden', 'true');
    container.style.cssText =
      'position:fixed;left:-10000px;top:0;pointer-events:none;';
    document.body.appendChild(container);
  }
  container.style.width = `${request.width}px`;
  container.style.height = `${request.height}px`;

  const [minLng, minLat, maxLng, maxLat] = computeRingBbox(
    request.geometry.coordinates[0] ?? [],
  );
  const bounds: LngLatBoundsLike = [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
  const fit = { padding: 36, maxZoom: MAX_ZOOM, animate: false } as const;

  if (map === null) {
    map = new MapLibreMap({
      container,
      style: styleUrl,
      bounds,
      fitBoundsOptions: fit,
      interactive: false,
      attributionControl: false,
      preserveDrawingBuffer: true,
      fadeDuration: 0,
      pixelRatio: 2,
    });
    loadedStyleUrl = styleUrl;
  } else {
    map.resize();
    if (loadedStyleUrl !== styleUrl) {
      map.setStyle(styleUrl, { diff: false });
      loadedStyleUrl = styleUrl;
    }
    map.fitBounds(bounds, fit);
  }
  const target = map;
  if (!target.isStyleLoaded() && !(await settled(target))) {
    releaseMap();
    return null;
  }

  if (request.colorScheme === 'dark' && isOpenFreeMapDarkStyleUrl(styleUrl)) {
    applyDarkBasemapTuning(target);
  }
  const data = {
    type: 'Feature' as const,
    properties: {},
    geometry: request.geometry as GeoJSON.Polygon,
  };
  const source = target.getSource<GeoJSONSource>(AREA_SOURCE_ID);
  if (source) {
    source.setData(data);
  } else {
    target.addSource(AREA_SOURCE_ID, { type: 'geojson', data });
    target.addLayer({
      id: 'preview-area-fill',
      type: 'fill',
      source: AREA_SOURCE_ID,
      paint: { 'fill-opacity': 0.35 },
    });
    // A light edge sets the outline off from busy parts of the map.
    target.addLayer({
      id: 'preview-area-edge',
      type: 'line',
      source: AREA_SOURCE_ID,
      paint: { 'line-width': 7, 'line-color': '#ffffff', 'line-opacity': 0.85 },
    });
    target.addLayer({
      id: 'preview-area-line',
      type: 'line',
      source: AREA_SOURCE_ID,
      paint: { 'line-width': 3 },
    });
  }
  target.setPaintProperty('preview-area-fill', 'fill-color', request.color);
  target.setPaintProperty('preview-area-line', 'line-color', request.color);
  target.setPaintProperty(
    'preview-area-line',
    'line-dasharray',
    request.dashed ? [2, 1.2] : null,
  );
  if (!(await settled(target))) {
    return null;
  }
  return {
    src: target.getCanvas().toDataURL('image/jpeg', 0.88),
    credit: readCredit(target, request),
  };
}

async function work(): Promise<void> {
  if (running) {
    return;
  }
  running = true;
  if (releaseTimer !== null) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
  for (let job = queue.shift(); job !== undefined; job = queue.shift()) {
    if (!job.isWanted()) {
      job.resolve(null);
      continue;
    }
    let snapshot = cache.get(job.key) ?? null;
    if (snapshot === null) {
      try {
        snapshot = await draw(job.request);
      } catch {
        // No WebGL, or the style could not be loaded: the outline is shown.
        releaseMap();
      }
      if (snapshot !== null) {
        cache.set(job.key, snapshot);
        const oldest = cache.keys().next().value;
        if (cache.size > MAX_CACHED && oldest !== undefined) {
          cache.delete(oldest);
        }
      }
    }
    job.resolve(snapshot);
  }
  running = false;
  releaseTimer = setTimeout(releaseMap, RELEASE_AFTER_MS);
}

/** `isWanted` is asked right before drawing, so passed cards are skipped. */
export function requestSnapshot(
  request: SnapshotRequest,
  isWanted: () => boolean,
): Promise<MapSnapshot | null> {
  return new Promise((resolve) => {
    queue.push({ request, key: snapshotKey(request), isWanted, resolve });
    void work();
  });
}
