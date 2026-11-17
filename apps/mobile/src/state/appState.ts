import {
  ApiError,
  checkBboxSpan,
  closeRingIfNeeded,
  computeMunicipalityNormalizedScore,
  dedupeConsecutivePoints,
  GEOMETRY_LIMITS,
  PHOTO_LIMITS,
  validateDraftPolygon,
  type AuthUser,
  type BboxBounds,
  type CreatePolygonRequest,
  type FlagPolygonResponse,
  type PolygonFeature,
  type PolygonFilter,
  type RuntimeConfig,
  type SurfaceType,
  type VoteResponse,
} from '@entsiegelung/shared';

import type { UploadableFileInput } from '../api/client';
import {
  DEFAULT_LOCALE,
  getTranslations,
  translateValidationMessage,
  type Locale,
} from '../i18n/translations';
import {
  clampPolygonOpacity,
  DEFAULT_POLYGON_OPACITY,
} from '../map/styleBuilder';
import {
  isThemePreference,
  type ColorScheme,
  type ThemePreference,
} from '../theme/tokens';

export { DEFAULT_LOCALE, type Locale } from '../i18n/translations';
export type { ColorScheme, ThemePreference };

export type ConfigStatus = 'loading' | 'ready' | 'error';
export type InteractionMode = 'browse' | 'drawing';
export type DrawingStep = 'geometry' | 'details';
export type BasemapMode = 'osm' | 'orthophoto';
export type AuthModalView =
  | 'login'
  | 'register'
  | 'verify_pending'
  | 'recover'
  | 'account';

export const MAX_DRAFT_PHOTOS = PHOTO_LIMITS.MAX_PHOTOS_PER_POLYGON;

export interface DraftPhotoAttachment {
  id: string;
  previewUri: string;
  file: UploadableFileInput;
}

export interface ViewportState {
  bbox: BboxBounds;
  zoom: number;
}

export interface CameraTarget {
  lng: number;
  lat: number;
  zoom?: number;
  bounds?: BboxBounds;
  seq: number;
}

export type PendingIntent =
  | {
      type: 'SUBMIT_DRAFT';
      payload: CreatePolygonRequest;
      photos: readonly UploadableFileInput[];
    }
  | {
      type: 'CAST_VOTE';
      polygonId: string;
      value: 1 | -1;
    };

export interface AppState {
  locale: Locale;
  themePreference: ThemePreference;
  configStatus: ConfigStatus;
  config: RuntimeConfig | null;
  configError: string | null;
  firstVisitDisclaimerDismissed: boolean;
  basemapMode: BasemapMode;
  polygonOpacity: number;
  polygonFilter: PolygonFilter;
  highlightMineOnly: boolean;
  tileWarning: string | null;
  viewport: ViewportState | null;
  spanTooWide: boolean;
  viewportRefreshSeq: number;
  cameraTarget: CameraTarget | null;
  features: PolygonFeature[];
  truncated: boolean;
  overlappingFeatureIds: string[];
  overlapIndex: number;
  selectedFeatureId: string | null;
  mode: InteractionMode;
  drawingStep: DrawingStep;
  drawingSheetCollapsed: boolean;
  draftVertices: [number, number][];
  isRingClosed: boolean;
  draftSurfaceType: SurfaceType;
  draftNote: string;
  draftPhotos: DraftPhotoAttachment[];
  confirmingDiscardDraft: boolean;
  isSubmittingDraft: boolean;
  draftSubmitError: string | null;
  currentUser: AuthUser | null;
  authModalOpen: boolean;
  authModalView: AuthModalView;
  pendingVerificationEmail: string | null;
  pendingVerificationPseudonym: string | null;
  authError: string | null;
  pendingIntent: PendingIntent | null;
}

export type AppAction =
  | { type: 'SET_LOCALE'; locale: Locale }
  | { type: 'SET_THEME_PREFERENCE'; preference: ThemePreference }
  | { type: 'CONFIG_LOADING' }
  | {
      type: 'CONFIG_LOADED';
      config: RuntimeConfig;
      savedViewport?: ViewportState | null;
    }
  | { type: 'CONFIG_ERROR'; message: string }
  | { type: 'DISMISS_FIRST_VISIT_DISCLAIMER' }
  | { type: 'DISMISS_TILE_WARNING' }
  | { type: 'SET_BASEMAP_MODE'; mode: BasemapMode }
  | { type: 'SET_POLYGON_OPACITY'; opacity: number }
  | { type: 'SET_POLYGON_FILTER'; filter: PolygonFilter }
  | { type: 'SET_HIGHLIGHT_MINE_ONLY'; enabled: boolean }
  | { type: 'TOGGLE_HIGHLIGHT_MINE_ONLY' }
  | { type: 'TILE_LOAD_ERROR'; reason?: string }
  | {
      type: 'SET_CAMERA_TARGET';
      lng: number;
      lat: number;
      zoom?: number;
      bounds?: BboxBounds;
    }
  | { type: 'SET_VIEWPORT'; bbox: BboxBounds; zoom: number }
  | {
      type: 'VIEWPORT_FEATURES_LOADED';
      features: PolygonFeature[];
      truncated: boolean;
    }
  | { type: 'REFRESH_VIEWPORT_FEATURES' }
  | { type: 'START_DRAW' }
  | { type: 'ADD_VERTEX'; point: [number, number] }
  | { type: 'UNDO_VERTEX' }
  | { type: 'CLOSE_RING' }
  | { type: 'ADVANCE_TO_DETAILS' }
  | { type: 'BACK_TO_GEOMETRY' }
  | { type: 'SET_DRAWING_SHEET_COLLAPSED'; collapsed: boolean }
  | { type: 'SET_DRAFT_META'; surfaceType?: SurfaceType; note?: string }
  | { type: 'ADD_DRAFT_PHOTO'; photo: DraftPhotoAttachment }
  | { type: 'ADD_DRAFT_PHOTOS'; photos: readonly DraftPhotoAttachment[] }
  | { type: 'REMOVE_DRAFT_PHOTO'; photoId: string }
  | { type: 'REQUEST_DISCARD_DRAFT' }
  | { type: 'CANCEL_DISCARD_DRAFT' }
  | { type: 'CONFIRM_DISCARD_DRAFT' }
  | { type: 'SUBMIT_DRAFT' }
  | { type: 'SUBMIT_ERROR_PRESERVE_DRAFT'; message: string }
  | { type: 'POLYGON_CREATED'; feature: PolygonFeature }
  | { type: 'POLYGON_UPDATED'; feature: PolygonFeature }
  | { type: 'POLYGON_PHOTO_COUNT_SET'; polygonId: string; photoCount: number }
  | {
      type: 'POLYGON_COMMENT_COUNT_SET';
      polygonId: string;
      commentCount: number;
    }
  | { type: 'POLYGON_DELETED'; polygonId: string }
  | { type: 'SELECT_FEATURES_AT_TAP'; featureIds: readonly string[] }
  | { type: 'CYCLE_OVERLAP_FEATURE' }
  | { type: 'CAST_VOTE'; polygonId: string; value: 1 | -1 }
  | { type: 'VOTE_UPDATED'; vote: VoteResponse }
  | { type: 'POLYGON_FLAG_UPDATED'; flag: FlagPolygonResponse }
  | {
      type: 'OPEN_AUTH_MODAL';
      view?: AuthModalView;
    }
  | {
      type: 'SET_AUTH_MODAL_VIEW';
      view: AuthModalView;
    }
  | {
      type: 'REGISTRATION_VERIFICATION_SENT';
      email: string;
      pseudonym: string;
    }
  | { type: 'CLOSE_AUTH_MODAL' }
  | { type: 'AUTH_ERROR'; message: string }
  | { type: 'AUTH_SUCCEEDED'; user: AuthUser }
  | { type: 'SESSION_EXPIRED' }
  | { type: 'LOGOUT_SUCCEEDED' }
  | { type: 'ACCOUNT_DELETED'; purgedContent?: boolean }
  | { type: 'CLEAR_PENDING_INTENT' };

export const initialAppState: AppState = {
  locale: DEFAULT_LOCALE,
  themePreference: 'light',
  configStatus: 'loading',
  config: null,
  configError: null,
  firstVisitDisclaimerDismissed: true,
  basemapMode: 'osm',
  polygonOpacity: DEFAULT_POLYGON_OPACITY,
  polygonFilter: 'all',
  highlightMineOnly: false,
  tileWarning: null,
  viewport: null,
  spanTooWide: false,
  viewportRefreshSeq: 0,
  cameraTarget: null,
  features: [],
  truncated: false,
  overlappingFeatureIds: [],
  overlapIndex: 0,
  selectedFeatureId: null,
  mode: 'browse',
  drawingStep: 'geometry',
  drawingSheetCollapsed: false,
  draftVertices: [],
  isRingClosed: false,
  draftSurfaceType: 'asphalt',
  draftNote: '',
  draftPhotos: [],
  confirmingDiscardDraft: false,
  isSubmittingDraft: false,
  draftSubmitError: null,
  currentUser: null,
  authModalOpen: false,
  authModalView: 'login',
  pendingVerificationEmail: null,
  pendingVerificationPseudonym: null,
  authError: null,
  pendingIntent: null,
};

function isBboxSpanTooWide(bbox: BboxBounds, maxSpanDeg: number): boolean {
  try {
    checkBboxSpan(bbox, maxSpanDeg);
    return false;
  } catch (err: unknown) {
    if (err instanceof ApiError && err.code === 'BBOX_TOO_LARGE') {
      return true;
    }
    return true;
  }
}

function dedupeStrings(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (!seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function sortFeaturesCanonical(
  features: readonly PolygonFeature[],
): PolygonFeature[] {
  return [...features].sort((a, b) => {
    if (b.properties.score !== a.properties.score) {
      return b.properties.score - a.properties.score;
    }
    if (b.properties.createdAt !== a.properties.createdAt) {
      return b.properties.createdAt.localeCompare(a.properties.createdAt);
    }
    return a.id.localeCompare(b.id);
  });
}

function recomputeMunicipalityScoresForAgs(
  prevFeatures: readonly PolygonFeature[],
  nextFeatures: readonly PolygonFeature[],
  targetAgs: string | null,
): PolygonFeature[] {
  if (targetAgs === null) {
    let visibleMax = 0;
    for (const f of nextFeatures) {
      if (
        f.properties.municipalityAgs === null &&
        f.properties.status === 'proposed' &&
        f.properties.score > visibleMax
      ) {
        visibleMax = f.properties.score;
      }
    }
    return nextFeatures.map((f) => {
      if (f.properties.municipalityAgs !== null) {
        return f;
      }
      return {
        ...f,
        properties: {
          ...f.properties,
          municipalityMaxScore: visibleMax,
          municipalityNormalizedScore: computeMunicipalityNormalizedScore(
            f.properties.score,
            f.properties.status,
            null,
            visibleMax,
          ),
        },
      };
    });
  }

  let prevReportedMax = 0;
  let prevVisibleMax = 0;
  for (const f of prevFeatures) {
    if (f.properties.municipalityAgs !== targetAgs) {
      continue;
    }
    if (f.properties.municipalityMaxScore > prevReportedMax) {
      prevReportedMax = f.properties.municipalityMaxScore;
    }
    if (
      f.properties.status === 'proposed' &&
      f.properties.score > prevVisibleMax
    ) {
      prevVisibleMax = f.properties.score;
    }
  }

  const offScreenBaseline =
    prevReportedMax > prevVisibleMax ? prevReportedMax : 0;

  let nextVisibleMax = 0;
  for (const f of nextFeatures) {
    if (
      f.properties.municipalityAgs === targetAgs &&
      f.properties.status === 'proposed' &&
      f.properties.score > nextVisibleMax
    ) {
      nextVisibleMax = f.properties.score;
    }
  }

  const nextMunicipalityMax = Math.max(offScreenBaseline, nextVisibleMax, 0);

  return nextFeatures.map((f) => {
    if (f.properties.municipalityAgs !== targetAgs) {
      return f;
    }
    return {
      ...f,
      properties: {
        ...f.properties,
        municipalityMaxScore: nextMunicipalityMax,
        municipalityNormalizedScore: computeMunicipalityNormalizedScore(
          f.properties.score,
          f.properties.status,
          targetAgs,
          nextMunicipalityMax,
        ),
      },
    };
  });
}

function buildDraftPolygonPayload(state: AppState): CreatePolygonRequest {
  const deduped = dedupeConsecutivePoints(state.draftVertices);
  const closedRing = closeRingIfNeeded(deduped);
  const trimmedNote = state.draftNote.trim();

  return {
    geometry: {
      type: 'Polygon',
      coordinates: [closedRing],
    },
    surfaceType: state.draftSurfaceType,
    ...(trimmedNote.length > 0 ? { note: trimmedNote } : {}),
  };
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_LOCALE': {
      if (action.locale === state.locale) {
        return state;
      }
      const prevExpiredMsg = getTranslations(state.locale).auth.sessionExpired;
      const nextExpiredMsg = getTranslations(action.locale).auth.sessionExpired;
      return {
        ...state,
        locale: action.locale,
        authError:
          state.authError === prevExpiredMsg ? nextExpiredMsg : state.authError,
      };
    }

    case 'SET_THEME_PREFERENCE': {
      if (
        !isThemePreference(action.preference) ||
        action.preference === state.themePreference
      ) {
        return state;
      }
      return {
        ...state,
        themePreference: action.preference,
      };
    }

    case 'CONFIG_LOADING': {
      return {
        ...state,
        configStatus: 'loading',
        configError: null,
      };
    }

    case 'CONFIG_LOADED': {
      const hasOrthophoto = action.config.orthophoto !== null;
      const nextBasemapMode: BasemapMode =
        !hasOrthophoto && state.basemapMode === 'orthophoto'
          ? 'osm'
          : state.basemapMode;
      const saved = action.savedViewport ?? null;
      const nextCameraTarget: CameraTarget =
        state.cameraTarget ??
        (saved !== null
          ? {
              lng: (saved.bbox.minLng + saved.bbox.maxLng) / 2,
              lat: (saved.bbox.minLat + saved.bbox.maxLat) / 2,
              zoom: saved.zoom,
              bounds: saved.bbox,
              seq: 1,
            }
          : {
              lng: action.config.initialView.lng,
              lat: action.config.initialView.lat,
              zoom: action.config.initialView.zoom,
              seq: 1,
            });

      return {
        ...state,
        configStatus: 'ready',
        config: action.config,
        configError: null,
        basemapMode: nextBasemapMode,
        cameraTarget: nextCameraTarget,
      };
    }

    case 'CONFIG_ERROR': {
      return {
        ...state,
        configStatus: 'error',
        configError: action.message,
      };
    }

    case 'DISMISS_FIRST_VISIT_DISCLAIMER': {
      return {
        ...state,
        firstVisitDisclaimerDismissed: true,
      };
    }

    case 'DISMISS_TILE_WARNING': {
      return {
        ...state,
        tileWarning: null,
      };
    }

    case 'SET_BASEMAP_MODE': {
      if (
        action.mode === 'orthophoto' &&
        (state.config === null || state.config.orthophoto === null)
      ) {
        return state;
      }
      return {
        ...state,
        basemapMode: action.mode,
        tileWarning: action.mode === 'orthophoto' ? null : state.tileWarning,
      };
    }

    case 'SET_POLYGON_OPACITY': {
      const nextOpacity = clampPolygonOpacity(action.opacity);
      if (state.polygonOpacity === nextOpacity) {
        return state;
      }
      return {
        ...state,
        polygonOpacity: nextOpacity,
      };
    }

    case 'SET_POLYGON_FILTER': {
      if (state.polygonFilter === action.filter) {
        return state;
      }
      return {
        ...state,
        polygonFilter: action.filter,
        viewportRefreshSeq: state.viewportRefreshSeq + 1,
      };
    }

    case 'SET_HIGHLIGHT_MINE_ONLY': {
      const nextEnabled = state.currentUser !== null ? action.enabled : false;
      if (state.highlightMineOnly === nextEnabled) {
        return state;
      }
      return {
        ...state,
        highlightMineOnly: nextEnabled,
      };
    }

    case 'TOGGLE_HIGHLIGHT_MINE_ONLY': {
      if (state.currentUser === null) {
        return state.highlightMineOnly
          ? { ...state, highlightMineOnly: false }
          : state;
      }
      return {
        ...state,
        highlightMineOnly: !state.highlightMineOnly,
      };
    }

    case 'TILE_LOAD_ERROR': {
      const defaultFallback =
        state.locale === 'de'
          ? 'Luftbild-Kacheln konnten nicht geladen werden; zurück zur OpenStreetMap-Straßenkarte gewechselt.'
          : 'Aerial orthophoto tiles failed to load; reverted to OpenStreetMap basemap.';
      return {
        ...state,
        basemapMode: 'osm',
        tileWarning: action.reason ?? defaultFallback,
      };
    }

    case 'SET_CAMERA_TARGET': {
      const nextSeq = (state.cameraTarget?.seq ?? 0) + 1;
      const target: CameraTarget = {
        lng: action.lng,
        lat: action.lat,
        ...(action.zoom !== undefined ? { zoom: action.zoom } : {}),
        ...(action.bounds !== undefined ? { bounds: action.bounds } : {}),
        seq: nextSeq,
      };
      return {
        ...state,
        cameraTarget: target,
      };
    }

    case 'SET_VIEWPORT': {
      const maxSpan =
        state.config?.limits.maxBboxSpanDeg ?? GEOMETRY_LIMITS.MAX_BBOX_SPAN_DEG;
      const spanTooWide = isBboxSpanTooWide(action.bbox, maxSpan);
      return {
        ...state,
        viewport: {
          bbox: action.bbox,
          zoom: action.zoom,
        },
        spanTooWide,
        ...(spanTooWide ? { truncated: false } : {}),
      };
    }

    case 'VIEWPORT_FEATURES_LOADED': {
      const presentIds = new Set(action.features.map((f) => f.id));
      const survivingOverlap = state.overlappingFeatureIds.filter((id) =>
        presentIds.has(id),
      );
      const clampedIndex =
        survivingOverlap.length === 0
          ? 0
          : Math.min(state.overlapIndex, survivingOverlap.length - 1);
      const selectedFeatureId = survivingOverlap[clampedIndex] ?? null;

      return {
        ...state,
        features: action.features,
        truncated: action.truncated,
        overlappingFeatureIds: survivingOverlap,
        overlapIndex: clampedIndex,
        selectedFeatureId,
      };
    }

    case 'REFRESH_VIEWPORT_FEATURES': {
      return {
        ...state,
        viewportRefreshSeq: state.viewportRefreshSeq + 1,
      };
    }

    case 'START_DRAW': {
      return {
        ...state,
        mode: 'drawing',
        drawingStep: 'geometry',
        drawingSheetCollapsed: false,
        draftVertices: [],
        isRingClosed: false,
        draftSurfaceType: 'asphalt',
        draftNote: '',
        draftPhotos: [],
        confirmingDiscardDraft: false,
        isSubmittingDraft: false,
        draftSubmitError: null,
        overlappingFeatureIds: [],
        overlapIndex: 0,
        selectedFeatureId: null,
      };
    }

    case 'ADD_VERTEX': {
      if (
        state.mode !== 'drawing' ||
        state.drawingStep !== 'geometry' ||
        state.isRingClosed
      ) {
        return state;
      }
      return {
        ...state,
        draftVertices: [
          ...state.draftVertices,
          [action.point[0], action.point[1]],
        ],
        confirmingDiscardDraft: false,
        draftSubmitError: null,
      };
    }

    case 'UNDO_VERTEX': {
      if (state.mode !== 'drawing') {
        return state;
      }
      if (state.isRingClosed) {
        return {
          ...state,
          drawingStep: 'geometry',
          isRingClosed: false,
          confirmingDiscardDraft: false,
          draftSubmitError: null,
        };
      }
      if (state.draftVertices.length === 0) {
        return state;
      }
      return {
        ...state,
        drawingStep: 'geometry',
        draftVertices: state.draftVertices.slice(0, -1),
        confirmingDiscardDraft: false,
        draftSubmitError: null,
      };
    }

    case 'CLOSE_RING': {
      if (state.mode !== 'drawing' || state.isRingClosed) {
        return state;
      }
      const distinct = dedupeConsecutivePoints(state.draftVertices);
      if (distinct.length < GEOMETRY_LIMITS.MIN_VERTICES) {
        return {
          ...state,
          draftSubmitError: translateValidationMessage(
            `Polygon requires at least ${GEOMETRY_LIMITS.MIN_VERTICES} distinct vertices.`,
            state.locale,
          ),
        };
      }
      return {
        ...state,
        isRingClosed: true,
        confirmingDiscardDraft: false,
        draftSubmitError: null,
      };
    }

    case 'ADVANCE_TO_DETAILS': {
      if (state.mode !== 'drawing') {
        return state;
      }
      const validation = validateDraftPolygon(state.draftVertices);
      if (!validation.valid) {
        const firstError = validation.errors[0];
        return {
          ...state,
          drawingSheetCollapsed: false,
          draftSubmitError: firstError
            ? translateValidationMessage(firstError, state.locale)
            : null,
        };
      }
      return {
        ...state,
        isRingClosed: true,
        drawingStep: 'details',
        drawingSheetCollapsed: false,
        confirmingDiscardDraft: false,
        draftSubmitError: null,
      };
    }

    case 'BACK_TO_GEOMETRY': {
      if (state.mode !== 'drawing') {
        return state;
      }
      return {
        ...state,
        drawingStep: 'geometry',
        drawingSheetCollapsed: false,
        confirmingDiscardDraft: false,
        draftSubmitError: null,
      };
    }

    case 'SET_DRAWING_SHEET_COLLAPSED': {
      if (state.mode !== 'drawing' || state.drawingSheetCollapsed === action.collapsed) {
        return state;
      }
      return {
        ...state,
        drawingSheetCollapsed: action.collapsed,
      };
    }

    case 'SET_DRAFT_META': {
      return {
        ...state,
        draftSurfaceType: action.surfaceType ?? state.draftSurfaceType,
        draftNote: action.note ?? state.draftNote,
        draftSubmitError: null,
      };
    }

    case 'ADD_DRAFT_PHOTO': {
      const maxPhotos = Math.min(
        MAX_DRAFT_PHOTOS,
        PHOTO_LIMITS.MAX_PHOTOS_PER_POLYGON,
      );
      if (
        state.mode !== 'drawing' ||
        state.draftPhotos.length >= maxPhotos
      ) {
        return state;
      }
      return {
        ...state,
        draftPhotos: [...state.draftPhotos, action.photo],
        draftSubmitError: null,
      };
    }

    case 'ADD_DRAFT_PHOTOS': {
      const maxPhotos = Math.min(
        MAX_DRAFT_PHOTOS,
        PHOTO_LIMITS.MAX_PHOTOS_PER_POLYGON,
      );
      if (
        state.mode !== 'drawing' ||
        action.photos.length === 0 ||
        state.draftPhotos.length >= maxPhotos
      ) {
        return state;
      }
      const remaining = maxPhotos - state.draftPhotos.length;
      const toAppend = action.photos.slice(0, remaining);
      return {
        ...state,
        draftPhotos: [...state.draftPhotos, ...toAppend],
        draftSubmitError: null,
      };
    }

    case 'REMOVE_DRAFT_PHOTO': {
      if (state.mode !== 'drawing') {
        return state;
      }
      return {
        ...state,
        draftPhotos: state.draftPhotos.filter((p) => p.id !== action.photoId),
      };
    }

    case 'REQUEST_DISCARD_DRAFT': {
      if (state.mode !== 'drawing') {
        return state;
      }
      if (
        state.draftVertices.length === 0 &&
        state.draftNote.trim().length === 0 &&
        state.draftPhotos.length === 0
      ) {
        return {
          ...state,
          mode: 'browse',
          drawingStep: 'geometry',
          drawingSheetCollapsed: false,
          isRingClosed: false,
          confirmingDiscardDraft: false,
          isSubmittingDraft: false,
          draftSubmitError: null,
        };
      }
      return {
        ...state,
        drawingSheetCollapsed: false,
        confirmingDiscardDraft: true,
      };
    }

    case 'CANCEL_DISCARD_DRAFT': {
      return {
        ...state,
        confirmingDiscardDraft: false,
      };
    }

    case 'CONFIRM_DISCARD_DRAFT': {
      return {
        ...state,
        mode: 'browse',
        drawingStep: 'geometry',
        drawingSheetCollapsed: false,
        draftVertices: [],
        isRingClosed: false,
        draftSurfaceType: 'asphalt',
        draftNote: '',
        draftPhotos: [],
        confirmingDiscardDraft: false,
        isSubmittingDraft: false,
        draftSubmitError: null,
        pendingIntent:
          state.pendingIntent?.type === 'SUBMIT_DRAFT'
            ? null
            : state.pendingIntent,
      };
    }

    case 'SUBMIT_DRAFT': {
      if (state.mode !== 'drawing') {
        return state;
      }
      const payload = buildDraftPolygonPayload(state);
      const intent: PendingIntent = {
        type: 'SUBMIT_DRAFT',
        payload,
        photos: state.draftPhotos.map((p) => p.file),
      };

      if (state.currentUser === null) {
        return {
          ...state,
          pendingIntent: intent,
          isSubmittingDraft: false,
          draftSubmitError: null,
          authModalOpen: true,
          authModalView: 'register',
          authError: null,
        };
      }

      return {
        ...state,
        pendingIntent: intent,
        isSubmittingDraft: true,
        draftSubmitError: null,
      };
    }

    case 'SUBMIT_ERROR_PRESERVE_DRAFT': {
      return {
        ...state,
        drawingSheetCollapsed: false,
        isSubmittingDraft: false,
        draftSubmitError: action.message,
      };
    }

    case 'POLYGON_CREATED': {
      const withoutExisting = state.features.filter(
        (f) => f.id !== action.feature.id,
      );
      const merged = [action.feature, ...withoutExisting];
      const normalized = recomputeMunicipalityScoresForAgs(
        state.features,
        merged,
        action.feature.properties.municipalityAgs,
      );
      const nextFeatures = sortFeaturesCanonical(normalized);

      return {
        ...state,
        features: nextFeatures,
        mode: 'browse',
        drawingStep: 'geometry',
        drawingSheetCollapsed: false,
        draftVertices: [],
        isRingClosed: false,
        draftSurfaceType: 'asphalt',
        draftNote: '',
        draftPhotos: [],
        confirmingDiscardDraft: false,
        isSubmittingDraft: false,
        draftSubmitError: null,
        overlappingFeatureIds: [action.feature.id],
        overlapIndex: 0,
        selectedFeatureId: action.feature.id,
        pendingIntent:
          state.pendingIntent?.type === 'SUBMIT_DRAFT'
            ? null
            : state.pendingIntent,
      };
    }

    case 'POLYGON_UPDATED': {
      const replaced = state.features.map((f) =>
        f.id === action.feature.id ? action.feature : f,
      );
      const normalized = recomputeMunicipalityScoresForAgs(
        state.features,
        replaced,
        action.feature.properties.municipalityAgs,
      );
      const nextFeatures = sortFeaturesCanonical(normalized);
      return {
        ...state,
        features: nextFeatures,
      };
    }

    case 'POLYGON_PHOTO_COUNT_SET': {
      const nextCount = Math.max(0, action.photoCount);
      const nextFeatures = state.features.map((f) =>
        f.id === action.polygonId
          ? {
              ...f,
              properties: {
                ...f.properties,
                photoCount: nextCount,
              },
            }
          : f,
      );
      return {
        ...state,
        features: nextFeatures,
      };
    }

    case 'POLYGON_COMMENT_COUNT_SET': {
      const nextCount = Math.max(0, action.commentCount);
      const nextFeatures = state.features.map((f) =>
        f.id === action.polygonId
          ? {
              ...f,
              properties: {
                ...f.properties,
                commentCount: nextCount,
              },
            }
          : f,
      );
      return {
        ...state,
        features: nextFeatures,
      };
    }

    case 'POLYGON_DELETED': {
      const deletedTarget = state.features.find(
        (f) => f.id === action.polygonId,
      );
      const remaining = state.features.filter(
        (f) => f.id !== action.polygonId,
      );
      const nextFeatures = deletedTarget
        ? recomputeMunicipalityScoresForAgs(
            state.features,
            remaining,
            deletedTarget.properties.municipalityAgs,
          )
        : remaining;
      const nextOverlap = state.overlappingFeatureIds.filter(
        (id) => id !== action.polygonId,
      );
      const nextIndex =
        nextOverlap.length === 0
          ? 0
          : Math.min(state.overlapIndex, nextOverlap.length - 1);

      return {
        ...state,
        features: nextFeatures,
        overlappingFeatureIds: nextOverlap,
        overlapIndex: nextIndex,
        selectedFeatureId: nextOverlap[nextIndex] ?? null,
      };
    }

    case 'SELECT_FEATURES_AT_TAP': {
      const dedupedIds = dedupeStrings(action.featureIds);
      if (dedupedIds.length === 0) {
        return {
          ...state,
          overlappingFeatureIds: [],
          overlapIndex: 0,
          selectedFeatureId: null,
        };
      }

      const isRepeatTapOnSameStack =
        dedupedIds.length > 1 &&
        arraysEqual(dedupedIds, state.overlappingFeatureIds);
      const nextIndex = isRepeatTapOnSameStack
        ? (state.overlapIndex + 1) % dedupedIds.length
        : 0;

      return {
        ...state,
        overlappingFeatureIds: dedupedIds,
        overlapIndex: nextIndex,
        selectedFeatureId: dedupedIds[nextIndex] ?? null,
      };
    }

    case 'CYCLE_OVERLAP_FEATURE': {
      const count = state.overlappingFeatureIds.length;
      if (count <= 1) {
        return state;
      }
      const nextIndex = (state.overlapIndex + 1) % count;
      return {
        ...state,
        overlapIndex: nextIndex,
        selectedFeatureId: state.overlappingFeatureIds[nextIndex] ?? null,
      };
    }

    case 'CAST_VOTE': {
      const targetFeature = state.features.find(
        (f) => f.id === action.polygonId,
      );
      if (
        targetFeature &&
        (targetFeature.properties.isAuthor ||
          targetFeature.properties.status !== 'proposed')
      ) {
        return state;
      }
      const intent: PendingIntent = {
        type: 'CAST_VOTE',
        polygonId: action.polygonId,
        value: action.value,
      };
      if (state.currentUser === null) {
        return {
          ...state,
          pendingIntent: intent,
          authModalOpen: true,
          authModalView: 'login',
          authError: null,
        };
      }
      return {
        ...state,
        pendingIntent: intent,
      };
    }

    case 'VOTE_UPDATED': {
      const targetFeature = state.features.find(
        (f) => f.id === action.vote.polygonId,
      );
      const updatedRaw = state.features.map((f) => {
        if (f.id !== action.vote.polygonId) {
          return f;
        }
        return {
          ...f,
          properties: {
            ...f.properties,
            upvotes: action.vote.upvotes,
            downvotes: action.vote.downvotes,
            score: action.vote.score,
            myVote: action.vote.myVote,
          },
        };
      });
      const normalized = targetFeature
        ? recomputeMunicipalityScoresForAgs(
            state.features,
            updatedRaw,
            targetFeature.properties.municipalityAgs,
          )
        : updatedRaw;
      const nextFeatures = sortFeaturesCanonical(normalized);

      const shouldClearPending =
        state.pendingIntent?.type === 'CAST_VOTE' &&
        state.pendingIntent.polygonId === action.vote.polygonId;

      const prevNeedsReview =
        targetFeature !== undefined &&
        targetFeature.properties.score === 0 &&
        targetFeature.properties.upvotes === 0 &&
        targetFeature.properties.downvotes === 0;
      const nextNeedsReview =
        action.vote.score === 0 &&
        action.vote.upvotes === 0 &&
        action.vote.downvotes === 0;
      const shouldRefreshNeedsReviewFilter =
        state.polygonFilter === 'needs_review' &&
        targetFeature !== undefined &&
        prevNeedsReview !== nextNeedsReview;

      return {
        ...state,
        features: nextFeatures,
        pendingIntent: shouldClearPending ? null : state.pendingIntent,
        viewportRefreshSeq: shouldRefreshNeedsReviewFilter
          ? state.viewportRefreshSeq + 1
          : state.viewportRefreshSeq,
      };
    }

    case 'POLYGON_FLAG_UPDATED': {
      const nextFeatures = state.features.map((f) =>
        f.id === action.flag.polygonId
          ? {
              ...f,
              properties: {
                ...f.properties,
                flagCount: action.flag.flagCount,
                isFlagged: action.flag.isFlagged,
                myFlag: action.flag.myFlag,
              },
            }
          : f,
      );
      return {
        ...state,
        features: nextFeatures,
      };
    }

    case 'OPEN_AUTH_MODAL': {
      const defaultView: AuthModalView =
        action.view ??
        (state.currentUser
          ? 'account'
          : state.pendingVerificationEmail
            ? 'verify_pending'
            : 'login');
      return {
        ...state,
        authModalOpen: true,
        authModalView: defaultView,
        authError: null,
      };
    }

    case 'SET_AUTH_MODAL_VIEW': {
      return {
        ...state,
        authModalView: action.view,
        authError: null,
      };
    }

    case 'REGISTRATION_VERIFICATION_SENT': {
      return {
        ...state,
        authModalOpen: true,
        authModalView: 'verify_pending',
        pendingVerificationEmail: action.email,
        pendingVerificationPseudonym: action.pseudonym,
        authError: null,
      };
    }

    case 'CLOSE_AUTH_MODAL': {
      return {
        ...state,
        authModalOpen: false,
        authError: null,
        pendingIntent:
          state.currentUser === null && state.pendingVerificationEmail === null
            ? null
            : state.pendingIntent,
      };
    }

    case 'AUTH_ERROR': {
      return {
        ...state,
        authError: action.message,
      };
    }

    case 'AUTH_SUCCEEDED': {
      return {
        ...state,
        currentUser: action.user,
        viewportRefreshSeq: state.viewportRefreshSeq + 1,
        authError: null,
        authModalOpen: false,
        authModalView: 'account',
        pendingVerificationEmail: null,
        pendingVerificationPseudonym: null,
      };
    }

    case 'SESSION_EXPIRED': {
      return {
        ...state,
        currentUser: null,
        highlightMineOnly: false,
        isSubmittingDraft: false,
        viewportRefreshSeq: state.viewportRefreshSeq + 1,
        authModalOpen: true,
        authModalView: 'login',
        authError: getTranslations(state.locale).auth.sessionExpired,
      };
    }

    case 'LOGOUT_SUCCEEDED': {
      const scrubbedFeatures = state.features.map((f) => ({
        ...f,
        properties: {
          ...f.properties,
          myVote: 0 as const,
          myFlag: false,
          isAuthor: false,
        },
      }));

      return {
        ...state,
        currentUser: null,
        highlightMineOnly: false,
        viewportRefreshSeq: state.viewportRefreshSeq + 1,
        features: scrubbedFeatures,
        isSubmittingDraft: false,
        authModalOpen: false,
        authModalView: 'login',
        pendingVerificationEmail: null,
        pendingVerificationPseudonym: null,
        authError: null,
        pendingIntent: null,
      };
    }

    case 'ACCOUNT_DELETED': {
      // With purgedContent the server erased the user's own polygons as well.
      const purgedIds = new Set(
        action.purgedContent
          ? state.features.filter((f) => f.properties.isAuthor).map((f) => f.id)
          : [],
      );
      const nextOverlap = state.overlappingFeatureIds.filter(
        (id) => !purgedIds.has(id),
      );
      const nextOverlapIndex =
        nextOverlap.length === 0
          ? 0
          : Math.min(state.overlapIndex, nextOverlap.length - 1);
      const selectionPurged =
        state.selectedFeatureId !== null && purgedIds.has(state.selectedFeatureId);
      const anonymizedFeatures = state.features
        .filter((f) => !purgedIds.has(f.id))
        .map((f) => {
          const nextFlagCount = f.properties.myFlag
            ? Math.max(0, f.properties.flagCount - 1)
            : f.properties.flagCount;
          return {
            ...f,
            properties: {
              ...f.properties,
              authorPseudonym: f.properties.isAuthor
                ? 'deleted'
                : f.properties.authorPseudonym,
              authorIsNewUser: f.properties.isAuthor
                ? false
                : f.properties.authorIsNewUser,
              authorRecentlyActive: f.properties.isAuthor
                ? null
                : f.properties.authorRecentlyActive,
              isAuthor: false,
              myVote: 0 as const,
              flagCount: nextFlagCount,
              isFlagged: nextFlagCount > 0,
              myFlag: false,
            },
          };
        });

      return {
        ...state,
        currentUser: null,
        highlightMineOnly: false,
        viewportRefreshSeq: state.viewportRefreshSeq + 1,
        features: anonymizedFeatures,
        overlappingFeatureIds: nextOverlap,
        overlapIndex: nextOverlapIndex,
        selectedFeatureId: selectionPurged
          ? (nextOverlap[nextOverlapIndex] ?? null)
          : state.selectedFeatureId,
        isSubmittingDraft: false,
        authModalOpen: false,
        authModalView: 'login',
        pendingVerificationEmail: null,
        pendingVerificationPseudonym: null,
        authError: null,
        pendingIntent: null,
      };
    }

    case 'CLEAR_PENDING_INTENT': {
      return {
        ...state,
        pendingIntent: null,
        isSubmittingDraft: false,
      };
    }
  }
}
