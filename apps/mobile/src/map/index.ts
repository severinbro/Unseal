// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Unseal Contributors

/**
 * Platform-neutral MapLibre map module barrel.
 *
 * Concrete platform suffix modules resolved via Metro and TypeScript `moduleSuffixes`:
 * - `./MapCanvas.native` (`@maplibre/maplibre-react-native` for Android and iOS)
 * - `./MapCanvas.web` (`maplibre-gl` + `maplibre-gl/dist/maplibre-gl.css` for Web)
 */
export { MapCanvas } from './MapCanvas';
export { VIEWPORT_SETTLE_DEBOUNCE_MS, type MapCanvasProps } from './types';
export {
  DARK_BASEMAP_PAINT_TUNING,
  DEFAULT_DARK_OSM_STYLE_URL,
  DRAFT_SOURCE_ID,
  INTERACTIVE_PROPOSAL_LAYER_IDS,
  ORTHOPHOTO_LAYER_ID,
  ORTHOPHOTO_SOURCE_ID,
  PROPOSALS_CENTROID_SOURCE_ID,
  PROPOSALS_POLYGON_SOURCE_ID,
  buildDraftGeoJson,
  buildDraftLayerSpecs,
  buildOrthophotoLayerSpec,
  buildOrthophotoSourceSpec,
  buildPolygonLayerSpecs,
  buildProposalGeoJson,
  dedupeFeatureIdsPreservingOrder,
  extractRenderedFeatureRawIds,
  isOpenFreeMapDarkStyleUrl,
  resolveBasemapStyleUrl,
  shouldReportOrthophotoTileError,
  tuneOpenFreeMapDarkStyleLayers,
  type DraftFeatureCollection,
  type DraftFillLayerSpec,
  type DraftGeoJsonFeature,
  type DraftLayerSpecsTuple,
  type DraftLineFeature,
  type DraftLineLayerSpec,
  type DraftPolygonFeature,
  type DraftVertexFeature,
  type DraftVerticesLayerSpec,
  type InteractiveProposalLayerId,
  type OrthophotoRasterLayerSpec,
  type OrthophotoRasterSourceSpec,
  type PolygonLayerSpecsTuple,
  type ProposalCentroidFeature,
  type ProposalCentroidLayerSpec,
  type ProposalFeatureProperties,
  type ProposalFillLayerSpec,
  type ProposalGeoJsonCollections,
  type ProposalOutlineLayerSpec,
  type ProposalPolygonFeature,
} from './styleBuilder';
