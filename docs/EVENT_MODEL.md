# Event Model

## Principle

The cognitive runtime is **append-only and event-sourced**. The `run_logs` PostgreSQL table is the single source of truth. No runtime state is computed at write time and stored — all derived state (DAG status, node progress, reward history, trust scores) is re-derived from the event log on demand.

**Key invariants:**
- Events are never updated or deleted after insertion.
- Every event is Zod-validated before being written to the database.
- Reading events also validates them through `validate(zRunEvent, row.eventJsonb)`.
- Events are ordered by `(ts ASC, id ASC)` for stable replay.
- Replaying the same event sequence always produces the same derived state (deterministic).

---

## Event Envelope

Every `RunEvent` carries these top-level fields regardless of type:

```typescript
{
  run_id:   string  // UUID — the run this event belongs to
  chat_id:  string  // UUID — the owning chat session
  ts:       string  // ISO-8601 timestamp — when the event was emitted
  type:     string  // discriminator — determines the shape of `data`
  data:     object  // type-specific payload (validated by Zod)
}
```

---

## Event Type Taxonomy

### Run Lifecycle

| Event | Emitted when |
|---|---|
| `RUN_CREATED` | A new run is enqueued (API side) |
| `RUN_QUEUED` | Job enters the BullMQ queue |
| `WORKER_STARTED` | Worker picks up the job |
| `RUN_STATUS_CHANGED` | Run transitions between status values |
| `RUN_COMPLETED` | Run finished (ok: true or false) |
| `RUN_CANCELLED` | Run was cancelled via API or timeout |
| `RUNTIME_ERROR` | Unhandled error during execution |

### DAG Planning and Execution

| Event | Emitted when |
|---|---|
| `DAG_PLANNED` | Meta-Planner (or default planner) has selected a DAG spec |
| `DAG_NODE_STARTED` | A DAG node begins execution |
| `DAG_NODE_COMPLETED` | A DAG node finishes (ok: true or false) |
| `DAG_NODE_SKIPPED` | A DAG node is skipped (dependency failed) |

### LLM Interaction

| Event | Emitted when |
|---|---|
| `LLM_REQUESTED` | An LLM call is about to be made |
| `LLM_COMPLETED` | LLM call returned successfully |
| `LLM_STREAM_STARTED` | Streaming LLM call begins |
| `LLM_STREAM_TOKEN` | Token batch received during streaming |
| `LLM_STREAM_COMPLETED` | Streaming call finished |

### Reward and Trust (Phase 4)

| Event | Emitted when |
|---|---|
| `REWARD_AGENT_STARTED` | Reward computation block begins |
| `REWARD_COMPUTED` | 7 signals + composite score + routing decision computed |
| `TRUST_UPDATED` | EMA trust score recalculated for the agent |
| `REWARD_AGENT_COMPLETED` | Reward block finished |

### Memory (Phase 5)

| Event | Emitted when |
|---|---|
| `MEMORY_WRITE_STARTED` | Memory hook begins writing records |
| `MEMORY_WRITE_COMPLETED` | Memory hook finished writing |
| `MEMORY_WRITE_FAILED` | Memory write encountered an error (non-fatal) |

### Meta-Planner (Phase 6)

| Event | Emitted when |
|---|---|
| `PLANNER_STARTED` | Meta-Planner invocation begins |
| `PLANNER_CONTEXT_RETRIEVED` | Memory context fetched from MemoryOrchestrator |
| `PLANNER_CANDIDATES_BUILT` | Candidate DAGs generated |
| `PLANNER_DECISION_MADE` | Winning DAG selected (mode: REUSE/MODIFY/SYNTHESIZE) |
| `PLANNER_FALLBACK_USED` | Planner failed; default DAG used |

### Phase 7 (Production Hardening)

| Event | Emitted when |
|---|---|
| `POLICY_EVALUATED` | Policy gate evaluated an action |
| `RUN_TIMED_OUT` | Run exceeded the configured timeout |
| `WORKER_HEARTBEAT` | Worker emits a liveness pulse during long-running jobs |

---

## Derived State

The following state is never stored — it is always derived from events:

### DAG Run Status

Derived by `deriveDagRunState()` in `packages/runtime/src/derive-dag-run-state.ts`. Processes all events for a `run_id` in order and produces a `DAGRunState` object.

### Agent Trust

Derived by `deriveAgentTrust()` in `packages/runtime/src/derive-agent-trust.ts`. Reads the most recent `TRUST_UPDATED` event for an agent and applies EMA decay.

### Node Status

Node statuses (`PENDING`, `RUNNING`, `SUCCEEDED`, `FAILED`, `SKIPPED`) are derived from `DAG_NODE_STARTED` / `DAG_NODE_COMPLETED` / `DAG_NODE_SKIPPED` event sequences.

---

## Event Log API

```typescript
// packages/storage/src/event-log.ts

eventLog.append(event)                       // validate + insert one event
eventLog.listByRunId(runId)                  // all events for a run (asc)
eventLog.listByChatId(chatId, limit)         // recent events across runs for a chat
eventLog.countByRunId(runId)                 // count events for a run
eventLog.listByEventType(eventType, limit)   // cross-run query by event type (JSONB @>)
```
