import {
  COMMENT_LIMITS,
  GEOMETRY_LIMITS,
  PHOTO_LIMITS,
  POLYGON_FLAG_REASONS,
  POLYGON_STATUSES,
  SURFACE_TYPES,
  type CommentVoteResponse,
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
} from '@entsiegelung/shared';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  DEFAULT_LOCALE,
  getTranslations,
  localizeError,
  type Locale,
} from '../i18n/translations';
import {
  buildCommentDisplayModel,
  deriveInspectorManagePermissions,
  deriveInspectorOverviewMeta,
  formatInspectorDate,
  MIN_TOUCH_TARGET_DP,
  pruneDeletedCommentSubtree,
  type CommentDisplayModel,
  type CommentThreadNode,
  type InspectorManagePermissionsModel,
  type InspectorOverviewMetaModel,
} from '../state/viewModels';
import { useTheme } from '../theme/themeContext';
import {
  MONO_FONT_FAMILY,
  RADII,
  TABULAR_NUMS_STYLE,
  type ThemePalette,
} from '../theme/tokens';

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
}

export function PolygonInspectorSheet({
  feature,
  overlapIndex,
  overlapCount,
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
}: PolygonInspectorSheetProps): React.JSX.Element | null {
  const { palette, surfaceSwatches } = useTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
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

  useEffect(() => {
    setActiveTab('overview');
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
  const swatch = surfaceSwatches[properties.surfaceType];
  const isFinished = properties.status === 'finished';
  const isInProgress = properties.status === 'in_progress';
  const isVotingClosedByStatus = isInProgress || isFinished;
  const isVoteDisabled =
    isBusy || properties.isAuthor || isVotingClosedByStatus;
  const voteLockReason = isFinished
    ? t.votingClosedFinishedHint
    : isInProgress
      ? t.votingClosedInProgressHint
      : properties.isAuthor
        ? t.selfVoteDisabledHint
        : null;
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

  const scoreToneStyle = isFinished
    ? styles.scoreBadgeFinished
    : isInProgress
      ? styles.scoreBadgeInProgress
      : properties.score > 0
        ? styles.scoreBadgePositive
        : properties.score < 0
          ? styles.scoreBadgeNegative
          : styles.scoreBadgeNeutral;
  const scoreTextToneStyle = isFinished
    ? styles.scoreBadgeTextFinished
    : isInProgress
      ? styles.scoreBadgeTextInProgress
      : properties.score > 0
        ? styles.scoreBadgeTextPositive
        : properties.score < 0
          ? styles.scoreBadgeTextNegative
          : styles.scoreBadgeTextNeutral;

  const toPhotoUrl = (rawUrl: string): string =>
    resolveUploadUrl ? resolveUploadUrl(rawUrl) : rawUrl;

  const handleVotePress = (targetValue: 1 | -1): void => {
    if (properties.isAuthor || isInProgress || isFinished) {
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
    if (isFinished || !onCreateComment) {
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

  const overviewMeta = deriveInspectorOverviewMeta(feature, locale, isAdmin);
  const entryDateText = overviewMeta.entryDateText;
  const authorActivityText = overviewMeta.authorActivityText;
  const displayAuthorHandle = overviewMeta.displayAuthorHandle;

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

            {canReply && !isFinished && onCreateComment ? (
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
          </View>

          {isReplyingHere && !isFinished && isAuthenticated ? (
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
          <View style={styles.materialTitleRow}>
            <View
              style={[styles.materialSwatch, { backgroundColor: swatch.color }]}
            />
            <Text style={styles.sheetTitle}>
              {surfaceCopy[properties.surfaceType].label}
            </Text>
            <View style={styles.areaPill}>
              <Text style={styles.areaPillText}>
                {properties.areaM2.toFixed(1)} m²
              </Text>
            </View>
            <View
              style={[
                styles.statusBadge,
                isFinished
                  ? styles.statusBadgeFinished
                  : isInProgress
                    ? styles.statusBadgeInProgress
                    : styles.statusBadgeProposed,
              ]}
            >
              <Text
                style={[
                  styles.statusBadgeLabel,
                  isFinished
                    ? styles.statusBadgeLabelFinished
                    : isInProgress
                      ? styles.statusBadgeLabelInProgress
                      : styles.statusBadgeLabelProposed,
                ]}
              >
                {isFinished
                  ? t.statusFinishedBadge
                  : isInProgress
                    ? t.statusInProgressBadge
                    : t.statusProposedBadge}
              </Text>
            </View>
            {overviewMeta.needsReviewBadgeText !== null ? (
              <View
                testID="needs-review-badge"
                style={styles.needsReviewBadge}
              >
                <Text style={styles.needsReviewBadgeLabel}>
                  {overviewMeta.needsReviewBadgeText}
                </Text>
              </View>
            ) : null}
            {properties.municipalityName ? (
              <View style={styles.municipalityChip}>
                <Text numberOfLines={1} style={styles.municipalityChipLabel}>
                  {properties.municipalityName}
                </Text>
              </View>
            ) : null}
          </View>
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

      <View style={styles.votePanel}>
        <View style={[styles.scoreBadge, scoreToneStyle]}>
          <Text style={[styles.scoreBadgeValue, scoreTextToneStyle]}>
            {properties.score > 0
              ? `+${properties.score}`
              : `${properties.score}`}
          </Text>
          <Text style={[styles.scoreBadgeCaption, scoreTextToneStyle]}>
            {t.netScore}
          </Text>
        </View>

        <View style={styles.voteButtonsGroup}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.upvoteA11y(properties.upvotes)}
            accessibilityState={{
              selected: properties.myVote === 1,
              disabled: isVoteDisabled,
            }}
            disabled={isVoteDisabled}
            onPress={() => handleVotePress(1)}
            style={[
              styles.touchButton,
              styles.voteButton,
              properties.myVote === 1 ? styles.upvoteButtonActive : null,
              properties.isAuthor || isVotingClosedByStatus
                ? styles.disabledButton
                : null,
            ]}
          >
            <Text
              style={[
                styles.voteButtonLabel,
                properties.myVote === 1 ? styles.voteButtonLabelActive : null,
              ]}
            >
              +1 ({properties.upvotes})
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.downvoteA11y(properties.downvotes)}
            accessibilityState={{
              selected: properties.myVote === -1,
              disabled: isVoteDisabled,
            }}
            disabled={isVoteDisabled}
            onPress={() => handleVotePress(-1)}
            style={[
              styles.touchButton,
              styles.voteButton,
              properties.myVote === -1 ? styles.downvoteButtonActive : null,
              properties.isAuthor || isVotingClosedByStatus
                ? styles.disabledButton
                : null,
            ]}
          >
            <Text
              style={[
                styles.voteButtonLabel,
                properties.myVote === -1 ? styles.voteButtonLabelActive : null,
              ]}
            >
              −1 ({properties.downvotes})
            </Text>
          </Pressable>
        </View>
      </View>

      {voteLockReason ? (
        <Text testID="vote-lock-hint" style={styles.immutableNotice}>
          {voteLockReason}
        </Text>
      ) : null}

      <View style={styles.tabWell} accessibilityRole="tablist">
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'overview' }}
          onPress={() => setActiveTab('overview')}
          style={[
            styles.tabButton,
            activeTab === 'overview' ? styles.tabButtonActive : null,
          ]}
        >
          <Text
            numberOfLines={1}
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
            activeTab === 'comments' ? styles.tabButtonActive : null,
          ]}
        >
          <Text
            numberOfLines={1}
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
            activeTab === 'photos' ? styles.tabButtonActive : null,
          ]}
        >
          <Text
            numberOfLines={1}
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
            activeTab === 'manage' ? styles.tabButtonActive : null,
          ]}
        >
          <Text
            numberOfLines={1}
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
          <View style={styles.noteCard}>
            <Text style={styles.noteBody}>
              {properties.note && properties.note.trim().length > 0
                ? properties.note
                : t.emptyNote}
            </Text>
          </View>

          <View
            testID="inspector-creator-card"
            style={styles.creatorInfoCard}
          >
            <View style={styles.creatorHeaderRow}>
              <Text style={styles.creatorInfoLabel}>
                {t.creatorSectionLabel}:{' '}
                <Text style={styles.creatorInfoValue}>
                  @{displayAuthorHandle}
                  {properties.isAuthor
                    ? locale === 'de'
                      ? ' · Du'
                      : ' · You'
                    : ''}
                </Text>
              </Text>
              {properties.authorIsNewUser ? (
                <View
                  testID="new-contributor-badge"
                  style={styles.newContributorBadge}
                >
                  <Text style={styles.newContributorBadgeLabel}>
                    {t.newContributorBadge}
                  </Text>
                </View>
              ) : null}
            </View>
            <View style={styles.creatorMetaRow}>
              <Text testID="overview-entry-date" style={styles.creatorMetaItem}>
                {t.entryDateLabel}:{' '}
                <Text style={styles.creatorMetaMono}>
                  {entryDateText ?? '—'}
                </Text>
              </Text>
              <Text
                testID="overview-author-activity"
                style={styles.creatorMetaItem}
              >
                {t.creatorActivityLabel}:{' '}
                <Text style={styles.creatorMetaMono}>
                  {authorActivityText}
                </Text>
              </Text>
            </View>
          </View>

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
        </View>
      ) : null}

      {activeTab === 'comments' ? (
        <View style={styles.tabSection}>
          {isFinished ? (
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
                      </View>
                    </View>
                  </View>
                );
              })}
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

          {abuseContact && abuseContact.trim().length > 0 ? (
            <Text style={styles.abuseContactText}>
              {t.abuseContactPrefix} {abuseContact}
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
                style={styles.lightboxImage}
                resizeMode="contain"
              />
              <View style={styles.lightboxFooter}>
                <Text style={styles.lightboxAuthor}>
                  @{lightboxPhoto.uploaderPseudonym}
                  {lightboxPhoto.gpsVerified
                    ? ` · ${t.gpsVerifiedBadge}`
                    : ''}
                </Text>
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

function createStyles(PALETTE: ThemePalette) {
  return StyleSheet.create({
  sheet: {
    padding: 14,
    borderRadius: RADII.lg,
    backgroundColor: PALETTE.bgSurface,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
    gap: 10,
  },
  sheetCompact: {
    borderWidth: 0,
    borderRadius: 0,
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 14,
  },
  headerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  headerTitleGroup: {
    flex: 1,
    minWidth: 180,
    gap: 4,
  },
  materialTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  materialSwatch: {
    width: 12,
    height: 12,
    borderRadius: 3,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
    color: PALETTE.inkPrimary,
  },
  areaPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADII.sm,
    backgroundColor: PALETTE.bgSubtle,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
  },
  areaPillText: {
    ...TABULAR_NUMS_STYLE,
    fontFamily: MONO_FONT_FAMILY,
    fontSize: 12,
    fontWeight: '700',
    color: PALETTE.inkPrimary,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADII.pill,
    borderWidth: 1,
  },
  statusBadgeProposed: {
    backgroundColor: PALETTE.bgSubtle,
    borderColor: PALETTE.borderStrong,
  },
  statusBadgeInProgress: {
    backgroundColor: PALETTE.inProgressBg,
    borderColor: PALETTE.inProgressBorder,
  },
  statusBadgeFinished: {
    backgroundColor: PALETTE.finishedBg,
    borderColor: PALETTE.finishedBorder,
  },
  statusBadgeLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusBadgeLabelProposed: {
    color: PALETTE.inkSecondary,
  },
  statusBadgeLabelInProgress: {
    color: PALETTE.inProgressText,
  },
  statusBadgeLabelFinished: {
    color: PALETTE.finishedText,
  },
  needsReviewBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADII.pill,
    borderWidth: 1,
    backgroundColor: PALETTE.neutralBg,
    borderColor: PALETTE.neutralBorder,
  },
  needsReviewBadgeLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: PALETTE.neutralText,
  },
  municipalityChip: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: RADII.pill,
    backgroundColor: PALETTE.infoBg,
    borderWidth: 1,
    borderColor: PALETTE.infoBorder,
    maxWidth: 190,
  },
  municipalityChipLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: PALETTE.infoText,
  },
  headerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  overlapButton: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.infoBg,
    borderWidth: 1,
    borderColor: PALETTE.infoBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlapButtonLabel: {
    ...TABULAR_NUMS_STYLE,
    fontSize: 12,
    fontWeight: '700',
    color: PALETTE.infoText,
  },
  closeButton: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.bgSubtle,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonLabel: {
    fontSize: 12.5,
    fontWeight: '600',
    color: PALETTE.inkPrimary,
  },
  votePanel: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  scoreBadge: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: RADII.md,
    borderWidth: 1,
  },
  scoreBadgePositive: {
    backgroundColor: PALETTE.positiveBg,
    borderColor: PALETTE.positiveBorder,
  },
  scoreBadgeNeutral: {
    backgroundColor: PALETTE.neutralBg,
    borderColor: PALETTE.neutralBorder,
  },
  scoreBadgeNegative: {
    backgroundColor: PALETTE.dangerBg,
    borderColor: PALETTE.dangerBorder,
  },
  scoreBadgeInProgress: {
    backgroundColor: PALETTE.inProgressBg,
    borderColor: PALETTE.inProgressBorder,
  },
  scoreBadgeFinished: {
    backgroundColor: PALETTE.finishedBg,
    borderColor: PALETTE.finishedBorder,
  },
  scoreBadgeValue: {
    ...TABULAR_NUMS_STYLE,
    fontFamily: MONO_FONT_FAMILY,
    fontSize: 15,
    fontWeight: '700',
  },
  scoreBadgeCaption: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  scoreBadgeTextPositive: {
    color: PALETTE.positiveText,
  },
  scoreBadgeTextNeutral: {
    color: PALETTE.neutralText,
  },
  scoreBadgeTextNegative: {
    color: PALETTE.dangerText,
  },
  scoreBadgeTextInProgress: {
    color: PALETTE.inProgressText,
  },
  scoreBadgeTextFinished: {
    color: PALETTE.finishedText,
  },
  voteButtonsGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  tabWell: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.bgRecessed,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
    gap: 4,
  },
  tabButton: {
    flex: 1,
    minHeight: 40,
    paddingHorizontal: 5,
    paddingVertical: 7,
    borderRadius: RADII.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabButtonActive: {
    backgroundColor: PALETTE.bgSurface,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
  },
  tabButtonLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: PALETTE.inkSecondary,
  },
  tabButtonLabelCompact: {
    fontSize: 11,
  },
  tabButtonLabelActive: {
    color: PALETTE.inkPrimary,
    fontWeight: '700',
  },
  commentsShortcutCard: {
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.infoBg,
    borderWidth: 1,
    borderColor: PALETTE.infoBorder,
  },
  commentsShortcutText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: PALETTE.infoText,
  },
  commentComposerBox: {
    padding: 10,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.bgSubtle,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
    gap: 8,
  },
  commentComposerFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  commentCharCounter: {
    ...TABULAR_NUMS_STYLE,
    fontFamily: MONO_FONT_FAMILY,
    fontSize: 11,
    color: PALETTE.inkMuted,
  },
  commentInput: {
    minHeight: 58,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    backgroundColor: PALETTE.bgSurface,
    fontSize: 13,
    color: PALETTE.inkPrimary,
    textAlignVertical: 'top',
  },
  disabledButton: {
    opacity: 0.5,
  },
  commentsStack: {
    gap: 8,
  },
  commentThreadGroup: {
    gap: 6,
  },
  commentRepliesStack: {
    gap: 6,
  },
  commentCard: {
    padding: 10,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
    backgroundColor: PALETTE.bgSurface,
    gap: 6,
  },
  commentReplyCard: {
    backgroundColor: PALETTE.bgSubtle,
    borderLeftWidth: 3,
    borderLeftColor: PALETTE.borderStrong,
  },
  commentCardTopRated: {
    borderColor: PALETTE.positiveBorder,
    backgroundColor: PALETTE.positiveBg,
  },
  commentBadgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  topCommentBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: RADII.pill,
    backgroundColor: PALETTE.accentPrimary,
  },
  topCommentBadgeLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: PALETTE.inkOnAccent,
  },
  replyingToMeta: {
    fontSize: 11.5,
    fontWeight: '600',
    color: PALETTE.inkSecondary,
  },
  commentHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  commentAuthorLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: PALETTE.inkPrimary,
  },
  commentDateLabel: {
    ...TABULAR_NUMS_STYLE,
    fontFamily: MONO_FONT_FAMILY,
    fontSize: 11,
    color: PALETTE.inkMuted,
  },
  commentBodyText: {
    fontSize: 13,
    lineHeight: 18,
    color: PALETTE.inkPrimary,
  },
  commentActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  commentReplyPill: {
    minHeight: 34,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADII.pill,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    backgroundColor: PALETTE.bgSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentReplyPillLabel: {
    fontSize: 11.5,
    fontWeight: '700',
    color: PALETTE.inkSecondary,
  },
  replyComposerBox: {
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: PALETTE.borderSubtle,
    gap: 8,
  },
  tabSection: {
    gap: 10,
  },
  permanentDisclaimerBox: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.bgSubtle,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
  },
  permanentDisclaimerText: {
    fontSize: 11.5,
    lineHeight: 16,
    color: PALETTE.inkSecondary,
  },
  municipalityScaleCard: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.positiveBg,
    borderWidth: 1,
    borderColor: PALETTE.positiveBorder,
  },
  municipalityScaleText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: PALETTE.positiveText,
  },
  errorBox: {
    padding: 9,
    borderRadius: RADII.sm,
    backgroundColor: PALETTE.dangerBg,
    borderWidth: 1,
    borderColor: PALETTE.dangerBorder,
  },
  errorText: {
    fontSize: 12,
    fontWeight: '600',
    color: PALETTE.dangerText,
  },
  noteCard: {
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.bgSubtle,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
  },
  noteBody: {
    fontSize: 13.5,
    lineHeight: 19,
    color: PALETTE.inkPrimary,
  },
  creatorInfoCard: {
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.bgSubtle,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
    gap: 6,
  },
  creatorHeaderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  creatorInfoLabel: {
    fontSize: 12.5,
    color: PALETTE.inkSecondary,
  },
  creatorInfoValue: {
    fontWeight: '700',
    color: PALETTE.inkPrimary,
  },
  newContributorBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: RADII.pill,
    backgroundColor: PALETTE.infoBg,
    borderWidth: 1,
    borderColor: PALETTE.infoBorder,
  },
  newContributorBadgeLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: PALETTE.infoText,
  },
  creatorMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  creatorMetaItem: {
    fontSize: 12,
    color: PALETTE.inkMuted,
  },
  creatorMetaMono: {
    ...TABULAR_NUMS_STYLE,
    fontFamily: MONO_FONT_FAMILY,
    fontSize: 11.5,
    fontWeight: '600',
    color: PALETTE.inkSecondary,
  },
  flagReviewCard: {
    gap: 6,
  },
  flagPickerBox: {
    padding: 10,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.bgSubtle,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    gap: 8,
  },
  flagReasonPromptText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: PALETTE.inkPrimary,
  },
  flagReasonChipSelected: {
    borderColor: PALETTE.neutralDot,
    backgroundColor: PALETTE.neutralBg,
  },
  flagReasonChipLabelSelected: {
    color: PALETTE.neutralText,
    fontWeight: '700',
  },
  flagOutlineButton: {
    alignSelf: 'flex-start',
    backgroundColor: PALETTE.bgSurface,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
  },
  flagOutlineButtonLabel: {
    fontSize: 12.5,
    fontWeight: '600',
    color: PALETTE.inkSecondary,
  },
  flagActiveButton: {
    alignSelf: 'flex-start',
    backgroundColor: PALETTE.neutralBg,
    borderWidth: 1,
    borderColor: PALETTE.neutralBorder,
  },
  flagActiveButtonLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    color: PALETTE.neutralText,
  },
  flagSubmitButton: {
    backgroundColor: PALETTE.neutralDot,
  },
  photoUploadBar: {
    flexDirection: 'row',
    gap: 8,
  },
  flexButton: {
    flex: 1,
  },
  photoSignInBanner: {
    padding: 10,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.infoBg,
    borderWidth: 1,
    borderColor: PALETTE.infoBorder,
  },
  photoSignInBannerText: {
    fontSize: 12,
    fontWeight: '600',
    color: PALETTE.infoText,
  },
  photosLoadingBox: {
    paddingVertical: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyPhotosBox: {
    padding: 14,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.bgSubtle,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
    alignItems: 'center',
  },
  emptyPhotosText: {
    fontSize: 12.5,
    color: PALETTE.inkMuted,
    textAlign: 'center',
  },
  photoCardsStack: {
    gap: 10,
  },
  photoCard: {
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    backgroundColor: PALETTE.bgSurface,
    overflow: 'hidden',
  },
  photoImageContainer: {
    width: '100%',
    height: 168,
    backgroundColor: PALETTE.bgRecessed,
    position: 'relative',
  },
  photoPressable: {
    width: '100%',
    height: '100%',
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  gpsVerifiedBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADII.pill,
    backgroundColor: 'rgba(16, 77, 49, 0.92)',
    borderWidth: 1,
    borderColor: PALETTE.positiveBorder,
  },
  gpsVerifiedBadgeLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  fakeShieldOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(18, 32, 25, 0.72)',
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  fakeShieldText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  revealPhotoBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: RADII.pill,
    backgroundColor: PALETTE.bgSurface,
  },
  revealPhotoBtnLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: PALETTE.inkPrimary,
  },
  photoMetaRow: {
    padding: 9,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  photoAuthorLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: PALETTE.inkSecondary,
  },
  photoRatingRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  photoVotePill: {
    minHeight: 34,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: RADII.pill,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    backgroundColor: PALETTE.bgSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoVotePillRealActive: {
    backgroundColor: PALETTE.accentPrimary,
    borderColor: PALETTE.accentPrimaryStrong,
  },
  photoVotePillFakeActive: {
    backgroundColor: PALETTE.dangerSolid,
    borderColor: PALETTE.dangerSolid,
  },
  photoVoteLabel: {
    ...TABULAR_NUMS_STYLE,
    fontSize: 11.5,
    fontWeight: '700',
    color: PALETTE.inkPrimary,
  },
  photoVoteLabelActive: {
    color: PALETTE.inkOnAccent,
  },
  photoDeletePill: {
    minHeight: 34,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: RADII.pill,
    borderWidth: 1,
    borderColor: PALETTE.dangerBorder,
    backgroundColor: PALETTE.dangerBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoDeleteLabel: {
    fontSize: 11.5,
    fontWeight: '700',
    color: PALETTE.dangerText,
  },
  manageCard: {
    padding: 10,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.bgSubtle,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
    gap: 8,
  },
  manageSectionTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    color: PALETTE.inkPrimary,
  },
  finishedActionButton: {
    backgroundColor: PALETTE.finishedSolid,
  },
  statusOptionChipInProgress: {
    borderColor: PALETTE.inProgressSolid,
    backgroundColor: PALETTE.inProgressBg,
  },
  statusOptionChipFinished: {
    borderColor: PALETTE.finishedSolid,
    backgroundColor: PALETTE.finishedBg,
  },
  editSection: {
    gap: 8,
  },
  immutableNotice: {
    fontSize: 12,
    lineHeight: 16,
    color: PALETTE.inkSecondary,
  },
  surfaceChoiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  surfaceChip: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    backgroundColor: PALETTE.bgSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  surfaceChipSelected: {
    borderColor: PALETTE.accentPrimary,
    backgroundColor: PALETTE.positiveBg,
  },
  surfaceChipLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: PALETTE.inkPrimary,
  },
  surfaceChipLabelSelected: {
    color: PALETTE.positiveText,
    fontWeight: '700',
  },
  editNoteInput: {
    minHeight: 60,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    backgroundColor: PALETTE.bgSurface,
    fontSize: 13,
    color: PALETTE.inkPrimary,
    textAlignVertical: 'top',
  },
  touchButton: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: RADII.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voteButton: {
    backgroundColor: PALETTE.bgSurface,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
  },
  upvoteButtonActive: {
    backgroundColor: PALETTE.accentPrimary,
    borderColor: PALETTE.accentPrimaryStrong,
  },
  downvoteButtonActive: {
    backgroundColor: PALETTE.dangerSolid,
    borderColor: PALETTE.dangerSolid,
  },
  voteButtonLabel: {
    ...TABULAR_NUMS_STYLE,
    fontSize: 13,
    fontWeight: '700',
    color: PALETTE.inkPrimary,
  },
  voteButtonLabelActive: {
    color: PALETTE.inkOnAccent,
  },
  deleteConfirmBox: {
    padding: 10,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.dangerBg,
    borderWidth: 1,
    borderColor: PALETTE.dangerBorder,
    gap: 8,
  },
  deleteConfirmText: {
    fontSize: 13,
    fontWeight: '700',
    color: PALETTE.dangerText,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
  },
  primaryButton: {
    backgroundColor: PALETTE.accentPrimary,
  },
  primaryButtonLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: PALETTE.inkOnAccent,
  },
  secondaryButton: {
    backgroundColor: PALETTE.bgSurface,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
  },
  secondaryButtonLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: PALETTE.inkPrimary,
  },
  dangerButton: {
    backgroundColor: PALETTE.dangerSolid,
  },
  dangerOutlineButton: {
    backgroundColor: PALETTE.dangerBg,
    borderWidth: 1,
    borderColor: PALETTE.dangerBorder,
  },
  dangerOutlineLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: PALETTE.dangerText,
  },
  abuseContactText: {
    fontSize: 11.5,
    color: PALETTE.inkMuted,
  },
  lightboxBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(10, 18, 14, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  lightboxCloseScrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  lightboxContent: {
    width: '100%',
    maxWidth: 880,
    maxHeight: '90%',
    gap: 12,
  },
  lightboxImage: {
    width: '100%',
    height: 460,
    borderRadius: RADII.md,
  },
  lightboxFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  lightboxAuthor: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  lightboxCloseBtn: {
    minHeight: 40,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.bgSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxCloseLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: PALETTE.inkPrimary,
  },
  });
}
