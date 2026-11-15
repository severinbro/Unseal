import {
  DEFAULT_LOCALE,
  getTranslations,
  type Locale,
} from '../i18n/translations';
import { PALETTE } from './tokens';

const STYLE_ELEMENT_ID = 'entsiegelung-craft-styles';

interface WebHeadLike {
  appendChild(node: unknown): void;
}

interface WebStyleElementLike {
  id: string;
  textContent: string | null;
}

interface WebHtmlElementLike {
  lang?: string;
  dataset?: Record<string, string>;
}

interface WebCraftDocumentLike {
  title?: string;
  head?: WebHeadLike | null;
  documentElement?: WebHtmlElementLike | null;
  getElementById?(id: string): unknown;
  createElement?(tagName: 'style'): WebStyleElementLike;
}

export const WEB_CRAFT_CSS = `
:root {
  color-scheme: light;
  --bg-ground: ${PALETTE.bgGround};
  --bg-surface: ${PALETTE.bgSurface};
  --bg-subtle: ${PALETTE.bgSubtle};
  --text-ink: ${PALETTE.inkPrimary};
  --text-muted: ${PALETTE.inkMuted};
  --accent-primary: ${PALETTE.accentPrimary};
  --border-subtle: ${PALETTE.borderSubtle};
}

html, body, #root {
  width: 100%;
  height: 100%;
  height: 100dvh;
  margin: 0;
  padding: 0;
  overflow: hidden;
  background-color: ${PALETTE.bgGround};
  color: ${PALETTE.inkPrimary};
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

::selection {
  background-color: ${PALETTE.accentPrimary};
  color: ${PALETTE.inkOnAccent};
}

:focus-visible {
  outline: 2px solid ${PALETTE.accentPrimary} !important;
  outline-offset: 2px !important;
}

table, .tabular, [data-metric], [data-num] {
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
}

* {
  box-sizing: border-box;
  scrollbar-width: thin;
  scrollbar-color: ${PALETTE.borderStrong} transparent;
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
  border: 1px solid ${PALETTE.borderSubtle} !important;
  box-shadow: 0 2px 6px rgba(18, 32, 25, 0.08) !important;
  overflow: hidden;
  background: ${PALETTE.bgSurface} !important;
}

.maplibregl-ctrl-group button {
  width: 40px !important;
  height: 40px !important;
}

.maplibregl-ctrl-attrib {
  font-size: 11px !important;
  line-height: 16px !important;
  background-color: rgba(255, 255, 255, 0.9) !important;
  color: ${PALETTE.inkSecondary} !important;
}

.maplibregl-ctrl-bottom-right .maplibregl-ctrl-attrib:not(.maplibregl-compact) {
  float: none !important;
  margin: 0 !important;
  padding: 2px 8px !important;
  border-top: 1px solid ${PALETTE.borderSubtle} !important;
  border-left: 1px solid ${PALETTE.borderSubtle} !important;
  border-radius: 6px 0 0 0 !important;
  max-width: calc(100vw - 16px);
}

.maplibregl-ctrl-bottom-right .maplibregl-ctrl-attrib.maplibregl-compact {
  float: none !important;
  margin: 0 8px 8px 0 !important;
  border: 1px solid ${PALETTE.borderSubtle} !important;
  border-radius: 12px !important;
}

/* Polygon opacity range slider in filter strip */
.entsiegelung-opacity-slider {
  accent-color: ${PALETTE.accentPrimary};
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

export function syncWebDocumentLocale(locale: Locale = DEFAULT_LOCALE): void {
  const doc = resolveWebDocument();
  if (!doc) {
    return;
  }

  if (doc.documentElement) {
    doc.documentElement.lang = locale;
  }

  doc.title = getTranslations(locale).app.documentTitle;
}

export function injectWebCraftStyles(locale: Locale = DEFAULT_LOCALE): void {
  const doc = resolveWebDocument();
  if (!doc) {
    return;
  }

  if (doc.documentElement) {
    doc.documentElement.lang = locale;
    if (doc.documentElement.dataset) {
      doc.documentElement.dataset['mode'] = 'operate';
    }
  }

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
