// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import type { PolygonFeature, RuntimeConfig } from '@openunseal/shared';
import type React from 'react';

import type { ColorScheme } from '../theme/tokens';

export interface MapPreviewProps {
  geometry: PolygonFeature['geometry'];
  /** Colour the area has on the map. */
  color: string;
  /** Private ground has a dashed outline, as on the map. */
  dashed: boolean;
  config: RuntimeConfig;
  colorScheme: ColorScheme;
  /** Shown until the picture is there, and where none can be drawn. */
  fallback: React.JSX.Element;
}

export const MAP_PREVIEW_HEIGHT = 190;
