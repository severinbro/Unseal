import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
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
  { id: 'p1', dx: -44, dy: -38, size: 7, rotateDeg: '-40deg', kind: 'emerald' },
  { id: 'p2', dx: 46, dy: -34, size: 6, rotateDeg: '35deg', kind: 'emerald' },
  { id: 'p3', dx: -56, dy: -10, size: 5, rotateDeg: '-70deg', kind: 'mineral' },
  { id: 'p4', dx: 54, dy: -8, size: 5, rotateDeg: '65deg', kind: 'mineral' },
  { id: 'p5', dx: -24, dy: -56, size: 6, rotateDeg: '-25deg', kind: 'emerald' },
  { id: 'p6', dx: 26, dy: -54, size: 5, rotateDeg: '28deg', kind: 'mineral' },
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

export function AnimatedIntroOverlay({
  locale = DEFAULT_LOCALE,
  onFinish,
}: AnimatedIntroOverlayProps): React.JSX.Element {
  const { palette, isDark } = useTheme();
  const { width, height } = useWindowDimensions();
  const isCompact = width < 420 || height < 680;
  const styles = useMemo(
    () => createStyles(palette, isDark, isCompact),
    [palette, isDark, isCompact],
  );
  const t = getTranslations(locale).intro;

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
            duration: 380,
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
            duration: 420,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: USE_NATIVE_DRIVER,
          }),
          Animated.timing(progressSweep, {
            toValue: 0.25,
            duration: 420,
            easing: Easing.out(Easing.quad),
            useNativeDriver: USE_NATIVE_DRIVER,
          }),
        ]),

        // Stage 2 & 3: Asphalt slabs crack open, radar rings pulse, particles burst, sprout & leaves unfurl
        Animated.parallel([
          Animated.timing(crackProgress, {
            toValue: 1,
            duration: 540,
            easing: Easing.out(Easing.back(1.35)),
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
            Animated.delay(60),
            Animated.timing(particleProgress, {
              toValue: 1,
              duration: 760,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: USE_NATIVE_DRIVER,
            }),
          ]),
          Animated.sequence([
            Animated.delay(160),
            Animated.spring(sproutProgress, {
              toValue: 1,
              tension: 68,
              friction: 8,
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
            Animated.delay(380),
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
              duration: 560,
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

        // Stage 4: Short settling beat before revealing the live map
        Animated.delay(380),
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

  const leftSlabX = crackProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, isCompact ? -15 : -19],
  });
  const leftSlabY = crackProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 5],
  });
  const leftSlabRotate = crackProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '-13deg'],
  });

  const rightSlabX = crackProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, isCompact ? 15 : 19],
  });
  const rightSlabY = crackProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 5],
  });
  const rightSlabRotate = crackProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '13deg'],
  });

  const crackBeamOpacity = crackProgress.interpolate({
    inputRange: [0, 0.28, 0.85, 1],
    outputRange: [0, 0.95, 0.35, 0],
  });
  const crackBeamScaleY = crackProgress.interpolate({
    inputRange: [0, 0.4, 1],
    outputRange: [0.2, 1.15, 0.9],
  });

  const soilGlowOpacity = crackProgress.interpolate({
    inputRange: [0, 0.4, 1],
    outputRange: [0, 0.85, 1],
  });
  const soilGlowScale = crackProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 1],
  });

  const stemScaleY = sproutProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.08, 1],
  });
  const stemTranslateY = sproutProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [22, 0],
  });

  const leftLeafScale = leftLeafProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.15, 1],
  });
  const leftLeafTranslateX = leftLeafProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [10, 0],
  });
  const leftLeafTranslateY = leftLeafProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [8, 0],
  });
  const leftLeafRotate = leftLeafProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ['-64deg', '-26deg'],
  });

  const rightLeafScale = rightLeafProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.15, 1],
  });
  const rightLeafTranslateX = rightLeafProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [-12, 0],
  });
  const rightLeafTranslateY = rightLeafProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [10, 0],
  });
  const rightLeafRotate = rightLeafProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ['64deg', '24deg'],
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
                        : palette.inkMuted,
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

          {/* Central Unseal Parcel Tile */}
          <Animated.View
            style={[
              styles.parcelTile,
              {
                opacity: tileProgress,
                transform: [{ scale: tileScale }],
              },
            ]}
          >
            {/* Living Soil / Permeable Botanical Glow Revealed Beneath Asphalt */}
            <Animated.View
              style={[
                styles.soilGlow,
                {
                  opacity: soilGlowOpacity,
                  transform: [{ scale: soilGlowScale }],
                },
              ]}
            />

            {/* Luminous Fracture Seam Flash */}
            <Animated.View
              style={[
                styles.crackBeam,
                {
                  opacity: crackBeamOpacity,
                  transform: [{ scaleY: crackBeamScaleY }],
                },
              ]}
            />

            {/* Botanical Sprout: Stem + Two Unfurling Leaves */}
            <View pointerEvents="none" style={styles.sproutGroup}>
              <Animated.View
                style={[
                  styles.leftLeaf,
                  {
                    opacity: leftLeafProgress,
                    transform: [
                      { translateX: leftLeafTranslateX },
                      { translateY: leftLeafTranslateY },
                      { rotate: leftLeafRotate },
                      { scale: leftLeafScale },
                    ],
                  },
                ]}
              >
                <View style={styles.leafVeinLeft} />
              </Animated.View>

              <Animated.View
                style={[
                  styles.rightLeaf,
                  {
                    opacity: rightLeafProgress,
                    transform: [
                      { translateX: rightLeafTranslateX },
                      { translateY: rightLeafTranslateY },
                      { rotate: rightLeafRotate },
                      { scale: rightLeafScale },
                    ],
                  },
                ]}
              >
                <View style={styles.leafVeinRight} />
              </Animated.View>

              <Animated.View
                style={[
                  styles.sproutStem,
                  {
                    opacity: sproutProgress,
                    transform: [
                      { translateY: stemTranslateY },
                      { scaleY: stemScaleY },
                    ],
                  },
                ]}
              />
            </View>

            {/* Left & Right Sealed Asphalt/Concrete Slabs that Crack Apart */}
            <View pointerEvents="none" style={styles.slabsBand}>
              <Animated.View
                style={[
                  styles.slabLeft,
                  {
                    transform: [
                      { translateX: leftSlabX },
                      { translateY: leftSlabY },
                      { rotate: leftSlabRotate },
                    ],
                  },
                ]}
              >
                <View style={styles.slabHighlight} />
                <View style={styles.slabSpeckleOne} />
                <View style={styles.slabSpeckleTwo} />
              </Animated.View>
              <Animated.View
                style={[
                  styles.slabRight,
                  {
                    transform: [
                      { translateX: rightSlabX },
                      { translateY: rightSlabY },
                      { rotate: rightSlabRotate },
                    ],
                  },
                ]}
              >
                <View style={styles.slabHighlight} />
                <View style={styles.slabSpeckleRight} />
              </Animated.View>
            </View>
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
            {t.title}
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
            {t.subtitle}
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
) {
  const stageSize = isCompact ? 156 : 186;
  const tileSize = isCompact ? 104 : 122;
  const slabHeight = isCompact ? 34 : 40;
  const slabColor = isDark ? '#3E4B47' : '#4C5653';
  const slabHighlightColor = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.22)';
  const slabSpeckleColor = isDark ? 'rgba(15, 22, 19, 0.45)' : 'rgba(18, 32, 25, 0.25)';

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
      paddingHorizontal: 24,
      paddingTop: isCompact ? 42 : 56,
      paddingBottom: isCompact ? 28 : 40,
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
      borderRadius: isCompact ? 24 : 28,
      backgroundColor: PALETTE.bgSurface,
      borderWidth: 1.5,
      borderColor: PALETTE.borderStrong,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'flex-end',
      ...(Platform.OS === 'web'
        ? {
            boxShadow: isDark
              ? '0 16px 38px rgba(0, 0, 0, 0.55)'
              : '0 16px 36px rgba(18, 32, 25, 0.14)',
          }
        : {
            shadowColor: isDark ? '#000000' : '#122019',
            shadowOffset: { width: 0, height: 10 },
            shadowOpacity: isDark ? 0.45 : 0.16,
            shadowRadius: 18,
            elevation: 10,
          }),
    },
    soilGlow: {
      position: 'absolute',
      bottom: -14,
      width: tileSize * 0.72,
      height: tileSize * 0.54,
      borderRadius: tileSize * 0.36,
      backgroundColor: PALETTE.bgTinted,
      borderWidth: 1,
      borderColor: PALETTE.borderAccent,
    },
    crackBeam: {
      position: 'absolute',
      bottom: 8,
      width: 4,
      height: tileSize * 0.44,
      borderRadius: 2,
      backgroundColor: PALETTE.accentPrimary,
    },
    sproutGroup: {
      position: 'absolute',
      bottom: isCompact ? 16 : 20,
      width: tileSize,
      height: tileSize * 0.68,
      alignItems: 'center',
      justifyContent: 'flex-end',
    },
    sproutStem: {
      width: isCompact ? 6 : 7,
      height: isCompact ? 42 : 50,
      borderRadius: 4,
      backgroundColor: PALETTE.accentPrimary,
    },
    leftLeaf: {
      position: 'absolute',
      bottom: isCompact ? 19 : 23,
      left: isCompact ? 20 : 24,
      width: isCompact ? 28 : 34,
      height: isCompact ? 18 : 21,
      backgroundColor: PALETTE.accentPrimaryStrong,
      borderTopLeftRadius: 22,
      borderBottomRightRadius: 22,
      borderTopRightRadius: 4,
      borderBottomLeftRadius: 4,
      justifyContent: 'center',
      alignItems: 'center',
    },
    rightLeaf: {
      position: 'absolute',
      bottom: isCompact ? 28 : 34,
      right: isCompact ? 16 : 20,
      width: isCompact ? 34 : 40,
      height: isCompact ? 21 : 24,
      backgroundColor: PALETTE.positiveDot,
      borderTopRightRadius: 24,
      borderBottomLeftRadius: 24,
      borderTopLeftRadius: 4,
      borderBottomRightRadius: 4,
      justifyContent: 'center',
      alignItems: 'center',
    },
    leafVeinLeft: {
      width: '62%',
      height: 1.5,
      borderRadius: 1,
      backgroundColor: 'rgba(255, 255, 255, 0.34)',
      transform: [{ rotate: '14deg' }],
    },
    leafVeinRight: {
      width: '64%',
      height: 1.5,
      borderRadius: 1,
      backgroundColor: 'rgba(255, 255, 255, 0.38)',
      transform: [{ rotate: '-14deg' }],
    },
    slabsBand: {
      width: tileSize + 8,
      height: slabHeight,
      flexDirection: 'row',
      alignItems: 'stretch',
      justifyContent: 'center',
    },
    slabLeft: {
      flex: 1,
      height: slabHeight,
      backgroundColor: slabColor,
      borderTopRightRadius: 4,
      borderRightWidth: 1,
      borderRightColor: 'rgba(0,0,0,0.18)',
      overflow: 'hidden',
    },
    slabRight: {
      flex: 1,
      height: slabHeight,
      backgroundColor: slabColor,
      borderTopLeftRadius: 4,
      borderLeftWidth: 1,
      borderLeftColor: 'rgba(255,255,255,0.08)',
      overflow: 'hidden',
    },
    slabHighlight: {
      height: 2,
      width: '100%',
      backgroundColor: slabHighlightColor,
    },
    slabSpeckleOne: {
      position: 'absolute',
      top: 11,
      left: 14,
      width: 5,
      height: 3,
      borderRadius: 1.5,
      backgroundColor: slabSpeckleColor,
    },
    slabSpeckleTwo: {
      position: 'absolute',
      top: 20,
      left: 30,
      width: 4,
      height: 4,
      borderRadius: 2,
      backgroundColor: slabSpeckleColor,
    },
    slabSpeckleRight: {
      position: 'absolute',
      top: 14,
      right: 18,
      width: 6,
      height: 3,
      borderRadius: 1.5,
      backgroundColor: slabSpeckleColor,
    },
    brandBlock: {
      marginTop: isCompact ? 22 : 28,
      alignItems: 'center',
      maxWidth: 360,
    },
    brandTitle: {
      fontSize: isCompact ? 30 : 36,
      fontWeight: '800',
      letterSpacing: 1.4,
      color: PALETTE.inkPrimary,
    },
    accentRule: {
      marginTop: 10,
      width: 56,
      height: 3,
      borderRadius: 2,
      backgroundColor: PALETTE.accentPrimary,
    },
    brandSubtitle: {
      marginTop: 10,
      fontSize: isCompact ? 14 : 15.5,
      fontWeight: '600',
      color: PALETTE.inkSecondary,
      textAlign: 'center',
      letterSpacing: 0.2,
    },
    taglinePill: {
      marginTop: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      paddingHorizontal: 13,
      paddingVertical: 6,
      borderRadius: RADII.pill,
      backgroundColor: PALETTE.bgTinted,
      borderWidth: 1,
      borderColor: PALETTE.borderAccent,
    },
    taglineDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: PALETTE.positiveDot,
    },
    taglineText: {
      fontFamily: Platform.OS === 'web' ? undefined : MONO_FONT_FAMILY,
      fontSize: 12,
      fontWeight: '600',
      color: PALETTE.positiveText,
      textAlign: 'center',
    },
    footerControls: {
      width: '100%',
      maxWidth: 320,
      alignItems: 'center',
      gap: 14,
    },
    progressTrack: {
      width: PROGRESS_TRACK_WIDTH,
      height: 3,
      borderRadius: 2,
      backgroundColor: PALETTE.borderSubtle,
      overflow: 'hidden',
    },
    progressFill: {
      width: '100%',
      height: '100%',
      borderRadius: 2,
      backgroundColor: PALETTE.accentPrimary,
    },
    skipButton: {
      minHeight: MIN_TOUCH_TARGET_DP,
      minWidth: 124,
      paddingHorizontal: 20,
      paddingVertical: 10,
      borderRadius: RADII.pill,
      backgroundColor: PALETTE.bgSurface,
      borderWidth: 1,
      borderColor: PALETTE.borderStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    skipButtonPressed: {
      backgroundColor: PALETTE.bgTinted,
      borderColor: PALETTE.borderAccent,
    },
    skipButtonLabel: {
      fontSize: 13.5,
      fontWeight: '700',
      color: PALETTE.inkSecondary,
    },
  });
}
