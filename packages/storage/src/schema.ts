// Cognitive Runtime © 2026 by Donald Dominko
// Licensed under CC BY-NC-SA 4.0
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/storage/src/schema.ts
// Drizzle ORM table definitions for all persistent storage in the cognitive runtime.
// Tables: chats, messages, run_logs (event store), episodic_memories (M1), procedural_memories (M3).
// Invariant: run_logs is append-only — rows are never updated or deleted.
// Invariant: DB indexes for memory tables are created by SQL migrations, not by Drizzle schema.
// Exports: chats, messages, runLogs, episodicMemories, proceduralMemories, schema

import { pgTable, uuid, text, timestamp, jsonb } from 'drizzle-orm/pg-core';

// ── Existing tables (Phase 1-4, unchanged) ──────────────────────────────────

export const chats = pgTable('chats', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const messages = pgTable('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  chatId: uuid('chat_id')
    .notNull()
    .references(() => chats.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const runLogs = pgTable('run_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  chatId: uuid('chat_id')
    .notNull()
    .references(() => chats.id, { onDelete: 'cascade' }),
  runId: uuid('run_id').notNull(),
  ts: timestamp('ts').defaultNow().notNull(),
  eventJsonb: jsonb('event_jsonb').notNull(),
});

// ── Phase 5: Memory tables ──────────────────────────────────────────────────
// Indexes are created by migration SQL (0001_memory_tables.sql), not in Drizzle.
// This avoids drizzle-orm version compatibility issues with the index() API.

// M1 episodic memories — structured history of prior runs and outcomes.
export const episodicMemories = pgTable('episodic_memories', {
  id:             uuid('id').defaultRandom().primaryKey(),
  chatId:         uuid('chat_id'),
  runId:          uuid('run_id'),
  projectId:      text('project_id'),
  kind:           text('kind').notNull(),
  title:          text('title').notNull(),
  summary:        text('summary').notNull(),
  tags:           jsonb('tags').notNull().default([]),
  status:         text('status'),
  sourceEventIds: jsonb('source_event_ids'),
  metadata:       jsonb('metadata'),
  createdAt:      timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// M3 procedural memories — reusable procedures, DAG templates, patterns.
export const proceduralMemories = pgTable('procedural_memories', {
  id:             uuid('id').defaultRandom().primaryKey(),
  procedureType:  text('procedure_type').notNull(),
  name:           text('name').notNull(),
  description:    text('description').notNull(),
  version:        text('version').notNull(),
  tags:           jsonb('tags').notNull().default([]),
  dagTemplate:    jsonb('dag_template'),
  constraints:    jsonb('constraints'),
  status:         text('status').notNull(),
  createdAt:      timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }),
});

export const schema = {
  chats,
  messages,
  runLogs,
  episodicMemories,
  proceduralMemories,
} as const;
