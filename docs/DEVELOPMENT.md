# Development Guide

## Prerequisites

| Tool | Minimum version | Notes |
|---|---|---|
| Node.js | 20 | LTS recommended |
| pnpm | 8 | `npm install -g pnpm` |
| Docker | 24 | With Docker Compose v2 (`docker compose`) |
| Git | any | — |

---

## Quick Start (Docker — recommended)

```bash
# Clone and enter the repo
git clone <repo-url>
cd cognitive-runtime

# Copy and review environment template
cp .env.example .env
# Edit .env if needed (defaults work for Docker)

# Build and start all 8 services
docker compose up --build -d

# Wait for the stack to be healthy (takes ~60–90s for llama to load the model)
docker compose ps

# API is available at:
#   http://localhost:3001/health
# Web UI (production build) is available at:
#   http://localhost:3000
# Web UI (Vite dev server) is available at:
#   http://localhost:5173
# Debug panels (DEV_MODE only) are documented at docs/DEBUG_UI.md
# Qdrant dashboard:
#   http://localhost:6333/dashboard
```

---

## Local Development (without Docker)

For active code changes you can run the API and worker outside Docker while keeping infrastructure (Postgres, Qdrant, Redis, llama) in Docker.

```bash
# Start only infrastructure services
docker compose up postgres qdrant redis llama -d

# Install all workspace dependencies
pnpm install

# Build shared packages (required before running apps)
pnpm --filter @cognitive-runtime/contracts build
pnpm --filter @cognitive-runtime/runtime build
pnpm --filter @cognitive-runtime/storage build

# In terminal 1: run API in watch mode
cd apps/api
pnpm dev

# In terminal 2: run worker in watch mode
cd apps/worker
pnpm dev

# In terminal 3: run web UI in watch mode
cd apps/web
pnpm dev
# Visit http://localhost:5173
# Debug panels are only visible here — see docs/DEBUG_UI.md
```

---

## Environment Variables

Copy `.env.example` to `.env`. Key variables:

| Variable | Description | Docker default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://cognitive:cognitive@postgres:5432/cognitive_runtime` |
| `REDIS_URL` | Redis connection string | `redis://redis:6379` |
| `QDRANT_URL` | Qdrant REST URL | `http://qdrant:6333` |
| `LLAMA_URL` | llama.cpp server URL | `http://llama:8080` |
| `API_PORT` | Fastify listen port | `3001` |
| `WEB_PORT` | Production web service port | `3000` |
| `WEB_DEV_PORT` | Vite dev server port | `5173` |
| `QUEUE_NAME` | BullMQ queue name | `runs` |
| `EMBEDDING_PROVIDER` | `llama_cpp` or `dev_fallback` | `llama_cpp` |
| `EMBEDDING_ALLOW_DEV_FALLBACK` | Allow random embeddings if llama unreachable | `true` |
| `REDIS_ENABLED` | Enable Redis caching layer | `true` |
| `CACHE_EMBEDDINGS` | Cache embedding vectors | `true` |
| `CACHE_WORKING_CONTEXT` | Cache message history | `true` |
| `ENABLE_CODE_CHANGE_WORKFLOW` | Phase 7 code-change DAG nodes | `false` |
| `ENABLE_REPLANNING` | Phase 6 Meta-Planner | `false` |
| `ENABLE_POLICY_GATE` | Phase 7 policy gate evaluation | `false` |
| `RUN_TIMEOUT_MS` | Max run duration before timeout | `300000` (5min) |
| `STALE_HEARTBEAT_MS` | Max silence before stale detection | `60000` (1min) |
| `WORKER_HEARTBEAT_MS` | Worker heartbeat interval | `30000` (30s) |

Each app also has its own `.env.example` in `apps/api/` and `apps/web/`.

---

## Feature Flags (Off by Default)

Three environment variables are `false` by default because they activate Phase 6/7 features that depend on each other and on accumulated runtime data. Enabling them without understanding the dependencies produces no visible effect or unexpected blocked runs.

---

### `ENABLE_REPLANNING` — Phase 6 Meta-Planner

**What it does:** Before every run, the Meta-Planner reads episodic (M1) and procedural (M3) memory, scores candidate DAGs using similarity + trust signals, and selects the best execution plan (REUSE / MODIFY / SYNTHESIZE). Without it, every run uses the hardcoded default 4-node DAG regardless of task type.

**Why it's off by default:** The planner only produces value after M3 procedural memory is populated with successful prior runs. On a fresh install it will always fall back to the default DAG anyway — the overhead with no benefit.

**When to enable:** After the system has processed enough runs to accumulate procedural templates, or when you want to observe and test the planning pipeline.

**What to expect when enabled:** The following events appear in `/runs/:runId/events` on every run:
- `META_PLANNER_STARTED` → `META_PLANNER_CONTEXT_RETRIEVED` → `META_PLANNER_CANDIDATES_BUILT` → `META_PLANNER_DECISION_MADE`
- On failure: `META_PLANNER_FALLBACK_USED` (system recovers automatically, default DAG is used)

---

### `ENABLE_POLICY_GATE` — Phase 7 Policy Evaluation

**What it does:** Before DAG execution, every run passes through a deterministic policy gate. The gate classifies the DAG's risk level by evaluating a set of built-in rules against the DAG type and node kinds — no LLM involved. It emits a `POLICY_VERDICT` of `allowed`, `blocked`, or `require_review`. A `CRITICAL` verdict hard-stops the run.

**Why it's off by default:** In a local dev setup, blocked runs are disruptive and confusing. The gate is designed for environments where governance enforcement matters.

**When to enable:** When testing the governance pipeline, when running the Phase 7 smoke tests (`smoke-phase7-policy.sh`), or before any deployment intended to handle real workloads.

**What to expect when enabled:** Every run emits `POLICY_GATE_STARTED` and `POLICY_VERDICT`. Runs involving code-change DAG node kinds or `ENABLE_CODE_CHANGE_WORKFLOW=false` will be blocked by the `BLOCK_CODE_CHANGE_IF_DISABLED` rule.

---

### `ENABLE_CODE_CHANGE_WORKFLOW` — Phase 7 Code-Change DAG

**What it does:** Unlocks a second DAG path — the sandboxed code-change workflow — which the Meta-Planner can select when a task requires code modification. This DAG adds 6 nodes: `CODEBASE_ANALYZE → PATCH_PLAN → PATCH_APPLY_SIMULATED → BUILD_VERIFY → PATCH_REVIEW → PERSIST_ASSISTANT_MESSAGE`. All operations are fully simulated — no real file mutations or git operations occur.

**Why it's off by default:** This flag only has effect when `ENABLE_REPLANNING=true` is also set (so the Meta-Planner can select the code-change DAG). Without replanning enabled, the code-change path is never reached. Additionally, when `ENABLE_POLICY_GATE=true`, the gate blocks code-change DAGs unless this flag is explicitly on.

**When to enable:** Set together with `ENABLE_REPLANNING=true` and `ENABLE_POLICY_GATE=true` to exercise the full Phase 7 pipeline. Use the smoke test `scripts/smoke-phase7-codeflow.sh` to verify end-to-end behavior.

**What to expect when enabled:** Runs that trigger the code-change path will show extended event traces with the 6 additional node events. The run trace viewer in the Web UI will display all node states.

---

**Recommended test order:**
```bash
# 1. Enable replanning only
ENABLE_REPLANNING=true

# 2. Add policy gate
ENABLE_REPLANNING=true
ENABLE_POLICY_GATE=true

# 3. Full Phase 7
ENABLE_REPLANNING=true
ENABLE_POLICY_GATE=true
ENABLE_CODE_CHANGE_WORKFLOW=true
```

---

## Build Commands

```bash
# Build all packages and apps
pnpm build

# Build a specific package
pnpm --filter @cognitive-runtime/contracts build
pnpm --filter @cognitive-runtime/runtime build
pnpm --filter @cognitive-runtime/storage build
pnpm --filter @cognitive-runtime/api build
pnpm --filter @cognitive-runtime/worker build
pnpm --filter @cognitive-runtime/web build
```

---

## Type Checking

```bash
# Check all TypeScript without emitting
pnpm exec tsc --noEmit -p packages/contracts/tsconfig.json
pnpm exec tsc --noEmit -p packages/runtime/tsconfig.json
pnpm exec tsc --noEmit -p packages/storage/tsconfig.json
pnpm exec tsc --noEmit -p apps/api/tsconfig.json
pnpm exec tsc --noEmit -p apps/worker/tsconfig.json
```

---

## Linting and Formatting

```bash
# Lint all TypeScript files
pnpm lint

# Format all files
pnpm format
```

---

## Database Migrations

Drizzle ORM manages the schema:

```bash
# Generate new migration from schema changes
pnpm db:generate

# Apply pending migrations
pnpm db:migrate

# Open Drizzle Studio (web UI for the DB)
pnpm db:studio
```

Migrations are in `apps/api/migrations/`. Do not edit migration files after they have been applied to any environment.

---

## Rebuilding Docker Images

After code changes:

```bash
# Rebuild and restart a single service
docker compose up --build api -d

# Rebuild all services
docker compose up --build -d
```

---

## Viewing Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f worker
docker compose logs -f api
docker compose logs -f llama
```

---

## Stopping the Stack

```bash
# Stop but preserve volumes (keeps DB data)
docker compose down

# Stop and delete all data volumes
docker compose down -v
```
