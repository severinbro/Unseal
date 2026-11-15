import React from 'react';
import {
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

export interface InstallAppModalProps {
  visible: boolean;
  locale?: Locale | undefined;
  compact?: boolean | undefined;
  apkDownloadUrl: string | null;
  onClose: () => void;
  onDownloadError?: ((message: string) => void) | undefined;
}

function StepList({ steps }: { steps: readonly string[] }): React.JSX.Element {
  return (
    <View style={styles.stepList}>
      {steps.map((step, index) => (
        <View key={index} style={styles.stepRow}>
          <Text style={styles.stepNumber}>{index + 1}.</Text>
          <Text style={styles.stepText}>{step}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Modal explaining how to install the web app as a PWA on Android and iOS,
 * and offering a direct Android APK download when configured.
 */
export function InstallAppModal({
  visible,
  locale = DEFAULT_LOCALE,
  compact = false,
  apkDownloadUrl,
  onClose,
  onDownloadError,
}: InstallAppModalProps): React.JSX.Element | null {
  if (!visible) {
    return null;
  }

  const dict = getTranslations(locale);
  const t = dict.installApp;
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
      testID="install-app-modal-card"
      accessibilityLabel={t.modalA11y}
      style={[styles.card, compact ? styles.cardCompact : null]}
    >
      <View style={styles.headerRow}>
        <View style={styles.headerTextGroup}>
          <Text style={styles.title}>{t.title}</Text>
          <Text style={styles.subtitle}>{t.subtitle}</Text>
        </View>
        <Pressable
          testID="install-app-modal-close"
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
        <Text style={styles.sectionTitle}>{t.androidPwaTitle}</Text>
        <StepList steps={t.androidPwaSteps} />
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>{t.iosPwaTitle}</Text>
        <StepList steps={t.iosPwaSteps} />
      </View>

      {showApkButton ? (
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{t.androidApkTitle}</Text>
          <Text style={styles.bodyNote}>{t.androidApkBody}</Text>
          <View style={styles.actionRow}>
            <Pressable
              testID="install-modal-download-apk-button"
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
          </View>
        </View>
      ) : null}
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
    gap: 3,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: PALETTE.inkPrimary,
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 16.5,
    color: PALETTE.inkSecondary,
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
  stepList: {
    gap: 4,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  stepNumber: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    color: PALETTE.accentPrimary,
    minWidth: 14,
  },
  stepText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16.5,
    color: PALETTE.inkSecondary,
  },
  bodyNote: {
    fontSize: 12,
    lineHeight: 16.5,
    color: PALETTE.inkSecondary,
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
  buttonPressed: {
    backgroundColor: PALETTE.bgRecessed,
  },
});
