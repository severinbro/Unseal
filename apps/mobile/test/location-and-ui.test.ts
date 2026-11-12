import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PolygonFeature, RuntimeConfig } from '@entsiegelung/shared';

import type { LocateMeResult } from '../src/location/locateMe.types';
import {
  requestCurrentCoordinates,
  type WebNavigatorLike,
} from '../src/location/locateMe.web';
import {
  appReducer,
  initialAppState,
  type AppState,
} from '../src/state/appState';
import {
  deriveAuthModalModel,
  deriveDrawingToolbarModel,
  deriveMapControlsModel,
  MIN_TOUCH_TARGET_DP,
} from '../src/state/viewModels';

const SAMPLE_CONFIG: RuntimeConfig = {
  osmStyleUrl: 'https://tiles.openfreemap.org/styles/liberty',
  orthophoto: {
    urlTemplate: 'https://ortho.example.org/tiles/{z}/{x}/{y}.jpg',
    tileSize: 256,
    attribution: '© Municipal Geodata',
    bounds: [9.7, 53.35, 10.35, 53.75],
    maxZoom: 20,
  },
  initialView: {
    lng: 9.9937,
    lat: 53.5511,
    zoom: 15,
  },
  limits: {
    minAreaM2: 2,
    maxAreaM2: 500_000,
    maxVertices: 200,
    maxPolygonSpanDeg: 0.05,
    maxBboxSpanDeg: 0.15,
    bboxFeatureLimit: 500,
    maxDailyPolygonsPerUser: 25,
  },
  disclaimerText:
    'Community unsealing suggestions — non-binding public input, regardless of property ownership.',
  abuseContact: 'moderation@example.org',
};

function makeSampleFeature(id: string, score: number): PolygonFeature {
  return {
    type: 'Feature',
    id,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [9.9935, 53.551],
          [9.9937, 53.551],
          [9.9937, 53.55115],
          [9.9935, 53.55115],
          [9.9935, 53.551],
        ],
      ],
    },
    properties: {
      id,
      surfaceType: 'asphalt',
      note: 'Paved corner',
      areaM2: 220.4,
      authorPseudonym: 'citizen_a',
      upvotes: score > 0 ? score : 0,
      downvotes: score < 0 ? Math.abs(score) : 0,
      score,
      myVote: 0,
      isAuthor: false,
      createdAt: '2026-11-12T10:00:00.000Z',
      updatedAt: '2026-11-12T10:00:00.000Z',
    },
  };
}

describe('locateMe.web requestCurrentCoordinates adapter', () => {
  it('returns { ok: false, reason } with HTTPS guidance on insecure context without calling geolocation', async () => {
    let called = false;
    const nav: WebNavigatorLike = {
      geolocation: {
        getCurrentPosition() {
          called = true;
        },
      },
    };

    const result: LocateMeResult = await requestCurrentCoordinates(nav, false);
    assert.equal(called, false);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.reason, /HTTPS/i);
    }
  });

  it('returns { ok: false, reason } when navigator or geolocation API is unavailable', async () => {
    const nullNavResult = await requestCurrentCoordinates(null, true);
    assert.equal(nullNavResult.ok, false);
    if (!nullNavResult.ok) {
      assert.match(nullNavResult.reason, /geolocation/i);
    }

    const emptyNavResult = await requestCurrentCoordinates({}, true);
    assert.equal(emptyNavResult.ok, false);
    if (!emptyNavResult.ok) {
      assert.match(emptyNavResult.reason, /geolocation/i);
    }
  });

  it('returns { ok: false, reason } without throwing on permission denied (code 1)', async () => {
    const deniedNav: WebNavigatorLike = {
      geolocation: {
        getCurrentPosition(_onSuccess, onError) {
          onError?.({ code: 1, message: 'User denied Geolocation' });
        },
      },
    };

    const result = await requestCurrentCoordinates(deniedNav, true);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.reason, /permission/i);
    }
  });

  it('returns { ok: false, reason } without throwing on position unavailable (code 2) and timeout (code 3)', async () => {
    const unavailableNav: WebNavigatorLike = {
      geolocation: {
        getCurrentPosition(_onSuccess, onError) {
          onError?.({ code: 2, message: 'Position unavailable' });
        },
      },
    };

    const unavailableResult = await requestCurrentCoordinates(
      unavailableNav,
      true,
    );
    assert.equal(unavailableResult.ok, false);
    if (!unavailableResult.ok) {
      assert.match(unavailableResult.reason, /unavailable/i);
    }

    const timeoutNav: WebNavigatorLike = {
      geolocation: {
        getCurrentPosition(_onSuccess, onError) {
          onError?.({ code: 3, message: 'Timeout expired' });
        },
      },
    };

    const timeoutResult = await requestCurrentCoordinates(timeoutNav, true);
    assert.equal(timeoutResult.ok, false);
    if (!timeoutResult.ok) {
      assert.match(timeoutResult.reason, /time/i);
    }
  });

  it('catches synchronous exceptions and non-finite coordinates without rejecting', async () => {
    const throwingNav: WebNavigatorLike = {
      geolocation: {
        getCurrentPosition() {
          throw new Error('SecurityError: blocked by permissions policy');
        },
      },
    };

    const thrownResult = await requestCurrentCoordinates(throwingNav, true);
    assert.equal(thrownResult.ok, false);
    if (!thrownResult.ok) {
      assert.match(thrownResult.reason, /SecurityError|location/i);
    }

    const invalidCoordNav: WebNavigatorLike = {
      geolocation: {
        getCurrentPosition(onSuccess) {
          onSuccess({
            coords: { longitude: Number.NaN, latitude: 53.5511 },
          });
        },
      },
    };

    const invalidResult = await requestCurrentCoordinates(
      invalidCoordNav,
      true,
    );
    assert.equal(invalidResult.ok, false);
  });

  it('returns { ok: true, lng, lat } when geolocation succeeds in a secure context', async () => {
    const okNav: WebNavigatorLike = {
      geolocation: {
        getCurrentPosition(onSuccess) {
          onSuccess({
            coords: {
              longitude: 9.9937,
              latitude: 53.5511,
            },
          });
        },
      },
    };

    const result = await requestCurrentCoordinates(okNav, true);
    assert.deepEqual(result, {
      ok: true,
      lng: 9.9937,
      lat: 53.5511,
    });
  });
});

describe('UI sheet, banner, and GPS camera state transitions', () => {
  it('enforces >= 44 dp minimum touch target constant and drives banner/inspector/modal states', () => {
    assert.ok(MIN_TOUCH_TARGET_DP >= 44);

    let state: AppState = appReducer(initialAppState, {
      type: 'CONFIG_LOADED',
      config: SAMPLE_CONFIG,
    });

    // First-visit disclaimer is shown initially and dismissed cleanly
    let controls = deriveMapControlsModel(state);
    assert.equal(controls.showFirstVisitDisclaimer, true);
    assert.equal(controls.disclaimerText, SAMPLE_CONFIG.disclaimerText);

    state = appReducer(state, { type: 'DISMISS_FIRST_VISIT_DISCLAIMER' });
    controls = deriveMapControlsModel(state);
    assert.equal(controls.showFirstVisitDisclaimer, false);
    // Permanent disclaimerText remains available for PolygonInspectorSheet
    assert.equal(state.config?.disclaimerText, SAMPLE_CONFIG.disclaimerText);

    // GPS LocateMe success updates cameraTarget sequence
    const prevSeq = state.cameraTarget?.seq ?? 0;
    state = appReducer(state, {
      type: 'SET_CAMERA_TARGET',
      lng: 9.998,
      lat: 53.554,
      zoom: 17,
    });
    assert.equal(state.cameraTarget?.lng, 9.998);
    assert.equal(state.cameraTarget?.lat, 53.554);
    assert.equal(state.cameraTarget?.zoom, 17);
    assert.equal(state.cameraTarget?.seq, prevSeq + 1);

    // Truncated notice and orthophoto tile fallback warning
    const f1 = makeSampleFeature('11111111-1111-4111-8111-111111111111', 5);
    const f2 = makeSampleFeature('22222222-2222-4222-8222-222222222222', 2);
    state = appReducer(state, {
      type: 'SET_VIEWPORT',
      bbox: { minLng: 9.98, minLat: 53.54, maxLng: 10.01, maxLat: 53.56 },
      zoom: 15,
    });
    state = appReducer(state, {
      type: 'VIEWPORT_FEATURES_LOADED',
      features: [f1, f2],
      truncated: true,
    });
    controls = deriveMapControlsModel(state);
    assert.equal(controls.showTruncatedNotice, true);

    state = appReducer(state, {
      type: 'SET_BASEMAP_MODE',
      mode: 'orthophoto',
    });
    assert.equal(state.basemapMode, 'orthophoto');
    state = appReducer(state, {
      type: 'TILE_LOAD_ERROR',
      reason: 'Orthophoto server returned HTTP 503',
    });
    controls = deriveMapControlsModel(state);
    assert.equal(controls.basemapMode, 'osm');
    assert.equal(controls.tileWarning, 'Orthophoto server returned HTTP 503');

    // Overlap cycling 1 / 2 -> 2 / 2 -> 1 / 2 and anonymous vote inline auth modal
    state = appReducer(state, {
      type: 'SELECT_FEATURES_AT_TAP',
      featureIds: [f1.id, f2.id],
    });
    assert.equal(state.selectedFeatureId, f1.id);
    assert.equal(state.overlapIndex, 0);

    state = appReducer(state, { type: 'CYCLE_OVERLAP_FEATURE' });
    assert.equal(state.selectedFeatureId, f2.id);
    assert.equal(state.overlapIndex, 1);

    state = appReducer(state, {
      type: 'CAST_VOTE',
      polygonId: f2.id,
      value: 1,
    });
    const authModal = deriveAuthModalModel(state);
    assert.equal(authModal.visible, true);
    assert.equal(authModal.hasPendingIntent, true);

    // Drawing toolbar bow-tie self-intersection guidance
    state = appReducer(state, { type: 'CLOSE_AUTH_MODAL' });
    state = appReducer(state, { type: 'START_DRAW' });
    state = appReducer(state, { type: 'ADD_VERTEX', point: [9.993, 53.551] });
    state = appReducer(state, { type: 'ADD_VERTEX', point: [9.994, 53.552] });
    state = appReducer(state, { type: 'ADD_VERTEX', point: [9.994, 53.551] });
    state = appReducer(state, { type: 'ADD_VERTEX', point: [9.993, 53.552] });
    const toolbar = deriveDrawingToolbarModel(state);
    assert.equal(toolbar.visible, true);
    assert.notEqual(toolbar.crossingPoint, null);
    assert.equal(toolbar.canSubmit, false);
  });
});
