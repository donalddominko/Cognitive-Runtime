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

# Build and start all 7 services
docker compose up --build -d

# Wait for the stack to be healthy (takes ~60–90s for llama to load the model)
docker compose ps

# API is available at:
#   http://localhost:3001/health
# Web UI (production build) is available at:
#   http://localhost:3000
# Web UI (Vite dev server) is available at:
#   http://localhost:5173
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
