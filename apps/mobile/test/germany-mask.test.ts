// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  validateStyleMin,
  type StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import { computeExteriorRingCentroid, computeRingBbox } from '@openunseal/shared';

import {
  buildGermanyBorderOutlineGeoJson,
  buildGermanyInvertedMaskGeoJson,
  GERMANY_BORDER_RINGS,
} from '../src/map/germanyBorder';
import {
  buildGermanyMaskLayerSpecs,
  buildPolygonLayerSpecs,
  GERMANY_BORDER_SOURCE_ID,
  GERMANY_MASK_SOURCE_ID,
  PROPOSALS_CENTROID_SOURCE_ID,
  PROPOSALS_POLYGON_SOURCE_ID,
} from '../src/map/styleBuilder';
import {
  clampViewportToGermany,
  isInsideGermanyBounds,
} from '../src/state/appState';

function insideRing(
  [x, y]: [number, number],
  ring: readonly (readonly [number, number])[],
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

const isCutOut = (point: [number, number]): boolean =>
  GERMANY_BORDER_RINGS.some((ring) => insideRing(point, ring));

describe('Germany cutaway', () => {
  it('cuts out German places and masks foreign ones', () => {
    const inside: Record<string, [number, number]> = {
      Berlin: [13.405, 52.52],
      Konstanz: [9.175, 47.663],
      Büsingen: [8.69, 47.698],
      Sylt: [8.31, 54.9],
      Helgoland: [7.886, 54.181],
    };
    const outside: Record<string, [number, number]> = {
      Paris: [2.35, 48.857],
      Zürich: [8.541, 47.377],
      Praha: [14.42, 50.087],
    };
    for (const [name, point] of Object.entries(inside)) {
      assert.equal(isCutOut(point), true, name);
    }
    for (const [name, point] of Object.entries(outside)) {
      assert.equal(isCutOut(point), false, name);
    }
  });

  it('ships a small file without Buffer and with valid winding', () => {
    const source = readFileSync(
      new URL('../src/map/germanyBorder.ts', import.meta.url),
      'utf8',
    );
    assert.ok(Buffer.byteLength(source) <= 25 * 1024);
    assert.doesNotMatch(source, /\bBuffer\b/);
    assert.match(source, /Public Domain/);

    const mask = buildGermanyInvertedMaskGeoJson();
    assert.equal(
      mask.geometry.coordinates.length,
      GERMANY_BORDER_RINGS.length + 1,
    );
    const signedArea = (ring: number[][]): number =>
      ring.slice(1).reduce((sum, p, i) => {
        const prev = ring[i]!;
        return sum + prev[0]! * p[1]! - p[0]! * prev[1]!;
      }, 0);
    assert.ok(signedArea(mask.geometry.coordinates[0]!) > 0);
    for (const hole of mask.geometry.coordinates.slice(1)) {
      assert.deepEqual(hole[0], hole[hole.length - 1]);
      assert.ok(signedArea(hole) < 0);
    }
    assert.equal(
      buildGermanyBorderOutlineGeoJson().geometry.coordinates.length,
      GERMANY_BORDER_RINGS.length,
    );
  });

  it('emits spec-valid mask and private outline layers', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const empty = { type: 'FeatureCollection' as const, features: [] };
      const style: StyleSpecification = {
        version: 8,
        sources: {
          [GERMANY_MASK_SOURCE_ID]: { type: 'geojson', data: empty },
          [GERMANY_BORDER_SOURCE_ID]: { type: 'geojson', data: empty },
          [PROPOSALS_POLYGON_SOURCE_ID]: { type: 'geojson', data: empty },
          [PROPOSALS_CENTROID_SOURCE_ID]: { type: 'geojson', data: empty },
        },
        layers: [
          ...buildGermanyMaskLayerSpecs(scheme),
          ...buildPolygonLayerSpecs(0.35, scheme),
        ],
      };
      assert.deepEqual(validateStyleMin(style), []);
      const opacity = buildGermanyMaskLayerSpecs(scheme)[0].paint['fill-opacity'];
      assert.deepEqual(opacity.slice(3), [11, 1, 13, 0]);
    }
  });

  it('clamps restored viewports and recognises foreign positions', () => {
    assert.equal(isInsideGermanyBounds(13.4, 52.5), true);
    assert.equal(isInsideGermanyBounds(2.35, 48.86), false);
    assert.equal(
      clampViewportToGermany({
        bbox: { minLng: 1, minLat: 48, maxLng: 3, maxLat: 49 },
        zoom: 9,
      }),
      null,
    );
    assert.deepEqual(
      clampViewportToGermany({
        bbox: { minLng: 1, minLat: 48, maxLng: 7, maxLat: 49 },
        zoom: 3,
      }),
      {
        bbox: { minLng: 4.8, minLat: 48, maxLng: 7, maxLat: 49 },
        zoom: 5.2,
      },
    );
  });

  it('computes ring bbox and centroid', () => {
    const ring: [number, number][] = [
      [0, 0],
      [2, 0],
      [2, 4],
      [0, 4],
      [0, 0],
    ];
    assert.deepEqual(computeRingBbox(ring), [0, 0, 2, 4]);
    assert.deepEqual(computeExteriorRingCentroid(ring), [1, 2]);
  });
});
