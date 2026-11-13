import {
  GEOMETRY_LIMITS,
  SURFACE_TYPES,
  type PatchPolygonRequest,
  type PhotoVoteResponse,
  type PolygonFeature,
  type PolygonPhoto,
  type PolygonStatus,
  type SurfaceType,
} from '@entsiegelung/shared';
import React, { useCallback, useEffect, useState } from 'react';
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
  localizeDisclaimerText,
  localizeError,
  type Locale,
} from '../i18n/translations';
import { MIN_TOUCH_TARGET_DP } from '../state/viewModels';
import {
  MONO_FONT_FAMILY,
  PALETTE,
  RADII,
  SURFACE_SWATCHES,
  TABULAR_NUMS_STYLE,
} from '../theme/tokens';

export type InspectorTab = 'overview' | 'photos' | 'manage';

export interface PolygonInspectorSheetProps {
  feature: PolygonFeature | null;
  overlapIndex: number;
  overlapCount: number;
  disclaimerText: string;
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
  onVotePhoto?: (
    photoId: string,
    value: 1 | -1,
  ) => Promise<PhotoVoteResponse>;
  onClearPhotoVote?: (photoId: string) => Promise<PhotoVoteResponse>;
  onDeletePhoto?: (photoId: string, polygonId: string) => Promise<void>;
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
  onVotePhoto,
  onClearPhotoVote,
  onDeletePhoto,
}: PolygonInspectorSheetProps): React.JSX.Element | null {
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
  const [isUploadingPhoto, setIsUploadingPhoto] = useState<boolean>(false);
  const [revealedFakeIds, setRevealedFakeIds] = useState<
    Record<string, boolean>
  >({});
  const [lightboxPhoto, setLightboxPhoto] = useState<PolygonPhoto | null>(null);

  const featureId = feature?.id ?? null;
  const featureSurfaceType = feature?.properties.surfaceType ?? 'asphalt';
  const featureNote = feature?.properties.note ?? '';
  const featurePhotoCount = feature?.properties.photoCount ?? 0;

  useEffect(() => {
    setActiveTab('overview');
    setIsEditing(false);
    setConfirmingDelete(false);
    setActionError(null);
    setEditSurfaceType(featureSurfaceType);
    setEditNote(featureNote);
    setPhotos([]);
    setPhotosLoadedForId(null);
    setRevealedFakeIds({});
    setLightboxPhoto(null);
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

  if (feature === null) {
    return null;
  }

  const dict = getTranslations(locale);
  const t = dict.inspector;
  const surfaceCopy = dict.surfaces;
  const localizedDisclaimer =
    localizeDisclaimerText(disclaimerText, locale) ?? disclaimerText;

  const { properties } = feature;
  const swatch = SURFACE_SWATCHES[properties.surfaceType];
  const isFinished = properties.status === 'finished';
  const effectiveOverlapCount = Math.max(1, overlapCount);
  const displayOverlapPosition = Math.min(
    effectiveOverlapCount,
    overlapIndex + 1,
  );
  const displayedPhotoCount =
    photosLoadedForId === feature.id ? photos.length : properties.photoCount;

  const scoreToneStyle = isFinished
    ? styles.scoreBadgeFinished
    : properties.score > 0
      ? styles.scoreBadgePositive
      : properties.score < 0
        ? styles.scoreBadgeNegative
        : styles.scoreBadgeNeutral;
  const scoreTextToneStyle = isFinished
    ? styles.scoreBadgeTextFinished
    : properties.score > 0
      ? styles.scoreBadgeTextPositive
      : properties.score < 0
        ? styles.scoreBadgeTextNegative
        : styles.scoreBadgeTextNeutral;

  const toPhotoUrl = (rawUrl: string): string =>
    resolveUploadUrl ? resolveUploadUrl(rawUrl) : rawUrl;

  const handleVotePress = (targetValue: 1 | -1): void => {
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

  const handleSavePatch = (): void => {
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

  const handleToggleStatus = (): void => {
    if (!onPatchPolygonStatus) {
      return;
    }
    setActionError(null);
    setIsBusy(true);
    const nextStatus: PolygonStatus = isFinished ? 'proposed' : 'finished';

    void onPatchPolygonStatus(feature.id, nextStatus)
      .catch((err: unknown) => {
        setActionError(localizeError(err, t.statusErrorFallback, locale));
      })
      .finally(() => {
        setIsBusy(false);
      });
  };

  const handleConfirmDelete = (): void => {
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
    setIsUploadingPhoto(true);
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
        setIsUploadingPhoto(false);
      });
  };

  const handlePhotoVote = (photo: PolygonPhoto, value: 1 | -1): void => {
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
                  : styles.statusBadgeProposed,
              ]}
            >
              <Text
                style={[
                  styles.statusBadgeLabel,
                  isFinished
                    ? styles.statusBadgeLabelFinished
                    : styles.statusBadgeLabelProposed,
                ]}
              >
                {isFinished ? t.statusFinishedBadge : t.statusProposedBadge}
              </Text>
            </View>
          </View>

          <View style={styles.metaSubtitleRow}>
            <Text style={styles.authorMeta}>
              {t.proposedBy(properties.authorPseudonym, properties.isAuthor)}
            </Text>
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
              disabled: isBusy,
            }}
            disabled={isBusy}
            onPress={() => handleVotePress(1)}
            style={[
              styles.touchButton,
              styles.voteButton,
              properties.myVote === 1 ? styles.upvoteButtonActive : null,
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
              disabled: isBusy,
            }}
            disabled={isBusy}
            onPress={() => handleVotePress(-1)}
            style={[
              styles.touchButton,
              styles.voteButton,
              properties.myVote === -1 ? styles.downvoteButtonActive : null,
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
              activeTab === 'overview' ? styles.tabButtonLabelActive : null,
            ]}
          >
            {t.tabOverview}
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

          {properties.municipalityName &&
          properties.score > 0 &&
          !isFinished ? (
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

          <View
            style={styles.permanentDisclaimerBox}
            accessibilityLabel={t.permanentDisclaimerA11y}
          >
            <Text style={styles.permanentDisclaimerText}>
              {localizedDisclaimer}
            </Text>
          </View>
        </View>
      ) : null}

      {activeTab === 'photos' ? (
        <View style={styles.tabSection}>
          {isAuthenticated ? (
            <View style={styles.photoUploadBar}>
              {onUploadPhotoFromCamera ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t.addPhotoCamera}
                  disabled={isUploadingPhoto}
                  onPress={() => handleUploadPhoto('camera')}
                  style={[
                    styles.touchButton,
                    styles.flexButton,
                    styles.secondaryButton,
                  ]}
                >
                  <Text style={styles.secondaryButtonLabel}>
                    {isUploadingPhoto ? t.uploadingPhoto : t.addPhotoCamera}
                  </Text>
                </Pressable>
              ) : null}

              {onUploadPhotoFromLibrary ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t.addPhotoGallery}
                  disabled={isUploadingPhoto}
                  onPress={() => handleUploadPhoto('library')}
                  style={[
                    styles.touchButton,
                    styles.flexButton,
                    styles.secondaryButton,
                  ]}
                >
                  <Text style={styles.secondaryButtonLabel}>
                    {isUploadingPhoto ? t.uploadingPhoto : t.addPhotoGallery}
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
              <ActivityIndicator size="small" color={PALETTE.accentPrimary} />
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
                        @{photo.uploaderPseudonym}
                      </Text>

                      <View style={styles.photoRatingRow}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t.rateRealA11y(photo.realVotes)}
                          accessibilityState={{ selected: photo.myVote === 1 }}
                          disabled={isBusy}
                          onPress={() => handlePhotoVote(photo, 1)}
                          style={[
                            styles.photoVotePill,
                            photo.myVote === 1
                              ? styles.photoVotePillRealActive
                              : null,
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
                          accessibilityState={{ selected: photo.myVote === -1 }}
                          disabled={isBusy}
                          onPress={() => handlePhotoVote(photo, -1)}
                          style={[
                            styles.photoVotePill,
                            photo.myVote === -1
                              ? styles.photoVotePillFakeActive
                              : null,
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
          {isAdmin && onPatchPolygonStatus ? (
            <View style={styles.manageCard}>
              <Text style={styles.manageSectionTitle}>
                {t.adminSectionTitle}
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={isBusy}
                onPress={handleToggleStatus}
                style={[
                  styles.touchButton,
                  isFinished
                    ? styles.secondaryButton
                    : styles.finishedActionButton,
                ]}
              >
                <Text
                  style={
                    isFinished
                      ? styles.secondaryButtonLabel
                      : styles.primaryButtonLabel
                  }
                >
                  {isBusy
                    ? t.updatingStatus
                    : isFinished
                      ? t.markProposedButton
                      : t.markFinishedButton}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {properties.isAuthor ? (
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
                    placeholderTextColor={PALETTE.inkMuted}
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

          {!isAdmin && !properties.isAuthor ? (
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

const styles = StyleSheet.create({
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
  statusBadgeLabelFinished: {
    color: PALETTE.finishedText,
  },
  metaSubtitleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  authorMeta: {
    fontSize: 12,
    color: PALETTE.inkMuted,
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
    paddingHorizontal: 8,
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
    fontSize: 12.5,
    fontWeight: '600',
    color: PALETTE.inkSecondary,
  },
  tabButtonLabelActive: {
    color: PALETTE.inkPrimary,
    fontWeight: '700',
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
