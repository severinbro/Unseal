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
import { formatInspectorDate } from '../state/viewModels';
import { useTheme } from '../theme/themeContext';
import { RADII, type ThemePalette } from '../theme/tokens';
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
}): React.JSX.Element {
  return (
    <View style={local.silhouette} accessible={false}>
      {computeSilhouetteSegments(props.ring, 132, 96).map((s, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: s.left,
            top: s.top,
            width: s.width,
            height: 2.5,
            borderRadius: 2,
            backgroundColor: props.color,
            transform: [{ rotate: `${s.angleDeg}deg` }],
          }}
        />
      ))}
    </View>
  );
}

/**
 * An area as a feed entry. It is assembled from the same parts as the sheet
 * on the map (title, votes, note, contributor), in the same order, with its
 * place on the map, the photos and the top comment laid open.
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
  const tabButton = (
    tab: InspectorTab,
    label: string,
    testID: string,
  ): React.JSX.Element => (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${social.showOnMap}`}
      onPress={() => props.onShowOnMap(tab)}
      style={({ pressed }) => [styles.tabButton, pressed ? local.pressed : null]}
    >
      <Text numberOfLines={1} style={styles.tabButtonLabel}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <Animated.View
      testID={`feed-card-${item.feature.id}`}
      style={[
        styles.sheet,
        local.card,
        { borderLeftColor: tone },
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
      <View style={local.activityRow}>
        <View style={[local.activityDot, { backgroundColor: tone }]} />
        <Text style={[local.activityLabel, { color: palette.inkPrimary }]}>
          {social.activity[item.activity]}
        </Text>
        <Text
          style={[local.activityTime, { color: palette.inkMuted }]}
          accessibilityLabel={formatInspectorDate(when, locale) ?? undefined}
        >
          {formatRelativeTime(when, locale, props.nowMs)}
        </Text>
      </View>

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
              styles.closeButton,
              pressed ? local.pressed : null,
            ]}
          >
            <Text style={styles.closeButtonLabel}>{social.showOnMap}</Text>
          </Pressable>
        </View>
      </View>

      <PolygonVotePanel
        feature={item.feature}
        locale={locale}
        busy={props.voteBusy}
        onVotePress={props.onVote}
      />

      <SpaceBadges locale={locale} feature={item.feature} />

      <Pressable
        testID={`feed-map-${item.feature.id}`}
        accessibilityRole="button"
        accessibilityLabel={social.mapPreviewA11y}
        onPress={() => props.onShowOnMap('overview')}
        style={({ pressed }) => [
          local.mapBox,
          { backgroundColor: palette.bgSubtle },
          pressed ? local.pressed : null,
        ]}
      >
        <MapPreview
          geometry={item.feature.geometry}
          color={tone}
          dashed={p.spaceType === 'private'}
          config={props.mapConfig}
          colorScheme={isDark ? 'dark' : 'light'}
          fallback={
            <Silhouette ring={item.feature.geometry.coordinates[0] ?? []} color={tone} />
          }
        />
      </Pressable>

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
                { backgroundColor: palette.bgSubtle },
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
              <Text style={styles.topCommentBadgeLabel}>{t.topCommentBadge}</Text>
            </View>
          </View>
          <View style={styles.commentHeaderRow}>
            <Text style={styles.commentAuthorLabel}>
              {social.commentBy(name(item.topComment.authorPseudonym))}
            </Text>
          </View>
          <Text style={styles.commentBodyText}>{item.topComment.body}</Text>
        </View>
      ) : null}

      <PolygonCreatorCard feature={item.feature} locale={locale} />

      <View style={styles.tabWell}>
        {tabButton(
          'comments',
          t.tabComments(p.commentCount),
          `feed-comments-${item.feature.id}`,
        )}
        {tabButton(
          'photos',
          t.tabPhotos(p.photoCount),
          `feed-open-photos-${item.feature.id}`,
        )}
        {props.canNarrowToMunicipality && p.municipalityAgs && p.municipalityName
          ? (
              <Pressable
                testID={`feed-only-${item.feature.id}`}
                accessibilityRole="button"
                accessibilityLabel={social.onlyMunicipality(p.municipalityName)}
                onPress={props.onOnlyMunicipality}
                style={({ pressed }) => [
                  styles.tabButton,
                  pressed ? local.pressed : null,
                ]}
              >
                <Text numberOfLines={1} style={styles.tabButtonLabel}>
                  {social.scopeMunicipality(p.municipalityName)}
                </Text>
              </Pressable>
            )
          : null}
      </View>
    </Animated.View>
  );
}

/** Placeholder shown while the first entries load. */
export function FeedCardSkeleton(): React.JSX.Element {
  const { palette } = useTheme();
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
        borderRadius: RADII.md,
        backgroundColor: palette.bgRecessed,
      }}
    />
  );
  return (
    <Animated.View
      accessible={false}
      style={[styles.sheet, local.card, { opacity: pulse }]}
    >
      {bar('45%', 14)}
      {bar('70%', 22)}
      {bar('100%', 44)}
      {bar('100%', MAP_PREVIEW_HEIGHT)}
      {bar('60%', 16)}
    </Animated.View>
  );
}

const local = StyleSheet.create({
  card: {
    borderLeftWidth: 4,
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 2px 10px rgba(18, 32, 25, 0.08)' }
      : { elevation: 2 }),
  },
  pressed: { opacity: 0.7 },
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  activityDot: { width: 9, height: 9, borderRadius: 5 },
  activityLabel: { fontSize: 12.5, fontWeight: '700', flexShrink: 1 },
  activityTime: { fontSize: 12.5, marginLeft: 'auto' },
  photoStrip: { gap: 8, flexGrow: 1 },
  photoFrame: {
    width: 232,
    borderRadius: RADII.md,
    overflow: 'hidden',
  },
  photoFrameSingle: { width: '100%', flexGrow: 1 },
  photo: { width: '100%', height: 168 },
  photoCredit: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 11,
    color: '#FFFFFF',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  mapBox: {
    height: MAP_PREVIEW_HEIGHT,
    justifyContent: 'center',
    borderRadius: RADII.md,
    overflow: 'hidden',
  },
  silhouette: { width: 132, height: 96, alignSelf: 'center' },
});
