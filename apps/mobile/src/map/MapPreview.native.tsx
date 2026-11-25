// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import type React from 'react';

import type { MapPreviewProps } from './MapPreview.types';

/** The native builds show the outline of the area only. */
export function MapPreview(props: MapPreviewProps): React.JSX.Element {
  return props.fallback;
}
