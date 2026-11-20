// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import type {
  BboxBounds,
  PolygonFeature,
  RuntimeConfig,
} from '@openunseal/shared';

import type {
  BasemapMode,
  CameraTarget,
  ColorScheme,
  InteractionMode,
  ViewportState,
} from '../state/appState';

export const VIEWPORT_SETTLE_DEBOUNCE_MS = 250;

/**
 * Normalizes any finite map bearing into [0, 360) degrees clockwise from true North.
 */
export function normalizeMapBearing(bearingDeg: number): number {
  if (!Number.isFinite(bearingDeg)) {
    return 0;
  }
  const wrapped = ((bearingDeg % 360) + 360) % 360;
  return wrapped === 360 || Object.is(wrapped, -0) ? 0 : wrapped;
}

/**
 * Converts a clockwise map bearing (degrees where 90 = East-up) into the CSS/RN
 * Z-rotation angle (degrees) that keeps the North arrow pointing toward true North.
 */
export function computeNorthArrowRotationDeg(bearingDeg: number): number {
  const normalized = normalizeMapBearing(bearingDeg);
  return normalized === 0 ? 0 : -normalized;
}

/**
 * Platform-neutral MapLibre canvas props contract shared by concrete platform
 * suffix adapters resolved via Metro and TypeScript `moduleSuffixes`:
 * - `./MapCanvas.native` (`@maplibre/maplibre-react-native` on Android and iOS)
 * - `./MapCanvas.web` (`maplibre-gl` + `maplibre-gl/dist/maplibre-gl.css` on Web)
 */
export interface MapCanvasProps {
  config: RuntimeConfig;
  colorScheme?: ColorScheme | undefined;
  mode: InteractionMode;
  basemapMode: BasemapMode;
  features: PolygonFeature[];
  draftVertices: [number, number][];
  isRingClosed: boolean;
  selectedFeatureId: string | null;
  polygonOpacity?: number;
  highlightMineOnly?: boolean;
  cameraTarget: CameraTarget | null;
  northResetSeq?: number;
  onViewportChange: (viewport: ViewportState) => void;
  onBearingChange?: (bearingDeg: number) => void;
  onMapTap: (point: [number, number]) => void;
  onFeaturePress: (featureIds: string[]) => void;
  onTileError: (reason: string) => void;
  onZoomDividerOffsetChange?: (bottomPx: number) => void;
}

export type {
  BboxBounds,
  BasemapMode,
  CameraTarget,
  ColorScheme,
  InteractionMode,
  ViewportState,
};
