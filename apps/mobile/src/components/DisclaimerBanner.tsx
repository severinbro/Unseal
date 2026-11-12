import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  MIN_TOUCH_TARGET_DP,
  type MapControlsModel,
} from '../state/viewModels';

export interface DisclaimerBannerProps {
  controls: MapControlsModel;
  bboxFeatureLimit: number;
  locationNotice: string | null;
  onDismissDisclaimer: () => void;
  onDismissTileWarning: () => void;
  onDismissLocationNotice: () => void;
}

export function DisclaimerBanner({
  controls,
  bboxFeatureLimit,
  locationNotice,
  onDismissDisclaimer,
  onDismissTileWarning,
  onDismissLocationNotice,
}: DisclaimerBannerProps): React.JSX.Element | null {
  const showDisclaimer =
    controls.showFirstVisitDisclaimer &&
    controls.disclaimerText !== null &&
    controls.disclaimerText.length > 0;
  const showTileWarning =
    controls.tileWarning !== null && controls.tileWarning.length > 0;
  const showLocationNotice =
    locationNotice !== null && locationNotice.length > 0;
  const showZoomPrompt = controls.showZoomInPrompt;
  const showTruncated = controls.showTruncatedNotice;

  if (
    !showDisclaimer &&
    !showTileWarning &&
    !showLocationNotice &&
    !showZoomPrompt &&
    !showTruncated
  ) {
    return null;
  }

  return (
    <View style={styles.stackContainer}>
      {showDisclaimer ? (
        <View
          style={styles.disclaimerBanner}
          accessibilityRole="alert"
          accessibilityLabel="Public participation disclaimer"
        >
          <Text style={styles.disclaimerText}>{controls.disclaimerText}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss disclaimer"
            onPress={onDismissDisclaimer}
            style={styles.dismissButton}
          >
            <Text style={styles.dismissButtonLabel}>Dismiss</Text>
          </Pressable>
        </View>
      ) : null}

      {showTileWarning ? (
        <View
          style={styles.warningBanner}
          accessibilityRole="alert"
          accessibilityLabel="Orthophoto tile warning"
        >
          <Text style={styles.warningText}>{controls.tileWarning}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss tile warning"
            onPress={onDismissTileWarning}
            style={styles.warningDismissButton}
          >
            <Text style={styles.warningDismissLabel}>OK</Text>
          </Pressable>
        </View>
      ) : null}

      {showLocationNotice ? (
        <View
          style={styles.warningBanner}
          accessibilityRole="alert"
          accessibilityLabel="GPS location notice"
        >
          <Text style={styles.warningText}>{locationNotice}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss location notice"
            onPress={onDismissLocationNotice}
            style={styles.warningDismissButton}
          >
            <Text style={styles.warningDismissLabel}>OK</Text>
          </Pressable>
        </View>
      ) : null}

      {showZoomPrompt ? (
        <View
          style={styles.infoBanner}
          accessibilityRole="summary"
          accessibilityLabel={controls.zoomInPromptText}
        >
          <Text style={styles.infoText}>{controls.zoomInPromptText}</Text>
        </View>
      ) : null}

      {showTruncated ? (
        <View
          style={styles.truncatedBanner}
          accessibilityRole="summary"
          accessibilityLabel="Viewport proposal limit notice"
        >
          <Text style={styles.truncatedText}>
            Showing top {bboxFeatureLimit} highest-rated proposals in this map
            view. Zoom in further to inspect additional proposals.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stackContainer: {
    gap: 6,
  },
  disclaimerBanner: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#e6f2ec',
    borderBottomWidth: 1,
    borderBottomColor: '#c5ded1',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  disclaimerText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: '#1b2a22',
  },
  dismissButton: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#1f6f4a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissButtonLabel: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  warningBanner: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#fff4df',
    borderBottomWidth: 1,
    borderBottomColor: '#eed39b',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: '#5f3d00',
  },
  warningDismissButton: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#7a4f00',
    alignItems: 'center',
    justifyContent: 'center',
  },
  warningDismissLabel: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  infoBanner: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#e8eef5',
    borderBottomWidth: 1,
    borderBottomColor: '#c7d5e6',
  },
  infoText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1f3a5c',
  },
  truncatedBanner: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#eef2eb',
    borderBottomWidth: 1,
    borderBottomColor: '#cfd9c8',
  },
  truncatedText: {
    fontSize: 12,
    lineHeight: 17,
    color: '#2d3f28',
  },
});
