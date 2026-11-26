// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import type { PolygonFeedItem, RuntimeConfig } from '@openunseal/shared';
import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { getSocialCopy } from '../i18n/social';
import { getTranslations, type Locale } from '../i18n/translations';
import { MapPreview } from '../map/MapPreview';
import { MAP_PREVIEW_HEIGHT } from '../map/MapPreview.types';
import { formatRelativeTime } from '../state/feedScope';
import { computeSilhouetteSegments } from '../state/silhouette';
import { formatInspectorDate, MIN_TOUCH_TARGET_DP } from '../state/viewModels';
import { useTheme } from '../theme/themeContext';
import {
  MONO_FONT_FAMILY,
  RADII,
  TABULAR_NUMS_STYLE,
  type ThemePalette,
} from '../theme/tokens';
import {
  PolygonCardTitle,
  PolygonCreatorCard,
  PolygonNoteCard,
  PolygonVotePanel,
} from './PolygonCardParts';
import type { InspectorTab } from './PolygonInspectorSheet';
import { createPolygonCardStyles } from './polygonCardStyles';
import { SpaceBadges } from './SpaceSections';

const USE_NATIVE_DRIVER = Platform.OS !== 'web';

/** The colour an area has on the map, so a card can be matched to it. */
function toneColor(
  item: PolygonFeedItem,
  palette: ThemePalette,
): string {
  const p = item.feature.properties;
  if (p.status === 'finished') {
    return palette.finishedDot;
  }
  if (p.status === 'in_progress') {
    return palette.inProgressDot;
  }
  return p.score > 0
    ? palette.positiveDot
    : p.score < 0
      ? palette.dangerDot
      : palette.neutralDot;
}

function Silhouette(props: {
  ring: readonly (readonly [number, number])[];
  color: string;
  width?: number;
  height?: number;
}): React.JSX.Element {
  const w = props.width ?? 132;
  const h = props.height ?? 96;
  return (
    <View style={{ width: w, height: h, alignSelf: 'center' }} accessible={false}>
      {computeSilhouetteSegments(props.ring, w, h).map((s, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: s.left,
            top: s.top,
            width: s.width,
            height: 2.5,
            borderRadius: 1,
            backgroundColor: props.color,
            transform: [{ rotate: `${s.angleDeg}deg` }],
          }}
        />
      ))}
    </View>
  );
}

/**
 * An area as a 4-chamber Perforated Field-Ticket:
 * 1. Flush recessed specimen header bar with tactile map-jump keycap
 * 2. Full-bleed map stage with docked polygon silhouette scale stamp & activity tag
 * 3. Body deck (ground stamps, photos, note, top comment, 3-cell vote rocker, creator)
 * 4. Perforated tear-off index stub footer
 */
export function PolygonFeedCard(props: {
  item: PolygonFeedItem;
  locale: Locale;
  nowMs: number;
  mapConfig: RuntimeConfig;
  voteBusy: boolean;
  /** Hides the "only this municipality" shortcut when it is already active. */
  canNarrowToMunicipality: boolean;
  resolveUploadUrl: (url: string) => string;
  onVote: (value: 1 | -1) => void;
  onShowOnMap: (tab: InspectorTab) => void;
  onOnlyMunicipality: () => void;
}): React.JSX.Element {
  const { item, locale } = props;
  const { palette, isDark } = useTheme();
  const styles = useMemo(() => createPolygonCardStyles(palette), [palette]);
  const social = getSocialCopy(locale);
  const t = getTranslations(locale).inspector;
  const p = item.feature.properties;
  const tone = toneColor(item, palette);
  const photos = item.photos.filter((photo) => !photo.isFlaggedFake);
  const ring = item.feature.geometry.coordinates[0] ?? [];
  const name = (pseudonym: string): string =>
    pseudonym === 'deleted' ? social.deleted : pseudonym;

  // Cards ease in once, when they are first laid out.
  const appear = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(appear, {
      toValue: 1,
      duration: 240,
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start();
  }, [appear]);

  const when = item.activityAt ?? p.createdAt;
  const showMunicipalityStub = Boolean(
    props.canNarrowToMunicipality && p.municipalityAgs && p.municipalityName,
  );

  const stubButton = (
    tab: InspectorTab,
    label: string,
    testID: string,
    hasRightDivider: boolean,
  ): React.JSX.Element => (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${social.showOnMap}`}
      onPress={() => props.onShowOnMap(tab)}
      style={({ pressed }) => [
        local.stubButton,
        hasRightDivider
          ? {
              borderRightWidth: 1.5,
              borderRightColor: palette.borderStrong,
            }
          : null,
        pressed ? { backgroundColor: palette.bgSubtle } : null,
      ]}
    >
      <Text
        numberOfLines={1}
        style={[local.stubButtonLabel, { color: palette.inkPrimary }]}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <Animated.View
      testID={`feed-card-${item.feature.id}`}
      style={[
        styles.sheet,
        local.ticketShell,
        isDark ? local.ticketShadowDark : local.ticketShadowLight,
        {
          opacity: appear,
          transform: [
            {
              translateY: appear.interpolate({
                inputRange: [0, 1],
                outputRange: [10, 0],
              }),
            },
          ],
        },
      ]}
    >
      {/* Chamber 1: Flush Specimen Header Bar */}
      <View
        style={[
          local.ticketHeaderBar,
          {
            backgroundColor: palette.bgSubtle,
            borderBottomColor: palette.borderStrong,
          },
        ]}
      >
        <View style={styles.headerRow}>
          <View style={styles.headerTitleGroup}>
            <PolygonCardTitle feature={item.feature} locale={locale} />
          </View>
          <View style={styles.headerControls}>
            <Pressable
              testID={`feed-show-${item.feature.id}`}
              accessibilityRole="button"
              accessibilityLabel={social.showOnMap}
              onPress={() => props.onShowOnMap('overview')}
              style={({ pressed }) => [
                local.mapJumpKeycap,
                {
                  backgroundColor: palette.bgSurface,
                  borderColor: palette.borderStrong,
                },
                pressed ? local.keycapPressed : null,
              ]}
            >
              <Text
                style={[local.mapJumpGlyph, { color: palette.accentPrimary }]}
              >
                ↗
              </Text>
              <Text
                style={[local.mapJumpLabel, { color: palette.inkPrimary }]}
              >
                {social.showOnMap}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* Chamber 2: Full-Bleed Map Stage + Docked Cadastral HUD Stamps */}
      <Pressable
        testID={`feed-map-${item.feature.id}`}
        accessibilityRole="button"
        accessibilityLabel={social.mapPreviewA11y}
        onPress={() => props.onShowOnMap('overview')}
        style={({ pressed }) => [
          local.mapStageBox,
          {
            backgroundColor: palette.bgRecessed,
            borderBottomColor: palette.borderStrong,
          },
          pressed ? local.pressed : null,
        ]}
      >
        <MapPreview
          geometry={item.feature.geometry}
          color={tone}
          dashed={p.spaceType === 'private'}
          config={props.mapConfig}
          colorScheme={isDark ? 'dark' : 'light'}
          fallback={<Silhouette ring={ring} color={tone} />}
        />

        {/* Top-left docked polygon silhouette + scale plate */}
        <View
          pointerEvents="none"
          accessible={false}
          style={[
            local.hudSilhouettePlate,
            {
              backgroundColor: palette.bgFloatingPill,
              borderColor: palette.borderStrong,
            },
          ]}
        >
          <Silhouette ring={ring} color={tone} width={52} height={34} />
          <Text style={[local.stampCaption, { color: palette.inkPrimary }]}>
            {Math.round(p.areaM2)} m²
          </Text>
        </View>

        {/* Top-right docked activity & timestamp plate */}
        <View pointerEvents="none" style={local.hudTopRightRow}>
          <View
            style={[
              local.hudActivityPlate,
              {
                backgroundColor: palette.bgFloatingPill,
                borderColor: palette.borderStrong,
              },
            ]}
          >
            <View style={[local.activitySquare, { backgroundColor: tone }]} />
            <Text
              numberOfLines={1}
              style={[local.activityLabel, { color: palette.inkPrimary }]}
            >
              {social.activity[item.activity]}
            </Text>
            <Text
              style={[local.activityTime, { color: palette.inkSecondary }]}
              accessibilityLabel={formatInspectorDate(when, locale) ?? undefined}
            >
              · {formatRelativeTime(when, locale, props.nowMs)}
            </Text>
          </View>
        </View>
      </Pressable>

      {/* Chamber 3: Specimen Body Deck */}
      <View style={local.ticketBody}>
        <SpaceBadges locale={locale} feature={item.feature} />

        {photos.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={photos.length > 1}
            contentContainerStyle={local.photoStrip}
            testID={`feed-photos-${item.feature.id}`}
          >
            {photos.map((photo) => (
              <View
                key={photo.id}
                style={[
                  local.photoFrame,
                  photos.length === 1 ? local.photoFrameSingle : null,
                  {
                    backgroundColor: palette.bgSubtle,
                    borderColor: palette.borderStrong,
                  },
                ]}
              >
                <Image
                  source={{ uri: props.resolveUploadUrl(photo.thumbUrl) }}
                  style={local.photo}
                  resizeMode="cover"
                  accessibilityLabel={social.photoBy(name(photo.uploaderPseudonym))}
                />
                <Text numberOfLines={1} style={local.photoCredit}>
                  {social.photoBy(name(photo.uploaderPseudonym))}
                </Text>
              </View>
            ))}
          </ScrollView>
        ) : null}

        {p.note && p.note.trim().length > 0 ? (
          <PolygonNoteCard note={p.note} locale={locale} />
        ) : null}

        {item.topComment ? (
          <View style={[styles.commentCard, styles.commentCardTopRated]}>
            <View style={styles.commentBadgesRow}>
              <View style={styles.topCommentBadge}>
                <Text style={styles.topCommentBadgeLabel}>
                  {t.topCommentBadge}
                </Text>
              </View>
            </View>
            <View style={styles.commentHeaderRow}>
              <Text style={styles.commentAuthorLabel}>
                {social.commentBy(name(item.topComment.authorPseudonym))}
              </Text>
            </View>
            <Text style={styles.commentBodyText}>„{item.topComment.body}“</Text>
          </View>
        ) : null}

        <View style={local.bodySpacer} />

        <PolygonVotePanel
          feature={item.feature}
          locale={locale}
          busy={props.voteBusy}
          onVotePress={props.onVote}
        />

        <PolygonCreatorCard feature={item.feature} locale={locale} />
      </View>

      {/* Chamber 4: Perforated Tear-Off Index Stubs */}
      <View
        style={[
          local.stubFooterRow,
          {
            backgroundColor: palette.bgRecessed,
            borderTopColor: palette.borderStrong,
          },
        ]}
      >
        {stubButton(
          'comments',
          t.tabComments(p.commentCount),
          `feed-comments-${item.feature.id}`,
          true,
        )}
        {stubButton(
          'photos',
          t.tabPhotos(p.photoCount),
          `feed-open-photos-${item.feature.id}`,
          showMunicipalityStub,
        )}
        {showMunicipalityStub && p.municipalityName ? (
          <Pressable
            testID={`feed-only-${item.feature.id}`}
            accessibilityRole="button"
            accessibilityLabel={social.onlyMunicipality(p.municipalityName)}
            onPress={props.onOnlyMunicipality}
            style={({ pressed }) => [
              local.stubButton,
              pressed ? { backgroundColor: palette.bgSubtle } : null,
            ]}
          >
            <Text
              numberOfLines={1}
              style={[local.stubButtonLabel, { color: palette.accentPrimary }]}
            >
              ⌖ {social.scopeMunicipality(p.municipalityName)}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

/** Placeholder shown while the first entries load. */
export function FeedCardSkeleton(): React.JSX.Element {
  const { palette, isDark } = useTheme();
  const styles = useMemo(() => createPolygonCardStyles(palette), [palette]);
  const pulse = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(pulse, {
          toValue: 0.45,
          duration: 700,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const bar = (width: `${number}%`, height: number): React.JSX.Element => (
    <View
      style={{
        width,
        height,
        borderRadius: RADII.sm,
        backgroundColor: palette.bgRecessed,
      }}
    />
  );
  return (
    <Animated.View
      accessible={false}
      style={[
        styles.sheet,
        local.ticketShell,
        isDark ? local.ticketShadowDark : local.ticketShadowLight,
        { padding: 14, gap: 10, opacity: pulse },
      ]}
    >
      {bar('45%', 14)}
      {bar('70%', 22)}
      {bar('100%', MAP_PREVIEW_HEIGHT)}
      {bar('100%', 44)}
      {bar('60%', 16)}
    </Animated.View>
  );
}

const local = StyleSheet.create({
  ticketShell: {
    flex: 1,
    padding: 0,
    gap: 0,
    overflow: 'hidden',
    borderBottomWidth: 4,
  },
  ticketShadowLight: {
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 3px 0 rgba(17, 31, 24, 0.12)' }
      : { elevation: 3 }),
  },
  ticketShadowDark: {
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 3px 0 rgba(0, 0, 0, 0.45)' }
      : { elevation: 3 }),
  },
  ticketHeaderBar: {
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderBottomWidth: 1.5,
  },
  mapJumpKeycap: {
    minHeight: MIN_TOUCH_TARGET_DP,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: RADII.sm,
    borderWidth: 1.5,
    borderBottomWidth: 3,
  },
  mapJumpGlyph: {
    fontFamily: MONO_FONT_FAMILY,
    fontSize: 13,
    fontWeight: '800',
  },
  mapJumpLabel: {
    fontSize: 12,
    fontWeight: '800',
  },
  keycapPressed: {
    transform: [{ translateY: 1.5 }],
    borderBottomWidth: 1.5,
  },
  pressed: { opacity: 0.85 },
  mapStageBox: {
    height: MAP_PREVIEW_HEIGHT,
    justifyContent: 'center',
    borderBottomWidth: 1.5,
    overflow: 'hidden',
    position: 'relative',
  },
  hudSilhouettePlate: {
    position: 'absolute',
    top: 8,
    left: 8,
    paddingVertical: 5,
    paddingHorizontal: 7,
    borderRadius: RADII.sm,
    borderWidth: 1.5,
    borderBottomWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  stampCaption: {
    ...TABULAR_NUMS_STYLE,
    fontFamily: MONO_FONT_FAMILY,
    fontSize: 10.5,
    fontWeight: '800',
  },
  hudTopRightRow: {
    position: 'absolute',
    top: 8,
    right: 8,
    left: 86,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
  },
  hudActivityPlate: {
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADII.xs,
    borderWidth: 1.5,
    borderBottomWidth: 2.5,
  },
  activitySquare: {
    width: 8,
    height: 8,
    borderRadius: 1.5,
    flexShrink: 0,
  },
  activityLabel: {
    fontFamily: MONO_FONT_FAMILY,
    fontSize: 11,
    fontWeight: '700',
    flexShrink: 1,
  },
  activityTime: {
    ...TABULAR_NUMS_STYLE,
    fontFamily: MONO_FONT_FAMILY,
    fontSize: 11,
    fontWeight: '600',
    flexShrink: 0,
  },
  ticketBody: {
    flex: 1,
    padding: 13,
    gap: 10,
  },
  bodySpacer: {
    flexGrow: 1,
  },
  photoStrip: { gap: 8, flexGrow: 1 },
  photoFrame: {
    width: 232,
    borderRadius: RADII.sm,
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  photoFrameSingle: { width: '100%', flexGrow: 1 },
  photo: { width: '100%', height: 164 },
  photoCredit: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 11,
    fontWeight: '600',
    color: '#FFFFFF',
    backgroundColor: 'rgba(14, 25, 19, 0.72)',
  },
  stubFooterRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderTopWidth: 1.5,
    borderStyle: 'dashed',
  },
  stubButton: {
    flex: 1,
    minWidth: 0,
    minHeight: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 8,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stubButtonLabel: {
    fontSize: 12,
    fontWeight: '800',
    maxWidth: '100%',
  },
});
