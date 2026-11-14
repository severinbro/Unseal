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
  DEFAULT_LOCALE,
  getTranslations,
  localizeError,
  type Locale,
} from '../i18n/translations';
import { MIN_TOUCH_TARGET_DP } from '../state/viewModels';
import { PALETTE, RADII } from '../theme/tokens';
import { AndroidGlyph, triggerApkDownload } from './MapControlsBar';

export interface AboutModalProps {
  visible: boolean;
  locale?: Locale;
  compact?: boolean;
  privacyPolicyUrl: string;
  apkDownloadUrl: string | null;
  abuseContact: string | null;
  onClose: () => void;
  onDownloadError?: (message: string) => void;
}

function openExternalUrl(url: string): void {
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

export function AboutModal({
  visible,
  locale = DEFAULT_LOCALE,
  compact = false,
  privacyPolicyUrl,
  apkDownloadUrl,
  abuseContact,
  onClose,
  onDownloadError,
}: AboutModalProps): React.JSX.Element | null {
  if (!visible) {
    return null;
  }

  const dict = getTranslations(locale);
  const t = dict.about;
  const showApkButton =
    Platform.OS === 'web' &&
    apkDownloadUrl !== null &&
    apkDownloadUrl.length > 0;

  const handleApkPress = (): void => {
    if (!apkDownloadUrl) {
      return;
    }
    void triggerApkDownload(apkDownloadUrl).catch((err: unknown) => {
      const detail = localizeError(
        err,
        dict.controls.apkDownloadErrorFallback,
        locale,
      );
      onDownloadError?.(detail);
    });
  };

  return (
    <View
      testID="about-modal-card"
      accessibilityLabel={t.modalA11y}
      style={[styles.card, compact ? styles.cardCompact : null]}
    >
      <View style={styles.headerRow}>
        <View style={styles.headerTextGroup}>
          <Text style={styles.title}>{t.title}</Text>
          <Text style={styles.subtitle}>{t.subtitle}</Text>
          <Text style={styles.introText}>{t.introBody}</Text>
        </View>
        <Pressable
          testID="about-modal-close"
          accessibilityRole="button"
          accessibilityLabel={t.closeA11y}
          onPress={onClose}
          style={({ pressed }) => [
            styles.closeButton,
            pressed ? styles.buttonPressed : null,
          ]}
        >
          <Text style={styles.closeButtonLabel}>{t.close}</Text>
        </Pressable>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>{t.featuresTitle}</Text>
        <View style={styles.bulletList}>
          <View style={styles.bulletRow}>
            <Text style={styles.bulletMarker}>•</Text>
            <Text style={styles.bulletText}>{t.featureMapBullet}</Text>
          </View>
          <View style={styles.bulletRow}>
            <Text style={styles.bulletMarker}>•</Text>
            <Text style={styles.bulletText}>{t.featureReviewBullet}</Text>
          </View>
          <View style={styles.bulletRow}>
            <Text style={styles.bulletMarker}>•</Text>
            <Text style={styles.bulletText}>{t.featureControlsBullet}</Text>
          </View>
          <View style={styles.bulletRow}>
            <Text style={styles.bulletMarker}>•</Text>
            <Text style={styles.bulletText}>{t.featureDataBullet}</Text>
          </View>
        </View>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>{t.legendTitle}</Text>
        <View style={styles.bulletList}>
          <View style={styles.statusItem}>
            <View style={styles.dotGroup}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: PALETTE.positiveDot },
                ]}
              />
            </View>
            <Text style={styles.bulletText}>{t.legendSupported}</Text>
          </View>
          <View style={styles.statusItem}>
            <View style={styles.dotGroup}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: PALETTE.neutralDot },
                ]}
              />
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: PALETTE.dangerDot },
                ]}
              />
            </View>
            <Text style={styles.bulletText}>{t.legendNewContested}</Text>
          </View>
          <View style={styles.statusItem}>
            <View style={styles.dotGroup}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: PALETTE.inProgressDot },
                ]}
              />
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: PALETTE.finishedDot },
                ]}
              />
            </View>
            <Text style={styles.bulletText}>{t.legendLifecycle}</Text>
          </View>
        </View>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>{t.footerTitle}</Text>
        <Text style={styles.subtleNote}>{t.privacyAndLicenseBody}</Text>
        {abuseContact && abuseContact.trim().length > 0 ? (
          <Text style={styles.subtleNote}>
            {dict.inspector.abuseContactPrefix} {abuseContact}
          </Text>
        ) : null}

        <View style={styles.attributionChipsRow}>
          <Pressable
            accessibilityRole="link"
            onPress={() =>
              openExternalUrl('https://www.openstreetmap.org/copyright')
            }
            style={({ pressed }) => [
              styles.attributionChip,
              pressed ? styles.buttonPressed : null,
            ]}
          >
            <Text style={styles.attributionChipText}>
              {t.attributionOsmShort}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="link"
            onPress={() =>
              openExternalUrl('https://www.govdata.de/dl-de/by-2-0')
            }
            style={({ pressed }) => [
              styles.attributionChip,
              pressed ? styles.buttonPressed : null,
            ]}
          >
            <Text style={styles.attributionChipText}>
              {t.attributionDop20Short}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="link"
            onPress={() =>
              openExternalUrl('https://www.govdata.de/dl-de/by-2-0')
            }
            style={({ pressed }) => [
              styles.attributionChip,
              pressed ? styles.buttonPressed : null,
            ]}
          >
            <Text style={styles.attributionChipText}>
              {t.attributionVg250Short}
            </Text>
          </Pressable>
        </View>

        <View style={styles.actionRow}>
          <Pressable
            accessibilityRole="link"
            onPress={() => openExternalUrl(privacyPolicyUrl)}
            style={({ pressed }) => [
              styles.touchButton,
              styles.secondaryButton,
              pressed ? styles.buttonPressed : null,
            ]}
          >
            <Text style={styles.secondaryButtonLabel}>
              {t.privacyLinkLabel}
            </Text>
          </Pressable>

          {showApkButton ? (
            <Pressable
              testID="about-download-apk-button"
              accessibilityRole="button"
              accessibilityLabel={dict.controls.apkDownloadA11y}
              onPress={handleApkPress}
              style={({ pressed }) => [
                styles.touchButton,
                styles.primaryButton,
                styles.apkButtonRow,
                pressed ? styles.primaryButtonPressed : null,
              ]}
            >
              <AndroidGlyph
                color={PALETTE.inkOnAccent}
                eyeColor={PALETTE.accentPrimary}
                size={18}
              />
              <Text style={styles.primaryButtonLabel}>
                {t.apkDownloadButton}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    padding: 15,
    borderRadius: RADII.sheet,
    backgroundColor: PALETTE.bgSurface,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    gap: 10,
  },
  cardCompact: {
    padding: 12,
    gap: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  headerTextGroup: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: PALETTE.inkPrimary,
  },
  subtitle: {
    fontSize: 12,
    fontWeight: '600',
    color: PALETTE.positiveText,
  },
  introText: {
    fontSize: 12,
    lineHeight: 16.5,
    color: PALETTE.inkSecondary,
    marginTop: 1,
  },
  closeButton: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    backgroundColor: PALETTE.bgSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonLabel: {
    fontSize: 12.5,
    fontWeight: '600',
    color: PALETTE.inkPrimary,
  },
  sectionCard: {
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.bgSubtle,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
    gap: 6,
  },
  sectionTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    color: PALETTE.inkPrimary,
  },
  bulletList: {
    gap: 4,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  bulletMarker: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    color: PALETTE.accentPrimary,
  },
  bulletText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16.5,
    color: PALETTE.inkSecondary,
  },
  statusItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  dotGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    minWidth: 20,
    flexShrink: 0,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  subtleNote: {
    fontSize: 11.5,
    lineHeight: 16,
    color: PALETTE.inkMuted,
  },
  attributionChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  attributionChip: {
    paddingVertical: 3,
    paddingHorizontal: 7,
    borderRadius: RADII.sm,
    backgroundColor: PALETTE.bgSurface,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
  },
  attributionChipText: {
    fontSize: 11,
    lineHeight: 15,
    color: PALETTE.inkSecondary,
    textDecorationLine: 'underline',
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 2,
  },
  touchButton: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: RADII.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: PALETTE.accentPrimary,
    borderWidth: 1,
    borderColor: PALETTE.accentPrimaryStrong,
  },
  apkButtonRow: {
    flexDirection: 'row',
    gap: 7,
  },
  primaryButtonPressed: {
    backgroundColor: PALETTE.accentPrimaryStrong,
  },
  primaryButtonLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    color: PALETTE.inkOnAccent,
  },
  secondaryButton: {
    backgroundColor: PALETTE.bgSurface,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
  },
  secondaryButtonLabel: {
    fontSize: 12.5,
    fontWeight: '600',
    color: PALETTE.inkPrimary,
  },
  buttonPressed: {
    backgroundColor: PALETTE.bgRecessed,
  },
});
