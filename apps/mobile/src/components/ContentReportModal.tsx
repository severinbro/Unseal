// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import {
  CONTENT_REPORT_REASONS,
  type ContentReportReason,
  type ContentReportTargetType,
  type CreateContentReportRequest,
  type CreateContentReportResponse,
} from '@openunseal/shared';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Linking,
  Platform,
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

export interface ContentReportTarget {
  targetType: ContentReportTargetType;
  targetId: string;
}

export interface ContentReportModalProps {
  visible: boolean;
  target: ContentReportTarget | null;
  locale?: Locale | undefined;
  compact?: boolean | undefined;
  privacyPolicyUrl?: string | undefined;
  onSubmit: (
    input: CreateContentReportRequest,
  ) => Promise<CreateContentReportResponse>;
  onClose: () => void;
}

export function ContentReportModal({
  visible,
  target,
  locale = DEFAULT_LOCALE,
  compact = false,
  privacyPolicyUrl,
  onSubmit,
  onClose,
}: ContentReportModalProps): React.JSX.Element | null {
  const { palette } = useTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [reason, setReason] = useState<ContentReportReason>(
    'privacy_personal_data',
  );
  const [explanation, setExplanation] = useState<string>('');
  const [reporterName, setReporterName] = useState<string>('');
  const [reporterEmail, setReporterEmail] = useState<string>('');
  const [goodFaithConfirmed, setGoodFaithConfirmed] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submittedResult, setSubmittedResult] =
    useState<CreateContentReportResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (visible && target) {
      setReason(
        target.targetType === 'photo'
          ? 'photo_rights'
          : 'privacy_personal_data',
      );
      setExplanation('');
      setReporterName('');
      setReporterEmail('');
      setGoodFaithConfirmed(false);
      setIsSubmitting(false);
      setSubmittedResult(null);
      setErrorMessage(null);
    }
  }, [visible, target]);

  if (!visible || !target) {
    return null;
  }

  const t = getTranslations(locale).contentReport;

  const handleSubmitPress = (): void => {
    const trimmedExplanation = explanation.trim();
    if (trimmedExplanation.length < 10) {
      setErrorMessage(t.explanationTooShortError);
      return;
    }

    const trimmedEmail = reporterEmail.trim();
    if (trimmedEmail.length > 0 && !SIMPLE_EMAIL_PATTERN.test(trimmedEmail)) {
      setErrorMessage(t.invalidEmailError);
      return;
    }

    if (!goodFaithConfirmed) {
      setErrorMessage(t.goodFaithRequiredError);
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);
    const trimmedName = reporterName.trim();
    const pageUrl =
      Platform.OS === 'web' && typeof globalThis.location?.href === 'string'
        ? globalThis.location.href.slice(0, 500)
        : null;

    void onSubmit({
      targetType: target.targetType,
      targetId: target.targetId,
      reason,
      explanation: trimmedExplanation,
      reporterName: trimmedName.length > 0 ? trimmedName : null,
      reporterEmail: trimmedEmail.length > 0 ? trimmedEmail : null,
      goodFaithConfirmed: true,
      pageUrl,
    })
      .then((res) => {
        setSubmittedResult(res);
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
      testID="content-report-modal-card"
      accessibilityLabel={t.modalA11y}
      style={[styles.card, compact ? styles.cardCompact : null]}
    >
      <View style={styles.headerRow}>
        <View style={styles.headerTextGroup}>
          <Text style={styles.title}>{t.title}</Text>
          <Text style={styles.subtitle}>{t.subtitle}</Text>
        </View>
        <Pressable
          testID="content-report-close"
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

      <Text style={styles.targetMeta}>
        {t.targetLabel(target.targetType, target.targetId)}
      </Text>

      {submittedResult ? (
        <View testID="content-report-success" style={styles.successCard}>
          <Text style={styles.successTitle}>{t.successTitle}</Text>
          <Text style={styles.successBody}>
            {t.successBody(
              submittedResult.reportId,
              submittedResult.receiptSent,
            )}
          </Text>
          <View style={styles.actionRow}>
            <Pressable
              testID="content-report-done"
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
            <Text style={styles.fieldLabel}>{t.reasonLabel}</Text>
            <View style={styles.reasonChipsRow} accessibilityRole="radiogroup">
              {CONTENT_REPORT_REASONS.map((option) => {
                const selected = reason === option;
                return (
                  <Pressable
                    key={option}
                    testID={`content-report-reason-${option}`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => setReason(option)}
                    style={[
                      styles.reasonChip,
                      selected ? styles.reasonChipSelected : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.reasonChipLabel,
                        selected ? styles.reasonChipLabelSelected : null,
                      ]}
                    >
                      {t.reasonLabels[option]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{t.explanationLabel}</Text>
            <TextInput
              testID="content-report-explanation-input"
              accessibilityLabel={t.explanationLabel}
              value={explanation}
              onChangeText={(next) => {
                setExplanation(next);
                if (errorMessage) {
                  setErrorMessage(null);
                }
              }}
              placeholder={t.explanationPlaceholder}
              placeholderTextColor={palette.inkMuted}
              multiline
              maxLength={4000}
              style={styles.multilineInput}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{t.reporterNameLabel}</Text>
            <TextInput
              testID="content-report-name-input"
              accessibilityLabel={t.reporterNameLabel}
              value={reporterName}
              onChangeText={setReporterName}
              placeholder={t.reporterNamePlaceholder}
              placeholderTextColor={palette.inkMuted}
              maxLength={120}
              style={styles.singleLineInput}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{t.reporterEmailLabel}</Text>
            <TextInput
              testID="content-report-email-input"
              accessibilityLabel={t.reporterEmailLabel}
              value={reporterEmail}
              onChangeText={(next) => {
                setReporterEmail(next);
                if (errorMessage) {
                  setErrorMessage(null);
                }
              }}
              placeholder={t.reporterEmailPlaceholder}
              placeholderTextColor={palette.inkMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={254}
              style={styles.singleLineInput}
            />
          </View>

          <Pressable
            testID="content-report-good-faith-checkbox"
            accessibilityRole="checkbox"
            accessibilityState={{ checked: goodFaithConfirmed }}
            onPress={() => {
              setGoodFaithConfirmed((prev) => !prev);
              if (errorMessage) {
                setErrorMessage(null);
              }
            }}
            style={styles.checkboxRow}
          >
            <View
              style={[
                styles.checkboxBox,
                goodFaithConfirmed ? styles.checkboxBoxChecked : null,
              ]}
            >
              <Text style={styles.checkboxMark}>
                {goodFaithConfirmed ? '✓' : ''}
              </Text>
            </View>
            <Text style={styles.checkboxText}>{t.goodFaithLabel}</Text>
          </Pressable>

          <Text style={styles.privacyNote}>
            {t.privacyNotePrefix}
            {privacyPolicyUrl ? (
              <Text
                accessibilityRole="link"
                onPress={() => openExternalUrl(privacyPolicyUrl)}
                style={styles.privacyLink}
              >
                {t.privacyLinkText}
              </Text>
            ) : null}
          </Text>

          {errorMessage ? (
            <View style={styles.errorBox} accessibilityRole="alert">
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}

          <View style={styles.actionRow}>
            <Pressable
              testID="content-report-submit"
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
      maxWidth: '100%',
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
      minWidth: 0,
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
    targetMeta: {
      fontSize: 12,
      fontWeight: '600',
      color: PALETTE.inkSecondary,
      backgroundColor: PALETTE.bgSubtle,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: RADII.sm,
      borderWidth: 1,
      borderColor: PALETTE.borderSubtle,
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
    reasonChipsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    reasonChip: {
      maxWidth: '100%',
      flexShrink: 1,
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: RADII.md,
      borderWidth: 1,
      borderColor: PALETTE.borderStrong,
      backgroundColor: PALETTE.bgSubtle,
    },
    reasonChipSelected: {
      backgroundColor: PALETTE.dangerBg,
      borderColor: PALETTE.dangerBorder,
    },
    reasonChipLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: PALETTE.inkPrimary,
      flexShrink: 1,
    },
    reasonChipLabelSelected: {
      color: PALETTE.dangerText,
    },
    multilineInput: {
      minHeight: 96,
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
    checkboxRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      paddingVertical: 4,
    },
    checkboxBox: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderWidth: 1.5,
      borderColor: PALETTE.borderStrong,
      backgroundColor: PALETTE.bgSurface,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 1,
      flexShrink: 0,
    },
    checkboxBoxChecked: {
      backgroundColor: PALETTE.accentPrimary,
      borderColor: PALETTE.accentPrimary,
    },
    checkboxMark: {
      fontSize: 13,
      fontWeight: '700',
      color: PALETTE.inkOnAccent,
    },
    checkboxText: {
      flex: 1,
      fontSize: 12,
      lineHeight: 16.5,
      color: PALETTE.inkSecondary,
    },
    privacyNote: {
      fontSize: 11.5,
      lineHeight: 15.5,
      color: PALETTE.inkMuted,
    },
    privacyLink: {
      color: PALETTE.accentPrimary,
      textDecorationLine: 'underline',
      fontWeight: '600',
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
      maxWidth: '100%',
      flexShrink: 1,
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
