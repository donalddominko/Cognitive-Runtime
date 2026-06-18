<!-- SPDX-License-Identifier: AGPL-3.0-only | Cognitive Runtime © 2026 Donald Dominko -->

# Memory Model

## Overview

The cognitive runtime implements a three-tier memory plane (M1, M2, M3) plus a Redis caching layer. Each tier serves a different purpose and uses a different backend.

Memory operations run **after** DAG execution as non-fatal post-processing hooks. A memory write failure does not fail the run.

---

## Memory Tiers

### M1 — Episodic Memory

**Backend:** PostgreSQL (`episodic_memories` table)  
**Purpose:** Structured history of prior run outcomes — what happened, when, and whether it succeeded.

Records capture:
- Run ID and chat ID for traceability
- Episode kind: `task_episode`, `run_summary`, `failure_case`, `success_case`
- Title and summary (human-readable)
- Tags for filtering
- Status: `SUCCEEDED`, `FAILED`, `PARTIAL`
- Source event IDs for cross-referencing the event log

**Access pattern:** Keyword search (ILIKE on title/summary) + recency ordering. Not vector-based.

**Idempotency:** Inserts use `ON CONFLICT DO NOTHING` on the record UUID, so re-processing a run is safe.

---

### M2 — Semantic Memory

**Backend:** Qdrant vector database (`semantic_memory` collection)  
**Purpose:** Semantic search over prior knowledge using vector embeddings.

Records are:
- Embedded via the configured `EmbeddingProvider` (llama.cpp `/v1/embeddings` endpoint)
- Stored as floating-point vectors with a JSON payload
- Queried by cosine similarity (top-K)

**Collection:** `semantic_memory` (auto-created if not present)  
**Vector dimension:** Determined by the embedding model (768 for Qwen 2.5 Coder 3B embeddings)

**Access pattern:** Vector similarity search. Returns scored results with payload.

---

### M3 — Procedural Memory

**Backend:** PostgreSQL (`procedural_memories` table)  
**Purpose:** Reusable procedures, DAG templates, and execution patterns that the Meta-Planner can retrieve and instantiate.

Records capture:
- `procedure_type`: category of procedure
- `name` and `description`: human-readable identification
- `dag_template`: optional serialized DAG spec for REUSE/MODIFY modes
- `constraints`: optional planning constraints
- `status`: `ACTIVE`, `DEPRECATED`, etc.
- Tags for filtering

**Access pattern:** Keyword search + optional `procedure_type` filter. Also supports `listActive()` for Meta-Planner bootstrap.

---

## Embedding Provider

Configured via `EMBEDDING_PROVIDER` environment variable:

| Value | Backend | Notes |
|---|---|---|
| `llama_cpp` | `http://llama:8080/v1/embeddings` | Default in Docker |
| `dev_fallback` | Deterministic random vectors | Local dev without llama running |

**Dev fallback:** When `EMBEDDING_ALLOW_DEV_FALLBACK=true`, if the llama server is unreachable the system generates deterministic pseudo-random vectors (seeded by content hash) rather than failing. This keeps the dev workflow functional without requiring the full Docker stack.

---

## Redis Caching Layer

Three independently toggleable caches:

| Cache | Env var | What it stores | TTL |
|---|---|---|---|
| Embedding cache | `CACHE_EMBEDDINGS=true` | `text → float[]` vector | 24h |
| Working context cache | `CACHE_WORKING_CONTEXT=true` | Recent message history | 5min |
| Retrieval cache | `CACHE_RETRIEVAL=true` | M2 search results | 5min |

The cache is **bypassed** if `REDIS_ENABLED=false`, using no-op implementations (`NoopEmbeddingCache`, `NoopWorkingContextCache`).

---

## Memory Orchestrator

`packages/runtime/src/memory/memory-orchestrator.ts`

The `MemoryOrchestrator` coordinates all three tiers behind a single interface. It is used by:
1. The **worker** — to write memory records after each run
2. The **Meta-Planner** — to read prior context before planning

```typescript
// Read context for planning
const context = await orchestrator.getContext({ chatId, runId, query, taskFeatures })

// Write after run completion
await orchestrator.writeEpisode(episode)
await orchestrator.writeSemantic(id, text, payload)
await orchestrator.writeProcedural(procedure)
```

---

## Memory Write Flow (per run)

```
DAG execution completes
  │
  ▼
MEMORY_WRITE_STARTED event emitted
  │
  ├── M1: build episode record from run events → insert to episodic_memories
  ├── M2: embed run summary → upsert to Qdrant
  └── M3: conditionally save DAG as procedural template if trust >= threshold
  │
  ▼
MEMORY_WRITE_COMPLETED event emitted
(on error: MEMORY_WRITE_FAILED — run is NOT failed)
```
