<!-- Cognitive Runtime © 2026 by Donald Dominko | CC BY-NC-SA 4.0 -->

# Meta-Planner

## Purpose

The Meta-Planner is a deterministic planning layer that runs **before** DAG execution on every run. Its job is to select the best DAG for the current task by consulting memory and evaluating candidate options — rather than always using the same default DAG.

---

## Planning Modes

| Mode | Description |
|---|---|
| `REUSE` | An existing M3 procedural template is used as-is (parameter adaptation only) |
| `MODIFY` | An existing M3 template is modified (insert, remove, or swap nodes) |
| `SYNTHESIZE` | A new DAG is assembled from templates (no suitable M3 pattern found) |
| `BYPASS` | Planner is disabled or explicitly skipped; the default DAG is used unchanged |

---

## Planning Pipeline

```
run_id + message received by worker
  │
  ▼
planDagForRun()
  │
  ├─ 1. Check if planner is enabled (ENABLE_REPLANNING flag / Phase7Config)
  │
  ├─ 2. Extract task features from the message (deterministic, no LLM):
  │      - task_type, domain, skill_tags, risk_level
  │      - requires_tools, requires_research, requires_code
  │      - dag_fingerprint (SHA-256 of normalized message)
  │
  ├─ 3. Retrieve memory context from MemoryOrchestrator:
  │      - M1: recent episodes for this chat
  │      - M2: semantically similar prior runs
  │      - M3: active procedural templates
  │
  ├─ 4. Build candidate DAGs from templates + task features
  │
  ├─ 5. Score each candidate:
  │      - similarity score (embedding cosine distance)
  │      - trust score (agent EMA trust history)
  │      - constraint violations (max_parallelism, max_depth, latency_budget)
  │      - mode preference (REUSE > MODIFY > SYNTHESIZE for equal scores)
  │
  ├─ 6. Select winner → emit PLANNER_DECISION_MADE event
  │
  └─ 7. On any error → PLANNER_FALLBACK_USED, use default DAG
```

---

## Scoring

Candidates are scored by `scoreCandidates()` in `packages/runtime/src/meta-planner/scoring.ts`.

Scoring factors:
- **Similarity** — cosine similarity between task embedding and template embedding
- **Trust** — agent trust score from the most recent `TRUST_UPDATED` event
- **Constraint penalty** — applied when the candidate violates explicit constraints
- **Mode weight** — REUSE candidates receive a small preference bonus over SYNTHESIZE

The winning candidate is the highest-scored after constraint filtering.

---

## Constraints

`PlannerConstraintSet` (from `packages/contracts/src/meta-planner.ts`) controls the planning boundary:

```typescript
{
  max_parallelism:            number   // max concurrent nodes in the DAG
  max_depth:                  number   // longest dependency path
  latency_budget_ms:          number   // target ceiling in ms
  regulated_domain:           boolean  // require extra validation nodes
  require_security_review:    boolean  // force PATCH_REVIEW node
  allow_dag_synthesis:        boolean  // allow SYNTHESIZE mode
  allow_pattern_reuse:        boolean  // allow REUSE mode
  allow_pattern_modification: boolean  // allow MODIFY mode
}
```

---

## Events

The planner emits these events into the run's event log:

| Event | When |
|---|---|
| `PLANNER_STARTED` | Planner invocation begins |
| `PLANNER_CONTEXT_RETRIEVED` | Memory context fetched |
| `PLANNER_CANDIDATES_BUILT` | Candidates ready for scoring |
| `PLANNER_DECISION_MADE` | Winner selected; carries mode + selected_dag_id |
| `PLANNER_FALLBACK_USED` | Planner failed; default DAG used |

---

## Configuration

The planner is controlled by Phase 7 feature flags read from environment variables:

| Env var | Default | Effect |
|---|---|---|
| `ENABLE_REPLANNING` | `false` | Master switch for Meta-Planner |
| `MAX_PLANNER_LOOPS` | `3` | Max re-plan iterations per run |

When `ENABLE_REPLANNING=false`, `planDagForRun()` returns the default DAG immediately (BYPASS mode) without touching memory or emitting planner events.

---

## Source Files

```
packages/runtime/src/meta-planner/
├── index.ts              Barrel export
├── meta-planner.ts       planDagForRun() — top-level orchestration
├── candidate-builder.ts  Builds DagSpec candidates from M3 templates
├── scoring.ts            Scores and ranks candidates
├── evaluation.ts         Extracts scalar features from planner results
├── task-features.ts      Deterministic feature extraction + DAG fingerprinting
├── constraints.ts        Constraint validation against PlannerConstraintSet
└── types.ts              Internal planner types (PlannerCandidate, etc.)
```
