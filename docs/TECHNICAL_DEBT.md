<!-- SPDX-License-Identifier: AGPL-3.0-only | Cognitive Runtime © 2026 Donald Dominko -->

# Technical Debt

Known problems in the memory plane (Phase 5 and 5.1), each checked against the code at commit `eae73c4` (2026-06-18). File references are to that commit. Severity: **High** can lose data or silently give wrong results; **Medium** is a correctness or maintenance risk; **Low** is a risk or a gap in testing.

Each entry gives the problem, why it matters, and the fix. Entries are removed when fixed, with the fixing commit named in the commit message.

---

## High

### TD-1: Embedding fallback defaults to fake vectors, and the API forces it on

- `EMBEDDING_ALLOW_DEV_FALLBACK` defaults to `true` in `docker-compose.yml` (api and worker) and in `.env.example`. The README documents `true` as the default.
- `apps/api/src/routes/memory.ts` hard-codes `'true'` ("API search is non-critical — always allow fallback"), and `apps/api/src/index.ts` defaults it to `'true'`.
- Why it matters: if llama is down, the system writes and searches pseudo-random vectors instead of failing. Runs complete, but memory retrieval is meaningless.
- Fix: default to `false`; make the API read the same variable as the worker; allow `true` only in an explicit development profile.

### TD-2: A vector dimension mismatch deletes the semantic memory collection

- `validateQdrantDimension` in `apps/worker/src/index.ts` sends `DELETE` for the `semantic_memory` collection whenever the stored vector size differs from the provider's.
- Why it matters: together with TD-1, one llama outage followed by a restart can wipe real memory. Changing the embedding model does the same.
- Fix: refuse to start on a mismatch, with a clear error. Recreate the collection only through an explicit migration command, and snapshot it first.

---

## Medium

### TD-3: Dev-fallback policy is configured in three places

- The worker factory (`packages/runtime/src/memory/embedding-provider.ts`) is strict when the variable is unset. The API forces it on. Compose sets `true` for both.
- Why it matters: outside compose the API and the worker can disagree, and `/debug/embeddings/health` can report a provider the worker is not using.
- Fix: one shared configuration function used by both. Resolves with TD-1.

### TD-4: Two smoke tests assert nothing

- In `scripts/smoke-memory-acceleration.sh`, Test 11 (Redis disabled) calls `pass` on both branches. Test 12 (llama unavailable) only checks `reachable=true`.
- Why it matters: the no-op cache path and the llama-unavailable path were never exercised, yet the suite reports 12/12.
- Fix: run the worker with `REDIS_ENABLED=false` and assert the no-op path; stop llama and assert a clear failure. Re-run every earlier smoke test after each phase.

### TD-5: The cache layer is incomplete

- `RecentEpisodesCache` does not exist.
- `RedisRetrievalCache` is defined in `packages/runtime/src/memory/redis-cache.ts` but nothing consumes it. Only the `CACHE_RETRIEVAL` flag is read (`apps/api/src/index.ts`), and it defaults to `false`.
- Fix: wire the retrieval cache in and test it, or delete it and the flag.

### TD-6: Semantic search ignores filters

- `WorkerM2Store.search(vector, topK, _filters)` in `apps/worker/src/index.ts` never sends the filters to Qdrant.
- Why it matters: tag, project and chat scoping cannot work for semantic memory.
- Fix: translate filters into a Qdrant `filter` payload; add a test that scoping excludes other projects' memories.

### TD-9: The memory schema is defined twice

- `packages/storage/src/schema.ts` (used by the worker) and `apps/api/src/db/schema.ts` (used by the API, and the only one `apps/api/drizzle.config.ts` points at) define identical `episodic_memories` and `procedural_memories` tables.
- Why it matters: they match today, but nothing enforces it.
- Fix: keep one definition in `packages/storage`, import it into the API, and point the drizzle config at it.

### TD-10: Migration 0001 was hand-written, so drizzle-kit cannot continue from it

- `apps/api/migrations/meta/` has `0000_snapshot.json` and `_journal.json` but no `0001_snapshot.json`.
- The next `drizzle-kit generate` will probably diff against the 0000 snapshot and emit a second `CREATE TABLE` for both memory tables, which would fail on an existing database. (Inferred from the missing snapshot; not run.)
- The four indexes in `0001_memory_tables.sql` exist only in the SQL, because the schema files leave out `index()`. `drizzle-kit push` may propose dropping them.
- The journal's `when` values (`1737000000000`, `1741900000000`) are placeholders, not real generation times.
- Fix: restore the indexes in the Drizzle schema, then regenerate the snapshot and journal against a database already at 0001. Check that the resulting diff is empty and that the SQL matches what is deployed. Recheck the `index()` API against drizzle-orm 0.45, which is what originally blocked this.

---

## Low

### TD-7: Llama is a hard startup dependency for both services

- In `docker-compose.yml`, `api` and `worker` both wait for a healthy llama (`depends_on: llama: service_healthy`).
- Why it matters: a slow llama start blocks the API and every run.
- Fix: decide whether this is intended. If so, document it. If not, retry in the background and report the degraded state.

### TD-8: The worker bypasses type checking at the memory seam

- `apps/worker/src/index.ts` passes `eventLog as any` to `MemoryOrchestrator` and `MetaPlanner`.
- Fix: define the minimal event-log interface both consume and type to it.

### TD-11: No retrieval-quality test for the embedding model

- The embeddings come from a 3B coder chat model with mean pooling, and the repo has no test of whether retrieval works well.
- Fix: add a small fixed set of query and expected-memory pairs, score recall@k, and run it whenever the embedding model or dimension changes.

---

## Suggested order

1. TD-1 and TD-2 together: the only items that can lose data.
2. TD-4 and TD-3: make the tests prove the failure paths, then remove the divergent fallback logic.
3. TD-9 and TD-10: fix the schema and migration so the database can be changed safely.
4. TD-5, TD-6, TD-7, TD-8 and TD-11.
