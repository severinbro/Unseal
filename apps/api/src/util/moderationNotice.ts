// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 OpenUnseal Contributors

import type { ModerationActionKind } from '../auth/mailer.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';

const DEFAULT_MODERATION_REASON =
  'Verstoß gegen die Nutzungsbedingungen oder Meldung nach Art. 16 DSA / Violation of Terms of Use or DSA Art. 16 notice.';

export function extractOptionalModerationReason(
  request: FastifyRequest,
): string {
  const query =
    typeof request.query === 'object' && request.query !== null
      ? (request.query as { reason?: unknown })
      : null;
  if (typeof query?.reason === 'string' && query.reason.trim().length > 0) {
    return query.reason.trim().slice(0, 500);
  }
  const body =
    typeof request.body === 'object' && request.body !== null
      ? (request.body as { reason?: unknown })
      : null;
  if (typeof body?.reason === 'string' && body.reason.trim().length > 0) {
    return body.reason.trim().slice(0, 500);
  }
  return DEFAULT_MODERATION_REASON;
}

export async function notifyAuthorOfModerationActionBestEffort(
  app: FastifyInstance,
  request: FastifyRequest,
  params: {
    action: ModerationActionKind;
    targetId: string | null;
    authorEmail: string | null;
    authorPseudonym: string | null;
    reason?: string | undefined;
    automatedMeansUsed?: boolean | undefined;
  },
): Promise<void> {
  if (!params.authorEmail) {
    return;
  }
  try {
    await app.mailer.sendModerationReasonEmail({
      to: params.authorEmail,
      pseudonym: params.authorPseudonym ?? 'OpenUnseal-Nutzer/in',
      action: params.action,
      targetId: params.targetId,
      reason: params.reason?.trim() || DEFAULT_MODERATION_REASON,
      automatedMeansUsed: Boolean(params.automatedMeansUsed),
      contactEmail: app.config.abuseContact ?? app.config.operatorEmail,
      termsUrl: app.config.termsUrl,
      impressumUrl: app.config.impressumUrl,
      actedAtIso: new Date().toISOString(),
    });
  } catch (err: unknown) {
    request.log.warn(
      { err, action: params.action, targetId: params.targetId },
      'Failed to deliver DSA Art. 17 moderation reason email',
    );
  }
}
