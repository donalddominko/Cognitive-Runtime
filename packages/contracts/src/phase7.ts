// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/contracts/src/phase7.ts
// Phase 7: Production Hardening + Code-Change Workflow + Richer Planning + Policy Gate
// All Phase 7 data schemas and types live here.
// Validated at every API and storage boundary.

import { z } from 'zod';                              // runtime schema validation
import { zISODateString } from './common.js';  // shared primitives

// ── 1) Phase 7 Feature Flags Schema ────────────────────────────────────────
// All new Phase 7 behavior is configurable and disableable.
export const zPhase7Config = z.object({
  enable_code_change_workflow: z.boolean().default(false),    // master switch for code-change DAGs
  enable_replanning:           z.boolean().default(false),    // master switch for replan loops
  enable_policy_gate:          z.boolean().default(false),    // master switch for policy evaluation
  enable_run_cancellation:     z.boolean().default(true),     // allow run cancel API
  max_planner_loops:           z.number().int().min(1).max(10).default(3), // bounded replan count
  run_timeout_ms:              z.number().int().min(0).default(300000),    // 5 min default timeout
  stale_heartbeat_ms:          z.number().int().min(0).default(60000),    // 60s heartbeat expiry
});
export type Phase7Config = z.infer<typeof zPhase7Config>;

// ── 2) Risk Classification ──────────────────────────────────────────────────
export const zActionRisk = z.enum([
  'LOW',       // no special review needed
  'MEDIUM',    // proceed with logging
  'HIGH',      // requires policy gate evaluation
  'CRITICAL',  // blocked unless explicitly allowed
]);
export type ActionRisk = z.infer<typeof zActionRisk>;

// ── 3) Policy Decision ─────────────────────────────────────────────────────
export const zPolicyVerdict = z.enum([
  'ALLOWED',         // action may proceed
  'BLOCKED',         // action is denied
  'REQUIRE_REVIEW',  // action needs human/machine review before proceeding
]);
export type PolicyVerdict = z.infer<typeof zPolicyVerdict>;

// ── 4) Failed Run Classification ────────────────────────────────────────────
export const zFailedRunClass = z.enum([
  'TRANSIENT',       // temporary failure (timeout, network), may retry
  'PERMANENT',       // permanent failure (bad input, policy block)
  'DEAD_LETTER',     // exhausted retries, moved to dead-letter
  'CANCELLED',       // user/system cancelled
  'STALE',           // heartbeat expired, worker died
]);
export type FailedRunClass = z.infer<typeof zFailedRunClass>;

// ── 5) Code-Change Patch Artifact ───────────────────────────────────────────
export const zPatchArtifact = z.object({
  file_path:    z.string().min(1).max(1000),                 // relative file path
  operation:    z.enum(['CREATE', 'MODIFY', 'DELETE']),      // type of change
  diff_summary: z.string().max(5000).optional(),             // short diff description
  content_hash: z.string().max(128).optional(),              // SHA-256 of new content
  line_count:   z.number().int().min(0).optional(),          // lines affected
});
export type PatchArtifact = z.infer<typeof zPatchArtifact>;

// ── 6) Build/Test Verification Result ───────────────────────────────────────
export const zVerificationResult = z.object({
  passed:       z.boolean(),                                  // overall pass/fail
  exit_code:    z.number().int().optional(),                  // process exit code
  stdout_tail:  z.string().max(2000).optional(),             // last N chars of stdout
  stderr_tail:  z.string().max(2000).optional(),             // last N chars of stderr
  duration_ms:  z.number().int().min(0).optional(),          // how long verification took
  test_count:   z.number().int().min(0).optional(),          // number of tests run
  fail_count:   z.number().int().min(0).optional(),          // number of tests failed
});
export type VerificationResult = z.infer<typeof zVerificationResult>;

// ── 7) RUN_CANCEL_REQUESTED event data ──────────────────────────────────────
export const zRunCancelRequestedData = z.object({
  type:      z.literal('RUN_CANCEL_REQUESTED').optional(),    // optional discriminator echo
  reason:    z.string().min(1).max(1000),                     // why cancellation was requested
  source:    z.enum(['API', 'TIMEOUT', 'POLICY', 'SYSTEM']), // who/what requested it
}).passthrough();
export type RunCancelRequestedData = z.infer<typeof zRunCancelRequestedData>;

// ── 8) RUN_CANCELLED event data ─────────────────────────────────────────────
export const zRunCancelledData = z.object({
  type:               z.literal('RUN_CANCELLED').optional(),  // optional discriminator echo
  reason:             z.string().min(1).max(1000),            // cancellation reason
  cancelled_at_node:  z.string().optional(),                  // which node was active when cancelled
}).passthrough();
export type RunCancelledData = z.infer<typeof zRunCancelledData>;

// ── 9) RUN_TIMEOUT_REACHED event data ───────────────────────────────────────
export const zRunTimeoutReachedData = z.object({
  type:          z.literal('RUN_TIMEOUT_REACHED').optional(), // optional discriminator echo
  timeout_ms:    z.number().int().min(0),                     // configured timeout value
  elapsed_ms:    z.number().int().min(0),                     // actual elapsed time
  active_node:   z.string().optional(),                       // which node was active
}).passthrough();
export type RunTimeoutReachedData = z.infer<typeof zRunTimeoutReachedData>;

// ── 10) RUN_STALE_DETECTED event data ───────────────────────────────────────
export const zRunStaleDetectedData = z.object({
  type:                z.literal('RUN_STALE_DETECTED').optional(), // optional discriminator echo
  last_heartbeat_ts:   zISODateString.optional(),                  // when last heartbeat was seen
  stale_threshold_ms:  z.number().int().min(0),                    // configured threshold
  elapsed_since_hb_ms: z.number().int().min(0),                    // time since last heartbeat
}).passthrough();
export type RunStaleDetectedData = z.infer<typeof zRunStaleDetectedData>;

// ── 11) RUN_CLASSIFIED_FAILED event data ────────────────────────────────────
export const zRunClassifiedFailedData = z.object({
  type:            z.literal('RUN_CLASSIFIED_FAILED').optional(), // optional discriminator echo
  classification:  zFailedRunClass,                               // failure classification
  reason:          z.string().min(1).max(2000),                   // why this classification
  retriable:       z.boolean(),                                   // whether the run can be retried
}).passthrough();
export type RunClassifiedFailedData = z.infer<typeof zRunClassifiedFailedData>;

// ── 12) META_PLANNER_REPLAN_REQUESTED event data ────────────────────────────
export const zMetaPlannerReplanRequestedData = z.object({
  type:             z.literal('META_PLANNER_REPLAN_REQUESTED').optional(),
  loop_index:       z.number().int().min(0),                      // which replan iteration (0-based)
  trigger_reason:   z.string().min(1).max(1000),                  // why replan was triggered
  prior_dag_ok:     z.boolean(),                                  // did the prior DAG succeed
  prior_reward:     z.number().min(0).max(1).optional(),          // prior run reward if available
}).passthrough();
export type MetaPlannerReplanRequestedData = z.infer<typeof zMetaPlannerReplanRequestedData>;

// ── 13) META_PLANNER_REPLAN_DECIDED event data ──────────────────────────────
export const zMetaPlannerReplanDecidedData = z.object({
  type:                z.literal('META_PLANNER_REPLAN_DECIDED').optional(),
  loop_index:          z.number().int().min(0),                   // which replan iteration
  should_replan:       z.boolean(),                               // whether to actually replan
  rationale:           z.string().min(1).max(2000),               // decision reasoning
  new_dag_fingerprint: z.string().optional(),                     // fingerprint of new DAG if replanning
}).passthrough();
export type MetaPlannerReplanDecidedData = z.infer<typeof zMetaPlannerReplanDecidedData>;

// ── 14) META_PLANNER_REPLAN_EXHAUSTED event data ────────────────────────────
export const zMetaPlannerReplanExhaustedData = z.object({
  type:           z.literal('META_PLANNER_REPLAN_EXHAUSTED').optional(),
  total_loops:    z.number().int().min(0),                        // how many loops were attempted
  max_loops:      z.number().int().min(1),                        // configured maximum
  last_reward:    z.number().min(0).max(1).optional(),            // last recorded reward
}).passthrough();
export type MetaPlannerReplanExhaustedData = z.infer<typeof zMetaPlannerReplanExhaustedData>;

// ── 15) POLICY_EVALUATED event data ─────────────────────────────────────────
export const zPolicyEvaluatedData = z.object({
  type:           z.literal('POLICY_EVALUATED').optional(),       // optional discriminator echo
  action:         z.string().min(1).max(500),                     // what action was evaluated
  risk_level:     zActionRisk,                                    // classified risk
  verdict:        zPolicyVerdict,                                 // allowed / blocked / require_review
  rules_checked:  z.array(z.string().min(1).max(200)),            // which rules were evaluated
  rationale:      z.string().min(1).max(2000),                    // why this verdict
  dag_type:       z.string().optional(),                          // which DAG type triggered this
}).passthrough();
export type PolicyEvaluatedData = z.infer<typeof zPolicyEvaluatedData>;

// ── 16) CODEBASE_ANALYZED event data ────────────────────────────────────────
export const zCodebaseAnalyzedData = z.object({
  type:            z.literal('CODEBASE_ANALYZED').optional(),     // optional discriminator echo
  target_files:    z.array(z.string().min(1).max(1000)),          // files analyzed
  analysis_summary:z.string().min(1).max(5000),                   // what was found
  file_count:      z.number().int().min(0),                       // total files analyzed
}).passthrough();
export type CodebaseAnalyzedData = z.infer<typeof zCodebaseAnalyzedData>;

// ── 17) PATCH_PLAN_CREATED event data ───────────────────────────────────────
export const zPatchPlanCreatedData = z.object({
  type:        z.literal('PATCH_PLAN_CREATED').optional(),        // optional discriminator echo
  patches:     z.array(zPatchArtifact),                           // planned patches
  patch_count: z.number().int().min(0),                           // number of patches
  rationale:   z.string().min(1).max(5000),                       // why these changes
}).passthrough();
export type PatchPlanCreatedData = z.infer<typeof zPatchPlanCreatedData>;

// ── 18) PATCH_SIMULATION_APPLIED event data ─────────────────────────────────
export const zPatchSimulationAppliedData = z.object({
  type:            z.literal('PATCH_SIMULATION_APPLIED').optional(), // optional discriminator echo
  patches_applied: z.number().int().min(0),                          // how many patches were applied
  simulation_ok:   z.boolean(),                                      // did simulation succeed
  sandbox_id:      z.string().min(1).max(200),                       // sandbox identifier
  error_summary:   z.string().max(2000).optional(),                  // error if simulation failed
}).passthrough();
export type PatchSimulationAppliedData = z.infer<typeof zPatchSimulationAppliedData>;

// ── 19) BUILD_VERIFIED event data ───────────────────────────────────────────
export const zBuildVerifiedData = z.object({
  type:   z.literal('BUILD_VERIFIED').optional(),                 // optional discriminator echo
  result: zVerificationResult,                                    // build verification outcome
}).passthrough();
export type BuildVerifiedData = z.infer<typeof zBuildVerifiedData>;

// ── 20) TESTS_VERIFIED event data ───────────────────────────────────────────
export const zTestsVerifiedData = z.object({
  type:   z.literal('TESTS_VERIFIED').optional(),                 // optional discriminator echo
  result: zVerificationResult,                                    // test verification outcome
}).passthrough();
export type TestsVerifiedData = z.infer<typeof zTestsVerifiedData>;

// ── 21) PATCH_REVIEW_COMPLETED event data ───────────────────────────────────
export const zPatchReviewCompletedData = z.object({
  type:              z.literal('PATCH_REVIEW_COMPLETED').optional(), // optional discriminator echo
  approved:          z.boolean(),                                    // whether the patch was approved
  review_source:     z.enum(['AUTOMATED', 'HUMAN', 'POLICY']),     // who reviewed
  issues_found:      z.number().int().min(0),                       // issues found during review
  review_summary:    z.string().min(1).max(5000),                   // review summary
  build_passed:      z.boolean(),                                    // build evidence
  tests_passed:      z.boolean(),                                    // test evidence
}).passthrough();
export type PatchReviewCompletedData = z.infer<typeof zPatchReviewCompletedData>;
