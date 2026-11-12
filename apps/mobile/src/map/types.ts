import type {
  BboxBounds,
  PolygonFeature,
  RuntimeConfig,
} from '@entsiegelung/shared';

import type {
  BasemapMode,
  CameraTarget,
  InteractionMode,
  ViewportState,
} from '../state/appState';

export const VIEWPORT_SETTLE_DEBOUNCE_MS = 250;

/**
 * Platform-neutral MapLibre canvas props contract shared by concrete platform
 * suffix adapters resolved via Metro and TypeScript `moduleSuffixes`:
 * - `./MapCanvas.native` (`@maplibre/maplibre-react-native` on Android and iOS)
 * - `./MapCanvas.web` (`maplibre-gl` + `maplibre-gl/dist/maplibre-gl.css` on Web)
 */
export interface MapCanvasProps {
  config: RuntimeConfig;
  mode: InteractionMode;
  basemapMode: BasemapMode;
  features: PolygonFeature[];
  draftVertices: [number, number][];
  isRingClosed: boolean;
  selectedFeatureId: string | null;
  cameraTarget: CameraTarget | null;
  onViewportChange: (viewport: ViewportState) => void;
  onMapTap: (point: [number, number]) => void;
  onFeaturePress: (featureIds: string[]) => void;
  onTileError: (reason: string) => void;
}

export type { BboxBounds, BasemapMode, CameraTarget, InteractionMode, ViewportState };
