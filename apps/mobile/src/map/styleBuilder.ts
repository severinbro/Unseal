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

export type ScoreColorCaseExpression = [
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
];

export type SelectedOutlineColorExpression = [
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
];

export type FillOpacityCaseExpression = [
  'case',
  ['boolean', ['get', 'selected'], boolean],
  number,
  ['==', ['get', 'status'], 'finished'],
  number,
  ['==', ['get', 'status'], 'in_progress'],
  number,
  number,
];

export type SelectedNumberCaseExpression = [
  'case',
  ['boolean', ['get', 'selected'], boolean],
  number,
  number,
];

export type OutlineWidthCaseExpression = [
  'case',
  ['boolean', ['get', 'selected'], boolean],
  number,
  ['==', ['get', 'status'], 'finished'],
  number,
  ['==', ['get', 'status'], 'in_progress'],
  number,
  number,
];

export type SelectedColorCaseExpression = [
  'case',
  ['boolean', ['get', 'selected'], boolean],
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
): PolygonLayerSpecsTuple {
  const op = clampPolygonOpacity(polygonOpacity);
  const baseFillOpacity = scaleOpacityChannel(op, DEFAULT_POLYGON_OPACITY);
  const inProgressFillOpacity = scaleOpacityChannel(op, 0.42);
  const finishedFillOpacity = scaleOpacityChannel(op, 0.46);
  const selectedFillOpacity = scaleOpacityChannel(op, 0.58);
  const strokeAndMarkerOpacity = scaleOpacityChannel(op, 1);

  const positiveGradient: NormalizedPositiveFillExpression = [
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

  const positiveOutlineGradient: NormalizedPositiveOutlineExpression = [
    'interpolate',
    ['linear'],
    ['number', ['get', 'municipalityNormalizedScore'], 0.5],
    0,
    '#059669',
    1,
    '#052e16',
  ];

  const scoreColor: ScoreColorCaseExpression = [
    'case',
    ['==', ['get', 'status'], 'finished'],
    '#0d9488',
    ['==', ['get', 'status'], 'in_progress'],
    '#2563eb',
    ['<', ['get', 'score'], 0],
    '#c44536',
    ['>', ['get', 'score'], 0],
    positiveGradient,
    '#c87d1a',
  ];

  const fillLayer: ProposalFillLayerSpec = {
    id: 'proposals-fill',
    type: 'fill',
    source: PROPOSALS_POLYGON_SOURCE_ID,
    paint: {
      'fill-color': scoreColor,
      'fill-opacity': [
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

  const outlineLayer: ProposalOutlineLayerSpec = {
    id: 'proposals-outline',
    type: 'line',
    source: PROPOSALS_POLYGON_SOURCE_ID,
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': [
        'case',
        ['boolean', ['get', 'selected'], false],
        '#0b3d91',
        ['==', ['get', 'status'], 'finished'],
        '#0f766e',
        ['==', ['get', 'status'], 'in_progress'],
        '#1e40af',
        ['<', ['get', 'score'], 0],
        '#8f281d',
        ['>', ['get', 'score'], 0],
        positiveOutlineGradient,
        '#8a530b',
      ],
      'line-width': [
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
      'circle-radius': ['case', ['boolean', ['get', 'selected'], false], 7, 5],
      'circle-opacity': strokeAndMarkerOpacity,
      'circle-stroke-color': [
        'case',
        ['boolean', ['get', 'selected'], false],
        '#0b3d91',
        '#ffffff',
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

export function buildDraftLayerSpecs(): DraftLayerSpecsTuple {
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
      'fill-color': '#1d4ed8',
      'fill-opacity': 0.24,
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
      'line-color': '#1d4ed8',
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
        '#0f766e',
        '#1d4ed8',
      ],
      'circle-radius': ['case', ['boolean', ['get', 'isFirst'], false], 6.5, 5],
      'circle-stroke-color': '#ffffff',
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
