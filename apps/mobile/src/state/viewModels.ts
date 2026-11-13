import {
  GEOMETRY_LIMITS,
  PHOTO_LIMITS,
  validateDraftPolygon,
  type AuthUser,
  type SurfaceType,
} from '@entsiegelung/shared';

import {
  getTranslations,
  translateValidationMessage,
  type Locale,
} from '../i18n/translations';
import {
  MAX_DRAFT_PHOTOS,
  type AppState,
  type AuthModalView,
  type BasemapMode,
  type DraftPhotoAttachment,
  type DrawingStep,
} from './appState';

export const MIN_TOUCH_TARGET_DP = 44;

export interface MapControlsModel {
  locale: Locale;
  showOrthophotoToggle: boolean;
  basemapMode: BasemapMode;
  orthophotoAttribution: string | null;
  canStartDraw: boolean;
  drawDisabledReason: string | null;
  showZoomInPrompt: boolean;
  zoomInPromptText: string;
  showFirstVisitDisclaimer: boolean;
  disclaimerText: string | null;
  showTruncatedNotice: boolean;
  tileWarning: string | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  accountLabel: string;
  minTouchTargetDp: typeof MIN_TOUCH_TARGET_DP;
}

export interface AuthModalModel {
  visible: boolean;
  view: AuthModalView;
  pendingVerificationEmail: string | null;
  pendingVerificationPseudonym: string | null;
  canClose: boolean;
  currentUser: AuthUser | null;
  errorMessage: string | null;
  hasPendingIntent: boolean;
  pendingIntentSummary: string | null;
}

export interface DrawingToolbarModel {
  visible: boolean;
  step: DrawingStep;
  rawVertexCount: number;
  distinctVertexCount: number;
  maxVertices: number;
  isRingClosed: boolean;
  areaM2: number;
  nearAreaBound: boolean;
  crossingPoint: [number, number] | null;
  validationErrors: string[];
  canAddVertex: boolean;
  canUndo: boolean;
  undoLabel: string;
  canCloseRing: boolean;
  canAdvanceToDetails: boolean;
  canSubmit: boolean;
  isSubmitting: boolean;
  surfaceType: SurfaceType;
  note: string;
  noteRemainingChars: number;
  draftPhotos: readonly DraftPhotoAttachment[];
  canAddPhoto: boolean;
  confirmingDiscard: boolean;
  submitError: string | null;
}

export function deriveMapControlsModel(state: AppState): MapControlsModel {
  const t = getTranslations(state.locale);
  const showOrthophotoToggle =
    state.config !== null && state.config.orthophoto !== null;
  const effectiveBasemapMode: BasemapMode = showOrthophotoToggle
    ? state.basemapMode
    : 'osm';
  const zoomInPromptText = t.controls.zoomInPrompt;

  return {
    locale: state.locale,
    showOrthophotoToggle,
    basemapMode: effectiveBasemapMode,
    orthophotoAttribution: state.config?.orthophoto?.attribution ?? null,
    canStartDraw:
      state.configStatus === 'ready' &&
      state.mode === 'browse' &&
      !state.spanTooWide,
    drawDisabledReason: state.spanTooWide ? zoomInPromptText : null,
    showZoomInPrompt: state.spanTooWide,
    zoomInPromptText,
    showFirstVisitDisclaimer:
      state.config !== null && !state.firstVisitDisclaimerDismissed,
    disclaimerText: state.config?.disclaimerText ?? null,
    showTruncatedNotice: !state.spanTooWide && state.truncated,
    tileWarning: state.tileWarning,
    isAuthenticated: state.currentUser !== null,
    isAdmin: state.currentUser?.role === 'admin',
    accountLabel: state.currentUser
      ? state.currentUser.pseudonym
      : t.controls.signInShort,
    minTouchTargetDp: MIN_TOUCH_TARGET_DP,
  };
}

export function deriveAuthModalModel(state: AppState): AuthModalModel {
  const t = getTranslations(state.locale);

  let pendingIntentSummary: string | null = null;
  if (state.pendingIntent?.type === 'SUBMIT_DRAFT') {
    pendingIntentSummary = t.auth.pendingDraftSummary;
  } else if (state.pendingIntent?.type === 'CAST_VOTE') {
    pendingIntentSummary = t.auth.pendingVoteSummary;
  }

  return {
    visible: state.authModalOpen,
    view: state.authModalView,
    pendingVerificationEmail: state.pendingVerificationEmail,
    pendingVerificationPseudonym: state.pendingVerificationPseudonym,
    canClose: true,
    currentUser: state.currentUser,
    errorMessage: state.authError,
    hasPendingIntent: state.pendingIntent !== null,
    pendingIntentSummary,
  };
}

export function deriveDrawingToolbarModel(
  state: AppState,
): DrawingToolbarModel {
  const t = getTranslations(state.locale);
  const maxVertices =
    state.config?.limits.maxVertices ?? GEOMETRY_LIMITS.MAX_VERTICES;
  const minAreaM2 =
    state.config?.limits.minAreaM2 ?? GEOMETRY_LIMITS.MIN_AREA_M2;
  const maxAreaM2 =
    state.config?.limits.maxAreaM2 ?? GEOMETRY_LIMITS.MAX_AREA_M2;

  const draftValidation = validateDraftPolygon(state.draftVertices);
  const rawGeometryErrors = [...draftValidation.errors];

  if (draftValidation.vertexCount > maxVertices) {
    const customMaxMsg = `Polygon must have at most ${maxVertices} distinct vertices.`;
    if (!rawGeometryErrors.includes(customMaxMsg)) {
      rawGeometryErrors.push(customMaxMsg);
    }
  }

  if (
    draftValidation.vertexCount >= GEOMETRY_LIMITS.MIN_VERTICES &&
    draftValidation.areaM2 < minAreaM2 &&
    minAreaM2 !== GEOMETRY_LIMITS.MIN_AREA_M2
  ) {
    rawGeometryErrors.push(
      `Polygon area (${draftValidation.areaM2.toFixed(1)} m²) is below minimum of ${minAreaM2} m².`,
    );
  }

  if (
    draftValidation.vertexCount >= GEOMETRY_LIMITS.MIN_VERTICES &&
    draftValidation.areaM2 > maxAreaM2 &&
    maxAreaM2 !== GEOMETRY_LIMITS.MAX_AREA_M2
  ) {
    rawGeometryErrors.push(
      `Polygon area (${draftValidation.areaM2.toFixed(1)} m²) exceeds maximum of ${maxAreaM2.toLocaleString('en-US')} m².`,
    );
  }

  const rawErrors = [...rawGeometryErrors];

  const noteRemainingChars =
    GEOMETRY_LIMITS.MAX_NOTE_LENGTH - state.draftNote.length;
  if (noteRemainingChars < 0) {
    rawErrors.push(
      `Note must be at most ${GEOMETRY_LIMITS.MAX_NOTE_LENGTH} characters.`,
    );
  }

  const errors = rawErrors.map((msg) =>
    translateValidationMessage(msg, state.locale),
  );

  const canAddVertex =
    state.mode === 'drawing' &&
    state.drawingStep === 'geometry' &&
    !state.isRingClosed &&
    draftValidation.vertexCount < maxVertices;
  const canUndo =
    state.mode === 'drawing' &&
    (state.isRingClosed || state.draftVertices.length > 0);
  const canCloseRing =
    state.mode === 'drawing' &&
    !state.isRingClosed &&
    draftValidation.vertexCount >= GEOMETRY_LIMITS.MIN_VERTICES;
  const canAdvanceToDetails =
    state.mode === 'drawing' &&
    draftValidation.valid &&
    rawGeometryErrors.length === 0;
  const canSubmit =
    state.mode === 'drawing' &&
    state.isRingClosed &&
    draftValidation.valid &&
    errors.length === 0 &&
    !state.isSubmittingDraft;

  const maxAllowedPhotos = Math.min(
    MAX_DRAFT_PHOTOS,
    PHOTO_LIMITS.MAX_PHOTOS_PER_POLYGON,
  );

  return {
    visible: state.mode === 'drawing',
    step: state.drawingStep,
    rawVertexCount: state.draftVertices.length,
    distinctVertexCount: draftValidation.vertexCount,
    maxVertices,
    isRingClosed: state.isRingClosed,
    areaM2: draftValidation.areaM2,
    nearAreaBound: draftValidation.nearAreaBound,
    crossingPoint: draftValidation.crossingPoint,
    validationErrors: errors,
    canAddVertex,
    canUndo,
    undoLabel: state.isRingClosed ? t.drawing.reopenRing : t.drawing.undoVertex,
    canCloseRing,
    canAdvanceToDetails,
    canSubmit,
    isSubmitting: state.isSubmittingDraft,
    surfaceType: state.draftSurfaceType,
    note: state.draftNote,
    noteRemainingChars,
    draftPhotos: state.draftPhotos,
    canAddPhoto: state.draftPhotos.length < maxAllowedPhotos,
    confirmingDiscard: state.confirmingDiscardDraft,
    submitError: state.draftSubmitError,
  };
}
