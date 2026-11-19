// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Unseal Contributors

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ZodError } from 'zod';

import {
  AUTHOR_ACTIVITY,
  AUTH_LIMITS,
  ApiError,
  PHOTO_LIMITS,
} from '@entsiegelung/shared';

import {
  BKG_VG250_DATENQUELLEN_URL,
  getMunicipalitiesStatus,
} from '../municipalities/vg250.js';
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

function sendHostedHtml(
  reply: FastifyReply,
  statusCode: number,
  title: string,
  bodyHtml: string,
  options: { wide?: boolean } = {},
): FastifyReply {
  const maxWidthPx = options.wide ? 680 : 460;
  const html = `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} – Unseal</title>
  <style>
    :root {
      color-scheme: light dark;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: #f3f5f1;
      color: #16201a;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .card {
      width: 100%;
      max-width: ${maxWidthPx}px;
      background: #ffffff;
      border: 1px solid #d5ddd7;
      border-radius: 18px;
      padding: 28px 24px;
      box-shadow: 0 12px 32px rgba(18, 34, 25, 0.08);
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: -0.01em;
      color: #176642;
      background: #eaf5ef;
      padding: 5px 12px 5px 7px;
      border-radius: 999px;
      margin-bottom: 16px;
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
      color: #176642;
    }
    p {
      margin: 0 0 14px;
      font-size: 15px;
      line-height: 1.55;
      color: #3a4940;
    }
    a {
      color: #176642;
    }
    .en-sub {
      font-size: 13px;
      color: #5b6b61;
      border-top: 1px solid #e4ebe6;
      padding-top: 14px;
      margin-top: 18px;
    }
    .legal-nav {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 14px;
      font-size: 13px;
      border-top: 1px solid #e4ebe6;
      padding-top: 14px;
      margin-top: 18px;
    }
    .alert-ok {
      background: #eaf5ef;
      border: 1px solid #8bc9a8;
      color: #155236;
      padding: 12px 14px;
      border-radius: 12px;
      font-weight: 600;
      margin-bottom: 16px;
    }
    .alert-err {
      background: #fdf0ee;
      border: 1px solid #e3a097;
      color: #962d20;
      padding: 12px 14px;
      border-radius: 12px;
      font-weight: 600;
      margin-bottom: 16px;
    }
    .alert-warn {
      background: #fef7e8;
      border: 1px solid #e6c67c;
      color: #6b4c0e;
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
      color: #24332a;
    }
    input[type="password"] {
      width: 100%;
      min-height: 46px;
      padding: 10px 14px;
      border: 1px solid #bdcac1;
      border-radius: 10px;
      font-size: 15px;
      margin-bottom: 14px;
      background: #fbfcfa;
      color: #16201a;
    }
    input[type="password"]:focus {
      outline: 2px solid #1f6f4a;
      border-color: #1f6f4a;
    }
    button {
      width: 100%;
      min-height: 48px;
      border: none;
      border-radius: 999px;
      background: #1f6f4a;
      color: #ffffff;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
    }
    button:hover {
      background: #18583a;
    }
    ul {
      margin: 0 0 16px;
      padding-left: 20px;
      color: #3a4940;
      font-size: 14px;
      line-height: 1.5;
    }
    li { margin-bottom: 8px; }
    @media (prefers-color-scheme: dark) {
      body {
        background: #0f1613;
        color: #ecf3ef;
      }
      .card {
        background: #16201b;
        border-color: #2b3b32;
        box-shadow: 0 14px 36px rgba(0, 0, 0, 0.48);
      }
      .brand {
        color: #6ee7b7;
        background: #193126;
      }
      h2, a {
        color: #34c785;
      }
      p, ul {
        color: #b7c7be;
      }
      .en-sub, .legal-nav {
        color: #93a89d;
        border-top-color: #26352d;
      }
      .alert-ok {
        background: #132e22;
        border-color: #235c42;
        color: #6ee7b7;
      }
      .alert-err {
        background: #311518;
        border-color: #70262c;
        color: #fca5a5;
      }
      .alert-warn {
        background: #2d2210;
        border-color: #6b4e1b;
        color: #fcd34d;
      }
      label {
        color: #ecf3ef;
      }
      input[type="password"] {
        border-color: #394d42;
        background: #121a16;
        color: #ecf3ef;
      }
      input[type="password"]:focus {
        outline-color: #34c785;
        border-color: #34c785;
      }
      button {
        background: #34c785;
        color: #062115;
      }
      button:hover {
        background: #28b073;
      }
    }
  </style>
</head>
<body>
  <main class="card">
    <div class="brand">
      <svg width="22" height="22" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect width="64" height="64" rx="14" fill="#EFF3F0"/>
        <path d="M0 40H26L31 50L37 40H64V50C64 57.732 57.732 64 50 64H14C6.26801 64 0 57.732 0 50V40Z" fill="#5A6360"/>
        <path d="M31 49C31 38 32 30 37 22" stroke="#176642" stroke-width="4" stroke-linecap="round"/>
        <path d="M34 26C35 16 44 13 49 15C48 22 42 27 34 26Z" fill="#1F7A4C"/>
        <path d="M31 34C29 27 22 25 18 26C19 31 25 35 31 34Z" fill="#176642"/>
      </svg>
      <span>Unseal</span>
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
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
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

function buildLegalNavHtml(app: FastifyInstance): string {
  return `<nav class="legal-nav" aria-label="Rechtliche Hinweise">
    <a href="${escapeHtml(app.config.impressumUrl)}">Impressum</a>
    <a href="${escapeHtml(app.config.privacyPolicyUrl)}">Datenschutz</a>
    <a href="${escapeHtml(app.config.termsUrl)}">Nutzungsbedingungen</a>
    <a href="${escapeHtml(app.config.licensesUrl)}">Open-Source-Lizenzen</a>
    <a href="${escapeHtml(app.config.sourceCodeUrl)}" target="_blank" rel="noopener noreferrer">Quellcode (AGPL-3.0 / MPL-2.0)</a>
  </nav>`;
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
    parts.push(`E-Mail: ${escapeHtml(app.config.operatorEmail)}`);
  }
  if (app.config.operatorPhone) {
    parts.push(`Telefon: ${escapeHtml(app.config.operatorPhone)}`);
  }
  if (parts.length === 0) {
    return `<div class="alert-warn"><strong>Hinweis für Betreibende:</strong> Bitte hinterlege <code>OPERATOR_NAME</code>, <code>OPERATOR_ADDRESS</code> und <code>OPERATOR_EMAIL</code> in der Server-Konfiguration (<code>.env</code> / <code>.env.vps</code>), um die gesetzlichen Pflichtangaben (§ 5 DDG / § 18 MStV / Art. 13 DSGVO) vollständig auszugeben.</div>`;
  }
  return `<p>${parts.join('<br />')}</p>`;
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
    `<li><strong>E-Mail-Versand (Auftragsverarbeitung, Art. 28 DSGVO):</strong> ${mailProvider} versendet Bestätigungs- und Wiederherstellungslinks sowie Fehlermeldungen an die Betreiberstelle.${tlsNote}</li>`,
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
          ? '<em>OpenFreeMap</em> (<a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">openfreemap.org</a>, Kartendaten © OpenStreetMap-Mitwirkende)'
          : `<code>${escapeHtml(host)}</code>`,
      )
      .join(' bzw. ');
    items.push(
      `<li><strong>Basiskarte (Art. 6 Abs. 1 lit. f DSGVO):</strong> Dein Endgerät lädt Kartenstil, Schriften und Vektorkacheln <strong>direkt</strong> von ${provider} (bzw. den dort im Kartenstil angegebenen Servern). Dabei wird technisch bedingt deine IP-Adresse an diesen Anbieter übermittelt, der dafür selbst verantwortlich ist. Unser Interesse: eine funktionierende Kartendarstellung.</li>`,
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
    '<li><strong>Adresssuche:</strong> Suchanfragen werden über diesen Server an OpenStreetMap Nominatim (OpenStreetMap Foundation, Vereinigtes Königreich – Angemessenheitsbeschluss der EU-Kommission) weitergeleitet. Übermittelt wird nur der Suchtext, nicht deine IP-Adresse. Ergebnisse werden bis zu 10 Minuten im Arbeitsspeicher zwischengespeichert; Suchtexte werden nicht protokolliert.</li>',
  );

  return items.join('\n         ');
}

function buildPrivacyPolicyHtml(app: FastifyInstance): string {
  const config = app.config;
  const controllerBlock = buildOperatorIdentityHtml(app);
  const contactLine = config.abuseContact
    ? `<p><strong>Kontakt für Datenschutzanfragen:</strong> ${escapeHtml(config.abuseContact)}</p>`
    : `<p><strong>Kontakt:</strong> Bitte wende dich bei Fragen zum Datenschutz an die oben bzw. im <a href="${escapeHtml(config.impressumUrl)}">Impressum</a> genannte verantwortliche Stelle.</p>`;
  const recentDays = AUTHOR_ACTIVITY.RECENT_DAYS;
  const backupLine =
    config.backupRetentionDays !== null
      ? `<li><strong>Datensicherungen:</strong> werden nach ${config.backupRetentionDays} Tagen gelöscht. Gelöschte Daten verschwinden daher spätestens nach dieser Frist auch aus den Sicherungen.</li>`
      : `<li><div class="alert-warn"><strong>Hinweis für Betreibende:</strong> Bitte <code>BACKUP_RETENTION_DAYS</code> setzen, damit hier die Aufbewahrungsdauer von Datensicherungen angegeben wird.</div></li>`;

  return `<h1>Datenschutzerklärung (DSGVO)</h1>
       <p>Unseal ist ein datensparsames Open-Source-Bürgerbeteiligungsprojekt (PPGIS) zur gemeinschaftlichen Kartierung versiegelter Flächen. Hier steht, welche personenbezogenen Daten diese Instanz verarbeitet, wozu und wie lange. Es gibt keine Cookies, kein Tracking und keine Analyse- oder Werbedienste.</p>

       <h2>1. Verantwortliche Stelle (Art. 13 Abs. 1 lit. a DSGVO)</h2>
       ${controllerBlock}
       ${contactLine}

       <h2>2. Was öffentlich sichtbar ist</h2>
       <ul>
         <li>Dein <strong>Pseudonym</strong> bei deinen Flächenvorschlägen, Fotos und Kommentaren. Deine E-Mail-Adresse wird nie öffentlich angezeigt.</li>
         <li>Ob du in den letzten ${recentDays} Tagen aktiv warst („Aktiv in den letzten ${recentDays} Tagen“). Gespeichert wird dafür nur das <em>Datum</em> deiner letzten Aktivität, keine Uhrzeit.</li>
         <li>Der Hinweis „Neue/r Beitragende/r“, bis dein Konto mindestens ${config.newUserMinAccountDays} Tage besteht und mindestens ${config.newUserMinCleanPolygons} positiv bewertete Vorschläge erreicht hat.</li>
         <li>Deine Beiträge: Flächen, Belagsart, Notizen, Fotos, Kommentare sowie die Summe der Abstimmungen.</li>
         <li>Der öffentliche GeoJSON-Gesamtexport (ODbL 1.0) enthält Geometrien, Belagsart, Notizen, Status, Gemeinde, Abstimmungszahlen und Zeitstempel, aber <strong>kein Pseudonym</strong> und keine sonstigen Kontodaten.</li>
       </ul>

       <h2>3. Verarbeitete Daten, Zwecke und Rechtsgrundlagen</h2>
       <ul>
         <li><strong>Konto (Art. 6 Abs. 1 lit. b DSGVO, Bereitstellung der Plattform):</strong> Pseudonym, E-Mail-Adresse (für Bestätigungs- und Wiederherstellungslinks sowie einen Hinweis, falls jemand sich erneut mit deiner Adresse registrieren will), Passwort ausschließlich als Argon2id-Hash, Rolle, Zeitpunkte von Registrierung, E-Mail-Bestätigung, Kenntnisnahme dieser Erklärung und Annahme der Nutzungsbedingungen sowie das Datum deiner letzten Aktivität. Sitzungen werden serverseitig nur als SHA-256-Hash des Tokens gespeichert.</li>
         <li><strong>Beiträge (Art. 6 Abs. 1 lit. b DSGVO):</strong> Flächen, Notizen, Fotos, Kommentare, Abstimmungen und Meldungen mit Zeitstempeln. Angemeldete Konten können eine persönliche Übersicht ihrer aktuellen Beiträge und abgegebenen Flächenbewertungen abrufen, die ausschließlich aus diesen bestehenden Daten berechnet wird; die allgemeine Statistik zeigt nur anonyme Gesamtzahlen. Die Lizenzen ergeben sich aus den <a href="${escapeHtml(config.termsUrl)}">Nutzungsbedingungen</a>.</li>
         <li><strong>Fotos &amp; Metadaten:</strong> Das Foto wird mit seinen Metadaten hochgeladen. Der Server prüft im Arbeitsspeicher, ob die darin enthaltene GPS-Position in der kartierten Fläche (inkl. ${PHOTO_LIMITS.GPS_VERIFY_DISTANCE_M} m Puffer) liegt, speichert nur dieses Ergebnis (<em>GPS verified</em>) und entfernt <strong>alle</strong> EXIF-/XMP-/IPTC-Metadaten (Gerät, Koordinaten, Aufnahmezeit), bevor das Bild als WebP gespeichert wird. Bitte lade keine Aufnahmen hoch, auf denen Personen, Gesichter oder Kfz-Kennzeichen erkennbar sind.</li>
         <li><strong>Missbrauchsschutz (Art. 6 Abs. 1 lit. f DSGVO; Interesse: Schutz vor Spam, Mehrfachkonten und Identitätsmissbrauch):</strong> Anfragebegrenzungen anhand der IP-Adresse ausschließlich im Arbeitsspeicher (IPv6 auf /64 gekürzt, Zeitfenster höchstens 1 Stunde); Zähler fehlgeschlagener Anmeldeversuche je Konto (Sperrung der Anmeldung nach ${AUTH_LIMITS.MAX_FAILED_LOGIN_ATTEMPTS} Fehlversuchen bis zur erneuten E-Mail-Bestätigung); eine Rechenaufgabe (Proof-of-Work, ohne Drittanbieter) bei der Registrierung; ein mit einem geheimen Serverschlüssel gebildeter Hash (HMAC-SHA-256) deiner normalisierten E-Mail-Adresse, um Doppelkonten über Alias-Adressen zu verhindern.</li>
         <li><strong>Server-Protokolle (Art. 6 Abs. 1 lit. f DSGVO; Interesse: sicherer Betrieb, Fehleranalyse):</strong> Anfrage-ID, Methode, Pfad ohne Parameter, Statuscode, Antwortzeit und Fehlermeldungen. <strong>Keine</strong> IP-Adressen, Browserkennungen (User-Agent) oder Referrer. Der vorgeschaltete Webserver schreibt keine Zugriffsprotokolle.</li>
         <li><strong>Fehlermeldungen (Art. 6 Abs. 1 lit. f DSGVO; optionale Kontakt-E-Mail: Art. 6 Abs. 1 lit. a DSGVO):</strong> Beschreibung, optionale Kontakt-E-Mail, Plattform, Seiten-URL, Zeitpunkt und, falls angemeldet, Pseudonym und Konto-ID gehen per E-Mail an die Betreiberstelle.</li>
         <li><strong>Standort, Kamera &amp; Mediathek:</strong> nur nach deiner Freigabe auf dem Gerät. Deine Live-Position wird nicht an den Server übertragen (zu Fotos siehe oben).</li>
         <li><strong>Speicher auf deinem Gerät (§ 25 Abs. 2 Nr. 2 TDDDG):</strong> Sitzungs-Token (Web: <code>localStorage</code>, App: geschützter Systemspeicher), zuletzt angezeigter Kartenausschnitt sowie gewählte Sprache und Darstellungsmodus (Hell/Dunkel). Diese Angaben bleiben auf deinem Gerät.</li>
       </ul>

       <h2>4. Empfänger &amp; Drittanbieter (Art. 13 Abs. 1 lit. e, f DSGVO)</h2>
       <ul>
         ${buildThirdPartyItemsHtml(app)}
       </ul>

       <h2>5. Speicherdauer</h2>
       <ul>
         <li><strong>Konto:</strong> bis du es löschst. Unbestätigte Registrierungen werden nach 48 Stunden gelöscht.</li>
         <li><strong>Beiträge:</strong> bis du sie oder dein Konto (mit der Option „alle Beiträge mitlöschen“) löschst. Vorschläge, die nach ${config.staleUnratedPruneDays} Tagen weder Stimmen noch Kommentare oder Fotos aufweisen, werden automatisch entfernt.</li>
         <li><strong>Sitzungen:</strong> höchstens ${config.sessionTtlDays} Tage; abgelaufene Sitzungen werden stündlich gelöscht.</li>
         <li><strong>E-Mail-Links:</strong> gültig ${AUTH_LIMITS.EMAIL_VERIFY_TTL_HOURS} Stunden (Bestätigung) bzw. ${AUTH_LIMITS.PASSWORD_RESET_TTL_MINUTES} Minuten (Passwort); die Datensätze werden 7 Tage nach Nutzung oder Ablauf gelöscht.</li>
         <li><strong>Pseudonym-Reservierung nach Kontolöschung:</strong> ${config.pseudonymReservationDays} Tage, gespeichert nur als HMAC-Wert, damit sich niemand als du ausgeben kann. Bei einer Sperrung wegen Missbrauchs werden HMAC-Werte von Pseudonym und E-Mail-Adresse gespeichert, bis die Sperre aufgehoben wird.</li>
         <li><strong>Server-Protokolle:</strong> werden fortlaufend überschrieben (höchstens 3 × 10 MB je Dienst).</li>
         <li><strong>Fehlermeldungen:</strong> werden nach Abschluss der Bearbeitung aus dem Postfach der Betreiberstelle gelöscht.</li>
         ${backupLine}
       </ul>

       <h2>6. Deine Rechte</h2>
       <ul>
         <li><strong>Auskunft &amp; Datenübertragbarkeit (Art. 15, 20 DSGVO):</strong> In der App unter <em>Konto → Meine Daten herunterladen</em> erhältst du alle zu deinem Konto gespeicherten Daten als JSON-Datei. Alternativ über die Kontaktstelle.</li>
         <li><strong>Berichtigung (Art. 16 DSGVO):</strong> Änderungen von E-Mail-Adresse oder Pseudonym über die Kontaktstelle.</li>
         <li><strong>Löschung (Art. 17 DSGVO):</strong> Unter <em>Konto → Konto löschen</em> werden E-Mail-Adresse, Zugangsdaten, Sitzungen und Stimmen sofort gelöscht. Deine Beiträge bleiben dann anonym als „gelöscht“ sichtbar, außer du wählst, sie mitzulöschen. Einzelne Fotos, Kommentare und Vorschläge kannst du jederzeit selbst von der Plattform löschen (bereits zuvor von Dritten unter offenen Datenlizenzen heruntergeladene Kopien bleiben gemäß den jeweiligen Lizenzbedingungen bestehen).</li>
         <li><strong>Einschränkung (Art. 18), Widerspruch gegen Verarbeitungen nach Art. 6 Abs. 1 lit. f (Art. 21) und Widerruf einer Einwilligung</strong> mit Wirkung für die Zukunft (Art. 7 Abs. 3 DSGVO) über die Kontaktstelle.</li>
         <li><strong>Beschwerde</strong> bei einer Datenschutz-Aufsichtsbehörde (Art. 77 DSGVO).</li>
       </ul>
       <p>Es finden keine automatisierten Einzelentscheidungen im Sinne von Art. 22 DSGVO statt.</p>

       <p class="en-sub"><strong>English summary:</strong> Public: your pseudonym, your contributions, whether you were active in the last ${recentDays} days (only the date of your last activity is stored) and a "new contributor" hint; the ODbL 1.0 GeoJSON export contains no pseudonym. Your email is used only for account links and never shown. Accounts and contributions are processed under Art. 6(1)(b) GDPR (signed-in accounts can view a personal summary derived solely from their existing contributions and polygon ratings; public statistics show anonymous totals only); abuse prevention and logs under Art. 6(1)(f). Server logs contain no IP addresses, user agents or referrers; rate limiting keeps IPs in memory only. Photo metadata is checked in memory and fully stripped before storage. Third parties are listed in section 4 according to this instance's configuration. Retention: unconfirmed accounts 48 h, sessions up to ${config.sessionTtlDays} days, email links 7 days after use, pseudonym reservation after deletion ${config.pseudonymReservationDays} days (keyed hash only). Rights: download your data in the app, delete your account with or without your contributions (open-data licenses on copies legitimately downloaded prior to deletion remain irrevocable under their terms), and contact the operator for corrections, restriction, objection or a complaint to a supervisory authority.</p>
       ${buildLegalNavHtml(app)}`;
}

export function registerAuthPageRoutes(app: FastifyInstance): void {
  const pageLimit = app.rateLimitOverrides.recover ?? {
    max: 20,
    timeWindow: '15 minutes',
  };

  app.get('/auth/impressum', async (_request, reply) => {
    const operatorHtml = buildOperatorIdentityHtml(app);
    const abuseHtml = app.config.abuseContact
      ? `<p><strong>Melde- &amp; Moderationskontakt (Digital Services Act / Art. 16 DSA):</strong> ${escapeHtml(app.config.abuseContact)}</p>`
      : '';
    return sendHostedHtml(
      reply,
      200,
      'Impressum',
      `<h1>Impressum</h1>
       <p>Angaben gemäß § 5 Digitale-Dienste-Gesetz (DDG) und § 18 Abs. 2 Medienstaatsvertrag (MStV) für diese Unseal-Instanz:</p>
       <h2>Verantwortliche Stelle / Betreibende</h2>
       ${operatorHtml}
       ${abuseHtml}
       <h2>Haftungs- &amp; Beteiligungshinweis</h2>
       <p>${escapeHtml(app.config.disclaimerText)}</p>
       <p>Nutzende sind für die von ihnen eingestellten Flächenvorschläge, Texte, Kommentare und Fotos selbst verantwortlich. Hinweise auf rechtswidrige Inhalte werden über die oben genannte Kontaktstelle bzw. die Meldefunktion geprüft und unverzüglich entfernt.</p>
       <h2>Quellcode &amp; Lizenzen</h2>
       <p>Diese Instanz nutzt die Open-Source-Software <strong>Unseal</strong> (Server: <code>AGPL-3.0-or-later</code>, Client &amp; Shared: <code>MPL-2.0</code>). Der vollständige Quellcode ist unter <a href="${escapeHtml(app.config.sourceCodeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(app.config.sourceCodeUrl)}</a> verfügbar.</p>
       <p class="en-sub"><strong>English summary:</strong> Legal notice / operator identification pursuant to German law (§ 5 DDG / § 18(2) MStV). Unseal is open-source software (API: AGPL-3.0-or-later, Client: MPL-2.0); source code is available at <a href="${escapeHtml(app.config.sourceCodeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(app.config.sourceCodeUrl)}</a>.</p>
       ${buildLegalNavHtml(app)}`,
      { wide: true },
    );
  });

  app.get('/auth/terms', async (_request, reply) => {
    const abuseNote = app.config.abuseContact
      ? `Missbrauchs- und Rechtsverstoßmeldungen können jederzeit an <strong>${escapeHtml(app.config.abuseContact)}</strong> oder direkt an die Fläche gerichtet werden.`
      : `Missbrauchs- und Rechtsverstoßmeldungen können an die im <a href="${escapeHtml(app.config.impressumUrl)}">Impressum</a> genannte Kontaktstelle gerichtet werden.`;
    return sendHostedHtml(
      reply,
      200,
      'Nutzungsbedingungen & Datenlizenzen',
      `<h1>Nutzungsbedingungen &amp; Offene Datenlizenzen</h1>
       <p>Mit der Registrierung eines Kontos und dem Einstellen von Beiträgen auf dieser Unseal-Instanz akzeptierst du folgende Regeln und Lizenzbedingungen:</p>
       <ul>
         <li><strong>Unverbindliche Bürgerbeteiligung:</strong> ${escapeHtml(app.config.disclaimerText)} Ein Eintrag begründet keinen Rechtsanspruch auf Entsiegelung und greift nicht in bestehende Eigentumsrechte ein.</li>
         <li><strong>Lizenz für Flächenvorschläge, Notizen &amp; GeoJSON-Export (CC0 1.0 / ODbL 1.0):</strong> Soweit an deinen selbst eingezeichneten Polygon-Geometrien, Belagsangaben und Beschreibungstexten eigene Urheber- oder Datenbankrechte entstehen (unabhängig von den zugrunde liegenden Karten- und Luftbildquellen), verzichtest du auf diese Rechte gemäß <a href="https://creativecommons.org/publicdomain/zero/1.0/deed.de" target="_blank" rel="noopener noreferrer"><strong>Creative Commons Zero 1.0 (CC0 1.0 Universal)</strong></a>. Da Vorschläge auf Grundlage von OpenStreetMap (<code>ODbL 1.0</code>), amtlichen Landes-Luftbildern (<code>dl-de/by-2-0</code>, <code>CC BY 4.0</code>, <code>dl-de/zero-2-0</code>) und BKG-Gemeindegrenzen (<code>dl-de/by-2-0</code>) erfasst und verknüpft werden, wird der zusammengestellte öffentliche Datensatz (<code>/api/v1/polygons/export.geojson</code>) unter der <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener noreferrer"><strong>Open Data Commons Open Database License 1.0 (ODbL 1.0)</strong></a> inklusive der erforderlichen Quellenvermerke bereitgestellt. Durch Admin-Konten importierte Bestandsdatensätze (<code>.geojson</code> / <code>.gpkg</code>) fließen in denselben <code>ODbL-1.0</code>-Export ein und dürfen ausschließlich aus <code>ODbL-1.0</code>-kompatiblen offenen Quellen (<code>ODbL-1.0</code>, <code>CC0-1.0</code>, <code>dl-de/zero-2-0</code>, <code>dl-de/by-2-0</code>, <code>CC BY 4.0</code>) stammen.</li>
         <li><strong>Lizenz für Vor-Ort-Fotos &amp; Kommentare (CC BY 4.0):</strong> Hochgeladene Fotos und Diskussionskommentare lizenzierst du unter <a href="https://creativecommons.org/licenses/by/4.0/deed.de" target="_blank" rel="noopener noreferrer"><strong>Creative Commons Namensnennung 4.0 International (CC BY 4.0)</strong></a> mit Namensnennung deines öffentlichen Pseudonyms (bzw. anonymisiert als <code>deleted</code> nach Kontolöschung, sofern du deine Beiträge dabei nicht mitlöschst). Hochgeladene Fotos werden serverseitig bearbeitet (vollständige Entfernung von EXIF-/XMP-/IPTC-Metadaten, Konvertierung nach WebP sowie Skalierung/Vorschaubild). Du kannst deine Beiträge jederzeit von der Plattform löschen; für Kopien, die Dritte vor der Löschung rechtmäßig bezogen haben, gelten die offenen Lizenzen (<code>CC0 1.0</code> / <code>ODbL 1.0</code> / <code>CC BY 4.0</code>) gemäß ihren Lizenzbedingungen unwiderruflich fort.</li>
         <li><strong>Zulässige Inhalte &amp; Fotorechte (§ 59 UrhG / § 22 KUG / DSGVO):</strong> Du darfst nur eigene Fotos hochladen, die von öffentlich zugänglichen Wegen oder Plätzen aus aufgenommen wurden (Panoramafreiheit) oder für die eine ausdrückliche Erlaubnis der Berechtigten vorliegt. Lade <strong>keine</strong> Aufnahmen hoch, auf denen erkennbare Personen, Gesichter, Kfz-Kennzeichen oder nicht öffentlich einsehbare Privatbereiche (z. B. über Zäune hinweg oder per Drohne) abgebildet sind.</li>
         <li><strong>Moderation &amp; Meldeverfahren (DSA):</strong> Rechtswidrige, beleidigende, irreführende oder Spam-Beiträge können entfernt und Konten gesperrt werden. ${abuseNote}</li>
       </ul>
       <p class="en-sub"><strong>English summary:</strong> Contributions are non-binding civic suggestions. By registering and contributing, you waive your own copyright and database rights in submitted polygon geometries, surface classifications, and proposal notes under <strong>CC0 1.0 Universal</strong> (to the extent not derived from attributed basemaps), while the compiled public GeoJSON dataset (<code>/api/v1/polygons/export.geojson</code>) is licensed under <strong>ODbL 1.0</strong> with upstream attributions (admin bulk imports enter the same ODbL-1.0 export and must use ODbL-compatible open licenses). Uploaded site photos and comments are licensed under <strong>CC BY 4.0</strong> attributed to your pseudonym (uploaded photos are modified server-side by stripping EXIF/XMP/IPTC metadata and re-encoding/resizing to WebP). You may delete your contributions from the platform at any time; open-data licenses on copies legitimately downloaded prior to deletion remain irrevocable under their terms. Only upload photos you created yourself from public vantage points without identifiable faces, license plates, or private non-public areas.</p>
       ${buildLegalNavHtml(app)}`,
      { wide: true },
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

  app.get('/auth/licenses', async (_request, reply) => {
    const config = app.config;
    const currentYear = new Date().getUTCFullYear();
    const noticesHref = `${config.publicBaseUrl}/auth/third-party-notices`;
    const muniStatus = await getMunicipalitiesStatus(app.pool).catch(() => ({
      seeded: false,
      dataYear: null,
    }));
    const vg250Active = config.autoSeedVg250 || muniStatus.seeded;
    const vg250Year = muniStatus.dataYear ?? currentYear;
    const vg250LicenseHtml = vg250Active
      ? `<li><strong>Verwaltungsgrenzen (VG250):</strong> © GeoBasis-DE / <a href="https://www.bkg.bund.de" target="_blank" rel="noopener noreferrer">BKG</a> (${vg250Year}), <a href="https://www.govdata.de/dl-de/by-2-0" target="_blank" rel="noopener noreferrer">Datenlizenz Deutschland – Namensnennung 2.0 (dl-de/by-2-0)</a>, <a href="${escapeHtml(BKG_VG250_DATENQUELLEN_URL)}" target="_blank" rel="noopener noreferrer">Datenquellen</a> (Daten verändert).</li>`
      : '<li><strong>Verwaltungsgrenzen (VG250):</strong> Auf dieser Instanz nicht geladen.</li>';
    const vg250EnglishSummary = vg250Active
      ? ` German municipality boundaries © GeoBasis-DE / BKG (${vg250Year}) dl-de/by-2-0, Datenquellen: ${BKG_VG250_DATENQUELLEN_URL} (modified).`
      : '';
    const styleHosts = Array.from(
      new Set(
        [hostOf(config.osmStyleUrl), hostOf(config.osmDarkStyleUrl)].filter(
          (h): h is string => h !== null,
        ),
      ),
    );
    const usesOpenFreeMap = styleHosts.includes('tiles.openfreemap.org');
    const basemapLicenseHtml = usesOpenFreeMap
      ? `<li><strong>Straßenkarte (Vektorkacheln):</strong> <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> (MIT), Kachelschema &amp; Stile © <a href="https://openmaptiles.org/" target="_blank" rel="noopener noreferrer">OpenMapTiles</a> / © <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a> / OSM Liberty (<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a> / BSD-3-Clause / MIT), Kartendaten © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap-Mitwirkende (ODbL)</a>, Übersichts-Schummerung <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer">Natural Earth</a> (Public Domain), Kartenschriften Noto Sans (<a href="https://openfontlicense.org/" target="_blank" rel="noopener noreferrer">SIL OFL 1.1</a>).</li>`
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
        const vintageNote =
          provider.code === 'HH'
            ? ' [TIME=2026 LGV-OpenData-Befliegung]'
            : '';
        return `<li><strong>${escapeHtml(provider.name)}:</strong> ${escapeHtml(provider.attribution)} (${currentYear}), <a href="${escapeHtml(provider.licenseUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(provider.licenseId)}</a>${vintageNote}</li>`;
      }).join('\n             ');
      orthoLicenseHtml = `<li><strong>Luftbilder (DOP20 / DOP10, Daten verändert – Kachel-Reprojektion/Komposition an Landesgrenzen):</strong> Amtliche Open-Data-WMS-Dienste der Vermessungsverwaltungen der deutschen Bundesländer unter <a href="https://www.govdata.de/dl-de/by-2-0" target="_blank" rel="noopener noreferrer">dl-de/by-2-0</a>, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a> sowie <a href="https://www.govdata.de/dl-de/zero-2-0" target="_blank" rel="noopener noreferrer">dl-de/zero-2-0</a>:
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
      reply,
      200,
      'Open-Source-Lizenzen & Geodaten-Quellen',
      `<h1>Open-Source-Lizenzen &amp; Geodaten-Quellen</h1>
       <h2>1. Software-Lizenzen (Unseal)</h2>
       <ul>
         <li><strong>Backend-API &amp; Repository-Wurzel (<code>apps/api</code>):</strong> Lizenziert unter der <strong>GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)</strong> (Copyright © 2026 Unseal Contributors). Gemäß § 13 AGPLv3 steht der vollständige korrespondierende Quellcode kostenlos unter <a href="${escapeHtml(config.sourceCodeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(config.sourceCodeUrl)}</a> bereit (Details zur Split-Lizenzierung in <code>LICENSING.md</code>).</li>
         <li><strong>Client-App &amp; gemeinsame Schemas (<code>apps/mobile</code>, <code>packages/shared</code>):</strong> Lizenziert unter der <strong>Mozilla Public License 2.0 (MPL-2.0)</strong> (Copyright © 2026 Unseal Contributors).</li>
         <li><strong>Wesentliche Drittanbieter-Bibliotheken &amp; Laufzeitkomponenten:</strong> Expo, React &amp; React Native (MIT), MapLibre GL JS (BSD-3-Clause), MapLibre React Native (MIT), MapLibre Native Android/iOS (BSD-2-Clause), Fastify &amp; Plugins (MIT), PostgreSQL (PostgreSQL License) &amp; PostGIS (GPL-2.0-or-later), sharp (Apache-2.0) / libvips (LGPL-3.0-or-later), Turf.js (MIT), @node-rs/argon2 (MIT), exifr (MIT), pg (MIT), Zod (MIT), Nodemailer (MIT-0), Pino (MIT), Node.js (MIT), Caddy (Apache-2.0).</li>
         <li><strong>Vollständige Paketlizenzen &amp; Copyright-Hinweise:</strong> Alle npm-Abhängigkeiten, wiedergegebenen Lizenztexte, nativen Mobile-SDKs und Docker-Komponenten sind in <a href="${escapeHtml(noticesHref)}"><code>THIRD_PARTY_NOTICES.txt</code></a> (sowie im Quellcode-Repository) vollständig dokumentiert.</li>
       </ul>
       <h2>2. Geodaten- &amp; Kartenquellen</h2>
       <ul>
         ${basemapLicenseHtml}
         <li><strong>Adresssuche (Geocodierung):</strong> OpenStreetMap Nominatim, Daten © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap-Mitwirkende (ODbL)</a>.</li>
         ${vg250LicenseHtml}
         ${orthoLicenseHtml}
       </ul>
       <h2>3. Nutzerbeiträge &amp; Offene Daten</h2>
       <ul>
         <li><strong>Zusammengestellter GeoJSON-Datensatz (<code>/api/v1/polygons/export.geojson</code>):</strong> <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener noreferrer">Open Data Commons Open Database License 1.0 (ODbL 1.0)</a> (inklusive der oben genannten Karten-, Luftbild- und VG250-Quellenvermerke); Mitwirkende verzichten auf eigene Urheber- und Datenbankrechte an eingezeichneten Geometrien, Belagsangaben und Notizen gemäß <a href="https://creativecommons.org/publicdomain/zero/1.0/deed.de" target="_blank" rel="noopener noreferrer">CC0 1.0 Universal</a>.</li>
         <li><strong>Vor-Ort-Fotos &amp; Kommentare:</strong> <a href="https://creativecommons.org/licenses/by/4.0/deed.de" target="_blank" rel="noopener noreferrer">CC BY 4.0 International</a> (Namensnennung des Pseudonyms; Fotos serverseitig EXIF-bereinigt &amp; als WebP skaliert; Details in den <a href="${escapeHtml(config.termsUrl)}">Nutzungsbedingungen</a>).</li>
       </ul>
       <p class="en-sub"><strong>English summary:</strong> Unseal API is licensed under AGPL-3.0-or-later (Corresponding Source available at <a href="${escapeHtml(config.sourceCodeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(config.sourceCodeUrl)}</a>); the mobile/web client and shared schemas are licensed under MPL-2.0 (Copyright © 2026 Unseal Contributors). Complete third-party notices and license texts are available at <a href="${escapeHtml(noticesHref)}">THIRD_PARTY_NOTICES.txt</a>. ${usesOpenFreeMap ? 'Vector basemap via OpenFreeMap (MIT), © OpenMapTiles (CC BY 4.0 / BSD-3-Clause), © OpenStreetMap contributors (ODbL), Natural Earth (Public Domain), and Noto Sans (SIL OFL 1.1).' : 'Basemap tiles are loaded from the configured style host.'} Geocoding © OpenStreetMap contributors (ODbL).${vg250EnglishSummary} ${orthoEnglishSummary} Compiled polygon exports are licensed under ODbL 1.0 (with contributor CC0 1.0 rights waiver); site photos and comments under CC BY 4.0.</p>
       ${buildLegalNavHtml(app)}`,
      { wide: true },
    );
  });

  app.get('/auth/privacy', async (_request, reply) => {
    return sendHostedHtml(
      reply,
      200,
      'Datenschutzerklärung',
      buildPrivacyPolicyHtml(app),
      { wide: true },
    );
  });

  app.get(
    '/auth/verify-email',
    { config: { rateLimit: pageLimit } },
    async (request, reply) => {
      const token = readStringField(request.query, 'token').trim();
      const check = await inspectEmailActionToken(
        app.pool,
        token,
        'verify_email',
      );

      if (!check.valid || !check.pseudonym) {
        return sendHostedHtml(
          reply,
          400,
          'Link ungültig oder abgelaufen',
          `<div class="alert-err">Dieser Bestätigungslink ist ungültig, abgelaufen oder wurde bereits verwendet.</div>
           <h1>E-Mail-Bestätigung fehlgeschlagen</h1>
           <p>Bitte öffne die Unseal-App und fordere im Anmeldedialog einen neuen Bestätigungslink an.</p>
           <p class="en-sub"><strong>English:</strong> This confirmation link is invalid, expired, or has already been used. Please request a fresh confirmation link from the sign-in screen in the app.</p>`,
        );
      }

      return sendHostedHtml(
        reply,
        200,
        'E-Mail-Adresse bestätigen',
        `<h1>E-Mail-Adresse bestätigen</h1>
         <p>Hallo <strong>${escapeHtml(check.pseudonym)}</strong>! Klicke auf den Button unten, um dein Konto endgültig freizuschalten.</p>
         <form method="POST" action="/auth/verify-email">
           <input type="hidden" name="token" value="${escapeHtml(token)}" />
           <button type="submit">E-Mail-Adresse jetzt bestätigen</button>
         </form>
         <p class="en-sub"><strong>English:</strong> Click the button above to activate account <strong>${escapeHtml(check.pseudonym)}</strong>.</p>`,
      );
    },
  );

  app.post(
    '/auth/verify-email',
    { config: { rateLimit: pageLimit } },
    async (request, reply) => {
      const token = readStringField(request.body, 'token').trim();
      try {
        const verified = await consumeVerifyEmailToken(
          app.pool,
          token,
          request.log,
        );
        return sendHostedHtml(
          reply,
          200,
          'E-Mail bestätigt',
          `<div class="alert-ok">✓ E-Mail-Adresse erfolgreich bestätigt!</div>
           <h1>Willkommen, ${escapeHtml(verified.pseudonym)}!</h1>
           <p>Dein Konto ist jetzt aktiv. Du kannst dieses Browserfenster schließen und dich in der <strong>Unseal</strong>-App anmelden.</p>
           <p class="en-sub"><strong>English:</strong> Your email address is confirmed! You can now close this tab and sign in to the Unseal app.</p>`,
        );
      } catch (err: unknown) {
        const status = err instanceof ApiError ? err.statusCode : 400;
        return sendHostedHtml(
          reply,
          status >= 400 && status < 500 ? status : 400,
          'Bestätigung nicht möglich',
          `<div class="alert-err">Dieser Bestätigungslink ist ungültig oder bereits eingelöst.</div>
           <h1>E-Mail-Bestätigung fehlgeschlagen</h1>
           <p>Falls du dein Konto bereits bestätigt hast, kannst du dich direkt in der App anmelden. Andernfalls fordere dort bitte einen neuen Link an.</p>
           <p class="en-sub"><strong>English:</strong> This confirmation link is invalid or was already used. If already confirmed, sign in directly inside the app.</p>`,
        );
      }
    },
  );

  app.get(
    '/auth/reset-password',
    { config: { rateLimit: pageLimit } },
    async (request, reply) => {
      const token = readStringField(request.query, 'token').trim();
      const check = await inspectEmailActionToken(
        app.pool,
        token,
        'reset_password',
      );

      if (!check.valid || !check.pseudonym) {
        return sendHostedHtml(
          reply,
          400,
          'Link ungültig oder abgelaufen',
          `<div class="alert-err">Dieser Wiederherstellungslink ist ungültig, abgelaufen oder wurde bereits verwendet.</div>
           <h1>Passwort-Zurücksetzung nicht möglich</h1>
           <p>Bitte fordere in der Unseal-App unter <em>Passwort vergessen?</em> einen neuen Link an.</p>
           <p class="en-sub"><strong>English:</strong> This password reset link is invalid, expired, or has already been used. Please request a new reset link inside the app.</p>`,
        );
      }

      return sendHostedHtml(
        reply,
        200,
        'Neues Passwort festlegen',
        `<h1>Neues Passwort festlegen</h1>
         <p>Vergib ein neues Passwort für dein Konto <strong>${escapeHtml(check.pseudonym)}</strong> (mindestens ${AUTH_LIMITS.MIN_PASSWORD_LENGTH} Zeichen).</p>
         <form method="POST" action="/auth/reset-password">
           <input type="hidden" name="token" value="${escapeHtml(token)}" />
           <label for="newPassword">Neues Passwort / New password</label>
           <input id="newPassword" name="newPassword" type="password" minlength="${AUTH_LIMITS.MIN_PASSWORD_LENGTH}" maxlength="${AUTH_LIMITS.MAX_PASSWORD_LENGTH}" autocomplete="new-password" required />
           <label for="confirmPassword">Passwort wiederholen / Confirm password</label>
           <input id="confirmPassword" name="confirmPassword" type="password" minlength="${AUTH_LIMITS.MIN_PASSWORD_LENGTH}" maxlength="${AUTH_LIMITS.MAX_PASSWORD_LENGTH}" autocomplete="new-password" required />
           <button type="submit">Passwort speichern</button>
         </form>
         <p class="en-sub"><strong>English:</strong> Enter and confirm a new password (at least ${AUTH_LIMITS.MIN_PASSWORD_LENGTH} characters) for <strong>${escapeHtml(check.pseudonym)}</strong>.</p>`,
      );
    },
  );

  app.post(
    '/auth/reset-password',
    { config: { rateLimit: pageLimit } },
    async (request, reply) => {
      const token = readStringField(request.body, 'token').trim();
      const newPassword = readStringField(request.body, 'newPassword');
      const confirmPassword = readStringField(request.body, 'confirmPassword');

      if (newPassword !== confirmPassword) {
        return sendHostedHtml(
          reply,
          422,
          'Passwörter stimmen nicht überein',
          `<div class="alert-err">Die eingegebenen Passwörter stimmen nicht überein.</div>
           <h1>Neues Passwort festlegen</h1>
           <form method="POST" action="/auth/reset-password">
             <input type="hidden" name="token" value="${escapeHtml(token)}" />
             <label for="newPassword">Neues Passwort / New password</label>
             <input id="newPassword" name="newPassword" type="password" minlength="${AUTH_LIMITS.MIN_PASSWORD_LENGTH}" maxlength="${AUTH_LIMITS.MAX_PASSWORD_LENGTH}" autocomplete="new-password" required />
             <label for="confirmPassword">Passwort wiederholen / Confirm password</label>
             <input id="confirmPassword" name="confirmPassword" type="password" minlength="${AUTH_LIMITS.MIN_PASSWORD_LENGTH}" maxlength="${AUTH_LIMITS.MAX_PASSWORD_LENGTH}" autocomplete="new-password" required />
             <button type="submit">Passwort speichern</button>
           </form>
           <p class="en-sub"><strong>English:</strong> Passwords did not match. Please try again.</p>`,
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
          reply,
          200,
          'Passwort gespeichert',
          `<div class="alert-ok">✓ Dein Passwort wurde erfolgreich geändert!</div>
           <h1>Passwort aktualisiert</h1>
           <p>Alle bisherigen Sitzungen wurden aus Sicherheitsgründen abgemeldet. Du kannst dich jetzt mit deinem neuen Passwort in der <strong>Unseal</strong>-App anmelden.</p>
           <p class="en-sub"><strong>English:</strong> Your password has been updated and prior sessions were signed out. You can now sign in to the app with your new password.</p>`,
        );
      } catch (err: unknown) {
        if (err instanceof ZodError) {
          return sendHostedHtml(
            reply,
            422,
            'Passwort zu kurz oder ungültig',
            `<div class="alert-err">Das Passwort muss zwischen ${AUTH_LIMITS.MIN_PASSWORD_LENGTH} und ${AUTH_LIMITS.MAX_PASSWORD_LENGTH} Zeichen lang sein.</div>
             <h1>Neues Passwort festlegen</h1>
             <form method="POST" action="/auth/reset-password">
               <input type="hidden" name="token" value="${escapeHtml(token)}" />
               <label for="newPassword">Neues Passwort / New password</label>
               <input id="newPassword" name="newPassword" type="password" minlength="${AUTH_LIMITS.MIN_PASSWORD_LENGTH}" maxlength="${AUTH_LIMITS.MAX_PASSWORD_LENGTH}" autocomplete="new-password" required />
               <label for="confirmPassword">Passwort wiederholen / Confirm password</label>
               <input id="confirmPassword" name="confirmPassword" type="password" minlength="${AUTH_LIMITS.MIN_PASSWORD_LENGTH}" maxlength="${AUTH_LIMITS.MAX_PASSWORD_LENGTH}" autocomplete="new-password" required />
               <button type="submit">Passwort speichern</button>
             </form>
             <p class="en-sub"><strong>English:</strong> Password must be between ${AUTH_LIMITS.MIN_PASSWORD_LENGTH} and ${AUTH_LIMITS.MAX_PASSWORD_LENGTH} characters.</p>`,
          );
        }
        const message =
          err instanceof ApiError && err.code === 'AUTH_TOKEN_INVALID'
            ? 'Dieser Wiederherstellungslink ist ungültig oder abgelaufen.'
            : `Das Passwort muss zwischen ${AUTH_LIMITS.MIN_PASSWORD_LENGTH} und ${AUTH_LIMITS.MAX_PASSWORD_LENGTH} Zeichen lang sein.`;
        return sendHostedHtml(
          reply,
          400,
          'Passwort konnte nicht gespeichert werden',
          `<div class="alert-err">${escapeHtml(message)}</div>
           <h1>Zurücksetzung fehlgeschlagen</h1>
           <p>Bitte prüfe die Eingabe oder fordere in der App einen neuen Wiederherstellungslink an.</p>
           <p class="en-sub"><strong>English:</strong> Password reset could not be completed. Please request a fresh recovery link inside the app if this link has expired.</p>`,
        );
      }
    },
  );
}
