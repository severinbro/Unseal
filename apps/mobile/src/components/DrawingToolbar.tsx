import {
  GEOMETRY_LIMITS,
  type SurfaceType,
} from '@entsiegelung/shared';
import React, { useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

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

export const SURFACE_TYPE_OPTIONS: readonly SurfaceTypeOption[] = [
  {
    value: 'asphalt',
    label: 'Asphalt',
    examples: 'Road margins, parking strips, lanes',
  },
  {
    value: 'concrete',
    label: 'Concrete',
    examples: 'Poured slabs, courtyards, forecourts',
  },
  {
    value: 'pavers',
    label: 'Pavers',
    examples: 'Brick, cobble, interlocking stones',
  },
  {
    value: 'other',
    label: 'Other Sealed',
    examples: 'Compacted gravel, bitumen, mixed cover',
  },
] as const;

export interface DrawingToolbarProps {
  toolbar: DrawingToolbarModel;
  compact?: boolean;
  onUndoVertex: () => void;
  onCloseRing: () => void;
  onSelectSurfaceType: (surfaceType: SurfaceType) => void;
  onChangeNote: (note: string) => void;
  onRequestDiscard: () => void;
  onCancelDiscard: () => void;
  onConfirmDiscard: () => void;
  onSubmit: () => void;
}

export function DrawingToolbar({
  toolbar,
  compact = false,
  onUndoVertex,
  onCloseRing,
  onSelectSurfaceType,
  onChangeNote,
  onRequestDiscard,
  onCancelDiscard,
  onConfirmDiscard,
  onSubmit,
}: DrawingToolbarProps): React.JSX.Element | null {
  const [minimizedOnMobile, setMinimizedOnMobile] = useState<boolean>(false);

  useEffect(() => {
    if (!toolbar.visible || !compact) {
      setMinimizedOnMobile(false);
    }
  }, [toolbar.visible, compact]);

  useEffect(() => {
    if (toolbar.submitError !== null || toolbar.confirmingDiscard) {
      setMinimizedOnMobile(false);
    }
  }, [toolbar.submitError, toolbar.confirmingDiscard]);

  if (!toolbar.visible) {
    return null;
  }

  const isCollapsed = compact && minimizedOnMobile;

  return (
    <View
      style={[styles.card, compact ? styles.cardCompact : null]}
      accessibilityLabel="Polygon proposal drawing toolbar"
    >
      <View style={styles.headerRow}>
        <View style={styles.metricsStack}>
          <View style={styles.telemetryPillsRow}>
            <View style={styles.metricPill}>
              <Text style={styles.metricPillLabel}>Vertices</Text>
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
              <Text style={styles.metricPillLabel}>Area</Text>
              <Text style={styles.metricPillValue}>
                {toolbar.areaM2.toFixed(1)} m²
              </Text>
            </View>
          </View>
          <Text style={styles.metricsStatus}>
            {toolbar.isRingClosed
              ? 'Shape closed — review surface type & publish'
              : 'Tap corners on the map to outline sealed ground'}
          </Text>
        </View>

        {compact ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              isCollapsed
                ? 'Expand proposal details sheet'
                : 'Minimize sheet to view more map'
            }
            onPress={() => setMinimizedOnMobile((prev) => !prev)}
            style={styles.collapseToggleBtn}
          >
            <Text style={styles.collapseToggleLabel}>
              {isCollapsed ? 'Details' : 'Map View'}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {toolbar.crossingPoint !== null ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>
            Edges cross near [{toolbar.crossingPoint[0].toFixed(5)},{' '}
            {toolbar.crossingPoint[1].toFixed(5)}]. Tap &ldquo;
            {toolbar.undoLabel}&rdquo; to uncross the boundary.
          </Text>
        </View>
      ) : null}

      {toolbar.submitError ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>{toolbar.submitError}</Text>
        </View>
      ) : null}

      <View style={styles.vertexActionsRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={toolbar.undoLabel}
          accessibilityState={{ disabled: !toolbar.canUndo }}
          disabled={!toolbar.canUndo}
          onPress={onUndoVertex}
          style={[
            styles.touchButton,
            styles.flexActionButton,
            styles.secondaryButton,
            !toolbar.canUndo ? styles.disabledSecondaryButton : null,
          ]}
        >
          <Text style={styles.secondaryButtonLabel}>{toolbar.undoLabel}</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close shape"
          accessibilityState={{ disabled: !toolbar.canCloseRing }}
          disabled={!toolbar.canCloseRing}
          onPress={onCloseRing}
          style={[
            styles.touchButton,
            styles.flexActionButton,
            styles.secondaryButton,
            toolbar.canCloseRing ? styles.closeShapeReadyButton : null,
            !toolbar.canCloseRing ? styles.disabledSecondaryButton : null,
          ]}
        >
          <Text
            style={[
              styles.secondaryButtonLabel,
              toolbar.canCloseRing ? styles.closeShapeReadyLabel : null,
            ]}
          >
            {toolbar.isRingClosed ? 'Ring Closed ✓' : 'Close Shape'}
          </Text>
        </Pressable>
      </View>

      {!isCollapsed ? (
        <>
          {toolbar.nearAreaBound ? (
            <View style={styles.nearBoundNotice}>
              <Text style={styles.nearBoundText}>
                Estimated area is close to the allowed range (2–500,000 m²);
                exact PostGIS ellipsoid area is verified on submit.
              </Text>
            </View>
          ) : null}

          {toolbar.validationErrors.length > 0 ? (
            <View style={styles.guidanceBox} accessibilityRole="alert">
              {toolbar.validationErrors.map((errText) => (
                <Text key={errText} style={styles.guidanceText}>
                  • {errText}
                </Text>
              ))}
            </View>
          ) : null}

          <View style={styles.sectionBlock}>
            <Text style={styles.sectionTitle}>Sealed Surface Material</Text>
            <View style={styles.surfaceGrid} accessibilityRole="radiogroup">
              {SURFACE_TYPE_OPTIONS.map((option) => {
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
              <Text style={styles.sectionTitle}>Site Context (Optional)</Text>
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
              accessibilityLabel="Optional site context note"
              value={toolbar.note}
              onChangeText={onChangeNote}
              maxLength={GEOMETRY_LIMITS.MAX_NOTE_LENGTH}
              multiline
              placeholder="Unused paved corner, heat island, or drainage potential (no personal names or contact data)"
              placeholderTextColor={PALETTE.inkMuted}
              style={styles.noteInput}
            />
          </View>
        </>
      ) : null}

      {toolbar.confirmingDiscard ? (
        <View style={styles.discardConfirmBox} accessibilityRole="alert">
          <Text style={styles.discardConfirmTitle}>
            Discard your unsubmitted polygon draft?
          </Text>
          <View style={styles.footerActionsRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Keep editing polygon draft"
              onPress={onCancelDiscard}
              style={[
                styles.touchButton,
                styles.flexActionButton,
                styles.secondaryButton,
              ]}
            >
              <Text style={styles.secondaryButtonLabel}>Keep Editing</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Confirm discard polygon draft"
              onPress={onConfirmDiscard}
              style={[
                styles.touchButton,
                styles.flexActionButton,
                styles.dangerButton,
              ]}
            >
              <Text style={styles.primaryButtonLabel}>Discard Draft</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.footerActionsRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel or discard draft"
            onPress={onRequestDiscard}
            style={[styles.touchButton, styles.secondaryButton]}
          >
            <Text style={styles.secondaryButtonLabel}>Cancel</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Submit unsealing proposal"
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
              {toolbar.isSubmitting ? 'Publishing…' : 'Submit Proposal'}
            </Text>
          </Pressable>
        </View>
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  metricsStack: {
    flex: 1,
    gap: 4,
  },
  telemetryPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  metricPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
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
  metricPillLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: PALETTE.inkMuted,
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
  collapseToggleBtn: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.bgSubtle,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  collapseToggleLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: PALETTE.inkPrimary,
  },
  nearBoundNotice: {
    padding: 9,
    borderRadius: RADII.sm,
    backgroundColor: PALETTE.neutralBg,
    borderWidth: 1,
    borderColor: PALETTE.neutralBorder,
  },
  nearBoundText: {
    ...TABULAR_NUMS_STYLE,
    fontSize: 12,
    color: PALETTE.neutralText,
  },
  guidanceBox: {
    padding: 9,
    borderRadius: RADII.sm,
    backgroundColor: PALETTE.infoBg,
    borderWidth: 1,
    borderColor: PALETTE.infoBorder,
    gap: 3,
  },
  guidanceText: {
    fontSize: 12,
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
  vertexActionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  flexActionButton: {
    flex: 1,
  },
  submitFlexButton: {
    flex: 1,
  },
  closeShapeReadyButton: {
    borderColor: PALETTE.accentPrimary,
    backgroundColor: PALETTE.positiveBg,
  },
  closeShapeReadyLabel: {
    color: PALETTE.positiveText,
    fontWeight: '700',
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
    fontSize: 13,
    fontWeight: '700',
    color: PALETTE.inkPrimary,
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
  noteInput: {
    minHeight: 58,
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
    fontSize: 13.5,
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
    fontSize: 13.5,
    fontWeight: '700',
    color: PALETTE.inkOnAccent,
  },
});
