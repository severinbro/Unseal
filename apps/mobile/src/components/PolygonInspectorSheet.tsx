import {
  GEOMETRY_LIMITS,
  SURFACE_TYPES,
  type PatchPolygonRequest,
  type PolygonFeature,
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

import { MIN_TOUCH_TARGET_DP } from '../state/viewModels';
import {
  MONO_FONT_FAMILY,
  PALETTE,
  RADII,
  SURFACE_SWATCHES,
  TABULAR_NUMS_STYLE,
} from '../theme/tokens';

const SURFACE_LABELS: Record<SurfaceType, string> = {
  asphalt: 'Asphalt',
  concrete: 'Concrete',
  pavers: 'Pavers',
  other: 'Other Sealed',
};

export interface PolygonInspectorSheetProps {
  feature: PolygonFeature | null;
  overlapIndex: number;
  overlapCount: number;
  disclaimerText: string;
  abuseContact: string | null;
  isAuthenticated: boolean;
  compact?: boolean;
  onCycleOverlap: () => void;
  onClose: () => void;
  onVoteIntent: (polygonId: string, value: 1 | -1) => void;
  onCastVote: (polygonId: string, value: 1 | -1) => Promise<void>;
  onClearVote: (polygonId: string) => Promise<void>;
  onPatchPolygon: (
    polygonId: string,
    patch: PatchPolygonRequest,
  ) => Promise<void>;
  onDeletePolygon: (polygonId: string) => Promise<void>;
}

export function PolygonInspectorSheet({
  feature,
  overlapIndex,
  overlapCount,
  disclaimerText,
  abuseContact,
  isAuthenticated,
  compact = false,
  onCycleOverlap,
  onClose,
  onVoteIntent,
  onCastVote,
  onClearVote,
  onPatchPolygon,
  onDeletePolygon,
}: PolygonInspectorSheetProps): React.JSX.Element | null {
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editSurfaceType, setEditSurfaceType] =
    useState<SurfaceType>('asphalt');
  const [editNote, setEditNote] = useState<string>('');
  const [confirmingDelete, setConfirmingDelete] = useState<boolean>(false);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const featureId = feature?.id ?? null;
  const featureSurfaceType = feature?.properties.surfaceType ?? 'asphalt';
  const featureNote = feature?.properties.note ?? '';

  useEffect(() => {
    setIsEditing(false);
    setConfirmingDelete(false);
    setActionError(null);
    setEditSurfaceType(featureSurfaceType);
    setEditNote(featureNote);
  }, [featureId, featureSurfaceType, featureNote]);

  if (feature === null) {
    return null;
  }

  const { properties } = feature;
  const swatch = SURFACE_SWATCHES[properties.surfaceType];
  const effectiveOverlapCount = Math.max(1, overlapCount);
  const displayOverlapPosition = Math.min(
    effectiveOverlapCount,
    overlapIndex + 1,
  );

  const scoreToneStyle =
    properties.score > 0
      ? styles.scoreBadgePositive
      : properties.score < 0
        ? styles.scoreBadgeNegative
        : styles.scoreBadgeNeutral;
  const scoreTextToneStyle =
    properties.score > 0
      ? styles.scoreBadgeTextPositive
      : properties.score < 0
        ? styles.scoreBadgeTextNegative
        : styles.scoreBadgeTextNeutral;

  const handleVotePress = (targetValue: 1 | -1): void => {
    setActionError(null);
    if (!isAuthenticated) {
      onVoteIntent(feature.id, targetValue);
      return;
    }

    setIsBusy(true);
    const task =
      properties.myVote === targetValue
        ? onClearVote(feature.id)
        : onCastVote(feature.id, targetValue);

    void task
      .catch((err: unknown) => {
        const message =
          err instanceof Error
            ? err.message
            : 'Unable to update vote right now.';
        setActionError(message);
      })
      .finally(() => {
        setIsBusy(false);
      });
  };

  const handleSavePatch = (): void => {
    setActionError(null);
    setIsBusy(true);
    const trimmed = editNote.trim();
    const patchPayload: PatchPolygonRequest = {
      surfaceType: editSurfaceType,
      note: trimmed.length === 0 ? null : trimmed,
    };

    void onPatchPolygon(feature.id, patchPayload)
      .then(() => {
        setIsEditing(false);
      })
      .catch((err: unknown) => {
        const message =
          err instanceof Error
            ? err.message
            : 'Unable to save proposal metadata.';
        setActionError(message);
      })
      .finally(() => {
        setIsBusy(false);
      });
  };

  const handleConfirmDelete = (): void => {
    setActionError(null);
    setIsBusy(true);

    void onDeletePolygon(feature.id)
      .catch((err: unknown) => {
        const message =
          err instanceof Error ? err.message : 'Unable to delete proposal.';
        setActionError(message);
      })
      .finally(() => {
        setIsBusy(false);
      });
  };

  return (
    <View
      style={[styles.sheet, compact ? styles.sheetCompact : null]}
      accessibilityLabel="Selected unsealing proposal inspector"
    >
      <View style={styles.headerRow}>
        <View style={styles.headerTitleGroup}>
          <View style={styles.materialTitleRow}>
            <View
              style={[styles.materialSwatch, { backgroundColor: swatch.color }]}
            />
            <Text style={styles.sheetTitle}>
              {SURFACE_LABELS[properties.surfaceType]}
            </Text>
            <View style={styles.areaPill}>
              <Text style={styles.areaPillText}>
                {properties.areaM2.toFixed(1)} m²
              </Text>
            </View>
          </View>
          <Text style={styles.authorMeta}>
            Proposed by @{properties.authorPseudonym}
            {properties.isAuthor ? ' · You' : ''}
          </Text>
        </View>

        <View style={styles.headerControls}>
          {effectiveOverlapCount > 1 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Overlapping proposal ${displayOverlapPosition} of ${effectiveOverlapCount}. Activate to inspect next overlapping proposal.`}
              onPress={onCycleOverlap}
              style={styles.overlapButton}
            >
              <Text style={styles.overlapButtonLabel}>
                {displayOverlapPosition}/{effectiveOverlapCount} · Next
              </Text>
            </Pressable>
          ) : (
            <View style={styles.singleBadge}>
              <Text style={styles.singleBadgeText}>1/1</Text>
            </View>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close proposal inspector"
            onPress={onClose}
            style={styles.closeButton}
          >
            <Text style={styles.closeButtonLabel}>Close</Text>
          </Pressable>
        </View>
      </View>

      {actionError ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>{actionError}</Text>
        </View>
      ) : null}

      {isEditing && properties.isAuthor ? (
        <View style={styles.editSection}>
          <Text style={styles.immutableNotice}>
            Polygon coordinates are locked after publication so community votes
            remain anchored to the exact site. Delete and redraw to adjust
            boundaries.
          </Text>

          <View style={styles.surfaceChoiceRow} accessibilityRole="radiogroup">
            {SURFACE_TYPES.map((st) => {
              const selected = editSurfaceType === st;
              return (
                <Pressable
                  key={st}
                  accessibilityRole="radio"
                  accessibilityLabel={SURFACE_LABELS[st]}
                  accessibilityState={{ checked: selected }}
                  onPress={() => setEditSurfaceType(st)}
                  style={[
                    styles.surfaceChip,
                    selected ? styles.surfaceChipSelected : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.surfaceChipLabel,
                      selected ? styles.surfaceChipLabelSelected : null,
                    ]}
                  >
                    {SURFACE_LABELS[st]}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <TextInput
            accessibilityLabel="Edit proposal note"
            value={editNote}
            onChangeText={setEditNote}
            maxLength={GEOMETRY_LIMITS.MAX_NOTE_LENGTH}
            multiline
            placeholder="Optional site note (leave blank to clear)"
            placeholderTextColor={PALETTE.inkMuted}
            style={styles.editNoteInput}
          />

          <View style={styles.buttonRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel metadata edit"
              disabled={isBusy}
              onPress={() => {
                setIsEditing(false);
                setEditSurfaceType(properties.surfaceType);
                setEditNote(properties.note ?? '');
              }}
              style={[styles.touchButton, styles.secondaryButton]}
            >
              <Text style={styles.secondaryButtonLabel}>Cancel</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save proposal metadata changes"
              disabled={isBusy}
              onPress={handleSavePatch}
              style={[styles.touchButton, styles.primaryButton]}
            >
              <Text style={styles.primaryButtonLabel}>
                {isBusy ? 'Saving…' : 'Save Changes'}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.noteCard}>
          <Text style={styles.noteBody}>
            {properties.note && properties.note.trim().length > 0
              ? properties.note
              : 'No additional site note provided by the author.'}
          </Text>
        </View>
      )}

      <View style={styles.votePanel}>
        <View style={[styles.scoreBadge, scoreToneStyle]}>
          <Text style={[styles.scoreBadgeValue, scoreTextToneStyle]}>
            {properties.score > 0
              ? `+${properties.score}`
              : `${properties.score}`}
          </Text>
          <Text style={[styles.scoreBadgeCaption, scoreTextToneStyle]}>
            net score
          </Text>
        </View>

        <View style={styles.voteButtonsGroup}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Upvote proposal (+1), current upvotes ${properties.upvotes}`}
            accessibilityState={{
              selected: properties.myVote === 1,
              disabled: isBusy,
            }}
            disabled={isBusy}
            onPress={() => handleVotePress(1)}
            style={[
              styles.touchButton,
              styles.voteButton,
              properties.myVote === 1 ? styles.upvoteButtonActive : null,
            ]}
          >
            <Text
              style={[
                styles.voteButtonLabel,
                properties.myVote === 1 ? styles.voteButtonLabelActive : null,
              ]}
            >
              +1 ({properties.upvotes})
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Downvote proposal (-1), current downvotes ${properties.downvotes}`}
            accessibilityState={{
              selected: properties.myVote === -1,
              disabled: isBusy,
            }}
            disabled={isBusy}
            onPress={() => handleVotePress(-1)}
            style={[
              styles.touchButton,
              styles.voteButton,
              properties.myVote === -1 ? styles.downvoteButtonActive : null,
            ]}
          >
            <Text
              style={[
                styles.voteButtonLabel,
                properties.myVote === -1 ? styles.voteButtonLabelActive : null,
              ]}
            >
              −1 ({properties.downvotes})
            </Text>
          </Pressable>
        </View>
      </View>

      <View
        style={styles.permanentDisclaimerBox}
        accessibilityLabel="Permanent civic proposal disclaimer"
      >
        <Text style={styles.permanentDisclaimerText}>{disclaimerText}</Text>
      </View>

      {properties.isAuthor && !isEditing ? (
        <View style={styles.authorSection}>
          {confirmingDelete ? (
            <View style={styles.deleteConfirmBox} accessibilityRole="alert">
              <Text style={styles.deleteConfirmText}>
                Permanently delete this unsealing proposal and its votes?
              </Text>
              <View style={styles.buttonRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Keep proposal"
                  disabled={isBusy}
                  onPress={() => setConfirmingDelete(false)}
                  style={[styles.touchButton, styles.secondaryButton]}
                >
                  <Text style={styles.secondaryButtonLabel}>Keep Proposal</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Confirm delete proposal"
                  disabled={isBusy}
                  onPress={handleConfirmDelete}
                  style={[styles.touchButton, styles.dangerButton]}
                >
                  <Text style={styles.primaryButtonLabel}>
                    {isBusy ? 'Deleting…' : 'Confirm Delete'}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.buttonRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit proposal surface type or note"
                disabled={isBusy}
                onPress={() => setIsEditing(true)}
                style={[styles.touchButton, styles.secondaryButton]}
              >
                <Text style={styles.secondaryButtonLabel}>Edit Details</Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Delete proposal"
                disabled={isBusy}
                onPress={() => setConfirmingDelete(true)}
                style={[styles.touchButton, styles.dangerOutlineButton]}
              >
                <Text style={styles.dangerOutlineLabel}>Delete Proposal</Text>
              </Pressable>
            </View>
          )}
        </View>
      ) : null}

      {abuseContact && abuseContact.trim().length > 0 ? (
        <Text style={styles.abuseContactText}>
          Report abuse or personal data in notes: {abuseContact}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    padding: 14,
    borderRadius: RADII.lg,
    backgroundColor: PALETTE.bgSurface,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
    gap: 10,
  },
  sheetCompact: {
    borderWidth: 0,
    borderRadius: 0,
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 14,
  },
  headerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  headerTitleGroup: {
    flex: 1,
    minWidth: 170,
    gap: 3,
  },
  materialTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 7,
  },
  materialSwatch: {
    width: 12,
    height: 12,
    borderRadius: 3,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
    color: PALETTE.inkPrimary,
  },
  areaPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADII.sm,
    backgroundColor: PALETTE.bgSubtle,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
  },
  areaPillText: {
    ...TABULAR_NUMS_STYLE,
    fontFamily: MONO_FONT_FAMILY,
    fontSize: 12,
    fontWeight: '700',
    color: PALETTE.inkPrimary,
  },
  authorMeta: {
    fontSize: 12,
    color: PALETTE.inkMuted,
  },
  headerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  overlapButton: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.infoBg,
    borderWidth: 1,
    borderColor: PALETTE.infoBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlapButtonLabel: {
    ...TABULAR_NUMS_STYLE,
    fontSize: 12.5,
    fontWeight: '700',
    color: PALETTE.infoText,
  },
  singleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: RADII.sm,
    backgroundColor: PALETTE.bgSubtle,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
  },
  singleBadgeText: {
    ...TABULAR_NUMS_STYLE,
    fontFamily: MONO_FONT_FAMILY,
    fontSize: 11,
    fontWeight: '600',
    color: PALETTE.inkMuted,
  },
  closeButton: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.bgSubtle,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: PALETTE.inkPrimary,
  },
  permanentDisclaimerBox: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.bgSubtle,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
  },
  permanentDisclaimerText: {
    fontSize: 11.5,
    lineHeight: 16,
    color: PALETTE.inkSecondary,
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
  noteCard: {
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.bgSubtle,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
  },
  noteBody: {
    fontSize: 13.5,
    lineHeight: 19,
    color: PALETTE.inkPrimary,
  },
  editSection: {
    gap: 8,
    padding: 10,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.bgSubtle,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
  },
  immutableNotice: {
    fontSize: 12,
    lineHeight: 16,
    color: PALETTE.inkSecondary,
  },
  surfaceChoiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  surfaceChip: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    backgroundColor: PALETTE.bgSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  surfaceChipSelected: {
    borderColor: PALETTE.accentPrimary,
    backgroundColor: PALETTE.positiveBg,
  },
  surfaceChipLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: PALETTE.inkPrimary,
  },
  surfaceChipLabelSelected: {
    color: PALETTE.positiveText,
    fontWeight: '700',
  },
  editNoteInput: {
    minHeight: 60,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    backgroundColor: PALETTE.bgSurface,
    fontSize: 13,
    color: PALETTE.inkPrimary,
    textAlignVertical: 'top',
  },
  votePanel: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  scoreBadge: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: RADII.md,
    borderWidth: 1,
  },
  scoreBadgePositive: {
    backgroundColor: PALETTE.positiveBg,
    borderColor: PALETTE.positiveBorder,
  },
  scoreBadgeNeutral: {
    backgroundColor: PALETTE.neutralBg,
    borderColor: PALETTE.neutralBorder,
  },
  scoreBadgeNegative: {
    backgroundColor: PALETTE.dangerBg,
    borderColor: PALETTE.dangerBorder,
  },
  scoreBadgeValue: {
    ...TABULAR_NUMS_STYLE,
    fontFamily: MONO_FONT_FAMILY,
    fontSize: 15,
    fontWeight: '700',
  },
  scoreBadgeCaption: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  scoreBadgeTextPositive: {
    color: PALETTE.positiveText,
  },
  scoreBadgeTextNeutral: {
    color: PALETTE.neutralText,
  },
  scoreBadgeTextNegative: {
    color: PALETTE.dangerText,
  },
  voteButtonsGroup: {
    flexDirection: 'row',
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
  voteButton: {
    backgroundColor: PALETTE.bgSurface,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
  },
  upvoteButtonActive: {
    backgroundColor: PALETTE.accentPrimary,
    borderColor: PALETTE.accentPrimaryStrong,
  },
  downvoteButtonActive: {
    backgroundColor: PALETTE.dangerSolid,
    borderColor: PALETTE.dangerSolid,
  },
  voteButtonLabel: {
    ...TABULAR_NUMS_STYLE,
    fontSize: 13.5,
    fontWeight: '700',
    color: PALETTE.inkPrimary,
  },
  voteButtonLabelActive: {
    color: PALETTE.inkOnAccent,
  },
  authorSection: {
    borderTopWidth: 1,
    borderTopColor: PALETTE.borderSubtle,
    paddingTop: 10,
  },
  deleteConfirmBox: {
    padding: 10,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.dangerBg,
    borderWidth: 1,
    borderColor: PALETTE.dangerBorder,
    gap: 8,
  },
  deleteConfirmText: {
    fontSize: 13,
    fontWeight: '700',
    color: PALETTE.dangerText,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
  },
  primaryButton: {
    backgroundColor: PALETTE.accentPrimary,
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
    fontSize: 13.5,
    fontWeight: '600',
    color: PALETTE.inkPrimary,
  },
  dangerOutlineButton: {
    backgroundColor: PALETTE.bgSurface,
    borderWidth: 1,
    borderColor: PALETTE.dangerBorder,
  },
  dangerOutlineLabel: {
    fontSize: 13.5,
    fontWeight: '600',
    color: PALETTE.dangerText,
  },
  dangerButton: {
    backgroundColor: PALETTE.dangerSolid,
  },
  abuseContactText: {
    fontSize: 11,
    color: PALETTE.inkMuted,
  },
});
