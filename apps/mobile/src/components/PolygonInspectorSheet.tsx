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
  onCycleOverlap,
  onClose,
  onVoteIntent,
  onCastVote,
  onClearVote,
  onPatchPolygon,
  onDeletePolygon,
}: PolygonInspectorSheetProps): React.JSX.Element | null {
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editSurfaceType, setEditSurfaceType] = useState<SurfaceType>('asphalt');
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
  const effectiveOverlapCount = Math.max(1, overlapCount);
  const displayOverlapPosition = Math.min(
    effectiveOverlapCount,
    overlapIndex + 1,
  );

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
      style={styles.sheet}
      accessibilityLabel="Selected unsealing proposal inspector"
    >
      <View style={styles.headerRow}>
        <View style={styles.headerTitleGroup}>
          <Text style={styles.sheetTitle}>
            {SURFACE_LABELS[properties.surfaceType]} ·{' '}
            {properties.areaM2.toFixed(1)} m²
          </Text>
          <Text style={styles.authorMeta}>
            Proposed by {properties.authorPseudonym}
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
                {displayOverlapPosition} / {effectiveOverlapCount} · Next
              </Text>
            </Pressable>
          ) : (
            <View style={styles.singleBadge}>
              <Text style={styles.singleBadgeText}>1 / 1</Text>
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

      <View
        style={styles.permanentDisclaimerBox}
        accessibilityLabel="Permanent civic proposal disclaimer"
      >
        <Text style={styles.permanentDisclaimerText}>{disclaimerText}</Text>
      </View>

      {actionError ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>{actionError}</Text>
        </View>
      ) : null}

      {isEditing && properties.isAuthor ? (
        <View style={styles.editSection}>
          <Text style={styles.immutableNotice}>
            Polygon coordinates are immutable after publication so community
            votes stay attached to the same site. To change boundaries, delete
            and redraw the proposal.
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
            placeholderTextColor="#6c7b73"
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
                {isBusy ? 'Saving…' : 'Save changes'}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.detailsSection}>
          <Text style={styles.detailLine}>
            Surface category: {SURFACE_LABELS[properties.surfaceType]} (
            {properties.surfaceType}) · Geodesic area:{' '}
            {properties.areaM2.toFixed(1)} m²
          </Text>
          <Text style={styles.noteBody}>
            {properties.note && properties.note.trim().length > 0
              ? properties.note
              : 'No additional site note provided.'}
          </Text>
        </View>
      )}

      <View style={styles.voteRow}>
        <Text style={styles.scoreSummary}>
          Net score: {properties.score >= 0 ? `+${properties.score}` : properties.score}{' '}
          (+{properties.upvotes} / -{properties.downvotes})
        </Text>

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
              -1 ({properties.downvotes})
            </Text>
          </Pressable>
        </View>
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
                  <Text style={styles.secondaryButtonLabel}>Keep proposal</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Confirm delete proposal"
                  disabled={isBusy}
                  onPress={handleConfirmDelete}
                  style={[styles.touchButton, styles.dangerButton]}
                >
                  <Text style={styles.primaryButtonLabel}>
                    {isBusy ? 'Deleting…' : 'Confirm delete'}
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
                <Text style={styles.secondaryButtonLabel}>Edit details</Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Delete proposal"
                disabled={isBusy}
                onPress={() => setConfirmingDelete(true)}
                style={[styles.touchButton, styles.dangerOutlineButton]}
              >
                <Text style={styles.dangerOutlineLabel}>Delete proposal</Text>
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
    borderRadius: 10,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cdd9d2',
    gap: 10,
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
    minWidth: 180,
    gap: 2,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1b2a22',
  },
  authorMeta: {
    fontSize: 12,
    color: '#46584f',
  },
  headerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  overlapButton: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#e8eef5',
    borderWidth: 1,
    borderColor: '#b8cae0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlapButtonLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1f3a5c',
  },
  singleBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#eff3f0',
  },
  singleBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4e6057',
  },
  closeButton: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#f1f5f3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1b2a22',
  },
  permanentDisclaimerBox: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#eef6f1',
    borderLeftWidth: 3,
    borderLeftColor: '#1f6f4a',
  },
  permanentDisclaimerText: {
    fontSize: 12,
    lineHeight: 17,
    color: '#20382b',
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
  detailsSection: {
    gap: 6,
  },
  detailLine: {
    fontSize: 12,
    fontWeight: '600',
    color: '#34473e',
  },
  noteBody: {
    fontSize: 14,
    lineHeight: 20,
    color: '#1b2a22',
  },
  editSection: {
    gap: 8,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#f8faf9',
  },
  immutableNotice: {
    fontSize: 12,
    lineHeight: 17,
    color: '#46584f',
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
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#b7c7be',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  surfaceChipSelected: {
    borderColor: '#1f6f4a',
    backgroundColor: '#e6f2ec',
  },
  surfaceChipLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1b2a22',
  },
  surfaceChipLabelSelected: {
    color: '#134c31',
  },
  editNoteInput: {
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
  voteRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    paddingTop: 4,
  },
  scoreSummary: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1b2a22',
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
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voteButton: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#b7c7be',
  },
  upvoteButtonActive: {
    backgroundColor: '#1f6f4a',
    borderColor: '#1f6f4a',
  },
  downvoteButtonActive: {
    backgroundColor: '#9e2a2b',
    borderColor: '#9e2a2b',
  },
  voteButtonLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1b2a22',
  },
  voteButtonLabelActive: {
    color: '#ffffff',
  },
  authorSection: {
    borderTopWidth: 1,
    borderTopColor: '#e3ebe6',
    paddingTop: 10,
  },
  deleteConfirmBox: {
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#fdecec',
    gap: 8,
  },
  deleteConfirmText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#8a1f1f',
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
  },
  primaryButton: {
    backgroundColor: '#1f6f4a',
  },
  primaryButtonLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  secondaryButton: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#b7c7be',
  },
  secondaryButtonLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1b2a22',
  },
  dangerOutlineButton: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#b53838',
  },
  dangerOutlineLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9c2222',
  },
  dangerButton: {
    backgroundColor: '#a62626',
  },
  abuseContactText: {
    fontSize: 11,
    color: '#52635a',
  },
});
