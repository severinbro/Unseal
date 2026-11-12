import {
  GEOMETRY_LIMITS,
  validateDraftPolygon,
  type AuthUser,
  type SurfaceType,
} from '@entsiegelung/shared';

import type { AppState, AuthModalView, BasemapMode } from './appState';

export const MIN_TOUCH_TARGET_DP = 44;

export interface MapControlsModel {
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
  accountLabel: string;
  minTouchTargetDp: typeof MIN_TOUCH_TARGET_DP;
}

export interface AuthModalModel {
  visible: boolean;
  view: AuthModalView;
  isPostSignupRecoveryDisplay: boolean;
  recoveryCode: string | null;
  recoveryCodeSavedChecked: boolean;
  canClose: boolean;
  closeBlockedReason: string | null;
  currentUser: AuthUser | null;
  errorMessage: string | null;
  hasPendingIntent: boolean;
  pendingIntentSummary: string | null;
}

export interface DrawingToolbarModel {
  visible: boolean;
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
  canSubmit: boolean;
  isSubmitting: boolean;
  surfaceType: SurfaceType;
  note: string;
  noteRemainingChars: number;
  confirmingDiscard: boolean;
  submitError: string | null;
}

export function deriveMapControlsModel(state: AppState): MapControlsModel {
  const showOrthophotoToggle =
    state.config !== null && state.config.orthophoto !== null;
  const effectiveBasemapMode: BasemapMode = showOrthophotoToggle
    ? state.basemapMode
    : 'osm';
  const zoomInPromptText = 'Zoom in to view and add proposals';

  return {
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
    accountLabel: state.currentUser ? state.currentUser.pseudonym : 'Sign in',
    minTouchTargetDp: MIN_TOUCH_TARGET_DP,
  };
}

export function deriveAuthModalModel(state: AppState): AuthModalModel {
  const isPostSignupRecoveryDisplay = state.pendingRecoveryCode !== null;
  const canClose =
    !isPostSignupRecoveryDisplay || state.recoveryCodeSavedChecked === true;
  const closeBlockedReason = canClose
    ? null
    : 'Please confirm "I have saved my recovery code" before closing.';

  let pendingIntentSummary: string | null = null;
  if (state.pendingIntent?.type === 'SUBMIT_DRAFT') {
    pendingIntentSummary =
      'Your polygon draft is preserved and will be submitted once you sign in.';
  } else if (state.pendingIntent?.type === 'CAST_VOTE') {
    pendingIntentSummary =
      'Your vote will be submitted automatically once you sign in.';
  }

  return {
    visible: state.authModalOpen,
    view: isPostSignupRecoveryDisplay ? 'recovery_code' : state.authModalView,
    isPostSignupRecoveryDisplay,
    recoveryCode: state.pendingRecoveryCode,
    recoveryCodeSavedChecked: state.recoveryCodeSavedChecked,
    canClose,
    closeBlockedReason,
    currentUser: state.currentUser,
    errorMessage: state.authError,
    hasPendingIntent: state.pendingIntent !== null,
    pendingIntentSummary,
  };
}

export function deriveDrawingToolbarModel(
  state: AppState,
): DrawingToolbarModel {
  const maxVertices =
    state.config?.limits.maxVertices ?? GEOMETRY_LIMITS.MAX_VERTICES;
  const minAreaM2 =
    state.config?.limits.minAreaM2 ?? GEOMETRY_LIMITS.MIN_AREA_M2;
  const maxAreaM2 =
    state.config?.limits.maxAreaM2 ?? GEOMETRY_LIMITS.MAX_AREA_M2;

  const draftValidation = validateDraftPolygon(state.draftVertices);
  const errors = [...draftValidation.errors];

  if (draftValidation.vertexCount > maxVertices) {
    const customMaxMsg = `Polygon must have at most ${maxVertices} distinct vertices.`;
    if (!errors.includes(customMaxMsg)) {
      errors.push(customMaxMsg);
    }
  }

  if (
    draftValidation.vertexCount >= GEOMETRY_LIMITS.MIN_VERTICES &&
    draftValidation.areaM2 < minAreaM2 &&
    minAreaM2 !== GEOMETRY_LIMITS.MIN_AREA_M2
  ) {
    errors.push(
      `Polygon area (${draftValidation.areaM2.toFixed(1)} m²) is below minimum of ${minAreaM2} m².`,
    );
  }

  if (
    draftValidation.vertexCount >= GEOMETRY_LIMITS.MIN_VERTICES &&
    draftValidation.areaM2 > maxAreaM2 &&
    maxAreaM2 !== GEOMETRY_LIMITS.MAX_AREA_M2
  ) {
    errors.push(
      `Polygon area (${draftValidation.areaM2.toFixed(1)} m²) exceeds maximum of ${maxAreaM2.toLocaleString('en-US')} m².`,
    );
  }

  const noteRemainingChars =
    GEOMETRY_LIMITS.MAX_NOTE_LENGTH - state.draftNote.length;
  if (noteRemainingChars < 0) {
    errors.push(
      `Note must be at most ${GEOMETRY_LIMITS.MAX_NOTE_LENGTH} characters.`,
    );
  }

  const canAddVertex =
    state.mode === 'drawing' &&
    !state.isRingClosed &&
    draftValidation.vertexCount < maxVertices;
  const canUndo =
    state.mode === 'drawing' &&
    (state.isRingClosed || state.draftVertices.length > 0);
  const canCloseRing =
    state.mode === 'drawing' &&
    !state.isRingClosed &&
    draftValidation.vertexCount >= GEOMETRY_LIMITS.MIN_VERTICES;
  const canSubmit =
    state.mode === 'drawing' &&
    state.isRingClosed &&
    draftValidation.valid &&
    errors.length === 0 &&
    !state.isSubmittingDraft;

  return {
    visible: state.mode === 'drawing',
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
    undoLabel: state.isRingClosed ? 'Reopen ring' : 'Undo vertex',
    canCloseRing,
    canSubmit,
    isSubmitting: state.isSubmittingDraft,
    surfaceType: state.draftSurfaceType,
    note: state.draftNote,
    noteRemainingChars,
    confirmingDiscard: state.confirmingDiscardDraft,
    submitError: state.draftSubmitError,
  };
}
