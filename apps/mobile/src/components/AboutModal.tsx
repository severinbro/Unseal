// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import {
  DEFAULT_APP_NAME,
  type BrandingConfig,
  type RuntimeConfig,
} from '@openunseal/shared';
import React, { useMemo } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  DEFAULT_LOCALE,
  formatVg250ShortAttribution,
  getTranslations,
  localizeError,
  type Locale,
} from '../i18n/translations';
import { MIN_TOUCH_TARGET_DP } from '../state/viewModels';
import { useTheme } from '../theme/themeContext';
import { RADII, type ThemePalette } from '../theme/tokens';
import { InstallAppGlyph } from './MapControlsBar';

const DEFAULT_CANONICAL_SOURCE_CODE_URL =
  'https://github.com/severinbro/Unseal';
const BKG_VG250_DATENQUELLEN_URL =
  'https://sg.geodatenzentrum.de/web_public/gdz/datenquellen/datenquellen_vg_nuts.pdf';

export interface AboutModalProps {
  visible: boolean;
  locale?: Locale;
  compact?: boolean;
  branding?: BrandingConfig | null | undefined;
  osmStyleUrl?: string | undefined;
  orthophoto?: RuntimeConfig['orthophoto'] | undefined;
  vg250AttributionEnabled?: boolean | undefined;
  vg250DataYear?: number | null | undefined;
  privacyPolicyUrl: string;
  impressumUrl?: string | undefined;
  termsUrl?: string | undefined;
  licensesUrl?: string | undefined;
  sourceCodeUrl?: string | null | undefined;
  abuseContact: string | null;
  onClose: () => void;
  onOpenInstallApp?: () => void;
}

function safeHostOf(url: string | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function openExternalUrl(url: string): void {
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

export function AboutModal({
  visible,
  locale = DEFAULT_LOCALE,
  compact = false,
  branding,
  osmStyleUrl,
  orthophoto,
  vg250AttributionEnabled,
  vg250DataYear,
  privacyPolicyUrl,
  impressumUrl,
  termsUrl,
  licensesUrl,
  sourceCodeUrl,
  abuseContact,
  onClose,
  onOpenInstallApp,
}: AboutModalProps): React.JSX.Element | null {
  const { palette } = useTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);

  if (!visible) {
    return null;
  }

  const dict = getTranslations(locale);
  const t = dict.about;
  const appName = branding?.appName?.trim() || DEFAULT_APP_NAME;
  const isCustomBrand = appName !== DEFAULT_APP_NAME;
  const headingTitle = isCustomBrand ? t.aboutNamedTitle(appName) : t.title;
  const customSubtitle =
    (locale === 'en' ? branding?.subtitleEn : branding?.subtitleDe)?.trim() ||
    null;
  const headingSubtitle = customSubtitle ?? t.subtitle;
  const portalUrl = branding?.portalUrl?.trim() || null;
  const portalLabel = branding?.portalLabel?.trim() || t.defaultPortalLinkLabel;
  const showInstallButton = Platform.OS === 'web' && onOpenInstallApp !== undefined;

  return (
    <View
      testID="about-modal-card"
      accessibilityLabel={headingTitle}
      style={[styles.card, compact ? styles.cardCompact : null]}
    >
      <View style={styles.headerRow}>
        <View style={styles.headerTextGroup}>
          <Text style={styles.title}>{headingTitle}</Text>
          <Text style={styles.subtitle}>{headingSubtitle}</Text>
          <Text style={styles.introText}>{t.introBody}</Text>
        </View>
        <Pressable
          testID="about-modal-close"
          accessibilityRole="button"
          accessibilityLabel={t.closeA11y}
          onPress={onClose}
          style={({ pressed }) => [
            styles.closeButton,
            pressed ? styles.buttonPressed : null,
          ]}
        >
          <Text style={styles.closeButtonLabel}>{t.close}</Text>
        </Pressable>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>{t.featuresTitle}</Text>
        <View style={styles.bulletList}>
          <View style={styles.bulletRow}>
            <Text style={styles.bulletMarker}>•</Text>
            <Text style={styles.bulletText}>{t.featureMapBullet}</Text>
          </View>
          <View style={styles.bulletRow}>
            <Text style={styles.bulletMarker}>•</Text>
            <Text style={styles.bulletText}>{t.featureReviewBullet}</Text>
          </View>
          <View style={styles.bulletRow}>
            <Text style={styles.bulletMarker}>•</Text>
            <Text style={styles.bulletText}>{t.featureControlsBullet}</Text>
          </View>
          <View style={styles.bulletRow}>
            <Text style={styles.bulletMarker}>•</Text>
            <Text style={styles.bulletText}>{t.featureDataBullet}</Text>
          </View>
        </View>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>{t.legendTitle}</Text>
        <View style={styles.bulletList}>
          <View style={styles.statusItem}>
            <View style={styles.dotGroup}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: palette.positiveDot },
                ]}
              />
            </View>
            <Text style={styles.bulletText}>{t.legendSupported}</Text>
          </View>
          <View style={styles.statusItem}>
            <View style={styles.dotGroup}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: palette.neutralDot },
                ]}
              />
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: palette.dangerDot },
                ]}
              />
            </View>
            <Text style={styles.bulletText}>{t.legendNewContested}</Text>
          </View>
          <View style={styles.statusItem}>
            <View style={styles.dotGroup}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: palette.inProgressDot },
                ]}
              />
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: palette.finishedDot },
                ]}
              />
            </View>
            <Text style={styles.bulletText}>{t.legendLifecycle}</Text>
          </View>
        </View>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>{t.footerTitle}</Text>
        <Text style={styles.subtleNote}>{t.privacyAndLicenseBody}</Text>
        {isCustomBrand ? (
          <Text testID="about-powered-by-openunseal" style={styles.subtleNote}>
            {t.poweredByOpenUnseal}
          </Text>
        ) : null}
        {abuseContact && abuseContact.trim().length > 0 ? (
          <Text style={styles.subtleNote}>
            {dict.inspector.abuseContactPrefix}{' '}
            {/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(abuseContact.trim()) ? (
              <Text
                accessibilityRole="link"
                onPress={() => openExternalUrl(`mailto:${abuseContact.trim()}`)}
                style={styles.attributionChipText}
              >
                {abuseContact.trim()}
              </Text>
            ) : (
              abuseContact
            )}
          </Text>
        ) : null}

        <View style={styles.attributionChipsRow}>
          {(() => {
            const styleHost = safeHostOf(osmStyleUrl);
            const usesOpenFreeMap =
              osmStyleUrl === undefined || styleHost === 'tiles.openfreemap.org';
            const basemapLabel = usesOpenFreeMap
              ? t.attributionOsmShort
              : styleHost
                ? `Basemap: ${styleHost}`
                : t.attributionOsmShort;
            const basemapLink = usesOpenFreeMap
              ? 'https://www.openstreetmap.org/copyright'
              : licensesUrl ?? 'https://www.openstreetmap.org/copyright';
            const isBuiltinDop20 =
              orthophoto === undefined ||
              (orthophoto !== null &&
                orthophoto.urlTemplate.includes('/api/v1/tiles/dop20/'));
            const showOrthoChip = orthophoto !== null;
            const orthoChipLabel = isBuiltinDop20
              ? t.attributionDop20Short
              : orthophoto && orthophoto.attribution.trim().length > 0
                ? orthophoto.attribution.trim()
                : null;
            const orthoChipLink =
              licensesUrl ?? 'https://www.govdata.de/dl-de/by-2-0';

            return (
              <>
                <Pressable
                  accessibilityRole="link"
                  onPress={() => openExternalUrl(basemapLink)}
                  style={({ pressed }) => [
                    styles.attributionChip,
                    pressed ? styles.buttonPressed : null,
                  ]}
                >
                  <Text style={styles.attributionChipText}>{basemapLabel}</Text>
                </Pressable>
                {showOrthoChip && orthoChipLabel ? (
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => openExternalUrl(orthoChipLink)}
                    style={({ pressed }) => [
                      styles.attributionChip,
                      pressed ? styles.buttonPressed : null,
                    ]}
                  >
                    <Text style={styles.attributionChipText}>
                      {orthoChipLabel}
                    </Text>
                  </Pressable>
                ) : null}
                {vg250AttributionEnabled !== false ? (
                  <Pressable
                    accessibilityRole="link"
                    onPress={() =>
                      openExternalUrl(BKG_VG250_DATENQUELLEN_URL)
                    }
                    style={({ pressed }) => [
                      styles.attributionChip,
                      pressed ? styles.buttonPressed : null,
                    ]}
                  >
                    <Text style={styles.attributionChipText}>
                      {formatVg250ShortAttribution(locale, vg250DataYear)}
                    </Text>
                  </Pressable>
                ) : null}
              </>
            );
          })()}
        </View>
      </View>

      <View style={styles.sectionCard}>
        <View style={styles.actionRow}>
          {portalUrl ? (
            <Pressable
              testID="about-portal-link"
              accessibilityRole="link"
              onPress={() => openExternalUrl(portalUrl)}
              style={({ pressed }) => [
                styles.touchButton,
                styles.secondaryButton,
                pressed ? styles.buttonPressed : null,
              ]}
            >
              <Text style={styles.secondaryButtonLabel}>{portalLabel}</Text>
            </Pressable>
          ) : null}

          {impressumUrl ? (
            <Pressable
              accessibilityRole="link"
              onPress={() => openExternalUrl(impressumUrl)}
              style={({ pressed }) => [
                styles.touchButton,
                styles.secondaryButton,
                pressed ? styles.buttonPressed : null,
              ]}
            >
              <Text style={styles.secondaryButtonLabel}>
                {t.impressumLinkLabel}
              </Text>
            </Pressable>
          ) : null}

          <Pressable
            accessibilityRole="link"
            onPress={() => openExternalUrl(privacyPolicyUrl)}
            style={({ pressed }) => [
              styles.touchButton,
              styles.secondaryButton,
              pressed ? styles.buttonPressed : null,
            ]}
          >
            <Text style={styles.secondaryButtonLabel}>
              {t.privacyLinkLabel}
            </Text>
          </Pressable>

          {termsUrl ? (
            <Pressable
              accessibilityRole="link"
              onPress={() => openExternalUrl(termsUrl)}
              style={({ pressed }) => [
                styles.touchButton,
                styles.secondaryButton,
                pressed ? styles.buttonPressed : null,
              ]}
            >
              <Text style={styles.secondaryButtonLabel}>
                {t.termsLinkLabel}
              </Text>
            </Pressable>
          ) : null}

          {licensesUrl ? (
            <Pressable
              accessibilityRole="link"
              onPress={() => openExternalUrl(licensesUrl)}
              style={({ pressed }) => [
                styles.touchButton,
                styles.secondaryButton,
                pressed ? styles.buttonPressed : null,
              ]}
            >
              <Text style={styles.secondaryButtonLabel}>
                {t.licensesLinkLabel}
              </Text>
            </Pressable>
          ) : null}

          {(() => {
            const effectiveSourceCodeUrl =
              sourceCodeUrl && sourceCodeUrl.trim().length > 0
                ? sourceCodeUrl.trim()
                : DEFAULT_CANONICAL_SOURCE_CODE_URL;
            return (
              <Pressable
                accessibilityRole="link"
                onPress={() => openExternalUrl(effectiveSourceCodeUrl)}
                style={({ pressed }) => [
                  styles.touchButton,
                  styles.secondaryButton,
                  pressed ? styles.buttonPressed : null,
                ]}
              >
                <Text style={styles.secondaryButtonLabel}>
                  {t.sourceCodeLinkLabel}
                </Text>
              </Pressable>
            );
          })()}

          {showInstallButton ? (
            <Pressable
              testID="about-install-app-button"
              accessibilityRole="button"
              accessibilityLabel={dict.controls.installAppA11y}
              onPress={onOpenInstallApp}
              style={({ pressed }) => [
                styles.touchButton,
                styles.primaryButton,
                styles.installButtonRow,
                pressed ? styles.primaryButtonPressed : null,
              ]}
            >
              <InstallAppGlyph
                color={palette.inkOnAccent}
                eyeColor={palette.accentPrimary}
                size={18}
              />
              <Text style={styles.primaryButtonLabel}>
                {t.installAppButton}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function createStyles(PALETTE: ThemePalette) {
  return StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: '100%',
    padding: 15,
    borderRadius: RADII.sheet,
    backgroundColor: PALETTE.bgSurface,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    gap: 10,
  },
  cardCompact: {
    padding: 12,
    gap: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  headerTextGroup: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: PALETTE.inkPrimary,
  },
  subtitle: {
    fontSize: 12,
    fontWeight: '600',
    color: PALETTE.positiveText,
  },
  introText: {
    fontSize: 12,
    lineHeight: 16.5,
    color: PALETTE.inkSecondary,
    marginTop: 1,
  },
  closeButton: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    backgroundColor: PALETTE.bgSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonLabel: {
    fontSize: 12.5,
    fontWeight: '600',
    color: PALETTE.inkPrimary,
  },
  sectionCard: {
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.bgSubtle,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
    minWidth: 0,
    gap: 6,
  },
  sectionTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    color: PALETTE.inkPrimary,
  },
  bulletList: {
    gap: 4,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    minWidth: 0,
  },
  bulletMarker: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    color: PALETTE.accentPrimary,
  },
  bulletText: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    lineHeight: 16.5,
    color: PALETTE.inkSecondary,
  },
  statusItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minWidth: 0,
  },
  dotGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    minWidth: 20,
    flexShrink: 0,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  subtleNote: {
    fontSize: 11.5,
    lineHeight: 16,
    color: PALETTE.inkMuted,
    flexShrink: 1,
    ...(Platform.OS === 'web'
      ? ({ overflowWrap: 'anywhere' } as object)
      : {}),
  },
  attributionChipsRow: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  attributionChip: {
    maxWidth: '100%',
    flexShrink: 1,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: RADII.sm,
    backgroundColor: PALETTE.bgSurface,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
  },
  attributionChipText: {
    fontSize: 11,
    lineHeight: 15,
    color: PALETTE.inkSecondary,
    textDecorationLine: 'underline',
    flexShrink: 1,
    ...(Platform.OS === 'web'
      ? ({ overflowWrap: 'break-word' } as object)
      : {}),
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  touchButton: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    maxWidth: '100%',
    flexShrink: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: RADII.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: PALETTE.accentPrimary,
    borderWidth: 1,
    borderColor: PALETTE.accentPrimaryStrong,
  },
  installButtonRow: {
    flexDirection: 'row',
    gap: 7,
  },
  primaryButtonPressed: {
    backgroundColor: PALETTE.accentPrimaryStrong,
  },
  primaryButtonLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    color: PALETTE.inkOnAccent,
    flexShrink: 1,
    textAlign: 'center',
  },
  secondaryButton: {
    backgroundColor: PALETTE.bgSurface,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
  },
  secondaryButtonLabel: {
    fontSize: 12.5,
    fontWeight: '600',
    color: PALETTE.inkPrimary,
    flexShrink: 1,
    textAlign: 'center',
  },
  buttonPressed: {
    backgroundColor: PALETTE.bgRecessed,
  },
  });
}
