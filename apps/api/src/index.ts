// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// apps/api/src/index.ts
// Fastify API server entry point.
// Phase 4: agentRoutes. Phase 5: memoryRoutes. Phase 5.1: embedding debug.
// Phase 6: metaPlannerRoutes. Phase 7: phase7Routes.

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import { config } from './config.js';
import { ValidationError } from './lib/validation.js';
import type { ErrorResponse } from '@cognitive-runtime/contracts';
import { EventLog } from './lib/event-log.js';
import { healthRoutes, setEmbeddingDebugInfo, setCacheDebugInfo } from './routes/health.js';
import { chatRoutes } from './routes/chats.js';
import { runRoutes } from './routes/runs.js';
import { aiRoutes } from './routes/ai.js';
import { agentRoutes } from './routes/agents.js';
import { memoryRoutes } from './routes/memory.js';
import { metaPlannerRoutes } from './routes/meta-planner.js'; // Phase 6
import { phase7Routes } from './routes/phase7.js';            // Phase 7
import { createEmbeddingProvider } from '@cognitive-runtime/runtime';

// Phase 5.1: Initialize embedding provider for debug info (non-fatal).
try {
  const embUrl = process.env.LLAMA_EMBEDDINGS_URL
    || (process.env.LLAMA_SERVER_URL || process.env.LLAMA_URL || '').replace(/\/+$/, '') + '/v1/embeddings';
  const { provider, isDevFallback } = await createEmbeddingProvider({
    EMBEDDING_PROVIDER: process.env.EMBEDDING_PROVIDER, LLAMA_EMBEDDINGS_URL: process.env.LLAMA_EMBEDDINGS_URL,
    LLAMA_SERVER_URL: process.env.LLAMA_SERVER_URL, LLAMA_URL: process.env.LLAMA_URL,
    EMBEDDING_TIMEOUT_MS: process.env.EMBEDDING_TIMEOUT_MS, EMBEDDING_ALLOW_DEV_FALLBACK: process.env.EMBEDDING_ALLOW_DEV_FALLBACK ?? 'true',
  });
  const providerType = (process.env.EMBEDDING_PROVIDER || 'dev').toLowerCase();
  setEmbeddingDebugInfo({
    providerType: providerType === 'llama_cpp' || providerType === 'llama' ? 'llama_cpp' : 'dev',
    modelName: provider.modelName(), dimension: provider.dimension(), reachable: !isDevFallback, isDevFallback, embeddingsUrl: embUrl || '',
  });
} catch (err: any) {
  console.warn(`[api] embedding provider init failed (non-fatal): ${err?.message}`);
  setEmbeddingDebugInfo({ providerType: 'unknown', modelName: 'unknown', dimension: 0, reachable: false, isDevFallback: true, embeddingsUrl: '' });
}

setCacheDebugInfo({
  redisEnabled: process.env.REDIS_ENABLED === 'true', cacheEmbeddings: process.env.CACHE_EMBEDDINGS === 'true',
  cacheRetrieval: process.env.CACHE_RETRIEVAL === 'true', cacheWorkingContext: process.env.CACHE_WORKING_CONTEXT === 'true',
});

const fastify = Fastify({ logger: { level: config.nodeEnv === 'development' ? 'info' : 'warn' } });
await fastify.register(cors, { origin: true, credentials: true });

fastify.setErrorHandler((error, _request, reply) => {
  if (error instanceof ValidationError) {
    const response: ErrorResponse = { error: 'VALIDATION_ERROR', message: error.message, issues: error.issues };
    return reply.status(422).send(response);
  }
  if (error instanceof ZodError) {
    const response: ErrorResponse = { error: 'VALIDATION_ERROR', message: 'Invalid request data', issues: error.errors.map((err) => ({ path: err.path.map(String), message: err.message })) };
    return reply.status(422).send(response);
  }
  fastify.log.error(error);
  const response: ErrorResponse = { error: 'INTERNAL_SERVER_ERROR', message: (error as any)?.message || 'An unexpected error occurred' };
  return reply.status((error as any)?.statusCode || 500).send(response);
});

const eventLog = new EventLog();

await fastify.register(healthRoutes);
await fastify.register(chatRoutes);
await fastify.register(runRoutes, { eventLog });
await fastify.register(aiRoutes, { eventLog });
await fastify.register(agentRoutes, { eventLog });
await fastify.register(memoryRoutes, { eventLog });
await fastify.register(metaPlannerRoutes, { eventLog }); // Phase 6
await fastify.register(phase7Routes, { eventLog });      // Phase 7

try {
  await fastify.listen({ port: config.api.port, host: config.api.host });
  console.log(`🚀 API server running on http://${config.api.host}:${config.api.port}`);
  console.log(`🤖 Qwen 2.5 Coder 3B ready`);
  console.log(`🧠 Memory Plane v1 active (M1/M2/M3)`);
  console.log(`🔬 Phase 5.1: debug endpoints at /debug/embeddings/health and /debug/cache/health`);
  console.log(`📐 Phase 6: Meta-Planner v1 active — /runs/:runId/meta-plan, /meta-planner/config`);
  console.log(`🛡️ Phase 7: Hardening active — /runs/:runId/lifecycle, /runs/:runId/cancel, /phase7/config`);
} catch (err) { fastify.log.error(err); process.exit(1); }
