<!-- SPDX-License-Identifier: AGPL-3.0-only | Cognitive Runtime © 2026 Donald Dominko -->

# Architecture

## Overview

Cognitive Runtime is a fully Dockerized TypeScript monorepo. It runs as 8 co-operating services on a shared Docker bridge network (`cognitive-network`) and implements an append-only, event-sourced execution model for AI agent tasks.

---

## Service Map

| Container | Image / Build | Port(s) | Role |
|---|---|---|---|
| `cognitive-postgres` | `postgres:16-alpine` | 5432 | Primary relational store |
| `cognitive-qdrant` | `qdrant/qdrant:latest` | 6333, 6334 | Vector embedding store (M2 semantic memory) |
| `cognitive-redis` | `redis:7-alpine` | 6379 | BullMQ queue backend |
| `cognitive-llama` | Custom build (`Dockerfile.llama`) | 8080 | Qwen 2.5 Coder 3B via llama.cpp |
| `cognitive-api` | Custom build (`apps/api/Dockerfile`) | 3001 | Fastify REST API |
| `cognitive-worker` | Custom build (`apps/worker/Dockerfile`) | — | BullMQ job consumer + DAG executor |
| `cognitive-web` | Custom build (`apps/web/Dockerfile`) | 3000 | React/Vite debug UI (production build) |
| `cognitive-web-dev` | Custom build (`apps/web/Dockerfile.dev`) | 5173 | React/Vite debug UI (Vite dev server) |

---

## Monorepo Layout

```
cognitive-runtime/
├── apps/
│   ├── api/       Fastify REST API — routes, event log, queue producer
│   ├── worker/    BullMQ worker — DAG execution, memory, reward, planner
│   └── web/       React/Vite debug UI — chat panel + debug panels
├── packages/
│   ├── contracts/ Zod schemas + TypeScript types shared across all packages
│   ├── runtime/   Business logic: DAG executor, memory services, meta-planner, reward, trust, policy
│   └── storage/   Drizzle ORM layer: EventLog, MessagesRepo, schema definitions
├── scripts/       Shell smoke tests for all phases
├── docs/          This documentation folder
└── docker-compose.yml  Full 8-service stack definition
```

---

## Data Flow: Single Run

```
Browser / smoke test
  │  POST /runs
  ▼
apps/api          validates input, creates RUN_CREATED event,
                  enqueues { run_id, chat_id, message_id, message } to Redis
  │
  ▼  BullMQ 'runs' queue
apps/worker
  │
  ├─ Phase 6: Meta-Planner selects / modifies / synthesizes the DAG
  │
  ├─ DAG Executor  iterates nodes in topological order:
  │    PERSIST_USER_MESSAGE → LLM_CHAT → ENFORCE_REPLY_CONSTRAINTS → PERSIST_ASSISTANT_MESSAGE
  │    (optional Phase 7 nodes: CODEBASE_ANALYZE, PATCH_PLAN, BUILD_VERIFY, ...)
  │
  ├─ Phase 4: Reward Agent  computes artifact_score, routing, trust update
  │
  ├─ Phase 5: Memory hooks  write M1 episodic + M2 semantic + M3 procedural records
  │
  └─ Phase 7: Lifecycle checks  cancel / timeout / stale-heartbeat detection
```

---

## Event Sourcing

All runtime state is derived from the `run_logs` table. This table is **append-only**: rows are never updated or deleted.

- Every significant runtime action emits a `RunEvent` to `run_logs`.
- Derived state (DAG run status, node states, reward history) is computed by reading and replaying events.
- The `EventLog` class is the sole write path; all writes are Zod-validated before insertion.

See [EVENT_MODEL.md](./EVENT_MODEL.md) for the full event taxonomy.

---

## Database Schema

Four persistent tables in PostgreSQL:

| Table | Purpose |
|---|---|
| `chats` | Chat session containers |
| `messages` | User / assistant / system messages |
| `run_logs` | Append-only event store (JSONB column) |
| `episodic_memories` | M1 — structured episode records from prior runs |
| `procedural_memories` | M3 — reusable DAG templates and patterns |

M2 semantic memory lives in Qdrant (not PostgreSQL).

Migrations: `apps/api/migrations/`

---

## Package Dependency Graph

```
contracts
   ↑         (imported by all)
storage  ←── runtime
   ↑              ↑
  worker ─────────┘
   
api ← contracts, runtime
web ← (no internal packages; talks to API via HTTP)
```

---

## Phase Summary

| Phase | What was delivered |
|---|---|
| 1 | Fastify API + Postgres + basic chat CRUD |
| 2 | Contract-first event log + Zod validation at boundaries |
| 3 | DAG executor + BullMQ worker + reply constraints |
| 4 | Reward agent (7 signals, EMA trust, routing decisions) |
| 5 | Memory plane: M1 episodic (Postgres), M2 semantic (Qdrant), M3 procedural (Postgres) |
| 5.1 | Embedding provider (llama.cpp /v1/embeddings) + Redis caching layer |
| 6 | Meta-Planner: REUSE / MODIFY / SYNTHESIZE DAG selection before execution |
| 7 | Production hardening: cancel, timeout, stale detection, policy gate, code-change workflow |
