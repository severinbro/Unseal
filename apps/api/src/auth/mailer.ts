// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 OpenUnseal Contributors

import nodemailer from 'nodemailer';

import { DEFAULT_APP_NAME } from '@openunseal/shared';

import { deriveServerBrandColors } from '../util/brandingTheme.js';

import type { EnvConfig } from '../config.js';
import type { FastifyBaseLogger } from 'fastify';

export interface EmailBrandingOptions {
  appName?: string;
  accentColor?: string | null;
}

function resolveEmailBranding(branding?: EmailBrandingOptions): {
  appName: string;
  safeAppName: string;
  accentLight: string;
  buttonLight: string;
  inkOnAccentLight: string;
} {
  const appName = branding?.appName?.trim() || DEFAULT_APP_NAME;
  const colors = deriveServerBrandColors(branding?.accentColor ?? null, null);
  return {
    appName,
    safeAppName: escapeHtml(appName),
    accentLight: colors.accentLight,
    buttonLight: colors.buttonLight,
    inkOnAccentLight: colors.inkOnAccentLight,
  };
}

export interface AuthEmailPayload {
  to: string;
  pseudonym: string;
  /**
   * `account_exists` is sent instead of a confirmation link when someone tries to
   * register with an address that already has an account, so the registration
   * response never reveals whether an address is registered (GDPR Art. 32).
   * Its `actionUrl` is the public app URL, never a token link.
   */
  purpose: 'verify_email' | 'reverify_login' | 'reset_password' | 'account_exists';
  actionUrl: string;
}

export interface BugReportEmailPayload {
  to: string;
  description: string;
  contactEmail: string | null;
  reporterPseudonym: string | null;
  reporterUserId: string | null;
  platform: string | null;
  pageUrl: string | null;
  submittedAtIso: string;
}

export interface ContentReportEmailPayload {
  to: string;
  reportId: string;
  targetType: 'polygon' | 'photo' | 'comment';
  targetId: string;
  reason: string;
  explanation: string;
  reporterName: string | null;
  reporterEmail: string | null;
  reporterPseudonym: string | null;
  reporterUserId: string | null;
  pageUrl: string | null;
  submittedAtIso: string;
}

export interface ContentReportReceiptEmailPayload {
  to: string;
  reportId: string;
  targetType: 'polygon' | 'photo' | 'comment';
  targetId: string;
  reason: string;
  submittedAtIso: string;
  contactEmail: string;
  impressumUrl: string;
}

export type ModerationActionKind =
  | 'polygon_deleted'
  | 'photo_deleted'
  | 'comment_deleted'
  | 'note_redacted'
  | 'account_banned';

export interface ModerationReasonEmailPayload {
  to: string;
  pseudonym: string;
  action: ModerationActionKind;
  targetId: string | null;
  reason: string;
  automatedMeansUsed: boolean;
  contactEmail: string | null;
  termsUrl: string;
  impressumUrl: string;
  actedAtIso: string;
}

export interface AuthMailer {
  sendActionEmail(payload: AuthEmailPayload): Promise<void>;
  sendBugReportEmail(payload: BugReportEmailPayload): Promise<void>;
  sendContentReportEmail(payload: ContentReportEmailPayload): Promise<void>;
  sendContentReportReceiptEmail(
    payload: ContentReportReceiptEmailPayload,
  ): Promise<void>;
  sendModerationReasonEmail(payload: ModerationReasonEmailPayload): Promise<void>;
}

export interface MemoryMailer extends AuthMailer {
  readonly outbox: AuthEmailPayload[];
  readonly bugReports: BugReportEmailPayload[];
  readonly contentReports: ContentReportEmailPayload[];
  readonly contentReportReceipts: ContentReportReceiptEmailPayload[];
  readonly moderationReasons: ModerationReasonEmailPayload[];
  clear(): void;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderAuthEmailMessage(
  payload: AuthEmailPayload,
  branding?: EmailBrandingOptions,
): {
  subject: string;
  text: string;
  html: string;
} {
  const { appName, safeAppName, accentLight, buttonLight, inkOnAccentLight } =
    resolveEmailBranding(branding);
  const safeName = escapeHtml(payload.pseudonym);
  const safeUrl = escapeHtml(payload.actionUrl);

  if (payload.purpose === 'account_exists') {
    const subject = `${appName} – Registrierungsversuch mit deiner E-Mail-Adresse / Registration attempt`;
    const text = [
      `Hallo ${payload.pseudonym},`,
      '',
      `gerade wurde versucht, mit deiner E-Mail-Adresse ein neues ${appName}-Konto zu registrieren. Für diese Adresse besteht bereits dein Konto.`,
      'Falls du das warst: Melde dich einfach an. Wenn du dein Passwort nicht mehr weißt, nutze in der App „Passwort vergessen?“.',
      payload.actionUrl,
      '',
      'Falls du das nicht warst, musst du nichts tun – es wurde kein neues Konto angelegt.',
      '',
      '---',
      `Hello ${payload.pseudonym},`,
      '',
      `Someone just tried to register a new ${appName} account with your email address, which already has an account.`,
      'If this was you, simply sign in, or use "Forgot password?" in the app. If not, no action is needed – no account was created.',
      payload.actionUrl,
    ].join('\n');

    const html = `<!doctype html>
<html lang="de">
<body style="font-family: system-ui, -apple-system, sans-serif; background:#f5f6f3; padding:24px; color:#18221d;">
  <div style="max-width:540px; margin:0 auto; background:#ffffff; border:1px solid #d5ddd7; border-radius:14px; padding:28px;">
    <h2 style="margin:0 0 12px; color:${accentLight};">${safeAppName}</h2>
    <p style="margin:0 0 14px;">Hallo <strong>${safeName}</strong>,</p>
    <p style="margin:0 0 14px; line-height:1.5;">
      gerade wurde versucht, mit deiner E-Mail-Adresse ein neues Konto zu registrieren. Für diese Adresse besteht bereits dein Konto.
    </p>
    <p style="margin:0 0 20px; line-height:1.5;">
      Falls du das warst, melde dich einfach an oder nutze in der App <em>Passwort vergessen?</em>. Falls nicht, musst du nichts tun – es wurde kein neues Konto angelegt.
    </p>
    <p style="margin:0 0 22px;">
      <a href="${safeUrl}" style="display:inline-block; background:${buttonLight}; color:${inkOnAccentLight}; text-decoration:none; font-weight:700; padding:12px 20px; border-radius:999px;">
        ${safeAppName} öffnen
      </a>
    </p>
    <hr style="border:none; border-top:1px solid #e3e8e4; margin:18px 0;" />
    <p style="font-size:13px; color:#526159; margin:0; line-height:1.45;">
      <strong>English:</strong> Someone tried to register with your email address, which already belongs to account <strong>${safeName}</strong>. If this was you, sign in or use "Forgot password?". Otherwise no action is needed.
    </p>
  </div>
</body>
</html>`;

    return { subject, text, html };
  }

  if (payload.purpose === 'verify_email') {
    const subject = `${appName} – Bitte bestätige deine E-Mail-Adresse / Confirm your email`;
    const text = [
      `Hallo ${payload.pseudonym},`,
      '',
      `bitte bestätige deine E-Mail-Adresse für ${appName} über folgenden Link (gültig für 24 Stunden):`,
      payload.actionUrl,
      '',
      'Falls du kein Konto erstellt hast, kannst du diese E-Mail einfach ignorieren.',
      '',
      '---',
      `Hello ${payload.pseudonym},`,
      '',
      `Please confirm your email address for ${appName} using the link below (valid for 24 hours):`,
      payload.actionUrl,
    ].join('\n');

    const html = `<!doctype html>
<html lang="de">
<body style="font-family: system-ui, -apple-system, sans-serif; background:#f5f6f3; padding:24px; color:#18221d;">
  <div style="max-width:540px; margin:0 auto; background:#ffffff; border:1px solid #d5ddd7; border-radius:14px; padding:28px;">
    <h2 style="margin:0 0 12px; color:${accentLight};">${safeAppName}</h2>
    <p style="margin:0 0 14px;">Hallo <strong>${safeName}</strong>,</p>
    <p style="margin:0 0 20px; line-height:1.5;">
      bitte bestätige deine E-Mail-Adresse, um dein Konto zu aktivieren (Link gültig für 24 Stunden):
    </p>
    <p style="margin:0 0 22px;">
      <a href="${safeUrl}" style="display:inline-block; background:${buttonLight}; color:${inkOnAccentLight}; text-decoration:none; font-weight:700; padding:12px 20px; border-radius:999px;">
        E-Mail-Adresse bestätigen
      </a>
    </p>
    <p style="font-size:13px; color:#526159; word-break:break-all; margin:0 0 18px;">
      Direktlink: <a href="${safeUrl}" style="color:${buttonLight};">${safeUrl}</a>
    </p>
    <hr style="border:none; border-top:1px solid #e3e8e4; margin:18px 0;" />
    <p style="font-size:13px; color:#526159; margin:0; line-height:1.45;">
      <strong>English:</strong> Please click the button or link above to confirm your email address for account <strong>${safeName}</strong>. If you did not request this, you can safely ignore this email.
    </p>
  </div>
</body>
</html>`;

    return { subject, text, html };
  }

  if (payload.purpose === 'reverify_login') {
    const subject = `${appName} – Konto nach Fehlversuchen bestätigen / Re-verify your account`;
    const text = [
      `Hallo ${payload.pseudonym},`,
      '',
      `nach 5 fehlgeschlagenen Anmeldeversuchen wurde die Anmeldung für dein ${appName}-Konto vorübergehend gesperrt.`,
      'Bitte bestätige deine E-Mail-Adresse über folgenden Link, um dein Konto wieder freizuschalten (gültig für 24 Stunden):',
      payload.actionUrl,
      '',
      'Falls du dein Passwort nicht mehr weißt, kannst du in der App „Passwort vergessen?“ nutzen.',
      '',
      '---',
      `Hello ${payload.pseudonym},`,
      '',
      `After 5 failed sign-in attempts, sign-in for your ${appName} account has been temporarily blocked.`,
      'Please confirm your email address using the link below to unlock your account (valid for 24 hours):',
      payload.actionUrl,
      '',
      'If you forgot your password, you can also use "Forgot password?" in the app.',
    ].join('\n');

    const html = `<!doctype html>
<html lang="de">
<body style="font-family: system-ui, -apple-system, sans-serif; background:#f5f6f3; padding:24px; color:#18221d;">
  <div style="max-width:540px; margin:0 auto; background:#ffffff; border:1px solid #d5ddd7; border-radius:14px; padding:28px;">
    <h2 style="margin:0 0 12px; color:${accentLight};">${safeAppName}</h2>
    <p style="margin:0 0 14px;">Hallo <strong>${safeName}</strong>,</p>
    <p style="margin:0 0 14px; line-height:1.5;">
      nach 5 fehlgeschlagenen Anmeldeversuchen wurde die Anmeldung für dein Konto vorübergehend gesperrt.
    </p>
    <p style="margin:0 0 20px; line-height:1.5;">
      Bitte bestätige deine E-Mail-Adresse, um dein Konto wieder freizuschalten (Link gültig für 24 Stunden):
    </p>
    <p style="margin:0 0 22px;">
      <a href="${safeUrl}" style="display:inline-block; background:${buttonLight}; color:${inkOnAccentLight}; text-decoration:none; font-weight:700; padding:12px 20px; border-radius:999px;">
        Konto wieder freischalten
      </a>
    </p>
    <p style="font-size:13px; color:#526159; word-break:break-all; margin:0 0 18px;">
      Direktlink: <a href="${safeUrl}" style="color:${buttonLight};">${safeUrl}</a>
    </p>
    <hr style="border:none; border-top:1px solid #e3e8e4; margin:18px 0;" />
    <p style="font-size:13px; color:#526159; margin:0; line-height:1.45;">
      <strong>English:</strong> After 5 failed sign-in attempts, account <strong>${safeName}</strong> has been temporarily blocked. Click the link above to re-verify your email address and unlock sign-in, or use "Forgot password?" in the app.
    </p>
  </div>
</body>
</html>`;

    return { subject, text, html };
  }

  const subject = `${appName} – Passwort zurücksetzen / Password reset`;
  const text = [
    `Hallo ${payload.pseudonym},`,
    '',
    'du hast das Zurücksetzen deines Passworts angefordert. Öffne folgenden Link, um ein neues Passwort festzulegen (gültig für 60 Minuten):',
    payload.actionUrl,
    '',
    'Falls du diese Anfrage nicht gestellt hast, bleibt dein bisheriges Passwort unverändert.',
    '',
    '---',
    `Hello ${payload.pseudonym},`,
    '',
    `Open the link below to set a new password for your ${appName} account (valid for 60 minutes):`,
    payload.actionUrl,
  ].join('\n');

  const html = `<!doctype html>
<html lang="de">
<body style="font-family: system-ui, -apple-system, sans-serif; background:#f5f6f3; padding:24px; color:#18221d;">
  <div style="max-width:540px; margin:0 auto; background:#ffffff; border:1px solid #d5ddd7; border-radius:14px; padding:28px;">
    <h2 style="margin:0 0 12px; color:${accentLight};">${safeAppName}</h2>
    <p style="margin:0 0 14px;">Hallo <strong>${safeName}</strong>,</p>
    <p style="margin:0 0 20px; line-height:1.5;">
      über den folgenden Link kannst du ein neues Passwort für dein Konto vergeben (gültig für 60 Minuten):
    </p>
    <p style="margin:0 0 22px;">
      <a href="${safeUrl}" style="display:inline-block; background:${buttonLight}; color:${inkOnAccentLight}; text-decoration:none; font-weight:700; padding:12px 20px; border-radius:999px;">
        Neues Passwort festlegen
      </a>
    </p>
    <p style="font-size:13px; color:#526159; word-break:break-all; margin:0 0 18px;">
      Direktlink: <a href="${safeUrl}" style="color:${buttonLight};">${safeUrl}</a>
    </p>
    <hr style="border:none; border-top:1px solid #e3e8e4; margin:18px 0;" />
    <p style="font-size:13px; color:#526159; margin:0; line-height:1.45;">
      <strong>English:</strong> Use the button above to reset the password for <strong>${safeName}</strong>. If you did not request a reset, your password remains unchanged.
    </p>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

export function renderBugReportEmailMessage(
  payload: BugReportEmailPayload,
  branding?: EmailBrandingOptions,
): {
  subject: string;
  text: string;
  html: string;
} {
  const { appName, safeAppName, accentLight } = resolveEmailBranding(branding);
  const reporterDisplay = payload.reporterPseudonym
    ? `@${payload.reporterPseudonym}`
    : 'Anonym / Anonymous';
  const subjectSummary = payload.description
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  const subject = `${appName} Bug-Meldung (${reporterDisplay}): ${subjectSummary}`;

  const lines = [
    `Neue Fehlermeldung über ${appName} / New ${appName} bug report`,
    '',
    `Zeitpunkt / Submitted: ${payload.submittedAtIso}`,
    `Meldende Person / Reporter: ${reporterDisplay}${payload.reporterUserId ? ` (${payload.reporterUserId})` : ''}`,
    `Kontakt-E-Mail / Contact email: ${payload.contactEmail ?? 'nicht angegeben'}`,
    `Plattform / Platform: ${payload.platform ?? 'unbekannt'}`,
    ...(payload.pageUrl ? [`Seite / URL: ${payload.pageUrl}`] : []),
    '',
    'Beschreibung / Description:',
    '---------------------------',
    payload.description,
  ];
  const text = lines.join('\n');

  const safeReporter = escapeHtml(reporterDisplay);
  const safeContact = escapeHtml(payload.contactEmail ?? 'nicht angegeben');
  const safePlatform = escapeHtml(payload.platform ?? 'unbekannt');
  const safeUrl = payload.pageUrl ? escapeHtml(payload.pageUrl) : null;
  const safeSubmitted = escapeHtml(payload.submittedAtIso);
  const safeDescription = escapeHtml(payload.description);

  const html = `<!doctype html>
<html lang="de">
<body style="font-family: system-ui, -apple-system, sans-serif; background:#f5f6f3; padding:24px; color:#18221d;">
  <div style="max-width:600px; margin:0 auto; background:#ffffff; border:1px solid #d5ddd7; border-radius:14px; padding:28px;">
    <h2 style="margin:0 0 12px; color:${accentLight};">${safeAppName} – Fehlermeldung</h2>
    <table style="width:100%; border-collapse:collapse; font-size:13px; color:#42524a; margin-bottom:18px;">
      <tr><td style="padding:4px 8px 4px 0; font-weight:700;">Zeitpunkt:</td><td style="padding:4px 0;">${safeSubmitted}</td></tr>
      <tr><td style="padding:4px 8px 4px 0; font-weight:700;">Konto:</td><td style="padding:4px 0;">${safeReporter}</td></tr>
      <tr><td style="padding:4px 8px 4px 0; font-weight:700;">Kontakt-E-Mail:</td><td style="padding:4px 0;">${safeContact}</td></tr>
      <tr><td style="padding:4px 8px 4px 0; font-weight:700;">Plattform:</td><td style="padding:4px 0;">${safePlatform}</td></tr>
      ${safeUrl ? `<tr><td style="padding:4px 8px 4px 0; font-weight:700;">URL:</td><td style="padding:4px 0; word-break:break-all;">${safeUrl}</td></tr>` : ''}
    </table>
    <div style="background:#f5f6f3; border:1px solid #d5ddd7; border-radius:10px; padding:14px; white-space:pre-wrap; font-size:14px; line-height:1.5; color:#18221d;">${safeDescription}</div>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

const MODERATION_ACTION_LABELS: Readonly<
  Record<ModerationActionKind, { de: string; en: string }>
> = {
  polygon_deleted: {
    de: 'Entfernung eines Flächenvorschlags',
    en: 'Removal of a surface proposal',
  },
  photo_deleted: {
    de: 'Entfernung eines hochgeladenen Fotos',
    en: 'Removal of an uploaded site photo',
  },
  comment_deleted: {
    de: 'Entfernung eines Kommentars',
    en: 'Removal of a comment',
  },
  note_redacted: {
    de: 'Entfernung/Schwärzung einer Flächennotiz',
    en: 'Redaction of a proposal note',
  },
  account_banned: {
    de: 'Sperrung und Löschung eines Benutzerkontos',
    en: 'Account suspension and deletion',
  },
};

export function renderContentReportEmailMessage(
  payload: ContentReportEmailPayload,
  branding?: EmailBrandingOptions,
): {
  subject: string;
  text: string;
  html: string;
} {
  const { appName, safeAppName } = resolveEmailBranding(branding);
  const subject = `${appName} DSA-Meldung [${payload.targetType}] #${payload.reportId.slice(0, 8)} (${payload.reason})`;
  const reporterAccount = payload.reporterPseudonym
    ? `@${payload.reporterPseudonym}${payload.reporterUserId ? ` (${payload.reporterUserId})` : ''}`
    : 'Nicht angemeldet / Guest';

  const text = [
    'Neue Meldung mutmaßlich rechtswidriger Inhalte (Art. 16 DSA) / New DSA Art. 16 Notice',
    '',
    `Meldungs-ID / Report ID: ${payload.reportId}`,
    `Zeitpunkt / Submitted: ${payload.submittedAtIso}`,
    `Betroffener Inhalt / Target: ${payload.targetType} (${payload.targetId})`,
    `Meldegrund / Reason: ${payload.reason}`,
    `Konto / Account: ${reporterAccount}`,
    `Name / Reporter name: ${payload.reporterName ?? 'nicht angegeben'}`,
    `Kontakt-E-Mail / Reporter email: ${payload.reporterEmail ?? 'nicht angegeben'}`,
    ...(payload.pageUrl ? [`URL: ${payload.pageUrl}`] : []),
    'Erklärung nach Treu und Glauben (Art. 16 Abs. 2 lit. d DSA): Bestätigt / Confirmed',
    '',
    'Begründung / Explanation:',
    '-------------------------',
    payload.explanation,
  ].join('\n');

  const safeId = escapeHtml(payload.reportId);
  const safeTarget = escapeHtml(`${payload.targetType} (${payload.targetId})`);
  const safeReason = escapeHtml(payload.reason);
  const safeAccount = escapeHtml(reporterAccount);
  const safeName = escapeHtml(payload.reporterName ?? 'nicht angegeben');
  const safeEmail = escapeHtml(payload.reporterEmail ?? 'nicht angegeben');
  const safeUrl = payload.pageUrl ? escapeHtml(payload.pageUrl) : null;
  const safeSubmitted = escapeHtml(payload.submittedAtIso);
  const safeExplanation = escapeHtml(payload.explanation);

  const html = `<!doctype html>
<html lang="de">
<body style="font-family: system-ui, -apple-system, sans-serif; background:#f5f6f3; padding:24px; color:#18221d;">
  <div style="max-width:600px; margin:0 auto; background:#ffffff; border:1px solid #d5ddd7; border-radius:14px; padding:28px;">
    <h2 style="margin:0 0 12px; color:#962d20;">${safeAppName} – Meldung nach Art. 16 DSA</h2>
    <table style="width:100%; border-collapse:collapse; font-size:13px; color:#42524a; margin-bottom:18px;">
      <tr><td style="padding:4px 8px 4px 0; font-weight:700;">Meldungs-ID:</td><td style="padding:4px 0;"><code>${safeId}</code></td></tr>
      <tr><td style="padding:4px 8px 4px 0; font-weight:700;">Zeitpunkt:</td><td style="padding:4px 0;">${safeSubmitted}</td></tr>
      <tr><td style="padding:4px 8px 4px 0; font-weight:700;">Inhalt:</td><td style="padding:4px 0;"><code>${safeTarget}</code></td></tr>
      <tr><td style="padding:4px 8px 4px 0; font-weight:700;">Grund:</td><td style="padding:4px 0;">${safeReason}</td></tr>
      <tr><td style="padding:4px 8px 4px 0; font-weight:700;">Konto:</td><td style="padding:4px 0;">${safeAccount}</td></tr>
      <tr><td style="padding:4px 8px 4px 0; font-weight:700;">Name:</td><td style="padding:4px 0;">${safeName}</td></tr>
      <tr><td style="padding:4px 8px 4px 0; font-weight:700;">E-Mail:</td><td style="padding:4px 0;">${safeEmail}</td></tr>
      ${safeUrl ? `<tr><td style="padding:4px 8px 4px 0; font-weight:700;">URL:</td><td style="padding:4px 0; word-break:break-all;">${safeUrl}</td></tr>` : ''}
      <tr><td style="padding:4px 8px 4px 0; font-weight:700;">Treu &amp; Glauben:</td><td style="padding:4px 0;">Bestätigt (Art. 16 Abs. 2 lit. d DSA)</td></tr>
    </table>
    <div style="background:#f5f6f3; border:1px solid #d5ddd7; border-radius:10px; padding:14px; white-space:pre-wrap; font-size:14px; line-height:1.5; color:#18221d;">${safeExplanation}</div>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

export function renderContentReportReceiptEmailMessage(
  payload: ContentReportReceiptEmailPayload,
  branding?: EmailBrandingOptions,
): {
  subject: string;
  text: string;
  html: string;
} {
  const { appName, safeAppName, accentLight } = resolveEmailBranding(branding);
  const subject = `${appName} – Eingangsbestätigung deiner Meldung #${payload.reportId.slice(0, 8)} / Notice receipt`;
  const text = [
    'Eingangsbestätigung gemäß Art. 16 Abs. 4 Digital Services Act (DSA)',
    '',
    `Wir haben deine Meldung erhalten (Referenz: ${payload.reportId}).`,
    `Betroffener Inhalt: ${payload.targetType} (${payload.targetId})`,
    `Angegebener Grund: ${payload.reason}`,
    `Eingegangen am: ${payload.submittedAtIso}`,
    '',
    'Wir prüfen den gemeldeten Inhalt zeitnah und informieren dich anschließend über unsere Entscheidung.',
    `Rückfragen: ${payload.contactEmail}`,
    `Impressum: ${payload.impressumUrl}`,
    '',
    '---',
    'Acknowledgement of receipt pursuant to Art. 16(4) EU Digital Services Act (DSA)',
    '',
    `We have received your notice (Reference: ${payload.reportId}) regarding ${payload.targetType} (${payload.targetId}, reason: ${payload.reason}).`,
    `We will review the reported content promptly and notify you of our decision. Contact: ${payload.contactEmail}`,
  ].join('\n');

  const safeId = escapeHtml(payload.reportId);
  const safeTarget = escapeHtml(`${payload.targetType} (${payload.targetId})`);
  const safeReason = escapeHtml(payload.reason);
  const safeContact = escapeHtml(payload.contactEmail);
  const safeImpressum = escapeHtml(payload.impressumUrl);

  const html = `<!doctype html>
<html lang="de">
<body style="font-family: system-ui, -apple-system, sans-serif; background:#f5f6f3; padding:24px; color:#18221d;">
  <div style="max-width:560px; margin:0 auto; background:#ffffff; border:1px solid #d5ddd7; border-radius:14px; padding:28px;">
    <h2 style="margin:0 0 12px; color:${accentLight};">${safeAppName} – Eingangsbestätigung (Art. 16 Abs. 4 DSA)</h2>
    <p style="margin:0 0 14px; line-height:1.5;">Wir haben deine Meldung erhalten und prüfen den gemeldeten Inhalt zeitnah.</p>
    <p style="margin:0 0 14px; font-size:13px; color:#42524a; line-height:1.5;">
      <strong>Referenz:</strong> <code>${safeId}</code><br />
      <strong>Inhalt:</strong> <code>${safeTarget}</code><br />
      <strong>Grund:</strong> ${safeReason}
    </p>
    <p style="margin:0 0 16px; font-size:13px; color:#42524a; line-height:1.5;">
      Nach Abschluss der Prüfung erhältst du eine Rückmeldung zu unserer Entscheidung. Bei Rückfragen erreichst du uns unter <strong>${safeContact}</strong> (<a href="${safeImpressum}" style="color:${accentLight};">Impressum</a>).
    </p>
    <hr style="border:none; border-top:1px solid #e3e8e4; margin:18px 0;" />
    <p style="font-size:13px; color:#526159; margin:0; line-height:1.45;">
      <strong>English:</strong> We have received your DSA Art. 16 notice (ref. <code>${safeId}</code>) for <code>${safeTarget}</code> and will review it promptly. Contact: ${safeContact}.
    </p>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

export function renderModerationReasonEmailMessage(
  payload: ModerationReasonEmailPayload,
  branding?: EmailBrandingOptions,
): {
  subject: string;
  text: string;
  html: string;
} {
  const { appName, safeAppName, accentLight } = resolveEmailBranding(branding);
  const actionLabel = MODERATION_ACTION_LABELS[payload.action];
  const subject = `${appName} – Moderationshinweis & Begründung (Art. 17 DSA) / Moderation notice`;
  const contactLineDe = payload.contactEmail
    ? `Wenn du diese Entscheidung überprüfen lassen möchtest oder Rückfragen hast, wende dich bitte an ${payload.contactEmail}.`
    : `Wenn du diese Entscheidung überprüfen lassen möchtest oder Rückfragen hast, nutze bitte die im Impressum (${payload.impressumUrl}) angegebene Kontaktstelle.`;
  const contactLineEn = payload.contactEmail
    ? `If you believe this action was taken in error or wish to request a review, please contact ${payload.contactEmail}.`
    : `If you believe this action was taken in error or wish to request a review, please use the contact listed at ${payload.impressumUrl}.`;

  const text = [
    `Hallo ${payload.pseudonym},`,
    '',
    'hiermit informieren wir dich gemäß Art. 17 Digital Services Act (DSA) über eine Moderationsmaßnahme:',
    '',
    `Maßnahme: ${actionLabel.de}`,
    ...(payload.targetId ? [`Betroffene ID: ${payload.targetId}`] : []),
    `Zeitpunkt: ${payload.actedAtIso}`,
    `Begründung / Verstoß: ${payload.reason}`,
    `Einsatz automatisierter Verfahren: ${payload.automatedMeansUsed ? 'Ja' : 'Nein (manuelle Prüfung durch Moderation)'}`,
    `Nutzungsbedingungen: ${payload.termsUrl}`,
    '',
    contactLineDe,
    'Unabhängig davon stehen dir die gesetzlichen Rechtsbehelfe (einschließlich gerichtlicher Klärung) offen.',
    '',
    '---',
    `Hello ${payload.pseudonym},`,
    '',
    'Statement of reasons pursuant to Art. 17 EU Digital Services Act (DSA):',
    `Action taken: ${actionLabel.en}`,
    ...(payload.targetId ? [`Affected ID: ${payload.targetId}`] : []),
    `Timestamp: ${payload.actedAtIso}`,
    `Reason: ${payload.reason}`,
    `Automated decision-making used: ${payload.automatedMeansUsed ? 'Yes' : 'No (manual moderation review)'}`,
    `Terms of use: ${payload.termsUrl}`,
    '',
    contactLineEn,
    'You also remain entitled to pursue judicial redress under applicable law.',
  ].join('\n');

  const safeName = escapeHtml(payload.pseudonym);
  const safeActionDe = escapeHtml(actionLabel.de);
  const safeActionEn = escapeHtml(actionLabel.en);
  const safeTargetId = payload.targetId ? escapeHtml(payload.targetId) : null;
  const safeReason = escapeHtml(payload.reason);
  const safeActedAt = escapeHtml(payload.actedAtIso);
  const safeTerms = escapeHtml(payload.termsUrl);
  const safeContactDe = escapeHtml(contactLineDe);
  const safeContactEn = escapeHtml(contactLineEn);

  const html = `<!doctype html>
<html lang="de">
<body style="font-family: system-ui, -apple-system, sans-serif; background:#f5f6f3; padding:24px; color:#18221d;">
  <div style="max-width:580px; margin:0 auto; background:#ffffff; border:1px solid #d5ddd7; border-radius:14px; padding:28px;">
    <h2 style="margin:0 0 12px; color:${accentLight};">${safeAppName} – Begründung gemäß Art. 17 DSA</h2>
    <p style="margin:0 0 14px;">Hallo <strong>${safeName}</strong>,</p>
    <p style="margin:0 0 14px; line-height:1.5;">wir informieren dich über folgende Moderationsmaßnahme auf dieser ${safeAppName}-Instanz:</p>
    <table style="width:100%; border-collapse:collapse; font-size:13px; color:#42524a; margin-bottom:16px;">
      <tr><td style="padding:4px 8px 4px 0; font-weight:700;">Maßnahme:</td><td style="padding:4px 0;">${safeActionDe}</td></tr>
      ${safeTargetId ? `<tr><td style="padding:4px 8px 4px 0; font-weight:700;">Betroffene ID:</td><td style="padding:4px 0;"><code>${safeTargetId}</code></td></tr>` : ''}
      <tr><td style="padding:4px 8px 4px 0; font-weight:700;">Zeitpunkt:</td><td style="padding:4px 0;">${safeActedAt}</td></tr>
      <tr><td style="padding:4px 8px 4px 0; font-weight:700;">Begründung:</td><td style="padding:4px 0;">${safeReason}</td></tr>
      <tr><td style="padding:4px 8px 4px 0; font-weight:700;">Automatisierung:</td><td style="padding:4px 0;">${payload.automatedMeansUsed ? 'Ja' : 'Nein (manuelle Prüfung)'}</td></tr>
    </table>
    <p style="margin:0 0 14px; font-size:13px; line-height:1.5; color:#42524a;">
      ${safeContactDe} Grundlage sind unsere <a href="${safeTerms}" style="color:${accentLight};">Nutzungsbedingungen</a>. Gesetzliche Rechtsbehelfe (einschließlich gerichtlicher Überprüfung) bleiben unberührt.
    </p>
    <hr style="border:none; border-top:1px solid #e3e8e4; margin:18px 0;" />
    <p style="font-size:13px; color:#526159; margin:0; line-height:1.45;">
      <strong>English (Art. 17 DSA):</strong> ${safeActionEn}${safeTargetId ? ` (<code>${safeTargetId}</code>)` : ''}. Reason: ${safeReason}. Automated means: ${payload.automatedMeansUsed ? 'Yes' : 'No'}. ${safeContactEn}
    </p>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

export function createMemoryMailer(): MemoryMailer {
  const outbox: AuthEmailPayload[] = [];
  const bugReports: BugReportEmailPayload[] = [];
  const contentReports: ContentReportEmailPayload[] = [];
  const contentReportReceipts: ContentReportReceiptEmailPayload[] = [];
  const moderationReasons: ModerationReasonEmailPayload[] = [];
  return {
    outbox,
    bugReports,
    contentReports,
    contentReportReceipts,
    moderationReasons,
    async sendActionEmail(payload: AuthEmailPayload): Promise<void> {
      outbox.push(payload);
    },
    async sendBugReportEmail(payload: BugReportEmailPayload): Promise<void> {
      bugReports.push(payload);
    },
    async sendContentReportEmail(
      payload: ContentReportEmailPayload,
    ): Promise<void> {
      contentReports.push(payload);
    },
    async sendContentReportReceiptEmail(
      payload: ContentReportReceiptEmailPayload,
    ): Promise<void> {
      contentReportReceipts.push(payload);
    },
    async sendModerationReasonEmail(
      payload: ModerationReasonEmailPayload,
    ): Promise<void> {
      moderationReasons.push(payload);
    },
    clear(): void {
      outbox.length = 0;
      bugReports.length = 0;
      contentReports.length = 0;
      contentReportReceipts.length = 0;
      moderationReasons.length = 0;
    },
  };
}

export function createSmtpMailer(
  config: EnvConfig,
  logger: FastifyBaseLogger,
): AuthMailer {
  if (!config.smtp.host) {
    return {
      async sendActionEmail(payload: AuthEmailPayload): Promise<void> {
        if (!config.smtp.logFallbackContent) {
          logger.warn(
            { purpose: payload.purpose },
            'SMTP_HOST not configured; transactional email dropped',
          );
          return;
        }
        logger.info(
          {
            purpose: payload.purpose,
            pseudonym: payload.pseudonym,
            actionUrl: payload.actionUrl,
          },
          'SMTP_HOST not configured; logging transactional auth link for local development',
        );
      },
      async sendBugReportEmail(payload: BugReportEmailPayload): Promise<void> {
        if (!config.smtp.logFallbackContent) {
          logger.warn('SMTP_HOST not configured; bug report email dropped');
          return;
        }
        logger.info(
          {
            to: payload.to,
            reporterPseudonym: payload.reporterPseudonym,
            contactEmail: payload.contactEmail,
            platform: payload.platform,
            description: payload.description,
          },
          'SMTP_HOST not configured; logging bug report email for local development',
        );
      },
      async sendContentReportEmail(
        payload: ContentReportEmailPayload,
      ): Promise<void> {
        if (!config.smtp.logFallbackContent) {
          logger.warn(
            { reportId: payload.reportId },
            'SMTP_HOST not configured; DSA content report email dropped',
          );
          return;
        }
        logger.info(
          {
            to: payload.to,
            reportId: payload.reportId,
            targetType: payload.targetType,
            targetId: payload.targetId,
            reason: payload.reason,
          },
          'SMTP_HOST not configured; logging DSA content report for local development',
        );
      },
      async sendContentReportReceiptEmail(
        payload: ContentReportReceiptEmailPayload,
      ): Promise<void> {
        if (!config.smtp.logFallbackContent) {
          logger.warn(
            { reportId: payload.reportId },
            'SMTP_HOST not configured; DSA content report receipt dropped',
          );
          return;
        }
        logger.info(
          {
            reportId: payload.reportId,
            targetType: payload.targetType,
            targetId: payload.targetId,
          },
          'SMTP_HOST not configured; logging DSA receipt confirmation for local development',
        );
      },
      async sendModerationReasonEmail(
        payload: ModerationReasonEmailPayload,
      ): Promise<void> {
        if (!config.smtp.logFallbackContent) {
          logger.warn(
            { action: payload.action },
            'SMTP_HOST not configured; DSA Art. 17 moderation notice dropped',
          );
          return;
        }
        logger.info(
          {
            pseudonym: payload.pseudonym,
            action: payload.action,
            targetId: payload.targetId,
            reason: payload.reason,
          },
          'SMTP_HOST not configured; logging DSA Art. 17 moderation notice for local development',
        );
      },
    };
  }

  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    requireTLS: config.smtp.requireTls,
    ...(config.smtp.user && config.smtp.pass
      ? {
          auth: {
            user: config.smtp.user,
            pass: config.smtp.pass,
          },
        }
      : {}),
  });

  const emailBranding: EmailBrandingOptions = {
    appName: config.branding.appName,
    accentColor: config.branding.accentColor,
  };

  return {
    async sendActionEmail(payload: AuthEmailPayload): Promise<void> {
      const rendered = renderAuthEmailMessage(payload, emailBranding);
      await transporter.sendMail({
        from: config.smtp.from,
        to: payload.to,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      });
    },
    async sendBugReportEmail(payload: BugReportEmailPayload): Promise<void> {
      const rendered = renderBugReportEmailMessage(payload, emailBranding);
      await transporter.sendMail({
        from: config.smtp.from,
        to: payload.to,
        ...(payload.contactEmail ? { replyTo: payload.contactEmail } : {}),
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      });
    },
    async sendContentReportEmail(
      payload: ContentReportEmailPayload,
    ): Promise<void> {
      const rendered = renderContentReportEmailMessage(payload, emailBranding);
      await transporter.sendMail({
        from: config.smtp.from,
        to: payload.to,
        ...(payload.reporterEmail ? { replyTo: payload.reporterEmail } : {}),
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      });
    },
    async sendContentReportReceiptEmail(
      payload: ContentReportReceiptEmailPayload,
    ): Promise<void> {
      const rendered = renderContentReportReceiptEmailMessage(
        payload,
        emailBranding,
      );
      await transporter.sendMail({
        from: config.smtp.from,
        to: payload.to,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      });
    },
    async sendModerationReasonEmail(
      payload: ModerationReasonEmailPayload,
    ): Promise<void> {
      const rendered = renderModerationReasonEmailMessage(
        payload,
        emailBranding,
      );
      await transporter.sendMail({
        from: config.smtp.from,
        to: payload.to,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      });
    },
  };
}
