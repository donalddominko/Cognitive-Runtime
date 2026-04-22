// Cognitive Runtime © 2026 by Donald Dominko
// Licensed under CC BY-NC-SA 4.0
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// apps/api/src/lib/event-log.ts
// API-layer EventLog: thin wrapper around the shared drizzle DB instance.
// Phase 4: adds listByEventType() mirroring the storage package implementation.

import { RunEvent, zRunEvent, type RunEventType } from '@cognitive-runtime/contracts'; // event types + RunEventType
import { validate } from './validation.js'; // API-layer validation helper
import { db, schema } from '../db/index.js'; // module-level DB and schema (no constructor injection)
import { eq, desc, sql } from 'drizzle-orm'; // sql added for Phase 4 JSONB containment

export class EventLog {
  // append: validate then insert one event into run_logs.
  async append(event: RunEvent): Promise<void> {
    const validatedEvent = validate(zRunEvent, event); // contract-first: validate before write

    await db.insert(schema.runLogs).values({
      chatId:     validatedEvent.chat_id,       // chat partition key
      runId:      validatedEvent.run_id,        // run partition key
      ts:         new Date(validatedEvent.ts),  // typed timestamp for ordering
      eventJsonb: validatedEvent,               // full event as JSONB
    });
  }

  // listByRunId: all events for a run, ascending by (ts, id).
  async listByRunId(runId: string): Promise<RunEvent[]> {
    const rows = await db
      .select()                               // all columns
      .from(schema.runLogs)                   // run_logs table
      .where(eq(schema.runLogs.runId, runId)) // filter by run
      .orderBy(schema.runLogs.ts, schema.runLogs.id); // chronological

    return rows.map((row) => validate(zRunEvent, row.eventJsonb)); // validate on read
  }

  // listByChatId: recent events for a chat (newest first, then reversed to chronological).
  async listByChatId(chatId: string, limit = 100): Promise<RunEvent[]> {
    const rows = await db
      .select()                                     // all columns
      .from(schema.runLogs)                         // run_logs table
      .where(eq(schema.runLogs.chatId, chatId))     // filter by chat
      .orderBy(desc(schema.runLogs.ts), desc(schema.runLogs.id)) // newest first
      .limit(limit);                                // cap results

    return rows
      .map((row) => validate(zRunEvent, row.eventJsonb)) // validate each row
      .reverse(); // flip to chronological order
  }

  // countByRunId: event count for a run (used by smoke tests and assertions).
  async countByRunId(runId: string): Promise<number> {
    const result = await db
      .select()                               // all columns
      .from(schema.runLogs)                   // run_logs table
      .where(eq(schema.runLogs.runId, runId)); // filter by run

    return result.length; // count rows in application layer
  }

  // listByEventType: return up to `limit` events of a given type across ALL runs, newest first.
  // Phase 4 use-case: read TRUST_UPDATED history for a specific agent, then filter by agent_id.
  // Uses PostgreSQL JSONB containment (@>) for server-side type filtering.
  async listByEventType(eventType: RunEventType, limit = 100): Promise<RunEvent[]> {
    const typeJson = JSON.stringify({ type: eventType }); // e.g. '{"type":"TRUST_UPDATED"}'

    const rows = await db
      .select()                      // all columns
      .from(schema.runLogs)          // run_logs table
      .where(
        sql`${schema.runLogs.eventJsonb} @> ${typeJson}::jsonb` // JSONB containment filter
      )
      .orderBy(desc(schema.runLogs.ts), desc(schema.runLogs.id)) // newest first
      .limit(limit);                 // prevent unbounded result sets

    return rows.map((row) => validate(zRunEvent, row.eventJsonb)); // validate on read
  }
}
