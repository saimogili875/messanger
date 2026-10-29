// src/modules/chat/chat.routes.ts
// REST API endpoints for user chat listing, direct conversation creation, and message history retrieval.

import { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate } from "../../plugins/authenticate";
import { chatService, getVisibleMessages } from "./chat.service";
import { getRealtimeManager } from "../../realtime/socket";

const chatIdParamSchema = z.object({
  chatId: z.string().uuid("Invalid chat ID"),
});

const getMessagesQuerySchema = z.object({
  afterSeq: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const createDirectChatSchema = z.object({
  recipientId: z.string().uuid("Invalid recipient user ID"),
});

export const chatRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // GET /chats - List all chats the authenticated user belongs to
  app.get(
    "/chats",
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const result = await chatService.listMyChats(request.user.sub);
      return reply.status(200).send(result);
    }
  );

  // POST /chats/direct - Create or retrieve existing direct 1-to-1 chat
  app.post(
    "/chats/direct",
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { recipientId } = createDirectChatSchema.parse(request.body);
      const result = await chatService.createOrGetDirectChat(request.user.sub, recipientId);

      const realtime = getRealtimeManager();
      if (realtime) {
        realtime.joinChatRoom(request.user.sub, result.id);
        realtime.joinChatRoom(recipientId, result.id);
        realtime.emitToUser(recipientId, "chat:added", { chatId: result.id });
      }

      return reply.status(200).send(result);
    }
  );

  // GET /chats/:chatId/messages - Retrieve message history respecting firstVisibleSeq
  app.get(
    "/chats/:chatId/messages",
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { chatId } = chatIdParamSchema.parse(request.params);
      const { afterSeq, limit } = getMessagesQuerySchema.parse(request.query);
      const messages = await getVisibleMessages(chatId, request.user.sub, afterSeq, limit);
      return reply.status(200).send(messages);
    }
  );
};

