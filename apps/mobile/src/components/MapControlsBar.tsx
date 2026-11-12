import React from 'react';
import {
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { BasemapMode } from '../state/appState';
import {
  MIN_TOUCH_TARGET_DP,
  type MapControlsModel,
} from '../state/viewModels';

interface WebAnchorElementLike {
  href: string;
  download: string;
  rel: string;
  style: { display: string };
  click(): void;
}

interface WebDocumentLike {
  createElement(tagName: 'a'): WebAnchorElementLike;
  body?: {
    appendChild(node: WebAnchorElementLike): void;
    removeChild(node: WebAnchorElementLike): void;
  } | null;
}

export async function triggerGeoJsonExportDownload(
  exportUrl: string,
): Promise<void> {
  if (Platform.OS === 'web') {
    const scope = globalThis as { document?: WebDocumentLike };
    const doc = scope.document;
    if (doc && typeof doc.createElement === 'function') {
      const anchor = doc.createElement('a');
      anchor.href = exportUrl;
      anchor.download = 'entsiegelung-proposals.geojson';
      anchor.rel = 'noopener noreferrer';
      anchor.style.display = 'none';
      if (doc.body) {
        doc.body.appendChild(anchor);
        try {
          anchor.click();
        } finally {
          doc.body.removeChild(anchor);
        }
      } else {
        anchor.click();
      }
      return;
    }
  }

  await Linking.openURL(exportUrl);
}

export interface MapControlsBarProps {
  controls: MapControlsModel;
  proposalCount: number;
  exportGeoJsonUrl: string;
  isLocating: boolean;
  onSetBasemapMode: (mode: BasemapMode) => void;
  onLocateMe: () => void;
  onStartDraw: () => void;
  onOpenAccount: () => void;
  onExportError: (message: string) => void;
}

export function MapControlsBar({
  controls,
  proposalCount,
  exportGeoJsonUrl,
  isLocating,
  onSetBasemapMode,
  onLocateMe,
  onStartDraw,
  onOpenAccount,
  onExportError,
}: MapControlsBarProps): React.JSX.Element {
  const nextBasemapMode: BasemapMode =
    controls.basemapMode === 'osm' ? 'orthophoto' : 'osm';

  const handleExportPress = (): void => {
    void triggerGeoJsonExportDownload(exportGeoJsonUrl).catch(
      (err: unknown) => {
        const detail =
          err instanceof Error && err.message.trim().length > 0
            ? err.message.trim()
            : 'Unable to open GeoJSON export URL.';
        onExportError(detail);
      },
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>Entsiegelungskartierung</Text>
          <Text style={styles.subtitle}>
            Basemap: {controls.basemapMode === 'orthophoto' ? 'Aerial Orthophoto' : 'Street Map (OSM)'} · Proposals in view: {proposalCount}
          </Text>
          {controls.basemapMode === 'orthophoto' &&
          controls.orthophotoAttribution &&
          controls.orthophotoAttribution.length > 0 ? (
            <Text style={styles.attributionText}>
              Imagery: {controls.orthophotoAttribution}
            </Text>
          ) : null}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            controls.isAuthenticated
              ? `Account settings for ${controls.accountLabel}`
              : 'Sign in or register pseudonymous account'
          }
          onPress={onOpenAccount}
          style={[
            styles.accountChip,
            controls.isAuthenticated ? styles.accountChipActive : null,
          ]}
        >
          <Text style={styles.accountChipLabel}>{controls.accountLabel}</Text>
        </Pressable>
      </View>

      <View style={styles.controlsRow}>
        {controls.showOrthophotoToggle ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              controls.basemapMode === 'osm'
                ? 'Switch to aerial orthophoto layer'
                : 'Switch to OpenStreetMap street layer'
            }
            accessibilityState={{
              selected: controls.basemapMode === 'orthophoto',
            }}
            onPress={() => onSetBasemapMode(nextBasemapMode)}
            style={[
              styles.controlButton,
              styles.secondaryButton,
              controls.basemapMode === 'orthophoto'
                ? styles.secondaryButtonSelected
                : null,
            ]}
          >
            <Text
              style={[
                styles.secondaryButtonLabel,
                controls.basemapMode === 'orthophoto'
                  ? styles.secondaryButtonLabelSelected
                  : null,
              ]}
            >
              {controls.basemapMode === 'osm'
                ? 'Show Orthophoto'
                : 'Show Street Map'}
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Locate me using device GPS"
          accessibilityState={{ disabled: isLocating, busy: isLocating }}
          disabled={isLocating}
          onPress={onLocateMe}
          style={[
            styles.controlButton,
            styles.secondaryButton,
            isLocating ? styles.buttonDisabled : null,
          ]}
        >
          <Text style={styles.secondaryButtonLabel}>
            {isLocating ? 'Locating…' : 'Locate me'}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Draw unsealing proposal polygon"
          accessibilityState={{ disabled: !controls.canStartDraw }}
          disabled={!controls.canStartDraw}
          onPress={onStartDraw}
          style={[
            styles.controlButton,
            styles.primaryButton,
            !controls.canStartDraw ? styles.primaryButtonDisabled : null,
          ]}
        >
          <Text style={styles.primaryButtonLabel}>Draw Proposal</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Export all proposals as GeoJSON"
          onPress={handleExportPress}
          style={[styles.controlButton, styles.secondaryButton]}
        >
          <Text style={styles.secondaryButtonLabel}>Export GeoJSON</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  titleBlock: {
    flex: 1,
    minWidth: 200,
    gap: 2,
  },
  title: {
    fontSize: 19,
    fontWeight: '700',
    color: '#1b2a22',
  },
  subtitle: {
    fontSize: 13,
    color: '#3c4a42',
  },
  attributionText: {
    fontSize: 11,
    color: '#52635a',
  },
  accountChip: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#1f6f4a',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountChipActive: {
    backgroundColor: '#e6f2ec',
  },
  accountChipLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#18573a',
  },
  controlsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  controlButton: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: '#1f6f4a',
  },
  primaryButtonDisabled: {
    backgroundColor: '#9ab5a8',
  },
  primaryButtonLabel: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#b7c7be',
  },
  secondaryButtonSelected: {
    backgroundColor: '#1d4f38',
    borderColor: '#1d4f38',
  },
  secondaryButtonLabel: {
    color: '#1b2a22',
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryButtonLabelSelected: {
    color: '#ffffff',
  },
  buttonDisabled: {
    opacity: 0.65,
  },
});
