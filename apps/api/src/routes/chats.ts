// Cognitive Runtime © 2026 by Donald Dominko
// Licensed under CC BY-NC-SA 4.0
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// apps/api/src/routes/chats.ts
// Fastify route plugin for chat session and message CRUD operations.
// Provides the foundational persistence layer: chats are containers for messages and runs.
// All operations go directly to Postgres via Drizzle; no queue involvement.
// Exports: chatRoutes (Fastify plugin)

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { eq, desc } from 'drizzle-orm';

const createChatSchema = z.object({
  title: z.string().min(1).optional().default('New Chat'),
});

const createMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().min(1),
});

/** Registers chat and message CRUD routes on the provided Fastify instance. */
export async function chatRoutes(fastify: FastifyInstance) {
  /** GET /chats — list all chats, newest first. */
  fastify.get('/chats', async () => {
    const allChats = await db.select().from(schema.chats).orderBy(desc(schema.chats.createdAt));
    return { chats: allChats };
  });

  /** POST /chats — create a new chat session with an optional title. Returns 201 + chat row. */
  fastify.post<{ Body: z.infer<typeof createChatSchema> }>('/chats', async (request, reply) => {
    const { title } = createChatSchema.parse(request.body);
    const [chat] = await db.insert(schema.chats).values({ title }).returning();
    return reply.code(201).send(chat);
  });

  /** GET /chats/:chatId/messages — list all messages for a chat in chronological order. */
  fastify.get<{ Params: { chatId: string } }>(
    '/chats/:chatId/messages',
    async (request) => {
      const { chatId } = request.params;
      const chatMessages = await db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.chatId, chatId))
        .orderBy(schema.messages.createdAt);
      return { messages: chatMessages };
    }
  );

  /** POST /chats/:chatId/messages — persist a single message. Returns 201 + message row. */
  fastify.post<{
    Params: { chatId: string };
    Body: z.infer<typeof createMessageSchema>;
  }>('/chats/:chatId/messages', async (request, reply) => {
    const { chatId } = request.params;
    const { role, content } = createMessageSchema.parse(request.body);
    const [message] = await db
      .insert(schema.messages)
      .values({ chatId, role, content })
      .returning();
    return reply.code(201).send(message);
  });
}
