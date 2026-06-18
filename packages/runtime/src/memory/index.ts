// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/runtime/src/memory/index.ts
// Phase 5.1: Barrel export for the memory module.

export * from './types.js';                   // store interfaces, cache extension points
export * from './embedding-provider.js';      // EmbeddingProvider interface + DevEmbeddingProvider + LlamaCppEmbeddingProvider + factory
export * from './redis-cache.js';             // Redis cache implementations + Noop fallbacks
export * from './m1-episodic-service.js';     // M1EpisodicMemoryService
export * from './m2-semantic-service.js';     // M2SemanticMemoryService + SEMANTIC_MEMORY_COLLECTION
export * from './m3-procedural-service.js';   // M3ProceduralMemoryService
export * from './memory-orchestrator.js';     // MemoryOrchestrator + RetrievedMemoryContext
