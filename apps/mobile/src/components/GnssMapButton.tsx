// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import React, { useMemo } from 'react';
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
import { useTheme } from '../theme/themeContext';
import { RADII, type ThemePalette } from '../theme/tokens';

const NORTH_NEEDLE_COLOR = '#EF4444';
const SOUTH_NEEDLE_LIGHT = '#8A9790';
const SOUTH_NEEDLE_DARK = '#A6B8B0';

export interface GnssMapButtonProps {
  locale?: Locale;
  isLocating: boolean;
  onPress: () => void;
  positioned?: boolean;
  compactSize?: boolean;
}

export interface NorthArrowButtonProps {
  locale?: Locale;
  bearingDeg: number;
  onPress: () => void;
  positioned?: boolean;
  compactSize?: boolean;
}

export interface SearchMapButtonProps {
  locale?: Locale;
  onPress: () => void;
  positioned?: boolean;
  compactSize?: boolean;
}

export interface MapLayersButtonProps {
  locale?: Locale;
  active?: boolean;
  expanded?: boolean;
  onPress: () => void;
  positioned?: boolean;
  compactSize?: boolean;
}

export interface TopRightMapControlsProps {
  children: React.ReactNode;
  horizontal?: boolean;
}

export function TopRightMapControls({
  children,
  horizontal = false,
}: TopRightMapControlsProps): React.JSX.Element {
  const { palette, isDark } = useTheme();
  const styles = useMemo(() => createStyles(palette, isDark), [palette, isDark]);
  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.topRightControlsContainer,
        horizontal ? styles.topRightControlsHorizontal : null,
      ]}
      testID="top-right-map-controls"
    >
      {children}
    </View>
  );
}

function GnssReticleGlyph({
  styles,
}: {
  styles: ReturnType<typeof createStyles>;
}): React.JSX.Element {
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
  isDark,
  styles,
}: {
  rotationDeg: number;
  isDark: boolean;
  styles: ReturnType<typeof createStyles>;
}): React.JSX.Element {
  const southColor = isDark ? SOUTH_NEEDLE_DARK : SOUTH_NEEDLE_LIGHT;

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
            fill: southColor,
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
  compactSize = false,
}: GnssMapButtonProps): React.JSX.Element {
  const { palette, isDark } = useTheme();
  const styles = useMemo(() => createStyles(palette, isDark), [palette, isDark]);
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
        compactSize ? styles.floatingButtonCompactSize : null,
        positioned ? styles.floatingButtonPositioned : null,
        pressed && !isLocating ? styles.floatingButtonPressed : null,
        isLocating ? styles.floatingButtonBusy : null,
      ]}
    >
      {isLocating ? (
        <ActivityIndicator size="small" color={palette.accentPrimary} />
      ) : (
        <GnssReticleGlyph styles={styles} />
      )}
    </Pressable>
  );
}

export function NorthArrowButton({
  locale = DEFAULT_LOCALE,
  bearingDeg,
  onPress,
  positioned = false,
  compactSize = false,
}: NorthArrowButtonProps): React.JSX.Element {
  const { palette, isDark } = useTheme();
  const styles = useMemo(() => createStyles(palette, isDark), [palette, isDark]);
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
        compactSize ? styles.floatingButtonCompactSize : null,
        positioned ? styles.floatingButtonPositioned : null,
        pressed ? styles.floatingButtonPressed : null,
      ]}
    >
      <NorthArrowGlyph
        rotationDeg={rotationDeg}
        isDark={isDark}
        styles={styles}
      />
    </Pressable>
  );
}

function SearchMagnifierGlyph({
  palette,
  styles,
}: {
  palette: ThemePalette;
  styles: ReturnType<typeof createStyles>;
}): React.JSX.Element {
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
            stroke: palette.inkPrimary,
            strokeWidth: 2.2,
          }),
          React.createElement('path', {
            d: 'M16 16L20.5 20.5',
            stroke: palette.accentPrimary,
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
  compactSize = false,
}: SearchMapButtonProps): React.JSX.Element {
  const { palette, isDark } = useTheme();
  const styles = useMemo(() => createStyles(palette, isDark), [palette, isDark]);
  const t = getTranslations(locale).controls;

  return (
    <Pressable
      testID="address-search-button"
      accessibilityRole="button"
      accessibilityLabel={t.searchAddressA11y}
      onPress={onPress}
      style={({ pressed }) => [
        styles.floatingButton,
        compactSize ? styles.floatingButtonCompactSize : null,
        positioned ? styles.floatingButtonPositioned : null,
        pressed ? styles.floatingButtonPressed : null,
      ]}
    >
      <SearchMagnifierGlyph palette={palette} styles={styles} />
    </Pressable>
  );
}

function LayersDiamondGlyph({
  active,
  palette,
  styles,
}: {
  active: boolean;
  palette: ThemePalette;
  styles: ReturnType<typeof createStyles>;
}): React.JSX.Element {
  const strokeColor = active ? palette.accentPrimary : palette.inkPrimary;
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
          React.createElement('path', {
            d: 'M12 3.5L21 8.5L12 13.5L3 8.5L12 3.5Z',
            stroke: strokeColor,
            strokeWidth: 2,
            strokeLinejoin: 'round',
          }),
          React.createElement('path', {
            d: 'M3 13.2L12 18.2L21 13.2',
            stroke: strokeColor,
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }),
          React.createElement('path', {
            d: 'M3 17.5L12 22.5L21 17.5',
            stroke: palette.accentPrimary,
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }),
        )}
      </View>
    );
  }

  return (
    <View style={styles.glyphFrame} accessible={false}>
      <View
        style={[
          styles.layersDiamondTop,
          { borderColor: strokeColor },
        ]}
      />
      <View
        style={[
          styles.layersDiamondBottom,
          { borderColor: palette.accentPrimary },
        ]}
      />
    </View>
  );
}

export function MapLayersButton({
  locale = DEFAULT_LOCALE,
  active = false,
  expanded = false,
  onPress,
  positioned = false,
  compactSize = false,
}: MapLayersButtonProps): React.JSX.Element {
  const { palette, isDark } = useTheme();
  const styles = useMemo(() => createStyles(palette, isDark), [palette, isDark]);
  const t = getTranslations(locale).controls;

  const buttonNode = (
    <Pressable
      testID="map-layers-button"
      accessibilityRole="button"
      accessibilityLabel={t.layersButtonA11y}
      accessibilityState={{ selected: active, expanded }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.floatingButton,
        compactSize ? styles.floatingButtonCompactSize : null,
        positioned ? styles.floatingButtonPositioned : null,
        active || expanded ? styles.floatingButtonActive : null,
        pressed ? styles.floatingButtonPressed : null,
      ]}
    >
      <LayersDiamondGlyph active={active || expanded} palette={palette} styles={styles} />
    </Pressable>
  );

  if (Platform.OS === 'web') {
    return React.createElement(
      'div',
      { title: t.layersButtonTooltip, style: { display: 'inline-flex' } },
      buttonNode,
    );
  }
  return buttonNode;
}

const BUTTON_SIZE_DP = Math.max(48, MIN_TOUCH_TARGET_DP);

function createStyles(PALETTE: ThemePalette, isDark: boolean) {
  return StyleSheet.create({
    topRightControlsContainer: {
      position: 'absolute',
      top: 12,
      right: 12,
      zIndex: 25,
      gap: 8,
      alignItems: 'center',
    },
    topRightControlsHorizontal: {
      top: 10,
      right: 10,
      flexDirection: 'row',
      gap: 6,
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
            boxShadow: isDark
              ? '0 3px 12px rgba(0, 0, 0, 0.45)'
              : '0 3px 10px rgba(18, 32, 25, 0.18)',
          }
        : {
            shadowColor: isDark ? '#000000' : '#122019',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: isDark ? 0.42 : 0.2,
            shadowRadius: 5,
            elevation: 5,
          }),
    },
    floatingButtonCompactSize: {
      width: MIN_TOUCH_TARGET_DP,
      height: MIN_TOUCH_TARGET_DP,
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
    floatingButtonActive: {
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
      borderTopColor: isDark ? SOUTH_NEEDLE_DARK : SOUTH_NEEDLE_LIGHT,
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
    layersDiamondTop: {
      position: 'absolute',
      top: 4,
      left: 6,
      width: 12,
      height: 12,
      borderWidth: 2,
      borderRadius: 2,
      transform: [{ rotate: '45deg' }],
    },
    layersDiamondBottom: {
      position: 'absolute',
      top: 9,
      left: 6,
      width: 12,
      height: 12,
      borderBottomWidth: 2,
      borderRightWidth: 2,
      borderRadius: 2,
      transform: [{ rotate: '45deg' }],
    },
  });
}
