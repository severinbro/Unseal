// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import {
  AUTHOR_ACTIVITY,
  findTopRatedCommentId,
  GEOMETRY_LIMITS,
  PHOTO_LIMITS,
  sortPolygonCommentsByRating,
  validateDraftPolygon,
  type AuthUser,
  type ImportLicense,
  type PolygonComment,
  type PolygonFeature,
  type PolygonFilter,
  type PolygonOrigin,
  type SurfaceType,
} from '@openunseal/shared';

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
import {
  resolveColorScheme,
  type ColorScheme,
  type ThemePreference,
  type ViewportTier,
} from '../theme/tokens';

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

export function formatStatsInteger(value: number, locale: Locale): string {
  const safe = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  return safe.toLocaleString(locale === 'de' ? 'de-DE' : 'en-US');
}

export function formatAreaDisplay(areaM2: number, locale: Locale): string {
  const safe = Number.isFinite(areaM2) && areaM2 > 0 ? areaM2 : 0;
  const numLocale = locale === 'de' ? 'de-DE' : 'en-US';
  if (safe >= 10_000) {
    const hectares = safe / 10_000;
    const haFormatted = hectares.toLocaleString(numLocale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const m2Formatted = Math.round(safe).toLocaleString(numLocale);
    return `${haFormatted} ha (${m2Formatted} m²)`;
  }
  const digits = safe > 0 && safe < 10 ? 1 : 0;
  const formatted = safe.toLocaleString(numLocale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
  return `${formatted} m²`;
}

export interface InspectorOverviewMetaModel {
  displayAuthorHandle: string;
  authorIsNewUser: boolean;
  newContributorBadgeText: string | null;
  entryDateText: string | null;
  authorActivityText: string;
  isFlagged: boolean;
  needsReviewBadgeText: string | null;
  canFlagOrUnflag: boolean;
  myFlag: boolean;
}

export function deriveInspectorOverviewMeta(
  feature: PolygonFeature,
  locale: Locale,
  isAdmin: boolean = false,
): InspectorOverviewMetaModel {
  const t = getTranslations(locale).inspector;
  const { properties } = feature;
  const displayAuthorHandle =
    locale === 'de' && properties.authorPseudonym === 'deleted'
      ? 'gelöscht'
      : properties.authorPseudonym;
  const entryDateText = formatInspectorDate(properties.createdAt, locale);
  const authorActivityText =
    properties.authorRecentlyActive === true
      ? t.creatorActivityRecent(AUTHOR_ACTIVITY.RECENT_DAYS)
      : properties.authorRecentlyActive === false
        ? t.creatorActivityInactive
        : t.creatorActivityUnknown;
  const canSeeFlag = Boolean(properties.isAuthor) || isAdmin;
  const visibleIsFlagged = canSeeFlag && properties.isFlagged;

  return {
    displayAuthorHandle,
    authorIsNewUser: properties.authorIsNewUser,
    newContributorBadgeText: properties.authorIsNewUser
      ? t.newContributorBadge
      : null,
    entryDateText,
    authorActivityText,
    isFlagged: visibleIsFlagged,
    needsReviewBadgeText: visibleIsFlagged
      ? t.needsReviewBadge(properties.flagCount)
      : null,
    canFlagOrUnflag: !properties.isAuthor,
    myFlag: properties.myFlag,
  };
}

export interface InspectorManagePermissionsModel {
  canEditDetails: boolean;
  canDeletePolygon: boolean;
  canAdminDeleteNonAuthorPolygon: boolean;
  showReadonlyHint: boolean;
}

export function deriveInspectorManagePermissions(
  feature: PolygonFeature,
  isAdmin: boolean,
): InspectorManagePermissionsModel {
  const isAuthor = Boolean(feature.properties.isAuthor);
  return {
    canEditDetails: isAuthor,
    canDeletePolygon: isAuthor || isAdmin,
    canAdminDeleteNonAuthorPolygon: isAdmin && !isAuthor,
    showReadonlyHint: !isAdmin && !isAuthor,
  };
}

export const MIN_TOUCH_TARGET_DP = 44;

export interface MapControlsModel {
  locale: Locale;
  colorScheme: ColorScheme;
  themePreference: ThemePreference;
  showOrthophotoToggle: boolean;
  basemapMode: BasemapMode;
  polygonOpacity: number;
  polygonFilter: PolygonFilter;
  highlightMineOnly: boolean;
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

export function computeVisibleProposalCount(
  state: Pick<AppState, 'features' | 'currentUser' | 'highlightMineOnly'>,
): number {
  if (state.currentUser !== null && state.highlightMineOnly) {
    let mineCount = 0;
    for (const feature of state.features) {
      if (feature.properties.isAuthor) {
        mineCount++;
      }
    }
    return mineCount;
  }
  return state.features.length;
}

export function deriveMapControlsModel(
  state: AppState,
  systemColorScheme?: ColorScheme | 'unspecified' | null,
): MapControlsModel {
  const t = getTranslations(state.locale);
  const colorScheme = resolveColorScheme(
    state.themePreference,
    systemColorScheme,
  );
  const showOrthophotoToggle =
    state.config !== null && state.config.orthophoto !== null;
  const effectiveBasemapMode: BasemapMode = showOrthophotoToggle
    ? state.basemapMode
    : 'osm';
  const zoomInPromptText = t.controls.zoomInPrompt;

  return {
    locale: state.locale,
    colorScheme,
    themePreference: state.themePreference,
    showOrthophotoToggle,
    basemapMode: effectiveBasemapMode,
    polygonOpacity: state.polygonOpacity,
    polygonFilter: state.polygonFilter,
    highlightMineOnly: state.currentUser !== null && state.highlightMineOnly,
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

export interface NavbarLayoutMode {
  readonly isCompact: boolean;
  readonly isSingleHeaderRow: boolean;
  readonly showSearchBarInNavbar: boolean;
  readonly showProposeFab: boolean;
  readonly useCompactCountBadge: boolean;
  readonly constrainAccountChipWidth: boolean;
  readonly collapseThemeToMenu: boolean;
  readonly collapseLocaleToMenu: boolean;
  readonly hideBrandTitle: boolean;
  readonly hideCountBadge: boolean;
  readonly iconOnlyAccount: boolean;
}

/**
 * Derives responsive single-row navbar rules for `MapControlsBar` + floating
 * map overlays across phone (<768 px), tablet (768-1099 px), and wide (>=1100 px).
 *
 * The `?` info button stays in the top navbar on every viewport. The `DE | EN`
 * language switch sits beside it on all standard phones (>=360 px) and larger
 * screens, collapsing into the overflow menu only on ultra-narrow (<360 px)
 * devices; the theme toggle collapses into the overflow menu below 520 px.
 *
 * The map, feed and chat icons are in the navbar on every viewport. Where they
 * do not fit beside everything else, the app name gives way first (the logo
 * stays), then the account name (its icon stays), then the count badge.
 */
export function deriveNavbarLayoutMode(
  tier: ViewportTier,
  viewportWidth?: number,
): NavbarLayoutMode {
  const isCompact = tier === 'compact';
  const hasKnownWidth =
    viewportWidth !== undefined &&
    Number.isFinite(viewportWidth) &&
    viewportWidth > 0;

  if (isCompact) {
    return {
      isCompact: true,
      isSingleHeaderRow: true,
      showSearchBarInNavbar: false,
      showProposeFab: true,
      useCompactCountBadge: true,
      constrainAccountChipWidth: true,
      collapseThemeToMenu: !hasKnownWidth || viewportWidth < 520,
      collapseLocaleToMenu: hasKnownWidth && viewportWidth < 360,
      hideBrandTitle: !hasKnownWidth || viewportWidth < 640,
      hideCountBadge: !hasKnownWidth || viewportWidth < 390,
      iconOnlyAccount: !hasKnownWidth || viewportWidth < 460,
    };
  }

  return {
    isCompact: false,
    isSingleHeaderRow: true,
    showSearchBarInNavbar: true,
    showProposeFab: true,
    useCompactCountBadge: hasKnownWidth && viewportWidth < 920,
    constrainAccountChipWidth: hasKnownWidth && viewportWidth < 1100,
    collapseThemeToMenu: false,
    collapseLocaleToMenu: false,
    hideBrandTitle: hasKnownWidth && viewportWidth < 1060,
    hideCountBadge: false,
    iconOnlyAccount: false,
  };
}

export function importLicenseRequiresWaiver(license: ImportLicense): boolean {
  return license === 'CC-BY-4.0' || license === 'dl-de/by-2-0';
}

export function importLicenseRequiresAttribution(
  license: ImportLicense,
): boolean {
  return (
    license === 'ODbL-1.0' ||
    license === 'CC-BY-4.0' ||
    license === 'dl-de/by-2-0'
  );
}

export interface ValidatedAdminImportOptions {
  readonly origin: PolygonOrigin;
  readonly license: ImportLicense;
  readonly attribution: string | null;
  readonly sourceUrl: string | null;
  readonly waiverConfirmed: boolean;
}

export type AdminImportValidationResult =
  | { readonly ok: true; readonly options: ValidatedAdminImportOptions }
  | { readonly ok: false; readonly errorMessage: string };

export function validateAdminImportForm(input: {
  readonly origin: PolygonOrigin;
  readonly license: ImportLicense;
  readonly attribution: string;
  readonly sourceUrl: string;
  readonly waiverConfirmed: boolean;
  readonly locale: Locale;
}): AdminImportValidationResult {
  const t = getTranslations(input.locale).adminImport;
  const needsAttribution = importLicenseRequiresAttribution(input.license);
  const needsWaiver = importLicenseRequiresWaiver(input.license);

  const trimmedAttribution = input.attribution.trim();
  if (needsAttribution && trimmedAttribution.length === 0) {
    return { ok: false, errorMessage: t.attributionRequiredError };
  }

  const trimmedUrl = input.sourceUrl.trim();
  if (
    trimmedUrl.length > 0 &&
    !trimmedUrl.startsWith('https://') &&
    !trimmedUrl.startsWith('http://')
  ) {
    return { ok: false, errorMessage: t.sourceUrlInvalidError };
  }

  if (needsWaiver && !input.waiverConfirmed) {
    return { ok: false, errorMessage: t.waiverRequiredError };
  }

  return {
    ok: true,
    options: {
      origin: input.origin,
      license: input.license,
      attribution: trimmedAttribution.length > 0 ? trimmedAttribution : null,
      sourceUrl: trimmedUrl.length > 0 ? trimmedUrl : null,
      waiverConfirmed: needsWaiver ? input.waiverConfirmed : false,
    },
  };
}
