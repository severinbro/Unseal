import React from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import {
  DEFAULT_LOCALE,
  getTranslations,
  type Locale,
} from '../i18n/translations';
import { MIN_TOUCH_TARGET_DP } from '../state/viewModels';
import { PALETTE, RADII } from '../theme/tokens';

export interface GnssMapButtonProps {
  locale?: Locale;
  isLocating: boolean;
  onPress: () => void;
}

function GnssReticleGlyph(): React.JSX.Element {
  return (
    <View style={styles.glyphFrame} accessible={false}>
      <View style={[styles.tickVertical, styles.tickNorth]} />
      <View style={[styles.tickVertical, styles.tickSouth]} />
      <View style={[styles.tickHorizontal, styles.tickWest]} />
      <View style={[styles.tickHorizontal, styles.tickEast]} />
      <View style={styles.outerRing}>
        <View style={styles.centerDot} />
      </View>
    </View>
  );
}

export function GnssMapButton({
  locale = DEFAULT_LOCALE,
  isLocating,
  onPress,
}: GnssMapButtonProps): React.JSX.Element {
  const t = getTranslations(locale).controls;

  return (
    <Pressable
      testID="gnss-locate-button"
      accessibilityRole="button"
      accessibilityLabel={t.gnssA11y}
      accessibilityState={{ disabled: isLocating, busy: isLocating }}
      disabled={isLocating}
      onPress={onPress}
      style={({ pressed }) => [
        styles.floatingButton,
        pressed && !isLocating ? styles.floatingButtonPressed : null,
        isLocating ? styles.floatingButtonBusy : null,
      ]}
    >
      {isLocating ? (
        <ActivityIndicator size="small" color={PALETTE.accentPrimary} />
      ) : (
        <GnssReticleGlyph />
      )}
    </Pressable>
  );
}

const BUTTON_SIZE_DP = Math.max(48, MIN_TOUCH_TARGET_DP);

const styles = StyleSheet.create({
  floatingButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 25,
    width: BUTTON_SIZE_DP,
    height: BUTTON_SIZE_DP,
    borderRadius: RADII.pill,
    backgroundColor: PALETTE.bgSurface,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'web'
      ? {
          boxShadow: '0 3px 10px rgba(18, 32, 25, 0.18)',
        }
      : {
          shadowColor: '#122019',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.2,
          shadowRadius: 5,
          elevation: 5,
        }),
  },
  floatingButtonPressed: {
    backgroundColor: PALETTE.bgTinted,
    borderColor: PALETTE.accentPrimary,
  },
  floatingButtonBusy: {
    opacity: 0.85,
  },
  glyphFrame: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  outerRing: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: PALETTE.inkPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: PALETTE.accentPrimary,
  },
  tickVertical: {
    position: 'absolute',
    width: 2,
    height: 4,
    borderRadius: 1,
    backgroundColor: PALETTE.inkPrimary,
  },
  tickNorth: {
    top: 0,
    left: 11,
  },
  tickSouth: {
    bottom: 0,
    left: 11,
  },
  tickHorizontal: {
    position: 'absolute',
    width: 4,
    height: 2,
    borderRadius: 1,
    backgroundColor: PALETTE.inkPrimary,
  },
  tickWest: {
    left: 0,
    top: 11,
  },
  tickEast: {
    right: 0,
    top: 11,
  },
});
