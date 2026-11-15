import {
  ApiError,
  CreateBugReportRequestSchema,
  CreateBugReportResponseSchema,
} from '@entsiegelung/shared';

import { optionalAuth } from '../auth/session.js';
import { normalizeRateLimitIp } from '../util/rateLimit.js';

import type { FastifyInstance } from 'fastify';

export function registerBugReportRoutes(app: FastifyInstance): void {
  const bugReportRateLimit = app.rateLimitOverrides.bugReport ?? {
    max: 5,
    timeWindow: '15 minutes',
  };

  app.post(
    '/api/v1/bug-reports',
    {
      preHandler: optionalAuth,
      config: {
        rateLimit: {
          max: bugReportRateLimit.max,
          timeWindow: bugReportRateLimit.timeWindow,
          keyGenerator: (request) => normalizeRateLimitIp(request.ip),
        },
      },
    },
    async (request, reply) => {
      const parsed = CreateBugReportRequestSchema.parse(request.body);
      const authUser = request.auth?.user ?? null;

      try {
        await app.mailer.sendBugReportEmail({
          to: app.config.bugReportEmail,
          description: parsed.description,
          contactEmail: parsed.contactEmail ?? null,
          reporterPseudonym: authUser?.pseudonym ?? null,
          reporterUserId: authUser?.id ?? null,
          platform: parsed.platform ?? null,
          pageUrl: parsed.pageUrl ?? null,
          submittedAtIso: new Date().toISOString(),
        });
      } catch (err: unknown) {
        request.log.error({ err }, 'Failed to deliver bug report email');
        throw new ApiError(
          503,
          'SERVICE_UNAVAILABLE',
          'Bug report email delivery is temporarily unavailable. Please try again later.',
        );
      }

      const response = CreateBugReportResponseSchema.parse({ status: 'sent' });
      return reply.status(201).send(response);
    },
  );
}
