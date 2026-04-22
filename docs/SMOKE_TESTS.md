# Smoke Tests

## Overview

All smoke tests live in `scripts/`. They are shell scripts that make HTTP requests to the running API and assert specific outcomes. They require a fully running Docker stack.

**All tests require the stack to be healthy before running:**

```bash
docker compose up -d
# Wait for all services to pass health checks
docker compose ps
```

---

## Running All Smoke Tests

```bash
# Recommended order: start with worker readiness, then run all phases
bash scripts/smoke-worker-started.sh
bash scripts/assert-event-types.sh
bash scripts/smoke-runs-history.sh
bash scripts/smoke-idempotent-run.sh
bash scripts/smoke-dag-state.sh
bash scripts/smoke-dag-state-once.sh
bash scripts/smoke-reply-constraints.sh
bash scripts/smoke-step3b-full.sh
bash scripts/smoke-reward-trust.sh
bash scripts/smoke-memory.sh
bash scripts/smoke-memory-acceleration.sh
bash scripts/smoke-meta-planner.sh
bash scripts/smoke-phase7-lifecycle.sh
bash scripts/smoke-phase7-policy.sh
bash scripts/smoke-phase7-codeflow.sh
bash scripts/smoke-phase7-replan.sh
```

---

## Test Descriptions

### smoke-worker-started.sh
Verifies that the worker has picked up at least one job and emitted a `WORKER_STARTED` event. Use this as a readiness gate before running other tests.

### assert-event-types.sh
Validates that all expected event type strings exist in the compiled contracts. Checks that the `zRunEventType` enum in the built output contains all required event names. Does not require a running API.

### smoke-runs-history.sh
Creates a chat and run, polls until the run completes, then verifies that the event log for the run contains the expected lifecycle events (`RUN_CREATED`, `WORKER_STARTED`, `DAG_PLANNED`, `RUN_COMPLETED`).

### smoke-idempotent-run.sh
Verifies that enqueuing the same run twice (with the same `message_id`) produces exactly one assistant message. Tests the idempotency guarantee in `MessagesRepo.insertMessage`.

### smoke-dag-state.sh
Runs a full LLM chat request and polls `GET /runs/:runId/dag-state` until the DAG reaches `SUCCEEDED` status. Verifies node-level state transitions.

### smoke-dag-state-once.sh
Single-shot variant of `smoke-dag-state.sh` — polls once without a retry loop.

### smoke-reply-constraints.sh
Tests the `ENFORCE_REPLY_CONSTRAINTS` DAG node. Sends a message that requests a constrained reply (e.g., "Reply with OK") and verifies the assistant response matches the constraint.

### smoke-step3b-full.sh
Full Phase 3B integration test: creates a chat, starts a run, waits for completion, asserts DAG state includes all Phase 3 node kinds.

### smoke-reward-trust.sh
Verifies that after a run completes, `REWARD_AGENT_STARTED`, `REWARD_COMPUTED`, `TRUST_UPDATED`, and `REWARD_AGENT_COMPLETED` events appear in the run's event log.

### smoke-memory.sh
Verifies Phase 5 memory writes: after a run, checks that M1 episodic records exist in Postgres and that the M2 Qdrant collection has at least one vector.

### smoke-memory-acceleration.sh
Verifies that embedding caching is working: runs the same query twice and asserts the second call is faster (cache hit).

### smoke-meta-planner.sh
Tests Phase 6 Meta-Planner integration with `ENABLE_REPLANNING=true`. Verifies that `PLANNER_STARTED` and `PLANNER_DECISION_MADE` events appear in the run log.

### smoke-phase7-lifecycle.sh
Tests Phase 7 run lifecycle management: cancel, timeout, and stale-heartbeat detection. Verifies that cancelled runs emit `RUN_CANCELLED` events.

### smoke-phase7-policy.sh
Tests the Phase 7 policy gate with `ENABLE_POLICY_GATE=true`. Sends a high-risk action and verifies `POLICY_EVALUATED` events with the expected verdict.

### smoke-phase7-codeflow.sh
Tests the Phase 7 code-change workflow with `ENABLE_CODE_CHANGE_WORKFLOW=true`. Verifies `CODEBASE_ANALYZE` and `PATCH_PLAN` node execution.

### smoke-phase7-replan.sh
Tests Phase 7 replanning: verifies that a run that hits a policy block can trigger a re-plan loop up to `MAX_PLANNER_LOOPS`.

---

## Utility / Build Scripts (not smoke tests)

These are not smoke tests and are not part of the standard test suite:

| Script | Purpose |
|---|---|
| `step3b_worker_build.sh` | Phase 3B build verification helper (dev artifact) |
| `verify-step3c.sh` | Phase 3C step verification helper (dev artifact) |

---

## Notes

- Smoke tests use `curl` and `jq`. Both must be installed on the host.
- Tests write to `.smoke-logs/` (gitignored) for debugging failed runs.
- All tests exit 0 on pass, non-zero on failure.
- Tests do not clean up created chats/runs — run against a disposable stack if data isolation matters.
