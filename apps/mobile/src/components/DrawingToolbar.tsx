import {
  GEOMETRY_LIMITS,
  type SurfaceType,
} from '@entsiegelung/shared';
import React from 'react';
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

export interface SurfaceTypeOption {
  readonly value: SurfaceType;
  readonly label: string;
  readonly examples: string;
}

export const SURFACE_TYPE_OPTIONS: readonly SurfaceTypeOption[] = [
  {
    value: 'asphalt',
    label: 'Asphalt',
    examples: 'Road margins, asphalt parking corners, paved lanes',
  },
  {
    value: 'concrete',
    label: 'Concrete',
    examples: 'Poured concrete courtyards, slabs, forecourts',
  },
  {
    value: 'pavers',
    label: 'Pavers',
    examples: 'Interlocking paving stones, brick or cobble plazas',
  },
  {
    value: 'other',
    label: 'Other Sealed',
    examples: 'Compacted gravel, bitumen, mixed impervious cover',
  },
] as const;

export interface DrawingToolbarProps {
  toolbar: DrawingToolbarModel;
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
  onUndoVertex,
  onCloseRing,
  onSelectSurfaceType,
  onChangeNote,
  onRequestDiscard,
  onCancelDiscard,
  onConfirmDiscard,
  onSubmit,
}: DrawingToolbarProps): React.JSX.Element | null {
  if (!toolbar.visible) {
    return null;
  }

  return (
    <View
      style={styles.card}
      accessibilityLabel="Polygon proposal drawing toolbar"
    >
      <View style={styles.metricsRow}>
        <Text style={styles.metricsPrimary}>
          Vertices: {toolbar.distinctVertexCount} / {toolbar.maxVertices} · Area:{' '}
          {toolbar.areaM2.toFixed(1)} m²
        </Text>
        <Text style={styles.metricsStatus}>
          {toolbar.isRingClosed
            ? 'Shape closed (geometry locks upon publish)'
            : 'Tap map corners to outline sealed surface'}
        </Text>
      </View>

      {toolbar.nearAreaBound ? (
        <View style={styles.nearBoundNotice}>
          <Text style={styles.nearBoundText}>
            Estimated area is close to the allowed range (2–500,000 m²); exact
            ellipsoid area is verified on submit.
          </Text>
        </View>
      ) : null}

      {toolbar.crossingPoint !== null ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>
            Edges cross near [{toolbar.crossingPoint[0].toFixed(5)},{' '}
            {toolbar.crossingPoint[1].toFixed(5)}]. Tap &ldquo;
            {toolbar.undoLabel}&rdquo; to uncross the boundary.
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
            styles.secondaryButton,
            !toolbar.canCloseRing ? styles.disabledSecondaryButton : null,
          ]}
        >
          <Text style={styles.secondaryButtonLabel}>Close shape</Text>
        </Pressable>
      </View>

      <View style={styles.sectionBlock}>
        <Text style={styles.sectionTitle}>Sealed Surface Type</Text>
        <View style={styles.surfaceGrid} accessibilityRole="radiogroup">
          {SURFACE_TYPE_OPTIONS.map((option) => {
            const selected = toolbar.surfaceType === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityLabel={`${option.label}: ${option.examples}`}
                accessibilityState={{ checked: selected }}
                onPress={() => onSelectSurfaceType(option.value)}
                style={[
                  styles.surfaceOption,
                  selected ? styles.surfaceOptionSelected : null,
                ]}
              >
                <Text
                  style={[
                    styles.surfaceOptionTitle,
                    selected ? styles.surfaceOptionTitleSelected : null,
                  ]}
                >
                  {option.label}
                </Text>
                <Text
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
          <Text style={styles.sectionTitle}>Site Note (Optional)</Text>
          <Text
            style={[
              styles.charCounter,
              toolbar.noteRemainingChars < 0 ? styles.charCounterExceeded : null,
            ]}
          >
            {toolbar.noteRemainingChars} / {GEOMETRY_LIMITS.MAX_NOTE_LENGTH} left
          </Text>
        </View>
        <TextInput
          accessibilityLabel="Optional site context note"
          value={toolbar.note}
          onChangeText={onChangeNote}
          maxLength={GEOMETRY_LIMITS.MAX_NOTE_LENGTH}
          multiline
          placeholder="Describe site context (e.g., unused paved corner, rainwater pooling — do not include personal names or private contact info)"
          placeholderTextColor="#6c7b73"
          style={styles.noteInput}
        />
      </View>

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
              style={[styles.touchButton, styles.secondaryButton]}
            >
              <Text style={styles.secondaryButtonLabel}>Keep Editing</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Confirm discard polygon draft"
              onPress={onConfirmDiscard}
              style={[styles.touchButton, styles.dangerButton]}
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
              styles.submitButton,
              !toolbar.canSubmit ? styles.submitButtonDisabled : null,
            ]}
          >
            <Text style={styles.primaryButtonLabel}>
              {toolbar.isSubmitting ? 'Submitting…' : 'Submit Proposal'}
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
    borderRadius: 10,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cdd9d2',
    gap: 10,
  },
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 6,
  },
  metricsPrimary: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1b2a22',
  },
  metricsStatus: {
    fontSize: 12,
    color: '#46584f',
  },
  nearBoundNotice: {
    padding: 8,
    borderRadius: 6,
    backgroundColor: '#fff6e3',
  },
  nearBoundText: {
    fontSize: 12,
    color: '#6b4700',
  },
  guidanceBox: {
    padding: 8,
    borderRadius: 6,
    backgroundColor: '#f1f5f9',
    gap: 3,
  },
  guidanceText: {
    fontSize: 12,
    color: '#243b53',
  },
  errorBox: {
    padding: 8,
    borderRadius: 6,
    backgroundColor: '#fdecec',
  },
  errorText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8a1f1f',
  },
  vertexActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  sectionBlock: {
    gap: 6,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1b2a22',
  },
  surfaceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  surfaceOption: {
    flexGrow: 1,
    flexBasis: 160,
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#b7c7be',
    backgroundColor: '#f9fbfa',
    justifyContent: 'center',
  },
  surfaceOptionSelected: {
    borderColor: '#1f6f4a',
    backgroundColor: '#e6f2ec',
  },
  surfaceOptionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1b2a22',
  },
  surfaceOptionTitleSelected: {
    color: '#134c31',
  },
  surfaceOptionExamples: {
    marginTop: 2,
    fontSize: 11,
    color: '#4e6057',
  },
  surfaceOptionExamplesSelected: {
    color: '#1f593d',
  },
  noteHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  charCounter: {
    fontSize: 12,
    color: '#4e6057',
  },
  charCounterExceeded: {
    color: '#8a1f1f',
    fontWeight: '700',
  },
  noteInput: {
    minHeight: 64,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#b7c7be',
    backgroundColor: '#ffffff',
    fontSize: 13,
    color: '#1b2a22',
    textAlignVertical: 'top',
  },
  discardConfirmBox: {
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#fff4df',
    gap: 8,
  },
  discardConfirmTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#5f3d00',
  },
  footerActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
  },
  touchButton: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButton: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#b7c7be',
  },
  disabledSecondaryButton: {
    opacity: 0.5,
  },
  secondaryButtonLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1b2a22',
  },
  submitButton: {
    backgroundColor: '#1f6f4a',
  },
  submitButtonDisabled: {
    backgroundColor: '#9ab5a8',
  },
  dangerButton: {
    backgroundColor: '#a62626',
  },
  primaryButtonLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
});
