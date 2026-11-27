// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import {
  DEFAULT_APP_NAME,
  type BrandingConfig,
  type PolygonFilter,
} from '@openunseal/shared';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  getTranslations,
  localizeError,
  type Locale,
} from '../i18n/translations';
import { getSocialCopy } from '../i18n/social';
import { clampPolygonOpacity } from '../map/styleBuilder';
import type { BasemapMode } from '../state/appState';
import {
  deriveNavbarLayoutMode,
  MIN_TOUCH_TARGET_DP,
  type MapControlsModel,
} from '../state/viewModels';
import { useTheme } from '../theme/themeContext';
import { ChatGlyph, FeedGlyph, MapGlyph, UserGlyph } from './NavGlyphs';
import { withWebTooltip } from './webTooltip';
import {
  RADII,
  TABULAR_NUMS_STYLE,
  type ThemePalette,
  type ViewportTier,
} from '../theme/tokens';

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

export async function triggerFileDownload(
  downloadUrl: string,
  filename: string,
): Promise<void> {
  if (Platform.OS === 'web') {
    const scope = globalThis as { document?: WebDocumentLike };
    const doc = scope.document;
    if (doc && typeof doc.createElement === 'function') {
      const anchor = doc.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = filename;
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

  await Linking.openURL(downloadUrl);
}

export async function triggerGeoJsonExportDownload(
  exportUrl: string,
): Promise<void> {
  await triggerFileDownload(exportUrl, 'entsiegelung-proposals.geojson');
}

export interface MapControlsBarProps {
  controls: MapControlsModel;
  proposalCount: number;
  exportGeoJsonUrl: string;
  branding?: BrandingConfig | null | undefined;
  isImporting?: boolean;
  tier?: ViewportTier;
  viewportWidth?: number;
  moreMenuOpen?: boolean;
  onToggleMoreMenu?: () => void;
  onOpenSearch?: () => void;
  onToggleLocale?: () => void;
  onToggleTheme?: () => void;
  onOpenAbout?: () => void;
  onOpenStats?: () => void;
  onOpenBugReport?: () => void;
  onOpenInstallApp?: () => void;
  onSetBasemapMode: (mode: BasemapMode) => void;
  onSetPolygonOpacity?: (opacity: number) => void;
  onSetPolygonFilter?: (filter: PolygonFilter) => void;
  onToggleHighlightMine?: () => void;
  onStartDraw: () => void;
  onOpenAccount: () => void;
  onImportPress?: () => void;
  onExportError: (message: string) => void;
  /** Which of the main views is shown; the icons for them sit in the navbar. */
  activeMainTab?: 'map' | 'feed';
  unreadChats?: number;
  onSelectMainTab?: (tab: 'map' | 'feed') => void;
  onOpenChat?: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const OPENUNSEAL_HEADER_LOGO = require('../../assets/header-logo.png') as number;

export function InstallAppGlyph({
  color,
  size = 20,
}: {
  color?: string;
  eyeColor?: string;
  size?: number;
}): React.JSX.Element {
  const { palette } = useTheme();
  const resolvedColor = color ?? palette.accentPrimary;

  if (Platform.OS === 'web') {
    return React.createElement(
      'svg',
      {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        'aria-hidden': 'true',
        style: {
          flexShrink: 0,
          display: 'block',
        },
      },
      React.createElement('rect', {
        x: '6.5',
        y: '2.5',
        width: '11',
        height: '19',
        rx: '2.4',
        stroke: resolvedColor,
        strokeWidth: '1.8',
      }),
      React.createElement('path', {
        d: 'M12 7.5V14.5M9.5 12L12 14.5L14.5 12',
        stroke: resolvedColor,
        strokeWidth: '1.8',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
      React.createElement('path', {
        d: 'M10.5 18.2H13.5',
        stroke: resolvedColor,
        strokeWidth: '1.8',
        strokeLinecap: 'round',
      }),
    );
  }

  return (
    <View
      accessible={false}
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          width: Math.round(size * 0.56),
          height: Math.round(size * 0.84),
          borderRadius: 3,
          borderWidth: 1.8,
          borderColor: resolvedColor,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: 2,
            height: Math.round(size * 0.34),
            borderRadius: 1,
            backgroundColor: resolvedColor,
          }}
        />
      </View>
    </View>
  );
}

export function BugGlyph({
  color,
  size = 18,
}: {
  color?: string;
  size?: number;
}): React.JSX.Element {
  const { palette } = useTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const resolvedColor = color ?? palette.inkSecondary;

  if (Platform.OS === 'web') {
    return React.createElement(
      'svg',
      {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        'aria-hidden': 'true',
        style: {
          flexShrink: 0,
          display: 'block',
        },
      },
      React.createElement('path', {
        d: 'M9 7.5L7.2 5.2M15 7.5L16.8 5.2',
        stroke: resolvedColor,
        strokeWidth: '1.8',
        strokeLinecap: 'round',
      }),
      React.createElement('path', {
        d: 'M9 9C9 7.343 10.343 6 12 6C13.657 6 15 7.343 15 9V10H9V9Z',
        fill: resolvedColor,
      }),
      React.createElement('rect', {
        x: '7.5',
        y: '9.8',
        width: '9',
        height: '10.2',
        rx: '4.5',
        stroke: resolvedColor,
        strokeWidth: '1.8',
      }),
      React.createElement('path', {
        d: 'M12 10.2V19.6M4 11.5H7.4M16.6 11.5H20M3.5 15H7.3M16.7 15H20.5M4.5 18.5L7.8 17.2M19.5 18.5L16.2 17.2',
        stroke: resolvedColor,
        strokeWidth: '1.7',
        strokeLinecap: 'round',
      }),
    );
  }

  return (
    <View
      accessible={false}
      style={[styles.bugFallbackFrame, { width: size, height: size }]}
    >
      <View
        style={[styles.bugFallbackHead, { backgroundColor: resolvedColor }]}
      />
      <View style={[styles.bugFallbackBody, { borderColor: resolvedColor }]}>
        <View
          style={[styles.bugFallbackSeam, { backgroundColor: resolvedColor }]}
        />
      </View>
      <View style={[styles.bugFallbackLegRow, styles.bugFallbackLegTop]}>
        <View
          style={[styles.bugFallbackLeg, { backgroundColor: resolvedColor }]}
        />
        <View
          style={[styles.bugFallbackLeg, { backgroundColor: resolvedColor }]}
        />
      </View>
      <View style={[styles.bugFallbackLegRow, styles.bugFallbackLegBottom]}>
        <View
          style={[styles.bugFallbackLeg, { backgroundColor: resolvedColor }]}
        />
        <View
          style={[styles.bugFallbackLeg, { backgroundColor: resolvedColor }]}
        />
      </View>
    </View>
  );
}

export function ThemeModeGlyph({
  isDark,
  color,
  size = 18,
}: {
  isDark: boolean;
  color?: string;
  size?: number;
}): React.JSX.Element {
  const { palette } = useTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const resolvedColor = color ?? palette.inkPrimary;

  if (Platform.OS === 'web') {
    if (isDark) {
      return React.createElement(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': 'true',
          style: { flexShrink: 0, display: 'block' },
        },
        React.createElement('circle', {
          cx: '12',
          cy: '12',
          r: '4.4',
          stroke: resolvedColor,
          strokeWidth: '1.9',
        }),
        React.createElement('path', {
          d: 'M12 2.8V5.1M12 18.9V21.2M21.2 12H18.9M5.1 12H2.8M18.5 5.5L16.9 7.1M7.1 16.9L5.5 18.5M18.5 18.5L16.9 16.9M7.1 7.1L5.5 5.5',
          stroke: resolvedColor,
          strokeWidth: '1.9',
          strokeLinecap: 'round',
        }),
      );
    }

    return React.createElement(
      'svg',
      {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        'aria-hidden': 'true',
        style: { flexShrink: 0, display: 'block' },
      },
      React.createElement('path', {
        d: 'M20.2 14.4A8.2 8.2 0 0 1 9.6 3.8a8.2 8.2 0 1 0 10.6 10.6Z',
        stroke: resolvedColor,
        strokeWidth: '1.9',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
    );
  }

  return (
    <View
      accessible={false}
      style={[styles.themeGlyphFrame, { width: size, height: size }]}
    >
      {isDark ? (
        <View
          style={[
            styles.sunFallbackCore,
            { borderColor: resolvedColor },
          ]}
        />
      ) : (
        <View
          style={[
            styles.moonFallbackCrescent,
            { borderColor: resolvedColor },
          ]}
        />
      )}
    </View>
  );
}

export function StatsGlyph({
  color,
  size = 18,
}: {
  color?: string;
  size?: number;
}): React.JSX.Element {
  const { palette } = useTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const resolvedColor = color ?? palette.inkPrimary;

  if (Platform.OS === 'web') {
    return React.createElement(
      'svg',
      {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        'aria-hidden': 'true',
        style: { flexShrink: 0, display: 'block' },
      },
      React.createElement('path', {
        d: 'M5 19.5V13.5M12 19.5V6.5M19 19.5V10',
        stroke: resolvedColor,
        strokeWidth: '2.2',
        strokeLinecap: 'round',
      }),
      React.createElement('path', {
        d: 'M3.5 19.5H20.5',
        stroke: resolvedColor,
        strokeWidth: '1.8',
        strokeLinecap: 'round',
      }),
    );
  }

  return (
    <View
      accessible={false}
      style={[styles.statsGlyphFrame, { width: size, height: size }]}
    >
      <View
        style={[
          styles.statsGlyphBar,
          { height: Math.round(size * 0.36), backgroundColor: resolvedColor },
        ]}
      />
      <View
        style={[
          styles.statsGlyphBar,
          { height: Math.round(size * 0.72), backgroundColor: resolvedColor },
        ]}
      />
      <View
        style={[
          styles.statsGlyphBar,
          { height: Math.round(size * 0.54), backgroundColor: resolvedColor },
        ]}
      />
    </View>
  );
}

export function ExportGlyph({
  color,
  size = 20,
}: {
  color?: string;
  size?: number;
}): React.JSX.Element {
  const { palette } = useTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const resolvedColor = color ?? palette.inkPrimary;

  if (Platform.OS === 'web') {
    return React.createElement(
      'svg',
      {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        'aria-hidden': 'true',
        style: {
          flexShrink: 0,
          display: 'block',
        },
      },
      React.createElement('path', {
        d: 'M12 3.75V15.25',
        stroke: resolvedColor,
        strokeWidth: '1.9',
        strokeLinecap: 'round',
      }),
      React.createElement('path', {
        d: 'M7.5 10.75L12 15.25L16.5 10.75',
        stroke: resolvedColor,
        strokeWidth: '1.9',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
      React.createElement('path', {
        d: 'M4.5 16.5V18.5C4.5 19.605 5.395 20.5 6.5 20.5H17.5C18.605 20.5 19.5 19.605 19.5 18.5V16.5',
        stroke: resolvedColor,
        strokeWidth: '1.9',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
    );
  }

  return (
    <View
      accessible={false}
      style={[styles.trayGlyphFrame, { width: size, height: size }]}
    >
      <View
        style={[styles.trayGlyphShaft, { backgroundColor: resolvedColor }]}
      />
      <View
        style={[
          styles.trayGlyphChevronDown,
          {
            borderBottomColor: resolvedColor,
            borderRightColor: resolvedColor,
          },
        ]}
      />
      <View style={[styles.trayGlyphBase, { borderColor: resolvedColor }]} />
    </View>
  );
}

export function ImportGlyph({
  color,
  size = 20,
}: {
  color?: string;
  size?: number;
}): React.JSX.Element {
  const { palette } = useTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const resolvedColor = color ?? palette.finishedText;

  if (Platform.OS === 'web') {
    return React.createElement(
      'svg',
      {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        'aria-hidden': 'true',
        style: {
          flexShrink: 0,
          display: 'block',
        },
      },
      React.createElement('path', {
        d: 'M12 15.25V3.75',
        stroke: resolvedColor,
        strokeWidth: '1.9',
        strokeLinecap: 'round',
      }),
      React.createElement('path', {
        d: 'M7.5 8.25L12 3.75L16.5 8.25',
        stroke: resolvedColor,
        strokeWidth: '1.9',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
      React.createElement('path', {
        d: 'M4.5 16.5V18.5C4.5 19.605 5.395 20.5 6.5 20.5H17.5C18.605 20.5 19.5 19.605 19.5 18.5V16.5',
        stroke: resolvedColor,
        strokeWidth: '1.9',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
    );
  }

  return (
    <View
      accessible={false}
      style={[styles.trayGlyphFrame, { width: size, height: size }]}
    >
      <View
        style={[
          styles.trayGlyphChevronUp,
          { borderTopColor: resolvedColor, borderLeftColor: resolvedColor },
        ]}
      />
      <View
        style={[
          styles.trayGlyphShaft,
          styles.trayGlyphShaftUp,
          { backgroundColor: resolvedColor },
        ]}
      />
      <View style={[styles.trayGlyphBase, { borderColor: resolvedColor }]} />
    </View>
  );
}

function PolygonOpacitySlider({
  opacity,
  compact,
  label,
  accessibilityLabel,
  onChange,
}: {
  opacity: number;
  compact: boolean;
  label: string;
  accessibilityLabel: string;
  onChange?: (nextOpacity: number) => void;
}): React.JSX.Element {
  const { palette } = useTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const clamped = clampPolygonOpacity(opacity);
  const percent = Math.round(clamped * 100);
  const trackWidthRef = React.useRef<number>(compact ? 76 : 96);

  const updateFromOffsetX = (locationX: number): void => {
    if (!onChange) {
      return;
    }
    const width = Math.max(1, trackWidthRef.current);
    const ratio = clampPolygonOpacity(locationX / width);
    onChange(Math.round(ratio * 100) / 100);
  };

  return (
    <View
      testID="polygon-opacity-control"
      style={[
        styles.opacityPill,
        compact ? styles.opacityPillCompact : null,
      ]}
    >
      <Text
        numberOfLines={1}
        style={[
          styles.filterChipLabel,
          compact ? styles.filterChipLabelCompact : null,
        ]}
      >
        {label}
      </Text>
      {Platform.OS === 'web' ? (
        React.createElement('input', {
          type: 'range',
          min: 0,
          max: 100,
          step: 1,
          value: percent,
          'aria-label': `${accessibilityLabel} (${percent}%)`,
          'data-testid': 'polygon-opacity-slider',
          title: `${label}: ${percent}%`,
          className: 'entsiegelung-opacity-slider',
          onChange: (event: { target?: { value?: string } }) => {
            if (!onChange) {
              return;
            }
            const parsed = Number(event.target?.value);
            if (Number.isFinite(parsed)) {
              onChange(clampPolygonOpacity(parsed / 100));
            }
          },
          onPointerDown: (event: { stopPropagation?: () => void }) => {
            event.stopPropagation?.();
          },
          onPointerMove: (event: { stopPropagation?: () => void }) => {
            event.stopPropagation?.();
          },
          onTouchStart: (event: { stopPropagation?: () => void }) => {
            event.stopPropagation?.();
          },
          onTouchMove: (event: { stopPropagation?: () => void }) => {
            event.stopPropagation?.();
          },
          style: compact
            ? {
                flex: 1,
                width: '100%',
                minWidth: '64px',
              }
            : {
                width: '96px',
              },
        })
      ) : (
        <View
          testID="polygon-opacity-slider-native"
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={accessibilityLabel}
          accessibilityValue={{
            min: 0,
            max: 100,
            now: percent,
            text: `${percent}%`,
          }}
          onLayout={(event) => {
            const measured = event.nativeEvent.layout.width;
            if (measured > 0) {
              trackWidthRef.current = measured;
            }
          }}
          onStartShouldSetResponder={() => true}
          onStartShouldSetResponderCapture={() => true}
          onMoveShouldSetResponder={() => true}
          onMoveShouldSetResponderCapture={() => true}
          onResponderTerminationRequest={() => false}
          onResponderGrant={(event) => {
            updateFromOffsetX(event.nativeEvent.locationX);
          }}
          onResponderMove={(event) => {
            updateFromOffsetX(event.nativeEvent.locationX);
          }}
          style={[
            styles.nativeSliderTouchArea,
            compact
              ? styles.nativeSliderTouchAreaCompact
              : styles.nativeSliderTouchAreaDesktop,
          ]}
        >
          <View pointerEvents="none" style={styles.nativeSliderTrack}>
            <View
              pointerEvents="none"
              style={[
                styles.nativeSliderTrackFill,
                { width: `${percent}%` },
              ]}
            />
          </View>
          <View
            pointerEvents="none"
            style={[
              styles.nativeSliderThumb,
              { left: `${percent}%` },
            ]}
          />
        </View>
      )}
      <Text numberOfLines={1} style={styles.opacityValueLabel}>
        {percent}%
      </Text>
    </View>
  );
}

function ParcelUnsealMark({
  compact,
  logoUrl,
}: {
  compact: boolean;
  logoUrl?: string | null | undefined;
}): React.JSX.Element {
  const { palette, isDark } = useTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  const size = compact ? 24 : 28;
  const effectiveLogoUrl =
    logoUrl && logoUrl !== failedLogoUrl ? logoUrl : null;

  if (effectiveLogoUrl) {
    if (Platform.OS === 'web') {
      return React.createElement('img', {
        src: effectiveLogoUrl,
        alt: '',
        width: size,
        height: size,
        onError: () => setFailedLogoUrl(effectiveLogoUrl),
        style: {
          width: `${size}px`,
          height: `${size}px`,
          flexShrink: 0,
          display: 'block',
          objectFit: 'contain',
          borderRadius: compact ? '6px' : '7px',
        },
      });
    }
    return (
      <View
        style={[styles.brandMark, compact ? styles.brandMarkCompact : null]}
        accessible={false}
      >
        <Image
          source={{ uri: effectiveLogoUrl }}
          style={styles.brandMarkImage}
          resizeMode="contain"
          onError={() => setFailedLogoUrl(effectiveLogoUrl)}
          accessibilityIgnoresInvertColors
        />
      </View>
    );
  }

  if (Platform.OS === 'web') {
    return React.createElement(
      'svg',
      {
        width: size,
        height: size,
        viewBox: '0 0 64 64',
        fill: 'none',
        'aria-hidden': 'true',
        style: {
          flexShrink: 0,
          display: 'block',
          borderRadius: compact ? '6px' : '7px',
          boxShadow: isDark
            ? 'inset 0 0 0 1px rgba(236, 243, 239, 0.16)'
            : 'inset 0 0 0 1px rgba(17, 29, 24, 0.14)',
        },
      },
      React.createElement('rect', {
        width: '64',
        height: '64',
        rx: '14',
        fill: isDark ? '#192921' : '#EFF3F0',
      }),
      React.createElement('path', {
        d: 'M0 40H26L31 50L37 40H64V50C64 57.732 57.732 64 50 64H14C6.26801 64 0 57.732 0 50V40Z',
        fill: isDark ? '#4B5854' : '#5A6360',
      }),
      React.createElement('path', {
        d: 'M31 49C31 38 32 30 37 22',
        stroke: isDark ? '#28B073' : '#176642',
        strokeWidth: '4',
        strokeLinecap: 'round',
      }),
      React.createElement('path', {
        d: 'M34 26C35 16 44 13 49 15C48 22 42 27 34 26Z',
        fill: isDark ? '#34C785' : '#1F7A4C',
      }),
      React.createElement('path', {
        d: 'M31 34C29 27 22 25 18 26C19 31 25 35 31 34Z',
        fill: isDark ? '#28B073' : '#176642',
      }),
    );
  }

  return (
    <View
      style={[styles.brandMark, compact ? styles.brandMarkCompact : null]}
      accessible={false}
    >
      <Image
        source={OPENUNSEAL_HEADER_LOGO}
        style={styles.brandMarkImage}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}

function LocaleTogglePill({
  locale,
  compact,
  narrow = false,
  accessibilityLabel,
  onPress,
}: {
  locale: Locale;
  compact: boolean;
  narrow?: boolean;
  accessibilityLabel: string;
  onPress?: () => void;
}): React.JSX.Element {
  const { palette } = useTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  return (
    <Pressable
      testID="locale-toggle-button"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={compact ? { top: 4, bottom: 4, left: 2, right: 2 } : undefined}
      onPress={onPress}
      style={({ pressed }) => [
        styles.localePill,
        compact ? styles.localePillCompact : null,
        narrow ? styles.localePillNarrow : null,
        pressed ? styles.buttonPressed : null,
      ]}
    >
      <Text
        style={[
          styles.localeCodeLabel,
          narrow ? styles.localeCodeLabelNarrow : null,
          locale === 'de' ? styles.localeCodeActive : styles.localeCodeInactive,
        ]}
      >
        DE
      </Text>
      <Text
        style={[
          styles.localeDivider,
          narrow ? styles.localeCodeLabelNarrow : null,
        ]}
      >
        |
      </Text>
      <Text
        style={[
          styles.localeCodeLabel,
          narrow ? styles.localeCodeLabelNarrow : null,
          locale === 'en' ? styles.localeCodeActive : styles.localeCodeInactive,
        ]}
      >
        EN
      </Text>
    </Pressable>
  );
}

function SearchInlineGlyph({
  color,
  accentColor,
  size = 16,
}: {
  color: string;
  accentColor: string;
  size?: number;
}): React.JSX.Element {
  if (Platform.OS === 'web') {
    return React.createElement(
      'svg',
      {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        'aria-hidden': 'true',
        style: { flexShrink: 0, display: 'block' },
      },
      React.createElement('circle', {
        cx: '11',
        cy: '11',
        r: '6.5',
        stroke: color,
        strokeWidth: '2.1',
      }),
      React.createElement('path', {
        d: 'M16 16L20.5 20.5',
        stroke: accentColor,
        strokeWidth: '2.3',
        strokeLinecap: 'round',
      }),
    );
  }
  return (
    <View
      accessible={false}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: color,
      }}
    />
  );
}

function MenuGlyph({
  color,
  size = 18,
}: {
  color: string;
  size?: number;
}): React.JSX.Element {
  if (Platform.OS === 'web') {
    return React.createElement(
      'svg',
      {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        'aria-hidden': 'true',
        style: { flexShrink: 0, display: 'block' },
      },
      React.createElement('path', {
        d: 'M4.5 7H19.5M4.5 12H19.5M4.5 17H19.5',
        stroke: color,
        strokeWidth: '2',
        strokeLinecap: 'round',
      }),
    );
  }
  return (
    <View
      accessible={false}
      style={{ width: size, height: size, justifyContent: 'center', gap: 3.5 }}
    >
      <View style={{ height: 2, borderRadius: 1, backgroundColor: color }} />
      <View style={{ height: 2, borderRadius: 1, backgroundColor: color }} />
      <View style={{ height: 2, borderRadius: 1, backgroundColor: color }} />
    </View>
  );
}

function PlusGlyph({
  color,
  size = 24,
}: {
  color: string;
  size?: number;
}): React.JSX.Element {
  if (Platform.OS === 'web') {
    return React.createElement(
      'svg',
      {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        'aria-hidden': 'true',
        style: { flexShrink: 0, display: 'block' },
      },
      React.createElement('path', {
        d: 'M12 5V19M5 12H19',
        stroke: color,
        strokeWidth: '2.6',
        strokeLinecap: 'round',
      }),
    );
  }
  return (
    <View
      accessible={false}
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          position: 'absolute',
          width: Math.round(size * 0.62),
          height: 2.6,
          borderRadius: 1.3,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: 2.6,
          height: Math.round(size * 0.62),
          borderRadius: 1.3,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

export function MapControlsBar({
  controls,
  proposalCount,
  branding,
  tier = 'expanded',
  viewportWidth,
  moreMenuOpen = false,
  onToggleMoreMenu,
  onOpenSearch,
  onToggleLocale,
  onToggleTheme,
  onOpenAbout,
  onOpenAccount,
  activeMainTab = 'map',
  unreadChats = 0,
  onSelectMainTab,
  onOpenChat,
}: MapControlsBarProps): React.JSX.Element {
  const { palette } = useTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const navbarLayout = deriveNavbarLayoutMode(tier, viewportWidth);
  const isCompact = navbarLayout.isCompact;
  const collapseTheme = navbarLayout.collapseThemeToMenu;
  const collapseLocale = navbarLayout.collapseLocaleToMenu;
  const isNarrowPhone =
    viewportWidth !== undefined && Number.isFinite(viewportWidth) && viewportWidth < 390;
  const isVeryNarrow =
    viewportWidth !== undefined && Number.isFinite(viewportWidth) && viewportWidth < 360;
  const locale = controls.locale;
  const isDark = controls.colorScheme === 'dark';
  const t = getTranslations(locale).controls;
  const social = getSocialCopy(locale);
  const appName = branding?.appName?.trim() || DEFAULT_APP_NAME;

  const navIconButton = (
    id: 'map' | 'feed' | 'chat',
    label: string,
    Glyph: typeof MapGlyph,
    selected: boolean,
    onPress: () => void,
    badge = 0,
  ): React.JSX.Element =>
    withWebTooltip(
      label,
      <Pressable
        key={id}
        testID={`tab-${id}`}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected }}
        {...(id === 'chat' ? {} : { 'aria-pressed': selected })}
        hitSlop={isCompact ? { top: 4, bottom: 4, left: 2, right: 2 } : undefined}
        onPress={onPress}
        style={({ pressed }) => [
          styles.navIconButton,
          isCompact ? styles.navIconButtonCompact : null,
          selected ? styles.navIconButtonActive : null,
          pressed ? styles.buttonPressed : null,
        ]}
      >
        <Glyph
          color={selected ? palette.inkOnAccent : palette.inkPrimary}
          size={isCompact ? 19 : 20}
        />
        {badge > 0 ? (
          <View testID={`tab-${id}-badge`} style={styles.navIconBadge}>
            <Text style={styles.navIconBadgeLabel}>
              {badge > 9 ? '9+' : `${badge}`}
            </Text>
          </View>
        ) : null}
      </Pressable>,
    );

  const accountButtonA11y = controls.isAuthenticated
    ? t.accountSettingsA11y(controls.accountLabel)
    : t.signInOrRegisterA11y;

  return (
    <View
      style={[
        styles.barShell,
        isCompact ? styles.barShellCompact : null,
        isCompact && isNarrowPhone ? styles.barShellNarrowPhone : null,
      ]}
    >
      <View
        style={[
          styles.navbarSingleRow,
          isCompact ? styles.navbarSingleRowCompact : null,
          isCompact && isNarrowPhone ? styles.navbarSingleRowNarrowPhone : null,
        ]}
      >
        <View
          style={[
            styles.brandGroup,
            isCompact ? styles.brandGroupCompact : null,
            navbarLayout.hideBrandTitle ? styles.brandGroupTitleless : null,
          ]}
        >
          <ParcelUnsealMark compact={isCompact} logoUrl={branding?.logoUrl} />
          <View
            style={[
              styles.titleInlineRow,
              isCompact && !navbarLayout.hideBrandTitle
                ? styles.titleInlineRowCompact
                : null,
            ]}
          >
            {navbarLayout.hideBrandTitle ? null : Platform.OS === 'web' ? (
              React.createElement(
                'h1',
                {
                  style: {
                    margin: 0,
                    padding: 0,
                    fontSize: isNarrowPhone
                      ? '14.5px'
                      : isCompact
                        ? '15.5px'
                        : '18px',
                    fontWeight: 700,
                    letterSpacing: '-0.35px',
                    lineHeight: '20px',
                    color: palette.inkPrimary,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    minWidth: 0,
                    flexShrink: 1,
                    fontFamily:
                      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                  },
                },
                appName,
              )
            ) : (
              <Text
                accessibilityRole="header"
                aria-level={1}
                numberOfLines={1}
                ellipsizeMode="tail"
                style={[
                  styles.title,
                  isCompact ? styles.titleCompact : null,
                  isNarrowPhone ? styles.titleVeryNarrow : null,
                ]}
              >
                {appName}
              </Text>
            )}
            {navbarLayout.hideCountBadge ? null : (
              <View
                style={[
                  styles.countBadge,
                  isCompact ? styles.countBadgeCompact : null,
                ]}
              >
                <View style={styles.countBadgeDot} />
                <Text style={styles.countBadgeLabel}>
                  {navbarLayout.useCompactCountBadge
                    ? `${proposalCount}`
                    : `${proposalCount} ${
                        controls.highlightMineOnly
                          ? t.mineInViewSuffix
                          : t.inViewSuffix
                      }`}
                </Text>
              </View>
            )}
          </View>
        </View>

        {onSelectMainTab && onOpenChat ? (
          <View
            testID="main-tab-bar"
            role="navigation"
            style={[
              styles.navIconGroup,
              isCompact ? styles.navIconGroupCompact : null,
            ]}
          >
            {navIconButton(
              'map',
              social.map,
              MapGlyph,
              activeMainTab === 'map',
              () => onSelectMainTab('map'),
            )}
            {navIconButton(
              'feed',
              social.feed,
              FeedGlyph,
              activeMainTab === 'feed',
              () => onSelectMainTab('feed'),
            )}
            {navIconButton(
              'chat',
              unreadChats > 0
                ? social.chatUnread(unreadChats)
                : social.chat,
              ChatGlyph,
              false,
              onOpenChat,
              unreadChats,
            )}
          </View>
        ) : null}

        {navbarLayout.showSearchBarInNavbar && onOpenSearch ? (
          <View style={styles.searchSlotWrapper}>
            <Pressable
              testID="navbar-search-trigger"
              accessibilityRole="button"
              accessibilityLabel={t.searchAddressA11y}
              onPress={onOpenSearch}
              style={({ pressed }) => [
                styles.navbarSearchPill,
                pressed ? styles.buttonPressed : null,
              ]}
            >
              <SearchInlineGlyph
                color={palette.inkSecondary}
                accentColor={palette.accentPrimary}
                size={16}
              />
              <Text
                numberOfLines={1}
                ellipsizeMode="tail"
                style={styles.navbarSearchPlaceholder}
              >
                {t.searchPlaceholderBar}
              </Text>
            </Pressable>
          </View>
        ) : null}

        <View
          style={[
            styles.rightHeaderCluster,
            isCompact ? styles.rightHeaderClusterCompact : null,
            isCompact && isNarrowPhone ? styles.rightHeaderClusterNarrowPhone : null,
          ]}
        >
          {!collapseTheme && onToggleTheme
            ? withWebTooltip(
                isDark ? t.lightModeTooltip : t.darkModeTooltip,
                <Pressable
                  testID="theme-toggle-button"
                  accessibilityRole="button"
                  accessibilityLabel={
                    isDark ? t.switchToLightModeA11y : t.switchToDarkModeA11y
                  }
                  accessibilityState={{ selected: isDark }}
                  hitSlop={isCompact ? { top: 4, bottom: 4, left: 3, right: 3 } : undefined}
                  onPress={onToggleTheme}
                  style={({ pressed }) => [
                    styles.helpButton,
                    isCompact ? styles.helpButtonCompact : null,
                    isCompact && isNarrowPhone ? styles.helpButtonNarrowPhone : null,
                    pressed ? styles.buttonPressed : null,
                  ]}
                >
                  <ThemeModeGlyph
                    isDark={isDark}
                    color={palette.inkPrimary}
                    size={isCompact ? 17 : 18}
                  />
                </Pressable>,
              )
            : null}

          {onOpenAbout
            ? withWebTooltip(
                t.aboutButtonTooltip,
                <Pressable
                  testID="about-modal-button"
                  accessibilityRole="button"
                  accessibilityLabel={t.aboutButtonA11y}
                  hitSlop={isCompact ? { top: 4, bottom: 4, left: 3, right: 3 } : undefined}
                  onPress={onOpenAbout}
                  style={({ pressed }) => [
                    styles.helpButton,
                    isCompact ? styles.helpButtonCompact : null,
                    isCompact && isNarrowPhone ? styles.helpButtonNarrowPhone : null,
                    pressed ? styles.buttonPressed : null,
                  ]}
                >
                  <Text style={styles.helpButtonLabel}>?</Text>
                </Pressable>,
              )
            : null}

          {!collapseLocale
            ? withWebTooltip(
                t.switchLocaleA11y,
                <LocaleTogglePill
                  locale={locale}
                  compact={isCompact}
                  narrow={isCompact && isNarrowPhone}
                  accessibilityLabel={t.switchLocaleA11y}
                  {...(onToggleLocale ? { onPress: onToggleLocale } : {})}
                />,
              )
            : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={accountButtonA11y}
            hitSlop={isCompact ? { top: 4, bottom: 4, left: 2, right: 2 } : undefined}
            onPress={onOpenAccount}
            style={({ pressed }) => [
              styles.accountChip,
              isCompact ? styles.accountChipCompact : null,
              isCompact && isNarrowPhone ? styles.accountChipNarrowPhone : null,
              isCompact && isVeryNarrow ? styles.accountChipVeryNarrow : null,
              navbarLayout.constrainAccountChipWidth && !isCompact
                ? styles.accountChipMediumHeader
                : null,
              navbarLayout.iconOnlyAccount ? styles.accountChipIconOnly : null,
              controls.isAuthenticated ? styles.accountChipActive : null,
              pressed ? styles.buttonPressed : null,
            ]}
          >
            <View
              style={[
                styles.accountStatusDot,
                controls.isAuthenticated
                  ? styles.accountStatusDotOnline
                  : styles.accountStatusDotGuest,
              ]}
            />
            {navbarLayout.iconOnlyAccount ? (
              <UserGlyph
                color={
                  controls.isAuthenticated
                    ? palette.accentPrimary
                    : palette.inkPrimary
                }
                size={17}
              />
            ) : (
              <Text
                numberOfLines={1}
                ellipsizeMode="tail"
                style={[
                  styles.accountChipLabel,
                  isCompact ? styles.accountChipLabelCompact : null,
                  isCompact && isNarrowPhone ? styles.accountChipLabelNarrowPhone : null,
                  controls.isAuthenticated ? styles.accountChipLabelActive : null,
                ]}
              >
                {controls.accountLabel}
              </Text>
            )}
          </Pressable>

          {onToggleMoreMenu
            ? withWebTooltip(
                t.moreMenuTooltip,
                <Pressable
                  testID="more-menu-button"
                  accessibilityRole="button"
                  accessibilityLabel={t.moreMenuA11y}
                  accessibilityState={{
                    expanded: moreMenuOpen,
                    selected: moreMenuOpen,
                  }}
                  hitSlop={isCompact ? { top: 4, bottom: 4, left: 3, right: 3 } : undefined}
                  onPress={onToggleMoreMenu}
                  style={({ pressed }) => [
                    styles.helpButton,
                    isCompact ? styles.helpButtonCompact : null,
                    isCompact && isNarrowPhone ? styles.helpButtonNarrowPhone : null,
                    moreMenuOpen ? styles.helpButtonActive : null,
                    pressed ? styles.buttonPressed : null,
                  ]}
                >
                  <MenuGlyph
                    color={moreMenuOpen ? palette.accentPrimary : palette.inkPrimary}
                    size={isCompact ? 17 : 18}
                  />
                </Pressable>,
              )
            : null}
        </View>
      </View>
    </View>
  );
}

export interface NavbarOverflowMenuProps {
  visible: boolean;
  controls: MapControlsModel;
  exportGeoJsonUrl: string;
  impressumUrl?: string | undefined;
  privacyPolicyUrl?: string | undefined;
  isImporting?: boolean;
  showThemeToggle?: boolean;
  showLocaleToggle?: boolean;
  maxHeight?: number | undefined;
  onClose: () => void;
  onToggleTheme?: () => void;
  onToggleLocale?: () => void;
  onOpenStats?: () => void;
  onOpenInstallApp?: () => void;
  onOpenBugReport?: () => void;
  onImportPress?: () => void;
  onExportError: (message: string) => void;
}

function openLegalExternalUrl(url: string): void {
  if (Platform.OS === 'web') {
    const scope = globalThis as {
      window?: { open?: (u: string, target?: string, features?: string) => void };
    };
    if (typeof scope.window?.open === 'function') {
      scope.window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
  }
  void Linking.openURL(url);
}

export function NavbarOverflowMenu({
  visible,
  controls,
  exportGeoJsonUrl,
  impressumUrl,
  privacyPolicyUrl,
  isImporting = false,
  showThemeToggle = false,
  showLocaleToggle = false,
  maxHeight,
  onClose,
  onToggleTheme,
  onToggleLocale,
  onOpenStats,
  onOpenInstallApp,
  onOpenBugReport,
  onImportPress,
  onExportError,
}: NavbarOverflowMenuProps): React.JSX.Element | null {
  const { palette, isDark } = useTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);

  if (!visible) {
    return null;
  }

  const locale = controls.locale;
  const t = getTranslations(locale).controls;

  const showInstallButton = onOpenInstallApp !== undefined;

  const handleExportPress = (): void => {
    onClose();
    void triggerGeoJsonExportDownload(exportGeoJsonUrl).catch(
      (err: unknown) => {
        const detail = localizeError(err, t.exportErrorFallback, locale);
        onExportError(detail);
      },
    );
  };

  const handleInstallPress = (): void => {
    onClose();
    onOpenInstallApp?.();
  };

  return (
    <View
      testID="navbar-overflow-menu"
      accessibilityRole="menu"
      style={[
        styles.popoverCard,
        styles.overflowMenuCard,
        maxHeight !== undefined ? { maxHeight } : null,
        Platform.OS === 'web'
          ? {
              boxShadow: isDark
                ? '0 8px 28px rgba(0, 0, 0, 0.55)'
                : '0 8px 24px rgba(18, 32, 25, 0.18)',
            }
          : styles.nativePopoverShadow,
      ]}
    >
      <ScrollView
        showsVerticalScrollIndicator
        showsHorizontalScrollIndicator={false}
        style={
          maxHeight !== undefined
            ? { maxHeight: Math.max(120, maxHeight - 2) }
            : undefined
        }
        contentContainerStyle={styles.overflowMenuScrollContent}
      >
        {(showThemeToggle && onToggleTheme) ||
        (showLocaleToggle && onToggleLocale) ? (
          <View style={styles.menuSection}>
            <Text style={styles.menuSectionLabel}>{t.menuSectionAppearance}</Text>
            {showThemeToggle && onToggleTheme ? (
              <Pressable
                testID="overflow-theme-toggle-button"
                accessibilityRole="menuitem"
                accessibilityLabel={
                  isDark ? t.switchToLightModeA11y : t.switchToDarkModeA11y
                }
                accessibilityState={{ selected: isDark }}
                onPress={onToggleTheme}
                style={({ pressed }) => [
                  styles.menuItemRow,
                  pressed ? styles.menuItemPressed : null,
                ]}
              >
                <ThemeModeGlyph
                  isDark={isDark}
                  color={palette.inkPrimary}
                  size={18}
                />
                <Text style={styles.menuItemLabel}>
                  {isDark ? t.lightModeTooltip : t.darkModeTooltip}
                </Text>
              </Pressable>
            ) : null}
            {showLocaleToggle && onToggleLocale ? (
              <Pressable
                testID="overflow-locale-toggle-button"
                accessibilityRole="menuitem"
                accessibilityLabel={t.switchLocaleA11y}
                onPress={onToggleLocale}
                style={({ pressed }) => [
                  styles.menuItemRow,
                  pressed ? styles.menuItemPressed : null,
                ]}
              >
                <View style={styles.menuLocaleBadge}>
                  <Text
                    style={[
                      styles.localeCodeLabel,
                      locale === 'de'
                        ? styles.localeCodeActive
                        : styles.localeCodeInactive,
                    ]}
                  >
                    DE
                  </Text>
                  <Text style={styles.localeDivider}>|</Text>
                  <Text
                    style={[
                      styles.localeCodeLabel,
                      locale === 'en'
                        ? styles.localeCodeActive
                        : styles.localeCodeInactive,
                    ]}
                  >
                    EN
                  </Text>
                </View>
                <Text style={styles.menuItemLabel}>{t.switchLocaleA11y}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <View style={styles.menuSection}>
        <Text style={styles.menuSectionLabel}>{t.menuSectionData}</Text>
        {onOpenStats ? (
          <Pressable
            testID="stats-modal-button"
            accessibilityRole="menuitem"
            accessibilityLabel={t.statsButtonA11y}
            onPress={() => {
              onClose();
              onOpenStats();
            }}
            style={({ pressed }) => [
              styles.menuItemRow,
              pressed ? styles.menuItemPressed : null,
            ]}
          >
            <StatsGlyph color={palette.inkPrimary} size={18} />
            <Text style={styles.menuItemLabel}>{t.statsButtonTooltip}</Text>
          </Pressable>
        ) : null}
        <Pressable
          testID="export-geojson-button"
          accessibilityRole="menuitem"
          accessibilityLabel={t.exportFull}
          accessibilityHint={t.exportA11y}
          onPress={handleExportPress}
          style={({ pressed }) => [
            styles.menuItemRow,
            pressed ? styles.menuItemPressed : null,
          ]}
        >
          <ExportGlyph color={palette.inkPrimary} size={18} />
          <Text style={styles.menuItemLabel}>{t.exportFull}</Text>
        </Pressable>

        {controls.isAdmin && onImportPress ? (
          <Pressable
            testID="import-polygons-button"
            accessibilityRole="menuitem"
            accessibilityLabel={isImporting ? t.importingBusy : t.importFull}
            accessibilityHint={t.importA11y}
            accessibilityState={{ disabled: isImporting, busy: isImporting }}
            disabled={isImporting}
            onPress={() => {
              onClose();
              onImportPress();
            }}
            style={({ pressed }) => [
              styles.menuItemRow,
              isImporting ? styles.buttonDisabled : null,
              pressed && !isImporting ? styles.menuItemPressed : null,
            ]}
          >
            {isImporting ? (
              <ActivityIndicator size="small" color={palette.finishedText} />
            ) : (
              <ImportGlyph color={palette.finishedText} size={18} />
            )}
            <Text style={[styles.menuItemLabel, { color: palette.finishedText }]}>
              {isImporting ? t.importingBusy : t.importFull}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {showInstallButton || onOpenBugReport ? (
        <View style={styles.menuSection}>
          <Text style={styles.menuSectionLabel}>{t.menuSectionHelp}</Text>
          {showInstallButton ? (
            <Pressable
              testID="install-app-button"
              accessibilityRole="menuitem"
              accessibilityLabel={t.installAppFull}
              accessibilityHint={t.installAppA11y}
              onPress={handleInstallPress}
              style={({ pressed }) => [
                styles.menuItemRow,
                pressed ? styles.menuItemPressed : null,
              ]}
            >
              <InstallAppGlyph
                color={palette.accentPrimary}
                eyeColor={palette.bgSurface}
                size={18}
              />
              <Text style={styles.menuItemLabel}>
                {t.installAppFull}
              </Text>
            </Pressable>
          ) : null}

          {onOpenBugReport ? (
            <Pressable
              testID="bug-report-button"
              accessibilityRole="menuitem"
              accessibilityLabel={t.bugReportButtonA11y}
              onPress={() => {
                onClose();
                onOpenBugReport();
              }}
              style={({ pressed }) => [
                styles.menuItemRow,
                pressed ? styles.menuItemPressed : null,
              ]}
            >
              <BugGlyph color={palette.inkSecondary} size={18} />
              <Text style={styles.menuItemLabel}>{t.bugReportButtonTooltip}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {impressumUrl || privacyPolicyUrl ? (
        <View style={styles.menuSection}>
          <Text style={styles.menuSectionLabel}>{t.menuSectionLegal}</Text>
          {impressumUrl ? (
            <Pressable
              testID="overflow-impressum-link"
              accessibilityRole="link"
              accessibilityLabel={t.impressumItem}
              onPress={() => {
                onClose();
                openLegalExternalUrl(impressumUrl);
              }}
              style={({ pressed }) => [
                styles.menuItemRow,
                pressed ? styles.menuItemPressed : null,
              ]}
            >
              <Text style={styles.menuItemLabel}>{t.impressumItem}</Text>
            </Pressable>
          ) : null}
          {privacyPolicyUrl ? (
            <Pressable
              testID="overflow-privacy-link"
              accessibilityRole="link"
              accessibilityLabel={t.privacyItem}
              onPress={() => {
                onClose();
                openLegalExternalUrl(privacyPolicyUrl);
              }}
              style={({ pressed }) => [
                styles.menuItemRow,
                pressed ? styles.menuItemPressed : null,
              ]}
            >
              <Text style={styles.menuItemLabel}>{t.privacyItem}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      </ScrollView>
    </View>
  );
}

export interface FloatingFilterStripProps {
  controls: MapControlsModel;
  compact?: boolean;
  onSetPolygonFilter?: (filter: PolygonFilter) => void;
  onToggleHighlightMine?: () => void;
}

export function FloatingFilterStrip({
  controls,
  compact = false,
  onSetPolygonFilter,
  onToggleHighlightMine,
}: FloatingFilterStripProps): React.JSX.Element {
  const { palette, isDark } = useTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const t = getTranslations(controls.locale).controls;
  const chipElevation =
    Platform.OS === 'web'
      ? {
          boxShadow: isDark
            ? '0 2px 10px rgba(0, 0, 0, 0.42)'
            : '0 2px 8px rgba(18, 32, 25, 0.14)',
        }
      : styles.nativeChipShadow;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.floatingFilterScroll}
      contentContainerStyle={[
        styles.filterStripContent,
        compact ? styles.filterStripContentCompact : null,
      ]}
    >
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t.filterGroupA11y}
        style={[
          styles.filterRadioGroupRow,
          compact ? styles.filterStripContentCompact : null,
        ]}
      >
        <Pressable
          testID="filter-polygon-all"
          accessibilityRole="radio"
          accessibilityLabel={t.filterAllA11y}
          accessibilityState={{
            checked: controls.polygonFilter === 'all',
            selected: controls.polygonFilter === 'all',
          }}
          onPress={() => onSetPolygonFilter?.('all')}
          style={({ pressed }) => [
            styles.floatingFilterChip,
            chipElevation,
            compact ? styles.filterChipCompact : null,
            controls.polygonFilter === 'all' ? styles.filterChipActive : null,
            pressed ? styles.buttonPressed : null,
          ]}
        >
          <Text
            numberOfLines={1}
            style={[
              styles.filterChipLabel,
              compact ? styles.filterChipLabelCompact : null,
              controls.polygonFilter === 'all'
                ? styles.filterChipLabelActive
                : null,
            ]}
          >
            {t.filterAll}
          </Text>
        </Pressable>

        <Pressable
          testID="filter-polygon-new"
          accessibilityRole="radio"
          accessibilityLabel={t.filterNewA11y}
          accessibilityState={{
            checked: controls.polygonFilter === 'new',
            selected: controls.polygonFilter === 'new',
          }}
          onPress={() => onSetPolygonFilter?.('new')}
          style={({ pressed }) => [
            styles.floatingFilterChip,
            chipElevation,
            compact ? styles.filterChipCompact : null,
            controls.polygonFilter === 'new' ? styles.filterChipActive : null,
            pressed ? styles.buttonPressed : null,
          ]}
        >
          <Text
            numberOfLines={1}
            style={[
              styles.filterChipLabel,
              compact ? styles.filterChipLabelCompact : null,
              controls.polygonFilter === 'new'
                ? styles.filterChipLabelActive
                : null,
            ]}
          >
            {compact ? t.filterNewCompact : t.filterNewFull}
          </Text>
        </Pressable>

        <Pressable
          testID="filter-polygon-established"
          accessibilityRole="radio"
          accessibilityLabel={t.filterEstablishedA11y}
          accessibilityState={{
            checked: controls.polygonFilter === 'established',
            selected: controls.polygonFilter === 'established',
          }}
          onPress={() => onSetPolygonFilter?.('established')}
          style={({ pressed }) => [
            styles.floatingFilterChip,
            chipElevation,
            compact ? styles.filterChipCompact : null,
            controls.polygonFilter === 'established'
              ? styles.filterChipActive
              : null,
            pressed ? styles.buttonPressed : null,
          ]}
        >
          <Text
            numberOfLines={1}
            style={[
              styles.filterChipLabel,
              compact ? styles.filterChipLabelCompact : null,
              controls.polygonFilter === 'established'
                ? styles.filterChipLabelActive
                : null,
            ]}
          >
            {compact ? t.filterEstablishedCompact : t.filterEstablishedFull}
          </Text>
        </Pressable>

        <Pressable
          testID="filter-polygon-needs-review"
          accessibilityRole="radio"
          accessibilityLabel={t.filterNeedsReviewA11y}
          accessibilityState={{
            checked: controls.polygonFilter === 'needs_review',
            selected: controls.polygonFilter === 'needs_review',
          }}
          onPress={() => onSetPolygonFilter?.('needs_review')}
          style={({ pressed }) => [
            styles.floatingFilterChip,
            chipElevation,
            compact ? styles.filterChipCompact : null,
            controls.polygonFilter === 'needs_review'
              ? styles.filterChipWarningActive
              : null,
            pressed ? styles.buttonPressed : null,
          ]}
        >
          <Text
            numberOfLines={1}
            style={[
              styles.filterChipLabel,
              compact ? styles.filterChipLabelCompact : null,
              controls.polygonFilter === 'needs_review'
                ? styles.filterChipWarningLabelActive
                : null,
            ]}
          >
            {compact ? t.filterNeedsReviewCompact : t.filterNeedsReviewFull}
          </Text>
        </Pressable>

        {/* The same filters the feed offers, so a choice made there stays visible here. */}
        {(['in_progress', 'finished', 'help_wanted'] as const).map((value) => {
          const label = getSocialCopy(controls.locale).filters[value];
          const selected = controls.polygonFilter === value;
          return (
            <Pressable
              key={value}
              testID={`filter-polygon-${value.replace('_', '-')}`}
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityState={{ checked: selected, selected }}
              aria-checked={selected}
              onPress={() => onSetPolygonFilter?.(value)}
              style={({ pressed }) => [
                styles.floatingFilterChip,
                chipElevation,
                compact ? styles.filterChipCompact : null,
                selected ? styles.filterChipActive : null,
                pressed ? styles.buttonPressed : null,
              ]}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.filterChipLabel,
                  compact ? styles.filterChipLabelCompact : null,
                  selected ? styles.filterChipLabelActive : null,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {controls.isAuthenticated && onToggleHighlightMine ? (
        <>
          <View style={styles.filterOrthogonalDivider} />
          <Pressable
            testID="highlight-mine-toggle"
            accessibilityRole="switch"
            accessibilityLabel={t.highlightMineA11y}
            accessibilityState={{
              checked: controls.highlightMineOnly,
              selected: controls.highlightMineOnly,
            }}
            onPress={onToggleHighlightMine}
            style={({ pressed }) => [
              styles.floatingFilterChip,
              chipElevation,
              compact ? styles.filterChipCompact : null,
              controls.highlightMineOnly ? styles.filterChipActive : null,
              pressed ? styles.buttonPressed : null,
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.filterChipLabel,
                compact ? styles.filterChipLabelCompact : null,
                controls.highlightMineOnly
                  ? styles.filterChipLabelActive
                  : null,
              ]}
            >
              {compact ? t.highlightMineCompact : t.highlightMineFull}
            </Text>
          </Pressable>
        </>
      ) : null}
    </ScrollView>
  );
}

export interface MapLayersPopoverProps {
  visible: boolean;
  controls: MapControlsModel;
  compact?: boolean;
  onSetBasemapMode: (mode: BasemapMode) => void;
  onSetPolygonOpacity?: (opacity: number) => void;
  /** Further layers, shown below the basemap and opacity controls. */
  children?: React.ReactNode;
}

export function MapLayersPopover({
  visible,
  controls,
  compact = false,
  onSetBasemapMode,
  onSetPolygonOpacity,
  children,
}: MapLayersPopoverProps): React.JSX.Element | null {
  const { palette, isDark } = useTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);

  if (!visible) {
    return null;
  }

  const t = getTranslations(controls.locale).controls;

  return (
    <View
      testID="map-layers-popover"
      style={[
        styles.popoverCard,
        styles.layersPopoverCard,
        compact ? styles.layersPopoverCardCompact : null,
        Platform.OS === 'web'
          ? {
              boxShadow: isDark
                ? '0 8px 28px rgba(0, 0, 0, 0.55)'
                : '0 8px 24px rgba(18, 32, 25, 0.18)',
            }
          : styles.nativePopoverShadow,
      ]}
    >
      <Text style={styles.menuSectionLabel}>{t.layersPopoverTitle}</Text>

      {controls.showOrthophotoToggle ? (
        <View
          accessibilityRole="radiogroup"
          style={styles.basemapSegmentGroup}
        >
          <Pressable
            testID="basemap-segment-osm"
            accessibilityRole="radio"
            accessibilityLabel={t.switchToOsmA11y}
            accessibilityState={{
              checked: controls.basemapMode === 'osm',
              selected: controls.basemapMode === 'osm',
            }}
            onPress={() => onSetBasemapMode('osm')}
            style={({ pressed }) => [
              styles.basemapSegmentOption,
              controls.basemapMode === 'osm'
                ? styles.basemapSegmentOptionActive
                : null,
              pressed ? styles.buttonPressed : null,
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.basemapSegmentLabel,
                controls.basemapMode === 'osm'
                  ? styles.basemapSegmentLabelActive
                  : null,
              ]}
            >
              {t.streetCompact}
            </Text>
          </Pressable>

          <Pressable
            testID="basemap-segment-orthophoto"
            accessibilityRole="radio"
            accessibilityLabel={t.switchToOrthoA11y}
            accessibilityState={{
              checked: controls.basemapMode === 'orthophoto',
              selected: controls.basemapMode === 'orthophoto',
            }}
            onPress={() => onSetBasemapMode('orthophoto')}
            style={({ pressed }) => [
              styles.basemapSegmentOption,
              controls.basemapMode === 'orthophoto'
                ? styles.basemapSegmentOptionActive
                : null,
              pressed ? styles.buttonPressed : null,
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.basemapSegmentLabel,
                controls.basemapMode === 'orthophoto'
                  ? styles.basemapSegmentLabelActive
                  : null,
              ]}
            >
              {t.aerialCompact}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <PolygonOpacitySlider
        opacity={controls.polygonOpacity}
        compact
        label={t.polygonOpacityLabel}
        accessibilityLabel={t.polygonOpacityA11y}
        {...(onSetPolygonOpacity ? { onChange: onSetPolygonOpacity } : {})}
      />
      {children}
    </View>
  );
}

export interface ProposeFabButtonProps {
  controls: MapControlsModel;
  onPress: () => void;
}

export function ProposeFabButton({
  controls,
  onPress,
}: ProposeFabButtonProps): React.JSX.Element {
  const { palette, isDark } = useTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const t = getTranslations(controls.locale).controls;
  const tooltip = controls.drawDisabledReason ?? t.proposeFull;

  const fabNode = (
    <Pressable
      testID="propose-fab-button"
      accessibilityRole="button"
      accessibilityLabel={t.proposeA11y}
      accessibilityState={{ disabled: !controls.canStartDraw }}
      disabled={!controls.canStartDraw}
      onPress={onPress}
      style={({ pressed }) => [
        styles.proposeFab,
        !controls.canStartDraw ? styles.primaryButtonDisabled : null,
        pressed && controls.canStartDraw ? styles.primaryButtonPressed : null,
        Platform.OS === 'web'
          ? {
              boxShadow: isDark
                ? '0 6px 20px rgba(0, 0, 0, 0.55)'
                : '0 6px 18px rgba(16, 77, 49, 0.34)',
            }
          : styles.nativeFabShadow,
      ]}
    >
      <PlusGlyph color={palette.inkOnAccent} size={22} />
    </Pressable>
  );

  return withWebTooltip(tooltip, fabNode);
}

function createStyles(PALETTE: ThemePalette) {
  return StyleSheet.create({
  barShell: {
    backgroundColor: PALETTE.bgSurface,
    borderBottomWidth: 1,
    borderBottomColor: PALETTE.borderSubtle,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  barShellCompact: {
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  barShellNarrowPhone: {
    paddingHorizontal: 6,
  },
  navbarSingleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    minHeight: 44,
  },
  navbarSingleRowCompact: {
    gap: 5,
  },
  navbarSingleRowNarrowPhone: {
    gap: 4,
  },
  searchSlotWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 130,
    paddingHorizontal: 6,
  },
  navbarSearchPill: {
    width: '100%',
    maxWidth: 420,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: RADII.pill,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    backgroundColor: PALETTE.bgSubtle,
  },
  navbarSearchPlaceholder: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: PALETTE.inkSecondary,
  },
  filterSectionDesktop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  filterSectionCompact: {
    gap: 6,
  },
  filterScrollDesktop: {
    flex: 1,
    minWidth: 0,
  },
  filterStripContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  filterRadioGroupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  filterOrthogonalDivider: {
    width: 1,
    height: 22,
    backgroundColor: PALETTE.borderStrong,
    marginHorizontal: 2,
  },
  filterStripContentCompact: {
    gap: 5,
  },
  filterChip: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: RADII.pill,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    backgroundColor: PALETTE.bgSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterChipCompact: {
    minHeight: 38,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  filterChipActive: {
    backgroundColor: PALETTE.bgTinted,
    borderColor: PALETTE.accentPrimary,
  },
  filterChipWarningActive: {
    backgroundColor: PALETTE.neutralBg,
    borderColor: PALETTE.neutralDot,
  },
  filterChipLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: PALETTE.inkSecondary,
  },
  filterChipLabelCompact: {
    fontSize: 11.5,
  },
  filterChipLabelActive: {
    color: PALETTE.positiveText,
    fontWeight: '700',
  },
  filterChipWarningLabelActive: {
    color: PALETTE.neutralText,
    fontWeight: '700',
  },
  opacityPill: {
    minHeight: MIN_TOUCH_TARGET_DP,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: RADII.pill,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    backgroundColor: PALETTE.bgSubtle,
    flexShrink: 0,
  },
  opacityPillCompact: {
    width: '100%',
    minHeight: 38,
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  opacityValueLabel: {
    ...TABULAR_NUMS_STYLE,
    minWidth: 34,
    textAlign: 'right',
    fontSize: 11.5,
    fontWeight: '700',
    color: PALETTE.inkPrimary,
  },
  nativeSliderTouchArea: {
    height: 30,
    justifyContent: 'center',
    position: 'relative',
  },
  nativeSliderTouchAreaDesktop: {
    width: 96,
  },
  nativeSliderTouchAreaCompact: {
    flex: 1,
    minWidth: 76,
  },
  nativeSliderTrack: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    backgroundColor: PALETTE.borderStrong,
    overflow: 'hidden',
  },
  nativeSliderTrackFill: {
    height: '100%',
    backgroundColor: PALETTE.accentPrimary,
  },
  nativeSliderThumb: {
    position: 'absolute',
    width: 16,
    height: 16,
    marginLeft: -8,
    borderRadius: 8,
    backgroundColor: PALETTE.accentPrimary,
    borderWidth: 2,
    borderColor: PALETTE.bgSurface,
  },
  iconControlButton: {
    paddingHorizontal: 10,
    flexGrow: 0,
    flexShrink: 0,
  },
  trayGlyphFrame: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  trayGlyphShaft: {
    width: 2,
    height: 9,
    borderRadius: 1,
    marginTop: -3,
  },
  trayGlyphShaftUp: {
    marginTop: -2,
  },
  trayGlyphChevronDown: {
    width: 6,
    height: 6,
    borderBottomWidth: 2,
    borderRightWidth: 2,
    transform: [{ rotate: '45deg' }],
    marginTop: -5,
  },
  trayGlyphChevronUp: {
    width: 6,
    height: 6,
    borderTopWidth: 2,
    borderLeftWidth: 2,
    transform: [{ rotate: '45deg' }],
    marginTop: -2,
  },
  trayGlyphBase: {
    position: 'absolute',
    bottom: 2,
    width: 14,
    height: 5,
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
  },
  androidFallbackFrame: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1.5,
  },
  androidFallbackHead: {
    width: 12,
    height: 6,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    paddingTop: 1,
  },
  androidFallbackEye: {
    width: 2,
    height: 2,
    borderRadius: 1,
  },
  androidFallbackBody: {
    width: 12,
    height: 8,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
  },
  brandAndAccountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    flexShrink: 1,
    minWidth: 0,
  },
  rightHeaderCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
    minWidth: 0,
  },
  rightHeaderClusterCompact: {
    gap: 4,
    flexShrink: 0,
  },
  rightHeaderClusterNarrowPhone: {
    gap: 3,
  },
  brandGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
    minWidth: 0,
  },
  brandGroupCompact: {
    gap: 5,
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  brandGroupTitleless: {
    flex: 0,
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
  },
  brandMark: {
    width: 28,
    height: 28,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
    backgroundColor: PALETTE.bgGround,
    overflow: 'hidden',
    position: 'relative',
    flexShrink: 0,
  },
  brandMarkCompact: {
    width: 24,
    height: 24,
    borderRadius: 6,
  },
  brandMarkImage: {
    width: '100%',
    height: '100%',
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  titleInlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    minWidth: 0,
    overflow: 'hidden',
  },
  titleInlineRowCompact: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.35,
    color: PALETTE.inkPrimary,
    flexShrink: 1,
    minWidth: 0,
  },
  titleCompact: {
    fontSize: 15.5,
    letterSpacing: -0.35,
  },
  titleVeryNarrow: {
    fontSize: 14.5,
  },
  countBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADII.pill,
    backgroundColor: PALETTE.bgTinted,
    borderWidth: 1,
    borderColor: PALETTE.positiveBorder,
    flexShrink: 0,
  },
  countBadgeCompact: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    gap: 3,
  },
  countBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: PALETTE.accentPrimary,
  },
  countBadgeLabel: {
    ...TABULAR_NUMS_STYLE,
    fontSize: 11,
    fontWeight: '700',
    color: PALETTE.positiveText,
  },
  subtitle: {
    fontSize: 12,
    color: PALETTE.inkMuted,
  },
  attributionText: {
    fontSize: 11,
    color: PALETTE.inkMuted,
  },
  helpButton: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: RADII.pill,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    backgroundColor: PALETTE.bgSurface,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  helpButtonCompact: {
    minHeight: 36,
    minWidth: 36,
    paddingHorizontal: 6,
    paddingVertical: 5,
  },
  helpButtonNarrowPhone: {
    minHeight: 35,
    minWidth: 35,
    paddingHorizontal: 5,
    paddingVertical: 5,
  },
  helpButtonActive: {
    backgroundColor: PALETTE.bgTinted,
    borderColor: PALETTE.accentPrimary,
  },
  helpButtonLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: PALETTE.inkPrimary,
  },
  localePill: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: RADII.pill,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    backgroundColor: PALETTE.bgSurface,
    flexShrink: 0,
  },
  localePillCompact: {
    minHeight: 36,
    minWidth: 42,
    paddingHorizontal: 6,
    paddingVertical: 5,
    gap: 2,
  },
  localePillNarrow: {
    minHeight: 35,
    minWidth: 38,
    paddingHorizontal: 4,
    paddingVertical: 5,
    gap: 1.5,
  },
  localeCodeLabel: {
    fontSize: 11,
    letterSpacing: 0.2,
  },
  localeCodeLabelNarrow: {
    fontSize: 10.5,
    letterSpacing: 0.1,
  },
  localeCodeActive: {
    fontWeight: '800',
    color: PALETTE.positiveText,
  },
  localeCodeInactive: {
    fontWeight: '600',
    color: PALETTE.inkMuted,
  },
  localeDivider: {
    fontSize: 11,
    color: PALETTE.borderStrong,
  },
  accountChip: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    maxWidth: 176,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: RADII.pill,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    backgroundColor: PALETTE.bgSubtle,
    overflow: 'hidden',
    flexShrink: 1,
  },
  accountChipCompact: {
    minHeight: 36,
    paddingHorizontal: 8,
    paddingVertical: 5,
    gap: 4,
    maxWidth: 104,
  },
  accountChipNarrowPhone: {
    minHeight: 35,
    paddingHorizontal: 6,
    paddingVertical: 5,
    gap: 3,
    maxWidth: 94,
  },
  accountChipVeryNarrow: {
    paddingHorizontal: 6,
    maxWidth: 88,
  },
  accountChipIconOnly: {
    minWidth: 36,
    paddingHorizontal: 5,
    gap: 2,
  },
  navIconGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  navIconGroupCompact: {
    gap: 4,
  },
  navIconButton: {
    width: MIN_TOUCH_TARGET_DP,
    height: MIN_TOUCH_TARGET_DP,
    borderRadius: RADII.pill,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    backgroundColor: PALETTE.bgSurface,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  navIconButtonCompact: {
    width: 36,
    height: 36,
  },
  navIconButtonActive: {
    backgroundColor: PALETTE.accentPrimary,
    borderColor: PALETTE.accentPrimary,
  },
  navIconBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: PALETTE.dangerDot,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navIconBadgeLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  accountChipMediumHeader: {
    paddingHorizontal: 10,
    maxWidth: 124,
  },
  accountChipActive: {
    backgroundColor: PALETTE.bgTinted,
    borderColor: PALETTE.accentPrimary,
  },
  accountStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    flexShrink: 0,
  },
  accountStatusDotGuest: {
    backgroundColor: PALETTE.inkMuted,
  },
  accountStatusDotOnline: {
    backgroundColor: PALETTE.accentPrimary,
  },
  accountChipLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: PALETTE.inkPrimary,
    flexShrink: 1,
    minWidth: 0,
    overflow: 'hidden',
  },
  accountChipLabelCompact: {
    fontSize: 11.5,
  },
  accountChipLabelNarrowPhone: {
    fontSize: 11,
  },
  accountChipLabelActive: {
    color: PALETTE.positiveText,
    fontWeight: '700',
  },
  controlsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  controlsRowCompact: {
    flexWrap: 'nowrap',
    gap: 6,
  },
  controlsRowExpanded: {
    flexWrap: 'nowrap',
    justifyContent: 'flex-end',
  },
  controlButton: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: RADII.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlButtonCompact: {
    flex: 0.9,
    paddingHorizontal: 7,
  },
  controlButtonCompactPrimary: {
    flex: 1.35,
    paddingHorizontal: 9,
  },
  controlButtonMediumStretch: {
    flex: 1,
  },
  controlButtonMediumPrimaryStretch: {
    flex: 1.25,
  },
  primaryButton: {
    backgroundColor: PALETTE.accentPrimary,
    borderWidth: 1,
    borderColor: PALETTE.accentPrimaryStrong,
  },
  primaryButtonPressed: {
    backgroundColor: PALETTE.accentPrimaryStrong,
  },
  primaryButtonDisabled: {
    backgroundColor: PALETTE.accentDisabled,
    borderColor: PALETTE.accentDisabled,
  },
  primaryButtonLabel: {
    color: PALETTE.inkOnAccent,
    fontSize: 13,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: PALETTE.bgSurface,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
  },
  secondaryButtonSelected: {
    backgroundColor: PALETTE.accentPrimaryStrong,
    borderColor: PALETTE.accentPrimaryStrong,
  },
  secondaryButtonLabel: {
    color: PALETTE.inkPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  secondaryButtonLabelSelected: {
    color: PALETTE.inkOnAccent,
  },
  adminImportButton: {
    backgroundColor: PALETTE.finishedBg,
    borderWidth: 1,
    borderColor: PALETTE.finishedBorder,
  },
  adminImportLabel: {
    color: PALETTE.finishedText,
    fontSize: 13,
    fontWeight: '700',
  },
  compactButtonLabel: {
    fontSize: 12,
  },
  buttonPressed: {
    backgroundColor: PALETTE.bgRecessed,
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  bugFallbackFrame: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  bugFallbackHead: {
    width: 6,
    height: 3.5,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    marginBottom: -0.5,
  },
  bugFallbackBody: {
    width: 9,
    height: 10,
    borderRadius: 4.5,
    borderWidth: 1.7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bugFallbackSeam: {
    width: 1.5,
    height: 7,
  },
  bugFallbackLegRow: {
    position: 'absolute',
    left: 1,
    right: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  bugFallbackLegTop: {
    top: 8,
  },
  bugFallbackLegBottom: {
    top: 12.5,
  },
  bugFallbackLeg: {
    width: 3,
    height: 1.6,
    borderRadius: 0.8,
  },
  themeGlyphFrame: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  sunFallbackCore: {
    width: 11,
    height: 11,
    borderRadius: 5.5,
    borderWidth: 2,
  },
  moonFallbackCrescent: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderLeftWidth: 2.4,
    borderBottomWidth: 2.4,
    transform: [{ rotate: '-20deg' }],
  },
  statsGlyphFrame: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 2,
    paddingBottom: 2,
  },
  statsGlyphBar: {
    width: 2.6,
    borderRadius: 1.3,
  },
  floatingFilterScroll: {
    flexGrow: 0,
  },
  floatingFilterChip: {
    minHeight: 38,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: RADII.pill,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    backgroundColor: PALETTE.bgFloatingPill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nativeChipShadow: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  popoverCard: {
    minWidth: 220,
    maxWidth: '100%',
    padding: 12,
    borderRadius: RADII.lg,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    backgroundColor: PALETTE.bgSurface,
    gap: 10,
  },
  overflowMenuCard: {
    padding: 0,
    maxHeight: '100%',
    overflow: 'hidden',
  },
  overflowMenuScrollContent: {
    padding: 12,
    gap: 10,
  },
  menuLocaleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: RADII.sm,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    backgroundColor: PALETTE.bgSubtle,
    flexShrink: 0,
  },
  layersPopoverCard: {
    minWidth: 216,
  },
  layersPopoverCardCompact: {
    padding: 9,
    gap: 7,
  },
  nativePopoverShadow: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 12,
    elevation: 10,
  },
  menuSection: {
    gap: 4,
  },
  menuSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: PALETTE.inkMuted,
    paddingHorizontal: 6,
    paddingBottom: 2,
  },
  menuItemRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: RADII.md,
  },
  menuItemPressed: {
    backgroundColor: PALETTE.bgRecessed,
  },
  menuItemLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: PALETTE.inkPrimary,
  },
  basemapSegmentGroup: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.bgRecessed,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
    gap: 3,
  },
  basemapSegmentOption: {
    flex: 1,
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: RADII.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  basemapSegmentOptionActive: {
    backgroundColor: PALETTE.bgSurface,
    borderWidth: 1,
    borderColor: PALETTE.borderAccent,
  },
  basemapSegmentLabel: {
    fontSize: 12.5,
    fontWeight: '600',
    color: PALETTE.inkSecondary,
  },
  basemapSegmentLabelActive: {
    color: PALETTE.accentPrimary,
    fontWeight: '700',
  },
  proposeFab: {
    width: 48,
    height: 48,
    borderRadius: RADII.pill,
    backgroundColor: PALETTE.accentPrimary,
    borderWidth: 1,
    borderColor: PALETTE.accentPrimaryStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nativeFabShadow: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.34,
    shadowRadius: 8,
    elevation: 8,
  },
  });
}
