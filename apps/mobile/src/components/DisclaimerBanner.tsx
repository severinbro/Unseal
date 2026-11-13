import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  getTranslations,
  localizeDisclaimerText,
  localizeSystemNotice,
} from '../i18n/translations';
import {
  MIN_TOUCH_TARGET_DP,
  type MapControlsModel,
} from '../state/viewModels';
import { PALETTE, RADII, TABULAR_NUMS_STYLE } from '../theme/tokens';

export interface DisclaimerBannerProps {
  controls: MapControlsModel;
  bboxFeatureLimit: number;
  locationNotice: string | null;
  compact?: boolean;
  onDismissDisclaimer: () => void;
  onDismissTileWarning: () => void;
  onDismissLocationNotice: () => void;
}

export function DisclaimerBanner({
  controls,
  bboxFeatureLimit,
  locationNotice,
  compact = false,
  onDismissDisclaimer,
  onDismissTileWarning,
  onDismissLocationNotice,
}: DisclaimerBannerProps): React.JSX.Element | null {
  const locale = controls.locale;
  const t = getTranslations(locale).banners;

  const localizedDisclaimer = localizeDisclaimerText(
    controls.disclaimerText,
    locale,
  );
  const localizedTileWarning = localizeSystemNotice(
    controls.tileWarning,
    locale,
  );

  const showDisclaimer =
    controls.showFirstVisitDisclaimer &&
    localizedDisclaimer !== null &&
    localizedDisclaimer.length > 0;
  const showTileWarning =
    localizedTileWarning !== null && localizedTileWarning.length > 0;
  const showLocationNotice =
    locationNotice !== null && locationNotice.length > 0;
  const showZoomPrompt = controls.showZoomInPrompt;
  const showTruncated = controls.showTruncatedNotice;

  if (
    !showDisclaimer &&
    !showTileWarning &&
    !showLocationNotice &&
    !showZoomPrompt &&
    !showTruncated
  ) {
    return null;
  }

  return (
    <View style={[styles.stackContainer, compact ? styles.stackCompact : null]}>
      {showDisclaimer ? (
        <View
          style={styles.disclaimerBanner}
          accessibilityRole="alert"
          accessibilityLabel={t.disclaimerA11y}
        >
          <View style={styles.bannerCopyRow}>
            <View style={styles.positiveDot} />
            <Text style={styles.disclaimerText}>{localizedDisclaimer}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.dismissDisclaimerA11y}
            onPress={onDismissDisclaimer}
            style={({ pressed }) => [
              styles.dismissButton,
              pressed ? styles.dismissButtonPressed : null,
            ]}
          >
            <Text style={styles.dismissButtonLabel}>{t.gotIt}</Text>
          </Pressable>
        </View>
      ) : null}

      {showTileWarning ? (
        <View
          style={styles.warningBanner}
          accessibilityRole="alert"
          accessibilityLabel={t.tileWarningA11y}
        >
          <View style={styles.bannerCopyRow}>
            <View style={styles.warningDot} />
            <Text style={styles.warningText}>{localizedTileWarning}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.dismissTileWarningA11y}
            onPress={onDismissTileWarning}
            style={styles.warningDismissButton}
          >
            <Text style={styles.warningDismissLabel}>{t.ok}</Text>
          </Pressable>
        </View>
      ) : null}

      {showLocationNotice ? (
        <View
          style={styles.warningBanner}
          accessibilityRole="alert"
          accessibilityLabel={t.locationNoticeA11y}
        >
          <View style={styles.bannerCopyRow}>
            <View style={styles.warningDot} />
            <Text style={styles.warningText}>{locationNotice}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.dismissLocationA11y}
            onPress={onDismissLocationNotice}
            style={styles.warningDismissButton}
          >
            <Text style={styles.warningDismissLabel}>{t.ok}</Text>
          </Pressable>
        </View>
      ) : null}

      {showZoomPrompt ? (
        <View
          style={styles.infoBanner}
          accessibilityRole="summary"
          accessibilityLabel={controls.zoomInPromptText}
        >
          <View style={styles.infoDot} />
          <Text style={styles.infoText}>{controls.zoomInPromptText}</Text>
        </View>
      ) : null}

      {showTruncated ? (
        <View
          style={styles.truncatedBanner}
          accessibilityRole="summary"
          accessibilityLabel={t.truncatedA11y}
        >
          <Text style={styles.truncatedText}>
            {t.truncatedMessage(bboxFeatureLimit)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stackContainer: {
    gap: 6,
  },
  stackCompact: {
    gap: 5,
  },
  bannerCopyRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  positiveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: PALETTE.accentPrimary,
  },
  warningDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: PALETTE.neutralDot,
  },
  infoDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: PALETTE.infoText,
  },
  disclaimerBanner: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.positiveBg,
    borderWidth: 1,
    borderColor: PALETTE.positiveBorder,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  disclaimerText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 17,
    color: PALETTE.inkPrimary,
  },
  dismissButton: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: RADII.sm,
    backgroundColor: PALETTE.accentPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissButtonPressed: {
    backgroundColor: PALETTE.accentPrimaryStrong,
  },
  dismissButtonLabel: {
    color: PALETTE.inkOnAccent,
    fontSize: 12.5,
    fontWeight: '700',
  },
  warningBanner: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.neutralBg,
    borderWidth: 1,
    borderColor: PALETTE.neutralBorder,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  warningText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 17,
    color: PALETTE.neutralText,
  },
  warningDismissButton: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: RADII.sm,
    backgroundColor: PALETTE.neutralText,
    alignItems: 'center',
    justifyContent: 'center',
  },
  warningDismissLabel: {
    color: PALETTE.inkOnAccent,
    fontSize: 12.5,
    fontWeight: '700',
  },
  infoBanner: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.infoBg,
    borderWidth: 1,
    borderColor: PALETTE.infoBorder,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoText: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: '600',
    color: PALETTE.infoText,
  },
  truncatedBanner: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.bgSurface,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
  },
  truncatedText: {
    ...TABULAR_NUMS_STYLE,
    fontSize: 12,
    lineHeight: 16,
    color: PALETTE.inkSecondary,
  },
});
