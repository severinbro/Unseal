import nodemailer from 'nodemailer';

import type { EnvConfig } from '../config.js';
import type { FastifyBaseLogger } from 'fastify';

export interface AuthEmailPayload {
  to: string;
  pseudonym: string;
  purpose: 'verify_email' | 'reset_password';
  actionUrl: string;
}

export interface AuthMailer {
  sendActionEmail(payload: AuthEmailPayload): Promise<void>;
}

export interface MemoryMailer extends AuthMailer {
  readonly outbox: AuthEmailPayload[];
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

export function renderAuthEmailMessage(payload: AuthEmailPayload): {
  subject: string;
  text: string;
  html: string;
} {
  const safeName = escapeHtml(payload.pseudonym);
  const safeUrl = escapeHtml(payload.actionUrl);

  if (payload.purpose === 'verify_email') {
    const subject =
      'Unseal – Bitte bestätige deine E-Mail-Adresse / Confirm your email';
    const text = [
      `Hallo ${payload.pseudonym},`,
      '',
      'bitte bestätige deine E-Mail-Adresse für Unseal über folgenden Link (gültig für 24 Stunden):',
      payload.actionUrl,
      '',
      'Falls du kein Konto erstellt hast, kannst du diese E-Mail einfach ignorieren.',
      '',
      '---',
      `Hello ${payload.pseudonym},`,
      '',
      'Please confirm your email address for Unseal using the link below (valid for 24 hours):',
      payload.actionUrl,
    ].join('\n');

    const html = `<!doctype html>
<html lang="de">
<body style="font-family: system-ui, -apple-system, sans-serif; background:#f5f6f3; padding:24px; color:#18221d;">
  <div style="max-width:540px; margin:0 auto; background:#ffffff; border:1px solid #d5ddd7; border-radius:14px; padding:28px;">
    <h2 style="margin:0 0 12px; color:#176642;">Unseal</h2>
    <p style="margin:0 0 14px;">Hallo <strong>${safeName}</strong>,</p>
    <p style="margin:0 0 20px; line-height:1.5;">
      bitte bestätige deine E-Mail-Adresse, um dein Konto zu aktivieren (Link gültig für 24 Stunden):
    </p>
    <p style="margin:0 0 22px;">
      <a href="${safeUrl}" style="display:inline-block; background:#1f6f4a; color:#ffffff; text-decoration:none; font-weight:700; padding:12px 20px; border-radius:999px;">
        E-Mail-Adresse bestätigen
      </a>
    </p>
    <p style="font-size:13px; color:#526159; word-break:break-all; margin:0 0 18px;">
      Direktlink: <a href="${safeUrl}" style="color:#1f6f4a;">${safeUrl}</a>
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

  const subject =
    'Unseal – Passwort zurücksetzen / Password reset';
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
    'Open the link below to set a new password for your Unseal account (valid for 60 minutes):',
    payload.actionUrl,
  ].join('\n');

  const html = `<!doctype html>
<html lang="de">
<body style="font-family: system-ui, -apple-system, sans-serif; background:#f5f6f3; padding:24px; color:#18221d;">
  <div style="max-width:540px; margin:0 auto; background:#ffffff; border:1px solid #d5ddd7; border-radius:14px; padding:28px;">
    <h2 style="margin:0 0 12px; color:#176642;">Unseal</h2>
    <p style="margin:0 0 14px;">Hallo <strong>${safeName}</strong>,</p>
    <p style="margin:0 0 20px; line-height:1.5;">
      über den folgenden Link kannst du ein neues Passwort für dein Konto vergeben (gültig für 60 Minuten):
    </p>
    <p style="margin:0 0 22px;">
      <a href="${safeUrl}" style="display:inline-block; background:#1f6f4a; color:#ffffff; text-decoration:none; font-weight:700; padding:12px 20px; border-radius:999px;">
        Neues Passwort festlegen
      </a>
    </p>
    <p style="font-size:13px; color:#526159; word-break:break-all; margin:0 0 18px;">
      Direktlink: <a href="${safeUrl}" style="color:#1f6f4a;">${safeUrl}</a>
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

export function createMemoryMailer(): MemoryMailer {
  const outbox: AuthEmailPayload[] = [];
  return {
    outbox,
    async sendActionEmail(payload: AuthEmailPayload): Promise<void> {
      outbox.push(payload);
    },
    clear(): void {
      outbox.length = 0;
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
        logger.info(
          {
            purpose: payload.purpose,
            pseudonym: payload.pseudonym,
            actionUrl: payload.actionUrl,
          },
          'SMTP_HOST not configured; logging transactional auth link for local development',
        );
      },
    };
  }

  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    ...(config.smtp.user && config.smtp.pass
      ? {
          auth: {
            user: config.smtp.user,
            pass: config.smtp.pass,
          },
        }
      : {}),
  });

  return {
    async sendActionEmail(payload: AuthEmailPayload): Promise<void> {
      const rendered = renderAuthEmailMessage(payload);
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
