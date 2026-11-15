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
import { computeNorthArrowRotationDeg } from '../map/types';
import { MIN_TOUCH_TARGET_DP } from '../state/viewModels';
import { PALETTE, RADII } from '../theme/tokens';

const NORTH_NEEDLE_COLOR = '#D93025';
const SOUTH_NEEDLE_COLOR = '#8A9790';

export interface GnssMapButtonProps {
  locale?: Locale;
  isLocating: boolean;
  onPress: () => void;
  positioned?: boolean;
}

export interface NorthArrowButtonProps {
  locale?: Locale;
  bearingDeg: number;
  onPress: () => void;
  positioned?: boolean;
}

export interface SearchMapButtonProps {
  locale?: Locale;
  onPress: () => void;
  positioned?: boolean;
}

export interface TopRightMapControlsProps {
  children: React.ReactNode;
}

export function TopRightMapControls({
  children,
}: TopRightMapControlsProps): React.JSX.Element {
  return (
    <View
      pointerEvents="box-none"
      style={styles.topRightControlsContainer}
      testID="top-right-map-controls"
    >
      {children}
    </View>
  );
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

function NorthArrowGlyph({
  rotationDeg,
}: {
  rotationDeg: number;
}): React.JSX.Element {
  if (Platform.OS === 'web') {
    return (
      <View
        style={[
          styles.glyphFrame,
          { transform: [{ rotate: `${rotationDeg}deg` }] },
        ]}
        accessible={false}
      >
        {React.createElement(
          'svg',
          {
            width: 24,
            height: 24,
            viewBox: '0 0 24 24',
            fill: 'none',
            'aria-hidden': true,
          },
          React.createElement('path', {
            d: 'M12 2L16.5 12H7.5L12 2Z',
            fill: NORTH_NEEDLE_COLOR,
          }),
          React.createElement('path', {
            d: 'M12 22L16.5 12H7.5L12 22Z',
            fill: SOUTH_NEEDLE_COLOR,
          }),
          React.createElement('circle', {
            cx: 12,
            cy: 12,
            r: 1.5,
            fill: '#FFFFFF',
          }),
        )}
      </View>
    );
  }

  return (
    <View
      style={[
        styles.glyphFrame,
        { transform: [{ rotate: `${rotationDeg}deg` }] },
      ]}
      accessible={false}
    >
      <View style={styles.needleNorth} />
      <View style={styles.needleSouth} />
      <View style={styles.needlePivot} />
    </View>
  );
}

export function GnssMapButton({
  locale = DEFAULT_LOCALE,
  isLocating,
  onPress,
  positioned = true,
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
        positioned ? styles.floatingButtonPositioned : null,
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

export function NorthArrowButton({
  locale = DEFAULT_LOCALE,
  bearingDeg,
  onPress,
  positioned = false,
}: NorthArrowButtonProps): React.JSX.Element {
  const t = getTranslations(locale).controls;
  const rotationDeg = computeNorthArrowRotationDeg(bearingDeg);

  return (
    <Pressable
      testID="north-arrow-button"
      accessibilityRole="button"
      accessibilityLabel={t.northA11y}
      onPress={onPress}
      style={({ pressed }) => [
        styles.floatingButton,
        positioned ? styles.floatingButtonPositioned : null,
        pressed ? styles.floatingButtonPressed : null,
      ]}
    >
      <NorthArrowGlyph rotationDeg={rotationDeg} />
    </Pressable>
  );
}

function SearchMagnifierGlyph(): React.JSX.Element {
  if (Platform.OS === 'web') {
    return (
      <View style={styles.glyphFrame} accessible={false}>
        {React.createElement(
          'svg',
          {
            width: 20,
            height: 20,
            viewBox: '0 0 24 24',
            fill: 'none',
            'aria-hidden': true,
          },
          React.createElement('circle', {
            cx: 11,
            cy: 11,
            r: 6.5,
            stroke: PALETTE.inkPrimary,
            strokeWidth: 2.2,
          }),
          React.createElement('path', {
            d: 'M16 16L20.5 20.5',
            stroke: PALETTE.accentPrimary,
            strokeWidth: 2.4,
            strokeLinecap: 'round',
          }),
        )}
      </View>
    );
  }

  return (
    <View style={styles.glyphFrame} accessible={false}>
      <View style={styles.searchLensRing} />
      <View style={styles.searchHandleBar} />
    </View>
  );
}

export function SearchMapButton({
  locale = DEFAULT_LOCALE,
  onPress,
  positioned = false,
}: SearchMapButtonProps): React.JSX.Element {
  const t = getTranslations(locale).controls;

  return (
    <Pressable
      testID="address-search-button"
      accessibilityRole="button"
      accessibilityLabel={t.searchAddressA11y}
      onPress={onPress}
      style={({ pressed }) => [
        styles.floatingButton,
        positioned ? styles.floatingButtonPositioned : null,
        pressed ? styles.floatingButtonPressed : null,
      ]}
    >
      <SearchMagnifierGlyph />
    </Pressable>
  );
}

const BUTTON_SIZE_DP = Math.max(48, MIN_TOUCH_TARGET_DP);

const styles = StyleSheet.create({
  topRightControlsContainer: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 25,
    gap: 8,
    alignItems: 'center',
  },
  floatingButton: {
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
  floatingButtonPositioned: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 25,
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
  needleNorth: {
    width: 0,
    height: 0,
    borderLeftWidth: 4.5,
    borderRightWidth: 4.5,
    borderBottomWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: NORTH_NEEDLE_COLOR,
  },
  needleSouth: {
    width: 0,
    height: 0,
    borderLeftWidth: 4.5,
    borderRightWidth: 4.5,
    borderTopWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: SOUTH_NEEDLE_COLOR,
  },
  needlePivot: {
    position: 'absolute',
    top: 10.5,
    left: 10.5,
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#FFFFFF',
  },
  searchLensRing: {
    position: 'absolute',
    top: 3,
    left: 3,
    width: 13,
    height: 13,
    borderRadius: 6.5,
    borderWidth: 2.2,
    borderColor: PALETTE.inkPrimary,
  },
  searchHandleBar: {
    position: 'absolute',
    bottom: 4.5,
    right: 2.5,
    width: 7,
    height: 2.4,
    borderRadius: 1.2,
    backgroundColor: PALETTE.accentPrimary,
    transform: [{ rotate: '45deg' }],
  },
});
