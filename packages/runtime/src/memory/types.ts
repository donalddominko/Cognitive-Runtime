// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/runtime/src/memory/types.ts
// Phase 5: Store interfaces for memory backends.
// Runtime defines these interfaces; concrete implementations live in worker/API.
// This keeps @cognitive-runtime/runtime free of @cognitive-runtime/storage dependency.

import type {
  M1EpisodicRecord,    // M1 record shape from contracts
  M3ProceduralRecord,  // M3 record shape from contracts
  RunEvent,            // event union from contracts
  RunEventType,        // event type string union from contracts
} from '@cognitive-runtime/contracts';

// ── M1 Store Interface ──────────────────────────────────────────────────────
// Concrete implementation backed by Postgres episodic_memories table.

export interface M1Store {
  // insert: persist an M1 episodic record. Must be idempotent on record.id.
  insert(record: M1EpisodicRecord): Promise<void>;

  // search: text/ILIKE search with optional filters. Returns up to topK results.
  search(params: {
    query: string;           // text search query
    chatId?: string;         // optional chat scope filter
    runId?: string;          // optional run scope filter
    projectId?: string;      // optional project scope filter
    topK: number;            // max results to return
    tags?: string[];         // optional tag filter
  }): Promise<M1EpisodicRecord[]>;

  // getRecent: fetch most recent episodes, optionally scoped.
  getRecent(params: {
    chatId?: string;         // optional chat scope
    projectId?: string;      // optional project scope
    limit: number;           // max results
  }): Promise<M1EpisodicRecord[]>;

  // existsForRun: check if an M1 record already exists for a given run (idempotency).
  existsForRun(runId: string): Promise<boolean>;
}

// ── M2 Store Interface ──────────────────────────────────────────────────────
// Concrete implementation backed by Qdrant vector database.

// M2SearchResult: a single result from Qdrant vector search.
export interface M2SearchResult {
  id: string;                            // point/record ID
  score: number;                         // vector similarity score from Qdrant
  payload: Record<string, unknown>;      // stored payload (text, provenance, etc.)
}

export interface M2Store {
  // ensureCollection: create the Qdrant collection if it doesn't exist.
  ensureCollection(dimension: number): Promise<void>;

  // upsert: insert or update a vector point in Qdrant.
  upsert(id: string, vector: number[], payload: Record<string, unknown>): Promise<void>;

  // search: top-k vector similarity search with optional metadata filters.
  search(vector: number[], topK: number, filters?: Record<string, unknown>): Promise<M2SearchResult[]>;
}

// ── M3 Store Interface ──────────────────────────────────────────────────────
// Concrete implementation backed by Postgres procedural_memories table.

export interface M3Store {
  // insert: persist an M3 procedural record. Must be idempotent on record.id.
  insert(record: M3ProceduralRecord): Promise<void>;

  // search: text/ILIKE search with optional filters. Returns up to topK results.
  search(params: {
    query: string;             // text search query
    topK: number;              // max results
    tags?: string[];           // optional tag filter
    procedureType?: string;    // optional procedure type filter
  }): Promise<M3ProceduralRecord[]>;

  // listActive: return all procedures with status = 'ACTIVE'.
  listActive(): Promise<M3ProceduralRecord[]>;
}

// ── EventLog-like interface for memory event emission ────────────────────────
// Re-exported for convenience; matches EventLogLike from dag-executor.ts.

export interface MemoryEventLogLike {
  append(event: RunEvent): Promise<void>;
  listByRunId(runId: string): Promise<RunEvent[]>;
  listByEventType(eventType: RunEventType, limit?: number): Promise<RunEvent[]>;
}

// ── Redis cache extension points (Phase 5.1 preparation) ────────────────────
// These interfaces are NOT implemented in Phase 5. They exist as documented
// extension points for Phase 5.1 when Redis becomes available.

// RetrievalCache: cache memory search results to avoid repeated DB/Qdrant queries.
// Phase 5.1: implement with Redis GET/SET and TTL-based expiration.
export interface RetrievalCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  invalidate(key: string): Promise<void>;
}

// EmbeddingCache: cache embedding vectors to avoid recomputing for identical text.
// Phase 5.1: implement with Redis HSET keyed by text hash.
export interface EmbeddingCache {
  getEmbedding(textHash: string): Promise<number[] | null>;
  setEmbedding(textHash: string, vector: number[]): Promise<void>;
}

// WorkingContextCache: cache per-run M0 working context for fast re-reads.
// Phase 5.1: implement with Redis SET/GET keyed by runId, short TTL.
export interface WorkingContextCache {
  getContext(runId: string): Promise<unknown | null>;
  setContext(runId: string, context: unknown, ttlSeconds: number): Promise<void>;
}
