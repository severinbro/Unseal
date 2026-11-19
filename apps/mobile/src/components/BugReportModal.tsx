// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Unseal Contributors

import React, { useEffect, useMemo, useState } from 'react';
import {
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
import { MIN_TOUCH_TARGET_DP } from '../state/viewModels';
import { useTheme } from '../theme/themeContext';
import { RADII, type ThemePalette } from '../theme/tokens';

const SIMPLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface BugReportModalProps {
  visible: boolean;
  locale?: Locale | undefined;
  compact?: boolean | undefined;
  defaultEmail?: string | null | undefined;
  onSubmit: (input: {
    description: string;
    contactEmail: string | null;
  }) => Promise<void>;
  onClose: () => void;
}

export function BugReportModal({
  visible,
  locale = DEFAULT_LOCALE,
  compact = false,
  defaultEmail = null,
  onSubmit,
  onClose,
}: BugReportModalProps): React.JSX.Element | null {
  const { palette } = useTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [description, setDescription] = useState<string>('');
  const [contactEmail, setContactEmail] = useState<string>(defaultEmail ?? '');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isSubmitted, setIsSubmitted] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setDescription('');
      setContactEmail(defaultEmail ?? '');
      setIsSubmitting(false);
      setIsSubmitted(false);
      setErrorMessage(null);
    }
  }, [visible, defaultEmail]);

  if (!visible) {
    return null;
  }

  const t = getTranslations(locale).bugReport;

  const handleSubmitPress = (): void => {
    const trimmedDescription = description.trim();
    if (trimmedDescription.length < 5) {
      setErrorMessage(t.tooShortError);
      return;
    }

    const trimmedEmail = contactEmail.trim();
    if (trimmedEmail.length > 0 && !SIMPLE_EMAIL_PATTERN.test(trimmedEmail)) {
      setErrorMessage(t.invalidEmailError);
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);
    void onSubmit({
      description: trimmedDescription,
      contactEmail: trimmedEmail.length > 0 ? trimmedEmail : null,
    })
      .then(() => {
        setIsSubmitted(true);
      })
      .catch((err: unknown) => {
        setErrorMessage(localizeError(err, t.errorFallback, locale));
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  };

  return (
    <View
      testID="bug-report-modal-card"
      accessibilityLabel={t.modalA11y}
      style={[styles.card, compact ? styles.cardCompact : null]}
    >
      <View style={styles.headerRow}>
        <View style={styles.headerTextGroup}>
          <Text style={styles.title}>{t.title}</Text>
          <Text style={styles.subtitle}>{t.subtitle}</Text>
        </View>
        <Pressable
          testID="bug-report-close"
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

      {isSubmitted ? (
        <View testID="bug-report-success" style={styles.successCard}>
          <Text style={styles.successTitle}>{t.successTitle}</Text>
          <Text style={styles.successBody}>{t.successBody}</Text>
          <View style={styles.actionRow}>
            <Pressable
              testID="bug-report-done"
              accessibilityRole="button"
              accessibilityLabel={t.closeA11y}
              onPress={onClose}
              style={({ pressed }) => [
                styles.touchButton,
                styles.primaryButton,
                pressed ? styles.primaryButtonPressed : null,
              ]}
            >
              <Text style={styles.primaryButtonLabel}>{t.close}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{t.descriptionLabel}</Text>
            <TextInput
              testID="bug-report-description-input"
              accessibilityLabel={t.descriptionA11y}
              value={description}
              onChangeText={(next) => {
                setDescription(next);
                if (errorMessage) {
                  setErrorMessage(null);
                }
              }}
              placeholder={t.descriptionPlaceholder}
              placeholderTextColor={palette.inkMuted}
              multiline
              maxLength={4000}
              style={styles.multilineInput}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{t.contactEmailLabel}</Text>
            <TextInput
              testID="bug-report-email-input"
              accessibilityLabel={t.contactEmailA11y}
              value={contactEmail}
              onChangeText={(next) => {
                setContactEmail(next);
                if (errorMessage) {
                  setErrorMessage(null);
                }
              }}
              placeholder={t.contactEmailPlaceholder}
              placeholderTextColor={palette.inkMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={254}
              style={styles.singleLineInput}
            />
          </View>

          {errorMessage ? (
            <View style={styles.errorBox} accessibilityRole="alert">
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}

          <View style={styles.actionRow}>
            <Pressable
              testID="bug-report-submit"
              accessibilityRole="button"
              accessibilityLabel={t.submitButton}
              disabled={isSubmitting}
              onPress={handleSubmitPress}
              style={({ pressed }) => [
                styles.touchButton,
                styles.primaryButton,
                isSubmitting ? styles.disabledButton : null,
                pressed && !isSubmitting ? styles.primaryButtonPressed : null,
              ]}
            >
              <Text style={styles.primaryButtonLabel}>
                {isSubmitting ? t.submittingBusy : t.submitButton}
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

function createStyles(PALETTE: ThemePalette) {
  return StyleSheet.create({
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
    lineHeight: 16,
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
  fieldGroup: {
    gap: 5,
  },
  fieldLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    color: PALETTE.inkPrimary,
  },
  multilineInput: {
    minHeight: 104,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    backgroundColor: PALETTE.bgSurface,
    fontSize: 14,
    color: PALETTE.inkPrimary,
    textAlignVertical: 'top',
  },
  singleLineInput: {
    minHeight: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    backgroundColor: PALETTE.bgSurface,
    fontSize: 14,
    color: PALETTE.inkPrimary,
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
  successCard: {
    padding: 12,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.positiveBg,
    borderWidth: 1,
    borderColor: PALETTE.positiveBorder,
    gap: 6,
  },
  successTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: PALETTE.positiveText,
  },
  successBody: {
    fontSize: 12.5,
    lineHeight: 17,
    color: PALETTE.inkPrimary,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 2,
  },
  touchButton: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 14,
    paddingVertical: 9,
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
    fontSize: 13,
    fontWeight: '700',
    color: PALETTE.inkOnAccent,
  },
  disabledButton: {
    opacity: 0.65,
  },
  buttonPressed: {
    backgroundColor: PALETTE.bgRecessed,
  },
  });
}
