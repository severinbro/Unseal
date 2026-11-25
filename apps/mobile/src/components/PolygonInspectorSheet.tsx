// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import {
  COMMENT_LIMITS,
  GEOMETRY_LIMITS,
  PHOTO_LIMITS,
  POLYGON_FLAG_REASONS,
  POLYGON_STATUSES,
  SURFACE_TYPES,
  type CommentVoteResponse,
  type ContentReportTargetType,
  type CreatePolygonCommentRequest,
  type FlagPolygonResponse,
  type PatchPolygonRequest,
  type PhotoVoteResponse,
  type PolygonComment,
  type PolygonCommentListResponse,
  type PolygonFeature,
  type PolygonFlagReason,
  type PolygonPhoto,
  type PolygonStatus,
  type SurfaceType,
} from '@openunseal/shared';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

const CC_BY_4_0_URL = 'https://creativecommons.org/licenses/by/4.0/';

function openLicenseUrl(url: string): void {
  if (Platform.OS === 'web') {
    const scope = globalThis as {
      window?: { open?: (u: string, target?: string, features?: string) => void };
    };
    if (typeof scope.window?.open === 'function') {
      scope.window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
  }
  void Linking.openURL(url);
}

import {
  DEFAULT_LOCALE,
  getTranslations,
  localizeDisclaimerText,
  localizeError,
  type Locale,
} from '../i18n/translations';
import { getSocialCopy } from '../i18n/social';
import {
  buildCommentDisplayModel,
  deriveInspectorManagePermissions,
  deriveInspectorOverviewMeta,
  formatInspectorDate,
  pruneDeletedCommentSubtree,
  type CommentDisplayModel,
  type CommentThreadNode,
  type InspectorManagePermissionsModel,
  type InspectorOverviewMetaModel,
} from '../state/viewModels';
import { useTheme } from '../theme/themeContext';
import {
  PolygonCardTitle,
  PolygonCreatorCard,
  PolygonNoteCard,
  PolygonVotePanel,
} from './PolygonCardParts';
import { createPolygonCardStyles } from './polygonCardStyles';

export type InspectorTab = 'overview' | 'comments' | 'photos' | 'manage';
export {
  buildCommentDisplayModel,
  deriveInspectorManagePermissions,
  deriveInspectorOverviewMeta,
  formatInspectorDate,
  pruneDeletedCommentSubtree,
  type CommentDisplayModel,
  type CommentThreadNode,
  type InspectorManagePermissionsModel,
  type InspectorOverviewMetaModel,
};

export interface PolygonInspectorSheetProps {
  feature: PolygonFeature | null;
  overlapIndex: number;
  overlapCount: number;
  disclaimerText?: string;
  abuseContact: string | null;
  isAuthenticated: boolean;
  isAdmin?: boolean;
  locale?: Locale;
  compact?: boolean;
  resolveUploadUrl?: (relativePath: string) => string;
  onOpenAuth?: () => void;
  onCycleOverlap: () => void;
  onClose: () => void;
  onVoteIntent: (polygonId: string, value: 1 | -1) => void;
  onCastVote: (polygonId: string, value: 1 | -1) => Promise<void>;
  onClearVote: (polygonId: string) => Promise<void>;
  onPatchPolygon: (
    polygonId: string,
    patch: PatchPolygonRequest,
  ) => Promise<void>;
  onPatchPolygonStatus?: (
    polygonId: string,
    status: PolygonStatus,
  ) => Promise<void>;
  onDeletePolygon: (polygonId: string) => Promise<void>;
  onListPhotos?: (polygonId: string) => Promise<PolygonPhoto[]>;
  onUploadPhotoFromCamera?: (polygonId: string) => Promise<PolygonPhoto | null>;
  onUploadPhotoFromLibrary?: (
    polygonId: string,
  ) => Promise<PolygonPhoto | null>;
  onUploadPhotosFromLibrary?: (
    polygonId: string,
    onProgress?: (current: number, total: number) => void,
  ) => Promise<PolygonPhoto[]>;
  onVotePhoto?: (
    photoId: string,
    value: 1 | -1,
  ) => Promise<PhotoVoteResponse>;
  onClearPhotoVote?: (photoId: string) => Promise<PhotoVoteResponse>;
  onDeletePhoto?: (photoId: string, polygonId: string) => Promise<void>;
  onListComments?: (polygonId: string) => Promise<PolygonCommentListResponse>;
  onCreateComment?: (
    polygonId: string,
    input: CreatePolygonCommentRequest,
  ) => Promise<PolygonComment>;
  onVoteComment?: (commentId: string) => Promise<CommentVoteResponse>;
  onClearCommentVote?: (commentId: string) => Promise<CommentVoteResponse>;
  onDeleteComment?: (commentId: string, polygonId: string) => Promise<void>;
  onFlagPolygon?: (
    polygonId: string,
    reason: PolygonFlagReason,
  ) => Promise<FlagPolygonResponse>;
  onUnflagPolygon?: (polygonId: string) => Promise<FlagPolygonResponse>;
  onClearPolygonFlags?: (polygonId: string) => Promise<FlagPolygonResponse>;
  onReportContent?: (target: {
    targetType: ContentReportTargetType;
    targetId: string;
  }) => void;
  /** Attaches a reference to this comment to a direct message. */
  onShareCommentInChat?: (commentId: string) => void;
  /** Opens the given tab for that area, for example when coming from the feed. */
  requestedTab?: { featureId: string; tab: InspectorTab; seq: number } | null;
}

export function PolygonInspectorSheet({
  feature,
  overlapIndex,
  overlapCount,
  disclaimerText,
  abuseContact,
  isAuthenticated,
  isAdmin = false,
  locale = DEFAULT_LOCALE,
  compact = false,
  resolveUploadUrl,
  onOpenAuth,
  onCycleOverlap,
  onClose,
  onVoteIntent,
  onCastVote,
  onClearVote,
  onPatchPolygon,
  onPatchPolygonStatus,
  onDeletePolygon,
  onListPhotos,
  onUploadPhotoFromCamera,
  onUploadPhotoFromLibrary,
  onUploadPhotosFromLibrary,
  onVotePhoto,
  onClearPhotoVote,
  onDeletePhoto,
  onListComments,
  onCreateComment,
  onVoteComment,
  onClearCommentVote,
  onDeleteComment,
  onFlagPolygon,
  onUnflagPolygon,
  onClearPolygonFlags,
  onReportContent,
  onShareCommentInChat,
  requestedTab = null,
}: PolygonInspectorSheetProps): React.JSX.Element | null {
  const { palette } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const lightboxImageHeight = Math.round(
    Math.min(460, Math.max(160, windowHeight * 0.58)),
  );
  const styles = useMemo(() => createPolygonCardStyles(palette), [palette]);
  const [activeTab, setActiveTab] = useState<InspectorTab>('overview');
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editSurfaceType, setEditSurfaceType] =
    useState<SurfaceType>('asphalt');
  const [editNote, setEditNote] = useState<string>('');
  const [confirmingDelete, setConfirmingDelete] = useState<boolean>(false);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [photos, setPhotos] = useState<PolygonPhoto[]>([]);
  const [photosLoadedForId, setPhotosLoadedForId] = useState<string | null>(
    null,
  );
  const [isLoadingPhotos, setIsLoadingPhotos] = useState<boolean>(false);
  const [uploadingPhotoSource, setUploadingPhotoSource] = useState<
    'camera' | 'library' | null
  >(null);
  const [uploadingPhotoProgress, setUploadingPhotoProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [revealedFakeIds, setRevealedFakeIds] = useState<
    Record<string, boolean>
  >({});
  const [lightboxPhoto, setLightboxPhoto] = useState<PolygonPhoto | null>(null);

  const [comments, setComments] = useState<PolygonComment[]>([]);
  const [commentsLoadedForId, setCommentsLoadedForId] = useState<string | null>(
    null,
  );
  const [isLoadingComments, setIsLoadingComments] = useState<boolean>(false);
  const [isSubmittingComment, setIsSubmittingComment] =
    useState<boolean>(false);
  const [newCommentBody, setNewCommentBody] = useState<string>('');
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  const [replyDraftBody, setReplyDraftBody] = useState<string>('');
  const [isFlagPickerOpen, setIsFlagPickerOpen] = useState<boolean>(false);
  const [selectedFlagReason, setSelectedFlagReason] =
    useState<PolygonFlagReason>('implausible');
  const [isFlagging, setIsFlagging] = useState<boolean>(false);

  const featureId = feature?.id ?? null;
  const featureSurfaceType = feature?.properties.surfaceType ?? 'asphalt';
  const featureNote = feature?.properties.note ?? '';
  const featurePhotoCount = feature?.properties.photoCount ?? 0;
  const featureCommentCount = feature?.properties.commentCount ?? 0;

  const commentDisplay = useMemo(
    () => buildCommentDisplayModel(comments),
    [comments],
  );

  const requestedTabRef = useRef(requestedTab);
  requestedTabRef.current = requestedTab;

  useEffect(() => {
    const requested = requestedTabRef.current;
    setActiveTab(
      requested !== null && requested.featureId === featureId
        ? requested.tab
        : 'overview',
    );
    setIsEditing(false);
    setConfirmingDelete(false);
    setActionError(null);
    setEditSurfaceType(featureSurfaceType);
    setEditNote(featureNote);
    setPhotos([]);
    setPhotosLoadedForId(null);
    setUploadingPhotoSource(null);
    setUploadingPhotoProgress(null);
    setRevealedFakeIds({});
    setLightboxPhoto(null);
    setComments([]);
    setCommentsLoadedForId(null);
    setNewCommentBody('');
    setReplyTargetId(null);
    setReplyDraftBody('');
    setIsFlagPickerOpen(false);
    setSelectedFlagReason('implausible');
    setIsFlagging(false);
  }, [featureId]);

  const requestedSeq = requestedTab?.seq ?? null;
  useEffect(() => {
    // The same area can be opened again on another tab.
    const requested = requestedTabRef.current;
    if (requested !== null && requested.featureId === featureId) {
      setActiveTab(requested.tab);
    }
  }, [requestedSeq, featureId]);

  useEffect(() => {
    if (!isEditing) {
      setEditSurfaceType(featureSurfaceType);
      setEditNote(featureNote);
    }
  }, [featureSurfaceType, featureNote, isEditing]);

  const loadPhotosForFeature = useCallback(
    async (polygonId: string): Promise<void> => {
      if (!onListPhotos) {
        return;
      }
      setIsLoadingPhotos(true);
      try {
        const list = await onListPhotos(polygonId);
        setPhotos(list);
        setPhotosLoadedForId(polygonId);
      } catch (err: unknown) {
        const fallback = getTranslations(locale).inspector.photoErrorFallback;
        setActionError(localizeError(err, fallback, locale));
      } finally {
        setIsLoadingPhotos(false);
      }
    },
    [locale, onListPhotos],
  );

  const loadCommentsForFeature = useCallback(
    async (polygonId: string): Promise<void> => {
      if (!onListComments) {
        return;
      }
      setIsLoadingComments(true);
      try {
        const response = await onListComments(polygonId);
        setComments(response.comments);
        setCommentsLoadedForId(polygonId);
      } catch (err: unknown) {
        const fallback = getTranslations(locale).inspector.commentErrorFallback;
        setActionError(localizeError(err, fallback, locale));
      } finally {
        setIsLoadingComments(false);
      }
    },
    [locale, onListComments],
  );

  useEffect(() => {
    if (
      featureId !== null &&
      activeTab === 'photos' &&
      photosLoadedForId !== featureId &&
      onListPhotos
    ) {
      void loadPhotosForFeature(featureId);
    }
  }, [
    activeTab,
    featureId,
    featurePhotoCount,
    loadPhotosForFeature,
    onListPhotos,
    photosLoadedForId,
  ]);

  useEffect(() => {
    if (
      featureId !== null &&
      activeTab === 'comments' &&
      commentsLoadedForId !== featureId &&
      onListComments
    ) {
      void loadCommentsForFeature(featureId);
    }
  }, [
    activeTab,
    commentsLoadedForId,
    featureCommentCount,
    featureId,
    loadCommentsForFeature,
    onListComments,
  ]);

  if (feature === null) {
    return null;
  }

  const dict = getTranslations(locale);
  const t = dict.inspector;
  const surfaceCopy = dict.surfaces;

  const { properties } = feature;
  const isFinished = properties.status === 'finished';
  const isInProgress = properties.status === 'in_progress';
  // Deviating private claims stay open for voting until an admin decides.
  const isOverride = properties.spaceVerification === 'user_override';
  const isVotingClosedByStatus = (isInProgress || isFinished) && !isOverride;
  const areCommentsClosed = isFinished && properties.spaceType !== 'private';
  const effectiveOverlapCount = Math.max(1, overlapCount);
  const displayOverlapPosition = Math.min(
    effectiveOverlapCount,
    overlapIndex + 1,
  );
  const displayedPhotoCount =
    photosLoadedForId === feature.id ? photos.length : properties.photoCount;
  const displayedCommentCount =
    commentsLoadedForId === feature.id
      ? comments.length
      : properties.commentCount;

  const toPhotoUrl = (rawUrl: string): string =>
    resolveUploadUrl ? resolveUploadUrl(rawUrl) : rawUrl;

  const handleVotePress = (targetValue: 1 | -1): void => {
    if (properties.isAuthor || isVotingClosedByStatus) {
      return;
    }
    setActionError(null);
    if (!isAuthenticated) {
      onVoteIntent(feature.id, targetValue);
      return;
    }

    setIsBusy(true);
    const task =
      properties.myVote === targetValue
        ? onClearVote(feature.id)
        : onCastVote(feature.id, targetValue);

    void task
      .catch((err: unknown) => {
        setActionError(localizeError(err, t.voteErrorFallback, locale));
      })
      .finally(() => {
        setIsBusy(false);
      });
  };

  const managePermissions = deriveInspectorManagePermissions(feature, isAdmin);

  const handleSavePatch = (): void => {
    if (!managePermissions.canEditDetails) {
      return;
    }
    setActionError(null);
    setIsBusy(true);
    const trimmed = editNote.trim();
    const patchPayload: PatchPolygonRequest = {
      surfaceType: editSurfaceType,
      note: trimmed.length === 0 ? null : trimmed,
    };

    void onPatchPolygon(feature.id, patchPayload)
      .then(() => {
        setIsEditing(false);
      })
      .catch((err: unknown) => {
        setActionError(localizeError(err, t.patchErrorFallback, locale));
      })
      .finally(() => {
        setIsBusy(false);
      });
  };

  const handleSetStatus = (nextStatus: PolygonStatus): void => {
    if (!onPatchPolygonStatus || nextStatus === properties.status) {
      return;
    }
    setActionError(null);
    setIsBusy(true);

    void onPatchPolygonStatus(feature.id, nextStatus)
      .catch((err: unknown) => {
        setActionError(localizeError(err, t.statusErrorFallback, locale));
      })
      .finally(() => {
        setIsBusy(false);
      });
  };

  const handleConfirmDelete = (): void => {
    if (!managePermissions.canDeletePolygon) {
      return;
    }
    setActionError(null);
    setIsBusy(true);

    void onDeletePolygon(feature.id)
      .catch((err: unknown) => {
        setActionError(localizeError(err, t.deleteErrorFallback, locale));
      })
      .finally(() => {
        setIsBusy(false);
      });
  };

  const handleUploadPhoto = (source: 'camera' | 'library'): void => {
    if (source === 'library' && onUploadPhotosFromLibrary) {
      if (!isAuthenticated) {
        onOpenAuth?.();
        return;
      }
      setActionError(null);
      setUploadingPhotoSource('library');
      setUploadingPhotoProgress(null);
      void onUploadPhotosFromLibrary(feature.id, (current, total) => {
        setUploadingPhotoProgress({ current, total });
      })
        .then((uploadedList) => {
          if (uploadedList.length > 0) {
            const uploadedIds = new Set(uploadedList.map((item) => item.id));
            setPhotos((prev) => [
              ...[...uploadedList].reverse(),
              ...prev.filter((p) => !uploadedIds.has(p.id)),
            ]);
            setPhotosLoadedForId(feature.id);
          }
        })
        .catch((err: unknown) => {
          setActionError(localizeError(err, t.photoErrorFallback, locale));
        })
        .finally(() => {
          setUploadingPhotoSource(null);
          setUploadingPhotoProgress(null);
        });
      return;
    }

    const handler =
      source === 'camera'
        ? onUploadPhotoFromCamera
        : onUploadPhotoFromLibrary;
    if (!handler) {
      return;
    }
    if (!isAuthenticated) {
      onOpenAuth?.();
      return;
    }

    setActionError(null);
    setUploadingPhotoSource(source);
    setUploadingPhotoProgress(null);
    void handler(feature.id)
      .then((uploaded) => {
        if (uploaded) {
          setPhotos((prev) => [
            uploaded,
            ...prev.filter((p) => p.id !== uploaded.id),
          ]);
          setPhotosLoadedForId(feature.id);
        }
      })
      .catch((err: unknown) => {
        setActionError(localizeError(err, t.photoErrorFallback, locale));
      })
      .finally(() => {
        setUploadingPhotoSource(null);
        setUploadingPhotoProgress(null);
      });
  };

  const handlePhotoVote = (photo: PolygonPhoto, value: 1 | -1): void => {
    if (photo.isUploader) {
      return;
    }
    if (!isAuthenticated) {
      onOpenAuth?.();
      return;
    }
    if (!onVotePhoto || !onClearPhotoVote) {
      return;
    }

    setActionError(null);
    setIsBusy(true);
    const task =
      photo.myVote === value
        ? onClearPhotoVote(photo.id)
        : onVotePhoto(photo.id, value);

    void task
      .then((res) => {
        setPhotos((prev) =>
          prev.map((item) =>
            item.id === res.photoId
              ? {
                  ...item,
                  realVotes: res.realVotes,
                  fakeVotes: res.fakeVotes,
                  credibilityScore: res.credibilityScore,
                  myVote: res.myVote,
                  isFlaggedFake: res.isFlaggedFake,
                }
              : item,
          ),
        );
      })
      .catch((err: unknown) => {
        setActionError(localizeError(err, t.photoErrorFallback, locale));
      })
      .finally(() => {
        setIsBusy(false);
      });
  };

  const handleDeletePhotoPress = (photoId: string): void => {
    if (!onDeletePhoto) {
      return;
    }
    setActionError(null);
    setIsBusy(true);
    void onDeletePhoto(photoId, feature.id)
      .then(() => {
        setPhotos((prev) => prev.filter((item) => item.id !== photoId));
      })
      .catch((err: unknown) => {
        setActionError(localizeError(err, t.photoErrorFallback, locale));
      })
      .finally(() => {
        setIsBusy(false);
      });
  };

  const handleCreateCommentSubmit = (parentId: string | null): void => {
    if (areCommentsClosed || !onCreateComment) {
      return;
    }
    if (!isAuthenticated) {
      onOpenAuth?.();
      return;
    }
    const rawBody = parentId === null ? newCommentBody : replyDraftBody;
    const trimmed = rawBody.trim();
    if (trimmed.length === 0) {
      return;
    }

    setActionError(null);
    setIsSubmittingComment(true);
    void onCreateComment(feature.id, {
      body: trimmed,
      parentId,
    })
      .then((created) => {
        setComments((prev) => [
          created,
          ...prev.filter((item) => item.id !== created.id),
        ]);
        setCommentsLoadedForId(feature.id);
        if (parentId === null) {
          setNewCommentBody('');
        } else {
          setReplyTargetId(null);
          setReplyDraftBody('');
        }
      })
      .catch((err: unknown) => {
        setActionError(localizeError(err, t.commentErrorFallback, locale));
      })
      .finally(() => {
        setIsSubmittingComment(false);
      });
  };

  const handleCommentVotePress = (comment: PolygonComment): void => {
    if (comment.isAuthor) {
      return;
    }
    if (!isAuthenticated) {
      onOpenAuth?.();
      return;
    }
    if (!onVoteComment || !onClearCommentVote) {
      return;
    }

    setActionError(null);
    setIsBusy(true);
    const task =
      comment.myVote === 1
        ? onClearCommentVote(comment.id)
        : onVoteComment(comment.id);

    void task
      .then((res) => {
        setComments((prev) =>
          prev.map((item) =>
            item.id === res.commentId
              ? {
                  ...item,
                  upvotes: res.upvotes,
                  myVote: res.myVote,
                }
              : item,
          ),
        );
      })
      .catch((err: unknown) => {
        setActionError(localizeError(err, t.commentErrorFallback, locale));
      })
      .finally(() => {
        setIsBusy(false);
      });
  };

  const handleDeleteCommentPress = (commentId: string): void => {
    if (!onDeleteComment) {
      return;
    }
    setActionError(null);
    setIsBusy(true);
    void onDeleteComment(commentId, feature.id)
      .then(() => {
        setComments((prev) => pruneDeletedCommentSubtree(prev, commentId));
        if (replyTargetId === commentId) {
          setReplyTargetId(null);
          setReplyDraftBody('');
        }
      })
      .catch((err: unknown) => {
        setActionError(localizeError(err, t.commentErrorFallback, locale));
      })
      .finally(() => {
        setIsBusy(false);
      });
  };

  const handleFlagSubmit = (): void => {
    if (!onFlagPolygon) {
      return;
    }
    if (!isAuthenticated) {
      onOpenAuth?.();
      return;
    }
    setActionError(null);
    setIsFlagging(true);
    void onFlagPolygon(feature.id, selectedFlagReason)
      .then(() => {
        setIsFlagPickerOpen(false);
      })
      .catch((err: unknown) => {
        setActionError(localizeError(err, t.flagErrorFallback, locale));
      })
      .finally(() => {
        setIsFlagging(false);
      });
  };

  const handleUnflagPress = (): void => {
    if (!onUnflagPolygon) {
      return;
    }
    if (!isAuthenticated) {
      onOpenAuth?.();
      return;
    }
    setActionError(null);
    setIsFlagging(true);
    void onUnflagPolygon(feature.id)
      .catch((err: unknown) => {
        setActionError(localizeError(err, t.flagErrorFallback, locale));
      })
      .finally(() => {
        setIsFlagging(false);
      });
  };

  const handleClearFlagsAdminPress = (): void => {
    if (!onClearPolygonFlags) {
      return;
    }
    setActionError(null);
    setIsFlagging(true);
    void onClearPolygonFlags(feature.id)
      .catch((err: unknown) => {
        setActionError(localizeError(err, t.flagErrorFallback, locale));
      })
      .finally(() => {
        setIsFlagging(false);
      });
  };


  const formatCommentTimestamp = (iso: string): string => {
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) {
      return '';
    }
    return parsed.toISOString().slice(0, 10);
  };

  const renderCommentThreadNode = (
    node: CommentThreadNode,
  ): React.JSX.Element => {
    const { comment, parentAuthorPseudonym, depth, replies } = node;
    const isTopComment = commentDisplay.topCommentId === comment.id;
    const isReplyingHere = replyTargetId === comment.id;
    const canReply = depth + 1 < COMMENT_LIMITS.MAX_REPLY_DEPTH;
    const indentPx = Math.min(depth, 3) * 14;
    const formattedDate = formatCommentTimestamp(comment.createdAt);

    return (
      <View key={comment.id} style={styles.commentThreadGroup}>
        <View
          style={[
            styles.commentCard,
            depth > 0 ? { marginLeft: indentPx } : null,
            depth > 0 ? styles.commentReplyCard : null,
            isTopComment ? styles.commentCardTopRated : null,
          ]}
        >
          {isTopComment || parentAuthorPseudonym !== null ? (
            <View style={styles.commentBadgesRow}>
              {isTopComment ? (
                <View style={styles.topCommentBadge}>
                  <Text style={styles.topCommentBadgeLabel}>
                    {t.topCommentBadge}
                  </Text>
                </View>
              ) : null}
              {parentAuthorPseudonym !== null ? (
                <Text style={styles.replyingToMeta}>
                  {t.replyingToLabel(parentAuthorPseudonym)}
                </Text>
              ) : null}
            </View>
          ) : null}

          <View style={styles.commentHeaderRow}>
            <Text style={styles.commentAuthorLabel}>
              {t.commentAuthorLabel(comment.authorPseudonym, comment.isAuthor)}
            </Text>
            {formattedDate ? (
              <Text style={styles.commentDateLabel}>{formattedDate}</Text>
            ) : null}
          </View>

          <Text style={styles.commentBodyText}>{comment.body}</Text>

          <View style={styles.commentActionsRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.upvoteCommentA11y(comment.upvotes)}
              accessibilityState={{
                selected: comment.myVote === 1,
                disabled: isBusy || comment.isAuthor,
              }}
              disabled={isBusy || comment.isAuthor}
              onPress={() => handleCommentVotePress(comment)}
              style={[
                styles.photoVotePill,
                comment.myVote === 1 ? styles.photoVotePillRealActive : null,
                comment.isAuthor ? styles.disabledButton : null,
              ]}
            >
              <Text
                style={[
                  styles.photoVoteLabel,
                  comment.myVote === 1 ? styles.photoVoteLabelActive : null,
                ]}
              >
                ▲ {comment.upvotes}
              </Text>
            </Pressable>

            {canReply && !areCommentsClosed && onCreateComment ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.replyButton}
                disabled={isSubmittingComment}
                onPress={() => {
                  if (!isAuthenticated) {
                    onOpenAuth?.();
                    return;
                  }
                  if (isReplyingHere) {
                    setReplyTargetId(null);
                    setReplyDraftBody('');
                  } else {
                    setReplyTargetId(comment.id);
                    setReplyDraftBody('');
                  }
                }}
                style={styles.commentReplyPill}
              >
                <Text style={styles.commentReplyPillLabel}>
                  {isReplyingHere ? t.cancelReplyButton : t.replyButton}
                </Text>
              </Pressable>
            ) : null}

            {(comment.isAuthor || isAdmin) && onDeleteComment ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.deleteCommentA11y}
                disabled={isBusy}
                onPress={() => handleDeleteCommentPress(comment.id)}
                style={styles.photoDeletePill}
              >
                <Text style={styles.photoDeleteLabel}>{t.deleteComment}</Text>
              </Pressable>
            ) : null}

            {onShareCommentInChat && isAuthenticated ? (
              <Pressable
                testID={`share-comment-${comment.id}`}
                accessibilityRole="button"
                accessibilityLabel={getSocialCopy(locale).shareComment}
                onPress={() => onShareCommentInChat(comment.id)}
                style={styles.reportInlinePill}
              >
                <Text style={styles.reportInlineLabel}>
                  {getSocialCopy(locale).shareComment}
                </Text>
              </Pressable>
            ) : null}

            {onReportContent ? (
              <Pressable
                testID={`report-comment-${comment.id}`}
                accessibilityRole="button"
                accessibilityLabel={t.reportIllegalA11y}
                onPress={() =>
                  onReportContent({
                    targetType: 'comment',
                    targetId: comment.id,
                  })
                }
                style={styles.reportInlinePill}
              >
                <Text style={styles.reportInlineLabel}>
                  {t.reportIllegalShort}
                </Text>
              </Pressable>
            ) : null}
          </View>

          {isReplyingHere && !areCommentsClosed && isAuthenticated ? (
            <View style={styles.replyComposerBox}>
              <TextInput
                accessibilityLabel={t.replyInputPlaceholder(
                  comment.authorPseudonym,
                )}
                value={replyDraftBody}
                onChangeText={setReplyDraftBody}
                maxLength={COMMENT_LIMITS.MAX_BODY_LENGTH}
                multiline
                placeholder={t.replyInputPlaceholder(comment.authorPseudonym)}
                placeholderTextColor={palette.inkMuted}
                style={styles.commentInput}
              />
              <View style={styles.buttonRow}>
                <Pressable
                  accessibilityRole="button"
                  disabled={isSubmittingComment}
                  onPress={() => {
                    setReplyTargetId(null);
                    setReplyDraftBody('');
                  }}
                  style={[styles.touchButton, styles.secondaryButton]}
                >
                  <Text style={styles.secondaryButtonLabel}>
                    {t.cancelReplyButton}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={
                    isSubmittingComment || replyDraftBody.trim().length === 0
                  }
                  onPress={() => handleCreateCommentSubmit(comment.id)}
                  style={[
                    styles.touchButton,
                    styles.primaryButton,
                    replyDraftBody.trim().length === 0
                      ? styles.disabledButton
                      : null,
                  ]}
                >
                  <Text style={styles.primaryButtonLabel}>
                    {isSubmittingComment ? t.postingComment : t.postReply}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>

        {replies.length > 0 ? (
          <View style={styles.commentRepliesStack}>
            {replies.map((replyNode) => renderCommentThreadNode(replyNode))}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View
      style={[styles.sheet, compact ? styles.sheetCompact : null]}
      accessibilityLabel={t.sheetA11y}
    >
      <View style={styles.headerRow}>
        <View style={styles.headerTitleGroup}>
          <PolygonCardTitle feature={feature} locale={locale} isAdmin={isAdmin} />
        </View>

        <View style={styles.headerControls}>
          {effectiveOverlapCount > 1 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.overlapA11y(
                displayOverlapPosition,
                effectiveOverlapCount,
              )}
              onPress={onCycleOverlap}
              style={styles.overlapButton}
            >
              <Text style={styles.overlapButtonLabel}>
                {t.overlapNext(displayOverlapPosition, effectiveOverlapCount)}
              </Text>
            </Pressable>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.closeA11y}
            onPress={onClose}
            style={styles.closeButton}
          >
            <Text style={styles.closeButtonLabel}>{t.close}</Text>
          </Pressable>
        </View>
      </View>

      <PolygonVotePanel
        feature={feature}
        locale={locale}
        busy={isBusy}
        onVotePress={handleVotePress}
      />

      <View style={styles.tabWell} accessibilityRole="tablist">
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'overview' }}
          onPress={() => setActiveTab('overview')}
          style={[
            styles.tabButton,
            compact ? styles.tabButtonCompact : null,
            activeTab === 'overview' ? styles.tabButtonActive : null,
          ]}
        >
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[
              styles.tabButtonLabel,
              compact ? styles.tabButtonLabelCompact : null,
              activeTab === 'overview' ? styles.tabButtonLabelActive : null,
            ]}
          >
            {t.tabOverview}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'comments' }}
          onPress={() => setActiveTab('comments')}
          style={[
            styles.tabButton,
            compact ? styles.tabButtonCompact : null,
            activeTab === 'comments' ? styles.tabButtonActive : null,
          ]}
        >
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[
              styles.tabButtonLabel,
              compact ? styles.tabButtonLabelCompact : null,
              activeTab === 'comments' ? styles.tabButtonLabelActive : null,
            ]}
          >
            {t.tabComments(displayedCommentCount)}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'photos' }}
          onPress={() => setActiveTab('photos')}
          style={[
            styles.tabButton,
            compact ? styles.tabButtonCompact : null,
            activeTab === 'photos' ? styles.tabButtonActive : null,
          ]}
        >
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[
              styles.tabButtonLabel,
              compact ? styles.tabButtonLabelCompact : null,
              activeTab === 'photos' ? styles.tabButtonLabelActive : null,
            ]}
          >
            {t.tabPhotos(displayedPhotoCount)}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'manage' }}
          onPress={() => setActiveTab('manage')}
          style={[
            styles.tabButton,
            compact ? styles.tabButtonCompact : null,
            activeTab === 'manage' ? styles.tabButtonActive : null,
          ]}
        >
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[
              styles.tabButtonLabel,
              compact ? styles.tabButtonLabelCompact : null,
              activeTab === 'manage' ? styles.tabButtonLabelActive : null,
            ]}
          >
            {t.tabManage}
          </Text>
        </Pressable>
      </View>

      {actionError ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>{actionError}</Text>
        </View>
      ) : null}

      {activeTab === 'overview' ? (
        <View style={styles.tabSection}>
          <PolygonNoteCard note={properties.note} locale={locale} />

          <PolygonCreatorCard feature={feature} locale={locale} isAdmin={isAdmin} />

          {!properties.isAuthor && (onFlagPolygon || onUnflagPolygon) ? (
            <View style={styles.flagReviewCard}>
              {properties.myFlag && onUnflagPolygon ? (
                <Pressable
                  testID="unflag-polygon-button"
                  accessibilityRole="button"
                  accessibilityLabel={t.removeFlagA11y}
                  disabled={isFlagging}
                  onPress={handleUnflagPress}
                  style={[styles.touchButton, styles.flagActiveButton]}
                >
                  <Text style={styles.flagActiveButtonLabel}>
                    {isFlagging ? t.submittingFlag : t.removeFlagButton}
                  </Text>
                </Pressable>
              ) : isFlagPickerOpen && onFlagPolygon ? (
                <View style={styles.flagPickerBox}>
                  <Text style={styles.flagReasonPromptText}>
                    {t.flagReasonPrompt}
                  </Text>
                  <View
                    style={styles.surfaceChoiceRow}
                    accessibilityRole="radiogroup"
                  >
                    {POLYGON_FLAG_REASONS.map((reasonOption) => {
                      const selected = selectedFlagReason === reasonOption;
                      const label = t.flagReasonLabels[reasonOption];
                      return (
                        <Pressable
                          key={reasonOption}
                          testID={`flag-reason-${reasonOption}`}
                          accessibilityRole="radio"
                          accessibilityLabel={label}
                          accessibilityState={{
                            checked: selected,
                            disabled: isFlagging,
                          }}
                          disabled={isFlagging}
                          onPress={() => setSelectedFlagReason(reasonOption)}
                          style={[
                            styles.surfaceChip,
                            selected ? styles.flagReasonChipSelected : null,
                          ]}
                        >
                          <Text
                            style={[
                              styles.surfaceChipLabel,
                              selected
                                ? styles.flagReasonChipLabelSelected
                                : null,
                            ]}
                          >
                            {label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <View style={styles.buttonRow}>
                    <Pressable
                      accessibilityRole="button"
                      disabled={isFlagging}
                      onPress={() => setIsFlagPickerOpen(false)}
                      style={[styles.touchButton, styles.secondaryButton]}
                    >
                      <Text style={styles.secondaryButtonLabel}>
                        {t.cancelFlagButton}
                      </Text>
                    </Pressable>
                    <Pressable
                      testID="submit-flag-button"
                      accessibilityRole="button"
                      disabled={isFlagging}
                      onPress={handleFlagSubmit}
                      style={[styles.touchButton, styles.flagSubmitButton]}
                    >
                      <Text style={styles.primaryButtonLabel}>
                        {isFlagging ? t.submittingFlag : t.submitFlagButton}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : onFlagPolygon ? (
                <Pressable
                  testID="open-flag-picker-button"
                  accessibilityRole="button"
                  accessibilityLabel={t.flagForReviewA11y}
                  disabled={isFlagging}
                  onPress={() => {
                    if (!isAuthenticated) {
                      onOpenAuth?.();
                      return;
                    }
                    setIsFlagPickerOpen(true);
                  }}
                  style={[styles.touchButton, styles.flagOutlineButton]}
                >
                  <Text style={styles.flagOutlineButtonLabel}>
                    {t.flagForReviewButton}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {displayedCommentCount > 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setActiveTab('comments')}
              style={styles.commentsShortcutCard}
            >
              <Text style={styles.commentsShortcutText}>
                {t.openCommentsBanner(displayedCommentCount)}
              </Text>
            </Pressable>
          ) : null}

          {properties.municipalityName &&
          properties.score > 0 &&
          properties.status === 'proposed' ? (
            <View style={styles.municipalityScaleCard}>
              <Text style={styles.municipalityScaleText}>
                {t.municipalityRankHint(
                  properties.score,
                  Math.max(properties.municipalityMaxScore, properties.score),
                  properties.municipalityName,
                )}
              </Text>
            </View>
          ) : null}

          {(() => {
            const localizedDisclaimer = localizeDisclaimerText(
              disclaimerText ?? null,
              locale,
            );
            return localizedDisclaimer && localizedDisclaimer.trim().length > 0 ? (
              <View
                testID="inspector-disclaimer-card"
                accessibilityLabel={t.permanentDisclaimerA11y}
                style={styles.disclaimerCard}
              >
                <Text style={styles.disclaimerText}>
                  {localizedDisclaimer}
                </Text>
              </View>
            ) : null;
          })()}

          {onReportContent ? (
            <Pressable
              testID="report-polygon-illegal-button"
              accessibilityRole="button"
              accessibilityLabel={t.reportIllegalA11y}
              onPress={() =>
                onReportContent({
                  targetType: 'polygon',
                  targetId: feature.id,
                })
              }
              style={styles.reportContentRowButton}
            >
              <Text style={styles.reportContentRowLabel}>
                {t.reportIllegalButton}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {activeTab === 'comments' ? (
        <View style={styles.tabSection}>
          {areCommentsClosed ? (
            <View testID="comments-closed-banner" style={styles.noteCard}>
              <Text style={styles.immutableNotice}>
                {t.commentsClosedFinishedHint}
              </Text>
            </View>
          ) : isAuthenticated && onCreateComment ? (
            <View style={styles.commentComposerBox}>
              <TextInput
                accessibilityLabel={t.commentInputA11y}
                value={newCommentBody}
                onChangeText={setNewCommentBody}
                maxLength={COMMENT_LIMITS.MAX_BODY_LENGTH}
                multiline
                placeholder={t.commentInputPlaceholder}
                placeholderTextColor={palette.inkMuted}
                style={styles.commentInput}
              />
              <View style={styles.commentComposerFooter}>
                <Text style={styles.commentCharCounter}>
                  {newCommentBody.length}/{COMMENT_LIMITS.MAX_BODY_LENGTH}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t.postComment}
                  disabled={
                    isSubmittingComment || newCommentBody.trim().length === 0
                  }
                  onPress={() => handleCreateCommentSubmit(null)}
                  style={[
                    styles.touchButton,
                    styles.primaryButton,
                    newCommentBody.trim().length === 0
                      ? styles.disabledButton
                      : null,
                  ]}
                >
                  <Text style={styles.primaryButtonLabel}>
                    {isSubmittingComment ? t.postingComment : t.postComment}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : !isAuthenticated ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => onOpenAuth?.()}
              style={styles.photoSignInBanner}
            >
              <Text style={styles.photoSignInBannerText}>
                {t.commentSignInPrompt}
              </Text>
            </Pressable>
          ) : null}

          {isLoadingComments ? (
            <View style={styles.photosLoadingBox}>
              <ActivityIndicator size="small" color={palette.accentPrimary} />
            </View>
          ) : commentDisplay.roots.length === 0 ? (
            <View style={styles.emptyPhotosBox}>
              <Text style={styles.emptyPhotosText}>{t.noCommentsYet}</Text>
            </View>
          ) : (
            <View style={styles.commentsStack}>
              {commentDisplay.pinnedTopReply !== null ? (
                <View
                  key={`pinned-${commentDisplay.pinnedTopReply.comment.id}`}
                  style={[styles.commentCard, styles.commentCardTopRated]}
                >
                  <View style={styles.commentBadgesRow}>
                    <View style={styles.topCommentBadge}>
                      <Text style={styles.topCommentBadgeLabel}>
                        {t.topCommentBadge}
                      </Text>
                    </View>
                    {commentDisplay.pinnedTopReply.parentAuthorPseudonym !==
                    null ? (
                      <Text style={styles.replyingToMeta}>
                        {t.replyingToLabel(
                          commentDisplay.pinnedTopReply.parentAuthorPseudonym,
                        )}
                      </Text>
                    ) : null}
                  </View>

                  <View style={styles.commentHeaderRow}>
                    <Text style={styles.commentAuthorLabel}>
                      {t.commentAuthorLabel(
                        commentDisplay.pinnedTopReply.comment.authorPseudonym,
                        commentDisplay.pinnedTopReply.comment.isAuthor,
                      )}
                    </Text>
                    <Text style={styles.commentDateLabel}>
                      {formatCommentTimestamp(
                        commentDisplay.pinnedTopReply.comment.createdAt,
                      )}
                    </Text>
                  </View>

                  <Text style={styles.commentBodyText}>
                    {commentDisplay.pinnedTopReply.comment.body}
                  </Text>

                  <View style={styles.commentActionsRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t.upvoteCommentA11y(
                        commentDisplay.pinnedTopReply.comment.upvotes,
                      )}
                      accessibilityState={{
                        selected:
                          commentDisplay.pinnedTopReply.comment.myVote === 1,
                        disabled:
                          isBusy ||
                          commentDisplay.pinnedTopReply.comment.isAuthor,
                      }}
                      disabled={
                        isBusy || commentDisplay.pinnedTopReply.comment.isAuthor
                      }
                      onPress={() => {
                        if (commentDisplay.pinnedTopReply) {
                          handleCommentVotePress(
                            commentDisplay.pinnedTopReply.comment,
                          );
                        }
                      }}
                      style={[
                        styles.photoVotePill,
                        commentDisplay.pinnedTopReply.comment.myVote === 1
                          ? styles.photoVotePillRealActive
                          : null,
                        commentDisplay.pinnedTopReply.comment.isAuthor
                          ? styles.disabledButton
                          : null,
                      ]}
                    >
                      <Text
                        style={[
                          styles.photoVoteLabel,
                          commentDisplay.pinnedTopReply.comment.myVote === 1
                            ? styles.photoVoteLabelActive
                            : null,
                        ]}
                      >
                        ▲ {commentDisplay.pinnedTopReply.comment.upvotes}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              {commentDisplay.roots.map((rootNode) =>
                renderCommentThreadNode(rootNode),
              )}
              <Pressable
                accessibilityRole="link"
                onPress={() => openLicenseUrl(CC_BY_4_0_URL)}
                style={styles.ccLicenseNoticeLink}
              >
                <Text style={styles.ccLicenseNoticeText}>
                  {t.commentLicenseNotice}
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      ) : null}

      {activeTab === 'photos' ? (
        <View style={styles.tabSection}>
          {isAuthenticated ? (
            <View style={styles.photoUploadBar}>
              {onUploadPhotoFromCamera ? (
                <Pressable
                  testID="upload-photo-camera-button"
                  accessibilityRole="button"
                  accessibilityLabel={t.addPhotoCamera}
                  disabled={
                    uploadingPhotoSource !== null ||
                    displayedPhotoCount >= PHOTO_LIMITS.MAX_PHOTOS_PER_POLYGON
                  }
                  onPress={() => handleUploadPhoto('camera')}
                  style={[
                    styles.touchButton,
                    styles.flexButton,
                    styles.secondaryButton,
                    uploadingPhotoSource !== null ||
                    displayedPhotoCount >= PHOTO_LIMITS.MAX_PHOTOS_PER_POLYGON
                      ? styles.disabledButton
                      : null,
                  ]}
                >
                  <Text style={styles.secondaryButtonLabel}>
                    {uploadingPhotoSource === 'camera'
                      ? t.uploadingPhoto
                      : t.addPhotoCamera}
                  </Text>
                </Pressable>
              ) : null}

              {onUploadPhotosFromLibrary || onUploadPhotoFromLibrary ? (
                <Pressable
                  testID="upload-photo-gallery-button"
                  accessibilityRole="button"
                  accessibilityLabel={t.addPhotoGallery}
                  disabled={
                    uploadingPhotoSource !== null ||
                    displayedPhotoCount >= PHOTO_LIMITS.MAX_PHOTOS_PER_POLYGON
                  }
                  onPress={() => handleUploadPhoto('library')}
                  style={[
                    styles.touchButton,
                    styles.flexButton,
                    styles.secondaryButton,
                    uploadingPhotoSource !== null ||
                    displayedPhotoCount >= PHOTO_LIMITS.MAX_PHOTOS_PER_POLYGON
                      ? styles.disabledButton
                      : null,
                  ]}
                >
                  <Text style={styles.secondaryButtonLabel}>
                    {uploadingPhotoSource === 'library'
                      ? uploadingPhotoProgress !== null &&
                        uploadingPhotoProgress.total > 1
                        ? t.uploadingPhotosProgress(
                            uploadingPhotoProgress.current,
                            uploadingPhotoProgress.total,
                          )
                        : t.uploadingPhoto
                      : t.addPhotoGallery}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => onOpenAuth?.()}
              style={styles.photoSignInBanner}
            >
              <Text style={styles.photoSignInBannerText}>
                {t.photoSignInPrompt}
              </Text>
            </Pressable>
          )}

          {isLoadingPhotos ? (
            <View style={styles.photosLoadingBox}>
              <ActivityIndicator size="small" color={palette.accentPrimary} />
            </View>
          ) : photos.length === 0 ? (
            <View style={styles.emptyPhotosBox}>
              <Text style={styles.emptyPhotosText}>{t.noPhotosYet}</Text>
            </View>
          ) : (
            <View style={styles.photoCardsStack}>
              {photos.map((photo) => {
                const isShielded =
                  photo.isFlaggedFake && !revealedFakeIds[photo.id];
                return (
                  <View key={photo.id} style={styles.photoCard}>
                    <View style={styles.photoImageContainer}>
                      <Pressable
                        accessibilityRole="button"
                        disabled={isShielded}
                        onPress={() => setLightboxPhoto(photo)}
                        style={styles.photoPressable}
                      >
                        <Image
                          source={{ uri: toPhotoUrl(photo.thumbUrl) }}
                          blurRadius={isShielded ? 24 : 0}
                          style={styles.photoImage}
                          resizeMode="cover"
                        />
                      </Pressable>

                      {photo.gpsVerified ? (
                        <View style={styles.gpsVerifiedBadge}>
                          <Text style={styles.gpsVerifiedBadgeLabel}>
                            {t.gpsVerifiedBadge}
                          </Text>
                        </View>
                      ) : null}

                      {isShielded ? (
                        <View style={styles.fakeShieldOverlay}>
                          <Text style={styles.fakeShieldText}>
                            {t.flaggedFakeWarning}
                          </Text>
                          <Pressable
                            accessibilityRole="button"
                            onPress={() =>
                              setRevealedFakeIds((prev) => ({
                                ...prev,
                                [photo.id]: true,
                              }))
                            }
                            style={styles.revealPhotoBtn}
                          >
                            <Text style={styles.revealPhotoBtnLabel}>
                              {t.revealFlaggedPhoto}
                            </Text>
                          </Pressable>
                        </View>
                      ) : null}
                    </View>

                    <View style={styles.photoMetaRow}>
                      <Text style={styles.photoAuthorLabel}>
                        {t.commentAuthorLabel(
                          photo.uploaderPseudonym,
                          photo.isUploader,
                        )}
                      </Text>

                      <View style={styles.photoRatingRow}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t.rateRealA11y(photo.realVotes)}
                          accessibilityState={{
                            selected: photo.myVote === 1,
                            disabled: isBusy || photo.isUploader,
                          }}
                          disabled={isBusy || photo.isUploader}
                          onPress={() => handlePhotoVote(photo, 1)}
                          style={[
                            styles.photoVotePill,
                            photo.myVote === 1
                              ? styles.photoVotePillRealActive
                              : null,
                            photo.isUploader ? styles.disabledButton : null,
                          ]}
                        >
                          <Text
                            style={[
                              styles.photoVoteLabel,
                              photo.myVote === 1
                                ? styles.photoVoteLabelActive
                                : null,
                            ]}
                          >
                            ✓ {t.rateReal} ({photo.realVotes})
                          </Text>
                        </Pressable>

                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t.rateFakeA11y(photo.fakeVotes)}
                          accessibilityState={{
                            selected: photo.myVote === -1,
                            disabled: isBusy || photo.isUploader,
                          }}
                          disabled={isBusy || photo.isUploader}
                          onPress={() => handlePhotoVote(photo, -1)}
                          style={[
                            styles.photoVotePill,
                            photo.myVote === -1
                              ? styles.photoVotePillFakeActive
                              : null,
                            photo.isUploader ? styles.disabledButton : null,
                          ]}
                        >
                          <Text
                            style={[
                              styles.photoVoteLabel,
                              photo.myVote === -1
                                ? styles.photoVoteLabelActive
                                : null,
                            ]}
                          >
                            ✕ {t.rateFake} ({photo.fakeVotes})
                          </Text>
                        </Pressable>

                        {(photo.isUploader || isAdmin) && onDeletePhoto ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t.deletePhotoA11y}
                            disabled={isBusy}
                            onPress={() => handleDeletePhotoPress(photo.id)}
                            style={styles.photoDeletePill}
                          >
                            <Text style={styles.photoDeleteLabel}>
                              {t.deletePhoto}
                            </Text>
                          </Pressable>
                        ) : null}

                        {onReportContent ? (
                          <Pressable
                            testID={`report-photo-${photo.id}`}
                            accessibilityRole="button"
                            accessibilityLabel={t.reportIllegalA11y}
                            onPress={() =>
                              onReportContent({
                                targetType: 'photo',
                                targetId: photo.id,
                              })
                            }
                            style={styles.reportInlinePill}
                          >
                            <Text style={styles.reportInlineLabel}>
                              {t.reportIllegalShort}
                            </Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                  </View>
                );
              })}
              <Pressable
                accessibilityRole="link"
                onPress={() => openLicenseUrl(CC_BY_4_0_URL)}
                style={styles.ccLicenseNoticeLink}
              >
                <Text style={styles.ccLicenseNoticeText}>
                  {t.photoLicenseNotice}
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      ) : null}

      {activeTab === 'manage' ? (
        <View style={styles.tabSection}>
          {isAdmin &&
          (onPatchPolygonStatus ||
            (properties.flagCount > 0 && onClearPolygonFlags) ||
            managePermissions.canAdminDeleteNonAuthorPolygon) ? (
            <View style={styles.manageCard}>
              <Text style={styles.manageSectionTitle}>
                {t.adminSectionTitle}
              </Text>
              {onPatchPolygonStatus ? (
                <>
                  <Text style={styles.immutableNotice}>
                    {t.statusSelectorLabel}
                  </Text>
                  <View
                    style={styles.surfaceChoiceRow}
                    accessibilityRole="radiogroup"
                  >
                    {POLYGON_STATUSES.map((statusOption) => {
                      const selected = properties.status === statusOption;
                      const optionLabel =
                        statusOption === 'finished'
                          ? t.setStatusFinished
                          : statusOption === 'in_progress'
                            ? t.setStatusInProgress
                            : t.setStatusProposed;
                      return (
                        <Pressable
                          key={statusOption}
                          accessibilityRole="radio"
                          accessibilityLabel={optionLabel}
                          accessibilityState={{
                            checked: selected,
                            disabled: isBusy,
                          }}
                          disabled={isBusy}
                          onPress={() => handleSetStatus(statusOption)}
                          style={[
                            styles.surfaceChip,
                            selected && statusOption === 'finished'
                              ? styles.statusOptionChipFinished
                              : selected && statusOption === 'in_progress'
                                ? styles.statusOptionChipInProgress
                                : selected
                                  ? styles.surfaceChipSelected
                                  : null,
                          ]}
                        >
                          <Text
                            style={[
                              styles.surfaceChipLabel,
                              selected && statusOption === 'finished'
                                ? styles.statusBadgeLabelFinished
                                : selected && statusOption === 'in_progress'
                                  ? styles.statusBadgeLabelInProgress
                                  : selected
                                    ? styles.surfaceChipLabelSelected
                                    : null,
                            ]}
                          >
                            {isBusy && selected
                              ? t.updatingStatus
                              : optionLabel}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : null}
              {properties.flagCount > 0 && onClearPolygonFlags ? (
                <Pressable
                  testID="admin-clear-flags-button"
                  accessibilityRole="button"
                  disabled={isFlagging}
                  onPress={handleClearFlagsAdminPress}
                  style={[styles.touchButton, styles.secondaryButton]}
                >
                  <Text style={styles.secondaryButtonLabel}>
                    {isFlagging
                      ? t.clearingFlags
                      : t.clearFlagsAdminButton(properties.flagCount)}
                  </Text>
                </Pressable>
              ) : null}
              {managePermissions.canAdminDeleteNonAuthorPolygon ? (
                confirmingDelete ? (
                  <View
                    style={styles.deleteConfirmBox}
                    accessibilityRole="alert"
                  >
                    <Text style={styles.deleteConfirmText}>
                      {t.deleteConfirmPrompt}
                    </Text>
                    <View style={styles.buttonRow}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t.keepProposalA11y}
                        disabled={isBusy}
                        onPress={() => setConfirmingDelete(false)}
                        style={[styles.touchButton, styles.secondaryButton]}
                      >
                        <Text style={styles.secondaryButtonLabel}>
                          {t.keepProposal}
                        </Text>
                      </Pressable>
                      <Pressable
                        testID="admin-confirm-delete-polygon-button"
                        accessibilityRole="button"
                        accessibilityLabel={t.confirmDeleteA11y}
                        disabled={isBusy}
                        onPress={handleConfirmDelete}
                        style={[styles.touchButton, styles.dangerButton]}
                      >
                        <Text style={styles.primaryButtonLabel}>
                          {isBusy ? t.deleting : t.confirmDelete}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <Pressable
                    testID="admin-delete-polygon-button"
                    accessibilityRole="button"
                    accessibilityLabel={t.deleteProposalA11y}
                    disabled={isBusy}
                    onPress={() => setConfirmingDelete(true)}
                    style={[styles.touchButton, styles.dangerOutlineButton]}
                  >
                    <Text style={styles.dangerOutlineLabel}>
                      {t.deleteProposal}
                    </Text>
                  </Pressable>
                )
              ) : null}
            </View>
          ) : null}

          {managePermissions.canEditDetails ? (
            <View style={styles.manageCard}>
              <Text style={styles.manageSectionTitle}>
                {t.authorSectionTitle}
              </Text>

              {isEditing ? (
                <View style={styles.editSection}>
                  <Text style={styles.immutableNotice}>
                    {t.immutableNotice}
                  </Text>

                  <View
                    style={styles.surfaceChoiceRow}
                    accessibilityRole="radiogroup"
                  >
                    {SURFACE_TYPES.map((st) => {
                      const selected = editSurfaceType === st;
                      const label = surfaceCopy[st].label;
                      return (
                        <Pressable
                          key={st}
                          accessibilityRole="radio"
                          accessibilityLabel={label}
                          accessibilityState={{ checked: selected }}
                          onPress={() => setEditSurfaceType(st)}
                          style={[
                            styles.surfaceChip,
                            selected ? styles.surfaceChipSelected : null,
                          ]}
                        >
                          <Text
                            style={[
                              styles.surfaceChipLabel,
                              selected ? styles.surfaceChipLabelSelected : null,
                            ]}
                          >
                            {label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <TextInput
                    accessibilityLabel={t.editNoteA11y}
                    value={editNote}
                    onChangeText={setEditNote}
                    maxLength={GEOMETRY_LIMITS.MAX_NOTE_LENGTH}
                    multiline
                    placeholder={t.editNotePlaceholder}
                    placeholderTextColor={palette.inkMuted}
                    style={styles.editNoteInput}
                  />

                  <View style={styles.buttonRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t.cancelEditA11y}
                      disabled={isBusy}
                      onPress={() => {
                        setIsEditing(false);
                        setEditSurfaceType(properties.surfaceType);
                        setEditNote(properties.note ?? '');
                      }}
                      style={[styles.touchButton, styles.secondaryButton]}
                    >
                      <Text style={styles.secondaryButtonLabel}>
                        {t.cancel}
                      </Text>
                    </Pressable>

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t.saveEditA11y}
                      disabled={isBusy}
                      onPress={handleSavePatch}
                      style={[styles.touchButton, styles.primaryButton]}
                    >
                      <Text style={styles.primaryButtonLabel}>
                        {isBusy ? t.saving : t.saveChanges}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : confirmingDelete ? (
                <View style={styles.deleteConfirmBox} accessibilityRole="alert">
                  <Text style={styles.deleteConfirmText}>
                    {t.deleteConfirmPrompt}
                  </Text>
                  <View style={styles.buttonRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t.keepProposalA11y}
                      disabled={isBusy}
                      onPress={() => setConfirmingDelete(false)}
                      style={[styles.touchButton, styles.secondaryButton]}
                    >
                      <Text style={styles.secondaryButtonLabel}>
                        {t.keepProposal}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t.confirmDeleteA11y}
                      disabled={isBusy}
                      onPress={handleConfirmDelete}
                      style={[styles.touchButton, styles.dangerButton]}
                    >
                      <Text style={styles.primaryButtonLabel}>
                        {isBusy ? t.deleting : t.confirmDelete}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={styles.buttonRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t.editDetailsA11y}
                    disabled={isBusy}
                    onPress={() => setIsEditing(true)}
                    style={[styles.touchButton, styles.secondaryButton]}
                  >
                    <Text style={styles.secondaryButtonLabel}>
                      {t.editDetails}
                    </Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t.deleteProposalA11y}
                    disabled={isBusy}
                    onPress={() => setConfirmingDelete(true)}
                    style={[styles.touchButton, styles.dangerOutlineButton]}
                  >
                    <Text style={styles.dangerOutlineLabel}>
                      {t.deleteProposal}
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>
          ) : null}

          {managePermissions.showReadonlyHint ? (
            <View style={styles.noteCard}>
              <Text style={styles.immutableNotice}>{t.manageReadonlyHint}</Text>
            </View>
          ) : null}

          {onReportContent ? (
            <Pressable
              testID="manage-report-polygon-button"
              accessibilityRole="button"
              accessibilityLabel={t.reportIllegalA11y}
              onPress={() =>
                onReportContent({
                  targetType: 'polygon',
                  targetId: feature.id,
                })
              }
              style={styles.reportContentRowButton}
            >
              <Text style={styles.reportContentRowLabel}>
                {t.reportIllegalButton}
              </Text>
            </Pressable>
          ) : null}

          {abuseContact && abuseContact.trim().length > 0 ? (
            <Text style={styles.abuseContactText}>
              {t.abuseContactPrefix}{' '}
              {/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(abuseContact.trim()) ? (
                <Text
                  accessibilityRole="link"
                  onPress={() =>
                    openLicenseUrl(`mailto:${abuseContact.trim()}`)
                  }
                  style={styles.abuseContactLink}
                >
                  {abuseContact.trim()}
                </Text>
              ) : (
                abuseContact
              )}
            </Text>
          ) : null}
        </View>
      ) : null}

      {lightboxPhoto !== null ? (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setLightboxPhoto(null)}
        >
          <View style={styles.lightboxBackdrop}>
            <Pressable
              style={styles.lightboxCloseScrim}
              onPress={() => setLightboxPhoto(null)}
            />
            <View style={styles.lightboxContent}>
              <Image
                source={{ uri: toPhotoUrl(lightboxPhoto.url) }}
                style={[styles.lightboxImage, { height: lightboxImageHeight }]}
                resizeMode="contain"
              />
              <View style={styles.lightboxFooter}>
                <View style={styles.lightboxMetaCol}>
                  <Text style={styles.lightboxAuthor}>
                    @{lightboxPhoto.uploaderPseudonym}
                    {lightboxPhoto.gpsVerified
                      ? ` · ${t.gpsVerifiedBadge}`
                      : ''}
                  </Text>
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => openLicenseUrl(CC_BY_4_0_URL)}
                  >
                    <Text style={styles.lightboxLicenseLink}>
                      {t.photoLightboxLicense}
                    </Text>
                  </Pressable>
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setLightboxPhoto(null)}
                  style={styles.lightboxCloseBtn}
                >
                  <Text style={styles.lightboxCloseLabel}>{t.close}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}
