// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/storage/src/messages-repo.ts
// Repository for chat message persistence with idempotent insert support.
// Used by the worker to persist user and assistant messages during DAG execution.
// Invariant: insertMessage with an explicit `id` is idempotent (uses ON CONFLICT DO NOTHING).
// Invariant: listRecent returns at most 50 rows; callers reverse the result for chronological order.
// Exports: MessagesRepo

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { desc, eq } from 'drizzle-orm';
import { schema } from './schema.js';

/** Drizzle-backed repository for inserting and querying chat messages. */
export class MessagesRepo {
  constructor(private readonly db: PostgresJsDatabase<typeof schema>) {}

  /**
   * Insert a message row.
   * If `id` is provided, this is safe to call multiple times (idempotent).
   */
  async insertMessage(input: {
    id?: string;
    chatId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
  }): Promise<{ messageId: string }> {
    const id = input.id;

    if (id) {
      const inserted = await this.db
        .insert(schema.messages)
        .values({
          id,
          chatId: input.chatId,
          role: input.role,
          content: input.content,
        })
        .onConflictDoNothing({ target: schema.messages.id })
        .returning({ id: schema.messages.id });

      if (inserted[0]?.id) {
        return { messageId: inserted[0].id };
      }

      const existing = await this.db
        .select({ id: schema.messages.id })
        .from(schema.messages)
        .where(eq(schema.messages.id, id))
        .limit(1);

      if (!existing[0]?.id) {
        throw new Error(`MESSAGE_INSERT_CONFLICT_BUT_NOT_FOUND: id=${id}`);
      }

      return { messageId: existing[0].id };
    }

    const rows = await this.db
      .insert(schema.messages)
      .values({
        chatId: input.chatId,
        role: input.role,
        content: input.content,
      })
      .returning({ id: schema.messages.id });

    return { messageId: rows[0]!.id };
  }

  /**
   * Returns most-recent-first (DESC). Callers can reverse for chronological prompts.
   */
  async listRecent(chatId: string, limit: number): Promise<
    Array<{
      id: string;
      chatId: string;
      role: 'user' | 'assistant' | 'system';
      content: string;
      createdAt: Date;
    }>
  > {
    const clamped = Math.max(1, Math.min(50, Math.floor(limit || 1)));

    const rows = await this.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.chatId, chatId))
      .orderBy(desc(schema.messages.createdAt), desc(schema.messages.id))
      .limit(clamped);

    return rows as any;
  }
}
