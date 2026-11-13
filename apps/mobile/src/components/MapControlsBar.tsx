import React from 'react';
import {
  Linking,
  Platform,
  Pressable,
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

export async function triggerGeoJsonExportDownload(
  exportUrl: string,
): Promise<void> {
  if (Platform.OS === 'web') {
    const scope = globalThis as { document?: WebDocumentLike };
    const doc = scope.document;
    if (doc && typeof doc.createElement === 'function') {
      const anchor = doc.createElement('a');
      anchor.href = exportUrl;
      anchor.download = 'entsiegelung-proposals.geojson';
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

  await Linking.openURL(exportUrl);
}

export interface MapControlsBarProps {
  controls: MapControlsModel;
  proposalCount: number;
  exportGeoJsonUrl: string;
  isLocating: boolean;
  tier?: ViewportTier;
  onToggleLocale?: () => void;
  onSetBasemapMode: (mode: BasemapMode) => void;
  onLocateMe: () => void;
  onStartDraw: () => void;
  onOpenAccount: () => void;
  onExportError: (message: string) => void;
}

function ParcelUnsealMark({
  compact,
}: {
  compact: boolean;
}): React.JSX.Element {
  return (
    <View
      style={[styles.brandMark, compact ? styles.brandMarkCompact : null]}
      accessible={false}
    >
      <View style={styles.brandMarkSealedQuad} />
      <View style={styles.brandMarkPermeableQuad} />
      <View style={styles.brandMarkCornerNode} />
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
  isLocating,
  tier = 'expanded',
  onToggleLocale,
  onSetBasemapMode,
  onLocateMe,
  onStartDraw,
  onOpenAccount,
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
                      fontSize: isCompact ? '12.5px' : '17px',
                      fontWeight: 700,
                      letterSpacing: isCompact ? '-0.4px' : '-0.35px',
                      lineHeight: '20px',
                      color: PALETTE.inkPrimary,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      fontFamily:
                        'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                    },
                  },
                  'Entsiegelungskartierung',
                )
              ) : (
                <Text
                  accessibilityRole="header"
                  aria-level={1}
                  numberOfLines={1}
                  style={[styles.title, isCompact ? styles.titleCompact : null]}
                >
                  Entsiegelungskartierung
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
                  : ` · ${t.subtitleRegistry}`}
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
          <View style={styles.rightHeaderCluster}>
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
          accessibilityLabel={t.locateA11y}
          accessibilityState={{ disabled: isLocating, busy: isLocating }}
          disabled={isLocating}
          onPress={onLocateMe}
          style={({ pressed }) => [
            styles.controlButton,
            isCompact ? styles.controlButtonCompactGps : null,
            styles.secondaryButton,
            isLocating ? styles.buttonDisabled : null,
            pressed && !isLocating ? styles.buttonPressed : null,
          ]}
        >
          <Text
            numberOfLines={1}
            style={[
              styles.secondaryButtonLabel,
              isCompact ? styles.compactButtonLabel : null,
            ]}
          >
            {isLocating
              ? t.locateBusy
              : isCompact
                ? t.locateCompact
                : t.locateFull}
          </Text>
        </Pressable>

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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 10,
    gap: 16,
  },
  brandAndAccountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 5,
    flexShrink: 1,
  },
  rightHeaderCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  brandGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  brandGroupCompact: {
    gap: 5,
  },
  brandMark: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: PALETTE.inkPrimary,
    backgroundColor: PALETTE.bgSubtle,
    overflow: 'hidden',
    position: 'relative',
  },
  brandMarkCompact: {
    width: 20,
    height: 20,
  },
  brandMarkSealedQuad: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 10,
    backgroundColor: '#3B4943',
  },
  brandMarkPermeableQuad: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 12,
    backgroundColor: PALETTE.accentPrimary,
  },
  brandMarkCornerNode: {
    position: 'absolute',
    top: 7,
    left: 7,
    width: 7,
    height: 7,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: PALETTE.bgSurface,
    backgroundColor: PALETTE.positiveDot,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  titleInlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minWidth: 0,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: PALETTE.inkPrimary,
    flexShrink: 1,
  },
  titleCompact: {
    fontSize: 12.5,
    letterSpacing: -0.4,
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
    maxWidth: 168,
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
  },
  accountChipCompact: {
    paddingHorizontal: 8,
    gap: 4,
    maxWidth: 96,
  },
  accountChipActive: {
    backgroundColor: PALETTE.bgTinted,
    borderColor: PALETTE.accentPrimary,
  },
  accountStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
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
    flex: 0.95,
    paddingHorizontal: 7,
  },
  controlButtonCompactGps: {
    flex: 0.72,
    paddingHorizontal: 6,
  },
  controlButtonCompactPrimary: {
    flex: 1.38,
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
