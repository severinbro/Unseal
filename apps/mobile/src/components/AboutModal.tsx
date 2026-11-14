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
import { triggerApkDownload } from './MapControlsBar';

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
  const showApkSection =
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
        <Text style={styles.sectionTitle}>{t.missionTitle}</Text>
        <Text style={styles.bodyText}>{t.missionBody}</Text>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>{t.workflowTitle}</Text>
        <View style={styles.statusList}>
          <View style={styles.statusItem}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: PALETTE.positiveDot },
              ]}
            />
            <Text style={styles.statusText}>{t.statusProposedDesc}</Text>
          </View>
          <View style={styles.statusItem}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: PALETTE.inProgressDot },
              ]}
            />
            <Text style={styles.statusText}>{t.statusInProgressDesc}</Text>
          </View>
          <View style={styles.statusItem}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: PALETTE.finishedDot },
              ]}
            />
            <Text style={styles.statusText}>{t.statusFinishedDesc}</Text>
          </View>
        </View>
        <Text style={styles.subtleNote}>{t.photoRuleBody}</Text>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>{t.attributionTitle}</Text>
        <Pressable
          accessibilityRole="link"
          onPress={() => openExternalUrl('https://www.openstreetmap.org/copyright')}
          style={({ pressed }) => [
            styles.attributionLinkRow,
            pressed ? styles.buttonPressed : null,
          ]}
        >
          <Text style={styles.attributionItemText}>{t.attributionOsmLabel}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          onPress={() => openExternalUrl('https://www.govdata.de/dl-de/by-2-0')}
          style={({ pressed }) => [
            styles.attributionLinkRow,
            pressed ? styles.buttonPressed : null,
          ]}
        >
          <Text style={styles.attributionItemText}>
            {t.attributionDop20Label}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          onPress={() => openExternalUrl('https://www.govdata.de/dl-de/by-2-0')}
          style={({ pressed }) => [
            styles.attributionLinkRow,
            pressed ? styles.buttonPressed : null,
          ]}
        >
          <Text style={styles.attributionItemText}>
            {t.attributionVg250Label}
          </Text>
        </Pressable>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>{t.privacyAndLicenseTitle}</Text>
        <Text style={styles.bodyText}>{t.privacySummary}</Text>
        <Text style={styles.subtleNote}>{t.licenseSummary}</Text>
        {abuseContact && abuseContact.trim().length > 0 ? (
          <Text style={styles.subtleNote}>
            {dict.inspector.abuseContactPrefix} {abuseContact}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="link"
          onPress={() => openExternalUrl(privacyPolicyUrl)}
          style={({ pressed }) => [
            styles.touchButton,
            styles.secondaryButton,
            pressed ? styles.buttonPressed : null,
          ]}
        >
          <Text style={styles.secondaryButtonLabel}>{t.privacyLinkLabel}</Text>
        </Pressable>
      </View>

      {showApkSection ? (
        <View style={[styles.sectionCard, styles.apkCard]}>
          <Text style={styles.sectionTitle}>{t.apkSectionTitle}</Text>
          <Text style={styles.bodyText}>{t.apkSectionHint}</Text>
          <Pressable
            testID="about-download-apk-button"
            accessibilityRole="button"
            accessibilityLabel={dict.controls.apkDownloadA11y}
            onPress={handleApkPress}
            style={({ pressed }) => [
              styles.touchButton,
              styles.primaryButton,
              pressed ? styles.primaryButtonPressed : null,
            ]}
          >
            <Text style={styles.primaryButtonLabel}>{t.apkDownloadButton}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    padding: 18,
    borderRadius: RADII.sheet,
    backgroundColor: PALETTE.bgSurface,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    gap: 12,
  },
  cardCompact: {
    padding: 14,
    gap: 10,
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
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: PALETTE.inkPrimary,
  },
  subtitle: {
    fontSize: 12.5,
    color: PALETTE.inkMuted,
  },
  closeButton: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 12,
    paddingVertical: 8,
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
  sectionCard: {
    padding: 12,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.bgSubtle,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
    gap: 8,
  },
  apkCard: {
    backgroundColor: PALETTE.bgTinted,
    borderColor: PALETTE.positiveBorder,
  },
  sectionTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: PALETTE.inkPrimary,
  },
  bodyText: {
    fontSize: 13,
    lineHeight: 18.5,
    color: PALETTE.inkSecondary,
  },
  subtleNote: {
    fontSize: 12,
    lineHeight: 17,
    color: PALETTE.inkMuted,
  },
  statusList: {
    gap: 6,
  },
  statusItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    marginTop: 5,
    flexShrink: 0,
  },
  statusText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 18,
    color: PALETTE.inkPrimary,
  },
  attributionLinkRow: {
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: RADII.sm,
    backgroundColor: PALETTE.bgSurface,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
  },
  attributionItemText: {
    fontSize: 12,
    lineHeight: 17,
    color: PALETTE.inkPrimary,
    textDecorationLine: 'underline',
  },
  touchButton: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: RADII.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: PALETTE.accentPrimary,
    borderWidth: 1,
    borderColor: PALETTE.accentPrimaryStrong,
  },
  primaryButtonPressed: {
    backgroundColor: PALETTE.accentPrimaryStrong,
  },
  primaryButtonLabel: {
    fontSize: 13.5,
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
  buttonPressed: {
    backgroundColor: PALETTE.bgRecessed,
  },
});
