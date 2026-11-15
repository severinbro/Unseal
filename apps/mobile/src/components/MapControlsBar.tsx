import type { PolygonFilter } from '@entsiegelung/shared';
import React from 'react';
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
import { clampPolygonOpacity } from '../map/styleBuilder';
import type { BasemapMode } from '../state/appState';
import {
  MIN_TOUCH_TARGET_DP,
  type MapControlsModel,
} from '../state/viewModels';
import {
  PALETTE,
  RADII,
  TABULAR_NUMS_STYLE,
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

export async function triggerApkDownload(apkUrl: string): Promise<void> {
  await triggerFileDownload(apkUrl, 'unseal.apk');
}

export interface MapControlsBarProps {
  controls: MapControlsModel;
  proposalCount: number;
  exportGeoJsonUrl: string;
  isImporting?: boolean;
  tier?: ViewportTier;
  onToggleLocale?: () => void;
  onOpenAbout?: () => void;
  onSetBasemapMode: (mode: BasemapMode) => void;
  onSetPolygonOpacity?: (opacity: number) => void;
  onSetPolygonFilter?: (filter: PolygonFilter) => void;
  onStartDraw: () => void;
  onOpenAccount: () => void;
  onImportPress?: () => void;
  onExportError: (message: string) => void;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const UNSEAL_HEADER_LOGO = require('../../assets/header-logo.png') as number;

export function AndroidGlyph({
  color = PALETTE.accentPrimary,
  eyeColor = PALETTE.bgSurface,
  size = 20,
}: {
  color?: string;
  eyeColor?: string;
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
        style: {
          flexShrink: 0,
          display: 'block',
        },
      },
      React.createElement('path', {
        d: 'M8.5 6.2L6.8 3.4M15.5 6.2L17.2 3.4',
        stroke: color,
        strokeWidth: '1.7',
        strokeLinecap: 'round',
      }),
      React.createElement('path', {
        d: 'M6 11C6 7.686 8.686 5 12 5C15.314 5 18 7.686 18 11H6Z',
        fill: color,
      }),
      React.createElement('circle', {
        cx: '9.6',
        cy: '8.6',
        r: '1',
        fill: eyeColor,
      }),
      React.createElement('circle', {
        cx: '14.4',
        cy: '8.6',
        r: '1',
        fill: eyeColor,
      }),
      React.createElement('rect', {
        x: '6',
        y: '12',
        width: '12',
        height: '6.8',
        rx: '1.5',
        fill: color,
      }),
      React.createElement('rect', {
        x: '3.2',
        y: '12',
        width: '1.8',
        height: '5.4',
        rx: '0.9',
        fill: color,
      }),
      React.createElement('rect', {
        x: '19',
        y: '12',
        width: '1.8',
        height: '5.4',
        rx: '0.9',
        fill: color,
      }),
      React.createElement('rect', {
        x: '8.5',
        y: '18.4',
        width: '2',
        height: '3.4',
        rx: '1',
        fill: color,
      }),
      React.createElement('rect', {
        x: '13.5',
        y: '18.4',
        width: '2',
        height: '3.4',
        rx: '1',
        fill: color,
      }),
    );
  }

  return (
    <View
      accessible={false}
      style={[
        styles.androidFallbackFrame,
        { width: size, height: size },
      ]}
    >
      <View style={[styles.androidFallbackHead, { backgroundColor: color }]}>
        <View
          style={[styles.androidFallbackEye, { backgroundColor: eyeColor }]}
        />
        <View
          style={[styles.androidFallbackEye, { backgroundColor: eyeColor }]}
        />
      </View>
      <View style={[styles.androidFallbackBody, { backgroundColor: color }]} />
    </View>
  );
}

function withWebTooltip(
  tooltip: string,
  child: React.JSX.Element,
): React.JSX.Element {
  if (Platform.OS !== 'web') {
    return child;
  }
  return React.createElement(
    'div',
    {
      title: tooltip,
      style: { display: 'inline-flex', flexShrink: 0 },
    },
    child,
  );
}

export function ExportGlyph({
  color = PALETTE.inkPrimary,
  size = 20,
}: {
  color?: string;
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
        style: {
          flexShrink: 0,
          display: 'block',
        },
      },
      React.createElement('path', {
        d: 'M12 3.75V15.25',
        stroke: color,
        strokeWidth: '1.9',
        strokeLinecap: 'round',
      }),
      React.createElement('path', {
        d: 'M7.5 10.75L12 15.25L16.5 10.75',
        stroke: color,
        strokeWidth: '1.9',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
      React.createElement('path', {
        d: 'M4.5 16.5V18.5C4.5 19.605 5.395 20.5 6.5 20.5H17.5C18.605 20.5 19.5 19.605 19.5 18.5V16.5',
        stroke: color,
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
      <View style={[styles.trayGlyphShaft, { backgroundColor: color }]} />
      <View
        style={[
          styles.trayGlyphChevronDown,
          { borderBottomColor: color, borderRightColor: color },
        ]}
      />
      <View style={[styles.trayGlyphBase, { borderColor: color }]} />
    </View>
  );
}

export function ImportGlyph({
  color = PALETTE.finishedText,
  size = 20,
}: {
  color?: string;
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
        style: {
          flexShrink: 0,
          display: 'block',
        },
      },
      React.createElement('path', {
        d: 'M12 15.25V3.75',
        stroke: color,
        strokeWidth: '1.9',
        strokeLinecap: 'round',
      }),
      React.createElement('path', {
        d: 'M7.5 8.25L12 3.75L16.5 8.25',
        stroke: color,
        strokeWidth: '1.9',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
      React.createElement('path', {
        d: 'M4.5 16.5V18.5C4.5 19.605 5.395 20.5 6.5 20.5H17.5C18.605 20.5 19.5 19.605 19.5 18.5V16.5',
        stroke: color,
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
          { borderTopColor: color, borderLeftColor: color },
        ]}
      />
      <View
        style={[
          styles.trayGlyphShaft,
          styles.trayGlyphShaftUp,
          { backgroundColor: color },
        ]}
      />
      <View style={[styles.trayGlyphBase, { borderColor: color }]} />
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
                minWidth: '76px',
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
}: {
  compact: boolean;
}): React.JSX.Element {
  const size = compact ? 24 : 28;
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
          boxShadow: 'inset 0 0 0 1px rgba(17, 29, 24, 0.14)',
        },
      },
      React.createElement('rect', {
        width: '64',
        height: '64',
        rx: '14',
        fill: '#EFF3F0',
      }),
      React.createElement('path', {
        d: 'M0 40H26L31 50L37 40H64V50C64 57.732 57.732 64 50 64H14C6.26801 64 0 57.732 0 50V40Z',
        fill: '#5A6360',
      }),
      React.createElement('path', {
        d: 'M31 49C31 38 32 30 37 22',
        stroke: '#176642',
        strokeWidth: '4',
        strokeLinecap: 'round',
      }),
      React.createElement('path', {
        d: 'M34 26C35 16 44 13 49 15C48 22 42 27 34 26Z',
        fill: '#1F7A4C',
      }),
      React.createElement('path', {
        d: 'M31 34C29 27 22 25 18 26C19 31 25 35 31 34Z',
        fill: '#176642',
      }),
    );
  }

  return (
    <View
      style={[styles.brandMark, compact ? styles.brandMarkCompact : null]}
      accessible={false}
    >
      <Image
        source={UNSEAL_HEADER_LOGO}
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
  accessibilityLabel,
  onPress,
}: {
  locale: Locale;
  compact: boolean;
  accessibilityLabel: string;
  onPress?: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        styles.localePill,
        compact ? styles.localePillCompact : null,
        pressed ? styles.buttonPressed : null,
      ]}
    >
      <Text
        style={[
          styles.localeCodeLabel,
          locale === 'de' ? styles.localeCodeActive : styles.localeCodeInactive,
        ]}
      >
        DE
      </Text>
      <Text style={styles.localeDivider}>|</Text>
      <Text
        style={[
          styles.localeCodeLabel,
          locale === 'en' ? styles.localeCodeActive : styles.localeCodeInactive,
        ]}
      >
        EN
      </Text>
    </Pressable>
  );
}

export function MapControlsBar({
  controls,
  proposalCount,
  exportGeoJsonUrl,
  isImporting = false,
  tier = 'expanded',
  onToggleLocale,
  onOpenAbout,
  onSetBasemapMode,
  onSetPolygonOpacity,
  onSetPolygonFilter,
  onStartDraw,
  onOpenAccount,
  onImportPress,
  onExportError,
}: MapControlsBarProps): React.JSX.Element {
  const isCompact = tier === 'compact';
  const isExpanded = tier === 'expanded';
  const locale = controls.locale;
  const t = getTranslations(locale).controls;

  const nextBasemapMode: BasemapMode =
    controls.basemapMode === 'osm' ? 'orthophoto' : 'osm';

  const handleExportPress = (): void => {
    void triggerGeoJsonExportDownload(exportGeoJsonUrl).catch(
      (err: unknown) => {
        const detail = localizeError(err, t.exportErrorFallback, locale);
        onExportError(detail);
      },
    );
  };

  const showApkDownloadButton =
    Platform.OS === 'web' &&
    controls.apkDownloadUrl !== null &&
    controls.apkDownloadUrl.length > 0;

  const handleApkDownloadPress = (): void => {
    if (!controls.apkDownloadUrl) {
      return;
    }
    void triggerApkDownload(controls.apkDownloadUrl).catch((err: unknown) => {
      const detail = localizeError(err, t.apkDownloadErrorFallback, locale);
      onExportError(detail);
    });
  };

  const accountButtonA11y = controls.isAuthenticated
    ? t.accountSettingsA11y(controls.accountLabel)
    : t.signInOrRegisterA11y;

  const utilityControls = (
    <>
      {showApkDownloadButton
        ? withWebTooltip(
            t.apkDownloadFull,
            <Pressable
              testID="download-apk-button"
              accessibilityRole="button"
              accessibilityLabel={t.apkDownloadFull}
              accessibilityHint={t.apkDownloadA11y}
              onPress={handleApkDownloadPress}
              style={({ pressed }) => [
                styles.helpButton,
                isCompact ? styles.helpButtonCompact : null,
                pressed ? styles.buttonPressed : null,
              ]}
            >
              <AndroidGlyph
                color={PALETTE.accentPrimary}
                eyeColor={PALETTE.bgSurface}
                size={isCompact ? 18 : 20}
              />
            </Pressable>,
          )
        : null}
      {onOpenAbout ? (
        <Pressable
          testID="about-modal-button"
          accessibilityRole="button"
          accessibilityLabel={t.aboutButtonA11y}
          onPress={onOpenAbout}
          style={({ pressed }) => [
            styles.helpButton,
            isCompact ? styles.helpButtonCompact : null,
            pressed ? styles.buttonPressed : null,
          ]}
        >
          <Text style={styles.helpButtonLabel}>?</Text>
        </Pressable>
      ) : null}
      <LocaleTogglePill
        locale={locale}
        compact={isCompact}
        accessibilityLabel={t.switchLocaleA11y}
        {...(onToggleLocale ? { onPress: onToggleLocale } : {})}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accountButtonA11y}
        onPress={onOpenAccount}
        style={({ pressed }) => [
          styles.accountChip,
          isCompact ? styles.accountChipCompact : null,
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
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={[
            styles.accountChipLabel,
            isCompact ? styles.accountChipLabelCompact : null,
            controls.isAuthenticated ? styles.accountChipLabelActive : null,
          ]}
        >
          {controls.accountLabel}
        </Text>
      </Pressable>
    </>
  );

  return (
    <View
      style={[
        styles.barShell,
        isCompact ? styles.barShellCompact : null,
        isExpanded ? styles.barShellExpanded : null,
      ]}
    >
      <View
        style={isExpanded ? styles.topBarExpandedRow : styles.topBarStacked}
      >
        <View style={styles.brandAndAccountRow}>
        <View
          style={[
            styles.brandGroup,
            isCompact ? styles.brandGroupCompact : null,
          ]}
        >
          <ParcelUnsealMark compact={isCompact} />
          <View style={styles.titleBlock}>
            <View style={styles.titleInlineRow}>
              {Platform.OS === 'web' ? (
                React.createElement(
                  'h1',
                  {
                    style: {
                      margin: 0,
                      padding: 0,
                      fontSize: isCompact ? '16px' : '18px',
                      fontWeight: 700,
                      letterSpacing: '-0.35px',
                      lineHeight: '20px',
                      color: PALETTE.inkPrimary,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      minWidth: 0,
                      flexShrink: 1,
                      fontFamily:
                        'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                    },
                  },
                  'Unseal',
                )
              ) : (
                <Text
                  accessibilityRole="header"
                  aria-level={1}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  style={[styles.title, isCompact ? styles.titleCompact : null]}
                >
                  Unseal
                </Text>
              )}
              <View
                style={[
                  styles.countBadge,
                  isCompact ? styles.countBadgeCompact : null,
                ]}
              >
                <View style={styles.countBadgeDot} />
                <Text style={styles.countBadgeLabel}>
                  {isCompact
                    ? `${proposalCount}`
                    : `${proposalCount} ${t.inViewSuffix}`}
                </Text>
              </View>
            </View>
            {!isCompact ? (
              <Text numberOfLines={1} style={styles.subtitle}>
                {controls.basemapMode === 'orthophoto'
                  ? t.subtitleOrthophoto
                  : t.subtitleOsm}
                {controls.basemapMode === 'orthophoto' &&
                controls.orthophotoAttribution &&
                controls.orthophotoAttribution.length > 0
                  ? ` · ${controls.orthophotoAttribution}`
                  : ` · ${t.osmAttributionShort}`}
              </Text>
            ) : controls.basemapMode === 'orthophoto' &&
              controls.orthophotoAttribution &&
              controls.orthophotoAttribution.length > 0 ? (
              <Text numberOfLines={1} style={styles.attributionText}>
                {t.imageryPrefix} {controls.orthophotoAttribution}
              </Text>
            ) : null}
          </View>
        </View>

        {!isExpanded ? (
          <View
            style={[
              styles.rightHeaderCluster,
              isCompact ? styles.rightHeaderClusterCompact : null,
            ]}
          >
            {utilityControls}
          </View>
        ) : null}
      </View>

      <View
        style={[
          styles.controlsRow,
          isCompact ? styles.controlsRowCompact : null,
          isExpanded ? styles.controlsRowExpanded : null,
        ]}
      >
        {controls.showOrthophotoToggle ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              controls.basemapMode === 'osm'
                ? t.switchToOrthoA11y
                : t.switchToOsmA11y
            }
            accessibilityState={{
              selected: controls.basemapMode === 'orthophoto',
            }}
            onPress={() => onSetBasemapMode(nextBasemapMode)}
            style={({ pressed }) => [
              styles.controlButton,
              isCompact ? styles.controlButtonCompact : null,
              styles.secondaryButton,
              controls.basemapMode === 'orthophoto'
                ? styles.secondaryButtonSelected
                : null,
              pressed ? styles.buttonPressed : null,
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.secondaryButtonLabel,
                isCompact ? styles.compactButtonLabel : null,
                controls.basemapMode === 'orthophoto'
                  ? styles.secondaryButtonLabelSelected
                  : null,
              ]}
            >
              {isCompact
                ? controls.basemapMode === 'osm'
                  ? t.aerialCompact
                  : t.streetCompact
                : controls.basemapMode === 'osm'
                  ? t.aerialFull
                  : t.streetFull}
            </Text>
          </Pressable>
        ) : null}

        {withWebTooltip(
          t.exportFull,
          <Pressable
            testID="export-geojson-button"
            accessibilityRole="button"
            accessibilityLabel={t.exportFull}
            accessibilityHint={t.exportA11y}
            onPress={handleExportPress}
            style={({ pressed }) => [
              styles.controlButton,
              styles.iconControlButton,
              styles.secondaryButton,
              pressed ? styles.buttonPressed : null,
            ]}
          >
            <ExportGlyph color={PALETTE.inkPrimary} size={20} />
          </Pressable>,
        )}

        {controls.isAdmin && onImportPress
          ? withWebTooltip(
              isImporting ? t.importingBusy : t.importFull,
              <Pressable
                testID="import-polygons-button"
                accessibilityRole="button"
                accessibilityLabel={isImporting ? t.importingBusy : t.importFull}
                accessibilityHint={t.importA11y}
                accessibilityState={{ disabled: isImporting, busy: isImporting }}
                disabled={isImporting}
                onPress={onImportPress}
                style={({ pressed }) => [
                  styles.controlButton,
                  styles.iconControlButton,
                  styles.adminImportButton,
                  isImporting ? styles.buttonDisabled : null,
                  pressed && !isImporting ? styles.buttonPressed : null,
                ]}
              >
                {isImporting ? (
                  <ActivityIndicator size="small" color={PALETTE.finishedText} />
                ) : (
                  <ImportGlyph color={PALETTE.finishedText} size={20} />
                )}
              </Pressable>,
            )
          : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.proposeA11y}
          accessibilityState={{ disabled: !controls.canStartDraw }}
          disabled={!controls.canStartDraw}
          onPress={onStartDraw}
          style={({ pressed }) => [
            styles.controlButton,
            isCompact ? styles.controlButtonCompactPrimary : null,
            styles.primaryButton,
            !controls.canStartDraw ? styles.primaryButtonDisabled : null,
            pressed && controls.canStartDraw
              ? styles.primaryButtonPressed
              : null,
          ]}
        >
          <Text
            numberOfLines={1}
            style={[
              styles.primaryButtonLabel,
              isCompact ? styles.compactButtonLabel : null,
            ]}
          >
            {isCompact ? t.proposeCompact : t.proposeFull}
          </Text>
        </Pressable>

        {isExpanded ? utilityControls : null}
        </View>
      </View>

      <View
        style={
          isCompact ? styles.filterSectionCompact : styles.filterSectionDesktop
        }
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={isCompact ? undefined : styles.filterScrollDesktop}
          contentContainerStyle={[
            styles.filterStripContent,
            isCompact ? styles.filterStripContentCompact : null,
          ]}
          accessibilityRole="radiogroup"
          accessibilityLabel={t.filterGroupA11y}
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
              styles.filterChip,
              isCompact ? styles.filterChipCompact : null,
              controls.polygonFilter === 'all' ? styles.filterChipActive : null,
              pressed ? styles.buttonPressed : null,
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.filterChipLabel,
                isCompact ? styles.filterChipLabelCompact : null,
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
              styles.filterChip,
              isCompact ? styles.filterChipCompact : null,
              controls.polygonFilter === 'new' ? styles.filterChipActive : null,
              pressed ? styles.buttonPressed : null,
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.filterChipLabel,
                isCompact ? styles.filterChipLabelCompact : null,
                controls.polygonFilter === 'new'
                  ? styles.filterChipLabelActive
                  : null,
              ]}
            >
              {isCompact ? t.filterNewCompact : t.filterNewFull}
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
              styles.filterChip,
              isCompact ? styles.filterChipCompact : null,
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
                isCompact ? styles.filterChipLabelCompact : null,
                controls.polygonFilter === 'established'
                  ? styles.filterChipLabelActive
                  : null,
              ]}
            >
              {isCompact
                ? t.filterEstablishedCompact
                : t.filterEstablishedFull}
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
              styles.filterChip,
              isCompact ? styles.filterChipCompact : null,
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
                isCompact ? styles.filterChipLabelCompact : null,
                controls.polygonFilter === 'needs_review'
                  ? styles.filterChipWarningLabelActive
                  : null,
              ]}
            >
              {isCompact
                ? t.filterNeedsReviewCompact
                : t.filterNeedsReviewFull}
            </Text>
          </Pressable>
        </ScrollView>

        <PolygonOpacitySlider
          opacity={controls.polygonOpacity}
          compact={isCompact}
          label={t.polygonOpacityLabel}
          accessibilityLabel={t.polygonOpacityA11y}
          {...(onSetPolygonOpacity ? { onChange: onSetPolygonOpacity } : {})}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  barShell: {
    backgroundColor: PALETTE.bgSurface,
    borderBottomWidth: 1,
    borderBottomColor: PALETTE.borderSubtle,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  barShellCompact: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  barShellExpanded: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    gap: 8,
  },
  topBarStacked: {
    gap: 8,
  },
  topBarExpandedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
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
    maxWidth: '72%',
    flexShrink: 1,
  },
  brandGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  brandGroupCompact: {
    gap: 6,
  },
  brandMark: {
    width: 28,
    height: 28,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
    backgroundColor: '#EFF3F0',
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
    minWidth: 0,
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
    fontSize: 16,
    letterSpacing: -0.35,
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
    paddingHorizontal: 8,
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
    paddingHorizontal: 6,
    gap: 2,
  },
  localeCodeLabel: {
    fontSize: 11,
    letterSpacing: 0.2,
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
    paddingHorizontal: 8,
    gap: 4,
    maxWidth: 100,
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
});
