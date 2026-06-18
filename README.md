# Cognitive Runtime

Cognitive Runtime is a deterministic execution engine for building structured AI systems.

Instead of relying on fragile prompt chains, it provides a runtime for:
- directed execution (DAGs)
- memory layers (M1–M3)
- reward and trust systems
- meta-planning and policy control

Everything is append-only, event-sourced, auditable, and replayable.

This is not a chatbot framework — it is a system for controlled cognition.

> This project is feature-complete through Phase 7. Licensed under the GNU AGPL-3.0 — see the [License](#license) section below.

---

## Why Cognitive Runtime Exists

Most AI systems today are:
- non-deterministic
- difficult to debug
- impossible to audit
- tightly coupled to prompt behavior

They work — until they don't.

Cognitive Runtime was built to treat AI as a system rather than a conversation.

It introduces:
- explicit execution graphs instead of implicit reasoning
- structured memory instead of hidden context
- measurable outcomes instead of subjective outputs
- auditable decisions instead of opaque model behavior

The goal is simple:

**Build AI systems that can be understood, controlled, and trusted.**

---

## Core Capabilities

- **Append-only event log** — all runtime state is derived from a never-modified event sequence stored in PostgreSQL
- **DAG execution engine** — structured task plans with node-level retry, dependencies, and idempotent execution
- **Local LLM** — Qwen 2.5 Coder 3B via llama.cpp (CPU inference, no GPU required)
- **Memory plane** — three tiers: M1 episodic (Postgres), M2 semantic (Qdrant vector DB), M3 procedural (Postgres)
- **Reward and trust** — 7-signal composite reward scoring + EMA-based agent trust over time
- **Meta-Planner** — deterministic DAG selection (REUSE / MODIFY / SYNTHESIZE) before each execution
- **Phase 7 hardening** — run cancellation, timeout, stale-heartbeat detection, policy gate, code-change workflow
- **Streaming** — SSE token streaming from the LLM to the browser
- **Debug UI** — React web app with chat panel, memory debug panel, Meta-Planner panel, Phase 7 debug panel

---

## Architecture Overview

Eight Docker services on a shared network:

```
Browser → cognitive-web (React, :3000)          ← production static build
Browser → cognitive-web-dev (Vite dev, :5173)   ← dev server (auto-started)
              │ HTTP
              ▼
         cognitive-api (Fastify, :3001)
              │ BullMQ
              ▼
         cognitive-redis (:6379)
              │ Worker consumes
              ▼
         cognitive-worker
              │ Postgres / Qdrant / LLM
              ├── cognitive-postgres (:5432)
              ├── cognitive-qdrant (:6333)
              └── cognitive-llama (:8080)
```

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the full architecture reference.

---

## Monorepo Layout

```
cognitive-runtime/
├── apps/
│   ├── api/           Fastify REST API (routes, queue producer, event log)
│   ├── worker/        BullMQ worker (DAG executor, memory, reward, planner)
│   └── web/           React/Vite debug UI
├── packages/
│   ├── contracts/     Zod schemas + TypeScript types (shared by all packages)
│   ├── runtime/       Business logic: DAG executor, memory, meta-planner, reward, trust, policy
│   └── storage/       Drizzle ORM: EventLog, MessagesRepo, schema
├── scripts/           Shell smoke tests (18 scripts covering all phases)
├── docs/              Documentation (see below)
├── docker-compose.yml 8-service stack
├── Dockerfile.llama   llama.cpp server image
└── .env.example       Environment variable template
```

---

## Documentation

| File | Contents |
|---|---|
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Service map, data flow, phase summary |
| [docs/EVENT_MODEL.md](./docs/EVENT_MODEL.md) | Event taxonomy, append-only invariants, derived state |
| [docs/MEMORY_MODEL.md](./docs/MEMORY_MODEL.md) | M1/M2/M3 tiers, embedding provider, Redis caching |
| [docs/META_PLANNER.md](./docs/META_PLANNER.md) | Planning pipeline, modes, scoring, constraints |
| [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) | Prerequisites, local dev, env vars, build commands |
| [docs/SMOKE_TESTS.md](./docs/SMOKE_TESTS.md) | All smoke test descriptions and how to run them |
| [docs/DEBUG_UI.md](./docs/DEBUG_UI.md) | Dev UI debug panels: Event Trace, DAG State, Phase 7, Meta-Planner, Memory |

---

## Prerequisites

- Node.js >= 20
- pnpm >= 8 (`npm install -g pnpm`)
- Docker >= 24 with Docker Compose v2

---

## Quick Start (Docker)

```bash
cp .env.example .env          # defaults work for Docker
docker compose up --build -d  # build and start all 8 services
```

Wait ~60–90 seconds for the llama model to load, then:

- **Web UI (production build):** http://localhost:3000
- **Web UI (Vite dev server):** http://localhost:5173
- **API health:** http://localhost:3001/health
- **Qdrant dashboard:** http://localhost:6333/dashboard

---

## Local Development (without Docker for app code)

```bash
# Start infrastructure only
docker compose up postgres qdrant redis llama -d

# Install dependencies
pnpm install

# Build shared packages
pnpm --filter @cognitive-runtime/contracts build
pnpm --filter @cognitive-runtime/runtime build
pnpm --filter @cognitive-runtime/storage build

# Run apps in watch mode (separate terminals)
cd apps/api    && pnpm dev   # :3001
cd apps/worker && pnpm dev
cd apps/web    && pnpm dev   # :5173
```

---

## Key Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql://cognitive:cognitive@postgres:5432/cognitive_runtime` | Postgres connection |
| `REDIS_URL` | `redis://redis:6379` | BullMQ queue + cache |
| `QDRANT_URL` | `http://qdrant:6333` | Vector DB |
| `LLAMA_URL` | `http://llama:8080` | LLM inference server |
| `EMBEDDING_PROVIDER` | `llama_cpp` | `llama_cpp` or `dev_fallback` |
| `EMBEDDING_ALLOW_DEV_FALLBACK` | `true` | Allow pseudo-random vectors if llama unreachable |
| `REDIS_ENABLED` | `true` | Enable embedding + context caching |
| `ENABLE_REPLANNING` | `false` | Enable Meta-Planner Phase 6 |
| `ENABLE_POLICY_GATE` | `false` | Enable Phase 7 policy evaluation |
| `ENABLE_CODE_CHANGE_WORKFLOW` | `false` | Enable Phase 7 code-change DAG nodes |
| `RUN_TIMEOUT_MS` | `300000` | Run timeout (5 min) |

Full list: [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md#environment-variables)

---

## Smoke Tests

Smoke tests require the full Docker stack running. See [docs/SMOKE_TESTS.md](./docs/SMOKE_TESTS.md) for descriptions.

```bash
bash scripts/smoke-worker-started.sh
bash scripts/smoke-runs-history.sh
bash scripts/smoke-idempotent-run.sh
bash scripts/smoke-dag-state.sh
bash scripts/smoke-reward-trust.sh
bash scripts/smoke-memory.sh
bash scripts/smoke-meta-planner.sh
bash scripts/smoke-phase7-lifecycle.sh
bash scripts/smoke-phase7-policy.sh
bash scripts/smoke-phase7-codeflow.sh
bash scripts/smoke-phase7-replan.sh
bash scripts/assert-event-types.sh
```

---

## Debug / Developer Surfaces

| Surface | URL | Notes |
|---|---|---|
| Web UI (prod build) | http://localhost:3000 | Chat + memory + planner + Phase 7 panels |
| Web UI (Vite dev) | http://localhost:5173 | Same app, auto-started dev server with HMR |
| API health | http://localhost:3001/health | Returns `{ ok: true }` |
| API event log | `GET /runs/:runId/events` | Full event list for a run |
| API DAG state | `GET /runs/:runId/dag-state` | Derived DAG + node statuses |
| Qdrant dashboard | http://localhost:6333/dashboard | Vector collection browser |
| Worker logs | `docker compose logs -f worker` | Job processing + planner + memory output |
| API logs | `docker compose logs -f api` | HTTP request logs |
| Smoke test logs | `.smoke-logs/` | Written by each smoke script |

---

## Event Sourcing Overview

All runtime state derives from a single append-only table (`run_logs`). Events are written once and never modified. Derived state — DAG status, node progress, trust scores, reward history — is computed by replaying the event sequence for a run.

**Key properties:**
- Any run can be replayed from its event log alone
- Derived state computation is deterministic and idempotent
- The event log is the audit trail; nothing else is authoritative

See [docs/EVENT_MODEL.md](./docs/EVENT_MODEL.md) for the full event taxonomy.

---

## What Is Implemented (Phase 7)

- Fastify REST API with full CRUD for chats, messages, runs, and events
- BullMQ worker with DAG execution, node retry, and constraint enforcement
- Local LLM integration (Qwen 2.5 Coder 3B, CPU inference via llama.cpp)
- Streaming SSE responses
- Append-only PostgreSQL event log with JSONB storage
- Three-tier memory plane (M1 episodic / M2 semantic / M3 procedural)
- Redis embedding cache and working-context cache
- Reward agent (7 signals, composite score, routing decisions)
- EMA-based agent trust scoring with passive decay
- Meta-Planner with REUSE / MODIFY / SYNTHESIZE modes
- Phase 7: run cancellation, timeout, stale-heartbeat detection
- Phase 7: deterministic policy gate with verdict events
- Phase 7: code-change workflow DAG nodes
- React debug UI with all debug panels

## What Is Intentionally Out of Scope

- Multi-tenant isolation or authentication
- GPU inference (CPU-only at present)
- Automated CI/CD pipeline
- Production observability stack (no Prometheus, Grafana, etc.)
- Horizontal scaling / multiple workers
- External API integrations

---

## Development Workflow

1. Run `docker compose up -d` for the full stack
2. Make code changes in `apps/` or `packages/`
3. Rebuild the affected service: `docker compose up --build <service> -d`
4. Run relevant smoke tests to verify behavior
5. For TypeScript-only changes, `pnpm build` catches type errors before rebuild

See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines.

---

## Packaging Status

This repository is feature-complete through Phase 7. It is in packaging/hardening mode:
- Source comments and documentation are being completed
- Repository hygiene (`.gitignore`, stale file cleanup) is in progress
- No new runtime features are planned at this stage

---

## Author

**Donald Dominko**  
[LinkedIn](https://www.linkedin.com/in/donald-dominko/) · [cognitiveruntime.net](https://cognitiveruntime.net)

---

## License

Cognitive Runtime © 2026 Donald Dominko  
Licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

You are free to:
- use, study, and modify the code
- share and redistribute it

Under the following conditions:
- **Copyleft** — derivative works must be released under the AGPL-3.0
- **Network use is distribution** — if you run a modified version to provide a service over a network, you must offer the complete corresponding source of your modified version to its users (AGPL §13)
- **Preserve notices** — keep the license and attribution intact

For licensing under other terms (including a commercial/proprietary license), please contact the author.

See [LICENSE](./LICENSE) for the full license text.

---

This project is a reference implementation of a cognitive runtime system.
