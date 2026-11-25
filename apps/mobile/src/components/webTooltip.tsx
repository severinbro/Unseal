// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import React from 'react';
import { Platform } from 'react-native';

/** Adds a hover hint on the web; elsewhere the accessibility label has to do. */
export function withWebTooltip(
  tooltip: string,
  child: React.JSX.Element,
): React.JSX.Element {
  if (Platform.OS !== 'web') {
    return child;
  }
  return React.createElement(
    'div',
    {
      // createElement would turn a missing key into the string "null".
      ...(child.key !== null ? { key: child.key } : {}),
      title: tooltip,
      style: { display: 'inline-flex', flexShrink: 0 },
    },
    child,
  );
}
