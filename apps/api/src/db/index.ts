// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// apps/api/src/db/index.ts
// Drizzle ORM database singleton for the API process.
// Invariant: a single postgres connection pool is created at module load; do not create additional pools.
// Exports: db (Drizzle instance), schema (table definitions re-exported for query imports)

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { config } from '../config.js'
import * as schema from './schema.js'

// Pool size of 20 matches typical Fastify concurrency; adjust for high-load deployments.
const queryClient = postgres(config.database.url, {
  max: 20,
  ssl: false, // Always disable SSL for Docker internal networking
})

/** Drizzle ORM instance wired to the postgres connection pool and the shared schema. */
export const db = drizzle(queryClient, { schema })
export { schema }

