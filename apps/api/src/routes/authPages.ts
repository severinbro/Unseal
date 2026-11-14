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

function sendHostedHtml(
  reply: FastifyReply,
  statusCode: number,
  title: string,
  bodyHtml: string,
): FastifyReply {
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
      max-width: 460px;
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
    p {
      margin: 0 0 16px;
      font-size: 15px;
      line-height: 1.55;
      color: #3a4940;
    }
    .en-sub {
      font-size: 13px;
      color: #5b6b61;
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
    li { margin-bottom: 6px; }
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

export function registerAuthPageRoutes(app: FastifyInstance): void {
  const pageLimit = app.rateLimitOverrides.recover ?? {
    max: 20,
    timeWindow: '15 minutes',
  };

  app.get('/auth/privacy', async (_request, reply) => {
    const contactLine = app.config.abuseContact
      ? `<p><strong>Verantwortlicher Kontakt / Datenschutz- &amp; Missbrauchsanfragen:</strong> ${escapeHtml(app.config.abuseContact)}</p>`
      : `<p><strong>Kontakt:</strong> Bitte wende dich bei Fragen zum Datenschutz an die im Impressum bzw. auf der Startseite genannte Betreiberstelle dieser Unseal-Instanz.</p>`;
    return sendHostedHtml(
      reply,
      200,
      'Datenschutzerklärung',
      `<h1>Datenschutzerklärung (DSGVO)</h1>
       <p>Unseal ist ein datensparsames Open-Source-Bürgerbeteiligungsprojekt (PPGIS) zur gemeinschaftlichen Kartierung versiegelter Flächen.</p>
       <ul>
         <li><strong>Konto, Pseudonym &amp; E-Mail (Art. 6 Abs. 1 lit. a/b DSGVO):</strong> Bei der Registrierung werden ein selbst gewähltes Pseudonym, deine E-Mail-Adresse (nur für Bestätigungs- und Wiederherstellungslinks) sowie der Zeitpunkt deiner Datenschutzzustimmung gespeichert. Deine E-Mail-Adresse wird <strong>niemals öffentlich</strong> auf der Karte, bei Fotos oder im GeoJSON-Export ausgegeben. Unbestätigte Registrierungen ohne gültigen Token werden nach 48 Stunden automatisch gelöscht.</li>
         <li><strong>Passwörter, Sitzungen &amp; lokaler Speicher (§ 25 Abs. 2 TDDDG):</strong> Passwörter werden ausschließlich als Argon2id-Hash gespeichert. Nach der Anmeldung wird ein zufälliges Sitzungs-Token technisch notwendig im Gerätespeicher (Web: <code>localStorage</code>, Mobil-App: geschützter Systemspeicher) abgelegt und serverseitig nur als SHA-256-Hash für maximal ${app.config.sessionTtlDays} Tage vorgehalten.</li>
         <li><strong>Fotos &amp; EXIF-Schutz (Art. 6 Abs. 1 lit. a/e/f DSGVO):</strong> Hochgeladene Fotos werden serverseitig in WebP umgewandelt; sämtliche EXIF-/XMP-/IPTC-Metadaten (Gerätekennungen, Roh-GPS-Koordinaten, Aufnahmezeitstempel) werden vor der Speicherung vollständig entfernt. Es wird lediglich ein Wahrheitswert (<em>GPS verified</em>) gespeichert, sofern die Aufnahme innerhalb der kartierten Fläche (inkl. ${PHOTO_LIMITS.GPS_VERIFY_DISTANCE_M} m Toleranzpuffer) erfolgte. Bitte lade keine Aufnahmen hoch, auf denen Personen oder Kfz-Kennzeichen erkennbar sind.</li>
         <li><strong>Kartendienste &amp; IP-Minimierung (Art. 6 Abs. 1 lit. f DSGVO):</strong> Der Unseal-Server speichert keine Zugriffs-IP-Protokolle und kürzt IPv6-Adressen für das Missbrauchs-Ratelimiting im Arbeitsspeicher auf <code>/64</code>. Zum Laden der Straßenkarte ruft dein Endgerät Vektorkacheln direkt von <em>OpenFreeMap</em> (Daten: © OpenStreetMap-Mitwirkende) ab, wobei technisch bedingt deine IP-Adresse an den Kachelserver übermittelt wird. DOP20-Luftbilder der Bundesländer werden hingegen datenschutzfreundlich über diesen Unseal-Server abgerufen.</li>
         <li><strong>Kontolöschung &amp; Betroffenenrechte (Art. 15-21, 77 DSGVO):</strong> Du kannst dein Konto samt E-Mail-Adresse, Sitzungen und Abstimmungen jederzeit selbst unter <em>Konto -> Konto löschen</em> vollständig entfernen; bestehende Flächenvorschläge, Diskussionskommentare und EXIF-bereinigte Fotos bleiben anonymisiert unter <code>deleted</code> erhalten (oder können zuvor gelöscht werden). Bei Kontosperrungen wegen Missbrauchs wird lediglich ein nicht umkehrbarer SHA-256-Sperrwert gespeichert (Art. 6 Abs. 1 lit. f DSGVO). Dir stehen Auskunfts-, Berichtigungs-, Löschungs-, Einschränkungs- und Widerspruchsrechte sowie das Beschwerderecht bei einer Datenschutz-Aufsichtsbehörde zu.</li>
       </ul>
       ${contactLine}
       <p class="en-sub"><strong>English summary:</strong> Your email address is stored solely for registration confirmation and password recovery (unconfirmed accounts are purged after 48h) and is never exposed publicly or in GeoJSON exports. Passwords use Argon2id; session tokens are stored locally for sign-in only (TTL: ${app.config.sessionTtlDays} days). Uploaded photos have 100% of EXIF/GPS metadata stripped server-side before WebP storage, keeping only a boolean <em>GPS verified</em> flag (checked inside the polygon with a ${PHOTO_LIMITS.GPS_VERIFY_DISTANCE_M} m buffer). Vector street tiles load from OpenFreeMap, whereas DOP20 orthophotos are proxied via this server. You can permanently delete your account at any time inside the app and exercise GDPR Art. 15-21 &amp; 77 rights.</p>`,
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
