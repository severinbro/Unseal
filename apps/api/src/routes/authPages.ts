// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 OpenUnseal Contributors

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ZodError } from 'zod';

import {
  AUTHOR_ACTIVITY,
  AUTH_LIMITS,
  ApiError,
  CHAT_LIMITS,
  DEFAULT_APP_NAME,
  FEED_LIMITS,
  HELP_WANTED_DAYS,
  PHOTO_LIMITS,
  formatStateDop20FullAttribution,
} from '@openunseal/shared';

import { resolveRuntimeBranding } from '../config.js';
import {
  BKG_VG250_DATENQUELLEN_URL,
  getMunicipalitiesStatus,
} from '../municipalities/vg250.js';
import { deriveServerBrandColors } from '../util/brandingTheme.js';
import {
  consumePasswordResetToken,
  consumeVerifyEmailToken,
  inspectEmailActionToken,
} from './auth.js';
import { GERMAN_STATE_DOP20_PROVIDERS } from './dop20Tiles.js';

import type { FastifyInstance, FastifyReply } from 'fastify';

let cachedThirdPartyNotices: string | null = null;

async function readThirdPartyNoticesText(): Promise<string | null> {
  if (cachedThirdPartyNotices !== null) {
    return cachedThirdPartyNotices;
  }
  const candidates = [
    fileURLToPath(new URL('../../../../THIRD_PARTY_NOTICES.txt', import.meta.url)),
    path.resolve(process.cwd(), 'THIRD_PARTY_NOTICES.txt'),
    path.resolve(process.cwd(), '../../THIRD_PARTY_NOTICES.txt'),
  ];
  for (const candidate of candidates) {
    try {
      const content = await fs.readFile(candidate, 'utf8');
      if (content.length > 0) {
        cachedThirdPartyNotices = content;
        return content;
      }
    } catch {
      // Try next candidate path.
    }
  }
  return null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMultilineHtml(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, '<br />');
}

function buildHostedCsp(logoUrl: string | null, publicBaseUrl: string): string {
  if (!logoUrl) {
    return "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
  }
  let imgSrc = "'self'";
  if (!logoUrl.startsWith('/')) {
    try {
      const logoOrigin = new URL(logoUrl).origin;
      const baseOrigin = new URL(publicBaseUrl).origin;
      if (logoOrigin !== baseOrigin) {
        imgSrc = `'self' ${logoOrigin}`;
      }
    } catch {
      // Fall back to 'self' on unexpected URL format.
    }
  }
  return `default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`;
}

type HostedPageTheme = 'light' | 'dark' | null;

function parseRequestedTheme(source: unknown): HostedPageTheme {
  const raw = readStringField(source, 'theme').trim().toLowerCase();
  if (raw === 'light' || raw === 'dark') {
    return raw;
  }
  return null;
}

function appendHostedThemeParam(
  url: string,
  theme: HostedPageTheme,
  publicBaseUrl: string,
): string {
  if (!theme) {
    return url;
  }
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return url;
  }
  try {
    if (trimmed.startsWith('/')) {
      const parsed = new URL(trimmed, 'http://localhost');
      if (
        !parsed.pathname.startsWith('/auth/') ||
        parsed.pathname === '/auth/third-party-notices'
      ) {
        return url;
      }
      parsed.searchParams.set('theme', theme);
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    const parsed = new URL(trimmed);
    const baseOrigin = new URL(publicBaseUrl).origin;
    if (
      parsed.origin !== baseOrigin ||
      !parsed.pathname.startsWith('/auth/') ||
      parsed.pathname === '/auth/third-party-notices'
    ) {
      return url;
    }
    parsed.searchParams.set('theme', theme);
    return parsed.toString();
  } catch {
    return url;
  }
}

function sendHostedHtml(
  app: FastifyInstance,
  reply: FastifyReply,
  statusCode: number,
  title: string,
  bodyHtml: string,
  options: { wide?: boolean; theme?: HostedPageTheme } = {},
): FastifyReply {
  const maxWidthPx = options.wide ? 680 : 460;
  const theme = options.theme ?? null;
  const htmlThemeAttr = theme ? ` data-theme="${theme}"` : '';
  const branding = resolveRuntimeBranding(app.config);
  const colors = deriveServerBrandColors(
    branding.accentColor,
    branding.accentDarkColor,
  );
  const darkVarsCss = `
      --bg: #0f1613;
      --fg: #ecf3ef;
      --card-bg: #16201b;
      --card-border: #2b3b32;
      --card-shadow: 0 14px 36px rgba(0, 0, 0, 0.48);
      --brand-fg: ${colors.brandTextDark};
      --brand-bg: ${colors.brandBgDark};
      --accent: ${colors.accentDark};
      --text-muted: #b7c7be;
      --sub-fg: #93a89d;
      --divider: #26352d;
      --alert-ok-bg: #132e22;
      --alert-ok-border: #235c42;
      --alert-ok-fg: #6ee7b7;
      --alert-err-bg: #311518;
      --alert-err-border: #70262c;
      --alert-err-fg: #fca5a5;
      --alert-warn-bg: #2d2210;
      --alert-warn-border: #6b4e1b;
      --alert-warn-fg: #fcd34d;
      --label-fg: #ecf3ef;
      --input-border: #394d42;
      --input-bg: #121a16;
      --input-fg: #ecf3ef;
      --focus: ${colors.accentDark};
      --btn-bg: ${colors.accentDark};
      --btn-fg: ${colors.inkOnAccentDark};
      --btn-hover: ${colors.buttonDarkHover};`;
  const brandMarkHtml = branding.logoUrl
    ? `<img src="${escapeHtml(branding.logoUrl)}" alt="" width="22" height="22" class="brand-logo" />`
    : `<svg width="22" height="22" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect width="64" height="64" rx="14" fill="#EFF3F0"/>
        <path d="M0 40H26L31 50L37 40H64V50C64 57.732 57.732 64 50 64H14C6.26801 64 0 57.732 0 50V40Z" fill="#5A6360"/>
        <path d="M31 49C31 38 32 30 37 22" stroke="#176642" stroke-width="4" stroke-linecap="round"/>
        <path d="M34 26C35 16 44 13 49 15C48 22 42 27 34 26Z" fill="#1F7A4C"/>
        <path d="M31 34C29 27 22 25 18 26C19 31 25 35 31 34Z" fill="#176642"/>
      </svg>`;
  const html = `<!doctype html>
<html lang="de"${htmlThemeAttr}>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} - ${escapeHtml(branding.appName)}</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f3f5f1;
      --fg: #16201a;
      --card-bg: #ffffff;
      --card-border: #d5ddd7;
      --card-shadow: 0 12px 32px rgba(18, 34, 25, 0.08);
      --brand-fg: ${colors.accentLight};
      --brand-bg: ${colors.brandBgLight};
      --accent: ${colors.accentLight};
      --text-muted: #3a4940;
      --sub-fg: #5b6b61;
      --divider: #e4ebe6;
      --alert-ok-bg: #eaf5ef;
      --alert-ok-border: #8bc9a8;
      --alert-ok-fg: #155236;
      --alert-err-bg: #fdf0ee;
      --alert-err-border: #e3a097;
      --alert-err-fg: #962d20;
      --alert-warn-bg: #fef7e8;
      --alert-warn-border: #e6c67c;
      --alert-warn-fg: #6b4c0e;
      --label-fg: #24332a;
      --input-border: #bdcac1;
      --input-bg: #fbfcfa;
      --input-fg: #16201a;
      --focus: ${colors.buttonLight};
      --btn-bg: ${colors.buttonLight};
      --btn-fg: ${colors.inkOnAccentLight};
      --btn-hover: ${colors.buttonLightHover};
    }
    :root[data-theme="light"] {
      color-scheme: light;
    }
    :root[data-theme="dark"] {
      color-scheme: dark;${darkVarsCss}
    }
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) {${darkVarsCss}
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      padding: 20px;
      background: var(--bg);
      color: var(--fg);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .card {
      width: 100%;
      max-width: ${maxWidthPx}px;
      margin: auto 0;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 18px;
      padding: 28px 24px;
      box-shadow: var(--card-shadow);
      overflow-wrap: anywhere;
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      max-width: 100%;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: -0.01em;
      color: var(--brand-fg);
      background: var(--brand-bg);
      padding: 5px 12px 5px 7px;
      border-radius: 999px;
      margin-bottom: 16px;
    }
    .brand-logo {
      width: 22px;
      height: 22px;
      border-radius: 5px;
      object-fit: contain;
      display: block;
    }
    h1 {
      margin: 0 0 10px;
      font-size: 22px;
      line-height: 1.25;
      letter-spacing: -0.02em;
    }
    h2 {
      margin: 18px 0 8px;
      font-size: 16px;
      line-height: 1.3;
      color: var(--accent);
    }
    p {
      margin: 0 0 14px;
      font-size: 15px;
      line-height: 1.55;
      color: var(--text-muted);
    }
    a {
      color: var(--accent);
      overflow-wrap: anywhere;
    }
    code, pre {
      overflow-wrap: anywhere;
    }
    pre {
      max-width: 100%;
      overflow-x: auto;
    }
    @media (max-width: 480px) {
      body {
        padding: 12px;
      }
      .card {
        padding: 20px 16px;
        border-radius: 14px;
      }
      h1 {
        font-size: 20px;
      }
    }
    .en-sub {
      font-size: 13px;
      color: var(--sub-fg);
      border-top: 1px solid var(--divider);
      padding-top: 14px;
      margin-top: 18px;
    }
    .legal-nav {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 14px;
      font-size: 13px;
      color: var(--sub-fg);
      border-top: 1px solid var(--divider);
      padding-top: 14px;
      margin-top: 18px;
    }
    .alert-ok {
      background: var(--alert-ok-bg);
      border: 1px solid var(--alert-ok-border);
      color: var(--alert-ok-fg);
      padding: 12px 14px;
      border-radius: 12px;
      font-weight: 600;
      margin-bottom: 16px;
    }
    .alert-err {
      background: var(--alert-err-bg);
      border: 1px solid var(--alert-err-border);
      color: var(--alert-err-fg);
      padding: 12px 14px;
      border-radius: 12px;
      font-weight: 600;
      margin-bottom: 16px;
    }
    .alert-warn {
      background: var(--alert-warn-bg);
      border: 1px solid var(--alert-warn-border);
      color: var(--alert-warn-fg);
      padding: 12px 14px;
      border-radius: 12px;
      font-size: 14px;
      margin-bottom: 16px;
    }
    label {
      display: block;
      font-size: 13px;
      font-weight: 700;
      margin-bottom: 6px;
      color: var(--label-fg);
    }
    input[type="password"] {
      width: 100%;
      min-height: 46px;
      padding: 10px 14px;
      border: 1px solid var(--input-border);
      border-radius: 10px;
      font-size: 15px;
      margin-bottom: 14px;
      background: var(--input-bg);
      color: var(--input-fg);
    }
    input[type="password"]:focus {
      outline: 2px solid var(--focus);
      border-color: var(--focus);
    }
    button {
      width: 100%;
      min-height: 48px;
      border: none;
      border-radius: 999px;
      background: var(--btn-bg);
      color: var(--btn-fg);
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
    }
    button:hover {
      background: var(--btn-hover);
    }
    ul {
      margin: 0 0 16px;
      padding-left: 20px;
      color: var(--text-muted);
      font-size: 14px;
      line-height: 1.5;
    }
    li { margin-bottom: 8px; }
  </style>
</head>
<body>
  <main class="card">
    <div class="brand">
      ${brandMarkHtml}
      <span>${escapeHtml(branding.appName)}</span>
    </div>
    ${bodyHtml}
  </main>
</body>
</html>`;

  return reply
    .status(statusCode)
    .header('Content-Type', 'text/html; charset=utf-8')
    .header('Cache-Control', 'no-store')
    .header('Referrer-Policy', 'no-referrer')
    .header('X-Content-Type-Options', 'nosniff')
    .header(
      'Content-Security-Policy',
      buildHostedCsp(branding.logoUrl, app.config.publicBaseUrl),
    )
    .send(html);
}

function readStringField(
  source: unknown,
  key: string,
): string {
  if (typeof source !== 'object' || source === null) {
    return '';
  }
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

function buildLegalNavHtml(
  app: FastifyInstance,
  theme: HostedPageTheme = null,
): string {
  const withTheme = (url: string): string =>
    appendHostedThemeParam(url, theme, app.config.publicBaseUrl);
  return `<nav class="legal-nav" aria-label="Rechtliche Hinweise">
    <a href="${escapeHtml(withTheme(app.config.impressumUrl))}">Impressum</a>
    <a href="${escapeHtml(withTheme(app.config.privacyPolicyUrl))}">Datenschutz</a>
    <a href="${escapeHtml(withTheme(app.config.termsUrl))}">Nutzungsbedingungen</a>
    <a href="${escapeHtml(withTheme(app.config.licensesUrl))}">Open-Source-Lizenzen</a>
    <a href="${escapeHtml(app.config.sourceCodeUrl)}" target="_blank" rel="noopener noreferrer">Quellcode (AGPL-3.0 / MPL-2.0)</a>
  </nav>`;
}

function formatContactHtml(value: string): string {
  const trimmed = value.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    const safe = escapeHtml(trimmed);
    return `<a href="mailto:${safe}">${safe}</a>`;
  }
  return escapeHtml(trimmed);
}

function buildOperatorIdentityHtml(app: FastifyInstance): string {
  const parts: string[] = [];
  if (app.config.operatorName) {
    parts.push(`<strong>${escapeHtml(app.config.operatorName)}</strong>`);
  }
  if (app.config.operatorAddress) {
    parts.push(formatMultilineHtml(app.config.operatorAddress));
  }
  if (app.config.operatorEmail) {
    parts.push(`E-Mail: ${formatContactHtml(app.config.operatorEmail)}`);
  }
  if (app.config.operatorPhone) {
    parts.push(`Telefon: ${escapeHtml(app.config.operatorPhone)}`);
  }
  const missing = [
    app.config.operatorName ? null : 'OPERATOR_NAME',
    app.config.operatorAddress ? null : 'OPERATOR_ADDRESS',
    app.config.operatorEmail ? null : 'OPERATOR_EMAIL',
  ].filter((name): name is string => name !== null);
  const warning =
    missing.length > 0
      ? `<div class="alert-warn"><strong>Hinweis für Betreibende:</strong> Bitte hinterlege ${missing
          .map((name) => `<code>${name}</code>`)
          .join(', ')} in der Server-Konfiguration (<code>.env</code> / <code>.env.vps</code>); die Angabe ist nach § 5 DDG / Art. 13 DSGVO Pflicht.</div>`
      : '';
  return parts.length > 0 ? `<p>${parts.join('<br />')}</p>${warning}` : warning;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * Third-party data flows depend on this instance's configuration, so the
 * privacy policy describes the *configured* basemap and aerial imagery sources
 * instead of hard-coded defaults (GDPR Art. 13(1)(e)).
 */
function buildThirdPartyItemsHtml(app: FastifyInstance): string {
  const items: string[] = [];
  const config = app.config;

  const hosting = config.privacyHostingProvider
    ? escapeHtml(config.privacyHostingProvider)
    : 'ein Server-Hosting-Anbieter (VPS)';
  items.push(
    `<li><strong>Hosting (Auftragsverarbeitung, Art. 28 DSGVO):</strong> ${hosting} betreibt den Server, auf dem Datenbank, Fotos und diese Seiten liegen.</li>`,
  );

  const mailProvider = config.privacyEmailProvider
    ? escapeHtml(config.privacyEmailProvider)
    : 'ein E-Mail-Dienst (SMTP)';
  const tlsNote = config.smtp.requireTls || config.smtp.secure
    ? ' E-Mails werden nur über eine verschlüsselte Verbindung an den Mailserver übergeben.'
    : '';
  items.push(
    `<li><strong>E-Mail-Versand (Auftragsverarbeitung, Art. 28 DSGVO):</strong> ${mailProvider} versendet Bestätigungs- und Wiederherstellungslinks, Moderationshinweise sowie Fehler- und Inhaltsmeldungen an die Betreiberstelle (bei gemeldeten Direktnachrichten einschließlich des Nachrichtentextes).${tlsNote}</li>`,
  );

  const styleHosts = Array.from(
    new Set(
      [hostOf(config.osmStyleUrl), hostOf(config.osmDarkStyleUrl)].filter(
        (h): h is string => h !== null,
      ),
    ),
  );
  if (styleHosts.length === 0) {
    items.push(
      '<li><strong>Basiskarte:</strong> Kartenstil, Schriften und Vektorkacheln werden von diesem Server geladen.</li>',
    );
  } else {
    const provider = styleHosts
      .map((host) =>
        host === 'tiles.openfreemap.org'
          ? '<em>OpenFreeMap</em> (Betreiber: <strong>Hyperknot Software Kft.</strong>, Ungarn; <a href="https://openfreemap.org/privacy" target="_blank" rel="noopener noreferrer">Datenschutzhinweise</a>; Auslieferung u. a. über <strong>Cloudflare CDN</strong>, wobei eine Übermittlung in Drittländer wie die USA auf Grundlage des EU-US Data Privacy Framework / von Standardvertragsklauseln erfolgen kann; Kartendaten © OpenStreetMap-Mitwirkende)'
          : `<code>${escapeHtml(host)}</code>`,
      )
      .join(' bzw. ');
    items.push(
      `<li><strong>Basiskarte (Art. 6 Abs. 1 lit. f DSGVO; Art. 13 Abs. 1 lit. f DSGVO):</strong> Dein Endgerät lädt Kartenstil, Schriften und Vektorkacheln <strong>direkt</strong> von ${provider} (bzw. den dort im Kartenstil angegebenen Servern). Dabei wird technisch bedingt deine IP-Adresse an diesen Anbieter übermittelt. Unser Interesse: eine funktionierende Kartendarstellung.</li>`,
    );
  }

  const ortho = config.orthophoto;
  if (ortho === null) {
    items.push('<li><strong>Luftbilder:</strong> Auf dieser Instanz deaktiviert.</li>');
  } else if (ortho.urlTemplate.includes('/api/v1/tiles/dop20/')) {
    items.push(
      '<li><strong>Luftbilder (DOP20):</strong> Werden über diesen Server von den Vermessungsverwaltungen der Bundesländer abgerufen. Diese erhalten nur Kachelkoordinaten, nicht deine IP-Adresse.</li>',
    );
  } else {
    const orthoHost = hostOf(ortho.urlTemplate);
    items.push(
      orthoHost === null
        ? '<li><strong>Luftbilder:</strong> Werden von diesem Server geladen.</li>'
        : `<li><strong>Luftbilder (Art. 6 Abs. 1 lit. f DSGVO):</strong> Dein Endgerät lädt Luftbildkacheln <strong>direkt</strong> von <code>${escapeHtml(orthoHost)}</code>; dabei wird deine IP-Adresse an diesen Anbieter übermittelt.</li>`,
    );
  }

  items.push(
    '<li><strong>Adresssuche (Art. 6 Abs. 1 lit. b DSGVO):</strong> Suchanfragen werden über diesen Server an OpenStreetMap Nominatim (OpenStreetMap Foundation, Vereinigtes Königreich - Angemessenheitsbeschluss der EU-Kommission) weitergeleitet. Übermittelt wird nur der Suchtext, nicht deine IP-Adresse. Ergebnisse werden bis zu 10 Minuten im Arbeitsspeicher zwischengespeichert; Suchtexte werden nicht protokolliert.</li>',
  );

  items.push(
    '<li><strong>Kartenebene „Flächennutzung“:</strong> Zeigt Landnutzungsdaten aus den auf diesem Server geladenen Referenzdaten, keine Eigentümer- oder Personendaten. Ist sie eingeschaltet, wird der sichtbare Kartenausschnitt an diesen Server übermittelt, wie beim Laden der Flächen auch; an Dritte geht dabei nichts.</li>',
  );

  if (config.overpassApiUrl === null) {
    items.push(
      '<li><strong>Abgleich öffentlicher/privater Grund:</strong> Erfolgt ausschließlich mit lokal auf diesem Server gespeicherten Geodaten.</li>',
    );
  } else {
    const overpassHost = escapeHtml(hostOf(config.overpassApiUrl) ?? '');
    items.push(
      `<li><strong>Abgleich öffentlicher/privater Grund (Art. 6 Abs. 1 lit. f DSGVO; Interesse: plausible Einordnung von Flächen):</strong> Beim Wechsel zu „2. Details“ fragt dieser Server bei Bedarf OpenStreetMap-Landnutzungsdaten bei <code>${overpassHost}</code> ab. Übermittelt wird nur ein auf ein 0,005°-Raster aufgerundeter Kartenausschnitt, weder deine IP-Adresse noch die gezeichnete Fläche. Ergebnisse werden bis zu 30 Minuten im Arbeitsspeicher zwischengespeichert.</li>`,
    );
  }

  const resolvedBranding = resolveRuntimeBranding(config);
  const logoUrl = resolvedBranding.logoUrl;
  if (logoUrl && !logoUrl.startsWith('/')) {
    const logoHost = hostOf(logoUrl);
    const selfHost = hostOf(config.publicBaseUrl);
    if (logoHost && logoHost !== selfHost) {
      items.push(
        `<li><strong>Instanz-Logo (Art. 6 Abs. 1 lit. f DSGVO):</strong> Dein Endgerät lädt das konfigurierte Logo direkt von <code>${escapeHtml(logoHost)}</code>; dabei wird technisch bedingt deine IP-Adresse an diesen Server übermittelt.</li>`,
      );
    }
  }

  if (config.webhook !== null) {
    items.push(
      '<li><strong>Automatisierte Benachrichtigungen (Webhooks):</strong> Bei Erstellung, Statusänderung oder Löschung von Flächenvorschlägen gehen deren öffentliche Flächendaten (Geometrie, Belagsart, Flächenraum öffentlich/privat, Notiz, Status, Gemeinde, Abstimmungszahlen, Zeitstempel) an ein konfiguriertes externes System - <strong>keine</strong> Pseudonyme, E-Mail-Adressen, Benutzer-IDs oder IP-Adressen.</li>',
    );
  }

  return items.join('\n         ');
}

function buildPrivacyPolicyHtml(
  app: FastifyInstance,
  theme: HostedPageTheme = null,
): string {
  const config = app.config;
  const appName = config.branding.appName;
  const impressumHref = appendHostedThemeParam(
    config.impressumUrl,
    theme,
    config.publicBaseUrl,
  );
  const termsHref = appendHostedThemeParam(
    config.termsUrl,
    theme,
    config.publicBaseUrl,
  );
  const controllerBlock = buildOperatorIdentityHtml(app);
  const contactLine = config.abuseContact
    ? `<p><strong>Kontakt für Datenschutzanfragen:</strong> ${formatContactHtml(config.abuseContact)}</p>`
    : `<p><strong>Kontakt:</strong> Bitte wende dich bei Fragen zum Datenschutz an die oben bzw. im <a href="${escapeHtml(impressumHref)}">Impressum</a> genannte verantwortliche Stelle.</p>`;
  const recentDays = AUTHOR_ACTIVITY.RECENT_DAYS;
  const usesOpenFreeMap = [
    hostOf(config.osmStyleUrl),
    hostOf(config.osmDarkStyleUrl),
  ].includes('tiles.openfreemap.org');
  const enThirdPartyNote = usesOpenFreeMap
    ? 'Third parties (including OpenFreeMap / Hyperknot Software Kft., Hungary, delivered via Cloudflare CDN) are listed in section 4 according to this instance\'s configuration.'
    : 'Third parties are listed in section 4 according to this instance\'s configuration.';
  const enWebhookNote =
    config.webhook !== null
      ? ' Outbound webhooks transmit public polygon data only (no pseudonyms, emails, user IDs, or IPs).'
      : '';
  const introParagraph =
    appName === DEFAULT_APP_NAME
      ? 'OpenUnseal ist ein datensparsames Open-Source-Bürgerbeteiligungsprojekt (PPGIS) zur gemeinschaftlichen Kartierung versiegelter Flächen. Hier steht, welche personenbezogenen Daten diese Instanz verarbeitet, wozu und wie lange. Es gibt keine Cookies, kein Tracking und keine Analyse- oder Werbedienste.'
      : `${escapeHtml(appName)} ist ein datensparsames Bürgerbeteiligungsprojekt (PPGIS) auf Basis der Open-Source-Software OpenUnseal zur gemeinschaftlichen Kartierung versiegelter Flächen. Hier steht, welche personenbezogenen Daten diese Instanz verarbeitet, wozu und wie lange. Es gibt keine Cookies, kein Tracking und keine Analyse- oder Werbedienste.`;
  const backupLine =
    config.backupRetentionDays !== null
      ? `<li><strong>Datensicherungen:</strong> werden nach ${config.backupRetentionDays} Tagen gelöscht. Gelöschte Daten verschwinden daher spätestens nach dieser Frist auch aus den Sicherungen.</li>`
      : `<li><div class="alert-warn"><strong>Hinweis für Betreibende:</strong> Bitte <code>BACKUP_RETENTION_DAYS</code> setzen, damit hier die Aufbewahrungsdauer von Datensicherungen angegeben wird.</div></li>`;

  return `<h1>Datenschutzerklärung (DSGVO)</h1>
       <p>${introParagraph}</p>

       <h2>1. Verantwortliche Stelle (Art. 13 Abs. 1 lit. a DSGVO)</h2>
       ${controllerBlock}
       ${contactLine}

       <h2>2. Was öffentlich sichtbar ist</h2>
       <ul>
         <li>Dein <strong>Pseudonym</strong> bei deinen Flächenvorschlägen, Fotos und Kommentaren. Deine E-Mail-Adresse wird nie öffentlich angezeigt.</li>
         <li>Ob du in den letzten ${recentDays} Tagen aktiv warst („Aktiv in den letzten ${recentDays} Tagen“). Gespeichert wird dafür nur das <em>Datum</em> deiner letzten Aktivität, keine Uhrzeit.</li>
         <li>Der Hinweis „Neue/r Beitragende/r“, bis dein Konto mindestens ${config.newUserMinAccountDays} Tage besteht und mindestens ${config.newUserMinCleanPolygons} positiv bewertete Vorschläge erreicht hat.</li>
         <li>Deine Beiträge: Flächen, Belagsart, Notizen, Fotos, Kommentare sowie die Summe der Abstimmungen.</li>
         <li>Bei neuen Flächen deine Angabe <strong>öffentlicher oder privater Grund</strong>, ob sie vom automatischen GIS-Abgleich abweicht („Nutzer-Override“) und, falls du es ausdrücklich bestätigst, dass eine private Fläche <strong>öffentlich zugänglich</strong> ist oder dass du dort <strong>Hilfe suchst</strong> (endet nach ${HELP_WANTED_DAYS} Tagen von selbst). Bitte bedenke: Wer eine private Fläche einträgt oder ihren Status ändert, kann dadurch mit diesem Grundstück in Verbindung gebracht werden.</li>
         <li>Der <strong>Feed</strong> zeigt Beiträge und Statusänderungen der letzten ${FEED_LIMITS.MAX_AGE_DAYS} Tage in zeitlicher Reihenfolge mit Pseudonym, Fotos und bestbewertetem Kommentar. Du kannst ihn auf den gewählten Kartenausschnitt oder eine Gemeinde eingrenzen. Dafür wird ein auf ein ${String(FEED_LIMITS.BBOX_GRID_DEG).replace('.', ',')}°-Raster aufgerundeter Kartenausschnitt bzw. der Gemeindeschlüssel übermittelt, nie dein Gerätestandort; gespeichert wird beides nicht. Solange der Feed geöffnet ist, fragt die App alle 30 Sekunden mit denselben Angaben nach neuen Einträgen. Die Kartenbilder in den Einträgen zeichnet dein Gerät selbst aus den Kacheln der Basiskarte (siehe Abschnitt 4).</li>
         <li>Angemeldete Konten sehen, ob sie dir zu einer Fläche schreiben können.</li>
         <li>Der öffentliche GeoJSON-Gesamtexport (ODbL 1.0) enthält Geometrien, Belagsart, Flächenraum (öffentlich/privat), Notizen, Status, Gemeinde, Abstimmungszahlen und Zeitstempel, aber <strong>kein Pseudonym</strong> und keine sonstigen Kontodaten.</li>
       </ul>

       <h2>3. Verarbeitete Daten, Zwecke und Rechtsgrundlagen</h2>
       <ul>
         <li><strong>Konto (Art. 6 Abs. 1 lit. b DSGVO, Bereitstellung der Plattform):</strong> Pseudonym, E-Mail-Adresse (für Bestätigungs- und Wiederherstellungslinks sowie einen Hinweis, falls jemand sich erneut mit deiner Adresse registrieren will), Passwort ausschließlich als Argon2id-Hash, Rolle, Zeitpunkte von Registrierung, E-Mail-Bestätigung, Kenntnisnahme dieser Erklärung und Annahme der Nutzungsbedingungen (mit Versionsnummer), deine Einstellung zu Direktnachrichten sowie das Datum deiner letzten Aktivität. Sitzungen werden serverseitig nur als SHA-256-Hash des Tokens gespeichert. Pseudonym und E-Mail-Adresse sind für ein Konto erforderlich; ohne Konto kannst du die Karte nur lesen.</li>
         <li><strong>Beiträge (Art. 6 Abs. 1 lit. b DSGVO):</strong> Flächen samt deiner Angaben zu öffentlichem oder privatem Grund, Notizen, Fotos, Kommentare, Abstimmungen und Meldungen mit Zeitstempeln sowie ihre Anzeige auf Karte und Feed. Angemeldete Konten können eine persönliche Übersicht ihrer aktuellen Beiträge und abgegebenen Flächenbewertungen abrufen, die ausschließlich aus diesen bestehenden Daten berechnet wird; die allgemeine Statistik zeigt nur anonyme Gesamtzahlen. Die Lizenzen ergeben sich aus den <a href="${escapeHtml(termsHref)}">Nutzungsbedingungen</a>.</li>
         <li><strong>GIS-Abgleich (Art. 6 Abs. 1 lit. b / lit. f DSGVO):</strong> Beim Wechsel zu „2. Details“ wird die gezeichnete Fläche an diesen Server übertragen und mit Landnutzungsdaten verglichen; gespeichert wird sie erst beim Absenden, dann zusammen mit Ergebnis, Überdeckungsanteil, Quelle und gegebenenfalls dem Zeitpunkt deiner Berechtigungsbestätigung. Überdeckungsanteil und Quelle sehen nur du und Admin-Konten. Eigentümerdaten aus Kataster oder Grundbuch werden nicht verarbeitet.</li>
         <li><strong>Direktnachrichten (Art. 6 Abs. 1 lit. b DSGVO):</strong> Nur wenn du sie erlaubst (Voreinstellung: aus) oder sie bei einer privaten Fläche freigibst. Gespeichert werden beide Beteiligte, Nachrichtentext, Zeitpunkte, Verweise auf Flächen oder Kommentare, Blockierungen und der Zeitpunkt der neuesten von dir gelesenen Nachricht (nicht der Zeitpunkt des Lesens). Nachrichten sind <strong>nicht Ende-zu-Ende-verschlüsselt</strong>; sie liegen in der Datenbank dieses Servers und dessen Datensicherungen. Die Betreiberstelle hat technisch Zugriff, sieht Nachrichten aber nur ein, wenn eine beteiligte Person sie meldet oder soweit es gesetzlich vorgeschrieben ist. Wenn du Direktnachrichten später abschaltest, können bestehende Unterhaltungen weitergehen, bis du sie blockierst. <strong>Nachrichtenanfragen:</strong> Bis die angeschriebene Person antwortet, kann ihr nur eine Nachricht gesendet werden. Damit niemand massenhaft Konten anschreiben kann, zählt der Server je Konto, wie viele neue Unterhaltungen am jeweiligen Tag begonnen wurden (höchstens ${CHAT_LIMITS.MAX_CONTACT_ATTEMPTS_PER_DAY}; gespeichert werden nur Datum und Anzahl, nicht mit wem; Art. 6 Abs. 1 lit. f DSGVO, Interesse: Schutz vor Belästigung). Ziehst du eine Anfrage zurück, wird sie sofort vollständig gelöscht; du kannst die Person danach erneut anschreiben. Ob du eine Nachricht gelesen hast, erfährt die andere Person nicht.</li>
         <li><strong>Fotos &amp; Metadaten (Art. 6 Abs. 1 lit. b / lit. f DSGVO; Interesse: Plausibilität von Vor-Ort-Fotos):</strong> Das Foto wird mit seinen Metadaten hochgeladen. Der Server prüft im Arbeitsspeicher, ob die darin enthaltene GPS-Position in der kartierten Fläche (inkl. ${PHOTO_LIMITS.GPS_VERIFY_DISTANCE_M} m Puffer) liegt, speichert nur dieses Ergebnis (<em>GPS verified</em>, am Foto öffentlich sichtbar) und entfernt <strong>alle</strong> EXIF-/XMP-/IPTC-Metadaten (Gerät, Koordinaten, Aufnahmezeit), bevor das Bild als WebP gespeichert wird. Bitte lade keine Aufnahmen hoch, auf denen Personen, Gesichter oder Kfz-Kennzeichen erkennbar sind.</li>
         <li><strong>Missbrauchsschutz (Art. 6 Abs. 1 lit. f DSGVO; Interesse: Schutz vor Spam, Mehrfachkonten und Identitätsmissbrauch):</strong> Anfragebegrenzungen anhand der IP-Adresse ausschließlich im Arbeitsspeicher (IPv6 auf /64 gekürzt, Zeitfenster höchstens 1 Stunde); Zähler fehlgeschlagener Anmeldeversuche je Konto (Sperrung der Anmeldung nach ${AUTH_LIMITS.MAX_FAILED_LOGIN_ATTEMPTS} Fehlversuchen bis zur erneuten E-Mail-Bestätigung); eine Rechenaufgabe (Proof-of-Work, ohne Drittanbieter) bei der Registrierung; ein mit einem geheimen Serverschlüssel gebildeter Hash (HMAC-SHA-256) deiner normalisierten E-Mail-Adresse, um Doppelkonten über Alias-Adressen zu verhindern.</li>
         <li><strong>Server-Protokolle (Art. 6 Abs. 1 lit. f DSGVO; Interesse: sicherer Betrieb, Fehleranalyse):</strong> Anfrage-ID, Methode, Pfad ohne Parameter, Statuscode, Antwortzeit und Fehlermeldungen; Kennungen von Unterhaltungen werden dabei unkenntlich gemacht. <strong>Keine</strong> IP-Adressen, Browserkennungen (User-Agent) oder Referrer. Der vorgeschaltete Webserver schreibt keine Zugriffsprotokolle.</li>
         <li><strong>Fehlermeldungen (Art. 6 Abs. 1 lit. b / lit. f DSGVO):</strong> Beschreibung, freiwillig angegebene Kontakt-E-Mail (ausschließlich für Rückfragen), Plattform, Seiten-URL, Zeitpunkt und, falls angemeldet, Pseudonym und Konto-ID gehen per E-Mail an die Betreiberstelle, um gemeldete Fehler zu beheben.</li>
         <li><strong>Meldungen mutmaßlich rechtswidriger Inhalte &amp; Moderationshinweise (Art. 6 Abs. 1 lit. c DSGVO i.V.m. Art. 16, 17 DSA sowie Art. 6 Abs. 1 lit. f DSGVO):</strong> Meldungen über das In-App-Meldeformular (<code>POST /api/v1/content-reports</code>) oder per E-Mail (Ziel-ID, Meldegrund, Begründung, Seiten-URL, optional Name und E-Mail-Adresse; bei Direktnachrichten zusätzlich Nachrichtentext, Pseudonym der absendenden Person, Zeitpunkt sowie Pseudonym, Konto-ID und bestätigte E-Mail-Adresse der meldenden Person) werden zur gesetzlich vorgeschriebenen Prüfung, Eingangsbestätigung (Art. 16 Abs. 4 DSA) und Entscheidung verarbeitet. Bei Moderationsmaßnahmen durch Admin-Konten erhalten betroffene Konten die Gründe per E-Mail (Art. 17 DSA).</li>
         <li><strong>Betroffene Dritte (Art. 6 Abs. 1 lit. f DSGVO; Interesse: gemeinschaftliche Kartierung versiegelter Flächen):</strong> Vorschläge können Grundstücke anderer betreffen. Verarbeitet werden dazu nur Lage, Belagsart und die Angaben der Beitragenden, keine Eigentümerdaten. Wer betroffen ist, kann über die Meldefunktion oder die Kontaktstelle widersprechen und die Löschung verlangen.</li>
         <li><strong>Anonyme Tageszähler (ohne Personenbezug):</strong> Für Betriebsstabilität und wissenschaftliche Auswertung zählt der Server täglich rein aggregierte Ereigniszahlen (z. B. Anzahl erstellter oder abgelehnter Flächenvorschläge nach Grund, ohne Benutzer-IDs, ohne IP-Adressen und ohne Koordinaten).</li>
         <li><strong>Standort &amp; Fotos:</strong> Den Standort fragt die App nur nach deiner Freigabe im Browser ab; Fotos wählst du selbst über die Kamera- oder Dateiauswahl deines Geräts aus. Deine genauen GNSS-Koordinaten verbleiben auf dem Gerät und werden nicht als Standortverlauf gespeichert; beim Zentrieren der Karte ruft die App jedoch technisch bedingt Kartenausschnitte (Bounding-Box) und Karten-/Luftbildkacheln rund um diesen Bereich ab (ohne Protokollierung). Zu Fotos siehe oben.</li>
         <li><strong>Speicher auf deinem Gerät (§ 25 Abs. 2 Nr. 2 TDDDG):</strong> Sitzungs-Token, gewählte Sprache und Darstellungsmodus (Hell/Dunkel) werden im <code>localStorage</code> deines Browsers gespeichert; der zuletzt angezeigte Kartenausschnitt nur im <code>sessionStorage</code>, der beim Schließen des Tabs gelöscht wird. Diese Angaben bleiben auf deinem Gerät.</li>
       </ul>

       <h2>4. Empfänger &amp; Drittanbieter (Art. 13 Abs. 1 lit. e, f DSGVO)</h2>
       <ul>
         ${buildThirdPartyItemsHtml(app)}
       </ul>

       <h2>5. Speicherdauer</h2>
       <ul>
         <li><strong>Konto:</strong> bis du es löschst. Unbestätigte Registrierungen werden nach 48 Stunden gelöscht.</li>
         <li><strong>Beiträge:</strong> bis du sie oder dein Konto (mit der Option „alle Beiträge mitlöschen“) löschst. Vorschläge, die nach ${config.staleUnratedPruneDays} Tagen weder Stimmen noch Kommentare oder Fotos aufweisen, werden automatisch entfernt.</li>
         <li><strong>Direktnachrichten:</strong> bis du sie löschst, höchstens ${config.chatRetentionDays} Tage; von dir gesendete Nachrichten bei Kontolöschung sofort. Leere Unterhaltungen werden nach ${CHAT_LIMITS.EMPTY_THREAD_RETENTION_DAYS} Tagen gelöscht, unbeantwortete Nachrichtenanfragen nach ${CHAT_LIMITS.REQUEST_RETENTION_DAYS} Tagen; der Tageszähler für neue Unterhaltungen am Folgetag. Eine Blockierung bleibt gespeichert, solange beide Konten bestehen und sie nicht aufgehoben wird.</li>
         <li><strong>Sitzungen:</strong> höchstens ${config.sessionTtlDays} Tage; abgelaufene Sitzungen werden stündlich gelöscht.</li>
         <li><strong>E-Mail-Links:</strong> gültig ${AUTH_LIMITS.EMAIL_VERIFY_TTL_HOURS} Stunden (Bestätigung) bzw. ${AUTH_LIMITS.PASSWORD_RESET_TTL_MINUTES} Minuten (Passwort); die Datensätze werden 7 Tage nach Nutzung oder Ablauf gelöscht.</li>
         <li><strong>Pseudonym-Reservierung nach Kontolöschung:</strong> ${config.pseudonymReservationDays} Tage, gespeichert nur als HMAC-Wert, damit sich niemand als du ausgeben kann. Bei einer Sperrung wegen Missbrauchs werden HMAC-Werte von Pseudonym und E-Mail-Adresse gespeichert, bis die Sperre aufgehoben wird.</li>
         <li><strong>Server-Protokolle:</strong> werden fortlaufend überschrieben (höchstens 3 × 10 MB je Dienst).</li>
         <li><strong>Fehlermeldungen &amp; DSA-Inhaltsmeldungen:</strong> werden nach Abschluss der Bearbeitung aus dem Postfach der Betreiberstelle gelöscht, sofern keine gesetzliche Aufbewahrungspflicht oder Rechtsverteidigung entgegensteht.</li>
         ${backupLine}
       </ul>

       <h2>6. Deine Rechte</h2>
       <ul>
         <li><strong>Auskunft &amp; Datenübertragbarkeit (Art. 15, 20 DSGVO):</strong> In der App unter <em>Konto → Meine Daten herunterladen</em> erhältst du alle zu deinem Konto gespeicherten Daten als JSON-Datei. Alternativ über die Kontaktstelle.</li>
         <li><strong>Berichtigung (Art. 16 DSGVO):</strong> Änderungen von E-Mail-Adresse oder Pseudonym über die Kontaktstelle.</li>
         <li><strong>Löschung (Art. 17 DSGVO):</strong> Unter <em>Konto → Konto löschen</em> werden E-Mail-Adresse, Zugangsdaten, Sitzungen, Stimmen und von dir gesendete Direktnachrichten sofort gelöscht. Deine öffentlichen Beiträge bleiben dann anonym als „gelöscht“ sichtbar, außer du wählst, sie mitzulöschen. Einzelne Fotos, Kommentare, Vorschläge und gesendete Direktnachrichten kannst du jederzeit selbst von der Plattform löschen (bereits zuvor von Dritten unter offenen Datenlizenzen heruntergeladene Kopien bleiben gemäß den jeweiligen Lizenzbedingungen bestehen).</li>
         <li><strong>Einschränkung (Art. 18 DSGVO)</strong> über die Kontaktstelle.</li>
         <li><strong>Beschwerde</strong> bei einer Datenschutz-Aufsichtsbehörde (Art. 77 DSGVO).</li>
       </ul>
       <p>Es finden keine automatisierten Einzelentscheidungen im Sinne von Art. 22 DSGVO statt.</p>

       <h2>7. Widerspruchsrecht (Art. 21 DSGVO)</h2>
       <p><strong>Soweit Daten auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO verarbeitet werden (Abschnitte 3 und 4), kannst du dem jederzeit aus Gründen, die sich aus deiner besonderen Situation ergeben, über die Kontaktstelle widersprechen.</strong></p>

       <p class="en-sub"><strong>English summary:</strong> Public: your pseudonym, your contributions, whether you were active in the last ${recentDays} days (only the date of your last activity is stored) and a "new contributor" hint; the ODbL 1.0 GeoJSON export contains no pseudonym. Your email is used only for account links and DSA Art. 17 moderation notices and is never shown publicly. New areas also show whether you marked them as public or private ground and, if you confirm it, that a private area is open to the public; entering a private area may link you to that parcel. A feed lists the last ${FEED_LIMITS.MAX_AGE_DAYS} days nationwide. Direct messages (Art. 6(1)(b)) are off by default, not end-to-end encrypted, kept for at most ${config.chatRetentionDays} days, and the messages you sent are deleted with your account; the operator only looks at a message when a participant reports it. Drawn areas are compared with land-use data; ${config.overpassApiUrl === null ? 'only locally stored data is used' : 'only a coarse grid-aligned map section is sent to the land-use service in section 4'}. No cadastral owner data is processed. Accounts and contributions are processed under Art. 6(1)(b) GDPR (signed-in accounts can view a personal summary derived solely from their existing contributions and polygon ratings; public statistics and daily aggregate counters contain zero personal data); abuse prevention and logs under Art. 6(1)(f); DSA Art. 16 illegal-content notices under Art. 6(1)(c) GDPR. Server logs contain no IP addresses, user agents or referrers; rate limiting keeps IPs in memory only. Photo metadata is checked in memory and fully stripped before storage. Device GNSS stays on-device (centering fetches map bbox/tiles without logging); the last viewport is kept in sessionStorage only. ${enThirdPartyNote}${enWebhookNote} Retention: unconfirmed accounts 48 h, sessions up to ${config.sessionTtlDays} days, email links 7 days after use, pseudonym reservation after deletion ${config.pseudonymReservationDays} days (keyed hash only). Rights: download your data in the app (Art. 15/20), delete your account with or without your contributions (open-data licenses on copies legitimately downloaded prior to deletion remain irrevocable under their terms), and contact the operator for corrections or restriction; you may lodge a complaint with a supervisory authority. <strong>You may object at any time to processing based on Art. 6(1)(f) GDPR (Art. 21 GDPR).</strong></p>
       ${buildLegalNavHtml(app, theme)}`;
}

export function registerAuthPageRoutes(app: FastifyInstance): void {
  const pageLimit = app.rateLimitOverrides.recover ?? {
    max: 20,
    timeWindow: '15 minutes',
  };
  const safeAppName = escapeHtml(app.config.branding.appName);

  app.get('/auth/impressum', async (request, reply) => {
    const theme = parseRequestedTheme(request.query);
    const operatorHtml = buildOperatorIdentityHtml(app);
    const portalHtml = app.config.branding.portalUrl
      ? `<p><strong>${escapeHtml(app.config.branding.portalLabel ?? 'Kommunales Portal')}:</strong> <a href="${escapeHtml(app.config.branding.portalUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(app.config.branding.portalUrl)}</a></p>`
      : '';
    const dsaContactRaw = app.config.abuseContact ?? app.config.operatorEmail;
    const dsaContactHtml = dsaContactRaw
      ? `<p><strong>Zentrale Kontaktstelle gemäß Art. 11 und Art. 12 Digital Services Act (DSA) für Behörden der Mitgliedstaaten, die EU-Kommission, das Gremium für digitale Dienste sowie Nutzende (inkl. Melde- &amp; Moderationskontakt nach Art. 16 DSA):</strong> ${formatContactHtml(dsaContactRaw)}<br /><strong>Kommunikationssprachen:</strong> Deutsch, Englisch.</p>`
      : `<p><strong>Zentrale Kontaktstelle gemäß Art. 11, 12 und 16 DSA:</strong> Über die oben angegebene Betreiberadresse (<strong>Kommunikationssprachen:</strong> Deutsch, Englisch).</p>`;
    return sendHostedHtml(
      app,
      reply,
      200,
      'Impressum',
      `<h1>Impressum</h1>
       <p>Angaben gemäß § 5 Digitale-Dienste-Gesetz (DDG) sowie Art. 11 und 12 Digital Services Act (DSA) für diese ${safeAppName}-Instanz:</p>
       <h2>Verantwortliche Stelle / Betreibende</h2>
       ${operatorHtml}
       ${portalHtml}
       <h2>Kontaktstelle nach dem Digital Services Act (DSA)</h2>
       ${dsaContactHtml}
       <p>Mutmaßlich rechtswidrige Inhalte (Flächenvorschläge, Fotos oder Kommentare) können auch ohne Benutzerkonto direkt über den Melde-Button in der App (<code>POST /api/v1/content-reports</code>) oder per E-Mail an die oben genannte Kontaktstelle gemeldet werden (Art. 16 DSA).</p>
       <h2>Haftungs- &amp; Beteiligungshinweis</h2>
       <p>${escapeHtml(app.config.disclaimerText)}</p>
       <p>Erhaltene Direktnachrichten kannst du angemeldet in der Unterhaltung melden, weil nur Beteiligte eine private Nachricht offenlegen können; alternativ ohne Anmeldung per E-Mail an die Kontaktstelle.</p>
       <p>Nutzende sind für die von ihnen eingestellten Flächenvorschläge, Texte, Kommentare und Fotos selbst verantwortlich. Hinweise auf rechtswidrige Inhalte werden über die oben genannte Kontaktstelle bzw. die Meldefunktion geprüft; rechtswidrige Inhalte werden unverzüglich entfernt.</p>
       <h2>Quellcode &amp; Lizenzen</h2>
       <p>Diese Instanz nutzt die Open-Source-Software <strong>OpenUnseal</strong> (Server: <code>AGPL-3.0-or-later</code>, Client &amp; Shared: <code>MPL-2.0</code>). Der vollständige Quellcode ist unter <a href="${escapeHtml(app.config.sourceCodeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(app.config.sourceCodeUrl)}</a> verfügbar.</p>
       <p class="en-sub"><strong>English summary:</strong> Legal notice / operator identification pursuant to German law (§ 5 DDG) and single point of contact for authorities and users pursuant to Arts. 11, 12 and 16 EU Digital Services Act (accepted languages: German, English). This instance is powered by OpenUnseal open-source software (API: AGPL-3.0-or-later, Client: MPL-2.0); source code is available at <a href="${escapeHtml(app.config.sourceCodeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(app.config.sourceCodeUrl)}</a>.</p>
       ${buildLegalNavHtml(app, theme)}`,
      { wide: true, theme },
    );
  });

  app.get('/auth/terms', async (request, reply) => {
    const theme = parseRequestedTheme(request.query);
    const config = app.config;
    const impressumHref = appendHostedThemeParam(
      config.impressumUrl,
      theme,
      config.publicBaseUrl,
    );
    const abuseNote = config.abuseContact
      ? `Missbrauchs- und Rechtsverstoßmeldungen (Art. 16 DSA) können jederzeit - auch ohne Benutzerkonto - über das In-App-Meldeformular (<code>POST /api/v1/content-reports</code>) an Flächen, Fotos und Kommentaren oder per E-Mail an ${formatContactHtml(config.abuseContact)} eingereicht werden.`
      : `Missbrauchs- und Rechtsverstoßmeldungen (Art. 16 DSA) können jederzeit - auch ohne Benutzerkonto - über das In-App-Meldeformular an Flächen, Fotos und Kommentaren oder an die im <a href="${escapeHtml(impressumHref)}">Impressum</a> genannte Kontaktstelle gerichtet werden.`;
    return sendHostedHtml(
      app,
      reply,
      200,
      'Nutzungsbedingungen & Datenlizenzen',
      `<h1>Nutzungsbedingungen &amp; Offene Datenlizenzen</h1>
       <p>Mit der Registrierung eines Kontos und dem Einstellen von Beiträgen auf dieser ${safeAppName}-Instanz akzeptierst du folgende Regeln und Lizenzbedingungen:</p>
       <ul>
         <li><strong>Unverbindliche Bürgerbeteiligung:</strong> ${escapeHtml(config.disclaimerText)} Ein Eintrag begründet keinen Rechtsanspruch auf Entsiegelung und greift nicht in bestehende Eigentumsrechte ein.</li>
         <li><strong>Mindestalter:</strong> Die Registrierung und das Einräumen unwiderruflicher offener Datenlizenzen (<code>CC0 1.0</code> / <code>CC BY 4.0</code>) erfordert ein Mindestalter von 16 Jahren; unter 18 Jahren zusätzlich die Zustimmung der gesetzlichen Vertretung.</li>
         <li><strong>Lizenz für Flächenvorschläge, Notizen &amp; GeoJSON-Export (CC0 1.0 / ODbL 1.0):</strong> Soweit an deinen selbst eingezeichneten Polygon-Geometrien, Belagsangaben, der Angabe „öffentlicher/privater Grund“ und Beschreibungstexten eigene Urheber- oder Datenbankrechte entstehen, verzichtest du - soweit gesetzlich zulässig - gemäß <a href="https://creativecommons.org/publicdomain/zero/1.0/deed.de" target="_blank" rel="noopener noreferrer"><strong>Creative Commons Zero 1.0 (CC0 1.0 Universal)</strong></a> auf diese Rechte bzw. räumst hilfsweise (§ 29 UrhG) jedermann ein unbeschränktes, unentgeltliches und unwiderrufliches einfaches Nutzungsrecht gemäß Ziffer 3 (<em>Public License Fallback</em>) der CC0 1.0 ein. Der öffentliche Datensatz (<code>/api/v1/polygons/export.geojson</code>) enthält ausschließlich die Flächenvorschläge und ihre Bewertungen und steht unter der <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener noreferrer"><strong>Open Data Commons Open Database License 1.0 (ODbL 1.0)</strong></a>. Basiskarte und Luftbilder dienen nur der Darstellung und sind nicht Teil des Exports.</li>
         <li><strong>Lizenz für Vor-Ort-Fotos &amp; Kommentare (CC BY 4.0):</strong> Hochgeladene Fotos und Diskussionskommentare lizenzierst du unter <a href="https://creativecommons.org/licenses/by/4.0/deed.de" target="_blank" rel="noopener noreferrer"><strong>Creative Commons Namensnennung 4.0 International (CC BY 4.0)</strong></a> mit Namensnennung deines öffentlichen Pseudonyms (bzw. anonymisiert als <code>deleted</code> nach Kontolöschung, sofern du deine Beiträge dabei nicht mitlöschst). Hochgeladene Fotos werden serverseitig bearbeitet (vollständige Entfernung von EXIF-/XMP-/IPTC-Metadaten, Konvertierung nach WebP sowie Skalierung/Vorschaubild). Du kannst deine Beiträge jederzeit von der Plattform löschen; für Kopien, die Dritte vor der Löschung rechtmäßig bezogen haben, gelten die offenen Lizenzen (<code>CC0 1.0</code> / <code>ODbL 1.0</code> / <code>CC BY 4.0</code>) gemäß ihren Lizenzbedingungen unwiderruflich fort.</li>
         <li><strong>Private Flächen:</strong> Angaben zu privatem Grund begründen keine Eigentumsfeststellung und kein Betretungsrecht. „Öffentlich zugänglich“, „Kontakt per Chat“ und „Hilfe gesucht“ darfst du nur setzen, wenn du Eigentümer/in bist oder von der berechtigten Person dazu ermächtigt wurdest; das bestätigst du ausdrücklich. Dasselbe gilt, bevor du für eine private Fläche „in Arbeit“ oder „entsiegelt“ meldest. Diese Angaben sind nicht Teil des offenen Datensatzes und jederzeit widerrufbar; „Hilfe gesucht“ endet nach ${HELP_WANTED_DAYS} Tagen von selbst und begründet weder ein Betretungsrecht noch einen Auftrag.</li>
         <li><strong>Direktnachrichten:</strong> Private Nachrichten stehen unter <strong>keiner</strong> offenen Lizenz und dürfen nicht ohne Zustimmung veröffentlicht werden; Meldungen an die Kontaktstelle bleiben davon unberührt. Du kannst Unterhaltungen blockieren und eigene Nachrichten löschen. Die Betreiberstelle darf Nachrichten löschen, wenn eine beteiligte Person sie meldet und die Prüfung einen Rechtsverstoß oder eine Verletzung dieser Bedingungen ergibt, sowie nach Ablauf der in der Datenschutzerklärung genannten Speicherdauer oder bei Kontolöschung. Werbung und Belästigung sind untersagt. Bis die angeschriebene Person antwortet, kannst du ihr nur eine Nachricht senden; pro Tag kannst du höchstens ${CHAT_LIMITS.MAX_CONTACT_ATTEMPTS_PER_DAY} neue Unterhaltungen beginnen.</li>
         <li><strong>Zulässige Inhalte &amp; Fotorechte (§ 59 UrhG / § 22 KUG / DSGVO):</strong> Du darfst nur eigene Fotos hochladen, die von öffentlich zugänglichen Wegen oder Plätzen aus aufgenommen wurden (Panoramafreiheit) oder für die eine ausdrückliche Erlaubnis der Berechtigten vorliegt. Lade <strong>keine</strong> Aufnahmen hoch, auf denen erkennbare Personen, Gesichter, Kfz-Kennzeichen oder nicht öffentlich einsehbare Privatbereiche (z. B. über Zäune hinweg oder per Drohne) abgebildet sind. Ausgenommen ist das <strong>eigene Grundstück</strong> bzw. ein Grundstück, für das die berechtigte Person der Aufnahme und der Veröffentlichung unter <code>CC BY 4.0</code> zugestimmt hat; das Verbot erkennbarer Personen und Kennzeichen gilt auch dann.</li>
         <li><strong>Inhaltsmoderation, automatisierte Schutzmaßnahmen &amp; Meldeverfahren (Art. 14, 16, 17 DSA):</strong> Rechtswidrige, beleidigende, personenbezogene, urheberrechtsverletzende, irreführende oder Spam-Beiträge können entfernt und Konten bei schwerwiegenden oder wiederholten Verstößen gesperrt werden. Zur Qualitätssicherung und Missbrauchsabwehr setzt die Plattform folgende dokumentierte automatische Verfahren ein: (1) automatische Geometrie-Bereinigung (<code>ST_Difference</code>-Zuschnitt an bestehenden Vorschlägen) sowie Ablehnung von Flächen auf ausgeschlossenen Landnutzungskategorien (z. B. Gewässer, Gleise, Gebäude, Grünflächen, soweit konfiguriert); (2) automatisches Weichzeichnen von Fotos ab einer Community-Glaubwürdigkeitsbewertung von <code>&lt;= ${PHOTO_LIMITS.FAKE_BLUR_SCORE_THRESHOLD}</code>; (3) automatische Entfernung unbewerteter Vorschläge ohne Stimmen, Fotos oder Kommentare nach ${config.staleUnratedPruneDays} Tagen; (4) automatischer GIS-Abgleich öffentlicher/privater Flächen: Er schlägt eine Einordnung vor und kennzeichnet Abweichungen („Nutzer-Override“), die bis zur Prüfung durch Admin-Konten bewertbar und als prüfbedürftig sichtbar bleiben; (5) Zurücksetzen des Status privater Flächen auf „vorgeschlagen“, wenn kein glaubwürdiges Foto mehr vorhanden ist; (6) chronologische Sortierung des Feeds ohne Personalisierung; (7) Beschränkung von Direktnachrichten auf eine Nachricht bis zur Antwort und auf ${CHAT_LIMITS.MAX_CONTACT_ATTEMPTS_PER_DAY} neue Unterhaltungen pro Tag; (8) automatisches Ende von „Hilfe gesucht“ nach ${HELP_WANTED_DAYS} Tagen oder wenn die Fläche als entsiegelt gemeldet wird; (9) Blockierung bekannter Wegwerf-E-Mail-Domains, Proof-of-Work-Registrierungsprüfung sowie vorübergehende Anmeldesperre nach ${AUTH_LIMITS.MAX_FAILED_LOGIN_ATTEMPTS} Fehlversuchen bis zur erneuten E-Mail-Bestätigung. Bei manuellen Moderationsmaßnahmen (Löschung von Beiträgen, Schwärzung von Notizen oder Kontosperrung) erhalten betroffene Konten eine schriftliche Begründung per E-Mail (Art. 17 DSA). ${abuseNote} Direktnachrichten können nur von angemeldeten Beteiligten in der App gemeldet werden, alternativ ohne Anmeldung per E-Mail.</li>
         <li><strong>Änderungen:</strong> Bei wesentlichen Änderungen dieser Bedingungen fragen wir deine Zustimmung erneut ab. Ohne Zustimmung kannst du keine Flächen, Fotos, Kommentare oder Nachrichten einreichen und Flächen nicht ändern; Lesen, Abstimmen, Datenexport und Löschung bleiben möglich.</li>
       </ul>
       <p class="en-sub"><strong>English summary:</strong> Contributions are non-binding civic suggestions. Registration and irrevocable open-data licensing require users to be at least 16 years old (with guardian consent under 18). By registering and contributing, you waive your own copyright and database rights in submitted polygon geometries, surface classifications, public/private ground statements, and proposal notes under <strong>CC0 1.0 Universal</strong> (or, as a Section 3 Public License Fallback where statutory waiver is unavailable, e.g. under § 29 German UrhG, grant an unrestricted, irrevocable license), while the public GeoJSON dataset (<code>/api/v1/polygons/export.geojson</code>), which contains only these proposals and their ratings, is licensed under <strong>ODbL 1.0</strong>. Basemaps and aerial imagery are used for display only and are not part of the export. Uploaded site photos and comments are licensed under <strong>CC BY 4.0</strong> attributed to your pseudonym (photos are stripped of EXIF/XMP/IPTC metadata and re-encoded/resized to WebP). You may photograph your own premises or premises whose entitled person agreed. Statements about private ground require entitlement, create no right of access and can be withdrawn. Direct messages carry no open licence; the operator may delete them after a participant's justified report, on expiry or with the account. Material changes to these terms require renewed acceptance. Automated safeguards (Art. 14 DSA): public/private GIS comparison with review of deviations, status reset of private areas without a credible photo, chronological unpersonalised feed, auto-clipping against overlaps, land-cover checks, photo blurring at credibility score &lt;= ${PHOTO_LIMITS.FAKE_BLUR_SCORE_THRESHOLD}, pruning of unrated proposals after ${config.staleUnratedPruneDays} days, disposable-email blocking, and temporary login lockout after ${AUTH_LIMITS.MAX_FAILED_LOGIN_ATTEMPTS} failed attempts. Suspected illegal content can be reported without an account via the in-app report action (Art. 16 DSA); manual moderation removals or account bans trigger an emailed statement of reasons (Art. 17 DSA).</p>
       ${buildLegalNavHtml(app, theme)}`,
      { wide: true, theme },
    );
  });

  app.get('/auth/third-party-notices', async (_request, reply) => {
    const notices = await readThirdPartyNoticesText();
    if (notices === null) {
      return reply
        .status(200)
        .header('Content-Type', 'text/plain; charset=utf-8')
        .header('X-Content-Type-Options', 'nosniff')
        .send(
          `Third-party license notices are maintained in THIRD_PARTY_NOTICES.txt in the source repository: ${app.config.sourceCodeUrl}\n`,
        );
    }
    return reply
      .status(200)
      .header('Content-Type', 'text/plain; charset=utf-8')
      .header('Cache-Control', 'public, max-age=3600')
      .header('X-Content-Type-Options', 'nosniff')
      .send(notices);
  });

  app.get('/auth/licenses', async (request, reply) => {
    const theme = parseRequestedTheme(request.query);
    const config = app.config;
    const termsHref = appendHostedThemeParam(
      config.termsUrl,
      theme,
      config.publicBaseUrl,
    );
    const currentYear = new Date().getUTCFullYear();
    const noticesHref = `${config.publicBaseUrl}/auth/third-party-notices`;
    const muniStatus = await getMunicipalitiesStatus(app.pool).catch(() => ({
      seeded: false,
      dataYear: null,
    }));
    const vg250Active = config.autoSeedVg250 || muniStatus.seeded;
    const vg250Year = muniStatus.dataYear ?? currentYear;
    const vg250LicenseHtml = vg250Active
      ? `<li><strong>Verwaltungsgrenzen (VG250):</strong> © <a href="https://www.bkg.bund.de" target="_blank" rel="noopener noreferrer">BKG</a> (${vg250Year}), <a href="https://www.govdata.de/dl-de/by-2-0" target="_blank" rel="noopener noreferrer">Datenlizenz Deutschland - Namensnennung 2.0 (dl-de/by-2-0)</a>, <a href="${escapeHtml(BKG_VG250_DATENQUELLEN_URL)}" target="_blank" rel="noopener noreferrer">Datenquellen</a> (Daten verändert).</li>`
      : '<li><strong>Verwaltungsgrenzen (VG250):</strong> Auf dieser Instanz nicht geladen.</li>';
    const vg250EnglishSummary = vg250Active
      ? ` German municipality boundaries © BKG (${vg250Year}) dl-de/by-2-0, Datenquellen: ${BKG_VG250_DATENQUELLEN_URL} (modified).`
      : '';
    // Reference datasets stay credited even after a newer one replaced them.
    const referenceRes = await app.pool
      .query<{
        license: string;
        attribution_text: string;
        source_url: string | null;
        waiver_confirmed: boolean;
      }>(
        `SELECT DISTINCT license, attribution_text, source_url, waiver_confirmed
         FROM import_attributions
         WHERE purpose IN ('space_zones', 'land_cover')
         ORDER BY attribution_text, license`,
      )
      .catch(() => ({ rows: [] }));
    const referenceItems = referenceRes.rows.map((row) => {
      const credit = escapeHtml(row.attribution_text);
      const linked = row.source_url?.startsWith('http')
        ? `<a href="${escapeHtml(row.source_url)}" target="_blank" rel="noopener noreferrer">${credit}</a>`
        : credit;
      return `${linked} (${escapeHtml(row.license)}${row.waiver_confirmed ? ', ODbL-Freigabe bestätigt' : ''}; Daten verändert)`;
    });
    if (config.overpassApiUrl !== null) {
      referenceItems.unshift(
        'OpenStreetMap über Overpass API, Daten © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap-Mitwirkende (ODbL)</a>',
      );
    }
    const spaceLicenseHtml =
      `<li><strong>Abgleich öffentlicher/privater Grund &amp; Landbedeckung:</strong> ${referenceItems.length > 0 ? referenceItems.join('; ') : 'Auf dieser Instanz keine Referenzdaten geladen.'} Die Kartenebene „Flächennutzung“ (<code>/api/v1/space-zones</code>) und die beim Abgleich gezeigten Teilflächen sind aus diesen Daten abgeleitet und stehen unter <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener noreferrer">ODbL 1.0</a>, mit denselben Quellenangaben.</li>\n         <li><strong>Deutschland-Umriss:</strong> <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer">Natural Earth</a> 5.1.1 (Public Domain; gepuffert und vereinfacht).</li>`;
    const styleHosts = Array.from(
      new Set(
        [hostOf(config.osmStyleUrl), hostOf(config.osmDarkStyleUrl)].filter(
          (h): h is string => h !== null,
        ),
      ),
    );
    const usesOpenFreeMap = styleHosts.includes('tiles.openfreemap.org');
    const basemapLicenseHtml = usesOpenFreeMap
      ? `<li><strong>Straßenkarte (Vektorkacheln):</strong> <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> (MIT), Kachelschema &amp; Stile © <a href="https://openmaptiles.org/" target="_blank" rel="noopener noreferrer">OpenMapTiles</a> / © <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a> (modified im Dunkelmodus) / OSM Liberty (<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a> / BSD-3-Clause / MIT), Kartendaten © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap-Mitwirkende (ODbL)</a>, Übersichts-Schummerung <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer">Natural Earth</a> (Public Domain), Kartenschriften Noto Sans (<a href="https://openfontlicense.org/" target="_blank" rel="noopener noreferrer">SIL OFL 1.1</a>).</li>`
      : styleHosts.length > 0
        ? `<li><strong>Straßenkarte (konfigurierter Anbieter):</strong> Kartenstil und Kacheln von ${styleHosts.map((h) => `<code>${escapeHtml(h)}</code>`).join(' bzw. ')} (Lizenzangaben gemäß Kartenstil-Metadaten; bei OSM-basierten Stilen © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap-Mitwirkende (ODbL)</a>).</li>`
        : '<li><strong>Straßenkarte:</strong> Selbst gehosteter Kartenstil dieses Servers.</li>';

    const ortho = config.orthophoto;
    let orthoLicenseHtml: string;
    let orthoEnglishSummary: string;
    if (ortho === null) {
      orthoLicenseHtml =
        '<li><strong>Luftbilder:</strong> Auf dieser Instanz deaktiviert.</li>';
      orthoEnglishSummary = 'Aerial orthophotos are disabled on this instance.';
    } else if (ortho.urlTemplate.includes('/api/v1/tiles/dop20/')) {
      const stateItemsHtml = GERMAN_STATE_DOP20_PROVIDERS.map((provider) => {
        const vintageNote = provider.vintageNote
          ? ` [${escapeHtml(provider.vintageNote)}]`
          : '';
        return `<li><strong>${escapeHtml(provider.name)}:</strong> ${escapeHtml(formatStateDop20FullAttribution(provider, currentYear))} - <a href="${escapeHtml(provider.licenseUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(provider.licenseId)}</a>${vintageNote}</li>`;
      }).join('\n             ');
      orthoLicenseHtml = `<li><strong>Luftbilder (DOP20 / DOP10, Daten verändert - Kachel-Reprojektion/Komposition an Landesgrenzen):</strong> Amtliche Open-Data-WMS-Dienste der Vermessungsverwaltungen der deutschen Bundesländer unter <a href="https://www.govdata.de/dl-de/by-2-0" target="_blank" rel="noopener noreferrer">dl-de/by-2-0</a>, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a> sowie <a href="https://www.govdata.de/dl-de/zero-2-0" target="_blank" rel="noopener noreferrer">dl-de/zero-2-0</a>:
           <details style="margin-top:6px;">
             <summary style="cursor:pointer;font-weight:600;">Einzelne Quellenvermerke &amp; Lizenzen aller 16 Bundesländer anzeigen</summary>
             <ul style="margin-top:8px;">
               ${stateItemsHtml}
             </ul>
           </details>
         </li>`;
      orthoEnglishSummary =
        'German state aerial orthophotos (DOP20/DOP10, modified via cross-border tile compositing) are provided by the German State Survey Offices under dl-de/by-2-0, CC BY 4.0, and dl-de/zero-2-0 (full per-state list above).';
    } else {
      const orthoHost = hostOf(ortho.urlTemplate);
      const attrText = ortho.attribution.trim()
        ? escapeHtml(ortho.attribution.trim())
        : orthoHost
          ? `<code>${escapeHtml(orthoHost)}</code>`
          : 'benutzerdefinierte Quelle';
      orthoLicenseHtml = `<li><strong>Luftbilder (konfigurierter Anbieter):</strong> ${attrText}${orthoHost ? ` (<code>${escapeHtml(orthoHost)}</code>)` : ''}.</li>`;
      orthoEnglishSummary = ortho.attribution.trim()
        ? `Aerial orthophotos: ${escapeHtml(ortho.attribution.trim())}.`
        : 'Aerial orthophotos are served from a custom configured source.';
    }

    return sendHostedHtml(
      app,
      reply,
      200,
      'Open-Source-Lizenzen & Geodaten-Quellen',
      `<h1>Open-Source-Lizenzen &amp; Geodaten-Quellen</h1>
       <h2>1. Software-Lizenzen (OpenUnseal)</h2>
       <ul>
         <li><strong>Backend-API &amp; Repository-Wurzel (<code>apps/api</code>):</strong> Lizenziert unter der <strong>GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)</strong> (Copyright © 2026 OpenUnseal Contributors). Gemäß § 13 AGPLv3 steht der vollständige korrespondierende Quellcode kostenlos unter <a href="${escapeHtml(config.sourceCodeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(config.sourceCodeUrl)}</a> bereit (Details zur Split-Lizenzierung in <code>LICENSING.md</code>).</li>
         <li><strong>Web-App &amp; gemeinsame Schemas (<code>apps/mobile</code>, <code>packages/shared</code>):</strong> Lizenziert unter der <strong>Mozilla Public License 2.0 (MPL-2.0)</strong> (Copyright © 2026 OpenUnseal Contributors).</li>
         <li><strong>Wesentliche Drittanbieter-Bibliotheken &amp; Laufzeitkomponenten:</strong> Expo, React, React Native &amp; React Native for Web (MIT), MapLibre GL JS (BSD-3-Clause), Fastify &amp; Plugins (MIT), PostgreSQL (PostgreSQL License) &amp; PostGIS (GPL-2.0-or-later), sharp (Apache-2.0) / libvips (LGPL-3.0-or-later), Turf.js (MIT), @node-rs/argon2 (MIT), exifr (MIT), pg (MIT), Zod (MIT), Nodemailer (MIT-0), Pino (MIT), Node.js (MIT), Caddy (Apache-2.0).</li>
         <li><strong>Paketlizenzen &amp; Copyright-Hinweise:</strong> Die npm-Abhängigkeiten, wiedergegebenen Lizenztexte und Docker-Komponenten sind in <a href="${escapeHtml(noticesHref)}"><code>THIRD_PARTY_NOTICES.txt</code></a> (sowie im Quellcode-Repository) dokumentiert.</li>
       </ul>
       <h2>2. Geodaten- &amp; Kartenquellen</h2>
       <ul>
         ${basemapLicenseHtml}
         <li><strong>Adresssuche (Geocodierung):</strong> OpenStreetMap Nominatim, Daten © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap-Mitwirkende (ODbL)</a>.</li>
         ${vg250LicenseHtml}
         ${spaceLicenseHtml}
         ${orthoLicenseHtml}
       </ul>
       <h2>3. Nutzerbeiträge &amp; Offene Daten</h2>
       <ul>
         <li><strong>Zusammengestellter GeoJSON-Datensatz (<code>/api/v1/polygons/export.geojson</code>):</strong> <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener noreferrer">Open Data Commons Open Database License 1.0 (ODbL 1.0)</a>; enthält ausschließlich Flächenvorschläge und ihre Bewertungen (Gemeindeattribute aus <code>VG250</code> lassen sich mit <code>?includeMunicipality=false</code> ausblenden). Mitwirkende verzichten auf eigene Urheber- und Datenbankrechte an eingezeichneten Geometrien, Belagsangaben, der Angabe öffentlicher/privater Grund und Notizen gemäß <a href="https://creativecommons.org/publicdomain/zero/1.0/deed.de" target="_blank" rel="noopener noreferrer">CC0 1.0 Universal</a> (inkl. Ziffer 3 <em>Public License Fallback</em>).</li>
         <li><strong>Vor-Ort-Fotos &amp; Kommentare:</strong> <a href="https://creativecommons.org/licenses/by/4.0/deed.de" target="_blank" rel="noopener noreferrer">CC BY 4.0 International</a> (Namensnennung des Pseudonyms; Fotos serverseitig EXIF-bereinigt &amp; als WebP skaliert; Details in den <a href="${escapeHtml(termsHref)}">Nutzungsbedingungen</a>).</li>
       </ul>
       <p class="en-sub"><strong>English summary:</strong> OpenUnseal API is licensed under AGPL-3.0-or-later (Corresponding Source available at <a href="${escapeHtml(config.sourceCodeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(config.sourceCodeUrl)}</a>); the web client and shared schemas are licensed under MPL-2.0 (Copyright © 2026 OpenUnseal Contributors). Third-party notices and license texts are available at <a href="${escapeHtml(noticesHref)}">THIRD_PARTY_NOTICES.txt</a>. ${usesOpenFreeMap ? 'Vector basemap via OpenFreeMap (MIT), © OpenMapTiles / © CARTO (modified in dark mode) (CC BY 4.0 / BSD-3-Clause), © OpenStreetMap contributors (ODbL), Natural Earth (Public Domain), and Noto Sans (SIL OFL 1.1).' : 'Basemap tiles are loaded from the configured style host.'} Geocoding © OpenStreetMap contributors (ODbL).${vg250EnglishSummary} ${orthoEnglishSummary} Compiled polygon exports are licensed under ODbL 1.0 (with contributor CC0 1.0 rights waiver / Section 3 Public License Fallback); site photos and comments under CC BY 4.0.</p>
       ${buildLegalNavHtml(app, theme)}`,
      { wide: true, theme },
    );
  });

  app.get('/auth/privacy', async (request, reply) => {
    const theme = parseRequestedTheme(request.query);
    return sendHostedHtml(
      app,
      reply,
      200,
      'Datenschutzerklärung',
      buildPrivacyPolicyHtml(app, theme),
      { wide: true, theme },
    );
  });

  app.get(
    '/auth/verify-email',
    { config: { rateLimit: pageLimit } },
    async (request, reply) => {
      const theme = parseRequestedTheme(request.query);
      const token = readStringField(request.query, 'token').trim();
      const check = await inspectEmailActionToken(
        app.pool,
        token,
        'verify_email',
      );

      if (!check.valid || !check.pseudonym) {
        return sendHostedHtml(
          app,
          reply,
          400,
          'Link ungültig oder abgelaufen',
          `<div class="alert-err">Dieser Bestätigungslink ist ungültig, abgelaufen oder wurde bereits verwendet.</div>
           <h1>E-Mail-Bestätigung fehlgeschlagen</h1>
           <p>Bitte öffne die ${safeAppName}-App und fordere im Anmeldedialog einen neuen Bestätigungslink an.</p>
           <p class="en-sub"><strong>English:</strong> This confirmation link is invalid, expired, or has already been used. Please request a fresh confirmation link from the sign-in screen in the app.</p>`,
          { theme },
        );
      }

      const themeInput = theme
        ? `<input type="hidden" name="theme" value="${theme}" />`
        : '';
      return sendHostedHtml(
        app,
        reply,
        200,
        'E-Mail-Adresse bestätigen',
        `<h1>E-Mail-Adresse bestätigen</h1>
         <p>Hallo <strong>${escapeHtml(check.pseudonym)}</strong>! Klicke auf den Button unten, um dein Konto endgültig freizuschalten.</p>
         <form method="POST" action="/auth/verify-email">
           <input type="hidden" name="token" value="${escapeHtml(token)}" />
           ${themeInput}
           <button type="submit">E-Mail-Adresse jetzt bestätigen</button>
         </form>
         <p class="en-sub"><strong>English:</strong> Click the button above to activate account <strong>${escapeHtml(check.pseudonym)}</strong>.</p>`,
        { theme },
      );
    },
  );

  app.post(
    '/auth/verify-email',
    { config: { rateLimit: pageLimit } },
    async (request, reply) => {
      const theme =
        parseRequestedTheme(request.body) ?? parseRequestedTheme(request.query);
      const token = readStringField(request.body, 'token').trim();
      try {
        const verified = await consumeVerifyEmailToken(
          app.pool,
          token,
          request.log,
        );
        return sendHostedHtml(
          app,
          reply,
          200,
          'E-Mail bestätigt',
          `<div class="alert-ok">✓ E-Mail-Adresse erfolgreich bestätigt!</div>
           <h1>Willkommen, ${escapeHtml(verified.pseudonym)}!</h1>
           <p>Dein Konto ist jetzt aktiv. Du kannst dieses Browserfenster schließen und dich in der <strong>${safeAppName}</strong>-App anmelden.</p>
           <p class="en-sub"><strong>English:</strong> Your email address is confirmed! You can now close this tab and sign in to ${safeAppName}.</p>`,
          { theme },
        );
      } catch (err: unknown) {
        const status = err instanceof ApiError ? err.statusCode : 400;
        return sendHostedHtml(
          app,
          reply,
          status >= 400 && status < 500 ? status : 400,
          'Bestätigung nicht möglich',
          `<div class="alert-err">Dieser Bestätigungslink ist ungültig oder bereits eingelöst.</div>
           <h1>E-Mail-Bestätigung fehlgeschlagen</h1>
           <p>Falls du dein Konto bereits bestätigt hast, kannst du dich direkt in der App anmelden. Andernfalls fordere dort bitte einen neuen Link an.</p>
           <p class="en-sub"><strong>English:</strong> This confirmation link is invalid or was already used. If already confirmed, sign in directly inside the app.</p>`,
          { theme },
        );
      }
    },
  );

  app.get(
    '/auth/reset-password',
    { config: { rateLimit: pageLimit } },
    async (request, reply) => {
      const theme = parseRequestedTheme(request.query);
      const token = readStringField(request.query, 'token').trim();
      const check = await inspectEmailActionToken(
        app.pool,
        token,
        'reset_password',
      );

      if (!check.valid || !check.pseudonym) {
        return sendHostedHtml(
          app,
          reply,
          400,
          'Link ungültig oder abgelaufen',
          `<div class="alert-err">Dieser Wiederherstellungslink ist ungültig, abgelaufen oder wurde bereits verwendet.</div>
           <h1>Passwort-Zurücksetzung nicht möglich</h1>
           <p>Bitte fordere in der ${safeAppName}-App unter <em>Passwort vergessen?</em> einen neuen Link an.</p>
           <p class="en-sub"><strong>English:</strong> This password reset link is invalid, expired, or has already been used. Please request a new reset link inside the app.</p>`,
          { theme },
        );
      }

      const themeInput = theme
        ? `<input type="hidden" name="theme" value="${theme}" />`
        : '';
      return sendHostedHtml(
        app,
        reply,
        200,
        'Neues Passwort festlegen',
        `<h1>Neues Passwort festlegen</h1>
         <p>Vergib ein neues Passwort für dein Konto <strong>${escapeHtml(check.pseudonym)}</strong> (mindestens ${AUTH_LIMITS.MIN_PASSWORD_LENGTH} Zeichen).</p>
         <form method="POST" action="/auth/reset-password">
           <input type="hidden" name="token" value="${escapeHtml(token)}" />
           ${themeInput}
           <label for="newPassword">Neues Passwort / New password</label>
           <input id="newPassword" name="newPassword" type="password" minlength="${AUTH_LIMITS.MIN_PASSWORD_LENGTH}" maxlength="${AUTH_LIMITS.MAX_PASSWORD_LENGTH}" autocomplete="new-password" required />
           <label for="confirmPassword">Passwort wiederholen / Confirm password</label>
           <input id="confirmPassword" name="confirmPassword" type="password" minlength="${AUTH_LIMITS.MIN_PASSWORD_LENGTH}" maxlength="${AUTH_LIMITS.MAX_PASSWORD_LENGTH}" autocomplete="new-password" required />
           <button type="submit">Passwort speichern</button>
         </form>
         <p class="en-sub"><strong>English:</strong> Enter and confirm a new password (at least ${AUTH_LIMITS.MIN_PASSWORD_LENGTH} characters) for <strong>${escapeHtml(check.pseudonym)}</strong>.</p>`,
        { theme },
      );
    },
  );

  app.post(
    '/auth/reset-password',
    { config: { rateLimit: pageLimit } },
    async (request, reply) => {
      const theme =
        parseRequestedTheme(request.body) ?? parseRequestedTheme(request.query);
      const themeInput = theme
        ? `<input type="hidden" name="theme" value="${theme}" />`
        : '';
      const token = readStringField(request.body, 'token').trim();
      const newPassword = readStringField(request.body, 'newPassword');
      const confirmPassword = readStringField(request.body, 'confirmPassword');

      if (newPassword !== confirmPassword) {
        return sendHostedHtml(
          app,
          reply,
          422,
          'Passwörter stimmen nicht überein',
          `<div class="alert-err">Die eingegebenen Passwörter stimmen nicht überein.</div>
           <h1>Neues Passwort festlegen</h1>
           <form method="POST" action="/auth/reset-password">
             <input type="hidden" name="token" value="${escapeHtml(token)}" />
             ${themeInput}
             <label for="newPassword">Neues Passwort / New password</label>
             <input id="newPassword" name="newPassword" type="password" minlength="${AUTH_LIMITS.MIN_PASSWORD_LENGTH}" maxlength="${AUTH_LIMITS.MAX_PASSWORD_LENGTH}" autocomplete="new-password" required />
             <label for="confirmPassword">Passwort wiederholen / Confirm password</label>
             <input id="confirmPassword" name="confirmPassword" type="password" minlength="${AUTH_LIMITS.MIN_PASSWORD_LENGTH}" maxlength="${AUTH_LIMITS.MAX_PASSWORD_LENGTH}" autocomplete="new-password" required />
             <button type="submit">Passwort speichern</button>
           </form>
           <p class="en-sub"><strong>English:</strong> Passwords did not match. Please try again.</p>`,
          { theme },
        );
      }

      try {
        await consumePasswordResetToken(
          app.pool,
          app.authSemaphore,
          token,
          newPassword,
          request.log,
        );
        return sendHostedHtml(
          app,
          reply,
          200,
          'Passwort gespeichert',
          `<div class="alert-ok">✓ Dein Passwort wurde erfolgreich geändert!</div>
           <h1>Passwort aktualisiert</h1>
           <p>Alle bisherigen Sitzungen wurden aus Sicherheitsgründen abgemeldet. Du kannst dich jetzt mit deinem neuen Passwort in der <strong>${safeAppName}</strong>-App anmelden.</p>
           <p class="en-sub"><strong>English:</strong> Your password has been updated and prior sessions were signed out. You can now sign in to the app with your new password.</p>`,
          { theme },
        );
      } catch (err: unknown) {
        if (err instanceof ZodError) {
          return sendHostedHtml(
            app,
            reply,
            422,
            'Passwort zu kurz oder ungültig',
            `<div class="alert-err">Das Passwort muss zwischen ${AUTH_LIMITS.MIN_PASSWORD_LENGTH} und ${AUTH_LIMITS.MAX_PASSWORD_LENGTH} Zeichen lang sein.</div>
             <h1>Neues Passwort festlegen</h1>
             <form method="POST" action="/auth/reset-password">
               <input type="hidden" name="token" value="${escapeHtml(token)}" />
               ${themeInput}
               <label for="newPassword">Neues Passwort / New password</label>
               <input id="newPassword" name="newPassword" type="password" minlength="${AUTH_LIMITS.MIN_PASSWORD_LENGTH}" maxlength="${AUTH_LIMITS.MAX_PASSWORD_LENGTH}" autocomplete="new-password" required />
               <label for="confirmPassword">Passwort wiederholen / Confirm password</label>
               <input id="confirmPassword" name="confirmPassword" type="password" minlength="${AUTH_LIMITS.MIN_PASSWORD_LENGTH}" maxlength="${AUTH_LIMITS.MAX_PASSWORD_LENGTH}" autocomplete="new-password" required />
               <button type="submit">Passwort speichern</button>
             </form>
             <p class="en-sub"><strong>English:</strong> Password must be between ${AUTH_LIMITS.MIN_PASSWORD_LENGTH} and ${AUTH_LIMITS.MAX_PASSWORD_LENGTH} characters.</p>`,
            { theme },
          );
        }
        const message =
          err instanceof ApiError && err.code === 'AUTH_TOKEN_INVALID'
            ? 'Dieser Wiederherstellungslink ist ungültig oder abgelaufen.'
            : `Das Passwort muss zwischen ${AUTH_LIMITS.MIN_PASSWORD_LENGTH} und ${AUTH_LIMITS.MAX_PASSWORD_LENGTH} Zeichen lang sein.`;
        return sendHostedHtml(
          app,
          reply,
          400,
          'Passwort konnte nicht gespeichert werden',
          `<div class="alert-err">${escapeHtml(message)}</div>
           <h1>Zurücksetzung fehlgeschlagen</h1>
           <p>Bitte prüfe die Eingabe oder fordere in der App einen neuen Wiederherstellungslink an.</p>
           <p class="en-sub"><strong>English:</strong> Password reset could not be completed. Please request a fresh recovery link inside the app if this link has expired.</p>`,
          { theme },
        );
      }
    },
  );
}
