// Cognitive Runtime © 2026 by Donald Dominko
// Licensed under CC BY-NC-SA 4.0
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/contracts/src/event-types.ts
// Single source of truth for all RunEvent type string constants.
// Phase 4 adds 4 new constants. Phase 5 adds 6 MEMORY_* constants.
// Phase 6 adds 8 META_PLANNER_* constants.
// Phase 7 adds 15 new constants for production hardening, code-change, replan, policy.

export const RUN_EVENT_TYPES = {
  // ── Phase 1-2 events ────────────────────────────────────────────────────
  RUN_CREATED:                'RUN_CREATED',               // run record created
  USER_MESSAGE_RECORDED:      'USER_MESSAGE_RECORDED',     // user message persisted
  LLM_REQUESTED:              'LLM_REQUESTED',             // LLM call initiated
  LLM_STREAM_STARTED:         'LLM_STREAM_STARTED',        // streaming started
  LLM_STREAM_TOKEN:           'LLM_STREAM_TOKEN',          // individual token streamed
  LLM_STREAM_COMPLETED:       'LLM_STREAM_COMPLETED',      // stream finished
  LLM_COMPLETED:              'LLM_COMPLETED',             // LLM call fully done with latency
  RUNTIME_ERROR:              'RUNTIME_ERROR',             // unrecoverable worker error
  VALIDATION_ERROR:           'VALIDATION_ERROR',          // schema validation failed
  RUN_COMPLETED:              'RUN_COMPLETED',             // final run outcome

  // ── Phase 3B events ──────────────────────────────────────────────────────
  RUN_STATUS_CHANGED:         'RUN_STATUS_CHANGED',        // run lifecycle transition
  RUN_ENQUEUED:               'RUN_ENQUEUED',              // job pushed to BullMQ queue
  WORKER_STARTED:             'WORKER_STARTED',            // worker picked up the job
  WORKER_HEARTBEAT:           'WORKER_HEARTBEAT',          // worker alive pulse
  DAG_PLANNED:                'DAG_PLANNED',               // DAG nodes determined
  NODE_QUEUED:                'NODE_QUEUED',               // node ready to execute
  NODE_STARTED:               'NODE_STARTED',             // node execution began
  NODE_SUCCEEDED:             'NODE_SUCCEEDED',            // node completed successfully
  NODE_FAILED:                'NODE_FAILED',               // node execution failed
  NODE_RETRY_SCHEDULED:       'NODE_RETRY_SCHEDULED',      // retry delay scheduled
  DAG_COMPLETED:              'DAG_COMPLETED',             // all nodes resolved

  // ── Phase 3C events ──────────────────────────────────────────────────────
  REPLY_CONSTRAINT_EVALUATED: 'REPLY_CONSTRAINT_EVALUATED', // reply enforcement audit

  // ── Phase 3 item 4 events ─────────────────────────────────────────────────
  LAYER_ENTERED:              'LAYER_ENTERED',             // executor entered a layer
  LAYER_EXITED:               'LAYER_EXITED',              // executor exited a layer

  // ── Phase 4: Reward Agent events ─────────────────────────────────────────
  REWARD_AGENT_STARTED:       'REWARD_AGENT_STARTED',      // reward block started post-DAG
  REWARD_COMPUTED:            'REWARD_COMPUTED',           // composite score + routing stored
  TRUST_UPDATED:              'TRUST_UPDATED',             // agent trust EMA recalculated
  REWARD_AGENT_COMPLETED:     'REWARD_AGENT_COMPLETED',    // reward block fully done

  // ── Phase 5: Memory Plane events ─────────────────────────────────────────
  MEMORY_WRITE_REQUESTED:     'MEMORY_WRITE_REQUESTED',    // memory write intent recorded
  MEMORY_WRITTEN:             'MEMORY_WRITTEN',            // memory record persisted
  MEMORY_INDEXED:             'MEMORY_INDEXED',            // M2 record indexed in Qdrant
  MEMORY_RETRIEVED:           'MEMORY_RETRIEVED',          // memory search completed
  MEMORY_SKIPPED:             'MEMORY_SKIPPED',            // justified no-op (no write needed)
  RUN_CONTEXT_PREPARED:       'RUN_CONTEXT_PREPARED',      // pre-run context assembled from M1/M2/M3

  // ── Phase 6: Meta-Planner events ─────────────────────────────────────────
  META_PLANNER_STARTED:          'META_PLANNER_STARTED',          // planner invocation began
  META_PLANNER_CONTEXT_RETRIEVED:'META_PLANNER_CONTEXT_RETRIEVED',// planner context fetched
  META_PLANNER_CANDIDATE_BUILT:  'META_PLANNER_CANDIDATE_BUILT',  // candidate DAG generated
  META_PLANNER_DECISION_MADE:    'META_PLANNER_DECISION_MADE',    // winner selected
  META_PLANNER_SKIPPED:          'META_PLANNER_SKIPPED',          // planner skipped (disabled/no context)
  META_PLANNER_FALLBACK_USED:    'META_PLANNER_FALLBACK_USED',    // planner failed, default used
  META_PLANNER_EVALUATED:        'META_PLANNER_EVALUATED',        // post-run evaluation of prediction
  META_PLANNER_FAILED:           'META_PLANNER_FAILED',           // planner error recorded

  // ── Phase 7: Production Hardening events ─────────────────────────────────
  RUN_CANCEL_REQUESTED:          'RUN_CANCEL_REQUESTED',          // cancellation requested via API/timeout/policy
  RUN_CANCELLED:                 'RUN_CANCELLED',                 // run was cancelled
  RUN_TIMEOUT_REACHED:           'RUN_TIMEOUT_REACHED',           // run exceeded timeout
  RUN_STALE_DETECTED:            'RUN_STALE_DETECTED',            // worker heartbeat expired
  RUN_CLASSIFIED_FAILED:         'RUN_CLASSIFIED_FAILED',         // failed run classified (dead-letter/transient/etc)

  // ── Phase 7: Richer Planning Loop events ─────────────────────────────────
  META_PLANNER_REPLAN_REQUESTED: 'META_PLANNER_REPLAN_REQUESTED', // replan triggered after underperformance
  META_PLANNER_REPLAN_DECIDED:   'META_PLANNER_REPLAN_DECIDED',   // replan decision made (yes/no)
  META_PLANNER_REPLAN_EXHAUSTED: 'META_PLANNER_REPLAN_EXHAUSTED', // replan loop count exceeded

  // ── Phase 7: Policy Gate event ───────────────────────────────────────────
  POLICY_EVALUATED:              'POLICY_EVALUATED',              // policy gate decision recorded

  // ── Phase 7: Code-Change Workflow events ─────────────────────────────────
  CODEBASE_ANALYZED:             'CODEBASE_ANALYZED',             // codebase analysis completed
  PATCH_PLAN_CREATED:            'PATCH_PLAN_CREATED',            // patch plan generated
  PATCH_SIMULATION_APPLIED:      'PATCH_SIMULATION_APPLIED',      // patch applied in sandbox
  BUILD_VERIFIED:                'BUILD_VERIFIED',                // build verification ran
  TESTS_VERIFIED:                'TESTS_VERIFIED',                // test verification ran
  PATCH_REVIEW_COMPLETED:        'PATCH_REVIEW_COMPLETED',        // patch review completed
} as const; // freeze as readonly record of string literals

// Derive the union type from the values of RUN_EVENT_TYPES.
export type RunEventType = (typeof RUN_EVENT_TYPES)[keyof typeof RUN_EVENT_TYPES];

// Tuple used by zRunEventType (z.enum requires a non-empty tuple).
// ORDER MUST match zRunEvent discriminated union entries in events.ts.
export const RUN_EVENT_TYPE_VALUES = [
  RUN_EVENT_TYPES.RUN_CREATED,
  RUN_EVENT_TYPES.USER_MESSAGE_RECORDED,
  RUN_EVENT_TYPES.LLM_REQUESTED,
  RUN_EVENT_TYPES.LLM_STREAM_STARTED,
  RUN_EVENT_TYPES.LLM_STREAM_TOKEN,
  RUN_EVENT_TYPES.LLM_STREAM_COMPLETED,
  RUN_EVENT_TYPES.LLM_COMPLETED,
  RUN_EVENT_TYPES.RUNTIME_ERROR,
  RUN_EVENT_TYPES.VALIDATION_ERROR,
  RUN_EVENT_TYPES.RUN_COMPLETED,
  RUN_EVENT_TYPES.RUN_STATUS_CHANGED,
  RUN_EVENT_TYPES.RUN_ENQUEUED,
  RUN_EVENT_TYPES.WORKER_STARTED,
  RUN_EVENT_TYPES.WORKER_HEARTBEAT,
  RUN_EVENT_TYPES.DAG_PLANNED,
  RUN_EVENT_TYPES.NODE_QUEUED,
  RUN_EVENT_TYPES.NODE_STARTED,
  RUN_EVENT_TYPES.NODE_SUCCEEDED,
  RUN_EVENT_TYPES.NODE_FAILED,
  RUN_EVENT_TYPES.NODE_RETRY_SCHEDULED,
  RUN_EVENT_TYPES.DAG_COMPLETED,
  RUN_EVENT_TYPES.REPLY_CONSTRAINT_EVALUATED,
  RUN_EVENT_TYPES.LAYER_ENTERED,
  RUN_EVENT_TYPES.LAYER_EXITED,
  // Phase 4 additions — appended to end of tuple, existing indices unchanged
  RUN_EVENT_TYPES.REWARD_AGENT_STARTED,
  RUN_EVENT_TYPES.REWARD_COMPUTED,
  RUN_EVENT_TYPES.TRUST_UPDATED,
  RUN_EVENT_TYPES.REWARD_AGENT_COMPLETED,
  // Phase 5 additions — appended to end of tuple, existing indices unchanged
  RUN_EVENT_TYPES.MEMORY_WRITE_REQUESTED,
  RUN_EVENT_TYPES.MEMORY_WRITTEN,
  RUN_EVENT_TYPES.MEMORY_INDEXED,
  RUN_EVENT_TYPES.MEMORY_RETRIEVED,
  RUN_EVENT_TYPES.MEMORY_SKIPPED,
  RUN_EVENT_TYPES.RUN_CONTEXT_PREPARED,
  // Phase 6 additions — appended to end of tuple, existing indices unchanged
  RUN_EVENT_TYPES.META_PLANNER_STARTED,
  RUN_EVENT_TYPES.META_PLANNER_CONTEXT_RETRIEVED,
  RUN_EVENT_TYPES.META_PLANNER_CANDIDATE_BUILT,
  RUN_EVENT_TYPES.META_PLANNER_DECISION_MADE,
  RUN_EVENT_TYPES.META_PLANNER_SKIPPED,
  RUN_EVENT_TYPES.META_PLANNER_FALLBACK_USED,
  RUN_EVENT_TYPES.META_PLANNER_EVALUATED,
  RUN_EVENT_TYPES.META_PLANNER_FAILED,
  // Phase 7 additions — appended to end of tuple, existing indices unchanged
  RUN_EVENT_TYPES.RUN_CANCEL_REQUESTED,
  RUN_EVENT_TYPES.RUN_CANCELLED,
  RUN_EVENT_TYPES.RUN_TIMEOUT_REACHED,
  RUN_EVENT_TYPES.RUN_STALE_DETECTED,
  RUN_EVENT_TYPES.RUN_CLASSIFIED_FAILED,
  RUN_EVENT_TYPES.META_PLANNER_REPLAN_REQUESTED,
  RUN_EVENT_TYPES.META_PLANNER_REPLAN_DECIDED,
  RUN_EVENT_TYPES.META_PLANNER_REPLAN_EXHAUSTED,
  RUN_EVENT_TYPES.POLICY_EVALUATED,
  RUN_EVENT_TYPES.CODEBASE_ANALYZED,
  RUN_EVENT_TYPES.PATCH_PLAN_CREATED,
  RUN_EVENT_TYPES.PATCH_SIMULATION_APPLIED,
  RUN_EVENT_TYPES.BUILD_VERIFIED,
  RUN_EVENT_TYPES.TESTS_VERIFIED,
  RUN_EVENT_TYPES.PATCH_REVIEW_COMPLETED,
] as const satisfies readonly [RunEventType, ...RunEventType[]]; // compile-time exhaustiveness check

// Set for O(1) membership tests (used by validators).
export const RUN_EVENT_TYPE_SET: ReadonlySet<RunEventType> = new Set(RUN_EVENT_TYPE_VALUES);
