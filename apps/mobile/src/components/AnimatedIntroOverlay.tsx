// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import { DEFAULT_APP_NAME, type BrandingConfig } from '@openunseal/shared';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { DEFAULT_LOCALE, getTranslations, type Locale } from '../i18n/translations';
import { MIN_TOUCH_TARGET_DP } from '../state/viewModels';
import { useTheme } from '../theme/themeContext';
import {
  MONO_FONT_FAMILY,
  RADII,
  type ThemePalette,
} from '../theme/tokens';

export interface AnimatedIntroOverlayProps {
  readonly locale?: Locale;
  readonly branding?: BrandingConfig | null | undefined;
  readonly onFinish: () => void;
}

interface ParticleSpec {
  readonly id: string;
  readonly dx: number;
  readonly dy: number;
  readonly size: number;
  readonly rotateDeg: string;
  readonly kind: 'emerald' | 'mineral';
}

const BURST_PARTICLES: readonly ParticleSpec[] = [
  { id: 'p1', dx: -36, dy: -34, size: 6, rotateDeg: '-35deg', kind: 'mineral' },
  { id: 'p2', dx: 38, dy: -30, size: 5.5, rotateDeg: '32deg', kind: 'mineral' },
  { id: 'p3', dx: -48, dy: -12, size: 5, rotateDeg: '-65deg', kind: 'emerald' },
  { id: 'p4', dx: 46, dy: -10, size: 5, rotateDeg: '60deg', kind: 'emerald' },
  { id: 'p5', dx: -20, dy: -50, size: 5.5, rotateDeg: '-22deg', kind: 'emerald' },
  { id: 'p6', dx: 22, dy: -48, size: 5, rotateDeg: '26deg', kind: 'mineral' },
];

const USE_NATIVE_DRIVER = Platform.OS !== 'web';
const REDUCED_MOTION_HOLD_MS = 650;
const EXIT_FADE_DURATION_MS = 340;
const PROGRESS_TRACK_WIDTH = 140;

function detectWebReducedMotion(): boolean {
  if (Platform.OS !== 'web') {
    return false;
  }
  try {
    const scope = globalThis as {
      window?: {
        matchMedia?: (query: string) => { matches?: boolean } | null;
      };
    };
    return scope.window?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  } catch {
    return false;
  }
}

function renderWebLogoSvg(
  size: number,
  children: React.ReactNode,
): React.ReactElement {
  return React.createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 64 64',
      fill: 'none',
      style: { display: 'block' },
    },
    children,
  );
}

export function AnimatedIntroOverlay({
  locale = DEFAULT_LOCALE,
  branding = null,
  onFinish,
}: AnimatedIntroOverlayProps): React.JSX.Element {
  const { palette, isDark } = useTheme();
  const { width, height } = useWindowDimensions();
  const isShortViewport = height < 520;
  const isCompact = isShortViewport || width < 420 || height < 680;
  const tileSize = isShortViewport ? 76 : isCompact ? 108 : 128;
  const styles = useMemo(
    () => createStyles(palette, isDark, isCompact, isShortViewport, tileSize),
    [palette, isDark, isCompact, isShortViewport, tileSize],
  );
  const t = getTranslations(locale).intro;
  const appName = branding?.appName?.trim() || DEFAULT_APP_NAME;
  const customSubtitle =
    (locale === 'en' ? branding?.subtitleEn : branding?.subtitleDe)?.trim() ||
    null;
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  const effectiveLogoUrl =
    branding?.logoUrl && branding.logoUrl !== failedLogoUrl
      ? branding.logoUrl
      : null;

  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const overlayScale = useRef(new Animated.Value(1)).current;
  const gridOpacity = useRef(new Animated.Value(0)).current;
  const tileProgress = useRef(new Animated.Value(0)).current;
  const bracketProgress = useRef(new Animated.Value(0)).current;
  const crackProgress = useRef(new Animated.Value(0)).current;
  const ring1Progress = useRef(new Animated.Value(0)).current;
  const ring2Progress = useRef(new Animated.Value(0)).current;
  const particleProgress = useRef(new Animated.Value(0)).current;
  const sproutProgress = useRef(new Animated.Value(0)).current;
  const leftLeafProgress = useRef(new Animated.Value(0)).current;
  const rightLeafProgress = useRef(new Animated.Value(0)).current;
  const brandProgress = useRef(new Animated.Value(0)).current;
  const progressSweep = useRef(new Animated.Value(0)).current;

  const [isClosing, setIsClosing] = useState(false);
  const finishedRef = useRef(false);
  const closingRef = useRef(false);
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  const runExitTransition = useCallback(
    (immediate = false): void => {
      if (finishedRef.current || closingRef.current) {
        return;
      }
      closingRef.current = true;
      setIsClosing(true);

      if (immediate) {
        finishedRef.current = true;
        onFinishRef.current();
        return;
      }

      Animated.parallel([
        Animated.timing(overlayOpacity, {
          toValue: 0,
          duration: EXIT_FADE_DURATION_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(overlayScale, {
          toValue: 1.03,
          duration: EXIT_FADE_DURATION_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
      ]).start(() => {
        if (!finishedRef.current) {
          finishedRef.current = true;
          onFinishRef.current();
        }
      });
    },
    [overlayOpacity, overlayScale],
  );

  useEffect(() => {
    let cancelled = false;
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let activeComposite: Animated.CompositeAnimation | null = null;

    const applyStaticFinalPose = (): void => {
      gridOpacity.setValue(1);
      tileProgress.setValue(1);
      bracketProgress.setValue(1);
      crackProgress.setValue(1);
      ring1Progress.setValue(1);
      ring2Progress.setValue(1);
      particleProgress.setValue(1);
      sproutProgress.setValue(1);
      leftLeafProgress.setValue(1);
      rightLeafProgress.setValue(1);
      brandProgress.setValue(1);
      progressSweep.setValue(1);
    };

    const startChoreography = async (): Promise<void> => {
      let reduceMotion = detectWebReducedMotion();
      if (!reduceMotion && Platform.OS !== 'web') {
        try {
          reduceMotion = await AccessibilityInfo.isReduceMotionEnabled();
        } catch {
          reduceMotion = false;
        }
      }

      if (cancelled || closingRef.current) {
        return;
      }

      if (reduceMotion) {
        applyStaticFinalPose();
        holdTimer = setTimeout(() => {
          if (!cancelled) {
            runExitTransition(false);
          }
        }, REDUCED_MOTION_HOLD_MS);
        return;
      }

      activeComposite = Animated.sequence([
        // Stage 1: Cartographic grid, parcel tile & surveyor brackets enter
        Animated.parallel([
          Animated.timing(gridOpacity, {
            toValue: 1,
            duration: 360,
            easing: Easing.out(Easing.quad),
            useNativeDriver: USE_NATIVE_DRIVER,
          }),
          Animated.spring(tileProgress, {
            toValue: 1,
            tension: 75,
            friction: 9,
            useNativeDriver: USE_NATIVE_DRIVER,
          }),
          Animated.timing(bracketProgress, {
            toValue: 1,
            duration: 400,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: USE_NATIVE_DRIVER,
          }),
          Animated.timing(progressSweep, {
            toValue: 0.25,
            duration: 400,
            easing: Easing.out(Easing.quad),
            useNativeDriver: USE_NATIVE_DRIVER,
          }),
        ]),

        // Stage 2 & 3: V-notch fractures open, curved stem rises, upward leaves unfurl into the OpenUnseal logo
        Animated.parallel([
          Animated.timing(crackProgress, {
            toValue: 1,
            duration: 500,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: USE_NATIVE_DRIVER,
          }),
          Animated.timing(ring1Progress, {
            toValue: 1,
            duration: 900,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: USE_NATIVE_DRIVER,
          }),
          Animated.sequence([
            Animated.delay(140),
            Animated.timing(ring2Progress, {
              toValue: 1,
              duration: 900,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: USE_NATIVE_DRIVER,
            }),
          ]),
          Animated.sequence([
            Animated.delay(80),
            Animated.timing(particleProgress, {
              toValue: 1,
              duration: 740,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: USE_NATIVE_DRIVER,
            }),
          ]),
          Animated.sequence([
            Animated.delay(150),
            Animated.spring(sproutProgress, {
              toValue: 1,
              tension: 66,
              friction: 8.5,
              useNativeDriver: USE_NATIVE_DRIVER,
            }),
          ]),
          Animated.sequence([
            Animated.delay(300),
            Animated.spring(leftLeafProgress, {
              toValue: 1,
              tension: 64,
              friction: 7.5,
              useNativeDriver: USE_NATIVE_DRIVER,
            }),
          ]),
          Animated.sequence([
            Animated.delay(390),
            Animated.spring(rightLeafProgress, {
              toValue: 1,
              tension: 62,
              friction: 7.5,
              useNativeDriver: USE_NATIVE_DRIVER,
            }),
          ]),
          Animated.sequence([
            Animated.delay(460),
            Animated.timing(brandProgress, {
              toValue: 1,
              duration: 540,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: USE_NATIVE_DRIVER,
            }),
          ]),
          Animated.timing(progressSweep, {
            toValue: 1,
            duration: 1120,
            easing: Easing.inOut(Easing.cubic),
            useNativeDriver: USE_NATIVE_DRIVER,
          }),
        ]),

        // Stage 4: Brief beat on the complete OpenUnseal mark before dissolving into the map
        Animated.delay(420),
      ]);

      activeComposite.start(({ finished }) => {
        if (finished && !cancelled) {
          runExitTransition(false);
        }
      });
    };

    void startChoreography();

    return () => {
      cancelled = true;
      if (holdTimer !== null) {
        clearTimeout(holdTimer);
      }
      activeComposite?.stop();
    };
  }, [
    bracketProgress,
    brandProgress,
    crackProgress,
    gridOpacity,
    leftLeafProgress,
    particleProgress,
    progressSweep,
    rightLeafProgress,
    ring1Progress,
    ring2Progress,
    runExitTransition,
    sproutProgress,
    tileProgress,
  ]);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      return;
    }
    const scope = globalThis as {
      window?: {
        addEventListener?: (
          type: 'keydown',
          listener: (event: { key?: string }) => void,
        ) => void;
        removeEventListener?: (
          type: 'keydown',
          listener: (event: { key?: string }) => void,
        ) => void;
      };
    };
    const handleKeyDown = (event: { key?: string }): void => {
      if (event.key === 'Escape') {
        runExitTransition(false);
      }
    };
    scope.window?.addEventListener?.('keydown', handleKeyDown);
    return () => {
      scope.window?.removeEventListener?.('keydown', handleKeyDown);
    };
  }, [runExitTransition]);

  // Derived interpolated transforms & opacities
  const tileScale = tileProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.84, 1],
  });

  const bracketInset = bracketProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [18, 0],
  });
  const bracketNegInset = bracketProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [-18, 0],
  });

  const ring1Scale = ring1Progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.38, 1.72],
  });
  const ring1Opacity = ring1Progress.interpolate({
    inputRange: [0, 0.25, 1],
    outputRange: [0, 0.55, 0],
  });

  const ring2Scale = ring2Progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.38, 1.54],
  });
  const ring2Opacity = ring2Progress.interpolate({
    inputRange: [0, 0.25, 1],
    outputRange: [0, 0.42, 0],
  });

  // Asphalt fracture wedge & seam glow
  const wedgeOpacity = crackProgress.interpolate({
    inputRange: [0, 0.22, 0.72, 1],
    outputRange: [1, 0.92, 0.25, 0],
  });
  const wedgeScale = crackProgress.interpolate({
    inputRange: [0, 0.35, 1],
    outputRange: [1, 0.86, 0.35],
  });
  const wedgeTranslateY = crackProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -tileSize * 0.14],
  });

  const crackBeamOpacity = crackProgress.interpolate({
    inputRange: [0, 0.25, 0.78, 1],
    outputRange: [0, 0.95, 0.35, 0],
  });
  const crackBeamScaleY = crackProgress.interpolate({
    inputRange: [0, 0.4, 1],
    outputRange: [0.2, 1.15, 0.9],
  });

  // Pivot math for Web SVG layers matching openunseal-icon.svg (64x64 viewBox)
  // Stem base: (31, 49) -> offset from center (32, 32)
  const stemPivotX = ((31 - 32) / 64) * tileSize;
  const stemPivotY = ((49 - 32) / 64) * tileSize;
  const stemScaleY = sproutProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.06, 1],
  });
  const stemOpacity = sproutProgress.interpolate({
    inputRange: [0, 0.12, 1],
    outputRange: [0, 1, 1],
  });

  // Left leaf attachment on stem: (31, 34)
  const leftLeafPivotX = ((31 - 32) / 64) * tileSize;
  const leftLeafPivotY = ((34 - 32) / 64) * tileSize;
  const leftLeafScale = leftLeafProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.08, 1],
  });
  const leftLeafRotate = leftLeafProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ['-34deg', '0deg'],
  });
  const leftLeafOpacity = leftLeafProgress.interpolate({
    inputRange: [0, 0.15, 1],
    outputRange: [0, 1, 1],
  });

  // Right leaf attachment on stem: (34, 26)
  const rightLeafPivotX = ((34 - 32) / 64) * tileSize;
  const rightLeafPivotY = ((26 - 32) / 64) * tileSize;
  const rightLeafScale = rightLeafProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.08, 1],
  });
  const rightLeafRotate = rightLeafProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ['36deg', '0deg'],
  });
  const rightLeafOpacity = rightLeafProgress.interpolate({
    inputRange: [0, 0.15, 1],
    outputRange: [0, 1, 1],
  });

  // Native fallback slab split & leaf transforms
  const nativeLeftSlabX = crackProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -tileSize * 0.08],
  });
  const nativeRightSlabX = crackProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, tileSize * 0.08],
  });
  const nativeStemTranslateY = sproutProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [tileSize * 0.24, 0],
  });
  const nativeLeftLeafRotate = leftLeafProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ['-22deg', '14deg'],
  });
  const nativeRightLeafRotate = rightLeafProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ['26deg', '-6deg'],
  });

  const titleTranslateY = brandProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [16, 0],
  });
  const subtitleTranslateY = brandProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [10, 0],
  });
  const ruleScaleX = brandProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.05, 1],
  });
  const progressTranslateX = progressSweep.interpolate({
    inputRange: [0, 1],
    outputRange: [-PROGRESS_TRACK_WIDTH / 2, 0],
  });

  const asphaltColor = isDark ? '#43504B' : '#5A6360';
  const stemColor = isDark ? palette.accentPrimaryStrong : '#176642';
  const leftLeafColor = isDark ? palette.accentPrimaryStrong : '#176642';
  const rightLeafColor = isDark ? palette.accentPrimary : '#1F7A4C';
  const tileFillColor = isDark ? palette.bgSurface : '#EFF3F0';

  return (
    <Animated.View
      testID="animated-intro-overlay"
      accessibilityLabel={t.overlayA11y}
      accessibilityViewIsModal
      pointerEvents={isClosing ? 'none' : 'auto'}
      style={[
        styles.overlayRoot,
        {
          opacity: overlayOpacity,
          transform: [{ scale: overlayScale }],
        },
      ]}
    >
      {/* Subtle 2D cartographic coordinate backdrop */}
      <Animated.View
        pointerEvents="none"
        style={[styles.gridBackdrop, { opacity: gridOpacity }]}
      >
        <View style={[styles.gridLineHorizontal, { top: '26%' }]} />
        <View style={[styles.gridLineHorizontal, { top: '50%' }]} />
        <View style={[styles.gridLineHorizontal, { top: '74%' }]} />
        <View style={[styles.gridLineVertical, { left: '24%' }]} />
        <View style={[styles.gridLineVertical, { left: '50%' }]} />
        <View style={[styles.gridLineVertical, { left: '76%' }]} />
        <View style={styles.dashedParcelBackdrop} />
      </Animated.View>

      <View style={styles.centerContent}>
        {/* 2D Animated Emblem Stage */}
        <View style={styles.stageBox}>
          {/* Expanding Cartographic Pulse Rings */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.pulseRing,
              {
                opacity: ring1Opacity,
                transform: [{ scale: ring1Scale }],
              },
            ]}
          />
          <Animated.View
            pointerEvents="none"
            style={[
              styles.pulseRingSecondary,
              {
                opacity: ring2Opacity,
                transform: [{ scale: ring2Scale }],
              },
            ]}
          />

          {/* 4 Surveyor Corner Reticle Brackets */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.bracketTopLeft,
              {
                opacity: bracketProgress,
                transform: [
                  { translateX: bracketNegInset },
                  { translateY: bracketNegInset },
                ],
              },
            ]}
          />
          <Animated.View
            pointerEvents="none"
            style={[
              styles.bracketTopRight,
              {
                opacity: bracketProgress,
                transform: [
                  { translateX: bracketInset },
                  { translateY: bracketNegInset },
                ],
              },
            ]}
          />
          <Animated.View
            pointerEvents="none"
            style={[
              styles.bracketBottomLeft,
              {
                opacity: bracketProgress,
                transform: [
                  { translateX: bracketNegInset },
                  { translateY: bracketInset },
                ],
              },
            ]}
          />
          <Animated.View
            pointerEvents="none"
            style={[
              styles.bracketBottomRight,
              {
                opacity: bracketProgress,
                transform: [
                  { translateX: bracketInset },
                  { translateY: bracketInset },
                ],
              },
            ]}
          />

          {/* 2D Geometric Burst Particles */}
          {BURST_PARTICLES.map((particle) => {
            const pX = particleProgress.interpolate({
              inputRange: [0, 1],
              outputRange: [0, isCompact ? particle.dx * 0.84 : particle.dx],
            });
            const pY = particleProgress.interpolate({
              inputRange: [0, 1],
              outputRange: [12, isCompact ? particle.dy * 0.84 : particle.dy],
            });
            const pOpacity = particleProgress.interpolate({
              inputRange: [0, 0.25, 0.8, 1],
              outputRange: [0, 0.95, 0.6, 0],
            });
            const pScale = particleProgress.interpolate({
              inputRange: [0, 0.4, 1],
              outputRange: [0.3, 1.15, 0.65],
            });
            return (
              <Animated.View
                key={particle.id}
                pointerEvents="none"
                style={[
                  styles.particleBase,
                  {
                    width: particle.size,
                    height: particle.size,
                    borderRadius: particle.kind === 'emerald' ? particle.size / 2 : 1.5,
                    backgroundColor:
                      particle.kind === 'emerald'
                        ? palette.positiveDot
                        : asphaltColor,
                    opacity: pOpacity,
                    transform: [
                      { translateX: pX },
                      { translateY: pY },
                      { scale: pScale },
                      { rotate: particle.rotateDeg },
                    ],
                  },
                ]}
              />
            );
          })}

          {/* Central Logo Tile */}
          <Animated.View
            style={[
              styles.parcelTile,
              {
                backgroundColor: tileFillColor,
                opacity: tileProgress,
                transform: [{ scale: tileScale }],
              },
            ]}
          >
            {effectiveLogoUrl ? (
              <View style={styles.customLogoWrap}>
                {Platform.OS === 'web' ? (
                  React.createElement('img', {
                    src: effectiveLogoUrl,
                    alt: '',
                    onError: () => setFailedLogoUrl(effectiveLogoUrl),
                    style: {
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      display: 'block',
                    },
                  })
                ) : (
                  <Image
                    source={{ uri: effectiveLogoUrl }}
                    style={styles.customLogoImage}
                    resizeMode="contain"
                    onError={() => setFailedLogoUrl(effectiveLogoUrl)}
                    accessibilityIgnoresInvertColors
                  />
                )}
              </View>
            ) : Platform.OS === 'web' ? (
              <View pointerEvents="none" style={styles.svgStack}>
                {/* Permanent V-notch asphalt base matching openunseal-icon.svg */}
                <View style={styles.svgLayer}>
                  {renderWebLogoSvg(
                    tileSize,
                    React.createElement('path', {
                      d: 'M0 40H26L31 50L37 40H64V64H0V40Z',
                      fill: asphaltColor,
                    }),
                  )}
                </View>

                {/* Sealed center asphalt wedge that fractures away on crack */}
                <Animated.View
                  style={[
                    styles.svgLayer,
                    {
                      opacity: wedgeOpacity,
                      transform: [
                        { translateY: wedgeTranslateY },
                        { scale: wedgeScale },
                      ],
                    },
                  ]}
                >
                  {renderWebLogoSvg(
                    tileSize,
                    React.createElement('path', {
                      d: 'M25.5 40H37.5L31 50.5Z',
                      fill: asphaltColor,
                    }),
                  )}
                </Animated.View>

                {/* Brief emerald fracture seam highlight */}
                <Animated.View
                  style={[
                    styles.crackBeam,
                    {
                      opacity: crackBeamOpacity,
                      transform: [{ scaleY: crackBeamScaleY }],
                    },
                  ]}
                />

                {/* Curved stem rising from inside the V-notch */}
                <Animated.View
                  style={[
                    styles.svgLayer,
                    {
                      opacity: stemOpacity,
                      transform: [
                        { translateX: stemPivotX },
                        { translateY: stemPivotY },
                        { scaleY: stemScaleY },
                        { translateX: -stemPivotX },
                        { translateY: -stemPivotY },
                      ],
                    },
                  ]}
                >
                  {renderWebLogoSvg(
                    tileSize,
                    React.createElement('path', {
                      d: 'M31 49C31 38 32 30 37 22',
                      fill: 'none',
                      stroke: stemColor,
                      strokeWidth: 4,
                      strokeLinecap: 'round',
                    }),
                  )}
                </Animated.View>

                {/* Left leaf sweeping upward-left from stem */}
                <Animated.View
                  style={[
                    styles.svgLayer,
                    {
                      opacity: leftLeafOpacity,
                      transform: [
                        { translateX: leftLeafPivotX },
                        { translateY: leftLeafPivotY },
                        { rotate: leftLeafRotate },
                        { scale: leftLeafScale },
                        { translateX: -leftLeafPivotX },
                        { translateY: -leftLeafPivotY },
                      ],
                    },
                  ]}
                >
                  {renderWebLogoSvg(
                    tileSize,
                    React.createElement('path', {
                      d: 'M31 34C29 27 22 25 18 26C19 31 25 35 31 34Z',
                      fill: leftLeafColor,
                    }),
                  )}
                </Animated.View>

                {/* Primary crown leaf sweeping upward-right from stem */}
                <Animated.View
                  style={[
                    styles.svgLayer,
                    {
                      opacity: rightLeafOpacity,
                      transform: [
                        { translateX: rightLeafPivotX },
                        { translateY: rightLeafPivotY },
                        { rotate: rightLeafRotate },
                        { scale: rightLeafScale },
                        { translateX: -rightLeafPivotX },
                        { translateY: -rightLeafPivotY },
                      ],
                    },
                  ]}
                >
                  {renderWebLogoSvg(
                    tileSize,
                    React.createElement('path', {
                      d: 'M34 26C35 16 44 13 49 15C48 22 42 27 34 26Z',
                      fill: rightLeafColor,
                    }),
                  )}
                </Animated.View>
              </View>
            ) : (
              /* Native RN fallback matching the same upward-leaf & V-notch silhouette */
              <>
                <Animated.View
                  style={[
                    styles.crackBeam,
                    {
                      opacity: crackBeamOpacity,
                      transform: [{ scaleY: crackBeamScaleY }],
                    },
                  ]}
                />

                <View pointerEvents="none" style={styles.nativeSproutGroup}>
                  <Animated.View
                    style={[
                      styles.nativeLeftLeaf,
                      {
                        backgroundColor: leftLeafColor,
                        opacity: leftLeafOpacity,
                        transform: [
                          { rotate: nativeLeftLeafRotate },
                          { scale: leftLeafScale },
                        ],
                      },
                    ]}
                  />
                  <Animated.View
                    style={[
                      styles.nativeRightLeaf,
                      {
                        backgroundColor: rightLeafColor,
                        opacity: rightLeafOpacity,
                        transform: [
                          { rotate: nativeRightLeafRotate },
                          { scale: rightLeafScale },
                        ],
                      },
                    ]}
                  />
                  <Animated.View
                    style={[
                      styles.nativeSproutStem,
                      {
                        backgroundColor: stemColor,
                        opacity: stemOpacity,
                        transform: [
                          { translateY: nativeStemTranslateY },
                          { rotate: '9deg' },
                          { scaleY: stemScaleY },
                        ],
                      },
                    ]}
                  />
                </View>

                <View pointerEvents="none" style={styles.nativeSlabsBand}>
                  <Animated.View
                    style={[
                      styles.nativeSlabLeft,
                      {
                        backgroundColor: asphaltColor,
                        transform: [{ translateX: nativeLeftSlabX }],
                      },
                    ]}
                  />
                  <Animated.View
                    style={[
                      styles.nativeSlabRight,
                      {
                        backgroundColor: asphaltColor,
                        transform: [{ translateX: nativeRightSlabX }],
                      },
                    ]}
                  />
                </View>
              </>
            )}
          </Animated.View>
        </View>

        {/* Wordmark & Civic Cartography Tagline */}
        <View style={styles.brandBlock}>
          <Animated.Text
            style={[
              styles.brandTitle,
              {
                opacity: brandProgress,
                transform: [{ translateY: titleTranslateY }],
              },
            ]}
          >
            {appName}
          </Animated.Text>

          <Animated.View
            style={[
              styles.accentRule,
              {
                opacity: brandProgress,
                transform: [{ scaleX: ruleScaleX }],
              },
            ]}
          />

          <Animated.Text
            style={[
              styles.brandSubtitle,
              {
                opacity: brandProgress,
                transform: [{ translateY: subtitleTranslateY }],
              },
            ]}
          >
            {customSubtitle ?? t.subtitle}
          </Animated.Text>

          <Animated.View
            style={[
              styles.taglinePill,
              {
                opacity: brandProgress,
                transform: [{ translateY: subtitleTranslateY }],
              },
            ]}
          >
            <View style={styles.taglineDot} />
            <Text style={styles.taglineText}>{t.tagline}</Text>
          </Animated.View>
        </View>
      </View>

      {/* Bottom Progress Bar & Accessible Skip Action */}
      <View style={styles.footerControls}>
        <View style={styles.progressTrack}>
          <Animated.View
            style={[
              styles.progressFill,
              {
                transform: [
                  { translateX: progressTranslateX },
                  { scaleX: progressSweep },
                ],
              },
            ]}
          />
        </View>

        <Pressable
          testID="intro-skip-button"
          accessibilityRole="button"
          accessibilityLabel={t.skipA11y}
          onPress={() => runExitTransition(false)}
          style={({ pressed }) => [
            styles.skipButton,
            pressed ? styles.skipButtonPressed : null,
          ]}
        >
          <Text style={styles.skipButtonLabel}>{t.skipButton}</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

function createStyles(
  PALETTE: ThemePalette,
  isDark: boolean,
  isCompact: boolean,
  isShortViewport: boolean,
  tileSize: number,
) {
  const stageSize = isShortViewport ? 104 : isCompact ? 162 : 192;
  const slabHeight = Math.round(tileSize * (24 / 64));

  return StyleSheet.create({
    overlayRoot: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      zIndex: 120,
      backgroundColor: PALETTE.bgGround,
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: isShortViewport ? 16 : 24,
      paddingTop: isShortViewport ? 14 : isCompact ? 42 : 56,
      paddingBottom: isShortViewport ? 14 : isCompact ? 28 : 40,
      overflow: 'hidden',
    },
    gridBackdrop: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    gridLineHorizontal: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: 1,
      backgroundColor: PALETTE.borderSubtle,
      opacity: isDark ? 0.45 : 0.65,
    },
    gridLineVertical: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      width: 1,
      backgroundColor: PALETTE.borderSubtle,
      opacity: isDark ? 0.45 : 0.65,
    },
    dashedParcelBackdrop: {
      width: isCompact ? 260 : 340,
      height: isCompact ? 260 : 340,
      borderRadius: 42,
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: PALETTE.borderAccent,
      opacity: isDark ? 0.26 : 0.38,
      transform: [{ rotate: '12deg' }],
    },
    centerContent: {
      flex: 1,
      width: '100%',
      alignItems: 'center',
      justifyContent: 'center',
    },
    stageBox: {
      width: stageSize,
      height: stageSize,
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
    },
    pulseRing: {
      position: 'absolute',
      width: tileSize,
      height: tileSize,
      borderRadius: tileSize / 2,
      borderWidth: 2,
      borderColor: PALETTE.accentPrimary,
    },
    pulseRingSecondary: {
      position: 'absolute',
      width: tileSize,
      height: tileSize,
      borderRadius: tileSize / 2,
      borderWidth: 1.5,
      borderColor: PALETTE.positiveDot,
    },
    bracketTopLeft: {
      position: 'absolute',
      top: 8,
      left: 8,
      width: 18,
      height: 18,
      borderTopWidth: 2.5,
      borderLeftWidth: 2.5,
      borderColor: PALETTE.accentPrimary,
      borderTopLeftRadius: 5,
    },
    bracketTopRight: {
      position: 'absolute',
      top: 8,
      right: 8,
      width: 18,
      height: 18,
      borderTopWidth: 2.5,
      borderRightWidth: 2.5,
      borderColor: PALETTE.accentPrimary,
      borderTopRightRadius: 5,
    },
    bracketBottomLeft: {
      position: 'absolute',
      bottom: 8,
      left: 8,
      width: 18,
      height: 18,
      borderBottomWidth: 2.5,
      borderLeftWidth: 2.5,
      borderColor: PALETTE.accentPrimary,
      borderBottomLeftRadius: 5,
    },
    bracketBottomRight: {
      position: 'absolute',
      bottom: 8,
      right: 8,
      width: 18,
      height: 18,
      borderBottomWidth: 2.5,
      borderRightWidth: 2.5,
      borderColor: PALETTE.accentPrimary,
      borderBottomRightRadius: 5,
    },
    particleBase: {
      position: 'absolute',
    },
    parcelTile: {
      width: tileSize,
      height: tileSize,
      borderRadius: Math.round(tileSize * (14 / 64)),
      borderWidth: 2,
      borderBottomWidth: 5,
      borderColor: PALETTE.borderStrong,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'flex-end',
      position: 'relative',
      ...(Platform.OS === 'web'
        ? {
            boxShadow: isDark
              ? '0 6px 0 rgba(0, 0, 0, 0.5)'
              : '0 6px 0 rgba(17, 31, 24, 0.16)',
          }
        : {
            shadowColor: isDark ? '#000000' : '#122019',
            shadowOffset: { width: 0, height: 6 },
            shadowOpacity: isDark ? 0.45 : 0.16,
            shadowRadius: 4,
            elevation: 8,
          }),
    },
    svgStack: {
      position: 'relative',
      width: tileSize,
      height: tileSize,
    },
    customLogoWrap: {
      width: tileSize,
      height: tileSize,
      padding: Math.round(tileSize * 0.14),
      alignItems: 'center',
      justifyContent: 'center',
    },
    customLogoImage: {
      width: '100%',
      height: '100%',
    },
    svgLayer: {
      position: 'absolute',
      top: 0,
      left: 0,
      width: tileSize,
      height: tileSize,
    },
    crackBeam: {
      position: 'absolute',
      left: tileSize * (31 / 64) - 1.5,
      bottom: tileSize * (14 / 64),
      width: 3,
      height: tileSize * 0.28,
      borderRadius: 2,
      backgroundColor: PALETTE.accentPrimary,
    },
    nativeSproutGroup: {
      position: 'absolute',
      top: 0,
      left: 0,
      width: tileSize,
      height: tileSize,
    },
    nativeSproutStem: {
      position: 'absolute',
      left: tileSize * (32 / 64) - 4,
      bottom: tileSize * (14 / 64),
      width: isCompact ? 6.5 : 8,
      height: tileSize * (28 / 64),
      borderRadius: 4,
    },
    nativeLeftLeaf: {
      position: 'absolute',
      left: tileSize * (17 / 64),
      top: tileSize * (24 / 64),
      width: tileSize * (15 / 64),
      height: tileSize * (10 / 64),
      borderTopRightRadius: 24,
      borderBottomLeftRadius: 24,
      borderTopLeftRadius: 2,
      borderBottomRightRadius: 2,
    },
    nativeRightLeaf: {
      position: 'absolute',
      left: tileSize * (33 / 64),
      top: tileSize * (13 / 64),
      width: tileSize * (18 / 64),
      height: tileSize * (13 / 64),
      borderTopLeftRadius: 28,
      borderBottomRightRadius: 28,
      borderTopRightRadius: 2,
      borderBottomLeftRadius: 2,
    },
    nativeSlabsBand: {
      width: tileSize + 8,
      height: slabHeight,
      flexDirection: 'row',
      alignItems: 'stretch',
      justifyContent: 'center',
    },
    nativeSlabLeft: {
      flex: 1,
      height: slabHeight,
      borderTopRightRadius: 3,
    },
    nativeSlabRight: {
      flex: 1,
      height: slabHeight,
      borderTopLeftRadius: 3,
    },
    brandBlock: {
      marginTop: isShortViewport ? 8 : isCompact ? 22 : 28,
      alignItems: 'center',
      width: '100%',
      maxWidth: 360,
    },
    brandTitle: {
      fontSize: isShortViewport ? 22 : isCompact ? 30 : 36,
      fontWeight: '800',
      letterSpacing: isShortViewport ? 0.8 : 1.4,
      color: PALETTE.inkPrimary,
      textAlign: 'center',
    },
    accentRule: {
      marginTop: isShortViewport ? 6 : 10,
      width: 56,
      height: 3,
      borderRadius: 2,
      backgroundColor: PALETTE.accentPrimary,
    },
    brandSubtitle: {
      marginTop: isShortViewport ? 6 : 10,
      fontSize: isShortViewport ? 13 : isCompact ? 14 : 15.5,
      fontWeight: '600',
      color: PALETTE.inkSecondary,
      textAlign: 'center',
      letterSpacing: 0.2,
    },
    taglinePill: {
      marginTop: isShortViewport ? 8 : 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      maxWidth: '100%',
      paddingHorizontal: 13,
      paddingVertical: isShortViewport ? 4 : 6,
      borderRadius: RADII.sm,
      backgroundColor: PALETTE.bgTinted,
      borderWidth: 1.5,
      borderBottomWidth: 2.5,
      borderColor: PALETTE.positiveBorder,
    },
    taglineDot: {
      width: 7,
      height: 7,
      flexShrink: 0,
      borderRadius: 1.5,
      backgroundColor: PALETTE.positiveDot,
    },
    taglineText: {
      fontFamily: Platform.OS === 'web' ? undefined : MONO_FONT_FAMILY,
      fontSize: 12,
      fontWeight: '700',
      color: PALETTE.positiveText,
      textAlign: 'center',
      flexShrink: 1,
    },
    footerControls: {
      width: '100%',
      maxWidth: 320,
      alignItems: 'center',
      gap: isShortViewport ? 8 : 14,
    },
    progressTrack: {
      width: PROGRESS_TRACK_WIDTH,
      height: 3,
      borderRadius: 1,
      backgroundColor: PALETTE.borderSubtle,
      overflow: 'hidden',
    },
    progressFill: {
      width: '100%',
      height: '100%',
      borderRadius: 1,
      backgroundColor: PALETTE.accentPrimary,
    },
    skipButton: {
      minHeight: MIN_TOUCH_TARGET_DP,
      minWidth: 132,
      paddingHorizontal: 20,
      paddingVertical: 10,
      borderRadius: RADII.md,
      backgroundColor: PALETTE.bgSurface,
      borderWidth: 1.5,
      borderBottomWidth: 3.5,
      borderColor: PALETTE.borderStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    skipButtonPressed: {
      backgroundColor: PALETTE.bgTinted,
      borderColor: PALETTE.accentPrimary,
      transform: [{ translateY: 1.5 }],
      borderBottomWidth: 2,
    },
    skipButtonLabel: {
      fontSize: 13.5,
      fontWeight: '800',
      color: PALETTE.inkPrimary,
    },
  });
}
