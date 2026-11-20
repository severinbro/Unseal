// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import { DEFAULT_APP_NAME, type BrandingConfig } from '@openunseal/shared';

import {
  DEFAULT_LOCALE,
  getTranslations,
  type Locale,
} from '../i18n/translations';
import {
  DARK_PALETTE,
  LIGHT_PALETTE,
  type ColorScheme,
  type ThemePalette,
} from './tokens';

const STYLE_ELEMENT_ID = 'entsiegelung-craft-styles';

interface WebHeadLike {
  appendChild(node: unknown): void;
}

interface WebStyleElementLike {
  id: string;
  textContent: string | null;
}

interface WebStyleDeclLike {
  setProperty?(name: string, value: string): void;
  removeProperty?(name: string): void;
}

interface WebHtmlElementLike {
  lang?: string;
  dataset?: Record<string, string>;
  style?: WebStyleDeclLike;
}

interface WebMetaElementLike {
  content?: string;
  setAttribute?(name: string, value: string): void;
}

interface WebCraftDocumentLike {
  title?: string;
  head?: WebHeadLike | null;
  documentElement?: WebHtmlElementLike | null;
  getElementById?(id: string): unknown;
  querySelector?(selector: string): WebMetaElementLike | null;
  createElement?(tagName: 'style'): WebStyleElementLike;
}

export const WEB_CRAFT_CSS = `
:root {
  color-scheme: light;
  --bg-ground: ${LIGHT_PALETTE.bgGround};
  --bg-surface: ${LIGHT_PALETTE.bgSurface};
  --bg-subtle: ${LIGHT_PALETTE.bgSubtle};
  --bg-attrib: rgba(255, 255, 255, 0.9);
  --text-ink: ${LIGHT_PALETTE.inkPrimary};
  --text-secondary: ${LIGHT_PALETTE.inkSecondary};
  --text-muted: ${LIGHT_PALETTE.inkMuted};
  --text-on-accent: ${LIGHT_PALETTE.inkOnAccent};
  --accent-primary: ${LIGHT_PALETTE.accentPrimary};
  --border-subtle: ${LIGHT_PALETTE.borderSubtle};
  --border-strong: ${LIGHT_PALETTE.borderStrong};
  --ctrl-shadow: 0 2px 6px rgba(18, 32, 25, 0.08);
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --bg-ground: ${DARK_PALETTE.bgGround};
  --bg-surface: ${DARK_PALETTE.bgSurface};
  --bg-subtle: ${DARK_PALETTE.bgSubtle};
  --bg-attrib: rgba(22, 32, 27, 0.92);
  --text-ink: ${DARK_PALETTE.inkPrimary};
  --text-secondary: ${DARK_PALETTE.inkSecondary};
  --text-muted: ${DARK_PALETTE.inkMuted};
  --text-on-accent: ${DARK_PALETTE.inkOnAccent};
  --accent-primary: ${DARK_PALETTE.accentPrimary};
  --border-subtle: ${DARK_PALETTE.borderSubtle};
  --border-strong: ${DARK_PALETTE.borderStrong};
  --ctrl-shadow: 0 3px 10px rgba(0, 0, 0, 0.42);
}

html, body, #root {
  width: 100%;
  height: 100%;
  height: 100dvh;
  margin: 0;
  padding: 0;
  overflow: hidden;
  background-color: var(--bg-ground);
  color: var(--text-ink);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

::selection {
  background-color: var(--accent-primary);
  color: var(--text-on-accent);
}

:focus-visible {
  outline: 2px solid var(--accent-primary) !important;
  outline-offset: 2px !important;
}

table, .tabular, [data-metric], [data-num] {
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
}

* {
  box-sizing: border-box;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
}

/* Calibrate MapLibre controls to match civic cartography chrome & >=36-44px touch targets */
.maplibregl-ctrl-bottom-right {
  display: flex !important;
  flex-direction: column !important;
  align-items: flex-end !important;
  bottom: 0 !important;
  right: 0 !important;
}

.maplibregl-ctrl-bottom-right .maplibregl-ctrl-group {
  float: none !important;
  margin: 0 12px 10px 0 !important;
}

.maplibregl-ctrl-group {
  border-radius: 10px !important;
  border: 1px solid var(--border-subtle) !important;
  box-shadow: var(--ctrl-shadow) !important;
  overflow: hidden;
  background: var(--bg-surface) !important;
}

.maplibregl-ctrl-group button {
  width: 40px !important;
  height: 40px !important;
}

.maplibregl-ctrl-group button + button {
  border-top: 1px solid var(--border-subtle) !important;
}

:root[data-theme="dark"] .maplibregl-ctrl-group button:not(:disabled):hover {
  background-color: var(--bg-subtle) !important;
}

:root[data-theme="dark"] .maplibregl-ctrl-group button .maplibregl-ctrl-icon {
  filter: invert(1) hue-rotate(180deg) brightness(1.08);
}

.maplibregl-ctrl-attrib {
  font-size: 11px !important;
  line-height: 16px !important;
  background-color: var(--bg-attrib) !important;
  color: var(--text-secondary) !important;
  overflow-wrap: anywhere;
}

.maplibregl-ctrl-attrib a {
  color: var(--text-secondary) !important;
}

:root[data-theme="dark"] .maplibregl-ctrl-attrib.maplibregl-compact .maplibregl-ctrl-attrib-button {
  background-color: var(--bg-surface) !important;
  filter: invert(1) hue-rotate(180deg);
}

.maplibregl-ctrl-bottom-right .maplibregl-ctrl-attrib:not(.maplibregl-compact) {
  float: none !important;
  margin: 0 !important;
  padding: 2px 8px !important;
  border-top: 1px solid var(--border-subtle) !important;
  border-left: 1px solid var(--border-subtle) !important;
  border-radius: 6px 0 0 0 !important;
  max-width: calc(100vw - 16px);
}

.maplibregl-ctrl-bottom-right .maplibregl-ctrl-attrib.maplibregl-compact {
  float: none !important;
  margin: 0 8px 8px 0 !important;
  border: 1px solid var(--border-subtle) !important;
  border-radius: 12px !important;
}

/* Polygon opacity range slider in filter strip */
.entsiegelung-opacity-slider {
  accent-color: var(--accent-primary);
  cursor: pointer;
  margin: 0;
  height: 18px;
  touch-action: none;
}

.entsiegelung-opacity-slider:active {
  cursor: grabbing;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`;

function resolveWebDocument(): WebCraftDocumentLike | null {
  const scope = globalThis as {
    document?: WebCraftDocumentLike;
    navigator?: { product?: string };
  };
  if (scope.navigator?.product === 'ReactNative' || !scope.document) {
    return null;
  }
  return scope.document;
}

export function formatWebDocumentTitle(
  locale: Locale,
  branding?: Partial<
    Pick<BrandingConfig, 'appName' | 'subtitleDe' | 'subtitleEn'>
  > | null,
): string {
  const dict = getTranslations(locale);
  const customAppName = branding?.appName?.trim();
  const customSubtitle =
    (locale === 'en' ? branding?.subtitleEn : branding?.subtitleDe)?.trim() ||
    null;
  if (!customAppName && !customSubtitle) {
    return dict.app.documentTitle;
  }
  const effectiveName = customAppName || DEFAULT_APP_NAME;
  if (effectiveName === DEFAULT_APP_NAME && !customSubtitle) {
    return dict.app.documentTitle;
  }
  const effectiveSubtitle = customSubtitle ?? dict.about.subtitle;
  return `${effectiveName} - ${effectiveSubtitle}`;
}

export function syncWebDocumentLocale(
  locale: Locale = DEFAULT_LOCALE,
  branding?: Partial<
    Pick<BrandingConfig, 'appName' | 'subtitleDe' | 'subtitleEn'>
  > | null,
): void {
  const doc = resolveWebDocument();
  if (!doc) {
    return;
  }

  if (doc.documentElement) {
    doc.documentElement.lang = locale;
  }

  doc.title = formatWebDocumentTitle(locale, branding);
}

function syncThemeColorMeta(
  doc: WebCraftDocumentLike,
  colorScheme: ColorScheme,
): void {
  if (typeof doc.querySelector !== 'function') {
    return;
  }
  const meta = doc.querySelector('meta[name="theme-color"]');
  if (!meta) {
    return;
  }
  const nextColor =
    colorScheme === 'dark' ? DARK_PALETTE.bgGround : LIGHT_PALETTE.bgGround;
  if (typeof meta.setAttribute === 'function') {
    meta.setAttribute('content', nextColor);
  } else {
    meta.content = nextColor;
  }
}

export function syncWebDocumentTheme(
  colorScheme: ColorScheme = 'light',
  palette?: Pick<ThemePalette, 'accentPrimary' | 'inkOnAccent'> | null,
): void {
  const doc = resolveWebDocument();
  if (!doc) {
    return;
  }
  if (doc.documentElement?.dataset) {
    doc.documentElement.dataset['theme'] = colorScheme;
  }
  const styleDecl = doc.documentElement?.style;
  if (styleDecl) {
    const base = colorScheme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE;
    const isCustom =
      palette != null &&
      (palette.accentPrimary !== base.accentPrimary ||
        palette.inkOnAccent !== base.inkOnAccent);
    if (isCustom && typeof styleDecl.setProperty === 'function') {
      styleDecl.setProperty('--accent-primary', palette.accentPrimary);
      styleDecl.setProperty('--text-on-accent', palette.inkOnAccent);
    } else if (typeof styleDecl.removeProperty === 'function') {
      styleDecl.removeProperty('--accent-primary');
      styleDecl.removeProperty('--text-on-accent');
    }
  }
  syncThemeColorMeta(doc, colorScheme);
}

export function injectWebCraftStyles(
  locale: Locale = DEFAULT_LOCALE,
  colorScheme: ColorScheme = 'light',
): void {
  const doc = resolveWebDocument();
  if (!doc) {
    return;
  }

  if (doc.documentElement) {
    doc.documentElement.lang = locale;
    if (doc.documentElement.dataset) {
      doc.documentElement.dataset['mode'] = 'operate';
      doc.documentElement.dataset['theme'] = colorScheme;
    }
  }
  syncThemeColorMeta(doc, colorScheme);

  doc.title = getTranslations(locale).app.documentTitle;

  if (typeof doc.getElementById === 'function' && doc.getElementById(STYLE_ELEMENT_ID)) {
    return;
  }

  if (doc.head && typeof doc.createElement === 'function') {
    const styleEl = doc.createElement('style');
    styleEl.id = STYLE_ELEMENT_ID;
    styleEl.textContent = WEB_CRAFT_CSS;
    doc.head.appendChild(styleEl);
  }
}
