// Cognitive Runtime © 2026 by Donald Dominko
// Licensed under CC BY-NC-SA 4.0
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/storage/src/db.ts
// Factory for creating a Drizzle ORM database instance bound to the storage schema.
// Called once at worker/API startup; the returned `db` is passed to EventLog and MessagesRepo.
// Invariant: callers are responsible for managing the postgres connection lifecycle.
// Exports: StorageSchema, createDb

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema } from './schema.js';

/** TypeScript type of the full storage schema — used for typed Drizzle queries. */
export type StorageSchema = typeof schema;

/**
 * Create a connected Drizzle database instance for the given postgres URL.
 * Returns both the raw postgres connection (`sql`) and the Drizzle wrapper (`db`).
 * The caller should close `sql` on shutdown if graceful teardown is needed.
 */
export function createDb(databaseUrl: string) {
  const sql = postgres(databaseUrl);
  const db = drizzle(sql, { schema });
  return { sql, db };
}
