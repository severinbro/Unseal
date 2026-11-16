import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type PolygonFeature, type RuntimeConfig } from '@entsiegelung/shared';
import {
  expression as styleExpression,
  featureFilter,
  latest as styleSpecLatest,
  validateStyleMin,
  type StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';

import {
  buildDraftGeoJson,
  buildDraftLayerSpecs,
  buildOrthophotoLayerSpec,
  buildOrthophotoSourceSpec,
  buildPolygonLayerSpecs,
  buildProposalGeoJson,
  clampPolygonOpacity,
  DEFAULT_DARK_OSM_STYLE_URL,
  DEFAULT_POLYGON_OPACITY,
  dedupeFeatureIdsPreservingOrder,
  DRAFT_SOURCE_ID,
  extractRenderedFeatureRawIds,
  INTERACTIVE_PROPOSAL_LAYER_IDS,
  isOpenFreeMapDarkStyleUrl,
  ORTHOPHOTO_LAYER_ID,
  ORTHOPHOTO_SOURCE_ID,
  PROPOSALS_CENTROID_SOURCE_ID,
  PROPOSALS_POLYGON_SOURCE_ID,
  resolveBasemapStyleUrl,
  shouldReportOrthophotoTileError,
  tuneOpenFreeMapDarkStyleLayers,
  type DraftGeoJsonFeature,
  type DraftLineFeature,
  type DraftPolygonFeature,
  type DraftVertexFeature,
} from '../src/map/styleBuilder';
import type { MapCanvasProps } from '../src/map/types';

const FEATURE_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FEATURE_B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FEATURE_C_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function makeFeature(params: {
  id: string;
  score: number;
  status?: 'proposed' | 'in_progress' | 'finished';
  municipalityNormalizedScore?: number;
  upvotes?: number;
  downvotes?: number;
  createdAt?: string;
}): PolygonFeature {
  const upvotes = params.upvotes ?? Math.max(params.score, 0);
  const downvotes = params.downvotes ?? Math.max(-params.score, 0);
  const createdAt = params.createdAt ?? '2026-11-12T12:00:00.000Z';
  const status = params.status ?? 'proposed';

  return {
    type: 'Feature',
    id: params.id,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [9.9935, 53.551],
          [9.9937, 53.551],
          [9.9937, 53.5512],
          [9.9935, 53.5512],
          [9.9935, 53.551],
        ],
      ],
    },
    properties: {
      id: params.id,
      surfaceType: 'asphalt',
      status,
      finishedAt: status === 'finished' ? createdAt : null,
      note: 'Courtyard lot',
      areaM2: 296.4,
      municipalityAgs: '02000000',
      municipalityName: 'Hamburg',
      municipalityMaxScore: Math.max(params.score, 3),
      municipalityNormalizedScore:
        params.municipalityNormalizedScore ??
        (status !== 'proposed' || params.score <= 0 ? 0 : 1),
      photoCount: 0,
      commentCount: 0,
      authorPseudonym: 'mapper_one',
      authorIsNewUser: false,
      authorRecentlyActive: true,
      upvotes,
      downvotes,
      score: params.score,
      myVote: 0,
      flagCount: 0,
      isFlagged: false,
      myFlag: false,
      isAuthor: false,
      createdAt,
      updatedAt: createdAt,
    },
  };
}

describe('styleBuilder and MapCanvas contract', () => {
  it('Review Focus 1: buildProposalGeoJson promotes feature.id to properties.id, sets selected flag, emits centroids, and dedupeFeatureIdsPreservingOrder deduplicates in features score order', () => {
    const featureA = makeFeature({ id: FEATURE_A_ID, score: 7 });
    const featureB = makeFeature({ id: FEATURE_B_ID, score: 0 });
    const featureC = makeFeature({ id: FEATURE_C_ID, score: -2 });

    // Simulate a feature whose properties.id was desynchronized prior to rendering
    const desyncedA: PolygonFeature = {
      ...featureA,
      properties: {
        ...featureA.properties,
        id: '00000000-0000-4000-8000-000000000000',
      },
    };

    const orderedFeatures = [desyncedA, featureB, featureC];
    const { polygons, centroids } = buildProposalGeoJson(
      orderedFeatures,
      FEATURE_B_ID,
    );

    assert.equal(polygons.type, 'FeatureCollection');
    assert.equal(centroids.type, 'FeatureCollection');
    assert.equal(polygons.features.length, 3);
    assert.equal(centroids.features.length, 3);

    // properties.id must strictly equal top-level feature.id on both polygons and centroids
    for (let i = 0; i < orderedFeatures.length; i++) {
      const expectedId = orderedFeatures[i]!.id;
      const poly = polygons.features[i]!;
      const centroid = centroids.features[i]!;

      assert.equal(poly.id, expectedId);
      assert.equal(poly.properties.id, expectedId);
      assert.equal(centroid.id, expectedId);
      assert.equal(centroid.properties.id, expectedId);

      const expectedSelected = expectedId === FEATURE_B_ID;
      assert.equal(poly.properties.selected, expectedSelected);
      assert.equal(centroid.properties.selected, expectedSelected);

      assert.equal(centroid.geometry.type, 'Point');
      const [cLng, cLat] = centroid.geometry.coordinates;
      assert.ok(Math.abs(cLng! - 9.9936) < 1e-6);
      assert.ok(Math.abs(cLat! - 53.5511) < 1e-6);
    }

    // When selectedFeatureId is null, every feature has selected === false
    const unselected = buildProposalGeoJson(orderedFeatures, null);
    assert.ok(unselected.polygons.features.every((f) => f.properties.selected === false));
    assert.ok(unselected.centroids.features.every((f) => f.properties.selected === false));

    // Regression: micro-courtyard at high coordinates computes numerically stable centroid without catastrophic cancellation
    const highLatFeature: PolygonFeature = {
      ...featureA,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [179.9998, 84.9998],
            [179.9999, 84.9998],
            [179.9999, 84.9999],
            [179.9998, 84.9999],
            [179.9998, 84.9998],
          ],
        ],
      },
    };
    const highLatGeoJson = buildProposalGeoJson([highLatFeature], null);
    const [hiLng, hiLat] = highLatGeoJson.centroids.features[0]!.geometry.coordinates;
    assert.ok(Math.abs(hiLng! - 179.99985) < 1e-9);
    assert.ok(Math.abs(hiLat! - 84.99985) < 1e-9);

    // Web geojson-vt drops top-level UUID feature.id; extractRenderedFeatureRawIds reads properties.id first
    const simulatedWebHits = [
      { id: undefined, properties: { id: 'b' } },
      { id: 42, properties: { id: 'a' } },
      { id: 'b', properties: {} },
    ];
    const extractedRaw = extractRenderedFeatureRawIds(simulatedWebHits);
    assert.deepEqual(extractedRaw, ['b', 'a', 'b']);

    // Exact Review Focus 1 hit-test deduplication check: ['b', 'a', 'b'] -> ['a', 'b'] in score order
    const simpleB = makeFeature({ id: 'b', score: 1 });
    const simpleA = makeFeature({ id: 'a', score: 5 });
    const simpleC = makeFeature({ id: 'c', score: -3 });

    assert.deepEqual(
      dedupeFeatureIdsPreservingOrder(['b', 'a', 'b'], [simpleA, simpleB, simpleC]),
      ['a', 'b'],
    );

    // Even if caller array was unsorted [simpleB, simpleA], higher score 'a' still comes first
    assert.deepEqual(
      dedupeFeatureIdsPreservingOrder(['b', 'a', 'b'], [simpleB, simpleA]),
      ['a', 'b'],
    );

    // Equal-score ties preserve orderedFeatures order and unknown/null IDs are filtered out
    const tieFirst = makeFeature({
      id: 'tie-1',
      score: 3,
      createdAt: '2026-11-12T14:00:00.000Z',
    });
    const tieSecond = makeFeature({
      id: 'tie-2',
      score: 3,
      createdAt: '2026-11-12T12:00:00.000Z',
    });
    assert.deepEqual(
      dedupeFeatureIdsPreservingOrder(
        ['basemap-road', 'tie-2', null, 'tie-1', 'tie-2', undefined],
        [tieFirst, tieSecond],
      ),
      ['tie-1', 'tie-2'],
    );
    assert.deepEqual(dedupeFeatureIdsPreservingOrder([], orderedFeatures), []);
  });

  it('Review Focus 2: buildOrthophotoSourceSpec omits null bounds, z-orders orthophoto beneath proposals-fill and draft layers above proposals, and passes MapLibre style-spec validation', () => {
    assert.equal(ORTHOPHOTO_SOURCE_ID, 'orthophoto-source');
    assert.equal(ORTHOPHOTO_LAYER_ID, 'orthophoto-raster-layer');
    assert.deepEqual(INTERACTIVE_PROPOSAL_LAYER_IDS, [
      'proposals-fill',
      'proposals-outline',
      'proposals-centroid',
    ]);

    assert.equal(buildOrthophotoSourceSpec(null), null);

    const orthoNullBounds: NonNullable<RuntimeConfig['orthophoto']> = {
      urlTemplate:
        'https://wms.example.org/ortho?SERVICE=WMS&BBOX={bbox-epsg-3857}&WIDTH=512&HEIGHT=512',
      tileSize: 512,
      attribution: '© City Geodata',
      bounds: null,
      maxZoom: 20,
    };
    const specWithoutBounds = buildOrthophotoSourceSpec(orthoNullBounds);
    assert.ok(specWithoutBounds !== null);
    assert.equal(specWithoutBounds.type, 'raster');
    assert.deepEqual(specWithoutBounds.tiles, [orthoNullBounds.urlTemplate]);
    assert.equal(specWithoutBounds.tileSize, 512);
    assert.equal(specWithoutBounds.maxzoom, 20);
    assert.equal(specWithoutBounds.attribution, '© City Geodata');
    assert.equal('bounds' in specWithoutBounds, false);

    const orthoWithBounds: NonNullable<RuntimeConfig['orthophoto']> = {
      urlTemplate: 'https://tiles.example.org/ortho/{z}/{x}/{y}.jpg',
      tileSize: 256,
      attribution: '© State Survey',
      bounds: [9.7, 53.35, 10.35, 53.75],
      maxZoom: 19,
    };
    const specWithBounds = buildOrthophotoSourceSpec(orthoWithBounds);
    assert.ok(specWithBounds !== null);
    assert.deepEqual(specWithBounds.bounds, [9.7, 53.35, 10.35, 53.75]);

    const orthoLayerVisible = buildOrthophotoLayerSpec();
    assert.equal(orthoLayerVisible.id, ORTHOPHOTO_LAYER_ID);
    assert.equal(orthoLayerVisible.source, ORTHOPHOTO_SOURCE_ID);
    assert.equal(orthoLayerVisible.beforeId, 'proposals-fill');
    assert.equal(orthoLayerVisible.layout.visibility, 'visible');

    const orthoLayerHidden = buildOrthophotoLayerSpec(false);
    assert.equal(orthoLayerHidden.layout.visibility, 'none');

    const polygonLayers = buildPolygonLayerSpecs();
    assert.deepEqual(
      polygonLayers.map((l) => l.id),
      [...INTERACTIVE_PROPOSAL_LAYER_IDS],
    );

    const draftLayers = buildDraftLayerSpecs();
    assert.deepEqual(
      draftLayers.map((l) => l.id),
      ['draft-fill', 'draft-line', 'draft-vertices'],
    );
    for (const draftLayer of draftLayers) {
      assert.equal('beforeId' in draftLayer, false);
    }

    // Simulate MapLibre Web layer insertion: basemap -> proposals -> insert orthophoto before 'proposals-fill' -> append draft layers
    const simulatedStack: StyleSpecification['layers'] = [
      { id: 'basemap-background', type: 'background', paint: { 'background-color': '#f0efe9' } },
      ...polygonLayers,
    ];
    const { beforeId, ...rawOrthoLayer } = orthoLayerVisible;
    const beforeIdx = simulatedStack.findIndex((l) => l.id === beforeId);
    assert.ok(beforeIdx >= 0);
    simulatedStack.splice(beforeIdx, 0, rawOrthoLayer);
    simulatedStack.push(...draftLayers);

    const stackIds = simulatedStack.map((l) => l.id);
    assert.deepEqual(stackIds, [
      'basemap-background',
      ORTHOPHOTO_LAYER_ID,
      'proposals-fill',
      'proposals-outline',
      'proposals-centroid',
      'draft-fill',
      'draft-line',
      'draft-vertices',
    ]);
    assert.ok(
      stackIds.indexOf(ORTHOPHOTO_LAYER_ID) < stackIds.indexOf('proposals-fill'),
    );
    assert.ok(
      stackIds.indexOf('proposals-centroid') < stackIds.indexOf('draft-fill'),
    );

    // Validate complete style with official @maplibre/maplibre-gl-style-spec validator (both null-bounds and bounded orthophoto)
    for (const orthoSpec of [specWithoutBounds, specWithBounds]) {
      const fullStyle: StyleSpecification = {
        version: 8,
        sources: {
          [ORTHOPHOTO_SOURCE_ID]: orthoSpec,
          [PROPOSALS_POLYGON_SOURCE_ID]: {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          },
          [PROPOSALS_CENTROID_SOURCE_ID]: {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          },
          [DRAFT_SOURCE_ID]: {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          },
        },
        layers: simulatedStack,
      };
      const validationErrors = validateStyleMin(fullStyle);
      assert.deepEqual(validationErrors, []);
    }

    // Evaluate score (< 0, 0, > 0) and selected expressions via MapLibre expression engine
    const [fillLayer, outlineLayer] = polygonLayers;
    const fillColorSpec = styleSpecLatest['paint_fill']['fill-color'] as Parameters<
      typeof styleExpression.createPropertyExpression
    >[1];
    const fillOpacitySpec = styleSpecLatest['paint_fill']['fill-opacity'] as Parameters<
      typeof styleExpression.createPropertyExpression
    >[1];
    const lineWidthSpec = styleSpecLatest['paint_line']['line-width'] as Parameters<
      typeof styleExpression.createPropertyExpression
    >[1];

    const fillColorExpr = styleExpression.createPropertyExpression(
      fillLayer.paint['fill-color'],
      fillColorSpec,
    );
    assert.equal(fillColorExpr.result, 'success');

    const fillOpacityExpr = styleExpression.createPropertyExpression(
      fillLayer.paint['fill-opacity'],
      fillOpacitySpec,
    );
    assert.equal(fillOpacityExpr.result, 'success');

    const lineWidthExpr = styleExpression.createPropertyExpression(
      outlineLayer.paint['line-width'],
      lineWidthSpec,
    );
    assert.equal(lineWidthExpr.result, 'success');

    const evalFillColor = (
      score: number,
      status: 'proposed' | 'in_progress' | 'finished' = 'proposed',
      municipalityNormalizedScore: number = 0.5,
    ): string =>
      String(
        fillColorExpr.value.evaluate(
          { zoom: 16 },
          {
            type: 'Polygon',
            properties: {
              score,
              status,
              municipalityNormalizedScore,
              selected: false,
            },
          },
        ),
      );
    const negColor = evalFillColor(-3);
    const zeroColor = evalFillColor(0);
    const posLowNormColor = evalFillColor(1, 'proposed', 0.2);
    const posHighNormColor = evalFillColor(8, 'proposed', 1.0);
    const inProgressColor = evalFillColor(8, 'in_progress', 0);
    const finishedColor = evalFillColor(8, 'finished', 0);

    assert.notEqual(negColor, zeroColor);
    assert.notEqual(zeroColor, posLowNormColor);
    assert.notEqual(posLowNormColor, posHighNormColor);
    assert.notEqual(inProgressColor, finishedColor);
    assert.notEqual(inProgressColor, posHighNormColor);
    assert.notEqual(inProgressColor, zeroColor);
    assert.notEqual(inProgressColor, negColor);
    assert.notEqual(finishedColor, posHighNormColor);
    assert.notEqual(finishedColor, zeroColor);
    assert.notEqual(finishedColor, negColor);

    const unselectedOpacity = Number(
      fillOpacityExpr.value.evaluate(
        { zoom: 16 },
        { type: 'Polygon', properties: { score: 1, selected: false } },
      ),
    );
    const selectedOpacity = Number(
      fillOpacityExpr.value.evaluate(
        { zoom: 16 },
        { type: 'Polygon', properties: { score: 1, selected: true } },
      ),
    );
    assert.ok(selectedOpacity > unselectedOpacity);

    const unselectedWidth = Number(
      lineWidthExpr.value.evaluate(
        { zoom: 16 },
        { type: 'Polygon', properties: { score: 1, selected: false } },
      ),
    );
    const selectedWidth = Number(
      lineWidthExpr.value.evaluate(
        { zoom: 16 },
        { type: 'Polygon', properties: { score: 1, selected: true } },
      ),
    );
    assert.ok(selectedWidth > unselectedWidth);

    // Orthophoto tile error filter ignores basemap sources and inactive basemapMode
    assert.equal(
      shouldReportOrthophotoTileError(
        { sourceId: 'openmaptiles', message: 'HTTP 503' },
        'orthophoto',
      ),
      null,
    );
    assert.equal(
      shouldReportOrthophotoTileError(
        { sourceId: ORTHOPHOTO_SOURCE_ID, message: 'HTTP 404' },
        'osm',
      ),
      null,
    );
    const orthoReason = shouldReportOrthophotoTileError(
      { sourceId: ORTHOPHOTO_SOURCE_ID, message: 'HTTP 502 Bad Gateway' },
      'orthophoto',
    );
    assert.ok(orthoReason !== null && orthoReason.includes('HTTP 502 Bad Gateway'));
  });

  it('Review Focus 3: buildDraftGeoJson emits 1-based vertex Points, open LineString (>= 2 vertices), and closed Polygon (isRingClosed && >= 3 vertices)', () => {
    const v1: [number, number] = [9.9935, 53.551];
    const v2: [number, number] = [9.9937, 53.551];
    const v3: [number, number] = [9.9937, 53.5512];
    const v4: [number, number] = [9.9935, 53.5512];

    // 0 vertices
    const empty = buildDraftGeoJson([], false);
    assert.equal(empty.type, 'FeatureCollection');
    assert.equal(empty.features.length, 0);

    // 1 vertex -> 1 Point (index 1), no LineString, no Polygon
    const single = buildDraftGeoJson([v1], false);
    assert.equal(single.features.length, 1);
    assert.equal(single.features[0]?.geometry.type, 'Point');
    assert.equal(single.features[0]?.properties.kind, 'vertex');
    assert.equal(single.features[0]?.properties.index, 1);
    assert.equal(single.features[0]?.properties.label, '1');

    const isVertexPoint = (
      f: DraftGeoJsonFeature,
    ): f is DraftVertexFeature => f.geometry.type === 'Point';
    const isDraftLine = (f: DraftGeoJsonFeature): f is DraftLineFeature =>
      f.geometry.type === 'LineString';
    const isDraftPolygon = (f: DraftGeoJsonFeature): f is DraftPolygonFeature =>
      f.geometry.type === 'Polygon';

    // 2 vertices open -> 2 Points (1, 2) + 1 open LineString, no Polygon (even if isRingClosed=true)
    for (const closedFlag of [false, true]) {
      const twoVerts = buildDraftGeoJson([v1, v2], closedFlag);
      const points = twoVerts.features.filter(isVertexPoint);
      const lines = twoVerts.features.filter(isDraftLine);
      const polys = twoVerts.features.filter(isDraftPolygon);

      assert.equal(points.length, 2);
      assert.deepEqual(
        points.map((p) => p.properties.index),
        [1, 2],
      );
      assert.equal(lines.length, 1);
      assert.deepEqual(lines[0]?.geometry.coordinates, [v1, v2]);
      assert.equal(polys.length, 0);
    }

    // 3 vertices open -> 3 Points (1, 2, 3) + 1 open LineString (3 positions), 0 Polygons
    const threeOpen = buildDraftGeoJson([v1, v2, v3], false);
    assert.equal(threeOpen.features.filter(isDraftPolygon).length, 0);
    const openLine = threeOpen.features.find(isDraftLine);
    assert.ok(openLine);
    assert.deepEqual(openLine.geometry.coordinates, [v1, v2, v3]);

    // 4 vertices closed (with a near-duplicate consecutive tap within 1e-7°) -> 4 Points (1..4) + closed Polygon + closed LineString
    const fourClosed = buildDraftGeoJson(
      [v1, v2, [v2[0] + 1e-8, v2[1]], v3, v4],
      true,
    );
    const closedPoints = fourClosed.features.filter(isVertexPoint);
    const closedPolys = fourClosed.features.filter(isDraftPolygon);
    const closedLines = fourClosed.features.filter(isDraftLine);

    assert.equal(closedPoints.length, 4);
    assert.deepEqual(
      closedPoints.map((p) => p.properties.index),
      [1, 2, 3, 4],
    );
    assert.equal(closedPolys.length, 1);
    const polyGeom = closedPolys[0]!.geometry;
    assert.equal(polyGeom.type, 'Polygon');
    assert.deepEqual(polyGeom.coordinates, [[v1, v2, v3, v4, v1]]);
    assert.equal(closedLines.length, 1);
    assert.deepEqual(closedLines[0]!.geometry.coordinates, [v1, v2, v3, v4, v1]);

    // Verify draft layer filters cleanly separate Polygon, LineString, and Point geometries
    const [draftFill, draftLine, draftVertices] = buildDraftLayerSpecs();
    const fillPred = featureFilter(draftFill.filter);
    const linePred = featureFilter(draftLine.filter);
    const vertPred = featureFilter(draftVertices.filter);

    assert.equal(fillPred.filter({ zoom: 16 }, { type: 3, properties: {} }), true);
    assert.equal(fillPred.filter({ zoom: 16 }, { type: 2, properties: {} }), false);
    assert.equal(fillPred.filter({ zoom: 16 }, { type: 1, properties: {} }), false);

    assert.equal(linePred.filter({ zoom: 16 }, { type: 2, properties: {} }), true);
    assert.equal(linePred.filter({ zoom: 16 }, { type: 3, properties: {} }), false);
    assert.equal(linePred.filter({ zoom: 16 }, { type: 1, properties: {} }), false);

    assert.equal(vertPred.filter({ zoom: 16 }, { type: 1, properties: {} }), true);
    assert.equal(vertPred.filter({ zoom: 16 }, { type: 2, properties: {} }), false);
    assert.equal(vertPred.filter({ zoom: 16 }, { type: 3, properties: {} }), false);

    // Type-level check that MapCanvasProps contract matches expected props
    const verifyPropsType = (props: MapCanvasProps): string => props.config.osmStyleUrl;
    assert.equal(typeof verifyPropsType, 'function');
  });

  it('scales polygon fill, outline, and centroid opacities dynamically from 0% to 100% while passing MapLibre style-spec validation', () => {
    assert.equal(clampPolygonOpacity(-0.5), 0);
    assert.equal(clampPolygonOpacity(1.8), 1);
    assert.equal(clampPolygonOpacity(Number.NaN), DEFAULT_POLYGON_OPACITY);

    for (const op of [0, 0.15, DEFAULT_POLYGON_OPACITY, 0.75, 1]) {
      const layers = buildPolygonLayerSpecs(op);
      const style: StyleSpecification = {
        version: 8,
        sources: {
          [PROPOSALS_POLYGON_SOURCE_ID]: {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          },
          [PROPOSALS_CENTROID_SOURCE_ID]: {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          },
        },
        layers,
      };
      assert.deepEqual(validateStyleMin(style), []);
    }

    const [zeroFill, zeroOutline, zeroCentroid] = buildPolygonLayerSpecs(0);
    const [defaultFill, defaultOutline, defaultCentroid] =
      buildPolygonLayerSpecs(DEFAULT_POLYGON_OPACITY);
    const [fullFill, fullOutline, fullCentroid] = buildPolygonLayerSpecs(1);

    assert.equal(zeroOutline.paint['line-opacity'], 0);
    assert.equal(zeroCentroid.paint['circle-opacity'], 0);
    assert.equal(zeroCentroid.paint['circle-stroke-opacity'], 0);

    assert.equal(defaultOutline.paint['line-opacity'], 1);
    assert.equal(defaultCentroid.paint['circle-opacity'], 1);
    assert.equal(defaultCentroid.paint['circle-stroke-opacity'], 1);

    assert.equal(fullOutline.paint['line-opacity'], 1);
    assert.equal(fullCentroid.paint['circle-opacity'], 1);

    const fillOpacitySpec = styleSpecLatest['paint_fill'][
      'fill-opacity'
    ] as Parameters<typeof styleExpression.createPropertyExpression>[1];

    const evalBaseFill = (exprSpec: typeof defaultFill.paint['fill-opacity']): number => {
      const compiled = styleExpression.createPropertyExpression(
        exprSpec,
        fillOpacitySpec,
      );
      assert.equal(compiled.result, 'success');
      return Number(
        compiled.value.evaluate(
          { zoom: 16 },
          { type: 'Polygon', properties: { status: 'proposed', selected: false } },
        ),
      );
    };

    assert.equal(evalBaseFill(zeroFill.paint['fill-opacity']), 0);
    assert.equal(
      evalBaseFill(defaultFill.paint['fill-opacity']),
      DEFAULT_POLYGON_OPACITY,
    );
    assert.equal(evalBaseFill(fullFill.paint['fill-opacity']), 1);
  });

  it('resolves dark basemap URL, tunes OpenFreeMap dark style layers, and validates dark proposal & draft layers against MapLibre style-spec', () => {
    const defaultCfg = {
      osmStyleUrl: 'https://tiles.openfreemap.org/styles/liberty',
    };
    assert.equal(
      resolveBasemapStyleUrl(defaultCfg, 'light'),
      'https://tiles.openfreemap.org/styles/liberty',
    );
    assert.equal(
      resolveBasemapStyleUrl(defaultCfg, 'dark'),
      DEFAULT_DARK_OSM_STYLE_URL,
    );

    const explicitDarkCfg = {
      osmStyleUrl: 'https://tiles.openfreemap.org/styles/liberty',
      osmDarkStyleUrl: 'https://maps.example.org/styles/night.json',
    };
    assert.equal(
      resolveBasemapStyleUrl(explicitDarkCfg, 'dark'),
      'https://maps.example.org/styles/night.json',
    );

    const selfHostedCfg = {
      osmStyleUrl: 'https://tiles.municipality.example/styles/day.json',
    };
    assert.equal(
      resolveBasemapStyleUrl(selfHostedCfg, 'dark'),
      'https://tiles.municipality.example/styles/day.json',
    );

    assert.equal(isOpenFreeMapDarkStyleUrl(DEFAULT_DARK_OSM_STYLE_URL), true);
    assert.equal(
      isOpenFreeMapDarkStyleUrl('https://tiles.openfreemap.org/styles/liberty'),
      false,
    );
    assert.equal(
      isOpenFreeMapDarkStyleUrl('https://maps.example.org/styles/dark'),
      false,
    );

    const sampleDarkBasemap: StyleSpecification = {
      version: 8,
      glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
      sources: {
        openmaptiles: {
          type: 'vector',
          url: 'https://tiles.openfreemap.org/planet',
        },
        [PROPOSALS_POLYGON_SOURCE_ID]: {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        },
        [PROPOSALS_CENTROID_SOURCE_ID]: {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        },
        [DRAFT_SOURCE_ID]: {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        },
      },
      layers: [
        {
          id: 'background',
          type: 'background',
          paint: { 'background-color': 'rgb(12,12,12)' },
        },
        {
          id: 'water',
          type: 'fill',
          source: 'openmaptiles',
          'source-layer': 'water',
          paint: { 'fill-color': 'rgb(27,27,29)' },
        },
        {
          id: 'building',
          type: 'fill',
          source: 'openmaptiles',
          'source-layer': 'building',
          paint: {
            'fill-color': 'rgb(10,10,10)',
            'fill-outline-color': 'rgb(27,27,29)',
          },
        },
        {
          id: 'highway_minor',
          type: 'line',
          source: 'openmaptiles',
          'source-layer': 'transportation',
          paint: { 'line-color': '#181818' },
        },
        {
          id: 'highway_name_other',
          type: 'symbol',
          source: 'openmaptiles',
          'source-layer': 'transportation_name',
          layout: {
            'text-field': ['get', 'name'],
            'text-font': ['Noto Sans Regular'],
          },
          paint: { 'text-color': 'rgba(80, 78, 78, 1)' },
        },
        ...buildPolygonLayerSpecs(DEFAULT_POLYGON_OPACITY, 'dark'),
        ...buildDraftLayerSpecs('dark'),
      ],
    };

    const tunedStyle = tuneOpenFreeMapDarkStyleLayers(sampleDarkBasemap);
    assert.deepEqual(validateStyleMin(tunedStyle), []);

    const bgLayer = tunedStyle.layers.find((l) => l.id === 'background');
    const buildingLayer = tunedStyle.layers.find((l) => l.id === 'building');
    assert.equal(bgLayer?.type, 'background');
    if (bgLayer?.type === 'background') {
      assert.equal(bgLayer.paint?.['background-color'], '#101614');
    }
    if (buildingLayer?.type === 'fill') {
      assert.equal(buildingLayer.paint?.['fill-color'], '#1b2520');
      assert.equal(buildingLayer.paint?.['fill-outline-color'], '#2d3d36');
    }

    const [lightFill, lightOutline] = buildPolygonLayerSpecs(
      DEFAULT_POLYGON_OPACITY,
      'light',
    );
    const [darkFill, darkOutline] = buildPolygonLayerSpecs(
      DEFAULT_POLYGON_OPACITY,
      'dark',
    );
    assert.notDeepEqual(
      darkFill.paint['fill-color'],
      lightFill.paint['fill-color'],
    );
    assert.notDeepEqual(
      darkOutline.paint['line-color'],
      lightOutline.paint['line-color'],
    );
  });
});
