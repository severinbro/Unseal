// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import React, { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import {
  getCachedSnapshot,
  requestSnapshot,
  type MapSnapshot,
  type SnapshotRequest,
} from './mapSnapshots.web';
import { MAP_PREVIEW_HEIGHT, type MapPreviewProps } from './MapPreview.types';

/** Cards get one of two widths, so resizing the window needs few new pictures. */
function previewWidth(available: number): number {
  return available <= 420 ? 420 : 720;
}

/** The list the card is in; margins only take effect against the real root. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(node).overflowY)) {
      return node;
    }
  }
  return null;
}

/** An area on a still picture of the basemap. */
export function MapPreview(props: MapPreviewProps): React.JSX.Element {
  const { geometry, color, dashed, config, colorScheme } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [snapshot, setSnapshot] = useState<MapSnapshot | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return;
    }
    let mounted = true;
    let visible = false;
    let requested = false;
    const load = (): void => {
      const request: SnapshotRequest = {
        geometry,
        color,
        dashed,
        config,
        colorScheme,
        width: previewWidth(host.clientWidth),
        height: MAP_PREVIEW_HEIGHT,
      };
      const cached = getCachedSnapshot(request);
      if (cached !== null) {
        setSnapshot(cached);
        requested = true;
        return;
      }
      requested = true;
      void requestSnapshot(request, () => mounted && visible).then((result) => {
        if (!mounted) {
          return;
        }
        if (result !== null) {
          setSnapshot(result);
        } else if (!visible) {
          // Scrolled past before its turn came; asks again when it is back.
          requested = false;
        }
      });
    };
    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries.some((entry) => entry.isIntersecting);
        if (visible && !requested) {
          load();
        }
      },
      { root: scrollParent(host), rootMargin: '400px 0px' },
    );
    observer.observe(host);
    return () => {
      mounted = false;
      observer.disconnect();
    };
  }, [geometry, color, dashed, config, colorScheme]);

  return (
    <View
      ref={(node) => {
        hostRef.current = node as unknown as HTMLDivElement | null;
      }}
      style={styles.host}
    >
      {snapshot !== null ? (
        <>
          <Image
            source={{ uri: snapshot.src }}
            style={styles.image}
            resizeMode="cover"
            accessible={false}
          />
          <Text numberOfLines={1} style={styles.credit} testID="map-preview-credit">
            {snapshot.credit}
          </Text>
        </>
      ) : (
        props.fallback
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    height: MAP_PREVIEW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { ...StyleSheet.absoluteFillObject },
  credit: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    maxWidth: '100%',
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 10,
    color: '#1b2420',
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
    borderTopLeftRadius: 6,
  },
});
