// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 OpenUnseal Contributors

import crypto from 'node:crypto';

import {
  ApiError,
  CreateContentReportRequestSchema,
  CreateContentReportResponseSchema,
  type ContentReportTargetType,
} from '@openunseal/shared';

import { optionalAuth } from '../auth/session.js';
import { normalizeRateLimitIp } from '../util/rateLimit.js';

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

const EMAIL_EXTRACT_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function extractEmailAddress(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  const match = EMAIL_EXTRACT_RE.exec(raw.trim());
  return match ? match[0] : null;
}

async function targetExists(
  pool: pg.Pool,
  targetType: ContentReportTargetType,
  targetId: string,
): Promise<boolean> {
  if (targetType === 'polygon') {
    const res = await pool.query<{ id: string }>(
      'SELECT id FROM polygons WHERE id = $1 LIMIT 1',
      [targetId],
    );
    return (res.rowCount ?? 0) > 0;
  }
  if (targetType === 'photo') {
    const res = await pool.query<{ id: string }>(
      'SELECT id FROM polygon_photos WHERE id = $1 LIMIT 1',
      [targetId],
    );
    return (res.rowCount ?? 0) > 0;
  }
  const res = await pool.query<{ id: string }>(
    'SELECT id FROM polygon_comments WHERE id = $1 LIMIT 1',
    [targetId],
  );
  return (res.rowCount ?? 0) > 0;
}

export function registerContentReportRoutes(app: FastifyInstance): void {
  const reportRateLimit = app.rateLimitOverrides.contentReport ?? {
    max: 5,
    timeWindow: '15 minutes',
  };

  app.post(
    '/api/v1/content-reports',
    {
      preHandler: optionalAuth,
      config: {
        rateLimit: {
          max: reportRateLimit.max,
          timeWindow: reportRateLimit.timeWindow,
          keyGenerator: (request) => normalizeRateLimitIp(request.ip),
        },
      },
    },
    async (request, reply) => {
      const parsed = CreateContentReportRequestSchema.parse(request.body);
      const authUser = request.auth?.user ?? null;

      const recipientEmail =
        extractEmailAddress(app.config.abuseContact) ??
        extractEmailAddress(app.config.operatorEmail) ??
        extractEmailAddress(app.config.bugReportEmail);
      if (!recipientEmail) {
        throw new ApiError(
          503,
          'SERVICE_UNAVAILABLE',
          'Illegal-content reporting email delivery is not configured on this instance.',
        );
      }

      const exists = await targetExists(
        app.pool,
        parsed.targetType,
        parsed.targetId,
      );
      if (!exists) {
        throw new ApiError(
          404,
          'NOT_FOUND',
          'Reported content item was not found.',
        );
      }

      const reportId = crypto.randomUUID();
      const submittedAtIso = new Date().toISOString();

      try {
        await app.mailer.sendContentReportEmail({
          to: recipientEmail,
          reportId,
          targetType: parsed.targetType,
          targetId: parsed.targetId,
          reason: parsed.reason,
          explanation: parsed.explanation,
          reporterName: parsed.reporterName ?? null,
          reporterEmail: parsed.reporterEmail ?? null,
          reporterPseudonym: authUser?.pseudonym ?? null,
          reporterUserId: authUser?.id ?? null,
          pageUrl: parsed.pageUrl ?? null,
          submittedAtIso,
        });
      } catch (err: unknown) {
        request.log.error(
          { err, reportId },
          'Failed to deliver DSA Art. 16 content report email',
        );
        throw new ApiError(
          503,
          'SERVICE_UNAVAILABLE',
          'Content report delivery is temporarily unavailable. Please contact the operator directly via Impressum.',
        );
      }

      let receiptSent = false;
      if (parsed.reporterEmail) {
        try {
          await app.mailer.sendContentReportReceiptEmail({
            to: parsed.reporterEmail,
            reportId,
            targetType: parsed.targetType,
            targetId: parsed.targetId,
            reason: parsed.reason,
            submittedAtIso,
            contactEmail: recipientEmail,
            impressumUrl: app.config.impressumUrl,
          });
          receiptSent = true;
        } catch (err: unknown) {
          request.log.warn(
            { err, reportId },
            'Failed to deliver DSA Art. 16(4) receipt confirmation email',
          );
        }
      }

      const response = CreateContentReportResponseSchema.parse({
        status: 'received',
        reportId,
        receiptSent,
      });
      return reply.status(201).send(response);
    },
  );
}
