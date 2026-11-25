// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import {
  FEED_LIMITS,
  POLYGON_FILTERS,
  type BboxBounds,
  type PolygonFeature,
  type PolygonFeedItem,
  type PolygonFeedResponse,
  type PolygonFilter,
  type SpaceFilter,
  type VoteResponse,
} from '@openunseal/shared';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Text, View } from 'react-native';

import { getSocialCopy } from '../i18n/social';
import { localizeError, type Locale } from '../i18n/translations';
import { computeFeedBbox, describeVoteAccess, type FeedScope } from '../state/feedScope';
import { FeedCardSkeleton, PolygonFeedCard } from './PolygonFeedCard';
import type { InspectorTab } from './PolygonInspectorSheet';
import { SocialButton, useSocialStyles } from './SocialUi';
import { SpaceFilterRow } from './SpaceSections';

function applyVote(
  items: readonly PolygonFeedItem[],
  vote: VoteResponse,
): PolygonFeedItem[] {
  return items.map((item) =>
    item.feature.id === vote.polygonId
      ? {
          ...item,
          feature: {
            ...item.feature,
            properties: {
              ...item.feature.properties,
              upvotes: vote.upvotes,
              downvotes: vote.downvotes,
              score: vote.score,
              myVote: vote.myVote,
            },
          },
        }
      : item,
  );
}

export interface FeedLoadOptions {
  cursor: string | null;
  filter: PolygonFilter;
  spaceFilter: SpaceFilter;
  bbox: BboxBounds | null;
  ags: string | null;
}

/**
 * Stays mounted while the map is shown so that the list, its scroll position
 * and the chosen area survive "show on map". It only loads while `active`.
 */
export function FeedView(props: {
  locale: Locale;
  active: boolean;
  filter: PolygonFilter;
  spaceFilter: SpaceFilter;
  /** Changes whenever the signed-in account changes, to refetch viewer data. */
  viewerKey: string;
  /** The map's current section; only used when the feed is narrowed to it. */
  mapBbox: BboxBounds | null;
  load: (options: FeedLoadOptions) => Promise<PolygonFeedResponse>;
  resolveUploadUrl: (url: string) => string;
  /** Resolves with the new tally, or null when the vote did not happen. */
  onVote: (feature: PolygonFeature, value: 1 | -1 | 0) => Promise<VoteResponse | null>;
  /** A vote cast elsewhere (for example after signing in) to show on its card. */
  latestVote?: VoteResponse | null;
  onSetFilter: (filter: PolygonFilter) => void;
  onSetSpaceFilter: (filter: SpaceFilter) => void;
  /** Opens the area on the map, on the given tab of its card. */
  onShowOnMap: (feature: PolygonFeature, tab: InspectorTab) => void;
}): React.JSX.Element {
  const { styles } = useSocialStyles();
  const t = getSocialCopy(props.locale);
  const { filter, spaceFilter, load, locale, viewerKey, active, onVote } = props;
  const [scope, setScope] = useState<FeedScope>({ kind: 'all' });
  const [items, setItems] = useState<PolygonFeedItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [votingId, setVotingId] = useState<string | null>(null);
  // "2 hours ago" is computed against the time of the last load.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const requestRef = useRef(0);
  const loadedKeyRef = useRef<string | null>(null);

  const nearBbox = useMemo(
    () => (props.mapBbox ? computeFeedBbox(props.mapBbox) : null),
    [props.mapBbox],
  );
  const scopeBbox = scope.kind === 'near' ? scope.bbox : null;
  const scopeAgs = scope.kind === 'municipality' ? scope.ags : null;
  const queryKey = JSON.stringify([filter, spaceFilter, viewerKey, scopeBbox, scopeAgs]);

  const fetchPage = useCallback(
    async (from: string | null): Promise<void> => {
      const request = ++requestRef.current;
      setLoading(true);
      setError(null);
      try {
        const page = await load({
          cursor: from,
          filter,
          spaceFilter,
          bbox: scopeBbox,
          ags: scopeAgs,
        });
        if (request !== requestRef.current) {
          return;
        }
        setNowMs(Date.now());
        setItems((prev) => {
          const base = from === null ? [] : prev;
          const known = new Set(base.map((i) => i.feature.id));
          return [...base, ...page.items.filter((i) => !known.has(i.feature.id))];
        });
        setCursor(page.nextCursor);
      } catch (err: unknown) {
        if (request === requestRef.current) {
          setError(localizeError(err, t.failed, locale));
        }
      } finally {
        if (request === requestRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    // scopeBbox is covered by queryKey; its object identity may change freely.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [load, queryKey, locale, t.failed],
  );

  useEffect(() => {
    // Loads when the feed is opened and whenever what it shows has changed
    // since; a hidden feed never loads.
    if (!active || loadedKeyRef.current === queryKey) {
      return;
    }
    loadedKeyRef.current = queryKey;
    setItems([]);
    setCursor(null);
    void fetchPage(null);
  }, [active, queryKey, fetchPage]);

  const { latestVote } = props;
  useEffect(() => {
    if (latestVote) {
      setItems((prev) => applyVote(prev, latestVote));
    }
  }, [latestVote]);

  const refresh = (): void => {
    // A nearby feed follows the map only on request, here.
    if (
      scope.kind === 'near' &&
      nearBbox !== null &&
      JSON.stringify(nearBbox) !== JSON.stringify(scope.bbox)
    ) {
      setScope({ kind: 'near', bbox: nearBbox });
      return;
    }
    setRefreshing(true);
    void fetchPage(null);
  };

  const vote = (feature: PolygonFeature, value: 1 | -1): void => {
    if (describeVoteAccess(feature.properties) !== 'open') {
      return;
    }
    const next = feature.properties.myVote === value ? 0 : value;
    setVotingId(feature.id);
    setError(null);
    onVote(feature, next)
      .then((result) => {
        if (result !== null) {
          setItems((prev) => applyVote(prev, result));
        }
      })
      .catch((err: unknown) => setError(localizeError(err, t.failed, locale)))
      .finally(() => setVotingId(null));
  };

  return (
    <View style={styles.fill} testID="feed-view">
      <FlatList
        data={items}
        keyExtractor={(item) => item.feature.id}
        contentContainerStyle={styles.feedContent}
        onEndReachedThreshold={0.6}
        refreshing={refreshing}
        onRefresh={refresh}
        onEndReached={() => {
          if (cursor !== null && !loading && error === null) {
            void fetchPage(cursor);
          }
        }}
        ListHeaderComponent={
          <View style={styles.section}>
            <View style={styles.spread}>
              <Text style={[styles.hint, styles.grow]}>
                {t.feedHint(FEED_LIMITS.MAX_AGE_DAYS)}
              </Text>
              <SocialButton
                testID="feed-refresh"
                label={t.refresh}
                disabled={loading}
                onPress={refresh}
              />
            </View>
            <View style={styles.row} accessibilityLabel={t.scopeLabel}>
              <SocialButton
                testID="feed-scope-all"
                label={t.scopeAll}
                selected={scope.kind === 'all'}
                onPress={() => setScope({ kind: 'all' })}
              />
              <SocialButton
                testID="feed-scope-near"
                label={t.scopeNear}
                selected={scope.kind === 'near'}
                disabled={nearBbox === null}
                onPress={() => {
                  if (nearBbox !== null) {
                    setScope({ kind: 'near', bbox: nearBbox });
                  }
                }}
              />
              {scope.kind === 'municipality' ? (
                <SocialButton
                  testID="feed-scope-municipality"
                  label={`${t.scopeMunicipality(scope.name)} ✕`}
                  selected
                  onPress={() => setScope({ kind: 'all' })}
                />
              ) : null}
            </View>
            {scope.kind === 'near' ? (
              <Text style={styles.hint}>{t.scopeNearHint}</Text>
            ) : null}
            <View style={styles.row}>
              {POLYGON_FILTERS.map((value) => (
                <SocialButton
                  key={value}
                  testID={`feed-filter-${value}`}
                  label={t.filters[value]}
                  selected={filter === value}
                  onPress={() => props.onSetFilter(value)}
                />
              ))}
            </View>
            <SpaceFilterRow
              locale={locale}
              value={spaceFilter}
              onChange={props.onSetSpaceFilter}
            />
          </View>
        }
        ListFooterComponent={
          error ? (
            <View style={styles.section}>
              <Text style={styles.error}>{error}</Text>
              <SocialButton label={t.retry} onPress={() => void fetchPage(cursor)} />
            </View>
          ) : loading && items.length === 0 ? (
            <View style={styles.section} accessibilityLabel={t.loading}>
              <FeedCardSkeleton />
              <FeedCardSkeleton />
            </View>
          ) : loading ? (
            <Text style={styles.hint}>{t.loading}</Text>
          ) : items.length === 0 ? (
            <Text style={styles.body}>{t.feedEmpty}</Text>
          ) : cursor !== null ? (
            <SocialButton label={t.loadMore} onPress={() => void fetchPage(cursor)} />
          ) : null
        }
        renderItem={({ item }) => {
          const p = item.feature.properties;
          const ags = p.municipalityAgs;
          const municipality = p.municipalityName;
          return (
            <PolygonFeedCard
              item={item}
              locale={locale}
              nowMs={nowMs}
              voteBusy={votingId === item.feature.id}
              canNarrowToMunicipality={scope.kind !== 'municipality'}
              resolveUploadUrl={props.resolveUploadUrl}
              onVote={(value) => vote(item.feature, value)}
              onShowOnMap={(tab) => props.onShowOnMap(item.feature, tab)}
              onOnlyMunicipality={() => {
                if (ags && municipality) {
                  setScope({ kind: 'municipality', ags, name: municipality });
                }
              }}
            />
          );
        }}
      />
    </View>
  );
}
