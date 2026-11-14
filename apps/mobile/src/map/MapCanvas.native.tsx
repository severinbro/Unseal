import {
  Camera,
  CircleLayer,
  FillLayer,
  LineLayer,
  Logger,
  MapView,
  RasterLayer,
  RasterSource,
  ShapeSource,
  type CameraRef,
  type MapViewRef,
  type RegionPayload,
} from '@maplibre/maplibre-react-native';
import type { Feature as GeoJsonFeature, Point as GeoJsonPoint } from 'geojson';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
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

function computeOrthophotoUrlHint(urlTemplate: string | undefined): string | null {
  if (!urlTemplate) {
    return null;
  }
  const placeholderIdx = urlTemplate.indexOf('{');
  const prefix =
    placeholderIdx >= 0 ? urlTemplate.slice(0, placeholderIdx) : urlTemplate;
  const trimmed = prefix.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function visibleBoundsToBbox(
  visibleBounds: readonly [readonly number[], readonly number[]],
): BboxBounds | null {
  const ne = visibleBounds[0];
  const sw = visibleBounds[1];
  const neLng = ne[0];
  const neLat = ne[1];
  const swLng = sw[0];
  const swLat = sw[1];

  if (
    typeof neLng !== 'number' ||
    typeof neLat !== 'number' ||
    typeof swLng !== 'number' ||
    typeof swLat !== 'number' ||
    !Number.isFinite(neLng) ||
    !Number.isFinite(neLat) ||
    !Number.isFinite(swLng) ||
    !Number.isFinite(swLat)
  ) {
    return null;
  }

  const minLng = Math.max(-180, Math.min(swLng, neLng));
  const maxLng = Math.min(180, Math.max(swLng, neLng));
  const minLat = Math.max(-90, Math.min(swLat, neLat));
  const maxLat = Math.min(90, Math.max(swLat, neLat));

  if (minLng >= maxLng || minLat >= maxLat) {
    return null;
  }

  return { minLng, minLat, maxLng, maxLat };
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
  onViewportChange,
  onMapTap,
  onFeaturePress,
  onTileError,
}: MapCanvasProps): React.JSX.Element {
  const mapViewRef = useRef<MapViewRef | null>(null);
  const cameraRef = useRef<CameraRef | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCameraSeqRef = useRef<number | null>(cameraTarget?.seq ?? null);

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const basemapModeRef = useRef(basemapMode);
  basemapModeRef.current = basemapMode;
  const featuresRef = useRef(features);
  featuresRef.current = features;
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;
  const onMapTapRef = useRef(onMapTap);
  onMapTapRef.current = onMapTap;
  const onFeaturePressRef = useRef(onFeaturePress);
  onFeaturePressRef.current = onFeaturePress;
  const onTileErrorRef = useRef(onTileError);
  onTileErrorRef.current = onTileError;

  const orthophotoUrlHint = useMemo(
    () => computeOrthophotoUrlHint(config.orthophoto?.urlTemplate),
    [config.orthophoto?.urlTemplate],
  );
  const orthophotoUrlHintRef = useRef<string | null>(orthophotoUrlHint);
  orthophotoUrlHintRef.current = orthophotoUrlHint;

  const initialCenter = useMemo<[number, number]>(
    () => [
      cameraTarget?.lng ?? config.initialView.lng,
      cameraTarget?.lat ?? config.initialView.lat,
    ],
    // Fixed default camera stop on initial mount; subsequent targets run via cameraTarget.seq
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const initialZoom = useMemo<number>(
    () => cameraTarget?.zoom ?? config.initialView.zoom,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const proposalGeoJson = useMemo(
    () => buildProposalGeoJson(features, selectedFeatureId),
    [features, selectedFeatureId],
  );
  const draftGeoJson = useMemo(
    () => buildDraftGeoJson(draftVertices, isRingClosed),
    [draftVertices, isRingClosed],
  );
  const orthoSourceSpec = useMemo(
    () => buildOrthophotoSourceSpec(config.orthophoto),
    [config.orthophoto],
  );
  const orthoLayerSpec = useMemo(
    () => buildOrthophotoLayerSpec(basemapMode === 'orthophoto'),
    [basemapMode],
  );
  const [proposalFillSpec, proposalOutlineSpec, proposalCentroidSpec] = useMemo(
    () => buildPolygonLayerSpecs(polygonOpacity),
    [polygonOpacity],
  );
  const [draftFillSpec, draftLineSpec, draftVerticesSpec] = useMemo(
    () => buildDraftLayerSpecs(),
    [],
  );

  useEffect(() => {
    if (cameraTarget === null || cameraTarget.seq === lastCameraSeqRef.current) {
      return;
    }
    lastCameraSeqRef.current = cameraTarget.seq;
    cameraRef.current?.setCamera({
      centerCoordinate: [cameraTarget.lng, cameraTarget.lat],
      ...(cameraTarget.zoom !== undefined ? { zoomLevel: cameraTarget.zoom } : {}),
      animationDuration: 350,
      animationMode: 'easeTo',
    });
  }, [cameraTarget]);

  useEffect(() => {
    Logger.setLogCallback((log) => {
      if (log.level !== 'error' || log.message.includes('Canceled')) {
        return false;
      }

      const hint = orthophotoUrlHintRef.current;
      const matchesOrthophoto =
        log.message.includes(ORTHOPHOTO_SOURCE_ID) ||
        (hint !== null && log.message.includes(hint));

      const reason = shouldReportOrthophotoTileError(
        {
          sourceId: matchesOrthophoto ? ORTHOPHOTO_SOURCE_ID : 'basemap',
          message: log.message,
        },
        basemapModeRef.current,
      );
      if (reason !== null) {
        onTileErrorRef.current(reason);
        return true;
      }
      return false;
    });

    return () => {
      Logger.setLogCallback(() => false);
      if (settleTimerRef.current !== null) {
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
    };
  }, []);

  const scheduleViewportEmission = useCallback(
    (bbox: BboxBounds, zoom: number): void => {
      if (settleTimerRef.current !== null) {
        clearTimeout(settleTimerRef.current);
      }
      settleTimerRef.current = setTimeout(() => {
        settleTimerRef.current = null;
        onViewportChangeRef.current({ bbox, zoom });
      }, VIEWPORT_SETTLE_DEBOUNCE_MS);
    },
    [],
  );

  const handleDidFinishLoadingMap = useCallback((): void => {
    const view = mapViewRef.current;
    if (!view) {
      return;
    }
    void (async () => {
      try {
        const [bounds, zoom] = await Promise.all([
          view.getVisibleBounds(),
          view.getZoom(),
        ]);
        const bbox = visibleBoundsToBbox(bounds);
        if (bbox !== null && Number.isFinite(zoom)) {
          onViewportChangeRef.current({ bbox, zoom });
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.message.length === 0) {
          return;
        }
      }
    })();
  }, []);

  const handleRegionDidChange = useCallback(
    (regionFeature: GeoJsonFeature<GeoJsonPoint, RegionPayload>): void => {
      const payload = regionFeature.properties;
      if (!payload) {
        return;
      }
      const bbox = visibleBoundsToBbox(payload.visibleBounds);
      if (bbox !== null && Number.isFinite(payload.zoomLevel)) {
        scheduleViewportEmission(bbox, payload.zoomLevel);
      }
    },
    [scheduleViewportEmission],
  );

  const handleMapPress = useCallback((pressFeature: GeoJsonFeature): void => {
    if (pressFeature.geometry.type !== 'Point') {
      return;
    }
    const coords = pressFeature.geometry.coordinates;
    const lng = coords[0];
    const lat = coords[1];
    if (
      typeof lng !== 'number' ||
      typeof lat !== 'number' ||
      !Number.isFinite(lng) ||
      !Number.isFinite(lat)
    ) {
      return;
    }

    const tapPoint: [number, number] = [lng, lat];
    if (modeRef.current === 'drawing') {
      onMapTapRef.current(tapPoint);
      return;
    }

    const propsObj = pressFeature.properties as
      | Record<string, unknown>
      | null
      | undefined;
    const screenX = propsObj?.['screenPointX'];
    const screenY = propsObj?.['screenPointY'];
    const view = mapViewRef.current;

    if (
      typeof screenX !== 'number' ||
      typeof screenY !== 'number' ||
      !Number.isFinite(screenX) ||
      !Number.isFinite(screenY) ||
      !view
    ) {
      onMapTapRef.current(tapPoint);
      return;
    }

    void (async () => {
      try {
        const rendered = await view.queryRenderedFeaturesAtPoint(
          [screenX, screenY],
          undefined,
          [...INTERACTIVE_PROPOSAL_LAYER_IDS],
        );
        const rawIds = extractRenderedFeatureRawIds(rendered.features);
        const orderedIds = dedupeFeatureIdsPreservingOrder(
          rawIds,
          featuresRef.current,
        );
        if (orderedIds.length > 0) {
          onFeaturePressRef.current(orderedIds);
        } else {
          onMapTapRef.current(tapPoint);
        }
      } catch (queryErr: unknown) {
        if (queryErr instanceof Error) {
          onMapTapRef.current(tapPoint);
          return;
        }
        onMapTapRef.current(tapPoint);
      }
    })();
  }, []);

  return (
    <View style={styles.container} testID="ppgis-map-canvas-native">
      <MapView
        ref={mapViewRef}
        style={styles.map}
        mapStyle={config.osmStyleUrl}
        compassEnabled
        attributionEnabled
        logoEnabled={false}
        pitchEnabled={false}
        rotateEnabled={false}
        regionDidChangeDebounceTime={0}
        onDidFinishLoadingMap={handleDidFinishLoadingMap}
        onRegionDidChange={handleRegionDidChange}
        onPress={handleMapPress}
      >
        <Camera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate: initialCenter,
            zoomLevel: initialZoom,
          }}
        />

        <ShapeSource
          id={PROPOSALS_POLYGON_SOURCE_ID}
          shape={proposalGeoJson.polygons}
        >
          <FillLayer
            id={proposalFillSpec.id}
            style={{
              fillColor: proposalFillSpec.paint['fill-color'],
              fillOpacity: proposalFillSpec.paint['fill-opacity'],
            }}
          />
          <LineLayer
            id={proposalOutlineSpec.id}
            aboveLayerID={proposalFillSpec.id}
            style={{
              lineCap: proposalOutlineSpec.layout['line-cap'],
              lineJoin: proposalOutlineSpec.layout['line-join'],
              lineColor: proposalOutlineSpec.paint['line-color'],
              lineWidth: proposalOutlineSpec.paint['line-width'],
              lineOpacity: proposalOutlineSpec.paint['line-opacity'],
            }}
          />
        </ShapeSource>

        <ShapeSource
          id={PROPOSALS_CENTROID_SOURCE_ID}
          shape={proposalGeoJson.centroids}
        >
          <CircleLayer
            id={proposalCentroidSpec.id}
            aboveLayerID={proposalOutlineSpec.id}
            style={{
              circleColor: proposalCentroidSpec.paint['circle-color'],
              circleRadius: proposalCentroidSpec.paint['circle-radius'],
              circleOpacity: proposalCentroidSpec.paint['circle-opacity'],
              circleStrokeColor:
                proposalCentroidSpec.paint['circle-stroke-color'],
              circleStrokeWidth:
                proposalCentroidSpec.paint['circle-stroke-width'],
              circleStrokeOpacity:
                proposalCentroidSpec.paint['circle-stroke-opacity'],
            }}
          />
        </ShapeSource>

        {orthoSourceSpec !== null ? (
          <RasterSource
            id={ORTHOPHOTO_SOURCE_ID}
            tileUrlTemplates={orthoSourceSpec.tiles}
            tileSize={orthoSourceSpec.tileSize}
            maxZoomLevel={orthoSourceSpec.maxzoom}
            attribution={orthoSourceSpec.attribution}
          >
            <RasterLayer
              id={orthoLayerSpec.id}
              belowLayerID={orthoLayerSpec.beforeId}
              style={{
                visibility: orthoLayerSpec.layout.visibility,
                rasterOpacity: orthoLayerSpec.paint['raster-opacity'],
                rasterResampling: orthoLayerSpec.paint['raster-resampling'],
              }}
            />
          </RasterSource>
        ) : null}

        <ShapeSource id={DRAFT_SOURCE_ID} shape={draftGeoJson}>
          <FillLayer
            id={draftFillSpec.id}
            aboveLayerID={proposalCentroidSpec.id}
            filter={draftFillSpec.filter}
            style={{
              fillColor: draftFillSpec.paint['fill-color'],
              fillOpacity: draftFillSpec.paint['fill-opacity'],
            }}
          />
          <LineLayer
            id={draftLineSpec.id}
            aboveLayerID={draftFillSpec.id}
            filter={draftLineSpec.filter}
            style={{
              lineCap: draftLineSpec.layout['line-cap'],
              lineJoin: draftLineSpec.layout['line-join'],
              lineColor: draftLineSpec.paint['line-color'],
              lineWidth: draftLineSpec.paint['line-width'],
              lineDasharray: draftLineSpec.paint['line-dasharray'],
            }}
          />
          <CircleLayer
            id={draftVerticesSpec.id}
            aboveLayerID={draftLineSpec.id}
            filter={draftVerticesSpec.filter}
            style={{
              circleColor: draftVerticesSpec.paint['circle-color'],
              circleRadius: draftVerticesSpec.paint['circle-radius'],
              circleStrokeColor:
                draftVerticesSpec.paint['circle-stroke-color'],
              circleStrokeWidth:
                draftVerticesSpec.paint['circle-stroke-width'],
            }}
          />
        </ShapeSource>
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 240,
  },
  map: {
    flex: 1,
  },
});
