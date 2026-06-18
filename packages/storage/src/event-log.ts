// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/storage/src/event-log.ts
// Append-only event log backed by PostgreSQL via drizzle-orm.
// Phase 4: adds listByEventType() using JSONB containment (@>) for efficient type-based queries.

import { eq, desc, sql } from 'drizzle-orm'; // sql added for Phase 4 JSONB containment query
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'; // type-only import for DB instance
import { zRunEvent, type RunEvent, type RunEventType } from '@cognitive-runtime/contracts'; // event types
import { validate } from './validate.js'; // project validator that wraps zod parse with typed errors
import { schema } from './schema.js';     // drizzle schema definitions for run_logs table

// StorageDb: type alias for the postgres-js drizzle database instance.
export type StorageDb = PostgresJsDatabase<typeof schema>;

export class EventLog {
  constructor(private readonly db: StorageDb) {} // inject DB at construction time

  // append: validate then insert one event. Throws ValidationError if schema fails.
  async append(event: RunEvent): Promise<void> {
    const validatedEvent = validate(zRunEvent, event); // contract-first: validate before write

    await this.db.insert(schema.runLogs).values({
      chatId:     validatedEvent.chat_id,  // partition key for chat-scoped queries
      runId:      validatedEvent.run_id,   // partition key for run-scoped queries
      ts:         new Date(validatedEvent.ts), // parsed Date for timestamp ordering
      eventJsonb: validatedEvent,          // full event stored as JSONB for flexible queries
    });
  }

  // listByRunId: return all events for one run, ordered by (ts ASC, id ASC).
  // Primary read path for the worker and API.
  async listByRunId(runId: string): Promise<RunEvent[]> {
    const rows = await this.db
      .select()                              // fetch all columns
      .from(schema.runLogs)                  // from the run_logs table
      .where(eq(schema.runLogs.runId, runId)) // filter by run_id column
      .orderBy(schema.runLogs.ts, schema.runLogs.id); // chronological then stable by id

    return rows.map((row) => validate(zRunEvent, row.eventJsonb)); // validate on read
  }

  // listByChatId: return recent events across all runs for a chat, newest first, then reversed.
  async listByChatId(chatId: string, limit = 100): Promise<RunEvent[]> {
    const rows = await this.db
      .select()                                  // fetch all columns
      .from(schema.runLogs)                      // from run_logs
      .where(eq(schema.runLogs.chatId, chatId))  // filter by chat_id
      .orderBy(desc(schema.runLogs.ts), desc(schema.runLogs.id)) // newest first
      .limit(limit);                             // cap result count

    return rows.map((row) => validate(zRunEvent, row.eventJsonb)).reverse(); // chronological order
  }

  // countByRunId: return the number of events stored for a run (used for assertions).
  async countByRunId(runId: string): Promise<number> {
    const result = await this.db
      .select()                                // fetch all (count in application layer)
      .from(schema.runLogs)                    // from run_logs
      .where(eq(schema.runLogs.runId, runId)); // filter by run_id

    return result.length; // row count
  }

  // listByEventType: return up to `limit` events of a given type across ALL runs.
  // Uses PostgreSQL JSONB containment operator (@>) for server-side filtering.
  // Results are ordered newest-first so callers can take [0] for the latest record.
  // Phase 4 use-case: find the most recent TRUST_UPDATED event for an agent.
  async listByEventType(eventType: RunEventType, limit = 100): Promise<RunEvent[]> {
    // Build a JSONB containment filter: event_jsonb @> '{"type":"<eventType>"}'::jsonb
    // The @> operator returns rows where the left JSONB contains the right JSONB subtree.
    // Passing JSON.stringify as a parameter prevents SQL injection.
    const typeJson = JSON.stringify({ type: eventType }); // e.g. '{"type":"TRUST_UPDATED"}'

    const rows = await this.db
      .select()                     // fetch all columns
      .from(schema.runLogs)         // from run_logs
      .where(
        sql`${schema.runLogs.eventJsonb} @> ${typeJson}::jsonb` // JSONB containment check
      )
      .orderBy(desc(schema.runLogs.ts), desc(schema.runLogs.id)) // newest first
      .limit(limit);                // cap to avoid unbounded scans

    return rows.map((row) => validate(zRunEvent, row.eventJsonb)); // validate on read
  }
}
