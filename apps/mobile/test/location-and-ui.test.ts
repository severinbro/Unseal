import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ApiError,
  type PolygonFeature,
  type RuntimeConfig,
} from '@entsiegelung/shared';

import { PpgisApiClient, type FetchLike } from '../src/api/client';
import {
  BUILTIN_DISCLAIMER_DE,
  DEFAULT_LOCALE,
  getTranslations,
  localizeDisclaimerText,
  localizeError,
  localizeSystemNotice,
} from '../src/i18n/translations';
import type { LocateMeResult } from '../src/location/locateMe.types';
import { createMemorySessionStorage } from '../src/storage/tokenStorage';
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
  deriveInspectorOverviewMeta,
  deriveMapControlsModel,
  formatInspectorDate,
  MIN_TOUCH_TARGET_DP,
} from '../src/state/viewModels';
import {
  deriveResponsiveLayout,
  formatRecoveryCodeBlocks,
} from '../src/theme/tokens';

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
    'Community unsealing suggestions - non-binding public input, regardless of property ownership.',
  abuseContact: 'moderation@example.org',
  privacyPolicyUrl: 'https://maps.example.org/auth/privacy',
  apkDownloadUrl: 'https://maps.example.org/downloads/unseal.apk',
  authCaptchaRequired: false,
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
      status: 'proposed',
      finishedAt: null,
      note: 'Paved corner',
      areaM2: 220.4,
      municipalityAgs: '02000000',
      municipalityName: 'Hamburg',
      municipalityMaxScore: Math.max(score, 3),
      municipalityNormalizedScore: score > 0 ? 1 : 0,
      photoCount: 0,
      commentCount: 0,
      authorPseudonym: 'citizen_a',
      authorIsNewUser: true,
      authorLastLoginAt: '2026-11-14T08:30:00.000Z',
      upvotes: score > 0 ? score : 0,
      downvotes: score < 0 ? Math.abs(score) : 0,
      score,
      myVote: 0,
      flagCount: 0,
      isFlagged: false,
      myFlag: false,
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

  it('returns { ok: false, reason } without throwing on permission denied (code 1) in default German and optional English', async () => {
    const deniedNav: WebNavigatorLike = {
      geolocation: {
        getCurrentPosition(_onSuccess, onError) {
          onError?.({ code: 1, message: 'User denied Geolocation' });
        },
      },
    };

    const resultDe = await requestCurrentCoordinates(deniedNav, true);
    assert.equal(resultDe.ok, false);
    if (!resultDe.ok) {
      assert.match(resultDe.reason, /Standortberechtigung/i);
    }

    const resultEn = await requestCurrentCoordinates(deniedNav, true, 'en');
    assert.equal(resultEn.ok, false);
    if (!resultEn.ok) {
      assert.match(resultEn.reason, /permission/i);
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
      assert.match(unavailableResult.reason, /nicht verfügbar/i);
    }

    const unavailableResultEn = await requestCurrentCoordinates(
      unavailableNav,
      true,
      'en',
    );
    assert.equal(unavailableResultEn.ok, false);
    if (!unavailableResultEn.ok) {
      assert.match(unavailableResultEn.reason, /unavailable/i);
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
      assert.match(timeoutResult.reason, /Zeitüberschreitung/i);
    }

    const timeoutResultEn = await requestCurrentCoordinates(
      timeoutNav,
      true,
      'en',
    );
    assert.equal(timeoutResultEn.ok, false);
    if (!timeoutResultEn.ok) {
      assert.match(timeoutResultEn.reason, /time/i);
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
      assert.match(thrownResult.reason, /SecurityError|Standort/i);
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

  it('refines coarse initial GeoIP fix (e.g. Frankfurt hub) via watchPosition until precise user GPS/Wi-Fi fix arrives', async () => {
    let clearedId: number | null = null;
    let capturedMaxAge: number | undefined;
    const refiningNav: WebNavigatorLike = {
      geolocation: {
        getCurrentPosition() {
          assert.fail('watchPosition should be preferred when available');
        },
        watchPosition(onSuccess, _onError, options) {
          capturedMaxAge = options?.maximumAge;
          // 1. Browser immediately emits coarse ISP/GeoIP fix in Frankfurt (±25 km)
          setTimeout(() => {
            onSuccess({
              coords: {
                longitude: 8.6821,
                latitude: 50.1109,
                accuracy: 25_000,
              },
            });
          }, 5);
          // 2. Moments later, GNSS/Wi-Fi locks onto actual user position in Mainz (±18 m)
          setTimeout(() => {
            onSuccess({
              coords: {
                longitude: 8.2739,
                latitude: 49.9989,
                accuracy: 18,
              },
            });
          }, 20);
          return 42;
        },
        clearWatch(id) {
          clearedId = id;
        },
      },
    };

    const result = await requestCurrentCoordinates(
      refiningNav,
      true,
      'de',
      200,
    );
    assert.equal(capturedMaxAge, 0);
    assert.equal(clearedId, 42);
    assert.deepEqual(result, {
      ok: true,
      lng: 8.2739,
      lat: 49.9989,
      accuracyMeters: 18,
    });
  });

  it('returns best available fix with accuracyMeters after refinement window if only coarse GeoIP is available', async () => {
    let clearedId: number | null = null;
    const coarseOnlyNav: WebNavigatorLike = {
      geolocation: {
        getCurrentPosition() {},
        watchPosition(onSuccess) {
          setTimeout(() => {
            onSuccess({
              coords: {
                longitude: 8.6821,
                latitude: 50.1109,
                accuracy: 18_000,
              },
            });
          }, 5);
          return 77;
        },
        clearWatch(id) {
          clearedId = id;
        },
      },
    };

    const result = await requestCurrentCoordinates(
      coarseOnlyNav,
      true,
      'de',
      40,
    );
    assert.equal(clearedId, 77);
    assert.deepEqual(result, {
      ok: true,
      lng: 8.6821,
      lat: 50.1109,
      accuracyMeters: 18_000,
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
    assert.equal(toolbar.collapsed, false);
    assert.notEqual(toolbar.crossingPoint, null);
    assert.equal(toolbar.canSubmit, false);

    // Collapsing and expanding the new-polygon form preserves draft metadata & vertices
    state = appReducer(state, { type: 'START_DRAW' });
    state = appReducer(state, { type: 'ADD_VERTEX', point: [8.2738, 49.9988] });
    state = appReducer(state, { type: 'ADD_VERTEX', point: [8.274, 49.9988] });
    state = appReducer(state, { type: 'ADD_VERTEX', point: [8.274, 49.999] });
    state = appReducer(state, { type: 'ADVANCE_TO_DETAILS' });
    state = appReducer(state, {
      type: 'SET_DRAFT_META',
      surfaceType: 'concrete',
      note: 'Versiegelter Vorplatz am Dom',
    });
    state = appReducer(state, {
      type: 'SET_DRAWING_SHEET_COLLAPSED',
      collapsed: true,
    });
    let detailsToolbar = deriveDrawingToolbarModel(state);
    assert.equal(detailsToolbar.visible, true);
    assert.equal(detailsToolbar.collapsed, true);
    assert.equal(detailsToolbar.step, 'details');
    assert.equal(detailsToolbar.surfaceType, 'concrete');
    assert.equal(detailsToolbar.note, 'Versiegelter Vorplatz am Dom');

    // Auto-expands if submit error arrives so alert is never hidden
    state = appReducer(state, {
      type: 'SUBMIT_ERROR_PRESERVE_DRAFT',
      message: 'Network timeout',
    });
    detailsToolbar = deriveDrawingToolbarModel(state);
    assert.equal(detailsToolbar.collapsed, false);
  });

  it('adapts responsive layout across phone (390x844), tablet (768x1024), and desktop (1440x900) and formats recovery codes', () => {
    const mobile = deriveResponsiveLayout(390, 844);
    assert.equal(mobile.tier, 'compact');
    assert.equal(mobile.isCompact, true);
    assert.equal(mobile.isDocked, false);
    assert.ok(mobile.drawingSheetMaxHeightPx <= Math.round(844 * 0.56));

    const tablet = deriveResponsiveLayout(768, 1024);
    assert.equal(tablet.tier, 'medium');
    assert.equal(tablet.isCompact, false);
    assert.equal(tablet.isDocked, true);
    assert.equal(tablet.dockWidth, 368);

    const desktop = deriveResponsiveLayout(1440, 900);
    assert.equal(desktop.tier, 'expanded');
    assert.equal(desktop.isCompact, false);
    assert.equal(desktop.isDocked, true);
    assert.equal(desktop.dockWidth, 404);

    assert.equal(
      formatRecoveryCodeBlocks('a1b2c3d4e5f60718293a4b5c6d7e8f90'),
      'A1B2-C3D4-E5F6-0718-293A-4B5C-6D7E-8F90',
    );
  });

  it('invokes browser fetch without binding PpgisApiClient as `this` (preventing Window Illegal invocation)', async () => {
    const strictBrowserFetch: FetchLike = async function (
      this: unknown,
    ): Promise<Response> {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError(
          "Failed to execute 'fetch' on 'Window': Illegal invocation",
        );
      }
      return new Response(JSON.stringify(SAMPLE_CONFIG), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = new PpgisApiClient(
      'http://127.0.0.1:3000',
      createMemorySessionStorage(),
      strictBrowserFetch,
    );
    const loadedConfig = await client.getConfig();
    assert.equal(loadedConfig.osmStyleUrl, SAMPLE_CONFIG.osmStyleUrl);
  });
});

describe('German default localization and DE <-> EN switching', () => {
  it('defaults to German (de) across controls, disclaimers, drawing validation, auth modal, and API errors, and switches cleanly to English (en)', () => {
    assert.equal(DEFAULT_LOCALE, 'de');
    assert.equal(initialAppState.locale, 'de');

    let state: AppState = appReducer(initialAppState, {
      type: 'CONFIG_LOADED',
      config: SAMPLE_CONFIG,
    });

    const controlsDe = deriveMapControlsModel(state);
    assert.equal(controlsDe.locale, 'de');
    assert.equal(controlsDe.accountLabel, 'Anmelden');
    assert.equal(controlsDe.apkDownloadUrl, 'https://maps.example.org/downloads/unseal.apk');
    assert.match(controlsDe.zoomInPromptText, /heranzoomen/);
    assert.equal(getTranslations('de').inspector.statusInProgressBadge, '⟳ Wird entsiegelt');
    assert.equal(getTranslations('en').inspector.statusInProgressBadge, '⟳ In progress');
    assert.equal(getTranslations('en').controls.apkDownloadFull, 'Download Android APK');
    assert.equal(getTranslations('de').about.title, 'Über Unseal');

    // Built-in English server disclaimer translates to German in 'de', while custom operator overrides stay verbatim
    assert.equal(
      localizeDisclaimerText(SAMPLE_CONFIG.disclaimerText, 'de'),
      BUILTIN_DISCLAIMER_DE,
    );
    assert.equal(
      localizeDisclaimerText(SAMPLE_CONFIG.disclaimerText, 'en'),
      SAMPLE_CONFIG.disclaimerText,
    );
    assert.equal(
      localizeDisclaimerText('Bezirksamt Altona - Bürgerbeteiligung 2026', 'de'),
      'Bezirksamt Altona - Bürgerbeteiligung 2026',
    );
    assert.equal(
      localizeDisclaimerText('Custom Municipal Notice', 'en'),
      'Custom Municipal Notice',
    );

    // Orthophoto fallback system notice localization
    assert.match(
      localizeSystemNotice(
        'Aerial orthophoto tiles failed to load (HTTP 503); reverted to OpenStreetMap basemap.',
        'de',
      ) ?? '',
      /Luftbild-Kacheln konnten nicht geladen werden \(HTTP 503\)/,
    );

    // Drawing toolbar labels & geometry validation messages in German vs English
    state = appReducer(state, { type: 'START_DRAW' });
    state = appReducer(state, { type: 'ADD_VERTEX', point: [9.993, 53.551] });
    state = appReducer(state, { type: 'ADD_VERTEX', point: [9.994, 53.552] });
    state = appReducer(state, { type: 'ADD_VERTEX', point: [9.994, 53.551] });
    state = appReducer(state, { type: 'ADD_VERTEX', point: [9.993, 53.552] });

    const toolbarDe = deriveDrawingToolbarModel(state);
    assert.equal(toolbarDe.undoLabel, 'Punkt zurück');
    assert.ok(
      toolbarDe.validationErrors.some((msg) =>
        msg.includes('Polygonkanten dürfen sich nicht kreuzen'),
      ),
    );

    state = appReducer(state, { type: 'SET_LOCALE', locale: 'en' });
    assert.equal(deriveMapControlsModel(state).accountLabel, 'Sign in');
    const toolbarEn = deriveDrawingToolbarModel(state);
    assert.equal(toolbarEn.undoLabel, 'Undo vertex');
    assert.ok(
      toolbarEn.validationErrors.some((msg) =>
        msg.includes('Polygon edges must not cross'),
      ),
    );

    // Switch back to German and test closed-ring undo label + session expiry message switching
    state = appReducer(state, { type: 'SET_LOCALE', locale: 'de' });
    state = appReducer(state, { type: 'START_DRAW' });
    state = appReducer(state, { type: 'ADD_VERTEX', point: [9.9935, 53.551] });
    state = appReducer(state, { type: 'ADD_VERTEX', point: [9.9937, 53.551] });
    state = appReducer(state, {
      type: 'ADD_VERTEX',
      point: [9.9937, 53.55115],
    });
    state = appReducer(state, { type: 'CLOSE_RING' });
    assert.equal(deriveDrawingToolbarModel(state).undoLabel, 'Ring öffnen');

    state = appReducer(state, { type: 'SUBMIT_DRAFT' });
    assert.match(
      deriveAuthModalModel(state).pendingIntentSummary ?? '',
      /Flächenentwurf bleibt gespeichert/,
    );

    state = appReducer(state, { type: 'SESSION_EXPIRED' });
    assert.match(deriveAuthModalModel(state).errorMessage ?? '', /Sitzung ist abgelaufen/);

    state = appReducer(state, { type: 'SET_LOCALE', locale: 'en' });
    assert.match(deriveAuthModalModel(state).errorMessage ?? '', /session expired/i);

    // Surface type taxonomy, exact "GPS verified" badge parity, and structured ApiError localization
    assert.equal(getTranslations('de').surfaces.pavers.label, 'Pflaster');
    assert.equal(getTranslations('en').surfaces.pavers.label, 'Pavers');
    assert.equal(getTranslations('de').inspector.gpsVerifiedBadge, 'GPS verified');
    assert.equal(getTranslations('en').inspector.gpsVerifiedBadge, 'GPS verified');
    assert.match(getTranslations('de').controls.gnssA11y, /GNSS/);
    assert.match(getTranslations('en').controls.gnssA11y, /GNSS/);

    const credErr = new ApiError(
      401,
      'AUTH_INVALID_CREDENTIALS',
      'Invalid pseudonym or password.',
    );
    assert.equal(
      localizeError(credErr, 'Fallback', 'de'),
      'Ungültiges Pseudonym, E-Mail oder Passwort.',
    );
    assert.equal(
      localizeError(credErr, 'Fallback', 'en'),
      'Invalid pseudonym or password.',
    );

    const unverifiedErr = new ApiError(
      403,
      'AUTH_EMAIL_UNVERIFIED',
      'Please confirm your email address first.',
    );
    assert.match(localizeError(unverifiedErr, 'Fallback', 'de'), /E-Mail-Adresse/);

    // Carbon error codes & validation messages localize cleanly to German
    assert.match(
      localizeError(
        new ApiError(409, 'POLYGON_OVERLAP', 'Overlaps existing polygon.'),
        'Fallback',
        'de',
      ),
      /überlappt/i,
    );
    assert.match(
      localizeError(
        new ApiError(422, 'LAND_COVER_EXCLUDED', 'Water or forest.'),
        'Fallback',
        'de',
      ),
      /Gewässern|Wald|Gebäuden/,
    );
    assert.match(
      localizeError(
        new ApiError(422, 'OUTSIDE_JURISDICTION', 'Outside municipality.'),
        'Fallback',
        'de',
      ),
      /Kartierungsgebiets/,
    );
    assert.match(
      localizeError(
        new ApiError(422, 'AUTH_DISPOSABLE_EMAIL', 'Disposable domain.'),
        'Fallback',
        'de',
      ),
      /Wegwerf-E-Mail/,
    );
    assert.match(
      localizeError(
        new Error(
          'Polygon shape is too thin or irregular (compactness 0.021 is below 0.05).',
        ),
        'Fallback',
        'de',
      ),
      /Kompaktheit 0\.021 liegt unter 0\.05/,
    );

    // Inspector overview metadata formatting (entry date, new contributor badge, last login, Needs review badge)
    assert.equal(formatInspectorDate('2026-11-14T13:20:00.000Z', 'de'), '14.11.2026');
    assert.equal(formatInspectorDate('2026-11-14T13:20:00.000Z', 'en'), '2026-11-14');
    assert.equal(formatInspectorDate(null, 'de'), null);

    const flaggedNewFeature: PolygonFeature = {
      ...makeSampleFeature('33333333-3333-4333-8333-333333333333', 0),
      properties: {
        ...makeSampleFeature('33333333-3333-4333-8333-333333333333', 0).properties,
        authorIsNewUser: true,
        authorLastLoginAt: '2026-11-14T08:30:00.000Z',
        flagCount: 2,
        isFlagged: true,
        myFlag: true,
      },
    };
    const metaDe = deriveInspectorOverviewMeta(flaggedNewFeature, 'de');
    assert.equal(metaDe.displayAuthorHandle, 'citizen_a');
    assert.equal(metaDe.newContributorBadgeText, 'Neuer Beitragender');
    assert.equal(metaDe.entryDateText, '12.11.2026');
    assert.equal(metaDe.authorLastLoginText, '14.11.2026');
    assert.equal(metaDe.needsReviewBadgeText, 'Prüfbedarf (2)');
    assert.equal(metaDe.canFlagOrUnflag, true);

    const metaEn = deriveInspectorOverviewMeta(
      {
        ...flaggedNewFeature,
        properties: {
          ...flaggedNewFeature.properties,
          authorPseudonym: 'deleted',
          authorIsNewUser: false,
          authorLastLoginAt: null,
          isAuthor: true,
        },
      },
      'en',
    );
    assert.equal(metaEn.displayAuthorHandle, 'deleted');
    assert.equal(metaEn.newContributorBadgeText, null);
    assert.equal(metaEn.entryDateText, '2026-11-12');
    assert.equal(metaEn.authorLastLoginText, 'Unknown');
    assert.equal(metaEn.needsReviewBadgeText, 'Needs review (2)');
    assert.equal(metaEn.canFlagOrUnflag, false);
  });
});
