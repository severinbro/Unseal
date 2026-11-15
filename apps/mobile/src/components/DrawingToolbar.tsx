import {
  GEOMETRY_LIMITS,
  SURFACE_TYPES,
  type SurfaceType,
} from '@entsiegelung/shared';
import React from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  DEFAULT_LOCALE,
  getTranslations,
  type Locale,
} from '../i18n/translations';
import {
  MIN_TOUCH_TARGET_DP,
  type DrawingToolbarModel,
} from '../state/viewModels';
import {
  MONO_FONT_FAMILY,
  PALETTE,
  RADII,
  SURFACE_SWATCHES,
  TABULAR_NUMS_STYLE,
} from '../theme/tokens';

export interface SurfaceTypeOption {
  readonly value: SurfaceType;
  readonly label: string;
  readonly examples: string;
}

export function getSurfaceTypeOptions(
  locale: Locale = DEFAULT_LOCALE,
): readonly SurfaceTypeOption[] {
  const copy = getTranslations(locale).surfaces;
  return SURFACE_TYPES.map((value) => ({
    value,
    label: copy[value].label,
    examples: copy[value].examples,
  }));
}

export const SURFACE_TYPE_OPTIONS: readonly SurfaceTypeOption[] =
  getSurfaceTypeOptions(DEFAULT_LOCALE);

export interface DrawingToolbarProps {
  toolbar: DrawingToolbarModel;
  locale?: Locale;
  compact?: boolean;
  onUndoVertex: () => void;
  onCloseRing: () => void;
  onAdvanceToDetails: () => void;
  onBackToGeometry: () => void;
  onSelectSurfaceType: (surfaceType: SurfaceType) => void;
  onChangeNote: (note: string) => void;
  onTakeDraftPhoto?: () => void;
  onPickDraftPhoto?: () => void;
  onRemoveDraftPhoto?: (photoId: string) => void;
  onRequestDiscard: () => void;
  onCancelDiscard: () => void;
  onConfirmDiscard: () => void;
  onSubmit: () => void;
}

export function DrawingToolbar({
  toolbar,
  locale = DEFAULT_LOCALE,
  compact = false,
  onUndoVertex,
  onAdvanceToDetails,
  onBackToGeometry,
  onSelectSurfaceType,
  onChangeNote,
  onTakeDraftPhoto,
  onPickDraftPhoto,
  onRemoveDraftPhoto,
  onRequestDiscard,
  onCancelDiscard,
  onConfirmDiscard,
  onSubmit,
}: DrawingToolbarProps): React.JSX.Element | null {
  if (!toolbar.visible) {
    return null;
  }

  const t = getTranslations(locale).drawing;
  const surfaceOptions = getSurfaceTypeOptions(locale);
  const isGeometryStep = toolbar.step === 'geometry';

  return (
    <View
      style={[
        styles.card,
        compact ? styles.cardCompact : null,
        compact && isGeometryStep ? styles.cardGeometrySlim : null,
      ]}
      accessibilityLabel={t.toolbarA11y}
    >
      <View style={styles.stepperRow}>
        <View style={styles.stepPillsGroup}>
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: isGeometryStep }}
            onPress={() => {
              if (!isGeometryStep) {
                onBackToGeometry();
              }
            }}
            style={[
              styles.stepPill,
              isGeometryStep ? styles.stepPillActive : styles.stepPillDone,
            ]}
          >
            <Text
              style={[
                styles.stepPillLabel,
                isGeometryStep
                  ? styles.stepPillLabelActive
                  : styles.stepPillLabelDone,
              ]}
            >
              {t.stepGeometryLabel}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="tab"
            accessibilityState={{
              selected: !isGeometryStep,
              disabled: !toolbar.canAdvanceToDetails,
            }}
            disabled={!toolbar.canAdvanceToDetails}
            onPress={() => {
              if (isGeometryStep && toolbar.canAdvanceToDetails) {
                onAdvanceToDetails();
              }
            }}
            style={[
              styles.stepPill,
              !isGeometryStep ? styles.stepPillActive : null,
              isGeometryStep && !toolbar.canAdvanceToDetails
                ? styles.stepPillDisabled
                : null,
            ]}
          >
            <Text
              style={[
                styles.stepPillLabel,
                !isGeometryStep ? styles.stepPillLabelActive : null,
              ]}
            >
              {t.stepDetailsLabel}
            </Text>
          </Pressable>
        </View>

        <View style={styles.telemetryPillsRow}>
          <View style={styles.metricPill}>
            <Text style={styles.metricPillValue}>
              {toolbar.distinctVertexCount}/{toolbar.maxVertices}
            </Text>
          </View>
          <View
            style={[
              styles.metricPill,
              toolbar.areaM2 >= GEOMETRY_LIMITS.MIN_AREA_M2
                ? styles.metricPillReady
                : null,
            ]}
          >
            <Text style={styles.metricPillValue}>
              {toolbar.areaM2.toFixed(1)} m²
            </Text>
          </View>
        </View>
      </View>

      {toolbar.crossingPoint !== null ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>
            {t.crossingError(
              toolbar.crossingPoint[0].toFixed(5),
              toolbar.crossingPoint[1].toFixed(5),
              toolbar.undoLabel,
            )}
          </Text>
        </View>
      ) : null}

      {toolbar.submitError ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>{toolbar.submitError}</Text>
        </View>
      ) : null}

      {toolbar.confirmingDiscard ? (
        <View style={styles.discardConfirmBox} accessibilityRole="alert">
          <Text style={styles.discardConfirmTitle}>
            {t.discardConfirmTitle}
          </Text>
          <View style={styles.footerActionsRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.keepEditingA11y}
              onPress={onCancelDiscard}
              style={[
                styles.touchButton,
                styles.flexActionButton,
                styles.secondaryButton,
              ]}
            >
              <Text style={styles.secondaryButtonLabel}>{t.keepEditing}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.confirmDiscardA11y}
              onPress={onConfirmDiscard}
              style={[
                styles.touchButton,
                styles.flexActionButton,
                styles.dangerButton,
              ]}
            >
              <Text style={styles.primaryButtonLabel}>{t.confirmDiscard}</Text>
            </Pressable>
          </View>
        </View>
      ) : isGeometryStep ? (
        <>
          <Text numberOfLines={2} style={styles.metricsStatus}>
            {toolbar.isRingClosed ? t.statusClosed : t.statusOpen}
          </Text>

          {toolbar.nearAreaBound ? (
            <View style={styles.nearBoundNotice}>
              <Text style={styles.nearBoundText}>{t.nearBoundNotice}</Text>
            </View>
          ) : null}

          {toolbar.distinctVertexCount >= GEOMETRY_LIMITS.MIN_VERTICES &&
          toolbar.validationErrors.length > 0 &&
          toolbar.crossingPoint === null ? (
            <View style={styles.guidanceBox} accessibilityRole="alert">
              {toolbar.validationErrors.map((errText) => (
                <Text key={errText} style={styles.guidanceText}>
                  • {errText}
                </Text>
              ))}
            </View>
          ) : null}

          <View style={styles.geometryActionRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.cancelA11y}
              onPress={onRequestDiscard}
              style={[
                styles.touchButton,
                styles.compactControlButton,
                styles.secondaryButton,
              ]}
            >
              <Text numberOfLines={1} style={styles.secondaryButtonLabel}>
                {t.cancel}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={toolbar.undoLabel}
              accessibilityState={{ disabled: !toolbar.canUndo }}
              disabled={!toolbar.canUndo}
              onPress={onUndoVertex}
              style={[
                styles.touchButton,
                styles.compactControlButton,
                styles.secondaryButton,
                !toolbar.canUndo ? styles.disabledSecondaryButton : null,
              ]}
            >
              <Text numberOfLines={1} style={styles.secondaryButtonLabel}>
                {toolbar.undoLabel}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.nextStepA11y}
              accessibilityState={{ disabled: !toolbar.canAdvanceToDetails }}
              disabled={!toolbar.canAdvanceToDetails}
              onPress={onAdvanceToDetails}
              style={[
                styles.touchButton,
                styles.submitFlexButton,
                styles.submitButton,
                !toolbar.canAdvanceToDetails
                  ? styles.submitButtonDisabled
                  : null,
              ]}
            >
              <Text numberOfLines={1} style={styles.primaryButtonLabel}>
                {toolbar.isRingClosed ? t.nextStep : t.closeAndNext}
              </Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <View style={styles.detailsSubheaderRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.backToGeometryA11y}
              onPress={onBackToGeometry}
              style={[styles.backOutlineButton]}
            >
              <Text style={styles.backOutlineButtonLabel}>
                {t.backToGeometry}
              </Text>
            </Pressable>
            <Text style={styles.ringLockedPill}>{t.ringClosed}</Text>
          </View>

          <View style={styles.sectionBlock}>
            <Text style={styles.sectionTitle}>{t.surfaceSectionTitle}</Text>
            <View style={styles.surfaceGrid} accessibilityRole="radiogroup">
              {surfaceOptions.map((option) => {
                const selected = toolbar.surfaceType === option.value;
                const swatch = SURFACE_SWATCHES[option.value];
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="radio"
                    accessibilityLabel={`${option.label}: ${option.examples}`}
                    accessibilityState={{ checked: selected }}
                    onPress={() => onSelectSurfaceType(option.value)}
                    style={[
                      styles.surfaceOption,
                      compact ? styles.surfaceOptionCompact : null,
                      selected ? styles.surfaceOptionSelected : null,
                    ]}
                  >
                    <View style={styles.surfaceOptionTopRow}>
                      <View
                        style={[
                          styles.materialSwatch,
                          { backgroundColor: swatch.color },
                        ]}
                      />
                      <Text
                        style={[
                          styles.surfaceOptionTitle,
                          selected ? styles.surfaceOptionTitleSelected : null,
                        ]}
                      >
                        {option.label}
                      </Text>
                    </View>
                    <Text
                      numberOfLines={2}
                      style={[
                        styles.surfaceOptionExamples,
                        selected ? styles.surfaceOptionExamplesSelected : null,
                      ]}
                    >
                      {option.examples}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.sectionBlock}>
            <View style={styles.noteHeaderRow}>
              <Text style={styles.sectionTitle}>{t.noteSectionTitle}</Text>
              <Text
                style={[
                  styles.charCounter,
                  toolbar.noteRemainingChars < 0
                    ? styles.charCounterExceeded
                    : null,
                ]}
              >
                {toolbar.noteRemainingChars}/{GEOMETRY_LIMITS.MAX_NOTE_LENGTH}
              </Text>
            </View>
            <TextInput
              accessibilityLabel={t.noteInputA11y}
              value={toolbar.note}
              onChangeText={onChangeNote}
              maxLength={GEOMETRY_LIMITS.MAX_NOTE_LENGTH}
              multiline
              placeholder={t.notePlaceholder}
              placeholderTextColor={PALETTE.inkMuted}
              style={styles.noteInput}
            />
            <Text testID="draft-note-public-hint" style={styles.notePublicHint}>
              {t.notePublicHint}
            </Text>
          </View>

          {onTakeDraftPhoto || onPickDraftPhoto ? (
            <View style={styles.sectionBlock}>
              <Text style={styles.sectionTitle}>{t.photosSectionTitle}</Text>
              <View style={styles.photoPickerRow}>
                {onTakeDraftPhoto ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t.takePhoto}
                    disabled={!toolbar.canAddPhoto}
                    onPress={onTakeDraftPhoto}
                    style={[
                      styles.touchButton,
                      styles.flexActionButton,
                      styles.secondaryButton,
                      !toolbar.canAddPhoto
                        ? styles.disabledSecondaryButton
                        : null,
                    ]}
                  >
                    <Text style={styles.secondaryButtonLabel}>
                      {t.takePhoto}
                    </Text>
                  </Pressable>
                ) : null}

                {onPickDraftPhoto ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t.pickPhoto}
                    disabled={!toolbar.canAddPhoto}
                    onPress={onPickDraftPhoto}
                    style={[
                      styles.touchButton,
                      styles.flexActionButton,
                      styles.secondaryButton,
                      !toolbar.canAddPhoto
                        ? styles.disabledSecondaryButton
                        : null,
                    ]}
                  >
                    <Text style={styles.secondaryButtonLabel}>
                      {t.pickPhoto}
                    </Text>
                  </Pressable>
                ) : null}
              </View>

              {toolbar.draftPhotos.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.draftPhotoStrip}
                >
                  {toolbar.draftPhotos.map((photo) => (
                    <View key={photo.id} style={styles.draftPhotoThumbCard}>
                      <Image
                        source={{ uri: photo.previewUri }}
                        style={styles.draftPhotoThumb}
                        resizeMode="cover"
                      />
                      {onRemoveDraftPhoto ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t.removeDraftPhotoA11y}
                          onPress={() => onRemoveDraftPhoto(photo.id)}
                          style={styles.draftPhotoRemoveBtn}
                        >
                          <Text style={styles.draftPhotoRemoveLabel}>✕</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ))}
                </ScrollView>
              ) : null}

              <Text style={styles.photoPrivacyHint}>{t.photoPrivacyHint}</Text>
            </View>
          ) : null}

          <View style={styles.footerActionsRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.cancelA11y}
              onPress={onRequestDiscard}
              style={[styles.touchButton, styles.secondaryButton]}
            >
              <Text style={styles.secondaryButtonLabel}>{t.cancel}</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.submitA11y}
              accessibilityState={{
                disabled: !toolbar.canSubmit,
                busy: toolbar.isSubmitting,
              }}
              disabled={!toolbar.canSubmit}
              onPress={onSubmit}
              style={[
                styles.touchButton,
                styles.submitFlexButton,
                styles.submitButton,
                !toolbar.canSubmit ? styles.submitButtonDisabled : null,
              ]}
            >
              <Text style={styles.primaryButtonLabel}>
                {toolbar.isSubmitting ? t.submitting : t.submit}
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    borderRadius: RADII.lg,
    backgroundColor: PALETTE.bgSurface,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
    gap: 10,
  },
  cardCompact: {
    borderWidth: 0,
    borderRadius: 0,
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 14,
  },
  cardGeometrySlim: {
    gap: 8,
    paddingTop: 4,
    paddingBottom: 10,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  stepPillsGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stepPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADII.pill,
    backgroundColor: PALETTE.bgSubtle,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
  },
  stepPillActive: {
    backgroundColor: PALETTE.accentPrimary,
    borderColor: PALETTE.accentPrimaryStrong,
  },
  stepPillDone: {
    backgroundColor: PALETTE.positiveBg,
    borderColor: PALETTE.positiveBorder,
  },
  stepPillDisabled: {
    opacity: 0.5,
  },
  stepPillLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: PALETTE.inkSecondary,
  },
  stepPillLabelActive: {
    color: PALETTE.inkOnAccent,
  },
  stepPillLabelDone: {
    color: PALETTE.positiveText,
  },
  telemetryPillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metricPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADII.sm,
    backgroundColor: PALETTE.bgSubtle,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
  },
  metricPillReady: {
    backgroundColor: PALETTE.positiveBg,
    borderColor: PALETTE.positiveBorder,
  },
  metricPillValue: {
    ...TABULAR_NUMS_STYLE,
    fontFamily: MONO_FONT_FAMILY,
    fontSize: 12,
    fontWeight: '700',
    color: PALETTE.inkPrimary,
  },
  metricsStatus: {
    fontSize: 12,
    color: PALETTE.inkSecondary,
  },
  detailsSubheaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  backOutlineButton: {
    minHeight: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.bgSubtle,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backOutlineButtonLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    color: PALETTE.inkPrimary,
  },
  ringLockedPill: {
    fontSize: 12,
    fontWeight: '700',
    color: PALETTE.positiveText,
  },
  nearBoundNotice: {
    padding: 8,
    borderRadius: RADII.sm,
    backgroundColor: PALETTE.neutralBg,
    borderWidth: 1,
    borderColor: PALETTE.neutralBorder,
  },
  nearBoundText: {
    ...TABULAR_NUMS_STYLE,
    fontSize: 11.5,
    color: PALETTE.neutralText,
  },
  guidanceBox: {
    padding: 8,
    borderRadius: RADII.sm,
    backgroundColor: PALETTE.infoBg,
    borderWidth: 1,
    borderColor: PALETTE.infoBorder,
    gap: 2,
  },
  guidanceText: {
    fontSize: 11.5,
    color: PALETTE.infoText,
  },
  errorBox: {
    padding: 9,
    borderRadius: RADII.sm,
    backgroundColor: PALETTE.dangerBg,
    borderWidth: 1,
    borderColor: PALETTE.dangerBorder,
  },
  errorText: {
    ...TABULAR_NUMS_STYLE,
    fontSize: 12,
    fontWeight: '600',
    color: PALETTE.dangerText,
  },
  geometryActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  compactControlButton: {
    paddingHorizontal: 11,
  },
  flexActionButton: {
    flex: 1,
  },
  submitFlexButton: {
    flex: 1,
  },
  sectionBlock: {
    gap: 6,
  },
  sectionTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    color: PALETTE.inkPrimary,
  },
  surfaceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  surfaceOption: {
    flexGrow: 1,
    flexBasis: 156,
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    backgroundColor: PALETTE.bgSubtle,
    justifyContent: 'center',
  },
  surfaceOptionCompact: {
    flexBasis: '46%',
  },
  surfaceOptionSelected: {
    borderColor: PALETTE.accentPrimary,
    backgroundColor: PALETTE.positiveBg,
  },
  surfaceOptionTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  materialSwatch: {
    width: 11,
    height: 11,
    borderRadius: 3,
  },
  surfaceOptionTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    color: PALETTE.inkPrimary,
    flexShrink: 1,
  },
  surfaceOptionTitleSelected: {
    color: PALETTE.positiveText,
  },
  surfaceOptionExamples: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 14,
    color: PALETTE.inkMuted,
  },
  surfaceOptionExamplesSelected: {
    color: PALETTE.inkSecondary,
  },
  noteHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  charCounter: {
    ...TABULAR_NUMS_STYLE,
    fontFamily: MONO_FONT_FAMILY,
    fontSize: 11.5,
    color: PALETTE.inkMuted,
  },
  charCounterExceeded: {
    color: PALETTE.dangerText,
    fontWeight: '700',
  },
  notePublicHint: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 14,
    color: PALETTE.inkMuted,
  },
  noteInput: {
    minHeight: 54,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    backgroundColor: PALETTE.bgSurface,
    fontSize: 13,
    color: PALETTE.inkPrimary,
    textAlignVertical: 'top',
  },
  photoPickerRow: {
    flexDirection: 'row',
    gap: 8,
  },
  draftPhotoStrip: {
    gap: 8,
    paddingVertical: 2,
  },
  draftPhotoThumbCard: {
    width: 72,
    height: 72,
    borderRadius: RADII.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    position: 'relative',
    backgroundColor: PALETTE.bgRecessed,
  },
  draftPhotoThumb: {
    width: '100%',
    height: '100%',
  },
  draftPhotoRemoveBtn: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(18, 32, 25, 0.82)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  draftPhotoRemoveLabel: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  photoPrivacyHint: {
    fontSize: 11,
    lineHeight: 15,
    color: PALETTE.inkMuted,
  },
  discardConfirmBox: {
    padding: 10,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.neutralBg,
    borderWidth: 1,
    borderColor: PALETTE.neutralBorder,
    gap: 8,
  },
  discardConfirmTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: PALETTE.neutralText,
  },
  footerActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  secondaryButton: {
    backgroundColor: PALETTE.bgSurface,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
  },
  disabledSecondaryButton: {
    opacity: 0.48,
  },
  secondaryButtonLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: PALETTE.inkPrimary,
  },
  submitButton: {
    backgroundColor: PALETTE.accentPrimary,
    borderWidth: 1,
    borderColor: PALETTE.accentPrimaryStrong,
  },
  submitButtonDisabled: {
    backgroundColor: PALETTE.accentDisabled,
    borderColor: PALETTE.accentDisabled,
  },
  dangerButton: {
    backgroundColor: PALETTE.dangerSolid,
  },
  primaryButtonLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: PALETTE.inkOnAccent,
  },
});
