// Cognitive Runtime © 2026 by Donald Dominko
// Licensed under CC BY-NC-SA 4.0
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// apps/api/src/queue/runs-queue.ts
// BullMQ Queue producer for the 'runs' queue consumed by the worker process.
// The API enqueues run jobs here; the worker pulls and executes them.
// Invariant: this module is the producer side only — do NOT import Worker from BullMQ here.
// Invariant: completed/failed jobs are purged after 1000 entries to keep Redis memory bounded.
// Exports: runsQueue

import { Queue } from 'bullmq';
import { connectionFromUrl } from './redis-connection.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const QUEUE_NAME = process.env.QUEUE_NAME || 'runs';

export const runsQueue = new Queue(QUEUE_NAME, {
  connection: connectionFromUrl(REDIS_URL, { mode: 'producer' }),
  // Keep Redis tidy; DB event log is the real audit trail.
  defaultJobOptions: {
    removeOnComplete: 1000,
    removeOnFail: 1000,
  },
});
