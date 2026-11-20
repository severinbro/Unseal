// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Unseal Contributors

import 'maplibre-gl/dist/maplibre-gl.css';

import {
  AttributionControl,
  Map as MapLibreMap,
  NavigationControl,
  type GeoJSONSource,
  type MapMouseEvent,
} from 'maplibre-gl';
import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  buildDraftGeoJson,
  buildDraftLayerSpecs,
  buildOrthophotoLayerSpec,
  buildOrthophotoSourceSpec,
  buildPolygonLayerSpecs,
  buildProposalGeoJson,
  buildWebCustomAttributions,
  DARK_BASEMAP_PAINT_TUNING,
  DEFAULT_POLYGON_OPACITY,
  dedupeFeatureIdsPreservingOrder,
  DRAFT_SOURCE_ID,
  extractRenderedFeatureRawIds,
  INTERACTIVE_PROPOSAL_LAYER_IDS,
  isBuiltinDop20Orthophoto,
  isOpenFreeMapDarkStyleUrl,
  ORTHOPHOTO_LAYER_ID,
  ORTHOPHOTO_SOURCE_ID,
  PROPOSALS_CENTROID_SOURCE_ID,
  PROPOSALS_POLYGON_SOURCE_ID,
  resolveBasemapStyleUrl,
  shouldReportOrthophotoTileError,
  tuneOpenFreeMapDarkStyleLayers,
} from './styleBuilder';
import {
  VIEWPORT_SETTLE_DEBOUNCE_MS,
  type BboxBounds,
  type MapCanvasProps,
} from './types';

const TAP_HITBOX_HALF_PX = 6;

function extractMapViewport(map: MapLibreMap): {
  bbox: BboxBounds;
  zoom: number;
} | null {
  const bounds = map.getBounds();
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const zoom = map.getZoom();

  if (
    !Number.isFinite(sw.lng) ||
    !Number.isFinite(sw.lat) ||
    !Number.isFinite(ne.lng) ||
    !Number.isFinite(ne.lat) ||
    !Number.isFinite(zoom)
  ) {
    return null;
  }

  const minLng = Math.max(-180, Math.min(sw.lng, ne.lng));
  const maxLng = Math.min(180, Math.max(sw.lng, ne.lng));
  const minLat = Math.max(-90, Math.min(sw.lat, ne.lat));
  const maxLat = Math.min(90, Math.max(sw.lat, ne.lat));

  if (minLng >= maxLng || minLat >= maxLat) {
    return null;
  }

  return {
    bbox: { minLng, minLat, maxLng, maxLat },
    zoom,
  };
}

function extractErrorMessage(event: unknown): string | undefined {
  if (typeof event !== 'object' || event === null) {
    return undefined;
  }
  const record = event as {
    error?: { message?: unknown; status?: unknown };
    message?: unknown;
  };
  if (typeof record.error?.message === 'string' && record.error.message.length > 0) {
    return record.error.message;
  }
  if (typeof record.error?.status === 'number') {
    return `HTTP ${record.error.status}`;
  }
  if (typeof record.message === 'string' && record.message.length > 0) {
    return record.message;
  }
  return undefined;
}

function applyDarkBasemapTuningToMap(map: MapLibreMap): void {
  for (const [layerId, paintProps] of Object.entries(DARK_BASEMAP_PAINT_TUNING)) {
    if (!map.getLayer(layerId)) {
      continue;
    }
    for (const [propName, propValue] of Object.entries(paintProps)) {
      try {
        map.setPaintProperty(layerId, propName, propValue);
      } catch {
        // Ignore non-matching third-party layer property types.
      }
    }
  }
}

export function MapCanvas({
  config,
  colorScheme = 'light',
  mode,
  basemapMode,
  features,
  draftVertices,
  isRingClosed,
  selectedFeatureId,
  polygonOpacity = DEFAULT_POLYGON_OPACITY,
  highlightMineOnly = false,
  cameraTarget,
  northResetSeq = 0,
  onViewportChange,
  onBearingChange,
  onMapTap,
  onFeaturePress,
  onTileError,
  onZoomDividerOffsetChange,
}: MapCanvasProps): React.JSX.Element {
  const activeStyleUrl = resolveBasemapStyleUrl(config, colorScheme);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const attributionControlRef = useRef<AttributionControl | null>(null);
  const navigationControlRef = useRef<NavigationControl | null>(null);
  const lastAttributionKeyRef = useRef<string>('');
  const lastViewportBboxRef = useRef<
    readonly [number, number, number, number] | null
  >(null);
  const styleReadyRef = useRef<boolean>(false);
  const appliedStyleUrlRef = useRef<string | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCameraSeqRef = useRef<number | null>(cameraTarget?.seq ?? null);
  const lastNorthResetSeqRef = useRef<number>(northResetSeq);

  const configRef = useRef(config);
  configRef.current = config;
  const colorSchemeRef = useRef(colorScheme);
  colorSchemeRef.current = colorScheme;
  const activeStyleUrlRef = useRef(activeStyleUrl);
  activeStyleUrlRef.current = activeStyleUrl;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const basemapModeRef = useRef(basemapMode);
  basemapModeRef.current = basemapMode;
  const featuresRef = useRef(features);
  featuresRef.current = features;
  const selectedFeatureIdRef = useRef(selectedFeatureId);
  selectedFeatureIdRef.current = selectedFeatureId;
  const polygonOpacityRef = useRef(polygonOpacity);
  polygonOpacityRef.current = polygonOpacity;
  const highlightMineOnlyRef = useRef(highlightMineOnly);
  highlightMineOnlyRef.current = highlightMineOnly;
  const draftVerticesRef = useRef(draftVertices);
  draftVerticesRef.current = draftVertices;
  const isRingClosedRef = useRef(isRingClosed);
  isRingClosedRef.current = isRingClosed;

  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;
  const onBearingChangeRef = useRef(onBearingChange);
  onBearingChangeRef.current = onBearingChange;
  const onMapTapRef = useRef(onMapTap);
  onMapTapRef.current = onMapTap;
  const onFeaturePressRef = useRef(onFeaturePress);
  onFeaturePressRef.current = onFeaturePress;
  const onTileErrorRef = useRef(onTileError);
  onTileErrorRef.current = onTileError;
  const onZoomDividerOffsetChangeRef = useRef(onZoomDividerOffsetChange);
  onZoomDividerOffsetChangeRef.current = onZoomDividerOffsetChange;

  const syncAttributionControl = (
    map: MapLibreMap,
    viewportBbox: readonly [number, number, number, number] | null,
  ): void => {
    const customAttribution = buildWebCustomAttributions({
      config: configRef.current,
      basemapMode: basemapModeRef.current,
      colorScheme: colorSchemeRef.current,
      activeStyleUrl: activeStyleUrlRef.current,
      viewportBbox,
    });
    const nextKey = customAttribution.join(' || ');
    if (
      attributionControlRef.current !== null &&
      nextKey === lastAttributionKeyRef.current
    ) {
      return;
    }
    lastAttributionKeyRef.current = nextKey;

    if (navigationControlRef.current !== null) {
      map.removeControl(navigationControlRef.current);
    }
    if (attributionControlRef.current !== null) {
      map.removeControl(attributionControlRef.current);
    }

    const nextAttr = new AttributionControl(
      customAttribution.length > 0
        ? { compact: false, customAttribution }
        : { compact: false },
    );
    const nextNav =
      navigationControlRef.current ??
      new NavigationControl({ showCompass: false });
    // Register AttributionControl first so it stays pinned at bottom-right
    // and NavigationControl stacks above it.
    map.addControl(nextAttr, 'bottom-right');
    map.addControl(nextNav, 'bottom-right');
    attributionControlRef.current = nextAttr;
    navigationControlRef.current = nextNav;
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const initialLng = cameraTarget?.lng ?? config.initialView.lng;
    const initialLat = cameraTarget?.lat ?? config.initialView.lat;
    const initialZoom = cameraTarget?.zoom ?? config.initialView.zoom;
    const initialBounds = cameraTarget?.bounds;
    const initialStyleUrl = activeStyleUrlRef.current;

    const map = new MapLibreMap({
      container,
      style: initialStyleUrl,
      ...(initialBounds
        ? {
            bounds: [
              [initialBounds.minLng, initialBounds.minLat],
              [initialBounds.maxLng, initialBounds.maxLat],
            ] as [[number, number], [number, number]],
          }
        : {
            center: [initialLng, initialLat],
            zoom: initialZoom,
          }),
      pitchWithRotate: false,
      touchPitch: false,
      dragRotate: true,
      preserveDrawingBuffer: true,
      attributionControl: false,
    });
    mapRef.current = map;
    appliedStyleUrlRef.current = initialStyleUrl;
    styleReadyRef.current = false;

    const initialBbox: readonly [number, number, number, number] = initialBounds
      ? [
          initialBounds.minLng,
          initialBounds.minLat,
          initialBounds.maxLng,
          initialBounds.maxLat,
        ]
      : [initialLng - 0.01, initialLat - 0.01, initialLng + 0.01, initialLat + 0.01];
    lastViewportBboxRef.current = initialBbox;
    syncAttributionControl(map, initialBbox);

    const emitZoomDividerOffset = (): void => {
      const cb = onZoomDividerOffsetChangeRef.current;
      if (!cb) {
        return;
      }
      const ctrlGroup = container.querySelector(
        '.maplibregl-ctrl-bottom-right .maplibregl-ctrl-group',
      );
      if (!ctrlGroup) {
        return;
      }
      const containerRect = container.getBoundingClientRect();
      const groupRect = ctrlGroup.getBoundingClientRect();
      if (containerRect.height <= 0 || groupRect.height <= 0) {
        return;
      }
      const offsetFromBottom =
        containerRect.bottom - (groupRect.top + groupRect.height / 2);
      if (Number.isFinite(offsetFromBottom) && offsetFromBottom > 0) {
        cb(Math.round(offsetFromBottom));
      }
    };

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            map.resize();
            emitZoomDividerOffset();
          })
        : null;
    resizeObserver?.observe(container);
    const bottomRightCtrl = container.querySelector(
      '.maplibregl-ctrl-bottom-right',
    );
    if (bottomRightCtrl) {
      resizeObserver?.observe(bottomRightCtrl);
    }
    const zoomGroupEl = container.querySelector(
      '.maplibregl-ctrl-bottom-right .maplibregl-ctrl-group',
    );
    if (zoomGroupEl) {
      resizeObserver?.observe(zoomGroupEl);
    }
    emitZoomDividerOffset();

    if (modeRef.current === 'drawing') {
      map.doubleClickZoom.disable();
      map.getCanvas().style.cursor = 'crosshair';
    }

    const syncSourcesAndLayers = (): void => {
      if (
        colorSchemeRef.current === 'dark' &&
        isOpenFreeMapDarkStyleUrl(activeStyleUrlRef.current)
      ) {
        applyDarkBasemapTuningToMap(map);
      }

      const proposalGeoJson = buildProposalGeoJson(
        featuresRef.current,
        selectedFeatureIdRef.current,
      );
      const draftGeoJson = buildDraftGeoJson(
        draftVerticesRef.current,
        isRingClosedRef.current,
      );

      if (!map.getSource(PROPOSALS_POLYGON_SOURCE_ID)) {
        map.addSource(PROPOSALS_POLYGON_SOURCE_ID, {
          type: 'geojson',
          data: proposalGeoJson.polygons,
        });
      } else {
        map
          .getSource<GeoJSONSource>(PROPOSALS_POLYGON_SOURCE_ID)
          ?.setData(proposalGeoJson.polygons);
      }

      if (!map.getSource(PROPOSALS_CENTROID_SOURCE_ID)) {
        map.addSource(PROPOSALS_CENTROID_SOURCE_ID, {
          type: 'geojson',
          data: proposalGeoJson.centroids,
        });
      } else {
        map
          .getSource<GeoJSONSource>(PROPOSALS_CENTROID_SOURCE_ID)
          ?.setData(proposalGeoJson.centroids);
      }

      if (!map.getSource(DRAFT_SOURCE_ID)) {
        map.addSource(DRAFT_SOURCE_ID, {
          type: 'geojson',
          data: draftGeoJson,
        });
      } else {
        map.getSource<GeoJSONSource>(DRAFT_SOURCE_ID)?.setData(draftGeoJson);
      }

      // 1. Proposal layers above basemap
      for (const proposalLayer of buildPolygonLayerSpecs(
        polygonOpacityRef.current,
        colorSchemeRef.current,
        highlightMineOnlyRef.current,
      )) {
        if (!map.getLayer(proposalLayer.id)) {
          map.addLayer(proposalLayer);
        }
      }

      // 2. Orthophoto raster source + layer inserted strictly beneath 'proposals-fill'
      const orthoSourceSpec = buildOrthophotoSourceSpec(
        configRef.current.orthophoto,
      );
      if (orthoSourceSpec !== null) {
        if (!map.getSource(ORTHOPHOTO_SOURCE_ID)) {
          // Built-in German DOP20 attributions are rendered dynamically per viewport
          // with clickable license links in AttributionControl to avoid stale "u. a." text.
          const webOrthoSpec = isBuiltinDop20Orthophoto(
            configRef.current.orthophoto,
          )
            ? { ...orthoSourceSpec, attribution: '' }
            : orthoSourceSpec;
          map.addSource(ORTHOPHOTO_SOURCE_ID, webOrthoSpec);
        }
        const isOrthoVisible = basemapModeRef.current === 'orthophoto';
        if (!map.getLayer(ORTHOPHOTO_LAYER_ID)) {
          const { beforeId, ...rasterLayer } =
            buildOrthophotoLayerSpec(isOrthoVisible);
          map.addLayer(
            rasterLayer,
            map.getLayer(beforeId) ? beforeId : undefined,
          );
        } else {
          map.setLayoutProperty(
            ORTHOPHOTO_LAYER_ID,
            'visibility',
            isOrthoVisible ? 'visible' : 'none',
          );
        }
      }

      // 3. Draft layers appended at top above proposals
      for (const draftLayer of buildDraftLayerSpecs(colorSchemeRef.current)) {
        if (!map.getLayer(draftLayer.id)) {
          map.addLayer(draftLayer);
        }
      }
    };

    const emitBearing = (): void => {
      onBearingChangeRef.current?.(map.getBearing());
    };

    const tryRestoreAfterStyleSwap = (): void => {
      if (styleReadyRef.current) {
        return;
      }
      try {
        if (!map.getStyle()) {
          return;
        }
        syncSourcesAndLayers();
        styleReadyRef.current = true;
      } catch {
        // Style JSON is still initializing; subsequent styledata/idle will retry.
      }
    };

    map.on('load', () => {
      styleReadyRef.current = true;
      syncSourcesAndLayers();
      emitBearing();
      const initialViewport = extractMapViewport(map);
      if (initialViewport !== null) {
        const bboxTuple: readonly [number, number, number, number] = [
          initialViewport.bbox.minLng,
          initialViewport.bbox.minLat,
          initialViewport.bbox.maxLng,
          initialViewport.bbox.maxLat,
        ];
        lastViewportBboxRef.current = bboxTuple;
        syncAttributionControl(map, bboxTuple);
        onViewportChangeRef.current(initialViewport);
      }
    });

    map.on('styledata', tryRestoreAfterStyleSwap);
    map.on('idle', tryRestoreAfterStyleSwap);

    map.on('rotate', emitBearing);
    map.on('rotateend', emitBearing);

    map.on('moveend', () => {
      if (settleTimerRef.current !== null) {
        clearTimeout(settleTimerRef.current);
      }
      settleTimerRef.current = setTimeout(() => {
        settleTimerRef.current = null;
        const settled = extractMapViewport(map);
        if (settled !== null) {
          const bboxTuple: readonly [number, number, number, number] = [
            settled.bbox.minLng,
            settled.bbox.minLat,
            settled.bbox.maxLng,
            settled.bbox.maxLat,
          ];
          lastViewportBboxRef.current = bboxTuple;
          syncAttributionControl(map, bboxTuple);
          onViewportChangeRef.current(settled);
        }
      }, VIEWPORT_SETTLE_DEBOUNCE_MS);
    });

    map.on('click', (event: MapMouseEvent) => {
      const tapPoint: [number, number] = [event.lngLat.lng, event.lngLat.lat];
      if (modeRef.current === 'drawing') {
        onMapTapRef.current(tapPoint);
        return;
      }

      const activeProposalLayers = INTERACTIVE_PROPOSAL_LAYER_IDS.filter((id) =>
        Boolean(map.getLayer(id)),
      );
      if (activeProposalLayers.length === 0) {
        onMapTapRef.current(tapPoint);
        return;
      }

      const hitFeatures = map.queryRenderedFeatures(
        [
          [event.point.x - TAP_HITBOX_HALF_PX, event.point.y - TAP_HITBOX_HALF_PX],
          [event.point.x + TAP_HITBOX_HALF_PX, event.point.y + TAP_HITBOX_HALF_PX],
        ],
        { layers: [...activeProposalLayers] },
      );

      const rawIds = extractRenderedFeatureRawIds(hitFeatures);
      const orderedIds = dedupeFeatureIdsPreservingOrder(
        rawIds,
        featuresRef.current,
      );
      if (orderedIds.length > 0) {
        onFeaturePressRef.current(orderedIds);
      } else {
        onMapTapRef.current(tapPoint);
      }
    });

    for (const layerId of INTERACTIVE_PROPOSAL_LAYER_IDS) {
      map.on('mouseenter', layerId, () => {
        if (modeRef.current === 'browse') {
          map.getCanvas().style.cursor = 'pointer';
        }
      });
      map.on('mouseleave', layerId, () => {
        if (modeRef.current === 'browse') {
          map.getCanvas().style.cursor = '';
        }
      });
    }

    map.on('error', (event: unknown) => {
      const rawSourceId =
        typeof event === 'object' && event !== null
          ? (event as { sourceId?: unknown }).sourceId
          : undefined;
      const reason = shouldReportOrthophotoTileError(
        {
          sourceId: typeof rawSourceId === 'string' ? rawSourceId : undefined,
          message: extractErrorMessage(event),
        },
        basemapModeRef.current,
      );
      if (reason !== null) {
        onTileErrorRef.current(reason);
      }
    });

    return () => {
      styleReadyRef.current = false;
      appliedStyleUrlRef.current = null;
      attributionControlRef.current = null;
      navigationControlRef.current = null;
      lastAttributionKeyRef.current = '';
      resizeObserver?.disconnect();
      if (settleTimerRef.current !== null) {
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
      map.remove();
      mapRef.current = null;
    };
    // MapLibre instance stays mounted across theme/style swaps so camera & bearing persist
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || appliedStyleUrlRef.current === activeStyleUrl) {
      return;
    }
    appliedStyleUrlRef.current = activeStyleUrl;
    styleReadyRef.current = false;
    map.setStyle(activeStyleUrl, {
      diff: false,
      transformStyle: (_previous, next) =>
        colorSchemeRef.current === 'dark' &&
        isOpenFreeMapDarkStyleUrl(activeStyleUrl)
          ? tuneOpenFreeMapDarkStyleLayers(next)
          : next,
    });
  }, [activeStyleUrl]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    if (mode === 'drawing') {
      map.doubleClickZoom.disable();
      map.getCanvas().style.cursor = 'crosshair';
    } else {
      map.doubleClickZoom.enable();
      map.getCanvas().style.cursor = '';
    }
  }, [mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) {
      return;
    }
    const proposalGeoJson = buildProposalGeoJson(features, selectedFeatureId);
    const polySource = map.getSource<GeoJSONSource>(PROPOSALS_POLYGON_SOURCE_ID);
    polySource?.setData(proposalGeoJson.polygons);
    const centroidSource = map.getSource<GeoJSONSource>(
      PROPOSALS_CENTROID_SOURCE_ID,
    );
    centroidSource?.setData(proposalGeoJson.centroids);
  }, [features, selectedFeatureId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) {
      return;
    }
    const [fillSpec, outlineSpec, centroidSpec] = buildPolygonLayerSpecs(
      polygonOpacity,
      colorScheme,
      highlightMineOnly,
    );
    if (map.getLayer(fillSpec.id)) {
      map.setPaintProperty(
        fillSpec.id,
        'fill-color',
        fillSpec.paint['fill-color'],
      );
      map.setPaintProperty(
        fillSpec.id,
        'fill-opacity',
        fillSpec.paint['fill-opacity'],
      );
    }
    if (map.getLayer(outlineSpec.id)) {
      map.setPaintProperty(
        outlineSpec.id,
        'line-color',
        outlineSpec.paint['line-color'],
      );
      map.setPaintProperty(
        outlineSpec.id,
        'line-width',
        outlineSpec.paint['line-width'],
      );
      map.setPaintProperty(
        outlineSpec.id,
        'line-opacity',
        outlineSpec.paint['line-opacity'],
      );
    }
    if (map.getLayer(centroidSpec.id)) {
      map.setPaintProperty(
        centroidSpec.id,
        'circle-color',
        centroidSpec.paint['circle-color'],
      );
      map.setPaintProperty(
        centroidSpec.id,
        'circle-radius',
        centroidSpec.paint['circle-radius'],
      );
      map.setPaintProperty(
        centroidSpec.id,
        'circle-opacity',
        centroidSpec.paint['circle-opacity'],
      );
      map.setPaintProperty(
        centroidSpec.id,
        'circle-stroke-color',
        centroidSpec.paint['circle-stroke-color'],
      );
      map.setPaintProperty(
        centroidSpec.id,
        'circle-stroke-width',
        centroidSpec.paint['circle-stroke-width'],
      );
      map.setPaintProperty(
        centroidSpec.id,
        'circle-stroke-opacity',
        centroidSpec.paint['circle-stroke-opacity'],
      );
    }

    const [draftFillSpec, draftLineSpec, draftVerticesSpec] =
      buildDraftLayerSpecs(colorScheme);
    if (map.getLayer(draftFillSpec.id)) {
      map.setPaintProperty(
        draftFillSpec.id,
        'fill-color',
        draftFillSpec.paint['fill-color'],
      );
      map.setPaintProperty(
        draftFillSpec.id,
        'fill-opacity',
        draftFillSpec.paint['fill-opacity'],
      );
    }
    if (map.getLayer(draftLineSpec.id)) {
      map.setPaintProperty(
        draftLineSpec.id,
        'line-color',
        draftLineSpec.paint['line-color'],
      );
    }
    if (map.getLayer(draftVerticesSpec.id)) {
      map.setPaintProperty(
        draftVerticesSpec.id,
        'circle-color',
        draftVerticesSpec.paint['circle-color'],
      );
      map.setPaintProperty(
        draftVerticesSpec.id,
        'circle-stroke-color',
        draftVerticesSpec.paint['circle-stroke-color'],
      );
    }
  }, [polygonOpacity, colorScheme, highlightMineOnly]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) {
      return;
    }
    const draftGeoJson = buildDraftGeoJson(draftVertices, isRingClosed);
    const draftSource = map.getSource<GeoJSONSource>(DRAFT_SOURCE_ID);
    draftSource?.setData(draftGeoJson);
  }, [draftVertices, isRingClosed]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) {
      return;
    }

    const orthoSourceSpec = buildOrthophotoSourceSpec(config.orthophoto);
    if (orthoSourceSpec === null) {
      if (map.getLayer(ORTHOPHOTO_LAYER_ID)) {
        map.removeLayer(ORTHOPHOTO_LAYER_ID);
      }
      if (map.getSource(ORTHOPHOTO_SOURCE_ID)) {
        map.removeSource(ORTHOPHOTO_SOURCE_ID);
      }
      return;
    }

    if (!map.getSource(ORTHOPHOTO_SOURCE_ID)) {
      const webOrthoSpec = isBuiltinDop20Orthophoto(config.orthophoto)
        ? { ...orthoSourceSpec, attribution: '' }
        : orthoSourceSpec;
      map.addSource(ORTHOPHOTO_SOURCE_ID, webOrthoSpec);
    }

    const isVisible = basemapMode === 'orthophoto';
    if (!map.getLayer(ORTHOPHOTO_LAYER_ID)) {
      const { beforeId, ...rasterLayer } = buildOrthophotoLayerSpec(isVisible);
      map.addLayer(rasterLayer, map.getLayer(beforeId) ? beforeId : undefined);
    } else {
      map.setLayoutProperty(
        ORTHOPHOTO_LAYER_ID,
        'visibility',
        isVisible ? 'visible' : 'none',
      );
    }
    syncAttributionControl(map, lastViewportBboxRef.current);
  }, [basemapMode, config.orthophoto]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    syncAttributionControl(map, lastViewportBboxRef.current);
  }, [basemapMode, colorScheme, activeStyleUrl, config]);

  useEffect(() => {
    const map = mapRef.current;
    if (
      !map ||
      cameraTarget === null ||
      cameraTarget.seq === lastCameraSeqRef.current
    ) {
      return;
    }
    lastCameraSeqRef.current = cameraTarget.seq;
    const b = cameraTarget.bounds;
    if (
      b &&
      (b.maxLng - b.minLng > 0.002 || b.maxLat - b.minLat > 0.002)
    ) {
      map.fitBounds(
        [
          [b.minLng, b.minLat],
          [b.maxLng, b.maxLat],
        ],
        { padding: 40, maxZoom: 18, duration: 350 },
      );
      return;
    }
    map.flyTo({
      center: [cameraTarget.lng, cameraTarget.lat],
      ...(cameraTarget.zoom !== undefined ? { zoom: cameraTarget.zoom } : {}),
      duration: 350,
    });
  }, [cameraTarget]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || northResetSeq === lastNorthResetSeqRef.current) {
      return;
    }
    lastNorthResetSeqRef.current = northResetSeq;
    map.resetNorth({ duration: 300 });
  }, [northResetSeq]);

  return (
    <View style={styles.container} testID="ppgis-map-canvas-web">
      <div ref={containerRef} style={WEB_DIV_STYLE} />
    </View>
  );
}

const WEB_DIV_STYLE: React.CSSProperties = {
  width: '100%',
  height: '100%',
  minHeight: 240,
  position: 'relative',
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 240,
  },
});
