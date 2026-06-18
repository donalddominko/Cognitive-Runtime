// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// apps/api/src/routes/health.ts
// Phase 5.1: Health + debug endpoints for embedding provider and cache status.

import type { FastifyInstance } from 'fastify';

// Module-level state set by the API startup (see index.ts).
// These are populated after createEmbeddingProvider() runs.
let embeddingDebugInfo: {
  providerType: string;
  modelName: string;
  dimension: number;
  reachable: boolean;
  isDevFallback: boolean;
  embeddingsUrl: string;
} = {
  providerType: 'unknown',
  modelName: 'unknown',
  dimension: 0,
  reachable: false,
  isDevFallback: false,
  embeddingsUrl: '',
};

let cacheDebugInfo: {
  redisEnabled: boolean;
  cacheEmbeddings: boolean;
  cacheRetrieval: boolean;
  cacheWorkingContext: boolean;
} = {
  redisEnabled: false,
  cacheEmbeddings: false,
  cacheRetrieval: false,
  cacheWorkingContext: false,
};

// setEmbeddingDebugInfo: called by API startup to populate embedding debug state.
export function setEmbeddingDebugInfo(info: typeof embeddingDebugInfo): void {
  embeddingDebugInfo = info;
}

// setCacheDebugInfo: called by API startup to populate cache debug state.
export function setCacheDebugInfo(info: typeof cacheDebugInfo): void {
  cacheDebugInfo = info;
}

export async function healthRoutes(fastify: FastifyInstance) {
  // GET /health — basic health check (unchanged shape).
  fastify.get('/health', async () => {
    return {
      ok: true,
      timestamp: new Date().toISOString(),
      ai: {
        qwen: '2.5-coder-3b-q4',
        whisper: 'base.en',
        piper: 'en_US-lessac-medium',
      },
    };
  });

  // GET /debug/embeddings/health — embedding provider status.
  fastify.get('/debug/embeddings/health', async () => {
    // Live-probe the embeddings endpoint if it's llama_cpp.
    let liveReachable = embeddingDebugInfo.reachable;
    if (embeddingDebugInfo.providerType === 'llama_cpp' && embeddingDebugInfo.embeddingsUrl) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const resp = await fetch(embeddingDebugInfo.embeddingsUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: 'probe', model: 'default' }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        liveReachable = resp.ok;
      } catch {
        liveReachable = false;
      }
    }

    return {
      provider_type:   embeddingDebugInfo.providerType,
      model_name:      embeddingDebugInfo.modelName,
      dimension:       embeddingDebugInfo.dimension,
      reachable:       liveReachable,
      is_dev_fallback: embeddingDebugInfo.isDevFallback,
      embeddings_url:  embeddingDebugInfo.embeddingsUrl,
    };
  });

  // GET /debug/cache/health — cache configuration status.
  fastify.get('/debug/cache/health', async () => {
    return {
      redis_enabled:        cacheDebugInfo.redisEnabled,
      cache_embeddings:     cacheDebugInfo.cacheEmbeddings,
      cache_retrieval:      cacheDebugInfo.cacheRetrieval,
      cache_working_context:cacheDebugInfo.cacheWorkingContext,
    };
  });
}
