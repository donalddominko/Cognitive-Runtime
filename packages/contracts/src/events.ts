// Cognitive Runtime © 2026 by Donald Dominko
// Licensed under CC BY-NC-SA 4.0
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/contracts/src/events.ts
// Discriminated union of all RunEvents. Phase 4 adds 4 new union entries + imports from reward.ts.
// Phase 5 adds 6 new union entries for memory operations + imports from memory.ts.
// Phase 6 adds 8 new union entries for meta-planner operations + imports from meta-planner.ts.
// Phase 7 adds 15 new union entries for hardening, replan, policy, code-change + imports from phase7.ts.
// IMPORTANT: the existing 42 entries are untouched — only 15 new entries are appended.

import { z } from 'zod';
import { zISODateString, zUUID, zRole } from './common.js';          // shared primitives
import { zGlobalEnvelope, type GlobalEnvelope } from './envelope.js'; // transport envelope
import { zNodeKind, zRunStatus } from './dag.js';                     // DAG type imports
import { RUN_EVENT_TYPE_VALUES, type RunEventType as CanonicalRunEventType } from './event-types.js'; // type constants
// Phase 4: import the 4 new data schemas from reward.ts
import {
  zRewardAgentStartedData,  // data schema for REWARD_AGENT_STARTED
  zRewardComputedData,       // data schema for REWARD_COMPUTED
  zTrustUpdatedData,         // data schema for TRUST_UPDATED
  zRewardAgentCompletedData, // data schema for REWARD_AGENT_COMPLETED
} from './reward.js';
// Phase 5: import the 6 new data schemas from memory.ts
import {
  zMemoryWriteRequestedData,  // data schema for MEMORY_WRITE_REQUESTED
  zMemoryWrittenData,          // data schema for MEMORY_WRITTEN
  zMemoryIndexedData,          // data schema for MEMORY_INDEXED
  zMemoryRetrievedData,        // data schema for MEMORY_RETRIEVED
  zMemorySkippedData,          // data schema for MEMORY_SKIPPED
  zRunContextPreparedData,     // data schema for RUN_CONTEXT_PREPARED
} from './memory.js';
// Phase 6: import the 8 new data schemas from meta-planner.ts
import {
  zMetaPlannerStartedData,           // data schema for META_PLANNER_STARTED
  zMetaPlannerContextRetrievedData,  // data schema for META_PLANNER_CONTEXT_RETRIEVED
  zMetaPlannerCandidateBuiltData,    // data schema for META_PLANNER_CANDIDATE_BUILT
  zMetaPlannerDecisionMadeData,      // data schema for META_PLANNER_DECISION_MADE
  zMetaPlannerSkippedData,           // data schema for META_PLANNER_SKIPPED
  zMetaPlannerFallbackUsedData,      // data schema for META_PLANNER_FALLBACK_USED
  zMetaPlannerEvaluatedData,         // data schema for META_PLANNER_EVALUATED
  zMetaPlannerFailedData,            // data schema for META_PLANNER_FAILED
} from './meta-planner.js';
// Phase 7: import the 15 new data schemas from phase7.ts
import {
  zRunCancelRequestedData,              // data schema for RUN_CANCEL_REQUESTED
  zRunCancelledData,                     // data schema for RUN_CANCELLED
  zRunTimeoutReachedData,                // data schema for RUN_TIMEOUT_REACHED
  zRunStaleDetectedData,                 // data schema for RUN_STALE_DETECTED
  zRunClassifiedFailedData,              // data schema for RUN_CLASSIFIED_FAILED
  zMetaPlannerReplanRequestedData,       // data schema for META_PLANNER_REPLAN_REQUESTED
  zMetaPlannerReplanDecidedData,         // data schema for META_PLANNER_REPLAN_DECIDED
  zMetaPlannerReplanExhaustedData,       // data schema for META_PLANNER_REPLAN_EXHAUSTED
  zPolicyEvaluatedData,                  // data schema for POLICY_EVALUATED
  zCodebaseAnalyzedData,                 // data schema for CODEBASE_ANALYZED
  zPatchPlanCreatedData,                 // data schema for PATCH_PLAN_CREATED
  zPatchSimulationAppliedData,           // data schema for PATCH_SIMULATION_APPLIED
  zBuildVerifiedData,                    // data schema for BUILD_VERIFIED
  zTestsVerifiedData,                    // data schema for TESTS_VERIFIED
  zPatchReviewCompletedData,             // data schema for PATCH_REVIEW_COMPLETED
} from './phase7.js';

// Re-export the RunEventType (z.enum over all known type strings).
export const zRunEventType = z.enum(RUN_EVENT_TYPE_VALUES);
export type RunEventType = CanonicalRunEventType; // canonical union including Phase 4+5+6+7 types

// ── Data schemas (unchanged from Phase 3) ───────────────────────────────────
// Each schema is exported so routes and workers can import only what they need.

export const zRunCreatedData = z
  .object({
    type:    z.literal('RUN_CREATED').optional(), // optional redundant discriminator in data
    model:   z.string().optional(),               // LLM model name
    provider:z.string().optional(),               // LLM provider name
    trace_id:zUUID.optional(),                    // request trace for distributed tracing
    message: z.string().min(1).optional(),        // original user message stored for replay
  })
  .passthrough(); // allow unknown keys so old readers aren't broken by new fields

export const zUserMessageRecordedData = z
  .object({
    type:        z.literal('USER_MESSAGE_RECORDED').optional(), // optional discriminator echo
    message_id:  zUUID,                          // deterministic UUIDv5 for the message row
    role:        zRole,                          // always 'user' for this event
    content_len: z.number().int().nonnegative(), // byte length of the message
  })
  .passthrough();

export const zLLMRequestedData = z
  .object({
    type:              z.literal('LLM_REQUESTED').optional(), // optional discriminator echo
    provider:          z.string(),                            // e.g. 'qwen'
    model:             z.string(),                            // e.g. 'qwen-2.5-coder-3b'
    prompt_tokens_est: z.number().int().nonnegative().optional(), // estimated prompt tokens
    dag_id:            zUUID.optional(),         // which DAG this node belongs to
    node_id:           z.string().min(1).optional(), // which DAG node
    attempt:           z.number().int().min(1).optional(), // attempt number (1-based)
  })
  .passthrough();

export const zLLMStreamStartedData = z
  .object({
    type:        z.literal('LLM_STREAM_STARTED').optional(), // optional discriminator echo
    token_count: z.number().int().nonnegative().optional(),  // tokens seen so far
  })
  .passthrough();

export const zLLMStreamTokenData = z
  .object({
    type:        z.literal('LLM_STREAM_TOKEN').optional(), // optional discriminator echo
    token:       z.string().optional(),                    // the token text
    token_count: z.number().int().nonnegative().optional(), // cumulative count
  })
  .passthrough();

export const zLLMStreamCompletedData = z
  .object({
    type:        z.literal('LLM_STREAM_COMPLETED').optional(), // optional discriminator echo
    token_count: z.number().int().nonnegative().optional(),    // total tokens generated
  })
  .passthrough();

export const zLLMCompletedData = z
  .object({
    type:       z.literal('LLM_COMPLETED').optional(), // optional discriminator echo
    output_len: z.number().int().nonnegative(),         // character length of completion
    latency_ms: z.number().nonnegative().optional(),   // end-to-end LLM latency — drives PERF signal
    dag_id:     zUUID.optional(),                       // DAG context
    node_id:    z.string().min(1).optional(),           // node context
    attempt:    z.number().int().min(1).optional(),     // attempt context
  })
  .passthrough();

export const zRuntimeErrorData = z
  .object({
    type:    z.literal('RUNTIME_ERROR').optional(), // optional discriminator echo
    code:    z.string(),                            // machine-readable error code
    message: z.string(),                            // human-readable error description
    where:   z.string().optional(),                 // source location hint
    details: z.unknown().optional(),                // arbitrary structured context
  })
  .passthrough();

export const zValidationErrorData = z
  .object({
    type:    z.literal('VALIDATION_ERROR').optional(), // optional discriminator echo
    message: z.string(),                               // top-level error summary
    issues:  z.array(                                  // per-field validation issues
      z.object({
        path:    z.array(z.union([z.string(), z.number()])), // JSON path to the problem
        message: z.string(),                                  // issue description
      })
    ),
  })
  .passthrough();

export const zRunCompletedData = z
  .object({
    type: z.literal('RUN_COMPLETED').optional(), // optional discriminator echo
    ok:   z.boolean(),                           // true = run succeeded end-to-end
  })
  .passthrough();

export const zRunStatusChangedData = z
  .object({
    type: z.literal('RUN_STATUS_CHANGED').optional(), // optional discriminator echo
    from: zRunStatus,                                  // previous status
    to:   zRunStatus,                                  // new status
  })
  .passthrough();

export const zRunEnqueuedData = z
  .object({
    type:   z.literal('RUN_ENQUEUED').optional(), // optional discriminator echo
    queue:  z.literal('runs'),                    // always the 'runs' BullMQ queue
    job_id: z.string().min(1),                   // BullMQ job ID assigned
  })
  .passthrough();

export const zWorkerStartedData = z
  .object({
    type:      z.literal('WORKER_STARTED').optional(), // optional discriminator echo
    worker_id: z.string().min(1),                     // worker process identifier
    version:   z.string().optional(),                  // optional worker version string
  })
  .passthrough();

export const zWorkerHeartbeatData = z
  .object({
    type:      z.literal('WORKER_HEARTBEAT').optional(), // optional discriminator echo
    worker_id: z.string().min(1),                       // worker process identifier
  })
  .passthrough();

export const zDagPlannedData = z
  .object({
    type:            z.literal('DAG_PLANNED').optional(), // optional discriminator echo
    dag_id:          zUUID,                               // the DAG being planned
    node_count:      z.number().int().positive(),         // number of nodes in the plan
    dag_fingerprint: z.string().optional(),                // Phase 6 hardening: deterministic DAG structure hash
  })
  .passthrough();

export const zNodeQueuedData = z
  .object({
    type:    z.literal('NODE_QUEUED').optional(), // optional discriminator echo
    dag_id:  zUUID,                               // parent DAG
    node_id: z.string().min(1),                  // node identifier
    kind:    zNodeKind,                           // node type enum
  })
  .passthrough();

export const zNodeStartedData = z
  .object({
    type:    z.literal('NODE_STARTED').optional(), // optional discriminator echo
    dag_id:  zUUID,                                // parent DAG
    node_id: z.string().min(1),                   // node identifier
    attempt: z.number().int().min(1),             // attempt number (1-based, max 2)
  })
  .passthrough();

export const zNodeSucceededData = z
  .object({
    type:           z.literal('NODE_SUCCEEDED').optional(), // optional discriminator echo
    dag_id:         zUUID,                                   // parent DAG
    node_id:        z.string().min(1),                      // node identifier
    attempt:        z.number().int().min(1),                // which attempt succeeded
    output_summary: z.object({ bytes: z.number().int().min(0).optional() }).optional(), // output size
  })
  .passthrough();

export const zNodeFailedData = z
  .object({
    type:    z.literal('NODE_FAILED').optional(), // optional discriminator echo
    dag_id:  zUUID,                               // parent DAG
    node_id: z.string().min(1),                  // node identifier
    attempt: z.number().int().min(1),            // which attempt failed
    error:   z.object({
      code:    z.string().min(1),  // machine-readable failure code
      message: z.string().min(1), // human-readable failure description
    }),
  })
  .passthrough();

export const zNodeRetryScheduledData = z
  .object({
    type:               z.literal('NODE_RETRY_SCHEDULED').optional(), // optional discriminator echo
    dag_id:             zUUID,                 // parent DAG
    node_id:            z.string().min(1),    // node scheduled for retry
    next_attempt_in_ms: z.number().int().min(0), // backoff delay in milliseconds
  })
  .passthrough();

export const zDagCompletedData = z
  .object({
    type:   z.literal('DAG_COMPLETED').optional(), // optional discriminator echo
    dag_id: zUUID,                                  // the DAG that completed
    ok:     z.boolean(),                            // true = all nodes succeeded
  })
  .passthrough();

export const zReplyConstraintEvaluatedData = z
  .object({
    type:                z.literal('REPLY_CONSTRAINT_EVALUATED').optional(), // optional discriminator echo
    forced_reply:        z.boolean(),        // true = user instruction forced a specific reply
    forced_reply_value:  z.string().optional(), // the forced reply text if applicable
    matched_pattern:     z.string().optional(), // which regex pattern matched
    raw_assistant_text:  z.string(),         // original LLM output before enforcement
    final_assistant_text:z.string(),         // text stored (may equal raw or forced)
    user_instruction:    z.string().optional(), // truncated user message for audit
  })
  .passthrough();

// Layer transition events — zEventLayer is private to avoid re-exporting zLayer clash.
const zEventLayer = z.enum(['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7']); // layers that can be entered/exited

export const zLayerEnteredData = z
  .object({
    type:    z.literal('LAYER_ENTERED').optional(), // optional discriminator echo
    layer:   zEventLayer,                           // which layer was entered
    node_id: z.string().min(1).optional(),          // optional node context
  })
  .passthrough();

export const zLayerExitedData = z
  .object({
    type:    z.literal('LAYER_EXITED').optional(), // optional discriminator echo
    layer:   zEventLayer,                          // which layer was exited
    node_id: z.string().min(1).optional(),         // optional node context
    ok:      z.boolean(),                          // whether the layer exited cleanly
  })
  .passthrough();

// ── Core RunEvent discriminated union ────────────────────────────────────────
// Zod uses the top-level `type` field as the discriminator key.
// Phase 4 adds 4 entries at the end — existing entries and their positions are untouched.
// Phase 5 adds 6 entries at the end for memory operations.
// Phase 6 adds 8 entries at the end for meta-planner operations.
// Phase 7 adds 15 entries at the end for hardening, replan, policy, code-change.

const zBaseEvent = z.object({
  ts:       zISODateString,            // ISO-8601 timestamp of when the event was created
  run_id:   zUUID,                     // the run this event belongs to
  chat_id:  zUUID,                     // the chat session this run belongs to
  envelope: zGlobalEnvelope.optional(), // optional transport/routing envelope
});

export const zRunEvent = z.discriminatedUnion('type', [
  // ── Phase 1-2 ──────────────────────────────────────────────────────────
  zBaseEvent.extend({ type: z.literal('RUN_CREATED'),            data: zRunCreatedData }),
  zBaseEvent.extend({ type: z.literal('USER_MESSAGE_RECORDED'),  data: zUserMessageRecordedData }),
  zBaseEvent.extend({ type: z.literal('LLM_REQUESTED'),          data: zLLMRequestedData }),
  zBaseEvent.extend({ type: z.literal('LLM_STREAM_STARTED'),     data: zLLMStreamStartedData }),
  zBaseEvent.extend({ type: z.literal('LLM_STREAM_TOKEN'),       data: zLLMStreamTokenData }),
  zBaseEvent.extend({ type: z.literal('LLM_STREAM_COMPLETED'),   data: zLLMStreamCompletedData }),
  zBaseEvent.extend({ type: z.literal('LLM_COMPLETED'),          data: zLLMCompletedData }),
  zBaseEvent.extend({ type: z.literal('RUNTIME_ERROR'),          data: zRuntimeErrorData }),
  zBaseEvent.extend({ type: z.literal('VALIDATION_ERROR'),       data: zValidationErrorData }),
  zBaseEvent.extend({ type: z.literal('RUN_COMPLETED'),          data: zRunCompletedData }),
  // ── Phase 3B ───────────────────────────────────────────────────────────
  zBaseEvent.extend({ type: z.literal('RUN_STATUS_CHANGED'),     data: zRunStatusChangedData }),
  zBaseEvent.extend({ type: z.literal('RUN_ENQUEUED'),           data: zRunEnqueuedData }),
  zBaseEvent.extend({ type: z.literal('WORKER_STARTED'),         data: zWorkerStartedData }),
  zBaseEvent.extend({ type: z.literal('WORKER_HEARTBEAT'),       data: zWorkerHeartbeatData }),
  zBaseEvent.extend({ type: z.literal('DAG_PLANNED'),            data: zDagPlannedData }),
  zBaseEvent.extend({ type: z.literal('NODE_QUEUED'),            data: zNodeQueuedData }),
  zBaseEvent.extend({ type: z.literal('NODE_STARTED'),           data: zNodeStartedData }),
  zBaseEvent.extend({ type: z.literal('NODE_SUCCEEDED'),         data: zNodeSucceededData }),
  zBaseEvent.extend({ type: z.literal('NODE_FAILED'),            data: zNodeFailedData }),
  zBaseEvent.extend({ type: z.literal('NODE_RETRY_SCHEDULED'),   data: zNodeRetryScheduledData }),
  zBaseEvent.extend({ type: z.literal('DAG_COMPLETED'),          data: zDagCompletedData }),
  // ── Phase 3C ───────────────────────────────────────────────────────────
  zBaseEvent.extend({ type: z.literal('REPLY_CONSTRAINT_EVALUATED'), data: zReplyConstraintEvaluatedData }),
  // ── Phase 3 item 4 ─────────────────────────────────────────────────────
  zBaseEvent.extend({ type: z.literal('LAYER_ENTERED'),          data: zLayerEnteredData }),
  zBaseEvent.extend({ type: z.literal('LAYER_EXITED'),           data: zLayerExitedData }),
  // ── Phase 4: Reward Agent ──────────────────────────────────────────────
  zBaseEvent.extend({ type: z.literal('REWARD_AGENT_STARTED'),   data: zRewardAgentStartedData }),
  zBaseEvent.extend({ type: z.literal('REWARD_COMPUTED'),        data: zRewardComputedData }),
  zBaseEvent.extend({ type: z.literal('TRUST_UPDATED'),          data: zTrustUpdatedData }),
  zBaseEvent.extend({ type: z.literal('REWARD_AGENT_COMPLETED'), data: zRewardAgentCompletedData }),
  // ── Phase 5: Memory Plane ─────────────────────────────────────────────
  zBaseEvent.extend({ type: z.literal('MEMORY_WRITE_REQUESTED'), data: zMemoryWriteRequestedData }),
  zBaseEvent.extend({ type: z.literal('MEMORY_WRITTEN'),         data: zMemoryWrittenData }),
  zBaseEvent.extend({ type: z.literal('MEMORY_INDEXED'),         data: zMemoryIndexedData }),
  zBaseEvent.extend({ type: z.literal('MEMORY_RETRIEVED'),       data: zMemoryRetrievedData }),
  zBaseEvent.extend({ type: z.literal('MEMORY_SKIPPED'),         data: zMemorySkippedData }),
  zBaseEvent.extend({ type: z.literal('RUN_CONTEXT_PREPARED'),   data: zRunContextPreparedData }),
  // ── Phase 6: Meta-Planner ─────────────────────────────────────────────
  zBaseEvent.extend({ type: z.literal('META_PLANNER_STARTED'),           data: zMetaPlannerStartedData }),
  zBaseEvent.extend({ type: z.literal('META_PLANNER_CONTEXT_RETRIEVED'), data: zMetaPlannerContextRetrievedData }),
  zBaseEvent.extend({ type: z.literal('META_PLANNER_CANDIDATE_BUILT'),   data: zMetaPlannerCandidateBuiltData }),
  zBaseEvent.extend({ type: z.literal('META_PLANNER_DECISION_MADE'),     data: zMetaPlannerDecisionMadeData }),
  zBaseEvent.extend({ type: z.literal('META_PLANNER_SKIPPED'),           data: zMetaPlannerSkippedData }),
  zBaseEvent.extend({ type: z.literal('META_PLANNER_FALLBACK_USED'),     data: zMetaPlannerFallbackUsedData }),
  zBaseEvent.extend({ type: z.literal('META_PLANNER_EVALUATED'),         data: zMetaPlannerEvaluatedData }),
  zBaseEvent.extend({ type: z.literal('META_PLANNER_FAILED'),            data: zMetaPlannerFailedData }),
  // ── Phase 7: Production Hardening ─────────────────────────────────────
  zBaseEvent.extend({ type: z.literal('RUN_CANCEL_REQUESTED'),          data: zRunCancelRequestedData }),
  zBaseEvent.extend({ type: z.literal('RUN_CANCELLED'),                 data: zRunCancelledData }),
  zBaseEvent.extend({ type: z.literal('RUN_TIMEOUT_REACHED'),           data: zRunTimeoutReachedData }),
  zBaseEvent.extend({ type: z.literal('RUN_STALE_DETECTED'),            data: zRunStaleDetectedData }),
  zBaseEvent.extend({ type: z.literal('RUN_CLASSIFIED_FAILED'),         data: zRunClassifiedFailedData }),
  // ── Phase 7: Richer Planning Loops ────────────────────────────────────
  zBaseEvent.extend({ type: z.literal('META_PLANNER_REPLAN_REQUESTED'), data: zMetaPlannerReplanRequestedData }),
  zBaseEvent.extend({ type: z.literal('META_PLANNER_REPLAN_DECIDED'),   data: zMetaPlannerReplanDecidedData }),
  zBaseEvent.extend({ type: z.literal('META_PLANNER_REPLAN_EXHAUSTED'), data: zMetaPlannerReplanExhaustedData }),
  // ── Phase 7: Policy Gate ──────────────────────────────────────────────
  zBaseEvent.extend({ type: z.literal('POLICY_EVALUATED'),              data: zPolicyEvaluatedData }),
  // ── Phase 7: Code-Change Workflow ─────────────────────────────────────
  zBaseEvent.extend({ type: z.literal('CODEBASE_ANALYZED'),             data: zCodebaseAnalyzedData }),
  zBaseEvent.extend({ type: z.literal('PATCH_PLAN_CREATED'),            data: zPatchPlanCreatedData }),
  zBaseEvent.extend({ type: z.literal('PATCH_SIMULATION_APPLIED'),      data: zPatchSimulationAppliedData }),
  zBaseEvent.extend({ type: z.literal('BUILD_VERIFIED'),                data: zBuildVerifiedData }),
  zBaseEvent.extend({ type: z.literal('TESTS_VERIFIED'),                data: zTestsVerifiedData }),
  zBaseEvent.extend({ type: z.literal('PATCH_REVIEW_COMPLETED'),        data: zPatchReviewCompletedData }),
]);

export type RunEvent = z.infer<typeof zRunEvent>; // TypeScript type for any valid run event

// Legacy alias — kept for backwards compatibility with existing code that imports RunEventSchema.
export const RunEventSchema = zRunEvent;

// Helper that builds a typed RunEvent with an automatic timestamp.
// Generic over T constrains data to exactly the right shape for that type.
export function createRunEvent<T extends RunEventType>(
  runId: string,      // UUID of the run
  chatId: string,     // UUID of the chat session
  type: T,            // event type discriminator
  data: Extract<RunEvent, { type: T }>['data'], // type-safe data payload
  envelope?: GlobalEnvelope // optional transport envelope
): Extract<RunEvent, { type: T }> {
  return {
    ts:      new Date().toISOString(), // ISO timestamp at creation time
    run_id:  runId,                    // bind event to run
    chat_id: chatId,                   // bind event to chat
    type,                              // discriminator key for the union
    data,                              // validated payload
    envelope,                          // optional envelope passthrough
  } as Extract<RunEvent, { type: T }>; // cast needed because TS can't narrow through generics
}
