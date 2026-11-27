// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import {
  FEED_LIMITS,
  type BboxBounds,
  type PolygonFeature,
  type PolygonFeedItem,
  type PolygonFeedResponse,
  type PolygonFilter,
  type RuntimeConfig,
  type SpaceFilter,
  type VoteResponse,
} from '@openunseal/shared';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { getSocialCopy } from '../i18n/social';
import { localizeError, type Locale } from '../i18n/translations';
import {
  computeFeedBbox,
  describeVoteAccess,
  findNewEntries,
  mergeFreshPage,
  refreshKnownEntries,
  type FeedScope,
} from '../state/feedScope';
import { isForeground } from './DirectChatModal';
import { FeedFilterBar } from './FeedFilterBar';
import { FeedCardSkeleton, PolygonFeedCard } from './PolygonFeedCard';
import type { InspectorTab } from './PolygonInspectorSheet';
import { SocialButton, useSocialStyles } from './SocialUi';

/** How often an open feed looks for new entries. */
const CHECK_INTERVAL_MS = 30_000;
/** Scrolled less than this, the list counts as being at its top. */
const TOP_TOLERANCE_PX = 8;

/** Calls back when the page or app comes to the foreground. */
function onForeground(callback: () => void): () => void {
  if (Platform.OS === 'web') {
    const doc = (
      globalThis as {
        document?: {
          addEventListener(type: string, listener: () => void): void;
          removeEventListener(type: string, listener: () => void): void;
        };
      }
    ).document;
    doc?.addEventListener('visibilitychange', callback);
    return () => doc?.removeEventListener('visibilitychange', callback);
  }
  const subscription = AppState.addEventListener('change', callback);
  return () => subscription.remove();
}

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
 *
 * An open feed keeps itself up to date. New entries are announced at the top
 * instead of being inserted, so nothing moves under the reader.
 */
export function FeedView(props: {
  locale: Locale;
  active: boolean;
  filter: PolygonFilter;
  mapConfig: RuntimeConfig;
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
  /** Opens the area on the map, on the given tab of its card. */
  onShowOnMap: (feature: PolygonFeature, tab: InspectorTab) => void;
}): React.JSX.Element {
  const { styles } = useSocialStyles();
  const t = getSocialCopy(props.locale);
  const { filter, load, locale, viewerKey, active, onVote } = props;
  const [spaceFilter, setSpaceFilter] = useState<SpaceFilter>('all');
  const [scope, setScope] = useState<FeedScope>({ kind: 'all' });
  const [items, setItems] = useState<PolygonFeedItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** A newer first page that waits for the reader to ask for it. */
  const [pending, setPending] = useState<PolygonFeedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [votingId, setVotingId] = useState<string | null>(null);
  // "2 hours ago" is computed against the time of the last load.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const requestRef = useRef(0);
  /** Known at once, unlike `loading`, which only holds after the next render. */
  const busyRef = useRef(false);
  const loadedKeyRef = useRef<string | null>(null);
  const listRef = useRef<FlatList<PolygonFeedItem>>(null);
  const scrollOffsetRef = useRef(0);

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
      busyRef.current = true;
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
        if (from === null) {
          setPending(null);
        }
      } catch (err: unknown) {
        if (request === requestRef.current) {
          setError(localizeError(err, t.failed, locale));
        }
      } finally {
        if (request === requestRef.current) {
          busyRef.current = false;
          setLoading(false);
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
    setPending(null);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    void fetchPage(null);
  }, [active, queryKey, fetchPage]);

  const current = useRef({ items, cursor, queryKey });
  current.current = { items, cursor, queryKey };

  /** Looks for new entries; `insert` puts them in right away. */
  const checkForNew = useCallback(
    async (insert: boolean): Promise<void> => {
      const before = current.current;
      if (
        !isForeground() ||
        busyRef.current ||
        loadedKeyRef.current !== before.queryKey
      ) {
        return;
      }
      if (before.items.length === 0) {
        // Nothing on screen that could move, or the first load failed.
        await fetchPage(null);
        return;
      }
      const request = requestRef.current;
      try {
        const fresh = await load({
          cursor: null,
          filter,
          spaceFilter,
          bbox: scopeBbox,
          ags: scopeAgs,
        });
        if (
          request !== requestRef.current ||
          current.current.queryKey !== before.queryKey
        ) {
          return;
        }
        setNowMs(Date.now());
        const { items: shown, cursor: shownCursor } = current.current;
        if (findNewEntries(shown, fresh.items).length === 0) {
          setPending(null);
          setItems(refreshKnownEntries(shown, fresh.items));
        } else if (insert && scrollOffsetRef.current <= TOP_TOLERANCE_PX) {
          const merged = mergeFreshPage(shown, shownCursor, fresh);
          setPending(null);
          setItems(merged.items);
          setCursor(merged.cursor);
        } else {
          setPending(fresh);
          setItems(refreshKnownEntries(shown, fresh.items));
        }
      } catch {
        // Tried again at the next interval; what is on screen stays.
      }
    },
    // scopeBbox is covered by queryKey, as above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [load, queryKey, fetchPage],
  );

  useEffect(() => {
    if (!active) {
      return;
    }
    // Coming back to a feed that is at its top shows what is new directly.
    void checkForNew(true);
    const timer = setInterval(() => void checkForNew(false), CHECK_INTERVAL_MS);
    const unsubscribe = onForeground(() => void checkForNew(false));
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, [active, checkForNew]);

  const newEntries = useMemo(
    () => (pending === null ? [] : findNewEntries(items, pending.items)),
    [items, pending],
  );

  const showNewEntries = (): void => {
    if (pending !== null) {
      const merged = mergeFreshPage(items, cursor, pending);
      setItems(merged.items);
      setCursor(merged.cursor);
      setPending(null);
    }
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  };

  const recordVote = useCallback((result: VoteResponse): void => {
    setItems((prev) => applyVote(prev, result));
    setPending((prev) =>
      prev === null ? null : { ...prev, items: applyVote(prev.items, result) },
    );
  }, []);

  const { latestVote } = props;
  useEffect(() => {
    if (latestVote) {
      recordVote(latestVote);
    }
  }, [latestVote, recordVote]);

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
          recordVote(result);
        }
      })
      .catch((err: unknown) => setError(localizeError(err, t.failed, locale)))
      .finally(() => setVotingId(null));
  };

  const { width: viewportWidth } = useWindowDimensions();
  const isDesktopBoard = viewportWidth >= 1060;
  const columns = isDesktopBoard ? 2 : 1;

  // A first page full of new entries may hide even more of them.
  const newEntriesLabel = t.newEntries(
    newEntries.length,
    pending !== null &&
      pending.nextCursor !== null &&
      newEntries.length === pending.items.length,
  );

  const filterBarNode = (vertical: boolean): React.JSX.Element => (
    <View style={styles.section}>
      <FeedFilterBar
        locale={locale}
        scope={scope}
        filter={filter}
        spaceFilter={spaceFilter}
        canUseNear={nearBbox !== null}
        caption={t.feedHint(FEED_LIMITS.MAX_AGE_DAYS)}
        vertical={vertical}
        onScopeAll={() => setScope({ kind: 'all' })}
        onScopeNear={() => {
          if (nearBbox !== null) {
            setScope({ kind: 'near', bbox: nearBbox });
          }
        }}
        onFilter={props.onSetFilter}
        onSpaceFilter={setSpaceFilter}
      />
      {scope.kind === 'near' ? (
        <Text style={styles.hint}>{t.scopeNearHint}</Text>
      ) : null}
    </View>
  );

  return (
    <View style={styles.fill} testID="feed-view">
      <View
        style={[
          board.workspace,
          isDesktopBoard ? board.workspaceSplit : null,
        ]}
      >
        {isDesktopBoard ? (
          <View style={board.leftCompassRail}>{filterBarNode(true)}</View>
        ) : null}

        <View style={board.gridPane}>
          <FlatList
            key={`feed-cols-${columns}`}
            ref={listRef}
            data={items}
            numColumns={columns}
            keyExtractor={(item) => item.feature.id}
            columnWrapperStyle={columns > 1 ? board.columnWrapper : undefined}
            contentContainerStyle={
              isDesktopBoard ? board.desktopGridContent : styles.feedContent
            }
            onEndReachedThreshold={0.6}
            scrollEventThrottle={100}
            onScroll={(event) => {
              scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
            }}
            onEndReached={() => {
              if (cursor !== null && !loading && error === null) {
                void fetchPage(cursor);
              }
            }}
            ListHeaderComponent={isDesktopBoard ? null : filterBarNode(false)}
            ListFooterComponent={
              error ? (
                <View style={styles.section}>
                  <Text style={styles.error}>{error}</Text>
                  <SocialButton
                    label={t.retry}
                    onPress={() => void fetchPage(cursor)}
                  />
                </View>
              ) : loading && items.length === 0 ? (
                <View
                  style={
                    columns > 1 ? board.skeletonRowDesktop : styles.section
                  }
                  accessibilityLabel={t.loading}
                >
                  <View style={board.gridCell}>
                    <FeedCardSkeleton />
                  </View>
                  <View style={board.gridCell}>
                    <FeedCardSkeleton />
                  </View>
                </View>
              ) : loading ? (
                <Text style={styles.hint}>{t.loading}</Text>
              ) : items.length === 0 ? (
                <Text style={styles.body}>{t.feedEmpty}</Text>
              ) : cursor !== null ? (
                <SocialButton
                  label={t.loadMore}
                  onPress={() => void fetchPage(cursor)}
                />
              ) : null
            }
            renderItem={({ item }) => {
              const p = item.feature.properties;
              const ags = p.municipalityAgs;
              const municipality = p.municipalityName;
              const cardNode = (
                <PolygonFeedCard
                  item={item}
                  locale={locale}
                  nowMs={nowMs}
                  mapConfig={props.mapConfig}
                  voteBusy={votingId === item.feature.id}
                  canNarrowToMunicipality={scope.kind !== 'municipality'}
                  resolveUploadUrl={props.resolveUploadUrl}
                  onVote={(value) => vote(item.feature, value)}
                  onShowOnMap={(tab) => props.onShowOnMap(item.feature, tab)}
                  onOnlyMunicipality={() => {
                    if (ags && municipality) {
                      setScope({
                        kind: 'municipality',
                        ags,
                        name: municipality,
                      });
                    }
                  }}
                />
              );
              return columns > 1 ? (
                <View style={board.gridCellHalf}>{cardNode}</View>
              ) : (
                cardNode
              );
            }}
          />
        </View>
      </View>

      <View
        pointerEvents="box-none"
        accessibilityLiveRegion="polite"
        style={styles.newEntriesAnchor}
      >
        {newEntries.length > 0 ? (
          <Pressable
            testID="feed-new-entries"
            accessibilityRole="button"
            accessibilityLabel={`${newEntriesLabel}. ${t.newEntriesA11y}`}
            onPress={showNewEntries}
            style={styles.newEntriesPill}
          >
            <Text style={styles.newEntriesLabel}>↑ {newEntriesLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const board = StyleSheet.create({
  workspace: {
    flex: 1,
    width: '100%',
  },
  workspaceSplit: {
    flexDirection: 'row',
    maxWidth: 1400,
    alignSelf: 'center',
  },
  leftCompassRail: {
    width: 322,
    flexShrink: 0,
    paddingLeft: 18,
    paddingTop: 18,
    paddingBottom: 24,
  },
  gridPane: {
    flex: 1,
    minWidth: 0,
  },
  desktopGridContent: {
    padding: 18,
    paddingBottom: 96,
    gap: 16,
  },
  columnWrapper: {
    gap: 16,
    alignItems: 'stretch',
  },
  gridCell: {
    flex: 1,
    minWidth: 0,
  },
  gridCellHalf: {
    flex: 1,
    minWidth: 0,
    maxWidth: '50%',
  },
  skeletonRowDesktop: {
    flexDirection: 'row',
    gap: 16,
  },
});
