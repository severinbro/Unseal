// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 OpenUnseal Contributors

import {
  BlockChatThreadRequestSchema,
  ChatMessageSchema,
  ChatMessagesQuerySchema,
  ChatMessagesResponseSchema,
  ChatThreadListResponseSchema,
  ChatThreadSchema,
  ChatUnreadCountResponseSchema,
  CreateChatMessageRequestSchema,
  OpenDirectChatRequestSchema,
  UuidParamSchema,
} from '@openunseal/shared';

import { requireAuth, requireCurrentTerms } from '../auth/session.js';
import { ChatRepository } from '../chat/repository.js';

import type { FastifyInstance } from 'fastify';

export function registerChatRoutes(
  app: FastifyInstance,
  repository: ChatRepository = new ChatRepository(app.pool),
): void {
  const limits = app.rateLimitOverrides;
  const openLimit = limits.openChat ?? { max: 20, timeWindow: '1 minute' };
  const sendLimit = limits.sendChatMessage ?? { max: 30, timeWindow: '1 minute' };
  const changeLimit = limits.chatBlock ?? { max: 20, timeWindow: '1 minute' };
  const readLimit = limits.chatRead ?? { max: 120, timeWindow: '1 minute' };
  const noStore = { 'Cache-Control': 'no-store' };

  app.post(
    '/api/v1/chats/open',
    {
      config: { rateLimit: openLimit },
      preHandler: [requireAuth, requireCurrentTerms],
    },
    async (request, reply) => {
      const body = OpenDirectChatRequestSchema.parse(request.body);
      const { thread, created } = await repository.openThread(
        request.auth!.user.id,
        body,
      );
      return reply
        .status(created ? 201 : 200)
        .headers(noStore)
        .send(ChatThreadSchema.parse(thread));
    },
  );

  app.get(
    '/api/v1/chats',
    { config: { rateLimit: readLimit }, preHandler: requireAuth },
    async (request, reply) =>
      reply.headers(noStore).send(
        ChatThreadListResponseSchema.parse({
          threads: await repository.listThreads(request.auth!.user.id),
        }),
      ),
  );

  app.get(
    '/api/v1/chats/unread-count',
    { config: { rateLimit: readLimit }, preHandler: requireAuth },
    async (request, reply) =>
      reply.headers(noStore).send(
        ChatUnreadCountResponseSchema.parse({
          unreadCount: await repository.unreadCount(request.auth!.user.id),
        }),
      ),
  );

  app.get(
    '/api/v1/chats/:id/messages',
    { config: { rateLimit: readLimit }, preHandler: requireAuth },
    async (request, reply) => {
      const { id } = UuidParamSchema.parse(request.params);
      const query = ChatMessagesQuerySchema.parse(request.query ?? {});
      return reply
        .headers(noStore)
        .send(
          ChatMessagesResponseSchema.parse(
            await repository.listMessages(request.auth!.user.id, id, query),
          ),
        );
    },
  );

  app.post(
    '/api/v1/chats/:id/messages',
    {
      config: { rateLimit: sendLimit },
      preHandler: [requireAuth, requireCurrentTerms],
    },
    async (request, reply) => {
      const { id } = UuidParamSchema.parse(request.params);
      const body = CreateChatMessageRequestSchema.parse(request.body);
      const message = await repository.sendMessage(
        request.auth!.user.id,
        id,
        body,
      );
      return reply.status(201).headers(noStore).send(ChatMessageSchema.parse(message));
    },
  );

  app.patch(
    '/api/v1/chats/:id/block',
    { config: { rateLimit: changeLimit }, preHandler: requireAuth },
    async (request, reply) => {
      const { id } = UuidParamSchema.parse(request.params);
      const { blocked } = BlockChatThreadRequestSchema.parse(request.body);
      return reply
        .headers(noStore)
        .send(
          ChatThreadSchema.parse(
            await repository.setBlocked(request.auth!.user.id, id, blocked),
          ),
        );
    },
  );

  // Erasure must stay possible without accepting new terms.
  app.delete(
    '/api/v1/chats/:id/messages',
    { config: { rateLimit: changeLimit }, preHandler: requireAuth },
    async (request, reply) => {
      const { id } = UuidParamSchema.parse(request.params);
      await repository.deleteOwnMessages(request.auth!.user.id, id);
      return reply.status(204).send();
    },
  );

  app.delete(
    '/api/v1/chats/:id/messages/:messageId',
    { config: { rateLimit: changeLimit }, preHandler: requireAuth },
    async (request, reply) => {
      const { id } = UuidParamSchema.parse(request.params);
      const { id: messageId } = UuidParamSchema.parse(
        (request.params as { messageId?: unknown }).messageId,
      );
      await repository.deleteOwnMessages(request.auth!.user.id, id, messageId);
      return reply.status(204).send();
    },
  );
}
