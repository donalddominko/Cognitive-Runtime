// Cognitive Runtime © 2026 by Donald Dominko
// Licensed under CC BY-NC-SA 4.0
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// apps/api/src/routes/ai.ts
// Fastify route plugin for direct Qwen LLM interaction (non-queued path).
// Provides POST /ai/chat (blocking) and POST /ai/chat/stream (SSE streaming).
// Both routes persist user and assistant messages to Postgres and emit run lifecycle events
// to the append-only EventLog.  This is the Phase 1/2 direct path; the queue-based worker
// path (POST /runs) is the preferred path for production DAG execution.
// Invariant: every request creates exactly one run_id and appends RUN_CREATED as the first event.
// Exports: aiRoutes (Fastify plugin), RouteContext

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { QwenService } from '../services/qwen.js';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { createRunEvent } from '@cognitive-runtime/contracts';
import type { EventLog } from '../lib/event-log.js';

const chatRequestSchema = z.object({
  chatId: z.string().uuid(),
  message: z.string().min(1),
});

/** Dependencies injected into aiRoutes by the Fastify plugin system. */
interface RouteContext {
  eventLog: EventLog;
}

/** Registers /ai/chat (blocking) and /ai/chat/stream (SSE) routes. */
export async function aiRoutes(fastify: FastifyInstance, options: RouteContext) {
  const qwenService = new QwenService();
  const { eventLog } = options;

  /**
   * POST /ai/chat — blocking Qwen chat completion.
   * Saves user message, calls Qwen, saves assistant message, emits run events.
   * Returns { userMessage, assistantMessage, runId } on success.
   * On LLM error, emits RUNTIME_ERROR, saves an error message, and returns 500.
   */
  fastify.post<{ Body: z.infer<typeof chatRequestSchema> }>(
    '/ai/chat',
    async (request, reply) => {
      const { chatId, message } = chatRequestSchema.parse(request.body);

      const [userMessage] = await db
        .insert(schema.messages)
        .values({ chatId, role: 'user', content: message })
        .returning();

      const runId = randomUUID();

      const runCreatedEvent = createRunEvent(runId, chatId, 'RUN_CREATED', {
        type: 'RUN_CREATED',
        provider: 'qwen',
        model: 'qwen-2.5-coder-3b',
      });
      await eventLog.append(runCreatedEvent);

      try {
        const history = await db
          .select()
          .from(schema.messages)
          .where(eq(schema.messages.chatId, chatId))
          .orderBy(schema.messages.createdAt)
          .limit(10);

        const llmRequestedEvent = createRunEvent(runId, chatId, 'LLM_REQUESTED', {
          type: 'LLM_REQUESTED',
          provider: 'qwen',
          model: 'qwen-2.5-coder-3b',
          prompt_tokens_est: message.length,
        });
        await eventLog.append(llmRequestedEvent);

        const aiResponse = await qwenService.chat(
          message,
          history.slice(0, -1).map((m) => ({ role: m.role, content: m.content }))
        );

        const llmCompletedEvent = createRunEvent(runId, chatId, 'LLM_COMPLETED', {
          type: 'LLM_COMPLETED',
          output_len: aiResponse.length,
        });
        await eventLog.append(llmCompletedEvent);

        const [assistantMessage] = await db
          .insert(schema.messages)
          .values({ chatId, role: 'assistant', content: aiResponse })
          .returning();

        const runCompletedEvent = createRunEvent(runId, chatId, 'RUN_COMPLETED', {
          type: 'RUN_COMPLETED',
          ok: true,
        });
        await eventLog.append(runCompletedEvent);

        return reply.code(200).send({
          userMessage,
          assistantMessage,
          runId,
        });
      } catch (error) {
        fastify.log.error(error);

        const errorEvent = createRunEvent(runId, chatId, 'RUNTIME_ERROR', {
          type: 'RUNTIME_ERROR',
          code: 'LLM_ERROR',
          message: String(error),
        });
        await eventLog.append(errorEvent);

        const [errorMessage] = await db
          .insert(schema.messages)
          .values({
            chatId,
            role: 'assistant',
            content: `Sorry, I encountered an error: ${error}`,
          })
          .returning();

        return reply.code(500).send({
          userMessage,
          assistantMessage: errorMessage,
          runId,
          error: String(error),
        });
      }
    }
  );

  /**
   * POST /ai/chat/stream — SSE streaming Qwen chat completion.
   * Writes raw SSE frames to reply.raw; bypasses Fastify's normal response lifecycle.
   * Each frame is `data: {"token":"...", "done": false}\n\n`; the final frame has done:true.
   * Invariant: reply.raw.end() is always called, even on error.
   */
  fastify.post<{ Body: z.infer<typeof chatRequestSchema> }>(
    '/ai/chat/stream',
    async (request, reply) => {
      const { chatId, message } = chatRequestSchema.parse(request.body);

      await db
        .insert(schema.messages)
        .values({ chatId, role: 'user', content: message })
        .returning();

      const runId = randomUUID();

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });

      try {
        const runCreatedEvent = createRunEvent(runId, chatId, 'RUN_CREATED', {
          type: 'RUN_CREATED',
          provider: 'qwen',
          model: 'qwen-2.5-coder-3b',
        });
        await eventLog.append(runCreatedEvent);

        const history = await db
          .select()
          .from(schema.messages)
          .where(eq(schema.messages.chatId, chatId))
          .orderBy(schema.messages.createdAt)
          .limit(10);

        const llmStreamStartedEvent = createRunEvent(runId, chatId, 'LLM_STREAM_STARTED', {
          type: 'LLM_STREAM_STARTED',
        });
        await eventLog.append(llmStreamStartedEvent);

        let fullResponse = '';
        let tokenCount = 0;

        for await (const token of qwenService.chatStream(
          message,
          history.slice(0, -1).map((m) => ({ role: m.role, content: m.content }))
        )) {
          fullResponse += token;
          tokenCount++;

          if (tokenCount % 5 === 0) {
            const tokenEvent = createRunEvent(runId, chatId, 'LLM_STREAM_TOKEN', {
              type: 'LLM_STREAM_TOKEN',
              token_count: tokenCount,
            });
            await eventLog.append(tokenEvent).catch(() => {});
          }

          reply.raw.write(`data: ${JSON.stringify({ token, done: false })}\n\n`);
        }

        const llmStreamCompletedEvent = createRunEvent(runId, chatId, 'LLM_STREAM_COMPLETED', {
          type: 'LLM_STREAM_COMPLETED',
          token_count: tokenCount,
        });
        await eventLog.append(llmStreamCompletedEvent);

        const [assistantMessage] = await db
          .insert(schema.messages)
          .values({ chatId, role: 'assistant', content: fullResponse })
          .returning();

        const runCompletedEvent = createRunEvent(runId, chatId, 'RUN_COMPLETED', {
          type: 'RUN_COMPLETED',
          ok: true,
        });
        await eventLog.append(runCompletedEvent);

        reply.raw.write(
          `data: ${JSON.stringify({
            done: true,
            messageId: assistantMessage.id,
            runId,
          })}\n\n`
        );

        reply.raw.end();
      } catch (error) {
        fastify.log.error(error);

        const errorEvent = createRunEvent(runId, chatId, 'RUNTIME_ERROR', {
          type: 'RUNTIME_ERROR',
          code: 'STREAM_ERROR',
          message: String(error),
        });
        await eventLog.append(errorEvent);

        reply.raw.write(
          `data: ${JSON.stringify({
            error: String(error),
            done: true,
          })}\n\n`
        );

        await db
          .insert(schema.messages)
          .values({
            chatId,
            role: 'assistant',
            content: `Sorry, I encountered an error: ${error}`,
          })
          .returning();

        reply.raw.end();
      }
    }
  );
}
