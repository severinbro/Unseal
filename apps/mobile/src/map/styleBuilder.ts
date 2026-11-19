// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Unseal Contributors

import {
  closeRingIfNeeded,
  dedupeConsecutivePoints,
  type PolygonFeature,
  type PolygonStatus,
  type RuntimeConfig,
  type SurfaceType,
} from '@entsiegelung/shared';
import type {
  Feature,
  FeatureCollection,
  LineString,
  Point,
  Polygon,
} from 'geojson';

import type { ColorScheme } from '../theme/tokens';

export const DEFAULT_DARK_OSM_STYLE_URL =
  'https://tiles.openfreemap.org/styles/dark';

export function resolveBasemapStyleUrl(
  config: Pick<RuntimeConfig, 'osmStyleUrl' | 'osmDarkStyleUrl'>,
  colorScheme: ColorScheme = 'light',
): string {
  if (colorScheme !== 'dark') {
    return config.osmStyleUrl;
  }
  if (config.osmDarkStyleUrl && config.osmDarkStyleUrl.trim().length > 0) {
    return config.osmDarkStyleUrl.trim();
  }
  try {
    if (new URL(config.osmStyleUrl).host === 'tiles.openfreemap.org') {
      return DEFAULT_DARK_OSM_STYLE_URL;
    }
  } catch {
    // Fall back to osmStyleUrl when non-URL or custom relative path.
  }
  return config.osmStyleUrl;
}

export function isOpenFreeMapDarkStyleUrl(styleUrl: string): boolean {
  try {
    const parsed = new URL(styleUrl);
    return (
      parsed.host === 'tiles.openfreemap.org' &&
      parsed.pathname.replace(/\/+$/, '') === '/styles/dark'
    );
  } catch {
    return false;
  }
}

export const DARK_BASEMAP_PAINT_TUNING: Readonly<
  Record<string, Readonly<Record<string, unknown>>>
> = {
  background: { 'background-color': '#101614' },
  water: { 'fill-color': '#0d212e' },
  waterway: { 'line-color': '#0f2838' },
  landuse_park: { 'fill-color': '#13221a' },
  landcover_wood: { 'fill-color': '#13221a' },
  building: {
    'fill-color': '#1b2520',
    'fill-outline-color': '#2d3d36',
  },
  highway_path: { 'line-color': '#2e3d36' },
  highway_minor: { 'line-color': '#26332d' },
  highway_major_casing: { 'line-color': '#3a4b44' },
  highway_major_inner: { 'line-color': '#202b26' },
  highway_motorway_casing: { 'line-color': '#475a51' },
  highway_motorway_inner: { 'line-color': '#1b2420' },
  highway_name_other: {
    'text-color': '#a0b4aa',
    'text-halo-color': '#0f1613',
    'text-halo-width': 1.5,
  },
  highway_name_motorway: { 'text-color': '#b8c9c0' },
  place_other: {
    'text-color': '#bdd0c6',
    'text-halo-color': 'rgba(12, 18, 15, 0.88)',
  },
  place_suburb: {
    'text-color': '#bdd0c6',
    'text-halo-color': 'rgba(12, 18, 15, 0.88)',
  },
  place_village: {
    'text-color': '#bdd0c6',
    'text-halo-color': 'rgba(12, 18, 15, 0.88)',
  },
  place_town: {
    'text-color': '#bdd0c6',
    'text-halo-color': 'rgba(12, 18, 15, 0.88)',
  },
  place_city: {
    'text-color': '#bdd0c6',
    'text-halo-color': 'rgba(12, 18, 15, 0.88)',
  },
  place_city_large: {
    'text-color': '#bdd0c6',
    'text-halo-color': 'rgba(12, 18, 15, 0.88)',
  },
  place_state: {
    'text-color': '#9eb2a8',
    'text-halo-color': 'rgba(12, 18, 15, 0.88)',
  },
};

export function tuneOpenFreeMapDarkStyleLayers<
  T extends { layers: readonly { id: string; paint?: Record<string, unknown> }[] },
>(style: T): T {
  const nextLayers = style.layers.map((layer) => {
    const patch = DARK_BASEMAP_PAINT_TUNING[layer.id];
    if (!patch) {
      return layer;
    }
    return {
      ...layer,
      paint: {
        ...(layer.paint ?? {}),
        ...patch,
      },
    };
  });
  return {
    ...style,
    layers: nextLayers,
  };
}

export const ORTHOPHOTO_SOURCE_ID = 'orthophoto-source';
export const ORTHOPHOTO_LAYER_ID = 'orthophoto-raster-layer';
export const PROPOSALS_POLYGON_SOURCE_ID = 'proposals-polygon-source';
export const PROPOSALS_CENTROID_SOURCE_ID = 'proposals-centroid-source';
export const DRAFT_SOURCE_ID = 'draft-source';

export const MIN_POLYGON_OPACITY = 0;
export const MAX_POLYGON_OPACITY = 1;
export const DEFAULT_POLYGON_OPACITY = 0.35;

export function clampPolygonOpacity(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_POLYGON_OPACITY;
  }
  return Math.min(MAX_POLYGON_OPACITY, Math.max(MIN_POLYGON_OPACITY, value));
}

export const INTERACTIVE_PROPOSAL_LAYER_IDS = [
  'proposals-fill',
  'proposals-outline',
  'proposals-centroid',
] as const;

export type InteractiveProposalLayerId =
  (typeof INTERACTIVE_PROPOSAL_LAYER_IDS)[number];

export interface OrthophotoRasterSourceSpec {
  type: 'raster';
  tiles: [string];
  tileSize: 256 | 512;
  maxzoom: number;
  attribution: string;
  bounds?: [number, number, number, number];
}

export interface OrthophotoRasterLayerSpec {
  id: typeof ORTHOPHOTO_LAYER_ID;
  type: 'raster';
  source: typeof ORTHOPHOTO_SOURCE_ID;
  beforeId: 'proposals-fill';
  layout: {
    visibility: 'visible' | 'none';
  };
  paint: {
    'raster-opacity': number;
    'raster-resampling': 'linear';
  };
}

export interface ProposalFeatureProperties {
  id: string;
  surfaceType: SurfaceType;
  status: PolygonStatus;
  finishedAt: string | null;
  note: string | null;
  areaM2: number;
  municipalityAgs: string | null;
  municipalityName: string | null;
  municipalityMaxScore: number;
  municipalityNormalizedScore: number;
  photoCount: number;
  commentCount: number;
  authorPseudonym: string;
  authorIsNewUser: boolean;
  authorRecentlyActive: boolean | null;
  upvotes: number;
  downvotes: number;
  score: number;
  myVote: -1 | 0 | 1;
  flagCount: number;
  isFlagged: boolean;
  myFlag: boolean;
  isAuthor: boolean;
  createdAt: string;
  updatedAt: string;
  selected: boolean;
}

export type ProposalPolygonFeature = Feature<Polygon, ProposalFeatureProperties> & {
  id: string;
};

export type ProposalCentroidFeature = Feature<Point, ProposalFeatureProperties> & {
  id: string;
};

export interface ProposalGeoJsonCollections {
  polygons: FeatureCollection<Polygon, ProposalFeatureProperties> & {
    features: ProposalPolygonFeature[];
  };
  centroids: FeatureCollection<Point, ProposalFeatureProperties> & {
    features: ProposalCentroidFeature[];
  };
}

export type NormalizedPositiveFillExpression = [
  'interpolate',
  ['linear'],
  ['number', ['get', 'municipalityNormalizedScore'], number],
  number,
  string,
  number,
  string,
  number,
  string,
];

export type NormalizedPositiveOutlineExpression = [
  'interpolate',
  ['linear'],
  ['number', ['get', 'municipalityNormalizedScore'], number],
  number,
  string,
  number,
  string,
];

export type NotAuthorBooleanExpression = [
  '!',
  ['boolean', ['get', 'isAuthor'], boolean],
];

export type ScoreColorCaseExpression =
  | [
      'case',
      ['==', ['get', 'status'], 'finished'],
      string,
      ['==', ['get', 'status'], 'in_progress'],
      string,
      ['<', ['get', 'score'], number],
      string,
      ['>', ['get', 'score'], number],
      NormalizedPositiveFillExpression,
      string,
    ]
  | [
      'case',
      NotAuthorBooleanExpression,
      string,
      ['==', ['get', 'status'], 'finished'],
      string,
      ['==', ['get', 'status'], 'in_progress'],
      string,
      ['<', ['get', 'score'], number],
      string,
      ['>', ['get', 'score'], number],
      NormalizedPositiveFillExpression,
      string,
    ];

export type SelectedOutlineColorExpression =
  | [
      'case',
      ['boolean', ['get', 'selected'], boolean],
      string,
      ['==', ['get', 'status'], 'finished'],
      string,
      ['==', ['get', 'status'], 'in_progress'],
      string,
      ['<', ['get', 'score'], number],
      string,
      ['>', ['get', 'score'], number],
      NormalizedPositiveOutlineExpression,
      string,
    ]
  | [
      'case',
      ['boolean', ['get', 'selected'], boolean],
      string,
      NotAuthorBooleanExpression,
      string,
      ['==', ['get', 'status'], 'finished'],
      string,
      ['==', ['get', 'status'], 'in_progress'],
      string,
      ['<', ['get', 'score'], number],
      string,
      ['>', ['get', 'score'], number],
      NormalizedPositiveOutlineExpression,
      string,
    ];

export type FillOpacityCaseExpression =
  | [
      'case',
      ['boolean', ['get', 'selected'], boolean],
      number,
      ['==', ['get', 'status'], 'finished'],
      number,
      ['==', ['get', 'status'], 'in_progress'],
      number,
      number,
    ]
  | [
      'case',
      ['boolean', ['get', 'selected'], boolean],
      number,
      NotAuthorBooleanExpression,
      number,
      ['==', ['get', 'status'], 'finished'],
      number,
      ['==', ['get', 'status'], 'in_progress'],
      number,
      number,
    ];

export type SelectedNumberCaseExpression =
  | [
      'case',
      ['boolean', ['get', 'selected'], boolean],
      number,
      number,
    ]
  | [
      'case',
      ['boolean', ['get', 'selected'], boolean],
      number,
      NotAuthorBooleanExpression,
      number,
      number,
    ];

export type OutlineWidthCaseExpression =
  | [
      'case',
      ['boolean', ['get', 'selected'], boolean],
      number,
      ['==', ['get', 'status'], 'finished'],
      number,
      ['==', ['get', 'status'], 'in_progress'],
      number,
      number,
    ]
  | [
      'case',
      ['boolean', ['get', 'selected'], boolean],
      number,
      NotAuthorBooleanExpression,
      number,
      ['==', ['get', 'status'], 'finished'],
      number,
      ['==', ['get', 'status'], 'in_progress'],
      number,
      number,
    ];

export type SelectedColorCaseExpression =
  | [
      'case',
      ['boolean', ['get', 'selected'], boolean],
      string,
      string,
    ]
  | [
      'case',
      ['boolean', ['get', 'selected'], boolean],
      string,
      NotAuthorBooleanExpression,
      string,
      string,
    ];

export type GeometryTypeFilterExpression = [
  '==',
  ['geometry-type'],
  'Polygon' | 'LineString' | 'Point',
];

export type FirstVertexRadiusExpression = [
  'case',
  ['boolean', ['get', 'isFirst'], boolean],
  number,
  number,
];

export type FirstVertexColorExpression = [
  'case',
  ['boolean', ['get', 'isFirst'], boolean],
  string,
  string,
];

export interface ProposalFillLayerSpec {
  id: 'proposals-fill';
  type: 'fill';
  source: typeof PROPOSALS_POLYGON_SOURCE_ID;
  paint: {
    'fill-color': ScoreColorCaseExpression;
    'fill-opacity': FillOpacityCaseExpression;
  };
}

export interface ProposalOutlineLayerSpec {
  id: 'proposals-outline';
  type: 'line';
  source: typeof PROPOSALS_POLYGON_SOURCE_ID;
  layout: {
    'line-cap': 'round';
    'line-join': 'round';
  };
  paint: {
    'line-color': SelectedOutlineColorExpression;
    'line-width': OutlineWidthCaseExpression;
    'line-opacity': number;
  };
}

export interface ProposalCentroidLayerSpec {
  id: 'proposals-centroid';
  type: 'circle';
  source: typeof PROPOSALS_CENTROID_SOURCE_ID;
  paint: {
    'circle-color': ScoreColorCaseExpression;
    'circle-radius': SelectedNumberCaseExpression;
    'circle-opacity': number;
    'circle-stroke-color': SelectedColorCaseExpression;
    'circle-stroke-width': SelectedNumberCaseExpression;
    'circle-stroke-opacity': number;
  };
}

export type PolygonLayerSpecsTuple = [
  ProposalFillLayerSpec,
  ProposalOutlineLayerSpec,
  ProposalCentroidLayerSpec,
];

export interface DraftVertexProperties {
  kind: 'vertex';
  index: number;
  label: string;
  isFirst: boolean;
  isLast: boolean;
}

export interface DraftLineProperties {
  kind: 'line';
  closed: boolean;
}

export interface DraftPolygonProperties {
  kind: 'polygon';
  closed: true;
}

export type DraftVertexFeature = Feature<Point, DraftVertexProperties> & {
  id: string;
};

export type DraftLineFeature = Feature<LineString, DraftLineProperties> & {
  id: string;
};

export type DraftPolygonFeature = Feature<Polygon, DraftPolygonProperties> & {
  id: string;
};

export type DraftGeoJsonFeature =
  | DraftVertexFeature
  | DraftLineFeature
  | DraftPolygonFeature;

export interface DraftFeatureCollection {
  type: 'FeatureCollection';
  features: DraftGeoJsonFeature[];
}

export interface DraftLayerMetadata {
  stackGroup: 'draft';
  aboveLayerId: string;
}

export interface DraftFillLayerSpec {
  id: 'draft-fill';
  type: 'fill';
  source: typeof DRAFT_SOURCE_ID;
  filter: GeometryTypeFilterExpression;
  metadata: DraftLayerMetadata;
  paint: {
    'fill-color': string;
    'fill-opacity': number;
  };
}

export interface DraftLineLayerSpec {
  id: 'draft-line';
  type: 'line';
  source: typeof DRAFT_SOURCE_ID;
  filter: GeometryTypeFilterExpression;
  metadata: DraftLayerMetadata;
  layout: {
    'line-cap': 'round';
    'line-join': 'round';
  };
  paint: {
    'line-color': string;
    'line-width': number;
    'line-dasharray': [number, number];
  };
}

export interface DraftVerticesLayerSpec {
  id: 'draft-vertices';
  type: 'circle';
  source: typeof DRAFT_SOURCE_ID;
  filter: GeometryTypeFilterExpression;
  metadata: DraftLayerMetadata;
  paint: {
    'circle-color': FirstVertexColorExpression;
    'circle-radius': FirstVertexRadiusExpression;
    'circle-stroke-color': string;
    'circle-stroke-width': number;
  };
}

export type DraftLayerSpecsTuple = [
  DraftFillLayerSpec,
  DraftLineLayerSpec,
  DraftVerticesLayerSpec,
];

export function buildOrthophotoSourceSpec(
  orthophoto: RuntimeConfig['orthophoto'],
): OrthophotoRasterSourceSpec | null {
  if (orthophoto === null) {
    return null;
  }

  return {
    type: 'raster',
    tiles: [orthophoto.urlTemplate],
    tileSize: orthophoto.tileSize,
    maxzoom: orthophoto.maxZoom,
    attribution: orthophoto.attribution,
    ...(orthophoto.bounds !== null
      ? {
          bounds: [
            orthophoto.bounds[0],
            orthophoto.bounds[1],
            orthophoto.bounds[2],
            orthophoto.bounds[3],
          ],
        }
      : {}),
  };
}

export function buildOrthophotoLayerSpec(
  visible: boolean = true,
): OrthophotoRasterLayerSpec {
  return {
    id: ORTHOPHOTO_LAYER_ID,
    type: 'raster',
    source: ORTHOPHOTO_SOURCE_ID,
    beforeId: 'proposals-fill',
    layout: {
      visibility: visible ? 'visible' : 'none',
    },
    paint: {
      'raster-opacity': 1,
      'raster-resampling': 'linear',
    },
  };
}

function computeExteriorRingCentroid(
  exteriorRing: readonly (readonly [number, number])[] | undefined,
): [number, number] {
  if (!exteriorRing || exteriorRing.length === 0) {
    return [0, 0];
  }

  const n = exteriorRing.length;
  const first = exteriorRing[0]!;
  const last = exteriorRing[n - 1]!;
  const uniqueCount =
    n > 1 && first[0] === last[0] && first[1] === last[1] ? n - 1 : n;

  if (uniqueCount === 0) {
    return [first[0], first[1]];
  }

  const [refLng, refLat] = first;
  let twiceArea = 0;
  let cxAcc = 0;
  let cyAcc = 0;

  for (let i = 0; i < uniqueCount; i++) {
    const [lng0, lat0] = exteriorRing[i]!;
    const [lng1, lat1] = exteriorRing[(i + 1) % uniqueCount]!;
    const x0 = lng0 - refLng;
    const y0 = lat0 - refLat;
    const x1 = lng1 - refLng;
    const y1 = lat1 - refLat;
    const cross = x0 * y1 - x1 * y0;
    twiceArea += cross;
    cxAcc += (x0 + x1) * cross;
    cyAcc += (y0 + y1) * cross;
  }

  const sixArea = 3 * twiceArea;
  if (Math.abs(sixArea) > 1e-18) {
    return [refLng + cxAcc / sixArea, refLat + cyAcc / sixArea];
  }

  let sumLng = 0;
  let sumLat = 0;
  for (let i = 0; i < uniqueCount; i++) {
    const [lng, lat] = exteriorRing[i]!;
    sumLng += lng;
    sumLat += lat;
  }
  return [sumLng / uniqueCount, sumLat / uniqueCount];
}

export function buildProposalGeoJson(
  features: readonly PolygonFeature[],
  selectedFeatureId: string | null,
): ProposalGeoJsonCollections {
  const polygonFeatures: ProposalPolygonFeature[] = [];
  const centroidFeatures: ProposalCentroidFeature[] = [];

  for (const feature of features) {
    const promotedProperties: ProposalFeatureProperties = {
      ...feature.properties,
      id: feature.id,
      selected: feature.id === selectedFeatureId,
    };

    const copiedRings: [number, number][][] = feature.geometry.coordinates.map(
      (ring) => ring.map(([lng, lat]): [number, number] => [lng, lat]),
    );

    polygonFeatures.push({
      type: 'Feature',
      id: feature.id,
      geometry: {
        type: 'Polygon',
        coordinates: copiedRings,
      },
      properties: promotedProperties,
    });

    const centroidCoords = computeExteriorRingCentroid(
      feature.geometry.coordinates[0],
    );

    centroidFeatures.push({
      type: 'Feature',
      id: feature.id,
      geometry: {
        type: 'Point',
        coordinates: centroidCoords,
      },
      properties: { ...promotedProperties },
    });
  }

  return {
    polygons: {
      type: 'FeatureCollection',
      features: polygonFeatures,
    },
    centroids: {
      type: 'FeatureCollection',
      features: centroidFeatures,
    },
  };
}

function scaleOpacityChannel(
  normalizedSliderOpacity: number,
  defaultTarget: number,
): number {
  const clamped = clampPolygonOpacity(normalizedSliderOpacity);
  if (clamped <= 0) {
    return 0;
  }
  const raw =
    clamped <= DEFAULT_POLYGON_OPACITY
      ? (clamped / DEFAULT_POLYGON_OPACITY) * defaultTarget
      : defaultTarget +
        ((clamped - DEFAULT_POLYGON_OPACITY) /
          (MAX_POLYGON_OPACITY - DEFAULT_POLYGON_OPACITY)) *
          (MAX_POLYGON_OPACITY - defaultTarget);
  return Math.round(Math.min(1, Math.max(0, raw)) * 1000) / 1000;
}

export function buildPolygonLayerSpecs(
  polygonOpacity: number = DEFAULT_POLYGON_OPACITY,
  colorScheme: ColorScheme = 'light',
  highlightMineOnly: boolean = false,
): PolygonLayerSpecsTuple {
  const isDark = colorScheme === 'dark';
  const op = clampPolygonOpacity(polygonOpacity);
  const baseFillOpacity = scaleOpacityChannel(op, DEFAULT_POLYGON_OPACITY);
  const inProgressFillOpacity = scaleOpacityChannel(op, 0.42);
  const finishedFillOpacity = scaleOpacityChannel(op, 0.46);
  const selectedFillOpacity = scaleOpacityChannel(op, 0.58);
  const mutedFillOpacity = scaleOpacityChannel(op, 0.16);
  const strokeAndMarkerOpacity = scaleOpacityChannel(op, 1);

  const mutedFillColor = isDark ? '#64748b' : '#94a3b8';
  const mutedOutlineColor = isDark ? '#94a3b8' : '#64748b';
  const mutedCentroidStrokeColor = isDark ? '#475569' : '#cbd5e1';
  const notAuthorExpr: NotAuthorBooleanExpression = [
    '!',
    ['boolean', ['get', 'isAuthor'], false],
  ];

  const positiveGradient: NormalizedPositiveFillExpression = isDark
    ? [
        'interpolate',
        ['linear'],
        ['number', ['get', 'municipalityNormalizedScore'], 0.5],
        0,
        '#059669',
        0.4,
        '#10b981',
        1,
        '#34d399',
      ]
    : [
        'interpolate',
        ['linear'],
        ['number', ['get', 'municipalityNormalizedScore'], 0.5],
        0,
        '#6ee7b7',
        0.4,
        '#22c55e',
        1,
        '#14532d',
      ];

  const positiveOutlineGradient: NormalizedPositiveOutlineExpression = isDark
    ? [
        'interpolate',
        ['linear'],
        ['number', ['get', 'municipalityNormalizedScore'], 0.5],
        0,
        '#34d399',
        1,
        '#a7f3d0',
      ]
    : [
        'interpolate',
        ['linear'],
        ['number', ['get', 'municipalityNormalizedScore'], 0.5],
        0,
        '#059669',
        1,
        '#052e16',
      ];

  const scoreColor: ScoreColorCaseExpression = highlightMineOnly
    ? [
        'case',
        notAuthorExpr,
        mutedFillColor,
        ['==', ['get', 'status'], 'finished'],
        isDark ? '#14b8a6' : '#0d9488',
        ['==', ['get', 'status'], 'in_progress'],
        isDark ? '#3b82f6' : '#2563eb',
        ['<', ['get', 'score'], 0],
        isDark ? '#ef4444' : '#c44536',
        ['>', ['get', 'score'], 0],
        positiveGradient,
        isDark ? '#f59e0b' : '#c87d1a',
      ]
    : [
        'case',
        ['==', ['get', 'status'], 'finished'],
        isDark ? '#14b8a6' : '#0d9488',
        ['==', ['get', 'status'], 'in_progress'],
        isDark ? '#3b82f6' : '#2563eb',
        ['<', ['get', 'score'], 0],
        isDark ? '#ef4444' : '#c44536',
        ['>', ['get', 'score'], 0],
        positiveGradient,
        isDark ? '#f59e0b' : '#c87d1a',
      ];

  const fillLayer: ProposalFillLayerSpec = {
    id: 'proposals-fill',
    type: 'fill',
    source: PROPOSALS_POLYGON_SOURCE_ID,
    paint: {
      'fill-color': scoreColor,
      'fill-opacity': highlightMineOnly
        ? [
            'case',
            ['boolean', ['get', 'selected'], false],
            selectedFillOpacity,
            notAuthorExpr,
            mutedFillOpacity,
            ['==', ['get', 'status'], 'finished'],
            finishedFillOpacity,
            ['==', ['get', 'status'], 'in_progress'],
            inProgressFillOpacity,
            baseFillOpacity,
          ]
        : [
            'case',
            ['boolean', ['get', 'selected'], false],
            selectedFillOpacity,
            ['==', ['get', 'status'], 'finished'],
            finishedFillOpacity,
            ['==', ['get', 'status'], 'in_progress'],
            inProgressFillOpacity,
            baseFillOpacity,
          ],
    },
  };

  const selectedStrokeColor = isDark ? '#7dd3fc' : '#0b3d91';

  const outlineLayer: ProposalOutlineLayerSpec = {
    id: 'proposals-outline',
    type: 'line',
    source: PROPOSALS_POLYGON_SOURCE_ID,
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': highlightMineOnly
        ? [
            'case',
            ['boolean', ['get', 'selected'], false],
            selectedStrokeColor,
            notAuthorExpr,
            mutedOutlineColor,
            ['==', ['get', 'status'], 'finished'],
            isDark ? '#5eead4' : '#0f766e',
            ['==', ['get', 'status'], 'in_progress'],
            isDark ? '#93c5fd' : '#1e40af',
            ['<', ['get', 'score'], 0],
            isDark ? '#fca5a5' : '#8f281d',
            ['>', ['get', 'score'], 0],
            positiveOutlineGradient,
            isDark ? '#fcd34d' : '#8a530b',
          ]
        : [
            'case',
            ['boolean', ['get', 'selected'], false],
            selectedStrokeColor,
            ['==', ['get', 'status'], 'finished'],
            isDark ? '#5eead4' : '#0f766e',
            ['==', ['get', 'status'], 'in_progress'],
            isDark ? '#93c5fd' : '#1e40af',
            ['<', ['get', 'score'], 0],
            isDark ? '#fca5a5' : '#8f281d',
            ['>', ['get', 'score'], 0],
            positiveOutlineGradient,
            isDark ? '#fcd34d' : '#8a530b',
          ],
      'line-width': highlightMineOnly
        ? [
            'case',
            ['boolean', ['get', 'selected'], false],
            3.5,
            notAuthorExpr,
            1.4,
            ['==', ['get', 'status'], 'finished'],
            2.75,
            ['==', ['get', 'status'], 'in_progress'],
            2.5,
            2,
          ]
        : [
            'case',
            ['boolean', ['get', 'selected'], false],
            3.5,
            ['==', ['get', 'status'], 'finished'],
            2.75,
            ['==', ['get', 'status'], 'in_progress'],
            2.5,
            2,
          ],
      'line-opacity': strokeAndMarkerOpacity,
    },
  };

  const centroidLayer: ProposalCentroidLayerSpec = {
    id: 'proposals-centroid',
    type: 'circle',
    source: PROPOSALS_CENTROID_SOURCE_ID,
    paint: {
      'circle-color': scoreColor,
      'circle-radius': highlightMineOnly
        ? [
            'case',
            ['boolean', ['get', 'selected'], false],
            7,
            notAuthorExpr,
            4,
            5,
          ]
        : ['case', ['boolean', ['get', 'selected'], false], 7, 5],
      'circle-opacity': strokeAndMarkerOpacity,
      'circle-stroke-color': highlightMineOnly
        ? [
            'case',
            ['boolean', ['get', 'selected'], false],
            selectedStrokeColor,
            notAuthorExpr,
            mutedCentroidStrokeColor,
            isDark ? '#e2ece7' : '#ffffff',
          ]
        : [
            'case',
            ['boolean', ['get', 'selected'], false],
            selectedStrokeColor,
            isDark ? '#e2ece7' : '#ffffff',
          ],
      'circle-stroke-width': [
        'case',
        ['boolean', ['get', 'selected'], false],
        3,
        1.5,
      ],
      'circle-stroke-opacity': strokeAndMarkerOpacity,
    },
  };

  return [fillLayer, outlineLayer, centroidLayer];
}

export function buildDraftGeoJson(
  draftVertices: readonly [number, number][],
  isRingClosed: boolean,
): DraftFeatureCollection {
  const vertices = dedupeConsecutivePoints(draftVertices);
  const features: DraftGeoJsonFeature[] = [];

  const shouldClosePolygon = isRingClosed && vertices.length >= 3;

  if (shouldClosePolygon) {
    const closedRing = closeRingIfNeeded(vertices);
    features.push({
      type: 'Feature',
      id: 'draft-polygon',
      geometry: {
        type: 'Polygon',
        coordinates: [closedRing],
      },
      properties: {
        kind: 'polygon',
        closed: true,
      },
    });
    features.push({
      type: 'Feature',
      id: 'draft-line',
      geometry: {
        type: 'LineString',
        coordinates: closedRing.map(([lng, lat]): [number, number] => [lng, lat]),
      },
      properties: {
        kind: 'line',
        closed: true,
      },
    });
  } else if (vertices.length >= 2) {
    features.push({
      type: 'Feature',
      id: 'draft-line',
      geometry: {
        type: 'LineString',
        coordinates: vertices.map(([lng, lat]): [number, number] => [lng, lat]),
      },
      properties: {
        kind: 'line',
        closed: false,
      },
    });
  }

  for (let i = 0; i < vertices.length; i++) {
    const [lng, lat] = vertices[i]!;
    const oneBasedIndex = i + 1;
    features.push({
      type: 'Feature',
      id: `draft-vertex-${oneBasedIndex}`,
      geometry: {
        type: 'Point',
        coordinates: [lng, lat],
      },
      properties: {
        kind: 'vertex',
        index: oneBasedIndex,
        label: String(oneBasedIndex),
        isFirst: i === 0,
        isLast: i === vertices.length - 1,
      },
    });
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}

export function buildDraftLayerSpecs(
  colorScheme: ColorScheme = 'light',
): DraftLayerSpecsTuple {
  const isDark = colorScheme === 'dark';
  const draftPrimaryColor = isDark ? '#60a5fa' : '#1d4ed8';
  const draftFirstVertexColor = isDark ? '#2dd4bf' : '#0f766e';
  const draftStrokeColor = isDark ? '#f8fafc' : '#ffffff';

  const draftFill: DraftFillLayerSpec = {
    id: 'draft-fill',
    type: 'fill',
    source: DRAFT_SOURCE_ID,
    filter: ['==', ['geometry-type'], 'Polygon'],
    metadata: {
      stackGroup: 'draft',
      aboveLayerId: 'proposals-centroid',
    },
    paint: {
      'fill-color': draftPrimaryColor,
      'fill-opacity': isDark ? 0.28 : 0.24,
    },
  };

  const draftLine: DraftLineLayerSpec = {
    id: 'draft-line',
    type: 'line',
    source: DRAFT_SOURCE_ID,
    filter: ['==', ['geometry-type'], 'LineString'],
    metadata: {
      stackGroup: 'draft',
      aboveLayerId: 'draft-fill',
    },
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': draftPrimaryColor,
      'line-width': 2.5,
      'line-dasharray': [2, 1.5],
    },
  };

  const draftVertices: DraftVerticesLayerSpec = {
    id: 'draft-vertices',
    type: 'circle',
    source: DRAFT_SOURCE_ID,
    filter: ['==', ['geometry-type'], 'Point'],
    metadata: {
      stackGroup: 'draft',
      aboveLayerId: 'draft-line',
    },
    paint: {
      'circle-color': [
        'case',
        ['boolean', ['get', 'isFirst'], false],
        draftFirstVertexColor,
        draftPrimaryColor,
      ],
      'circle-radius': ['case', ['boolean', ['get', 'isFirst'], false], 6.5, 5],
      'circle-stroke-color': draftStrokeColor,
      'circle-stroke-width': 2,
    },
  };

  return [draftFill, draftLine, draftVertices];
}

export function dedupeFeatureIdsPreservingOrder(
  rawIds: readonly (string | null | undefined)[],
  orderedFeatures: readonly PolygonFeature[],
): string[] {
  if (rawIds.length === 0 || orderedFeatures.length === 0) {
    return [];
  }

  const hitSet = new Set<string>();
  for (const rawId of rawIds) {
    if (typeof rawId === 'string' && rawId.length > 0) {
      hitSet.add(rawId);
    }
  }
  if (hitSet.size === 0) {
    return [];
  }

  const indexedFeatures = orderedFeatures
    .map((feature, index) => ({ feature, index }))
    .filter(({ feature }) => hitSet.has(feature.id));

  indexedFeatures.sort((a, b) => {
    if (b.feature.properties.score !== a.feature.properties.score) {
      return b.feature.properties.score - a.feature.properties.score;
    }
    return a.index - b.index;
  });

  const seen = new Set<string>();
  const result: string[] = [];
  for (const { feature } of indexedFeatures) {
    if (!seen.has(feature.id)) {
      seen.add(feature.id);
      result.push(feature.id);
    }
  }

  return result;
}

export function extractRenderedFeatureRawIds(
  renderedFeatures: readonly {
    id?: string | number | undefined;
    properties?: Record<string, unknown> | null | undefined;
  }[],
): string[] {
  const rawIds: string[] = [];
  for (const feature of renderedFeatures) {
    const propId = feature.properties?.['id'];
    if (typeof propId === 'string' && propId.length > 0) {
      rawIds.push(propId);
    } else if (typeof feature.id === 'string' && feature.id.length > 0) {
      rawIds.push(feature.id);
    }
  }
  return rawIds;
}

export function shouldReportOrthophotoTileError(
  event: {
    sourceId?: string | null | undefined;
    message?: string | null | undefined;
  },
  basemapMode: 'osm' | 'orthophoto',
): string | null {
  if (basemapMode !== 'orthophoto' || event.sourceId !== ORTHOPHOTO_SOURCE_ID) {
    return null;
  }

  const detail = event.message?.trim();
  if (detail && detail.length > 0) {
    return `Aerial orthophoto tiles failed to load (${detail}); reverted to OpenStreetMap basemap.`;
  }
  return 'Aerial orthophoto tiles failed to load; reverted to OpenStreetMap basemap.';
}
