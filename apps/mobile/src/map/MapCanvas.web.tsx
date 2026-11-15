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
  DEFAULT_POLYGON_OPACITY,
  dedupeFeatureIdsPreservingOrder,
  DRAFT_SOURCE_ID,
  extractRenderedFeatureRawIds,
  INTERACTIVE_PROPOSAL_LAYER_IDS,
  ORTHOPHOTO_LAYER_ID,
  ORTHOPHOTO_SOURCE_ID,
  PROPOSALS_CENTROID_SOURCE_ID,
  PROPOSALS_POLYGON_SOURCE_ID,
  shouldReportOrthophotoTileError,
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

export function MapCanvas({
  config,
  mode,
  basemapMode,
  features,
  draftVertices,
  isRingClosed,
  selectedFeatureId,
  polygonOpacity = DEFAULT_POLYGON_OPACITY,
  cameraTarget,
  northResetSeq = 0,
  onViewportChange,
  onBearingChange,
  onMapTap,
  onFeaturePress,
  onTileError,
}: MapCanvasProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const styleReadyRef = useRef<boolean>(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCameraSeqRef = useRef<number | null>(cameraTarget?.seq ?? null);
  const lastNorthResetSeqRef = useRef<number>(northResetSeq);

  const configRef = useRef(config);
  configRef.current = config;
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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const initialLng = cameraTarget?.lng ?? config.initialView.lng;
    const initialLat = cameraTarget?.lat ?? config.initialView.lat;
    const initialZoom = cameraTarget?.zoom ?? config.initialView.zoom;

    const map = new MapLibreMap({
      container,
      style: config.osmStyleUrl,
      center: [initialLng, initialLat],
      zoom: initialZoom,
      pitchWithRotate: false,
      touchPitch: false,
      dragRotate: true,
      preserveDrawingBuffer: true,
      attributionControl: false,
    });
    mapRef.current = map;
    styleReadyRef.current = false;

    // In MapLibre GL JS, 'bottom-*' positions insert each newly added control
    // before firstChild. Register AttributionControl first so it stays pinned
    // to the bottom-right corner and NavigationControl stacks above it.
    map.addControl(
      new AttributionControl({
        compact: false,
        customAttribution: 'VG250: © GeoBasis-DE / BKG (dl-de/by-2-0)',
      }),
      'bottom-right',
    );
    map.addControl(
      new NavigationControl({ showCompass: false }),
      'bottom-right',
    );

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            map.resize();
          })
        : null;
    resizeObserver?.observe(container);

    if (modeRef.current === 'drawing') {
      map.doubleClickZoom.disable();
      map.getCanvas().style.cursor = 'crosshair';
    }

    const syncSourcesAndLayers = (): void => {
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
      }
      if (!map.getSource(PROPOSALS_CENTROID_SOURCE_ID)) {
        map.addSource(PROPOSALS_CENTROID_SOURCE_ID, {
          type: 'geojson',
          data: proposalGeoJson.centroids,
        });
      }
      if (!map.getSource(DRAFT_SOURCE_ID)) {
        map.addSource(DRAFT_SOURCE_ID, {
          type: 'geojson',
          data: draftGeoJson,
        });
      }

      // 1. Proposal layers above basemap
      for (const proposalLayer of buildPolygonLayerSpecs(
        polygonOpacityRef.current,
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
          map.addSource(ORTHOPHOTO_SOURCE_ID, orthoSourceSpec);
        }
        if (!map.getLayer(ORTHOPHOTO_LAYER_ID)) {
          const { beforeId, ...rasterLayer } = buildOrthophotoLayerSpec(
            basemapModeRef.current === 'orthophoto',
          );
          map.addLayer(
            rasterLayer,
            map.getLayer(beforeId) ? beforeId : undefined,
          );
        }
      }

      // 3. Draft layers appended at top above proposals
      for (const draftLayer of buildDraftLayerSpecs()) {
        if (!map.getLayer(draftLayer.id)) {
          map.addLayer(draftLayer);
        }
      }
    };

    const emitBearing = (): void => {
      onBearingChangeRef.current?.(map.getBearing());
    };

    map.on('load', () => {
      styleReadyRef.current = true;
      syncSourcesAndLayers();
      emitBearing();
      const initialViewport = extractMapViewport(map);
      if (initialViewport !== null) {
        onViewportChangeRef.current(initialViewport);
      }
    });

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
      resizeObserver?.disconnect();
      if (settleTimerRef.current !== null) {
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
      map.remove();
      mapRef.current = null;
    };
    // Re-create MapLibre instance only if osmStyleUrl changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.osmStyleUrl]);

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
    const [fillSpec, outlineSpec, centroidSpec] =
      buildPolygonLayerSpecs(polygonOpacity);
    if (map.getLayer(fillSpec.id)) {
      map.setPaintProperty(
        fillSpec.id,
        'fill-opacity',
        fillSpec.paint['fill-opacity'],
      );
    }
    if (map.getLayer(outlineSpec.id)) {
      map.setPaintProperty(
        outlineSpec.id,
        'line-opacity',
        outlineSpec.paint['line-opacity'],
      );
    }
    if (map.getLayer(centroidSpec.id)) {
      map.setPaintProperty(
        centroidSpec.id,
        'circle-opacity',
        centroidSpec.paint['circle-opacity'],
      );
      map.setPaintProperty(
        centroidSpec.id,
        'circle-stroke-opacity',
        centroidSpec.paint['circle-stroke-opacity'],
      );
    }
  }, [polygonOpacity]);

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
      map.addSource(ORTHOPHOTO_SOURCE_ID, orthoSourceSpec);
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
  }, [basemapMode, config.orthophoto]);

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
