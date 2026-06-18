// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

import { pgTable, uuid, text, timestamp, jsonb } from 'drizzle-orm/pg-core'

// ── Existing tables (Phase 1-4, unchanged) ──────────────────────────────────

export const chats = pgTable('chats', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const messages = pgTable('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  chatId: uuid('chat_id')
    .notNull()
    .references(() => chats.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const runLogs = pgTable('run_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  chatId: uuid('chat_id')
    .notNull()
    .references(() => chats.id, { onDelete: 'cascade' }),
  runId: uuid('run_id').notNull(),
  ts: timestamp('ts').defaultNow().notNull(),
  eventJsonb: jsonb('event_jsonb').notNull(),
})

// ── Phase 5: Memory tables ──────────────────────────────────────────────────
// Indexes created by migration SQL, not in Drizzle schema definition.

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
})

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
})
