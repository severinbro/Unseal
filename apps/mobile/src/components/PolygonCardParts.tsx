// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import type { PolygonFeature } from '@openunseal/shared';
import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';

import { getTranslations, type Locale } from '../i18n/translations';
import { deriveInspectorOverviewMeta } from '../state/viewModels';
import { useTheme } from '../theme/themeContext';
import { createPolygonCardStyles } from './polygonCardStyles';

/**
 * The building blocks of an area card. The sheet on the map and the cards in
 * the feed are assembled from the same parts, so an area reads the same
 * wherever it is shown.
 */
function useCard(feature: PolygonFeature, locale: Locale) {
  const { palette, surfaceSwatches } = useTheme();
  const styles = useMemo(() => createPolygonCardStyles(palette), [palette]);
  const dict = getTranslations(locale);
  const { properties } = feature;
  const isFinished = properties.status === 'finished';
  const isInProgress = properties.status === 'in_progress';
  // Deviating private claims stay open for voting until an admin decides.
  const isOverride = properties.spaceVerification === 'user_override';
  return {
    styles,
    palette,
    t: dict.inspector,
    surfaceCopy: dict.surfaces,
    swatch: surfaceSwatches[properties.surfaceType],
    properties,
    isFinished,
    isInProgress,
    isVotingClosedByStatus: (isInProgress || isFinished) && !isOverride,
  };
}

/** Material, size, status and municipality. */
export function PolygonCardTitle(props: {
  feature: PolygonFeature;
  locale: Locale;
  isAdmin?: boolean;
}): React.JSX.Element {
  const { styles, t, surfaceCopy, swatch, properties, isFinished, isInProgress } =
    useCard(props.feature, props.locale);
  const overviewMeta = deriveInspectorOverviewMeta(
    props.feature,
    props.locale,
    props.isAdmin === true,
  );
  return (
    <View style={styles.materialTitleRow}>
      <View
        style={[styles.materialSwatch, { backgroundColor: swatch.color }]}
      >
        <Text style={[styles.materialSwatchCode, { color: swatch.ink }]}>
          {swatch.code}
        </Text>
      </View>
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
  );
}

/** Interlocked 3-cell mechanical vote rocker: [ ▲ +1 | NET SCORE | ▼ −1 ]. */
export function PolygonVotePanel(props: {
  feature: PolygonFeature;
  locale: Locale;
  busy: boolean;
  onVotePress: (value: 1 | -1) => void;
}): React.JSX.Element {
  const { styles, t, properties, isFinished, isInProgress, isVotingClosedByStatus } =
    useCard(props.feature, props.locale);
  const handleVotePress = props.onVotePress;
  const isVoteDisabled =
    props.busy || properties.isAuthor || isVotingClosedByStatus;
  const voteLockReason =
    isVotingClosedByStatus && isFinished
      ? t.votingClosedFinishedHint
      : isVotingClosedByStatus
        ? t.votingClosedInProgressHint
        : properties.isAuthor
          ? t.selfVoteDisabledHint
          : null;
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
  return (
    <>
      <View style={styles.voteRockerShell}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.upvoteA11y(properties.upvotes)}
          accessibilityState={{
            selected: properties.myVote === 1,
            disabled: isVoteDisabled,
          }}
          disabled={isVoteDisabled}
          onPress={() => handleVotePress(1)}
          style={({ pressed }) => [
            styles.voteRockerCell,
            styles.voteRockerLeft,
            properties.myVote === 1 ? styles.upvoteButtonActive : null,
            pressed && !isVoteDisabled ? styles.voteRockerPressed : null,
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
            ▲ +1 ({properties.upvotes})
          </Text>
        </Pressable>

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

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.downvoteA11y(properties.downvotes)}
          accessibilityState={{
            selected: properties.myVote === -1,
            disabled: isVoteDisabled,
          }}
          disabled={isVoteDisabled}
          onPress={() => handleVotePress(-1)}
          style={({ pressed }) => [
            styles.voteRockerCell,
            styles.voteRockerRight,
            properties.myVote === -1 ? styles.downvoteButtonActive : null,
            pressed && !isVoteDisabled ? styles.voteRockerPressed : null,
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
            ▼ −1 ({properties.downvotes})
          </Text>
        </Pressable>
      </View>

      {voteLockReason ? (
        <Text testID="vote-lock-hint" style={styles.immutableNotice}>
          {voteLockReason}
        </Text>
      ) : null}
    </>
  );
}

/** The contributor's note, or the standard text when there is none. */
export function PolygonNoteCard(props: {
  note: string | null;
  locale: Locale;
}): React.JSX.Element {
  const { palette } = useTheme();
  const styles = useMemo(() => createPolygonCardStyles(palette), [palette]);
  const t = getTranslations(props.locale).inspector;
  return (
    <View style={styles.noteCard}>
      <Text style={styles.noteBody}>
        {props.note && props.note.trim().length > 0 ? props.note : t.emptyNote}
      </Text>
    </View>
  );
}

/** Who proposed the area, when, and whether that account is still active. */
export function PolygonCreatorCard(props: {
  feature: PolygonFeature;
  locale: Locale;
  isAdmin?: boolean;
}): React.JSX.Element {
  const { styles, t, properties } = useCard(props.feature, props.locale);
  const { locale } = props;
  const { displayAuthorHandle, entryDateText, authorActivityText } =
    deriveInspectorOverviewMeta(props.feature, locale, props.isAdmin === true);
  return (
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
            {entryDateText ?? '-'}
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
  );
}
