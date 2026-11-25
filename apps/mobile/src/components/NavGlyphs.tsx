// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import React from 'react';
import { Platform, View } from 'react-native';

interface GlyphProps {
  color: string;
  size?: number;
}

/** Line icons drawn as SVG on the web; `paths` use a 24 x 24 grid. */
function svgGlyph(
  paths: readonly string[],
  { color, size = 20 }: GlyphProps,
): React.JSX.Element {
  return React.createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: color,
      strokeWidth: '2',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
      style: { flexShrink: 0, display: 'block' },
    },
    ...paths.map((d) => React.createElement('path', { key: d, d })),
  );
}

/** Boxes for the native builds, which have no SVG library. */
function Frame(props: {
  size: number;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <View accessible={false} style={{ width: props.size, height: props.size }}>
      {props.children}
    </View>
  );
}

/** A folded map. */
export function MapGlyph({ color, size = 20 }: GlyphProps): React.JSX.Element {
  if (Platform.OS === 'web') {
    return svgGlyph(
      ['M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z', 'M9 4v13.5', 'M15 6.5V20'],
      { color, size },
    );
  }
  const third = size / 3;
  return (
    <Frame size={size}>
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: i * third,
            top: size * (i === 1 ? 0.22 : 0.14),
            width: third + 1,
            height: size * 0.64,
            borderWidth: 1.6,
            borderColor: color,
          }}
        />
      ))}
    </Frame>
  );
}

/** Entries with a picture and text. */
export function FeedGlyph({ color, size = 20 }: GlyphProps): React.JSX.Element {
  if (Platform.OS === 'web') {
    return svgGlyph(
      [
        'M3.5 4.5h6v6h-6z',
        'M3.5 13.5h6v6h-6z',
        'M13.5 5.5h7',
        'M13.5 9.5h4.5',
        'M13.5 14.5h7',
        'M13.5 18.5h4.5',
      ],
      { color, size },
    );
  }
  return (
    <Frame size={size}>
      {[0.12, 0.56].map((top) => (
        <React.Fragment key={top}>
          <View
            style={{
              position: 'absolute',
              left: size * 0.08,
              top: size * top,
              width: size * 0.32,
              height: size * 0.32,
              borderWidth: 1.6,
              borderColor: color,
            }}
          />
          <View
            style={{
              position: 'absolute',
              left: size * 0.52,
              top: size * (top + 0.13),
              width: size * 0.4,
              height: 1.8,
              backgroundColor: color,
            }}
          />
        </React.Fragment>
      ))}
    </Frame>
  );
}

/** A speech bubble. */
export function ChatGlyph({ color, size = 20 }: GlyphProps): React.JSX.Element {
  if (Platform.OS === 'web') {
    return svgGlyph(
      [
        'M20 4H4a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 4 16h3v4.5L12 16h8a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 20 4z',
        'M7.5 8.5h9',
        'M7.5 12h6',
      ],
      { color, size },
    );
  }
  return (
    <Frame size={size}>
      <View
        style={{
          position: 'absolute',
          left: size * 0.08,
          top: size * 0.12,
          width: size * 0.84,
          height: size * 0.58,
          borderWidth: 1.6,
          borderRadius: size * 0.16,
          borderColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: size * 0.3,
          top: size * 0.62,
          width: size * 0.2,
          height: size * 0.2,
          borderLeftWidth: 1.6,
          borderBottomWidth: 1.6,
          borderColor: color,
          transform: [{ rotate: '-25deg' }],
        }}
      />
    </Frame>
  );
}

/** Head and shoulders. */
export function UserGlyph({ color, size = 18 }: GlyphProps): React.JSX.Element {
  if (Platform.OS === 'web') {
    return svgGlyph(
      ['M12 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4.5 20.5a7.5 7.5 0 0 1 15 0'],
      { color, size },
    );
  }
  return (
    <Frame size={size}>
      <View
        style={{
          position: 'absolute',
          left: size * 0.3,
          top: size * 0.08,
          width: size * 0.4,
          height: size * 0.4,
          borderRadius: size * 0.2,
          borderWidth: 1.6,
          borderColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: size * 0.14,
          top: size * 0.58,
          width: size * 0.72,
          height: size * 0.34,
          borderTopLeftRadius: size * 0.34,
          borderTopRightRadius: size * 0.34,
          borderWidth: 1.6,
          borderBottomWidth: 0,
          borderColor: color,
        }}
      />
    </Frame>
  );
}

/** A check mark in a filled circle. */
export function VerifiedGlyph({
  color,
  size = 16,
}: GlyphProps): React.JSX.Element {
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
      React.createElement('circle', { cx: 12, cy: 12, r: 10.5, fill: color }),
      React.createElement('path', {
        d: 'M7 12.4l3.4 3.4L17 9.2',
        stroke: '#FFFFFF',
        strokeWidth: '2.6',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
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
        backgroundColor: color,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          width: size * 0.5,
          height: size * 0.28,
          marginTop: -size * 0.1,
          borderLeftWidth: 1.8,
          borderBottomWidth: 1.8,
          borderColor: '#FFFFFF',
          transform: [{ rotate: '-45deg' }],
        }}
      />
    </View>
  );
}
