// Cognitive Runtime © 2026 by Donald Dominko
// Licensed under CC BY-NC-SA 4.0
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/runtime/src/memory/redis-cache.ts
// Phase 5.1: Redis-backed cache implementations for embedding, retrieval, and working context.
// All caches are optional and failure-safe — errors are logged but never break runs.
// Falls back to NoopCache if Redis is unavailable or disabled.

import { createHash } from 'crypto'; // for hashing cache keys

import type {
  EmbeddingCache,        // cache embedding vectors
  RetrievalCache,        // cache retrieval results
  WorkingContextCache,   // cache per-run working context
} from './types.js';

// ── Key helpers ─────────────────────────────────────────────────────────────

// sha256Short: produce a hex SHA-256 hash of a string (for cache key components).
export function sha256Short(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex'); // 64-char hex string
}

// ── Redis client interface ──────────────────────────────────────────────────
// Minimal interface so we don't depend on a specific Redis library.
// The worker/API provides a concrete client that satisfies this.

export interface RedisCacheLike {
  get(key: string): Promise<string | null>;               // GET key
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>; // SET key value [EX seconds]
  del(key: string): Promise<unknown>;                      // DEL key
}

// ── Redis Embedding Cache ───────────────────────────────────────────────────
// Key format: embedding:{provider}:{model}:{sha256(text)}
// Value: JSON-serialized number[] vector
// TTL: long (embeddings are deterministic for same model+text)

export class RedisEmbeddingCache implements EmbeddingCache {
  constructor(
    private readonly redis: RedisCacheLike,   // Redis client
    private readonly provider: string,        // provider name for key prefix
    private readonly model: string,           // model name for key prefix
    private readonly ttlSeconds: number = 86400 * 7, // default 7 day TTL
  ) {}

  // getEmbedding: retrieve a cached vector by text hash.
  async getEmbedding(textHash: string): Promise<number[] | null> {
    try {
      const key = `embedding:${this.provider}:${this.model}:${textHash}`; // build cache key
      const raw = await this.redis.get(key);                               // fetch from Redis
      if (raw === null) return null;                                       // cache miss
      const parsed = JSON.parse(raw);                                      // parse JSON array
      if (!Array.isArray(parsed)) return null;                             // invalid shape
      return parsed as number[];                                           // return cached vector
    } catch (err: any) {
      console.warn(`[embedding-cache] get failed (non-fatal): ${err?.message}`);
      return null; // degrade gracefully on Redis failure
    }
  }

  // setEmbedding: store a vector in cache keyed by text hash.
  async setEmbedding(textHash: string, vector: number[]): Promise<void> {
    try {
      const key = `embedding:${this.provider}:${this.model}:${textHash}`; // build cache key
      const value = JSON.stringify(vector);                                // serialize vector
      await this.redis.set(key, value, { EX: this.ttlSeconds });          // store with TTL
    } catch (err: any) {
      console.warn(`[embedding-cache] set failed (non-fatal): ${err?.message}`);
      // Graceful degradation — cache write failure is non-fatal.
    }
  }
}

// ── Redis Retrieval Cache ───────────────────────────────────────────────────
// Key format: retrieval:{tier}:{queryHash}:{filtersHash}:{topK}:{provider}:{model}
// Value: JSON-serialized final result set
// TTL: moderate (results may change as new data is written)

export class RedisRetrievalCache implements RetrievalCache {
  constructor(
    private readonly redis: RedisCacheLike,   // Redis client
    private readonly ttlSeconds: number = 300, // default 5 min TTL
  ) {}

  // get: retrieve cached retrieval results.
  async get(key: string): Promise<string | null> {
    try {
      return await this.redis.get(key);   // fetch from Redis
    } catch (err: any) {
      console.warn(`[retrieval-cache] get failed (non-fatal): ${err?.message}`);
      return null; // degrade gracefully
    }
  }

  // set: store retrieval results with TTL.
  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    try {
      const ttl = ttlSeconds > 0 ? ttlSeconds : this.ttlSeconds;   // use provided or default TTL
      await this.redis.set(key, value, { EX: ttl });                // store with TTL
    } catch (err: any) {
      console.warn(`[retrieval-cache] set failed (non-fatal): ${err?.message}`);
    }
  }

  // invalidate: remove a cached entry.
  async invalidate(key: string): Promise<void> {
    try {
      await this.redis.del(key);   // delete from Redis
    } catch (err: any) {
      console.warn(`[retrieval-cache] invalidate failed (non-fatal): ${err?.message}`);
    }
  }
}

// ── Redis Working Context Cache ─────────────────────────────────────────────
// Key format: runctx:{runId}
// Value: JSON-serialized working context object
// TTL: short (context is only relevant during/shortly after a run)

export class RedisWorkingContextCache implements WorkingContextCache {
  constructor(
    private readonly redis: RedisCacheLike,    // Redis client
    private readonly defaultTtl: number = 600, // default 10 min TTL
  ) {}

  // getContext: retrieve cached working context for a run.
  async getContext(runId: string): Promise<unknown | null> {
    try {
      const key = `runctx:${runId}`;           // build cache key
      const raw = await this.redis.get(key);    // fetch from Redis
      if (raw === null) return null;            // cache miss
      return JSON.parse(raw);                   // parse and return
    } catch (err: any) {
      console.warn(`[working-ctx-cache] get failed (non-fatal): ${err?.message}`);
      return null; // degrade gracefully
    }
  }

  // setContext: store working context for a run with TTL.
  async setContext(runId: string, context: unknown, ttlSeconds: number): Promise<void> {
    try {
      const key = `runctx:${runId}`;                                   // build cache key
      const value = JSON.stringify(context);                            // serialize context
      const ttl = ttlSeconds > 0 ? ttlSeconds : this.defaultTtl;      // use provided or default TTL
      await this.redis.set(key, value, { EX: ttl });                   // store with TTL
    } catch (err: any) {
      console.warn(`[working-ctx-cache] set failed (non-fatal): ${err?.message}`);
    }
  }
}

// ── Noop caches (fallback when Redis is disabled or unavailable) ────────────

export class NoopEmbeddingCache implements EmbeddingCache {
  async getEmbedding(_textHash: string): Promise<number[] | null> { return null; }
  async setEmbedding(_textHash: string, _vector: number[]): Promise<void> { /* noop */ }
}

export class NoopRetrievalCache implements RetrievalCache {
  async get(_key: string): Promise<string | null> { return null; }
  async set(_key: string, _value: string, _ttlSeconds: number): Promise<void> { /* noop */ }
  async invalidate(_key: string): Promise<void> { /* noop */ }
}

export class NoopWorkingContextCache implements WorkingContextCache {
  async getContext(_runId: string): Promise<unknown | null> { return null; }
  async setContext(_runId: string, _context: unknown, _ttlSeconds: number): Promise<void> { /* noop */ }
}
