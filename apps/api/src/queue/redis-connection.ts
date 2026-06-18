// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// apps/api/src/queue/redis-connection.ts
// Parses a Redis URL string into a BullMQ-compatible ConnectionOptions object.
// Handles optional auth (username/password), database index, and mode-specific settings.
// Invariant: maxRetriesPerRequest must be null for BullMQ worker connections; producers use 1.
// Exports: connectionFromUrl

import type { ConnectionOptions } from 'bullmq';

/**
 * Parse a redis:// URL into BullMQ ConnectionOptions.
 * @param mode - 'worker' sets maxRetriesPerRequest=null (required by BullMQ workers);
 *               'producer' sets maxRetriesPerRequest=1 (fail-fast for enqueue calls).
 */
export function connectionFromUrl(redisUrl: string, opts?: { mode?: 'worker' | 'producer' }): ConnectionOptions {
  const u = new URL(redisUrl);

  const port = u.port ? Number(u.port) : 6379;
  const username = u.username ? decodeURIComponent(u.username) : undefined;
  const password = u.password ? decodeURIComponent(u.password) : undefined;

  const dbFromPath = u.pathname?.replace('/', '');
  const db = dbFromPath ? Number(dbFromPath) : undefined;

  const mode = opts?.mode ?? 'producer';

  return {
    host: u.hostname,
    port,
    username,
    password,
    db,
    enableReadyCheck: false,
    maxRetriesPerRequest: mode === 'worker' ? null : 1,
  };
}
