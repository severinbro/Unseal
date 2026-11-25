// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import {
  SURFACE_TYPES,
  TRUST_AND_MODERATION_LIMITS,
  type PersonalStatsResponse,
  type PublicStatsResponse,
  type SurfaceType,
  type SpaceBreakdown,
} from '@openunseal/shared';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { getSocialCopy } from '../i18n/social';
import {
  DEFAULT_LOCALE,
  getTranslations,
  localizeError,
  type Locale,
} from '../i18n/translations';
import {
  MIN_TOUCH_TARGET_DP,
  formatAreaDisplay,
  formatStatsInteger,
} from '../state/viewModels';
import { useTheme } from '../theme/themeContext';
import {
  RADII,
  TABULAR_NUMS_STYLE,
  getSurfaceSwatches,
  type ThemePalette,
} from '../theme/tokens';

export type StatsModalTab = 'community' | 'personal';

export interface StatsModalProps {
  visible: boolean;
  locale?: Locale;
  compact?: boolean;
  isAuthenticated: boolean;
  initialTab?: StatsModalTab;
  staleUnratedPruneDays?: number;
  onLoadPublicStats: () => Promise<PublicStatsResponse>;
  onLoadPersonalStats: () => Promise<PersonalStatsResponse>;
  onRequestSignIn?: () => void;
  onClose: () => void;
}

export { formatAreaDisplay, formatStatsInteger };

export function StatsModal({
  visible,
  locale = DEFAULT_LOCALE,
  compact = false,
  isAuthenticated,
  initialTab = 'community',
  staleUnratedPruneDays = TRUST_AND_MODERATION_LIMITS.STALE_UNRATED_PRUNE_DAYS,
  onLoadPublicStats,
  onLoadPersonalStats,
  onRequestSignIn,
  onClose,
}: StatsModalProps): React.JSX.Element | null {
  const { palette, colorScheme } = useTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const surfaceSwatches = useMemo(
    () => getSurfaceSwatches(colorScheme),
    [colorScheme],
  );

  const [activeTab, setActiveTab] = useState<StatsModalTab>(initialTab);
  const [publicStats, setPublicStats] = useState<PublicStatsResponse | null>(
    null,
  );
  const [personalStats, setPersonalStats] =
    useState<PersonalStatsResponse | null>(null);
  const [isLoadingPublic, setIsLoadingPublic] = useState<boolean>(false);
  const [isLoadingPersonal, setIsLoadingPersonal] = useState<boolean>(false);
  const [publicError, setPublicError] = useState<string | null>(null);
  const [personalError, setPersonalError] = useState<string | null>(null);

  const requestSeqRef = useRef<number>(0);

  const loadStats = useCallback(
    async (target: 'both' | 'public' | 'personal') => {
      const seq = ++requestSeqRef.current;
      const fallbackMsg = getTranslations(locale).stats.loadErrorFallback;

      const shouldFetchPublic = target === 'both' || target === 'public';
      const shouldFetchPersonal =
        isAuthenticated && (target === 'both' || target === 'personal');

      if (shouldFetchPublic) {
        setIsLoadingPublic(true);
        setPublicError(null);
      }
      if (shouldFetchPersonal) {
        setIsLoadingPersonal(true);
        setPersonalError(null);
      }

      const tasks: Promise<void>[] = [];

      if (shouldFetchPublic) {
        tasks.push(
          onLoadPublicStats()
            .then((data) => {
              if (requestSeqRef.current === seq) {
                setPublicStats(data);
              }
            })
            .catch((err: unknown) => {
              if (requestSeqRef.current === seq) {
                setPublicError(localizeError(err, fallbackMsg, locale));
              }
            })
            .finally(() => {
              if (requestSeqRef.current === seq) {
                setIsLoadingPublic(false);
              }
            }),
        );
      }

      if (shouldFetchPersonal) {
        tasks.push(
          onLoadPersonalStats()
            .then((data) => {
              if (requestSeqRef.current === seq) {
                setPersonalStats(data);
              }
            })
            .catch((err: unknown) => {
              if (requestSeqRef.current === seq) {
                setPersonalError(localizeError(err, fallbackMsg, locale));
              }
            })
            .finally(() => {
              if (requestSeqRef.current === seq) {
                setIsLoadingPersonal(false);
              }
            }),
        );
      }

      await Promise.all(tasks);
    },
    [isAuthenticated, locale, onLoadPersonalStats, onLoadPublicStats],
  );

  useEffect(() => {
    if (!visible) {
      return;
    }
    setActiveTab(initialTab);
    void loadStats('both');
  }, [visible, initialTab, loadStats]);

  useEffect(() => {
    if (!isAuthenticated) {
      setPersonalStats(null);
      setPersonalError(null);
    }
  }, [isAuthenticated]);

  if (!visible) {
    return null;
  }

  const dict = getTranslations(locale);
  const t = dict.stats;

  const handleRefresh = (): void => {
    void loadStats(activeTab === 'personal' ? 'personal' : 'public');
  };

  const renderSpaceBreakdown = (
    breakdown: SpaceBreakdown | undefined,
  ): React.JSX.Element | null => {
    if (!breakdown) {
      return null;
    }
    const copy = getSocialCopy(locale);
    return (
      <View style={styles.sectionCard} testID="stats-space-breakdown">
        <Text style={styles.sectionTitle}>{copy.statsTitle}</Text>
        {(['public', 'private'] as const).map((type) => (
          <View key={type}>
            <Text style={styles.surfaceName}>
              {type === 'public' ? copy.groundPublic : copy.groundPrivate}
            </Text>
            <Text style={styles.surfaceAreaText}>
              {copy.statsLine(
                breakdown[type].totalPolygons,
                formatAreaDisplay(breakdown[type].totalAreaM2, locale),
                formatAreaDisplay(breakdown[type].unsealedAreaM2, locale),
              )}
            </Text>
          </View>
        ))}
      </View>
    );
  };

  const renderSurfaceRow = (
    surfaceType: SurfaceType,
    totalPolygons: number,
  ): React.JSX.Element => {
    const item = publicStats?.surfaceBreakdown[surfaceType] ?? {
      count: 0,
      areaM2: 0,
    };
    const swatch = surfaceSwatches[surfaceType];
    const share =
      totalPolygons > 0 ? Math.min(1, Math.max(0, item.count / totalPolygons)) : 0;

    return (
      <View key={surfaceType} style={styles.surfaceRow}>
        <View style={styles.surfaceHeaderRow}>
          <View style={styles.surfaceLabelGroup}>
            <View
              style={[
                styles.surfaceSwatchBadge,
                { backgroundColor: swatch.color },
              ]}
            >
              <Text style={styles.surfaceSwatchCode}>{swatch.code}</Text>
            </View>
            <Text style={styles.surfaceName}>
              {dict.surfaces[surfaceType].label}
            </Text>
          </View>
          <View style={styles.surfaceMetricsGroup}>
            <Text style={styles.surfaceCountText}>
              {t.polygonsCountBadge(item.count)}
            </Text>
            <Text style={styles.surfaceAreaText}>
              {formatAreaDisplay(item.areaM2, locale)}
            </Text>
          </View>
        </View>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${Math.round(share * 100)}%`,
                backgroundColor: swatch.color,
              },
            ]}
          />
        </View>
      </View>
    );
  };

  return (
    <View
      testID="stats-modal-card"
      accessibilityLabel={t.modalA11y}
      style={[styles.card, compact ? styles.cardCompact : null]}
    >
      <View style={styles.headerBlock}>
        <View style={styles.headerRow}>
          <Text
            style={[styles.title, compact ? styles.titleCompact : null]}
          >
            {t.title}
          </Text>
          <View style={styles.headerActionsRow}>
            {(activeTab === 'community' || isAuthenticated) ? (
              <Pressable
                testID="stats-modal-refresh"
                accessibilityRole="button"
                accessibilityLabel={t.refreshA11y}
                disabled={isLoadingPublic || isLoadingPersonal}
                onPress={handleRefresh}
                style={({ pressed }) => [
                  styles.secondaryHeaderButton,
                  compact ? styles.headerButtonCompact : null,
                  pressed ? styles.buttonPressed : null,
                ]}
              >
                <Text style={styles.secondaryHeaderButtonLabel}>{t.refresh}</Text>
              </Pressable>
            ) : null}
            <Pressable
              testID="stats-modal-close"
              accessibilityRole="button"
              accessibilityLabel={t.closeA11y}
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeButton,
                compact ? styles.headerButtonCompact : null,
                pressed ? styles.buttonPressed : null,
              ]}
            >
              <Text style={styles.closeButtonLabel}>{t.close}</Text>
            </Pressable>
          </View>
        </View>
        <Text style={styles.subtitle}>{t.subtitle}</Text>
      </View>

      <View
        accessibilityRole="tablist"
        accessibilityLabel={t.tabGroupA11y}
        style={styles.tabBar}
      >
        <Pressable
          testID="stats-tab-community"
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'community' }}
          onPress={() => setActiveTab('community')}
          style={({ pressed }) => [
            styles.tabButton,
            activeTab === 'community' ? styles.tabButtonActive : null,
            pressed ? styles.buttonPressed : null,
          ]}
        >
          <Text
            style={[
              styles.tabButtonLabel,
              activeTab === 'community' ? styles.tabButtonLabelActive : null,
            ]}
          >
            {t.tabCommunity}
          </Text>
        </Pressable>

        <Pressable
          testID="stats-tab-personal"
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'personal' }}
          onPress={() => {
            setActiveTab('personal');
            if (isAuthenticated && personalStats === null && !isLoadingPersonal) {
              void loadStats('personal');
            }
          }}
          style={({ pressed }) => [
            styles.tabButton,
            activeTab === 'personal' ? styles.tabButtonActive : null,
            pressed ? styles.buttonPressed : null,
          ]}
        >
          <Text
            style={[
              styles.tabButtonLabel,
              activeTab === 'personal' ? styles.tabButtonLabelActive : null,
            ]}
          >
            {t.tabPersonal}
          </Text>
        </Pressable>
      </View>

      {activeTab === 'community' ? (
        <>
          {isLoadingPublic && publicStats === null ? (
            <View style={styles.centerStateBox}>
              <ActivityIndicator size="small" color={palette.accentPrimary} />
              <Text style={styles.stateText}>{t.loading}</Text>
            </View>
          ) : publicError !== null && publicStats === null ? (
            <View style={styles.errorBox} accessibilityRole="alert">
              <Text style={styles.errorText}>{publicError}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void loadStats('public')}
                style={({ pressed }) => [
                  styles.retryButton,
                  pressed ? styles.buttonPressed : null,
                ]}
              >
                <Text style={styles.retryButtonLabel}>{t.retry}</Text>
              </Pressable>
            </View>
          ) : publicStats !== null ? (
            <>
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>{t.polygonsSectionTitle}</Text>
                <View style={styles.heroStatRow}>
                  <Text style={styles.heroLabel}>{t.totalPolygonsLabel}</Text>
                  <Text style={styles.heroValue}>
                    {formatStatsInteger(publicStats.totalPolygons, locale)}
                  </Text>
                </View>

                <View style={styles.statGrid}>
                  <View style={styles.statTile}>
                    <View style={styles.statTileLabelRow}>
                      <View
                        style={[
                          styles.statusDot,
                          { backgroundColor: palette.positiveDot },
                        ]}
                      />
                      <Text style={styles.statTileLabel}>{t.proposedLabel}</Text>
                    </View>
                    <Text style={styles.statTileValue}>
                      {formatStatsInteger(publicStats.proposedCount, locale)}
                    </Text>
                  </View>

                  <View style={styles.statTile}>
                    <View style={styles.statTileLabelRow}>
                      <View
                        style={[
                          styles.statusDot,
                          { backgroundColor: palette.inProgressDot },
                        ]}
                      />
                      <Text style={styles.statTileLabel}>
                        {t.inProgressLabel}
                      </Text>
                    </View>
                    <Text style={styles.statTileValue}>
                      {formatStatsInteger(publicStats.inProgressCount, locale)}
                    </Text>
                  </View>

                  <View style={[styles.statTile, styles.statTileFinished]}>
                    <View style={styles.statTileLabelRow}>
                      <View
                        style={[
                          styles.statusDot,
                          { backgroundColor: palette.finishedDot },
                        ]}
                      />
                      <Text
                        style={[
                          styles.statTileLabel,
                          { color: palette.finishedText },
                        ]}
                      >
                        {t.finishedLabel}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.statTileValue,
                        { color: palette.finishedText },
                      ]}
                    >
                      {formatStatsInteger(publicStats.finishedCount, locale)}
                    </Text>
                  </View>

                  <View style={[styles.statTile, styles.statTileNeedsReview]}>
                    <View style={styles.statTileLabelRow}>
                      <View
                        style={[
                          styles.statusDot,
                          { backgroundColor: palette.neutralDot },
                        ]}
                      />
                      <Text
                        style={[
                          styles.statTileLabel,
                          { color: palette.neutralText },
                        ]}
                      >
                        {t.needsReviewLabel}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.statTileValue,
                        { color: palette.neutralText },
                      ]}
                    >
                      {formatStatsInteger(publicStats.needsReviewCount, locale)}
                    </Text>
                  </View>
                </View>

                <Text style={styles.hintText}>
                  {t.needsReviewHint(staleUnratedPruneDays)}
                </Text>
              </View>

              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>{t.areaSectionTitle}</Text>
                <View style={styles.statGrid}>
                  <View style={styles.statTile}>
                    <Text style={styles.statTileLabel}>{t.areaMappedLabel}</Text>
                    <Text style={styles.statTileValue}>
                      {formatAreaDisplay(publicStats.totalAreaM2, locale)}
                    </Text>
                  </View>
                  <View style={[styles.statTile, styles.statTileFinished]}>
                    <Text
                      style={[
                        styles.statTileLabel,
                        { color: palette.finishedText },
                      ]}
                    >
                      {t.areaUnsealedLabel}
                    </Text>
                    <Text
                      style={[
                        styles.statTileValue,
                        { color: palette.finishedText },
                      ]}
                    >
                      {formatAreaDisplay(publicStats.unsealedAreaM2, locale)}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>{t.votesSectionTitle}</Text>
                <View style={styles.votesRow}>
                  <View style={styles.votePill}>
                    <Text style={styles.votePillLabel}>{t.totalVotesLabel}</Text>
                    <Text style={styles.votePillValue}>
                      {formatStatsInteger(publicStats.totalVotes, locale)}
                    </Text>
                  </View>
                  <View style={[styles.votePill, styles.votePillPositive]}>
                    <Text
                      style={[
                        styles.votePillLabel,
                        { color: palette.positiveText },
                      ]}
                    >
                      {t.totalUpvotesLabel}
                    </Text>
                    <Text
                      style={[
                        styles.votePillValue,
                        { color: palette.positiveText },
                      ]}
                    >
                      {formatStatsInteger(publicStats.totalUpvotes, locale)}
                    </Text>
                  </View>
                  <View style={[styles.votePill, styles.votePillNegative]}>
                    <Text
                      style={[
                        styles.votePillLabel,
                        { color: palette.dangerText },
                      ]}
                    >
                      {t.totalDownvotesLabel}
                    </Text>
                    <Text
                      style={[
                        styles.votePillValue,
                        { color: palette.dangerText },
                      ]}
                    >
                      {formatStatsInteger(publicStats.totalDownvotes, locale)}
                    </Text>
                  </View>
                </View>
              </View>

              {renderSpaceBreakdown(publicStats.spaceBreakdown)}
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>{t.surfaceSectionTitle}</Text>
                <View style={styles.surfaceList}>
                  {SURFACE_TYPES.map((surfaceType) =>
                    renderSurfaceRow(surfaceType, publicStats.totalPolygons),
                  )}
                </View>
              </View>

              <Text style={styles.privacyFooter}>{t.communityPrivacyFooter}</Text>
            </>
          ) : null}
        </>
      ) : !isAuthenticated ? (
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{t.personalSignInTitle}</Text>
          <Text style={styles.signInBodyText}>{t.personalSignInBody}</Text>
          {onRequestSignIn ? (
            <Pressable
              testID="stats-personal-signin"
              accessibilityRole="button"
              onPress={onRequestSignIn}
              style={({ pressed }) => [
                styles.primaryActionButton,
                pressed ? styles.buttonPressed : null,
              ]}
            >
              <Text style={styles.primaryActionButtonLabel}>
                {t.personalSignInButton}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : isLoadingPersonal && personalStats === null ? (
        <View style={styles.centerStateBox}>
          <ActivityIndicator size="small" color={palette.accentPrimary} />
          <Text style={styles.stateText}>{t.loading}</Text>
        </View>
      ) : personalError !== null && personalStats === null ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>{personalError}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void loadStats('personal')}
            style={({ pressed }) => [
              styles.retryButton,
              pressed ? styles.buttonPressed : null,
            ]}
          >
            <Text style={styles.retryButtonLabel}>{t.retry}</Text>
          </Pressable>
        </View>
      ) : personalStats !== null ? (
        <>
          {renderSpaceBreakdown(personalStats.spaceBreakdown)}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>{t.personalPolygonsTitle}</Text>
            <View style={styles.heroStatRow}>
              <Text style={styles.heroLabel}>{t.personalSuggestedLabel}</Text>
              <Text style={styles.heroValue}>
                {formatStatsInteger(personalStats.totalPolygons, locale)}
              </Text>
            </View>

            <View style={styles.statGrid}>
              <View style={styles.statTile}>
                <Text style={styles.statTileLabel}>
                  {t.personalProposedOpenLabel}
                </Text>
                <Text style={styles.statTileValue}>
                  {formatStatsInteger(personalStats.proposedCount, locale)}
                </Text>
              </View>

              <View style={styles.statTile}>
                <Text style={styles.statTileLabel}>
                  {t.personalInProgressLabel}
                </Text>
                <Text style={styles.statTileValue}>
                  {formatStatsInteger(personalStats.inProgressCount, locale)}
                </Text>
              </View>

              <View style={[styles.statTile, styles.statTileFinished]}>
                <Text
                  style={[
                    styles.statTileLabel,
                    { color: palette.finishedText },
                  ]}
                >
                  {t.personalUnsealedLabel}
                </Text>
                <Text
                  style={[
                    styles.statTileValue,
                    { color: palette.finishedText },
                  ]}
                >
                  {formatStatsInteger(personalStats.finishedCount, locale)}
                </Text>
              </View>
            </View>

            <View style={styles.statGrid}>
              <View style={styles.statTile}>
                <Text style={styles.statTileLabel}>
                  {t.personalAreaMappedLabel}
                </Text>
                <Text style={styles.statTileValue}>
                  {formatAreaDisplay(personalStats.totalAreaM2, locale)}
                </Text>
              </View>

              <View style={[styles.statTile, styles.statTileFinished]}>
                <Text
                  style={[
                    styles.statTileLabel,
                    { color: palette.finishedText },
                  ]}
                >
                  {t.personalAreaUnsealedLabel}
                </Text>
                <Text
                  style={[
                    styles.statTileValue,
                    { color: palette.finishedText },
                  ]}
                >
                  {formatAreaDisplay(personalStats.unsealedAreaM2, locale)}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>{t.personalEngagementTitle}</Text>
            <View style={styles.heroStatRow}>
              <Text style={styles.heroLabel}>
                {t.personalRatedPolygonsLabel}
              </Text>
              <Text style={styles.heroValue}>
                {formatStatsInteger(personalStats.ratedPolygonsCount, locale)}
              </Text>
            </View>
          </View>

          <Text style={styles.privacyFooter}>{t.personalPrivacyNote}</Text>
        </>
      ) : null}
    </View>
  );
}

function createStyles(PALETTE: ThemePalette) {
  return StyleSheet.create({
    card: {
      width: '100%',
      maxWidth: '100%',
      backgroundColor: PALETTE.bgSurface,
      borderRadius: RADII.sheet,
      padding: 20,
      gap: 14,
      borderWidth: 1,
      borderColor: PALETTE.borderStrong,
    },
    cardCompact: {
      padding: 14,
      gap: 11,
    },
    headerBlock: {
      gap: 6,
      minWidth: 0,
    },
    headerRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    headerActionsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 6,
    },
    title: {
      fontSize: 20,
      fontWeight: '700',
      color: PALETTE.inkPrimary,
      letterSpacing: -0.3,
      flexShrink: 1,
    },
    titleCompact: {
      fontSize: 17.5,
    },
    subtitle: {
      fontSize: 13,
      lineHeight: 18,
      color: PALETTE.inkSecondary,
    },
    secondaryHeaderButton: {
      minHeight: MIN_TOUCH_TARGET_DP,
      paddingHorizontal: 12,
      borderRadius: RADII.md,
      borderWidth: 1,
      borderColor: PALETTE.borderSubtle,
      backgroundColor: PALETTE.bgSubtle,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerButtonCompact: {
      paddingHorizontal: 10,
    },
    secondaryHeaderButtonLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: PALETTE.inkSecondary,
    },
    closeButton: {
      minHeight: MIN_TOUCH_TARGET_DP,
      paddingHorizontal: 14,
      borderRadius: RADII.md,
      borderWidth: 1,
      borderColor: PALETTE.borderStrong,
      backgroundColor: PALETTE.bgSubtle,
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeButtonLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: PALETTE.inkPrimary,
    },
    buttonPressed: {
      opacity: 0.8,
    },
    tabBar: {
      flexDirection: 'row',
      padding: 4,
      borderRadius: RADII.md,
      backgroundColor: PALETTE.bgRecessed,
      borderWidth: 1,
      borderColor: PALETTE.borderSubtle,
      gap: 4,
    },
    tabButton: {
      flex: 1,
      minHeight: 38,
      borderRadius: RADII.sm,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 10,
    },
    tabButtonActive: {
      backgroundColor: PALETTE.bgSurface,
      borderWidth: 1,
      borderColor: PALETTE.borderAccent,
    },
    tabButtonLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: PALETTE.inkSecondary,
    },
    tabButtonLabelActive: {
      color: PALETTE.accentPrimary,
      fontWeight: '700',
    },
    centerStateBox: {
      paddingVertical: 28,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
    },
    stateText: {
      fontSize: 13,
      color: PALETTE.inkSecondary,
    },
    errorBox: {
      padding: 14,
      borderRadius: RADII.md,
      backgroundColor: PALETTE.dangerBg,
      borderWidth: 1,
      borderColor: PALETTE.dangerBorder,
      gap: 10,
      alignItems: 'flex-start',
    },
    errorText: {
      fontSize: 13,
      lineHeight: 18,
      color: PALETTE.dangerText,
    },
    retryButton: {
      minHeight: 36,
      paddingHorizontal: 12,
      borderRadius: RADII.sm,
      backgroundColor: PALETTE.bgSurface,
      borderWidth: 1,
      borderColor: PALETTE.dangerBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    retryButtonLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: PALETTE.dangerText,
    },
    sectionCard: {
      backgroundColor: PALETTE.bgSubtle,
      borderRadius: RADII.lg,
      padding: 14,
      gap: 10,
      borderWidth: 1,
      borderColor: PALETTE.borderSubtle,
    },
    sectionTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: PALETTE.inkPrimary,
      letterSpacing: -0.1,
    },
    heroStatRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: 8,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: RADII.md,
      backgroundColor: PALETTE.bgSurface,
      borderWidth: 1,
      borderColor: PALETTE.borderSubtle,
    },
    heroLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: PALETTE.inkSecondary,
      flexShrink: 1,
    },
    heroValue: {
      ...TABULAR_NUMS_STYLE,
      fontSize: 22,
      fontWeight: '800',
      color: PALETTE.inkPrimary,
    },
    statGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    statTile: {
      flexGrow: 1,
      flexBasis: '46%',
      minWidth: 130,
      maxWidth: '100%',
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: RADII.md,
      backgroundColor: PALETTE.bgSurface,
      borderWidth: 1,
      borderColor: PALETTE.borderSubtle,
      gap: 4,
    },
    statTileFinished: {
      backgroundColor: PALETTE.finishedBg,
      borderColor: PALETTE.finishedBorder,
    },
    statTileNeedsReview: {
      backgroundColor: PALETTE.neutralBg,
      borderColor: PALETTE.neutralBorder,
    },
    statTileLabelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    statusDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    statTileLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: PALETTE.inkSecondary,
      flexShrink: 1,
    },
    statTileValue: {
      ...TABULAR_NUMS_STYLE,
      fontSize: 17,
      fontWeight: '700',
      color: PALETTE.inkPrimary,
    },
    hintText: {
      fontSize: 11,
      lineHeight: 16,
      color: PALETTE.inkMuted,
    },
    votesRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    votePill: {
      flexGrow: 1,
      flexBasis: '30%',
      minWidth: 100,
      maxWidth: '100%',
      paddingVertical: 9,
      paddingHorizontal: 10,
      borderRadius: RADII.md,
      backgroundColor: PALETTE.bgSurface,
      borderWidth: 1,
      borderColor: PALETTE.borderSubtle,
      gap: 3,
    },
    votePillPositive: {
      backgroundColor: PALETTE.positiveBg,
      borderColor: PALETTE.positiveBorder,
    },
    votePillNegative: {
      backgroundColor: PALETTE.dangerBg,
      borderColor: PALETTE.dangerBorder,
    },
    votePillLabel: {
      fontSize: 11,
      fontWeight: '600',
      color: PALETTE.inkSecondary,
    },
    votePillValue: {
      ...TABULAR_NUMS_STYLE,
      fontSize: 16,
      fontWeight: '700',
      color: PALETTE.inkPrimary,
    },
    surfaceList: {
      gap: 10,
    },
    surfaceRow: {
      gap: 5,
    },
    surfaceHeaderRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 6,
    },
    surfaceLabelGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flexShrink: 1,
      minWidth: 0,
    },
    surfaceSwatchBadge: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: RADII.xs,
    },
    surfaceSwatchCode: {
      fontSize: 10,
      fontWeight: '700',
      color: '#FFFFFF',
      letterSpacing: 0.4,
    },
    surfaceName: {
      fontSize: 13,
      fontWeight: '600',
      color: PALETTE.inkPrimary,
      flexShrink: 1,
    },
    surfaceMetricsGroup: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 8,
    },
    surfaceCountText: {
      ...TABULAR_NUMS_STYLE,
      fontSize: 12,
      fontWeight: '600',
      color: PALETTE.inkSecondary,
    },
    surfaceAreaText: {
      ...TABULAR_NUMS_STYLE,
      fontSize: 12,
      fontWeight: '700',
      color: PALETTE.inkPrimary,
    },
    progressTrack: {
      height: 6,
      borderRadius: RADII.pill,
      backgroundColor: PALETTE.bgRecessed,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      borderRadius: RADII.pill,
    },
    signInBodyText: {
      fontSize: 13,
      lineHeight: 19,
      color: PALETTE.inkSecondary,
    },
    primaryActionButton: {
      minHeight: MIN_TOUCH_TARGET_DP,
      maxWidth: '100%',
      borderRadius: RADII.md,
      paddingHorizontal: 16,
      backgroundColor: PALETTE.accentPrimary,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'flex-start',
    },
    primaryActionButtonLabel: {
      fontSize: 13,
      fontWeight: '700',
      color: PALETTE.inkOnAccent,
    },
    privacyFooter: {
      fontSize: 11,
      lineHeight: 16,
      color: PALETTE.inkMuted,
    },
  });
}
