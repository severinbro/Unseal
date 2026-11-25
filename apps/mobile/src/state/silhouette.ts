// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import { computeRingBbox } from '@openunseal/shared';

export interface SilhouetteSegment {
  left: number;
  top: number;
  width: number;
  angleDeg: number;
}

/** Edges of the outline, scaled into the box; works without an SVG library. */
export function computeSilhouetteSegments(
  ring: readonly (readonly [number, number])[],
  width: number,
  height: number,
  padding = 6,
): SilhouetteSegment[] {
  if (ring.length < 3) {
    return [];
  }
  const [minLng, minLat, maxLng, maxLat] = computeRingBbox(ring);
  const lngScale = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const spanX = Math.max(1e-9, (maxLng - minLng) * lngScale);
  const spanY = Math.max(1e-9, maxLat - minLat);
  const scale = Math.min(
    (width - 2 * padding) / spanX,
    (height - 2 * padding) / spanY,
  );
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  const points = ring.map(([lng, lat]): [number, number] => [
    offsetX + (lng - minLng) * lngScale * scale,
    offsetY + (maxLat - lat) * scale,
  ]);
  const segments: SilhouetteSegment[] = [];
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[(i + 1) % points.length]!;
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (length < 0.5) {
      continue;
    }
    // Rotation is around the centre, so position by the midpoint.
    segments.push({
      left: (x1 + x2) / 2 - length / 2,
      top: (y1 + y2) / 2 - 1,
      width: length,
      angleDeg: (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI,
    });
  }
  return segments;
}
