import {
  ApiError,
  checkBboxSpan,
  closeRingIfNeeded,
  dedupeConsecutivePoints,
  GEOMETRY_LIMITS,
  type AuthUser,
  type BboxBounds,
  type CreatePolygonRequest,
  type PolygonFeature,
  type RuntimeConfig,
  type SurfaceType,
  type VoteResponse,
} from '@entsiegelung/shared';

export type ConfigStatus = 'loading' | 'ready' | 'error';
export type InteractionMode = 'browse' | 'drawing';
export type BasemapMode = 'osm' | 'orthophoto';
export type AuthModalView =
  | 'login'
  | 'register'
  | 'recover'
  | 'recovery_code'
  | 'account';

export interface ViewportState {
  bbox: BboxBounds;
  zoom: number;
}

export interface CameraTarget {
  lng: number;
  lat: number;
  zoom?: number;
  seq: number;
}

export type PendingIntent =
  | {
      type: 'SUBMIT_DRAFT';
      payload: CreatePolygonRequest;
    }
  | {
      type: 'CAST_VOTE';
      polygonId: string;
      value: 1 | -1;
    };

export interface AppState {
  configStatus: ConfigStatus;
  config: RuntimeConfig | null;
  configError: string | null;
  firstVisitDisclaimerDismissed: boolean;
  basemapMode: BasemapMode;
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
  draftVertices: [number, number][];
  isRingClosed: boolean;
  draftSurfaceType: SurfaceType;
  draftNote: string;
  confirmingDiscardDraft: boolean;
  isSubmittingDraft: boolean;
  draftSubmitError: string | null;
  currentUser: AuthUser | null;
  authModalOpen: boolean;
  authModalView: AuthModalView;
  pendingRecoveryCode: string | null;
  recoveryCodeSavedChecked: boolean;
  authError: string | null;
  pendingIntent: PendingIntent | null;
}

export type AppAction =
  | { type: 'CONFIG_LOADING' }
  | { type: 'CONFIG_LOADED'; config: RuntimeConfig }
  | { type: 'CONFIG_ERROR'; message: string }
  | { type: 'DISMISS_FIRST_VISIT_DISCLAIMER' }
  | { type: 'DISMISS_TILE_WARNING' }
  | { type: 'SET_BASEMAP_MODE'; mode: BasemapMode }
  | { type: 'TILE_LOAD_ERROR'; reason?: string }
  | { type: 'SET_CAMERA_TARGET'; lng: number; lat: number; zoom?: number }
  | { type: 'SET_VIEWPORT'; bbox: BboxBounds; zoom: number }
  | {
      type: 'VIEWPORT_FEATURES_LOADED';
      features: PolygonFeature[];
      truncated: boolean;
    }
  | { type: 'START_DRAW' }
  | { type: 'ADD_VERTEX'; point: [number, number] }
  | { type: 'UNDO_VERTEX' }
  | { type: 'CLOSE_RING' }
  | { type: 'SET_DRAFT_META'; surfaceType?: SurfaceType; note?: string }
  | { type: 'REQUEST_DISCARD_DRAFT' }
  | { type: 'CANCEL_DISCARD_DRAFT' }
  | { type: 'CONFIRM_DISCARD_DRAFT' }
  | { type: 'SUBMIT_DRAFT' }
  | { type: 'SUBMIT_ERROR_PRESERVE_DRAFT'; message: string }
  | { type: 'POLYGON_CREATED'; feature: PolygonFeature }
  | { type: 'POLYGON_UPDATED'; feature: PolygonFeature }
  | { type: 'POLYGON_DELETED'; polygonId: string }
  | { type: 'SELECT_FEATURES_AT_TAP'; featureIds: readonly string[] }
  | { type: 'CYCLE_OVERLAP_FEATURE' }
  | { type: 'CAST_VOTE'; polygonId: string; value: 1 | -1 }
  | { type: 'VOTE_UPDATED'; vote: VoteResponse }
  | {
      type: 'OPEN_AUTH_MODAL';
      view?: Exclude<AuthModalView, 'recovery_code'>;
    }
  | {
      type: 'SET_AUTH_MODAL_VIEW';
      view: Exclude<AuthModalView, 'recovery_code'>;
    }
  | { type: 'SET_RECOVERY_CODE_SAVED_CHECKED'; checked: boolean }
  | { type: 'CLOSE_AUTH_MODAL' }
  | { type: 'AUTH_ERROR'; message: string }
  | { type: 'AUTH_SUCCEEDED'; user: AuthUser; recoveryCode?: string }
  | { type: 'SESSION_EXPIRED' }
  | { type: 'LOGOUT_SUCCEEDED' }
  | { type: 'ACCOUNT_DELETED' }
  | { type: 'CLEAR_PENDING_INTENT' };

export const initialAppState: AppState = {
  configStatus: 'loading',
  config: null,
  configError: null,
  firstVisitDisclaimerDismissed: false,
  basemapMode: 'osm',
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
  draftVertices: [],
  isRingClosed: false,
  draftSurfaceType: 'asphalt',
  draftNote: '',
  confirmingDiscardDraft: false,
  isSubmittingDraft: false,
  draftSubmitError: null,
  currentUser: null,
  authModalOpen: false,
  authModalView: 'login',
  pendingRecoveryCode: null,
  recoveryCodeSavedChecked: false,
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
      const nextCameraTarget: CameraTarget =
        state.cameraTarget ?? {
          lng: action.config.initialView.lng,
          lat: action.config.initialView.lat,
          zoom: action.config.initialView.zoom,
          seq: 1,
        };

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

    case 'TILE_LOAD_ERROR': {
      return {
        ...state,
        basemapMode: 'osm',
        tileWarning:
          action.reason ??
          'Aerial orthophoto tiles failed to load; reverted to OpenStreetMap basemap.',
      };
    }

    case 'SET_CAMERA_TARGET': {
      const nextSeq = (state.cameraTarget?.seq ?? 0) + 1;
      const target: CameraTarget = {
        lng: action.lng,
        lat: action.lat,
        ...(action.zoom !== undefined ? { zoom: action.zoom } : {}),
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

    case 'START_DRAW': {
      return {
        ...state,
        mode: 'drawing',
        draftVertices: [],
        isRingClosed: false,
        draftSurfaceType: 'asphalt',
        draftNote: '',
        confirmingDiscardDraft: false,
        isSubmittingDraft: false,
        draftSubmitError: null,
        overlappingFeatureIds: [],
        overlapIndex: 0,
        selectedFeatureId: null,
      };
    }

    case 'ADD_VERTEX': {
      if (state.mode !== 'drawing' || state.isRingClosed) {
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
          draftSubmitError: `Polygon requires at least ${GEOMETRY_LIMITS.MIN_VERTICES} distinct vertices.`,
        };
      }
      return {
        ...state,
        isRingClosed: true,
        confirmingDiscardDraft: false,
        draftSubmitError: null,
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

    case 'REQUEST_DISCARD_DRAFT': {
      if (state.mode !== 'drawing') {
        return state;
      }
      if (
        state.draftVertices.length === 0 &&
        state.draftNote.trim().length === 0
      ) {
        return {
          ...state,
          mode: 'browse',
          isRingClosed: false,
          confirmingDiscardDraft: false,
          isSubmittingDraft: false,
          draftSubmitError: null,
        };
      }
      return {
        ...state,
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
        draftVertices: [],
        isRingClosed: false,
        draftSurfaceType: 'asphalt',
        draftNote: '',
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
        isSubmittingDraft: false,
        draftSubmitError: action.message,
      };
    }

    case 'POLYGON_CREATED': {
      const withoutExisting = state.features.filter(
        (f) => f.id !== action.feature.id,
      );
      const nextFeatures = sortFeaturesCanonical([
        action.feature,
        ...withoutExisting,
      ]);

      return {
        ...state,
        features: nextFeatures,
        mode: 'browse',
        draftVertices: [],
        isRingClosed: false,
        draftSurfaceType: 'asphalt',
        draftNote: '',
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
      const nextFeatures = sortFeaturesCanonical(
        state.features.map((f) =>
          f.id === action.feature.id ? action.feature : f,
        ),
      );
      return {
        ...state,
        features: nextFeatures,
      };
    }

    case 'POLYGON_DELETED': {
      const nextFeatures = state.features.filter(
        (f) => f.id !== action.polygonId,
      );
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
      const nextFeatures = sortFeaturesCanonical(
        state.features.map((f) => {
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
        }),
      );

      const shouldClearPending =
        state.pendingIntent?.type === 'CAST_VOTE' &&
        state.pendingIntent.polygonId === action.vote.polygonId;

      return {
        ...state,
        features: nextFeatures,
        pendingIntent: shouldClearPending ? null : state.pendingIntent,
      };
    }

    case 'OPEN_AUTH_MODAL': {
      const defaultView: AuthModalView =
        state.pendingRecoveryCode !== null
          ? 'recovery_code'
          : (action.view ?? (state.currentUser ? 'account' : 'login'));
      return {
        ...state,
        authModalOpen: true,
        authModalView: defaultView,
        authError: null,
      };
    }

    case 'SET_AUTH_MODAL_VIEW': {
      if (state.pendingRecoveryCode !== null && !state.recoveryCodeSavedChecked) {
        return state;
      }
      return {
        ...state,
        authModalView: action.view,
        authError: null,
      };
    }

    case 'SET_RECOVERY_CODE_SAVED_CHECKED': {
      return {
        ...state,
        recoveryCodeSavedChecked: action.checked,
      };
    }

    case 'CLOSE_AUTH_MODAL': {
      if (state.pendingRecoveryCode !== null && !state.recoveryCodeSavedChecked) {
        return state;
      }
      return {
        ...state,
        authModalOpen: false,
        pendingRecoveryCode: null,
        recoveryCodeSavedChecked: false,
        authError: null,
        pendingIntent: state.currentUser === null ? null : state.pendingIntent,
      };
    }

    case 'AUTH_ERROR': {
      return {
        ...state,
        authError: action.message,
      };
    }

    case 'AUTH_SUCCEEDED': {
      const nextRecoveryCode: string | null =
        action.recoveryCode !== undefined && action.recoveryCode.length > 0
          ? action.recoveryCode
          : null;
      const hasRecoveryCode = nextRecoveryCode !== null;

      return {
        ...state,
        currentUser: action.user,
        viewportRefreshSeq: state.viewportRefreshSeq + 1,
        authError: null,
        authModalOpen: hasRecoveryCode,
        authModalView: hasRecoveryCode ? 'recovery_code' : 'account',
        pendingRecoveryCode: nextRecoveryCode,
        recoveryCodeSavedChecked: false,
      };
    }

    case 'SESSION_EXPIRED': {
      return {
        ...state,
        currentUser: null,
        isSubmittingDraft: false,
        viewportRefreshSeq: state.viewportRefreshSeq + 1,
        authModalOpen: true,
        authModalView: 'login',
        authError: 'Your session expired. Please sign in to continue.',
      };
    }

    case 'LOGOUT_SUCCEEDED': {
      const scrubbedFeatures = state.features.map((f) => ({
        ...f,
        properties: {
          ...f.properties,
          myVote: 0 as const,
          isAuthor: false,
        },
      }));

      return {
        ...state,
        currentUser: null,
        viewportRefreshSeq: state.viewportRefreshSeq + 1,
        features: scrubbedFeatures,
        isSubmittingDraft: false,
        authModalOpen: false,
        authModalView: 'login',
        pendingRecoveryCode: null,
        recoveryCodeSavedChecked: false,
        authError: null,
        pendingIntent: null,
      };
    }

    case 'ACCOUNT_DELETED': {
      const anonymizedFeatures = state.features.map((f) => ({
        ...f,
        properties: {
          ...f.properties,
          authorPseudonym: f.properties.isAuthor
            ? 'deleted'
            : f.properties.authorPseudonym,
          isAuthor: false,
          myVote: 0 as const,
        },
      }));

      return {
        ...state,
        currentUser: null,
        viewportRefreshSeq: state.viewportRefreshSeq + 1,
        features: anonymizedFeatures,
        isSubmittingDraft: false,
        authModalOpen: false,
        authModalView: 'login',
        pendingRecoveryCode: null,
        recoveryCodeSavedChecked: false,
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
