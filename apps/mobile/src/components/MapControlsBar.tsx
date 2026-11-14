import type { PolygonAuthorFilter } from '@entsiegelung/shared';
import React from 'react';
import {
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  getTranslations,
  localizeError,
  type Locale,
} from '../i18n/translations';
import type { BasemapMode } from '../state/appState';
import {
  MIN_TOUCH_TARGET_DP,
  type MapControlsModel,
} from '../state/viewModels';
import {
  PALETTE,
  RADII,
  TABULAR_NUMS_STYLE,
  type ViewportTier,
} from '../theme/tokens';

interface WebAnchorElementLike {
  href: string;
  download: string;
  rel: string;
  style: { display: string };
  click(): void;
}

interface WebDocumentLike {
  createElement(tagName: 'a'): WebAnchorElementLike;
  body?: {
    appendChild(node: WebAnchorElementLike): void;
    removeChild(node: WebAnchorElementLike): void;
  } | null;
}

export async function triggerFileDownload(
  downloadUrl: string,
  filename: string,
): Promise<void> {
  if (Platform.OS === 'web') {
    const scope = globalThis as { document?: WebDocumentLike };
    const doc = scope.document;
    if (doc && typeof doc.createElement === 'function') {
      const anchor = doc.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = filename;
      anchor.rel = 'noopener noreferrer';
      anchor.style.display = 'none';
      if (doc.body) {
        doc.body.appendChild(anchor);
        try {
          anchor.click();
        } finally {
          doc.body.removeChild(anchor);
        }
      } else {
        anchor.click();
      }
      return;
    }
  }

  await Linking.openURL(downloadUrl);
}

export async function triggerGeoJsonExportDownload(
  exportUrl: string,
): Promise<void> {
  await triggerFileDownload(exportUrl, 'entsiegelung-proposals.geojson');
}

export async function triggerApkDownload(apkUrl: string): Promise<void> {
  await triggerFileDownload(apkUrl, 'unseal.apk');
}

export interface MapControlsBarProps {
  controls: MapControlsModel;
  proposalCount: number;
  exportGeoJsonUrl: string;
  isImporting?: boolean;
  tier?: ViewportTier;
  onToggleLocale?: () => void;
  onOpenAbout?: () => void;
  onSetBasemapMode: (mode: BasemapMode) => void;
  onSetAuthorFilter?: (filter: PolygonAuthorFilter) => void;
  onToggleUnratedFlaggedOnly?: () => void;
  onStartDraw: () => void;
  onOpenAccount: () => void;
  onImportPress?: () => void;
  onExportError: (message: string) => void;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const UNSEAL_HEADER_LOGO = require('../../assets/header-logo.png') as number;

function ParcelUnsealMark({
  compact,
}: {
  compact: boolean;
}): React.JSX.Element {
  const size = compact ? 24 : 28;
  if (Platform.OS === 'web') {
    return React.createElement(
      'svg',
      {
        width: size,
        height: size,
        viewBox: '0 0 64 64',
        fill: 'none',
        'aria-hidden': 'true',
        style: {
          flexShrink: 0,
          display: 'block',
          borderRadius: compact ? '6px' : '7px',
          boxShadow: 'inset 0 0 0 1px rgba(17, 29, 24, 0.14)',
        },
      },
      React.createElement('rect', {
        width: '64',
        height: '64',
        rx: '14',
        fill: '#EFF3F0',
      }),
      React.createElement('path', {
        d: 'M0 40H26L31 50L37 40H64V50C64 57.732 57.732 64 50 64H14C6.26801 64 0 57.732 0 50V40Z',
        fill: '#5A6360',
      }),
      React.createElement('path', {
        d: 'M31 49C31 38 32 30 37 22',
        stroke: '#176642',
        strokeWidth: '4',
        strokeLinecap: 'round',
      }),
      React.createElement('path', {
        d: 'M34 26C35 16 44 13 49 15C48 22 42 27 34 26Z',
        fill: '#1F7A4C',
      }),
      React.createElement('path', {
        d: 'M31 34C29 27 22 25 18 26C19 31 25 35 31 34Z',
        fill: '#176642',
      }),
    );
  }

  return (
    <View
      style={[styles.brandMark, compact ? styles.brandMarkCompact : null]}
      accessible={false}
    >
      <Image
        source={UNSEAL_HEADER_LOGO}
        style={styles.brandMarkImage}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}

function LocaleTogglePill({
  locale,
  compact,
  accessibilityLabel,
  onPress,
}: {
  locale: Locale;
  compact: boolean;
  accessibilityLabel: string;
  onPress?: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        styles.localePill,
        compact ? styles.localePillCompact : null,
        pressed ? styles.buttonPressed : null,
      ]}
    >
      <Text
        style={[
          styles.localeCodeLabel,
          locale === 'de' ? styles.localeCodeActive : styles.localeCodeInactive,
        ]}
      >
        DE
      </Text>
      <Text style={styles.localeDivider}>|</Text>
      <Text
        style={[
          styles.localeCodeLabel,
          locale === 'en' ? styles.localeCodeActive : styles.localeCodeInactive,
        ]}
      >
        EN
      </Text>
    </Pressable>
  );
}

export function MapControlsBar({
  controls,
  proposalCount,
  exportGeoJsonUrl,
  isImporting = false,
  tier = 'expanded',
  onToggleLocale,
  onOpenAbout,
  onSetBasemapMode,
  onSetAuthorFilter,
  onToggleUnratedFlaggedOnly,
  onStartDraw,
  onOpenAccount,
  onImportPress,
  onExportError,
}: MapControlsBarProps): React.JSX.Element {
  const isCompact = tier === 'compact';
  const isExpanded = tier === 'expanded';
  const locale = controls.locale;
  const t = getTranslations(locale).controls;

  const nextBasemapMode: BasemapMode =
    controls.basemapMode === 'osm' ? 'orthophoto' : 'osm';

  const handleExportPress = (): void => {
    void triggerGeoJsonExportDownload(exportGeoJsonUrl).catch(
      (err: unknown) => {
        const detail = localizeError(err, t.exportErrorFallback, locale);
        onExportError(detail);
      },
    );
  };

  const showApkDownloadButton =
    Platform.OS === 'web' &&
    controls.apkDownloadUrl !== null &&
    controls.apkDownloadUrl.length > 0;

  const handleApkDownloadPress = (): void => {
    if (!controls.apkDownloadUrl) {
      return;
    }
    void triggerApkDownload(controls.apkDownloadUrl).catch((err: unknown) => {
      const detail = localizeError(err, t.apkDownloadErrorFallback, locale);
      onExportError(detail);
    });
  };

  const accountButtonA11y = controls.isAuthenticated
    ? t.accountSettingsA11y(controls.accountLabel)
    : t.signInOrRegisterA11y;

  return (
    <View
      style={[
        styles.barShell,
        isCompact ? styles.barShellCompact : null,
        isExpanded ? styles.barShellExpanded : null,
      ]}
    >
      <View
        style={isExpanded ? styles.topBarExpandedRow : styles.topBarStacked}
      >
        <View style={styles.brandAndAccountRow}>
        <View
          style={[
            styles.brandGroup,
            isCompact ? styles.brandGroupCompact : null,
          ]}
        >
          <ParcelUnsealMark compact={isCompact} />
          <View style={styles.titleBlock}>
            <View style={styles.titleInlineRow}>
              {Platform.OS === 'web' ? (
                React.createElement(
                  'h1',
                  {
                    style: {
                      margin: 0,
                      padding: 0,
                      fontSize: isCompact ? '16px' : '18px',
                      fontWeight: 700,
                      letterSpacing: '-0.35px',
                      lineHeight: '20px',
                      color: PALETTE.inkPrimary,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      minWidth: 0,
                      flexShrink: 1,
                      fontFamily:
                        'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                    },
                  },
                  'Unseal',
                )
              ) : (
                <Text
                  accessibilityRole="header"
                  aria-level={1}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  style={[styles.title, isCompact ? styles.titleCompact : null]}
                >
                  Unseal
                </Text>
              )}
              <View
                style={[
                  styles.countBadge,
                  isCompact ? styles.countBadgeCompact : null,
                ]}
              >
                <View style={styles.countBadgeDot} />
                <Text style={styles.countBadgeLabel}>
                  {isCompact
                    ? `${proposalCount}`
                    : `${proposalCount} ${t.inViewSuffix}`}
                </Text>
              </View>
            </View>
            {!isCompact ? (
              <Text numberOfLines={1} style={styles.subtitle}>
                {controls.basemapMode === 'orthophoto'
                  ? t.subtitleOrthophoto
                  : t.subtitleOsm}
                {controls.basemapMode === 'orthophoto' &&
                controls.orthophotoAttribution &&
                controls.orthophotoAttribution.length > 0
                  ? ` · ${controls.orthophotoAttribution}`
                  : ` · ${t.osmAttributionShort}`}
              </Text>
            ) : controls.basemapMode === 'orthophoto' &&
              controls.orthophotoAttribution &&
              controls.orthophotoAttribution.length > 0 ? (
              <Text numberOfLines={1} style={styles.attributionText}>
                {t.imageryPrefix} {controls.orthophotoAttribution}
              </Text>
            ) : null}
          </View>
        </View>

        {!isExpanded ? (
          <View
            style={[
              styles.rightHeaderCluster,
              isCompact ? styles.rightHeaderClusterCompact : null,
            ]}
          >
            {onOpenAbout ? (
              <Pressable
                testID="about-modal-button"
                accessibilityRole="button"
                accessibilityLabel={t.aboutButtonA11y}
                onPress={onOpenAbout}
                style={({ pressed }) => [
                  styles.helpButton,
                  isCompact ? styles.helpButtonCompact : null,
                  pressed ? styles.buttonPressed : null,
                ]}
              >
                <Text style={styles.helpButtonLabel}>?</Text>
              </Pressable>
            ) : null}
            <LocaleTogglePill
              locale={locale}
              compact={isCompact}
              accessibilityLabel={t.switchLocaleA11y}
              {...(onToggleLocale ? { onPress: onToggleLocale } : {})}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={accountButtonA11y}
              onPress={onOpenAccount}
              style={({ pressed }) => [
                styles.accountChip,
                isCompact ? styles.accountChipCompact : null,
                controls.isAuthenticated ? styles.accountChipActive : null,
                pressed ? styles.buttonPressed : null,
              ]}
            >
              <View
                style={[
                  styles.accountStatusDot,
                  controls.isAuthenticated
                    ? styles.accountStatusDotOnline
                    : styles.accountStatusDotGuest,
                ]}
              />
              <Text
                numberOfLines={1}
                ellipsizeMode="tail"
                style={[
                  styles.accountChipLabel,
                  isCompact ? styles.accountChipLabelCompact : null,
                  controls.isAuthenticated
                    ? styles.accountChipLabelActive
                    : null,
                ]}
              >
                {controls.accountLabel}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <View
        style={[
          styles.controlsRow,
          isCompact ? styles.controlsRowCompact : null,
          isExpanded ? styles.controlsRowExpanded : null,
        ]}
      >
        {controls.showOrthophotoToggle ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              controls.basemapMode === 'osm'
                ? t.switchToOrthoA11y
                : t.switchToOsmA11y
            }
            accessibilityState={{
              selected: controls.basemapMode === 'orthophoto',
            }}
            onPress={() => onSetBasemapMode(nextBasemapMode)}
            style={({ pressed }) => [
              styles.controlButton,
              isCompact ? styles.controlButtonCompact : null,
              styles.secondaryButton,
              controls.basemapMode === 'orthophoto'
                ? styles.secondaryButtonSelected
                : null,
              pressed ? styles.buttonPressed : null,
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.secondaryButtonLabel,
                isCompact ? styles.compactButtonLabel : null,
                controls.basemapMode === 'orthophoto'
                  ? styles.secondaryButtonLabelSelected
                  : null,
              ]}
            >
              {isCompact
                ? controls.basemapMode === 'osm'
                  ? t.aerialCompact
                  : t.streetCompact
                : controls.basemapMode === 'osm'
                  ? t.aerialFull
                  : t.streetFull}
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.exportA11y}
          onPress={handleExportPress}
          style={({ pressed }) => [
            styles.controlButton,
            isCompact ? styles.controlButtonCompact : null,
            styles.secondaryButton,
            pressed ? styles.buttonPressed : null,
          ]}
        >
          <Text
            numberOfLines={1}
            style={[
              styles.secondaryButtonLabel,
              isCompact ? styles.compactButtonLabel : null,
            ]}
          >
            {isCompact ? t.exportCompact : t.exportFull}
          </Text>
        </Pressable>

        {showApkDownloadButton ? (
          <Pressable
            testID="download-apk-button"
            accessibilityRole="button"
            accessibilityLabel={t.apkDownloadA11y}
            onPress={handleApkDownloadPress}
            style={({ pressed }) => [
              styles.controlButton,
              isCompact ? styles.controlButtonCompact : null,
              styles.secondaryButton,
              pressed ? styles.buttonPressed : null,
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.secondaryButtonLabel,
                isCompact ? styles.compactButtonLabel : null,
              ]}
            >
              {isCompact ? t.apkDownloadCompact : t.apkDownloadFull}
            </Text>
          </Pressable>
        ) : null}

        {controls.isAdmin && onImportPress ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.importA11y}
            accessibilityState={{ disabled: isImporting, busy: isImporting }}
            disabled={isImporting}
            onPress={onImportPress}
            style={({ pressed }) => [
              styles.controlButton,
              isCompact ? styles.controlButtonCompact : null,
              styles.adminImportButton,
              isImporting ? styles.buttonDisabled : null,
              pressed && !isImporting ? styles.buttonPressed : null,
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.adminImportLabel,
                isCompact ? styles.compactButtonLabel : null,
              ]}
            >
              {isImporting
                ? t.importingBusy
                : isCompact
                  ? t.importCompact
                  : t.importFull}
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.proposeA11y}
          accessibilityState={{ disabled: !controls.canStartDraw }}
          disabled={!controls.canStartDraw}
          onPress={onStartDraw}
          style={({ pressed }) => [
            styles.controlButton,
            isCompact ? styles.controlButtonCompactPrimary : null,
            styles.primaryButton,
            !controls.canStartDraw ? styles.primaryButtonDisabled : null,
            pressed && controls.canStartDraw
              ? styles.primaryButtonPressed
              : null,
          ]}
        >
          <Text
            numberOfLines={1}
            style={[
              styles.primaryButtonLabel,
              isCompact ? styles.compactButtonLabel : null,
            ]}
          >
            {isCompact ? t.proposeCompact : t.proposeFull}
          </Text>
        </Pressable>

        {isExpanded ? (
          <>
            {onOpenAbout ? (
              <Pressable
                testID="about-modal-button"
                accessibilityRole="button"
                accessibilityLabel={t.aboutButtonA11y}
                onPress={onOpenAbout}
                style={({ pressed }) => [
                  styles.helpButton,
                  pressed ? styles.buttonPressed : null,
                ]}
              >
                <Text style={styles.helpButtonLabel}>?</Text>
              </Pressable>
            ) : null}
            <LocaleTogglePill
              locale={locale}
              compact={false}
              accessibilityLabel={t.switchLocaleA11y}
              {...(onToggleLocale ? { onPress: onToggleLocale } : {})}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={accountButtonA11y}
              onPress={onOpenAccount}
              style={({ pressed }) => [
                styles.accountChip,
                controls.isAuthenticated ? styles.accountChipActive : null,
                pressed ? styles.buttonPressed : null,
              ]}
            >
              <View
                style={[
                  styles.accountStatusDot,
                  controls.isAuthenticated
                    ? styles.accountStatusDotOnline
                    : styles.accountStatusDotGuest,
                ]}
              />
              <Text
                numberOfLines={1}
                ellipsizeMode="tail"
                style={[
                  styles.accountChipLabel,
                  controls.isAuthenticated
                    ? styles.accountChipLabelActive
                    : null,
                ]}
              >
                {controls.accountLabel}
              </Text>
            </Pressable>
          </>
        ) : null}
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[
          styles.filterStripContent,
          isCompact ? styles.filterStripContentCompact : null,
        ]}
      >
        <Pressable
          testID="filter-author-all"
          accessibilityRole="button"
          accessibilityLabel={t.filterAllA11y}
          accessibilityState={{ selected: controls.authorFilter === 'all' }}
          onPress={() => onSetAuthorFilter?.('all')}
          style={({ pressed }) => [
            styles.filterChip,
            isCompact ? styles.filterChipCompact : null,
            controls.authorFilter === 'all' ? styles.filterChipActive : null,
            pressed ? styles.buttonPressed : null,
          ]}
        >
          <Text
            numberOfLines={1}
            style={[
              styles.filterChipLabel,
              isCompact ? styles.filterChipLabelCompact : null,
              controls.authorFilter === 'all'
                ? styles.filterChipLabelActive
                : null,
            ]}
          >
            {t.filterAll}
          </Text>
        </Pressable>

        <Pressable
          testID="filter-author-new"
          accessibilityRole="button"
          accessibilityLabel={t.filterNewContributorsA11y}
          accessibilityState={{
            selected: controls.authorFilter === 'new_user',
          }}
          onPress={() => onSetAuthorFilter?.('new_user')}
          style={({ pressed }) => [
            styles.filterChip,
            isCompact ? styles.filterChipCompact : null,
            controls.authorFilter === 'new_user'
              ? styles.filterChipActive
              : null,
            pressed ? styles.buttonPressed : null,
          ]}
        >
          <Text
            numberOfLines={1}
            style={[
              styles.filterChipLabel,
              isCompact ? styles.filterChipLabelCompact : null,
              controls.authorFilter === 'new_user'
                ? styles.filterChipLabelActive
                : null,
            ]}
          >
            {isCompact
              ? t.filterNewContributorsCompact
              : t.filterNewContributorsFull}
          </Text>
        </Pressable>

        <Pressable
          testID="filter-author-established"
          accessibilityRole="button"
          accessibilityLabel={t.filterEstablishedA11y}
          accessibilityState={{
            selected: controls.authorFilter === 'established',
          }}
          onPress={() => onSetAuthorFilter?.('established')}
          style={({ pressed }) => [
            styles.filterChip,
            isCompact ? styles.filterChipCompact : null,
            controls.authorFilter === 'established'
              ? styles.filterChipActive
              : null,
            pressed ? styles.buttonPressed : null,
          ]}
        >
          <Text
            numberOfLines={1}
            style={[
              styles.filterChipLabel,
              isCompact ? styles.filterChipLabelCompact : null,
              controls.authorFilter === 'established'
                ? styles.filterChipLabelActive
                : null,
            ]}
          >
            {isCompact ? t.filterEstablishedCompact : t.filterEstablishedFull}
          </Text>
        </Pressable>

        <View style={styles.filterDivider} />

        <Pressable
          testID="filter-unrated-flagged"
          accessibilityRole="button"
          accessibilityLabel={t.filterUnratedFlaggedA11y}
          accessibilityState={{ selected: controls.unratedFlaggedOnly }}
          onPress={() => onToggleUnratedFlaggedOnly?.()}
          style={({ pressed }) => [
            styles.filterChip,
            isCompact ? styles.filterChipCompact : null,
            controls.unratedFlaggedOnly ? styles.filterChipWarningActive : null,
            pressed ? styles.buttonPressed : null,
          ]}
        >
          <Text
            numberOfLines={1}
            style={[
              styles.filterChipLabel,
              isCompact ? styles.filterChipLabelCompact : null,
              controls.unratedFlaggedOnly
                ? styles.filterChipWarningLabelActive
                : null,
            ]}
          >
            {isCompact
              ? t.filterUnratedFlaggedCompact
              : t.filterUnratedFlaggedFull}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  barShell: {
    backgroundColor: PALETTE.bgSurface,
    borderBottomWidth: 1,
    borderBottomColor: PALETTE.borderSubtle,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  barShellCompact: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  barShellExpanded: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    gap: 8,
  },
  topBarStacked: {
    gap: 8,
  },
  topBarExpandedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  filterStripContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  filterStripContentCompact: {
    gap: 5,
  },
  filterChip: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: RADII.pill,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    backgroundColor: PALETTE.bgSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterChipCompact: {
    paddingHorizontal: 9,
  },
  filterChipActive: {
    backgroundColor: PALETTE.bgTinted,
    borderColor: PALETTE.accentPrimary,
  },
  filterChipWarningActive: {
    backgroundColor: PALETTE.neutralBg,
    borderColor: PALETTE.neutralDot,
  },
  filterChipLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: PALETTE.inkSecondary,
  },
  filterChipLabelCompact: {
    fontSize: 11.5,
  },
  filterChipLabelActive: {
    color: PALETTE.positiveText,
    fontWeight: '700',
  },
  filterChipWarningLabelActive: {
    color: PALETTE.neutralText,
    fontWeight: '700',
  },
  filterDivider: {
    width: 1,
    height: 20,
    backgroundColor: PALETTE.borderSubtle,
    marginHorizontal: 2,
  },
  brandAndAccountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    flexShrink: 1,
    minWidth: 0,
  },
  rightHeaderCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
    minWidth: 0,
  },
  rightHeaderClusterCompact: {
    maxWidth: '58%',
  },
  brandGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  brandGroupCompact: {
    gap: 6,
  },
  brandMark: {
    width: 28,
    height: 28,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
    backgroundColor: '#EFF3F0',
    overflow: 'hidden',
    position: 'relative',
    flexShrink: 0,
  },
  brandMarkCompact: {
    width: 24,
    height: 24,
    borderRadius: 6,
  },
  brandMarkImage: {
    width: '100%',
    height: '100%',
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  titleInlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.35,
    color: PALETTE.inkPrimary,
    flexShrink: 1,
    minWidth: 0,
  },
  titleCompact: {
    fontSize: 16,
    letterSpacing: -0.35,
  },
  countBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADII.pill,
    backgroundColor: PALETTE.bgTinted,
    borderWidth: 1,
    borderColor: PALETTE.positiveBorder,
    flexShrink: 0,
  },
  countBadgeCompact: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    gap: 3,
  },
  countBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: PALETTE.accentPrimary,
  },
  countBadgeLabel: {
    ...TABULAR_NUMS_STYLE,
    fontSize: 11,
    fontWeight: '700',
    color: PALETTE.positiveText,
  },
  subtitle: {
    fontSize: 12,
    color: PALETTE.inkMuted,
  },
  attributionText: {
    fontSize: 11,
    color: PALETTE.inkMuted,
  },
  helpButton: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: RADII.pill,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    backgroundColor: PALETTE.bgSurface,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  helpButtonCompact: {
    paddingHorizontal: 8,
  },
  helpButtonLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: PALETTE.inkPrimary,
  },
  localePill: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: RADII.pill,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    backgroundColor: PALETTE.bgSurface,
    flexShrink: 0,
  },
  localePillCompact: {
    paddingHorizontal: 6,
    gap: 2,
  },
  localeCodeLabel: {
    fontSize: 11,
    letterSpacing: 0.2,
  },
  localeCodeActive: {
    fontWeight: '800',
    color: PALETTE.positiveText,
  },
  localeCodeInactive: {
    fontWeight: '600',
    color: PALETTE.inkMuted,
  },
  localeDivider: {
    fontSize: 11,
    color: PALETTE.borderStrong,
  },
  accountChip: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    maxWidth: 176,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: RADII.pill,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    backgroundColor: PALETTE.bgSubtle,
    overflow: 'hidden',
    flexShrink: 1,
  },
  accountChipCompact: {
    paddingHorizontal: 8,
    gap: 4,
    maxWidth: 112,
  },
  accountChipActive: {
    backgroundColor: PALETTE.bgTinted,
    borderColor: PALETTE.accentPrimary,
  },
  accountStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    flexShrink: 0,
  },
  accountStatusDotGuest: {
    backgroundColor: PALETTE.inkMuted,
  },
  accountStatusDotOnline: {
    backgroundColor: PALETTE.accentPrimary,
  },
  accountChipLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: PALETTE.inkPrimary,
    flexShrink: 1,
    minWidth: 0,
    overflow: 'hidden',
  },
  accountChipLabelCompact: {
    fontSize: 11.5,
  },
  accountChipLabelActive: {
    color: PALETTE.positiveText,
    fontWeight: '700',
  },
  controlsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  controlsRowCompact: {
    flexWrap: 'nowrap',
    gap: 6,
  },
  controlsRowExpanded: {
    flexWrap: 'nowrap',
    justifyContent: 'flex-end',
  },
  controlButton: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: RADII.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlButtonCompact: {
    flex: 0.9,
    paddingHorizontal: 7,
  },
  controlButtonCompactPrimary: {
    flex: 1.35,
    paddingHorizontal: 9,
  },
  primaryButton: {
    backgroundColor: PALETTE.accentPrimary,
    borderWidth: 1,
    borderColor: PALETTE.accentPrimaryStrong,
  },
  primaryButtonPressed: {
    backgroundColor: PALETTE.accentPrimaryStrong,
  },
  primaryButtonDisabled: {
    backgroundColor: PALETTE.accentDisabled,
    borderColor: PALETTE.accentDisabled,
  },
  primaryButtonLabel: {
    color: PALETTE.inkOnAccent,
    fontSize: 13,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: PALETTE.bgSurface,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
  },
  secondaryButtonSelected: {
    backgroundColor: PALETTE.accentPrimaryStrong,
    borderColor: PALETTE.accentPrimaryStrong,
  },
  secondaryButtonLabel: {
    color: PALETTE.inkPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  secondaryButtonLabelSelected: {
    color: PALETTE.inkOnAccent,
  },
  adminImportButton: {
    backgroundColor: PALETTE.finishedBg,
    borderWidth: 1,
    borderColor: PALETTE.finishedBorder,
  },
  adminImportLabel: {
    color: PALETTE.finishedText,
    fontSize: 13,
    fontWeight: '700',
  },
  compactButtonLabel: {
    fontSize: 12,
  },
  buttonPressed: {
    backgroundColor: PALETTE.bgRecessed,
  },
  buttonDisabled: {
    opacity: 0.65,
  },
});
