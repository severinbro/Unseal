import { ZodError } from 'zod';

import { AUTH_LIMITS, ApiError, PHOTO_LIMITS } from '@entsiegelung/shared';

import {
  consumePasswordResetToken,
  consumeVerifyEmailToken,
  inspectEmailActionToken,
} from './auth.js';

import type { FastifyInstance, FastifyReply } from 'fastify';

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
      color-scheme: light;
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
       <h2>Verantwortliche Stelle / Betreiber</h2>
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
         <li><strong>Lizenz für Flächenvorschläge &amp; Notizen (CC0 1.0):</strong> Alle von dir eingezeichneten Polygon-Geometrien, Belagsangaben und Beschreibungstexte stellst du unter der Verzichtserklärung <a href="https://creativecommons.org/publicdomain/zero/1.0/deed.de" target="_blank" rel="noopener noreferrer"><strong>Creative Commons Zero 1.0 (CC0 1.0 Universal)</strong></a> gemeinfrei zur Verfügung, sodass Kommunen, Forschung und Öffentlichkeit den GeoJSON-Export frei weiterverwenden können.</li>
         <li><strong>Lizenz für Vor-Ort-Fotos &amp; Kommentare (CC BY 4.0):</strong> Hochgeladene Fotos und Diskussionskommentare lizenzierst du unter <a href="https://creativecommons.org/licenses/by/4.0/deed.de" target="_blank" rel="noopener noreferrer"><strong>Creative Commons Namensnennung 4.0 International (CC BY 4.0)</strong></a> mit Namensnennung deines öffentlichen Pseudonyms (bzw. anonymisiert als <code>deleted</code> nach Kontolöschung).</li>
         <li><strong>Zulässige Inhalte &amp; Fotorechte (§ 59 UrhG / § 22 KUG / DSGVO):</strong> Du darfst nur eigene Fotos hochladen, die von öffentlich zugänglichen Wegen oder Plätzen aus aufgenommen wurden (Panoramafreiheit) oder für die eine ausdrückliche Erlaubnis der Berechtigten vorliegt. Lade <strong>keine</strong> Aufnahmen hoch, auf denen erkennbare Personen, Gesichter, Kfz-Kennzeichen oder nicht öffentlich einsehbare Privatbereiche (z. B. über Zäune hinweg oder per Drohne) abgebildet sind.</li>
         <li><strong>Moderation &amp; Meldeverfahren (DSA):</strong> Rechtswidrige, beleidigende, irreführende oder Spam-Beiträge können entfernt und Konten gesperrt werden. ${abuseNote}</li>
       </ul>
       <p class="en-sub"><strong>English summary:</strong> Contributions are non-binding civic suggestions. By registering and contributing, you dedicate polygon geometries, surface classifications, and proposal notes under <strong>CC0 1.0 Universal</strong> (for public GeoJSON reuse), and license uploaded site photos and comments under <strong>CC BY 4.0</strong> attributed to your pseudonym. Only upload photos you created yourself from public vantage points without identifiable faces, license plates, or private non-public areas.</p>
       ${buildLegalNavHtml(app)}`,
      { wide: true },
    );
  });

  app.get('/auth/licenses', async (_request, reply) => {
    return sendHostedHtml(
      reply,
      200,
      'Open-Source-Lizenzen & Geodaten-Quellen',
      `<h1>Open-Source-Lizenzen &amp; Geodaten-Quellen</h1>
       <h2>1. Software-Lizenzen (Unseal)</h2>
       <ul>
         <li><strong>Backend-API (<code>apps/api</code>):</strong> Lizenziert unter der <strong>GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)</strong>. Gemäß § 13 AGPLv3 steht der vollständige korrespondierende Quellcode kostenlos unter <a href="${escapeHtml(app.config.sourceCodeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(app.config.sourceCodeUrl)}</a> bereit.</li>
         <li><strong>Client-App &amp; gemeinsame Schemas (<code>apps/mobile</code>, <code>packages/shared</code>):</strong> Lizenziert unter der <strong>Mozilla Public License 2.0 (MPL-2.0)</strong>.</li>
         <li><strong>Wesentliche Drittanbieter-Bibliotheken:</strong> Expo &amp; React Native (MIT), MapLibre GL JS &amp; MapLibre React Native (BSD-3-Clause), Fastify (MIT), PostgreSQL &amp; PostGIS (PostgreSQL License / GPL-2.0), sharp / libvips (Apache-2.0 / LGPL-3.0), Turf.js (MIT), @node-rs/argon2 (MIT/Apache-2.0), Zod (MIT), Nodemailer (MIT), Pino (MIT). Vollständige Paketlizenzen sind im Quellcode-Repository dokumentiert.</li>
       </ul>
       <h2>2. Geodaten- &amp; Kartenquellen</h2>
       <ul>
         <li><strong>Straßenkarte &amp; Adresssuche:</strong> Vektorkacheln über OpenFreeMap; Kartendaten und Nominatim-Geocodierung © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap-Mitwirkende (ODbL)</a>.</li>
         <li><strong>Verwaltungsgrenzen (VG250):</strong> © GeoBasis-DE / Bundesamt für Kartographie und Geodäsie (BKG), <a href="https://www.govdata.de/dl-de/by-2-0" target="_blank" rel="noopener noreferrer">Datenlizenz Deutschland – Namensnennung 2.0 (dl-de/by-2-0)</a>.</li>
         <li><strong>Luftbilder (DOP20 / DOP10):</strong> © GeoBasis-DE / Vermessungsverwaltungen der jeweiligen Bundesländer (bereitgestellt gemäß <code>dl-de/by-2-0</code> bzw. Landes-Open-Data-Lizenz).</li>
       </ul>
       <p class="en-sub"><strong>English summary:</strong> Unseal API is licensed under AGPL-3.0-or-later (Corresponding Source available at <a href="${escapeHtml(app.config.sourceCodeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(app.config.sourceCodeUrl)}</a>); the mobile/web client and shared schemas are licensed under MPL-2.0. Basemap and geocoding data © OpenStreetMap contributors (ODbL); German municipality boundaries © BKG and aerial orthophotos © German State Survey Offices (dl-de/by-2-0).</p>
       ${buildLegalNavHtml(app)}`,
      { wide: true },
    );
  });

  app.get('/auth/privacy', async (_request, reply) => {
    const controllerBlock = buildOperatorIdentityHtml(app);
    const contactLine = app.config.abuseContact
      ? `<p><strong>Verantwortlicher Kontakt / Datenschutz- &amp; Missbrauchsanfragen:</strong> ${escapeHtml(app.config.abuseContact)}</p>`
      : `<p><strong>Kontakt:</strong> Bitte wende dich bei Fragen zum Datenschutz an die oben bzw. im <a href="${escapeHtml(app.config.impressumUrl)}">Impressum</a> genannte verantwortliche Stelle.</p>`;
    return sendHostedHtml(
      reply,
      200,
      'Datenschutzerklärung',
      `<h1>Datenschutzerklärung (DSGVO)</h1>
       <p>Unseal ist ein datensparsames Open-Source-Bürgerbeteiligungsprojekt (PPGIS) zur gemeinschaftlichen Kartierung versiegelter Flächen.</p>
       <h2>Verantwortliche Stelle (Art. 13 Abs. 1 lit. a DSGVO)</h2>
       ${controllerBlock}
       ${contactLine}
       <h2>Verarbeitete Daten &amp; Rechtsgrundlagen</h2>
       <ul>
         <li><strong>Konto, Pseudonym, E-Mail &amp; Einwilligungen (Art. 6 Abs. 1 lit. a/b/f DSGVO):</strong> Bei der Registrierung werden dein gewähltes Pseudonym, deine E-Mail-Adresse (nur für Bestätigungs- und Wiederherstellungslinks, intern auch als kanonisierter Hash zur Missbrauchsabwehr) sowie die Zeitpunkte deiner Zustimmung zu Datenschutzerklärung und Nutzungsbedingungen gespeichert. Deine E-Mail-Adresse wird <strong>niemals öffentlich</strong> auf der Karte, bei Fotos oder im GeoJSON-Export ausgegeben. Zudem wird der Zeitpunkt deiner letzten Anmeldung (<code>last_login_at</code>) gespeichert und auf deinen Vorschlägen als Aktivitätshinweis öffentlich angezeigt. Unbestätigte Registrierungen werden nach 48 Stunden automatisch gelöscht.</li>
         <li><strong>Passwörter, Sitzungen &amp; lokaler Speicher (§ 25 Abs. 2 TDDDG):</strong> Passwörter werden ausschließlich als Argon2id-Hash gespeichert. Nach der Anmeldung wird ein zufälliges Sitzungs-Token technisch notwendig im Gerätespeicher (Web: <code>localStorage</code>, Mobil-App: geschützter Systemspeicher) abgelegt und serverseitig nur als SHA-256-Hash für maximal ${app.config.sessionTtlDays} Tage vorgehalten.</li>
         <li><strong>Fotos, Kamera &amp; EXIF-Schutz (Art. 6 Abs. 1 lit. a/e/f DSGVO):</strong> Hochgeladene Fotos werden serverseitig in WebP umgewandelt; sämtliche EXIF-/XMP-/IPTC-Metadaten (Gerätekennungen, Roh-GPS-Koordinaten, Aufnahmezeitstempel) werden vor der Speicherung vollständig entfernt. Es wird lediglich ein Wahrheitswert (<em>GPS verified</em>) gespeichert, sofern die Aufnahme innerhalb der kartierten Fläche (inkl. ${PHOTO_LIMITS.GPS_VERIFY_DISTANCE_M} m Toleranzpuffer) erfolgte. Bitte lade keine Aufnahmen hoch, auf denen Personen oder Kfz-Kennzeichen erkennbar sind.</li>
         <li><strong>Standortfunktion (GNSS) &amp; Geräteberechtigungen:</strong> Die optionale Standortzentrierung sowie Kamera-/Galeriezugriffe erfolgen ausschließlich nach deiner aktiven Freigabe; deine Live-GNSS-Position wird nicht an den Unseal-Server übertragen oder gespeichert.</li>
         <li><strong>Kartendienste, Adresssuche &amp; IP-Minimierung (Art. 6 Abs. 1 lit. f DSGVO):</strong> Der Unseal-Server speichert keine Zugriffs-IP-Protokolle und kürzt IPv6-Adressen für das Missbrauchs-Ratelimiting im Arbeitsspeicher auf <code>/64</code>. Zum Laden der Straßenkarte ruft dein Endgerät Vektorkacheln direkt von <em>OpenFreeMap</em> (Daten: © OpenStreetMap-Mitwirkende) ab, wobei technisch bedingt deine IP-Adresse an den Kachelserver übermittelt wird. DOP20-Luftbilder der Bundesländer sowie Adresssuchen (via OpenStreetMap Nominatim) werden hingegen über diesen Unseal-Server geleitet, sodass deine IP-Adresse nicht an die Landesvermessungsämter oder Nominatim weitergegeben wird.</li>
         <li><strong>Fehlermeldungen (Bug-Reports, Art. 6 Abs. 1 lit. a/f DSGVO):</strong> Wenn du über das Formular einen Fehler meldest, werden deine Beschreibung, eine optional angegebene Kontakt-E-Mail, Plattform, Seiten-URL, Zeitstempel sowie (falls angemeldet) dein Pseudonym und deine interne Konto-ID per E-Mail an die Betreiberstelle übermittelt.</li>
         <li><strong>Empfänger &amp; Auftragsverarbeiter (Art. 13 Abs. 1 lit. e DSGVO):</strong> Zur technischen Bereitstellung werden ein VPS-Hosting-Anbieter sowie ein ausgehender E-Mail-Dienst (SMTP) eingesetzt.</li>
         <li><strong>Kontolöschung &amp; Betroffenenrechte (Art. 15–21, 77 DSGVO):</strong> Du kannst dein Konto samt E-Mail-Adresse, Sitzungen und Abstimmungen jederzeit selbst unter <em>Konto -&gt; Konto löschen</em> vollständig entfernen; bestehende Flächenvorschläge, Diskussionskommentare und EXIF-bereinigte Fotos bleiben anonymisiert unter <code>deleted</code> erhalten (oder können zuvor gelöscht werden). Um Nachahmung zu verhindern, wird bei Selbstlöschung ein nicht umkehrbarer SHA-256-Hash deines Pseudonyms in <code>reserved_pseudonyms</code> gespeichert; bei Kontosperrungen wegen Missbrauchs zusätzlich ein SHA-256-Hash der E-Mail-Adresse (Art. 6 Abs. 1 lit. f DSGVO). Dir stehen Auskunfts-, Berichtigungs-, Löschungs-, Einschränkungs- und Widerspruchsrechte sowie das Beschwerderecht bei einer Datenschutz-Aufsichtsbehörde zu.</li>
       </ul>
       <p class="en-sub"><strong>English summary:</strong> Your email address is stored solely for registration confirmation and password recovery (unconfirmed accounts are purged after 48h) and is never exposed publicly or in GeoJSON exports; your last login timestamp is shown as an activity indicator on your proposals. Passwords use Argon2id; session tokens are stored locally for sign-in only (TTL: ${app.config.sessionTtlDays} days). Uploaded photos have 100% of EXIF/GPS metadata stripped server-side before WebP storage, keeping only a boolean <em>GPS verified</em> flag (checked inside the polygon with a ${PHOTO_LIMITS.GPS_VERIFY_DISTANCE_M} m buffer). Vector street tiles load from OpenFreeMap, whereas DOP20 orthophotos and Nominatim address lookups are proxied via this server. Bug reports transmit your message, optional contact email, platform/URL, and signed-in pseudonym to the instance operator. You can permanently delete your account at any time inside the app (retaining only a SHA-256 pseudonym tombstone to prevent impersonation) and exercise GDPR Art. 15–21 &amp; 77 rights.</p>
       ${buildLegalNavHtml(app)}`,
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
