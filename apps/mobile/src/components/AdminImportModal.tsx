// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import {
  IMPORT_LICENSES,
  type ImportLicense,
  type PolygonOrigin,
} from '@openunseal/shared';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { ImportPolygonsOptions, UploadableFileInput } from '../api/client';
import {
  DEFAULT_LOCALE,
  getTranslations,
  localizeError,
  type Locale,
} from '../i18n/translations';
import {
  importLicenseRequiresAttribution,
  importLicenseRequiresWaiver,
  MIN_TOUCH_TARGET_DP,
  validateAdminImportForm,
} from '../state/viewModels';
import { useTheme } from '../theme/themeContext';
import { MONO_FONT_FAMILY, RADII, type ThemePalette } from '../theme/tokens';

const ORDERED_ORIGINS: readonly PolygonOrigin[] = [
  'initiative_import',
  'remote_sensing',
  'citizen',
];

export interface AdminImportModalProps {
  visible: boolean;
  file: UploadableFileInput | null;
  locale?: Locale | undefined;
  compact?: boolean | undefined;
  onSubmit: (
    file: UploadableFileInput,
    options: ImportPolygonsOptions,
  ) => Promise<void>;
  onClose: () => void;
}

export function AdminImportModal({
  visible,
  file,
  locale = DEFAULT_LOCALE,
  compact = false,
  onSubmit,
  onClose,
}: AdminImportModalProps): React.JSX.Element | null {
  const { palette } = useTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [origin, setOrigin] = useState<PolygonOrigin>('initiative_import');
  const [license, setLicense] = useState<ImportLicense>('CC0-1.0');
  const [attribution, setAttribution] = useState<string>('');
  const [sourceUrl, setSourceUrl] = useState<string>('');
  const [waiverConfirmed, setWaiverConfirmed] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setOrigin('initiative_import');
      setLicense('CC0-1.0');
      setAttribution('');
      setSourceUrl('');
      setWaiverConfirmed(false);
      setIsSubmitting(false);
      setErrorMessage(null);
    }
  }, [visible, file]);

  if (!visible || !file) {
    return null;
  }

  const dict = getTranslations(locale);
  const t = dict.adminImport;
  const needsWaiver = importLicenseRequiresWaiver(license);
  const needsAttribution = importLicenseRequiresAttribution(license);

  const handleSubmitPress = (): void => {
    const validation = validateAdminImportForm({
      origin,
      license,
      attribution,
      sourceUrl,
      waiverConfirmed,
      locale,
    });
    if (!validation.ok) {
      setErrorMessage(validation.errorMessage);
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);
    void onSubmit(file, validation.options)
      .catch((err: unknown) => {
        setErrorMessage(
          localizeError(err, dict.controls.importErrorFallback, locale),
        );
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  };

  return (
    <View
      testID="admin-import-modal-card"
      accessibilityLabel={t.modalA11y}
      style={[styles.card, compact ? styles.cardCompact : null]}
    >
      <View style={styles.headerRow}>
        <View style={styles.headerTextGroup}>
          <Text style={styles.title}>{t.title}</Text>
          <Text style={styles.subtitle}>{t.subtitle}</Text>
        </View>
        <Pressable
          testID="admin-import-close"
          accessibilityRole="button"
          accessibilityLabel={t.closeA11y}
          disabled={isSubmitting}
          onPress={onClose}
          style={({ pressed }) => [
            styles.closeButton,
            pressed ? styles.buttonPressed : null,
          ]}
        >
          <Text style={styles.closeButtonLabel}>{t.close}</Text>
        </Pressable>
      </View>

      <View style={styles.fileSummaryBox}>
        <Text style={styles.fieldLabel}>{t.fileLabel}</Text>
        <Text numberOfLines={1} style={styles.fileNameText}>
          {file.name}
        </Text>
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>{t.originLabel}</Text>
        <View style={styles.chipWrapRow} accessibilityRole="radiogroup">
          {ORDERED_ORIGINS.map((item) => {
            const selected = origin === item;
            return (
              <Pressable
                key={item}
                testID={`admin-import-origin-${item}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected, disabled: isSubmitting }}
                disabled={isSubmitting}
                onPress={() => {
                  setOrigin(item);
                  setErrorMessage(null);
                }}
                style={[
                  styles.choiceChip,
                  selected ? styles.choiceChipSelected : null,
                ]}
              >
                <Text
                  style={[
                    styles.choiceChipLabel,
                    selected ? styles.choiceChipLabelSelected : null,
                  ]}
                >
                  {t.originLabels[item]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>{t.licenseLabel}</Text>
        <View style={styles.chipWrapRow} accessibilityRole="radiogroup">
          {IMPORT_LICENSES.map((lic) => {
            const selected = license === lic;
            return (
              <Pressable
                key={lic}
                testID={`admin-import-license-${lic}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected, disabled: isSubmitting }}
                disabled={isSubmitting}
                onPress={() => {
                  setLicense(lic);
                  setWaiverConfirmed(false);
                  setErrorMessage(null);
                }}
                style={[
                  styles.choiceChip,
                  selected ? styles.choiceChipSelected : null,
                ]}
              >
                <Text
                  style={[
                    styles.choiceChipLabel,
                    selected ? styles.choiceChipLabelSelected : null,
                  ]}
                >
                  {t.licenseLabels[lic]}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.hintText}>{t.licenseHint}</Text>
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>
          {needsAttribution
            ? t.attributionLabelRequired
            : t.attributionLabelOptional}
        </Text>
        <TextInput
          testID="admin-import-attribution-input"
          accessibilityLabel={
            needsAttribution
              ? t.attributionLabelRequired
              : t.attributionLabelOptional
          }
          value={attribution}
          onChangeText={(next) => {
            setAttribution(next);
            if (errorMessage) {
              setErrorMessage(null);
            }
          }}
          placeholder={t.attributionPlaceholder}
          placeholderTextColor={palette.inkMuted}
          editable={!isSubmitting}
          maxLength={500}
          style={styles.singleLineInput}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>{t.sourceUrlLabel}</Text>
        <TextInput
          testID="admin-import-source-url-input"
          accessibilityLabel={t.sourceUrlLabel}
          value={sourceUrl}
          onChangeText={(next) => {
            setSourceUrl(next);
            if (errorMessage) {
              setErrorMessage(null);
            }
          }}
          placeholder={t.sourceUrlPlaceholder}
          placeholderTextColor={palette.inkMuted}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isSubmitting}
          maxLength={500}
          style={styles.singleLineInput}
        />
      </View>

      {needsWaiver ? (
        <Pressable
          testID="admin-import-waiver-checkbox"
          accessibilityRole="checkbox"
          accessibilityState={{
            checked: waiverConfirmed,
            disabled: isSubmitting,
          }}
          disabled={isSubmitting}
          onPress={() => {
            setWaiverConfirmed((prev) => !prev);
            setErrorMessage(null);
          }}
          style={styles.checkboxRow}
        >
          <View
            style={[
              styles.checkboxBox,
              waiverConfirmed ? styles.checkboxBoxChecked : null,
            ]}
          >
            {waiverConfirmed ? (
              <Text style={styles.checkboxCheckmark}>✓</Text>
            ) : null}
          </View>
          <Text style={styles.checkboxLabel}>{t.waiverLabel}</Text>
        </Pressable>
      ) : null}

      {errorMessage ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      ) : null}

      <View style={styles.actionRow}>
        <Pressable
          testID="admin-import-cancel"
          accessibilityRole="button"
          disabled={isSubmitting}
          onPress={onClose}
          style={({ pressed }) => [
            styles.touchButton,
            styles.secondaryButton,
            pressed && !isSubmitting ? styles.buttonPressed : null,
          ]}
        >
          <Text style={styles.secondaryButtonLabel}>{t.cancel}</Text>
        </Pressable>
        <Pressable
          testID="admin-import-submit"
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
      gap: 11,
    },
    cardCompact: {
      padding: 12,
      gap: 9,
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
      lineHeight: 22,
      fontWeight: '700',
      color: PALETTE.inkPrimary,
    },
    subtitle: {
      fontSize: 12.5,
      lineHeight: 17,
      color: PALETTE.inkSecondary,
    },
    closeButton: {
      minHeight: MIN_TOUCH_TARGET_DP,
      minWidth: MIN_TOUCH_TARGET_DP,
      paddingHorizontal: 10,
      borderRadius: RADII.pill,
      backgroundColor: PALETTE.bgSubtle,
      borderWidth: 1,
      borderColor: PALETTE.borderSubtle,
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeButtonLabel: {
      fontSize: 12.5,
      fontWeight: '600',
      color: PALETTE.inkPrimary,
    },
    fileSummaryBox: {
      paddingHorizontal: 11,
      paddingVertical: 8,
      borderRadius: RADII.md,
      backgroundColor: PALETTE.bgSubtle,
      borderWidth: 1,
      borderColor: PALETTE.borderSubtle,
      gap: 2,
    },
    fileNameText: {
      fontFamily: MONO_FONT_FAMILY,
      fontSize: 12.5,
      color: PALETTE.inkPrimary,
    },
    fieldGroup: {
      gap: 5,
    },
    fieldLabel: {
      fontSize: 12.5,
      fontWeight: '600',
      color: PALETTE.inkPrimary,
    },
    hintText: {
      fontSize: 11.5,
      lineHeight: 16,
      color: PALETTE.inkSecondary,
    },
    chipWrapRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    choiceChip: {
      minHeight: 36,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: RADII.pill,
      backgroundColor: PALETTE.bgSubtle,
      borderWidth: 1,
      borderColor: PALETTE.borderSubtle,
      justifyContent: 'center',
    },
    choiceChipSelected: {
      backgroundColor: PALETTE.accentPrimary,
      borderColor: PALETTE.accentPrimary,
    },
    choiceChipLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: PALETTE.inkPrimary,
    },
    choiceChipLabelSelected: {
      color: PALETTE.inkOnAccent,
    },
    singleLineInput: {
      minHeight: 40,
      paddingHorizontal: 11,
      paddingVertical: 8,
      borderRadius: RADII.md,
      backgroundColor: PALETTE.bgGround,
      borderWidth: 1,
      borderColor: PALETTE.borderStrong,
      fontSize: 13.5,
      color: PALETTE.inkPrimary,
    },
    checkboxRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 9,
      padding: 10,
      borderRadius: RADII.md,
      backgroundColor: PALETTE.bgSubtle,
      borderWidth: 1,
      borderColor: PALETTE.borderSubtle,
    },
    checkboxBox: {
      width: 20,
      height: 20,
      marginTop: 1,
      borderRadius: 5,
      borderWidth: 1.5,
      borderColor: PALETTE.borderStrong,
      backgroundColor: PALETTE.bgGround,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxBoxChecked: {
      backgroundColor: PALETTE.accentPrimary,
      borderColor: PALETTE.accentPrimary,
    },
    checkboxCheckmark: {
      fontSize: 13,
      fontWeight: '700',
      color: PALETTE.inkOnAccent,
    },
    checkboxLabel: {
      flex: 1,
      fontSize: 12,
      lineHeight: 16.5,
      color: PALETTE.inkPrimary,
    },
    errorBox: {
      padding: 10,
      borderRadius: RADII.md,
      backgroundColor: PALETTE.dangerBg,
      borderWidth: 1,
      borderColor: PALETTE.dangerBorder,
    },
    errorText: {
      fontSize: 12.5,
      lineHeight: 17,
      color: PALETTE.dangerText,
    },
    actionRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 8,
      marginTop: 2,
    },
    touchButton: {
      minHeight: MIN_TOUCH_TARGET_DP,
      paddingHorizontal: 14,
      borderRadius: RADII.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryButton: {
      backgroundColor: PALETTE.accentPrimary,
    },
    primaryButtonPressed: {
      opacity: 0.88,
    },
    primaryButtonLabel: {
      fontSize: 13.5,
      fontWeight: '700',
      color: PALETTE.inkOnAccent,
    },
    secondaryButton: {
      backgroundColor: PALETTE.bgSubtle,
      borderWidth: 1,
      borderColor: PALETTE.borderSubtle,
    },
    secondaryButtonLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: PALETTE.inkPrimary,
    },
    buttonPressed: {
      opacity: 0.82,
    },
    disabledButton: {
      opacity: 0.55,
    },
  });
}
