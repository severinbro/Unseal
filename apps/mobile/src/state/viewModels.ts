import {
  findTopRatedCommentId,
  GEOMETRY_LIMITS,
  PHOTO_LIMITS,
  sortPolygonCommentsByRating,
  validateDraftPolygon,
  type AuthUser,
  type PolygonComment,
  type PolygonFeature,
  type PolygonFilter,
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

export function formatInspectorDate(
  iso: string | null | undefined,
  locale: Locale,
): string | null {
  if (!iso || iso.trim().length === 0) {
    return null;
  }
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const yyyy = String(parsed.getUTCFullYear()).padStart(4, '0');
  const mm = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(parsed.getUTCDate()).padStart(2, '0');
  return locale === 'de' ? `${dd}.${mm}.${yyyy}` : `${yyyy}-${mm}-${dd}`;
}

export interface InspectorOverviewMetaModel {
  displayAuthorHandle: string;
  authorIsNewUser: boolean;
  newContributorBadgeText: string | null;
  entryDateText: string | null;
  authorLastLoginText: string;
  isFlagged: boolean;
  needsReviewBadgeText: string | null;
  canFlagOrUnflag: boolean;
  myFlag: boolean;
}

export function deriveInspectorOverviewMeta(
  feature: PolygonFeature,
  locale: Locale,
): InspectorOverviewMetaModel {
  const t = getTranslations(locale).inspector;
  const { properties } = feature;
  const displayAuthorHandle =
    locale === 'de' && properties.authorPseudonym === 'deleted'
      ? 'gelöscht'
      : properties.authorPseudonym;
  const entryDateText = formatInspectorDate(properties.createdAt, locale);
  const formattedLastLogin = formatInspectorDate(
    properties.authorLastLoginAt,
    locale,
  );

  return {
    displayAuthorHandle,
    authorIsNewUser: properties.authorIsNewUser,
    newContributorBadgeText: properties.authorIsNewUser
      ? t.newContributorBadge
      : null,
    entryDateText,
    authorLastLoginText: formattedLastLogin ?? t.creatorLastLoginUnknown,
    isFlagged: properties.isFlagged,
    needsReviewBadgeText: properties.isFlagged
      ? t.needsReviewBadge(properties.flagCount)
      : null,
    canFlagOrUnflag: !properties.isAuthor,
    myFlag: properties.myFlag,
  };
}

export const MIN_TOUCH_TARGET_DP = 44;

export interface MapControlsModel {
  locale: Locale;
  showOrthophotoToggle: boolean;
  basemapMode: BasemapMode;
  polygonOpacity: number;
  polygonFilter: PolygonFilter;
  orthophotoAttribution: string | null;
  apkDownloadUrl: string | null;
  apkSha256: string | null;
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
  collapsed: boolean;
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
    polygonOpacity: state.polygonOpacity,
    polygonFilter: state.polygonFilter,
    orthophotoAttribution: state.config?.orthophoto?.attribution ?? null,
    apkDownloadUrl: state.config?.apkDownloadUrl ?? null,
    apkSha256: state.config?.apkSha256 ?? null,
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
    collapsed: state.mode === 'drawing' && state.drawingSheetCollapsed,
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

export interface CommentThreadNode {
  readonly comment: PolygonComment;
  readonly parentAuthorPseudonym: string | null;
  readonly depth: number;
  readonly replies: readonly CommentThreadNode[];
}

export interface CommentDisplayModel {
  readonly topCommentId: string | null;
  readonly pinnedTopReply: {
    readonly comment: PolygonComment;
    readonly parentAuthorPseudonym: string | null;
  } | null;
  readonly roots: readonly CommentThreadNode[];
  readonly totalCount: number;
}

export function buildCommentDisplayModel(
  comments: readonly PolygonComment[],
): CommentDisplayModel {
  const sorted = sortPolygonCommentsByRating(comments);
  const topCommentId = findTopRatedCommentId(sorted);
  const byId = new Map<string, PolygonComment>(sorted.map((c) => [c.id, c]));

  const childrenMap = new Map<string, PolygonComment[]>();
  const rootComments: PolygonComment[] = [];

  for (const comment of sorted) {
    if (
      comment.parentId !== null &&
      comment.parentId !== comment.id &&
      byId.has(comment.parentId)
    ) {
      const bucket = childrenMap.get(comment.parentId);
      if (bucket) {
        bucket.push(comment);
      } else {
        childrenMap.set(comment.parentId, [comment]);
      }
    } else {
      rootComments.push(comment);
    }
  }

  const visited = new Set<string>();
  const buildNode = (
    comment: PolygonComment,
    depth: number,
  ): CommentThreadNode => {
    visited.add(comment.id);
    const parent =
      comment.parentId !== null ? (byId.get(comment.parentId) ?? null) : null;
    const rawChildren = childrenMap.get(comment.id) ?? [];
    const replies: CommentThreadNode[] = [];
    for (const child of rawChildren) {
      if (!visited.has(child.id)) {
        replies.push(buildNode(child, depth + 1));
      }
    }
    return {
      comment,
      parentAuthorPseudonym: parent ? parent.authorPseudonym : null,
      depth,
      replies,
    };
  };

  const roots = rootComments.map((comment) => buildNode(comment, 0));
  const topComment =
    topCommentId !== null ? (byId.get(topCommentId) ?? null) : null;
  const pinnedTopReply =
    topComment !== null &&
    topComment.parentId !== null &&
    byId.has(topComment.parentId)
      ? {
          comment: topComment,
          parentAuthorPseudonym:
            byId.get(topComment.parentId)?.authorPseudonym ?? null,
        }
      : null;

  return {
    topCommentId,
    pinnedTopReply,
    roots,
    totalCount: sorted.length,
  };
}

export function pruneDeletedCommentSubtree(
  comments: readonly PolygonComment[],
  deletedCommentId: string,
): PolygonComment[] {
  const removedIds = new Set<string>([deletedCommentId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of comments) {
      if (
        !removedIds.has(item.id) &&
        item.parentId !== null &&
        removedIds.has(item.parentId)
      ) {
        removedIds.add(item.id);
        changed = true;
      }
    }
  }
  return comments.filter((item) => !removedIds.has(item.id));
}
