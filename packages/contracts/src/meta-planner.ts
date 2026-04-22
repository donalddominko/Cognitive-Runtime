// Cognitive Runtime © 2026 by Donald Dominko
// Licensed under CC BY-NC-SA 4.0
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/contracts/src/meta-planner.ts
// Phase 6: Meta-Planner v1 — Zod schemas and TS types for the deterministic planning layer.
// All planner contracts live here; validated at every API and storage boundary.
// The Meta-Planner selects/reuses/modifies/synthesizes concrete DAGs before execution.

import { z } from 'zod';                              // runtime schema validation
import { zUUID, zISODateString } from './common.js';  // shared primitives
import { zDagSpec } from './dag.js';                   // DagSpec type for candidate DAGs

// ── 1) PlannerMode ──────────────────────────────────────────────────────────
// Which strategy the planner used to produce the selected DAG.
export const zPlannerMode = z.enum([
  'REUSE',       // reused an existing M3 pattern as-is (parameter adaptation only)
  'MODIFY',      // modified an existing M3 pattern (insert/remove/swap nodes)
  'SYNTHESIZE',  // synthesized a new DAG from templates (no suitable M3 pattern)
  'BYPASS',      // planner disabled or skipped; default DAG used unchanged
]);
export type PlannerMode = z.infer<typeof zPlannerMode>;

// ── 2) PlannerStatus ────────────────────────────────────────────────────────
// Lifecycle status of a single planner invocation.
export const zPlannerStatus = z.enum([
  'DISABLED',           // planner was disabled by config
  'STARTED',            // planner invocation began
  'CONTEXT_RETRIEVED',  // memory context fetched from MemoryOrchestrator
  'CANDIDATES_BUILT',   // candidate DAGs generated
  'DECISION_MADE',      // winner selected
  'FALLBACK_USED',      // planner failed; default DAG used as fallback
  'FAILED',             // planner encountered an unrecoverable error
]);
export type PlannerStatus = z.infer<typeof zPlannerStatus>;

// ── 3) PlannerConstraintSet ─────────────────────────────────────────────────
// Explicit constraints that bound the planner's candidate space.
export const zPlannerConstraintSet = z.object({
  max_parallelism:            z.number().int().min(1).optional(),   // max concurrent nodes
  max_depth:                  z.number().int().min(1).optional(),   // max DAG depth (longest path)
  latency_budget_ms:          z.number().min(0).optional(),         // target latency ceiling in ms
  cost_budget:                z.number().min(0).optional(),         // abstract cost ceiling
  regulated_domain:           z.boolean().optional(),               // true = extra validation required
  require_research:           z.boolean().optional(),               // force research node
  require_security_review:    z.boolean().optional(),               // force security node
  require_validation_nodes:   z.boolean().optional(),               // force validation nodes
  allow_dag_synthesis:        z.boolean().optional(),               // allow SYNTHESIZE mode
  allow_pattern_reuse:        z.boolean().optional(),               // allow REUSE mode
  allow_pattern_modification: z.boolean().optional(),               // allow MODIFY mode
});
export type PlannerConstraintSet = z.infer<typeof zPlannerConstraintSet>;

// ── 4) PlannerTaskFeatures ──────────────────────────────────────────────────
// Deterministic, structured features extracted from the task/request.
// No prose blobs — only typed, bounded fields.
export const zPlannerTaskFeatures = z.object({
  task_type:               z.string().optional(),                  // e.g. 'chat', 'code_gen'
  domain:                  z.string().optional(),                  // e.g. 'backend', 'infra'
  skill_tags:              z.array(z.string().min(1).max(100)),    // searchable skill tags
  risk_level:              z.enum(['low', 'medium', 'high']).optional(), // task risk assessment
  requires_tools:          z.boolean().optional(),                 // does this need tool use
  requires_research:       z.boolean().optional(),                 // does this need L4 research
  requires_code:           z.boolean().optional(),                 // does this need code generation
  requires_persistence:    z.boolean().optional(),                 // does this need DB writes
  conversation_turn_index: z.number().int().min(0).optional(),     // which turn in chat
});
export type PlannerTaskFeatures = z.infer<typeof zPlannerTaskFeatures>;

// ── 5) PlannerContext ───────────────────────────────────────────────────────
// Structured planner-safe context returned from MemoryOrchestrator for planning.
// This is the ONLY memory interface the planner sees.
export const zPlannerEpisodeEvidence = z.object({
  episode_id:      zUUID,                                          // M1 record ID
  task_fingerprint:z.string().min(1),                              // hash of task features
  outcome:         z.enum(['success', 'partial', 'fail']),         // run outcome
  reward_score:    z.number().min(0).max(1).optional(),            // reward if available
  latency_ms:      z.number().min(0).optional(),                   // run latency
  cost_score:      z.number().min(0).max(1).optional().nullable(), // cost metric
  risk_score:      z.number().min(0).max(1).optional().nullable(), // risk metric
  dag_fingerprint: z.string().optional(),                          // hash of DAG structure
  selected_agents: z.array(z.string()).optional(),                 // agents used
  node_kinds:      z.array(z.string()).optional(),                 // node kinds used
  created_at:      zISODateString,                                 // when episode was recorded
});
export type PlannerEpisodeEvidence = z.infer<typeof zPlannerEpisodeEvidence>;

// ── 7) PlannerPatternEvidence ───────────────────────────────────────────────
// Strict subset of M3 data relevant to planning.
export const zPlannerPatternEvidence = z.object({
  pattern_id:             zUUID,                                   // M3 record ID
  dag_template:           zDagSpec,                                // the reusable DAG structure
  avg_reward:             z.number().min(0).max(1),                // average reward across uses
  usage_count:            z.number().int().min(0),                 // how many times used
  success_rate:           z.number().min(0).max(1).optional(),     // fraction of successful uses
  typical_latency_ms:     z.number().min(0).optional().nullable(), // typical execution latency
  typical_cost_score:     z.number().min(0).max(1).optional().nullable(), // typical cost
  domains:                z.array(z.string()).optional(),           // applicable domains
  skill_tags:             z.array(z.string()).optional(),           // skill coverage
  constraints_fingerprint:z.string().optional().nullable(),        // hash of compatible constraints
  updated_at:             zISODateString,                           // last update timestamp
});
export type PlannerPatternEvidence = z.infer<typeof zPlannerPatternEvidence>;

// ── 8) PlannerSemanticSummary ───────────────────────────────────────────────
// Advisory-only M2 summary. Must NOT contain raw arbitrary semantic records.
// Only present if MemoryOrchestrator already exposes a planner-safe aggregate view.
export const zPlannerSemanticSummary = z.object({
  summary_id:      zUUID,                                          // summary record ID
  domains:         z.array(z.string()).optional(),                  // covered domains
  citation_count:  z.number().int().min(0),                        // number of citations backing this
  confidence_avg:  z.number().min(0).max(1).optional(),            // average confidence of sources
  regulated_flags: z.array(z.string()).optional(),                  // any regulated-domain flags
  notes:           z.array(z.string()).optional(),                  // advisory notes (not executable)
});
export type PlannerSemanticSummary = z.infer<typeof zPlannerSemanticSummary>;

// ── PlannerContext (the combined evidence package) ───────────────────────────
export const zPlannerContext = z.object({
  run_id:      zUUID,                                              // current run ID
  chat_id:     zUUID,                                              // current chat ID
  features:    zPlannerTaskFeatures,                               // extracted task features
  constraints: zPlannerConstraintSet,                              // active constraints
  evidence: z.object({
    m1_episodes: z.array(zPlannerEpisodeEvidence),                 // M1 episode evidence
    m3_patterns: z.array(zPlannerPatternEvidence),                 // M3 pattern evidence
    m2_summary:  zPlannerSemanticSummary.optional().nullable(),    // optional M2 summary
  }),
});
export type PlannerContext = z.infer<typeof zPlannerContext>;

// ── 9) PlannerCandidateDag ──────────────────────────────────────────────────
// A candidate DAG produced by the candidate builder, with predicted scores and checks.
export const zPlannerCandidateSource = z.enum([
  'DEFAULT',       // the baseline/default DAG path
  'M3_REUSE',      // reused from M3 pattern
  'M3_MODIFIED',   // modified from M3 pattern
  'SYNTHESIZED',   // synthesized from templates
]);
export type PlannerCandidateSource = z.infer<typeof zPlannerCandidateSource>;

export const zPlannerCandidateDag = z.object({
  candidate_id:         z.string().min(1),                         // deterministic candidate ID
  source:               zPlannerCandidateSource,                   // how this candidate was created
  mode:                 zPlannerMode,                              // planner mode used
  dag:                  zDagSpec,                                  // the concrete DAG spec
  based_on_pattern_id:  zUUID.optional(),                          // M3 pattern source if applicable
  based_on_episode_ids: z.array(zUUID).optional(),                 // M1 evidence used
  predicted: z.object({
    quality_score: z.number().min(0).max(1),                       // predicted quality [0,1]
    latency_score: z.number().min(0).max(1),                       // predicted latency [0,1] (1=fast)
    cost_score:    z.number().min(0).max(1),                       // predicted cost [0,1] (1=cheap)
    risk_score:    z.number().min(0).max(1),                       // predicted risk [0,1] (1=safe)
    total_score:   z.number(),                                     // weighted composite score
  }),
  checks: z.object({
    mandatory_nodes_present:  z.boolean(),                         // all required nodes exist
    constraints_compatible:   z.boolean(),                         // constraints satisfied
    cycle_free:               z.boolean(),                         // no cycles in DAG
    within_parallelism_limit: z.boolean(),                         // parallelism limit respected
  }),
});
export type PlannerCandidateDag = z.infer<typeof zPlannerCandidateDag>;

// ── 10) MetaPlannerDecision ─────────────────────────────────────────────────
// The final output of the Meta-Planner: which DAG was selected and why.
export const zMetaPlannerDecision = z.object({
  run_id:                zUUID,                                    // the run this decision is for
  selected_dag:          z.enum(['new', 'reuse']),                 // whether DAG is new or reused
  selected_candidate_id: z.string().min(1),                        // which candidate won
  mode:                  zPlannerMode,                             // planner mode of the winner
  dag:                   zDagSpec,                                 // the concrete DAG to execute
  rationale: z.object({
    signals_used: z.array(z.string()),                             // what signals influenced decision
    tradeoffs:    z.array(z.string()),                             // tradeoffs noted
    evidence_refs: z.object({
      pattern_ids: z.array(z.string()),                            // M3 patterns referenced
      episode_ids: z.array(z.string()),                            // M1 episodes referenced
    }),
  }),
  scoring: z.object({
    weights: z.object({
      quality: z.number(),                                         // weight for quality dimension
      latency: z.number(),                                         // weight for latency dimension
      cost:    z.number(),                                         // weight for cost dimension
      risk:    z.number(),                                         // weight for risk dimension
    }),
    selected_total_score:    z.number(),                            // winner's total score
    runner_up_total_score:   z.number().optional().nullable(),      // runner-up score if exists
  }),
  fallback_used: z.boolean(),                                      // true if default DAG was forced
});
export type MetaPlannerDecision = z.infer<typeof zMetaPlannerDecision>;

// ── 11) MetaPlannerEvaluation ───────────────────────────────────────────────
// Post-run comparison of predicted vs actual metrics.
export const zMetaPlannerEvaluation = z.object({
  run_id:              zUUID,                                      // evaluated run
  planner_decision_id: z.string().optional(),                      // candidate_id of the decision
  predicted: z.object({
    quality_score:  z.number().optional().nullable(),               // predicted quality
    latency_score:  z.number().optional().nullable(),               // predicted latency
    cost_score:     z.number().optional().nullable(),               // predicted cost
    risk_score:     z.number().optional().nullable(),               // predicted risk
    total_score:    z.number().optional().nullable(),               // predicted composite
  }),
  actual: z.object({
    reward_score:     z.number().optional().nullable(),             // actual reward from REWARD_COMPUTED
    latency_ms:       z.number().optional().nullable(),             // actual end-to-end latency
    run_status:       z.string().optional().nullable(),             // SUCCEEDED / FAILED
    failed_node_count:z.number().int().min(0).optional().nullable(), // number of failed nodes
  }),
  prediction_error: z.object({
    quality_error:  z.number().optional().nullable(),               // predicted - actual quality
    latency_error:  z.number().optional().nullable(),               // predicted - actual latency
    total_score_error: z.number().optional().nullable(),            // predicted - actual composite
  }),
});
export type MetaPlannerEvaluation = z.infer<typeof zMetaPlannerEvaluation>;

// ── 12) META_PLANNER_* Event Data Schemas ───────────────────────────────────
// Data payloads for the 8 new META_PLANNER_* events in the RunEvent union.

export const zMetaPlannerStartedData = z.object({
  type:            z.literal('META_PLANNER_STARTED').optional(),    // optional discriminator echo
  enabled:         z.boolean(),                                     // whether planner is enabled
  planner_version: z.string().min(1),                               // planner version string
}).passthrough();
export type MetaPlannerStartedData = z.infer<typeof zMetaPlannerStartedData>;

export const zMetaPlannerContextRetrievedData = z.object({
  type:                   z.literal('META_PLANNER_CONTEXT_RETRIEVED').optional(),
  m1_count:               z.number().int().min(0),                  // M1 episodes retrieved
  m3_count:               z.number().int().min(0),                  // M3 patterns retrieved
  has_m2_summary:         z.boolean(),                              // whether M2 summary present
  features_fingerprint:   z.string().optional(),                    // hash of extracted features
  constraints_fingerprint:z.string().optional(),                    // hash of active constraints
}).passthrough();
export type MetaPlannerContextRetrievedData = z.infer<typeof zMetaPlannerContextRetrievedData>;

export const zMetaPlannerCandidateBuiltData = z.object({
  type:                 z.literal('META_PLANNER_CANDIDATE_BUILT').optional(),
  candidate_id:         z.string().min(1),                          // candidate identifier
  source:               zPlannerCandidateSource,                    // how it was created
  mode:                 zPlannerMode,                               // planner mode used
  based_on_pattern_id:  z.string().optional(),                      // M3 source if applicable
  predicted_total_score:z.number(),                                 // predicted composite score
}).passthrough();
export type MetaPlannerCandidateBuiltData = z.infer<typeof zMetaPlannerCandidateBuiltData>;

export const zMetaPlannerDecisionMadeData = z.object({
  type:                   z.literal('META_PLANNER_DECISION_MADE').optional(),
  candidate_id:           z.string().min(1),                        // winning candidate
  mode:                   zPlannerMode,                             // planner mode of winner
  selected_dag:           z.enum(['new', 'reuse']),                 // new or reused
  fallback_used:          z.boolean(),                              // whether fallback was forced
  predicted_total_score:  z.number(),                               // winner's score
  runner_up_total_score:  z.number().optional().nullable(),         // runner-up score
  dag_fingerprint:        z.string().optional(),                    // deterministic hash of selected DAG structure
}).passthrough();
export type MetaPlannerDecisionMadeData = z.infer<typeof zMetaPlannerDecisionMadeData>;

export const zMetaPlannerSkippedData = z.object({
  type:   z.literal('META_PLANNER_SKIPPED').optional(),
  reason: z.enum([
    'DISABLED',                    // planner disabled by config
    'NO_ELIGIBLE_CONTEXT',         // no memory context available
    'INSUFFICIENT_CONFIDENCE',     // not enough confidence to plan
    'NO_COMPATIBLE_PATTERN',       // no M3 pattern fits
    'SYNTHESIS_NOT_ALLOWED',       // synthesis disabled by config
  ]),
}).passthrough();
export type MetaPlannerSkippedData = z.infer<typeof zMetaPlannerSkippedData>;

export const zMetaPlannerFallbackUsedData = z.object({
  type:   z.literal('META_PLANNER_FALLBACK_USED').optional(),
  reason: z.enum([
    'PLANNER_ERROR',          // planner threw an exception
    'INVALID_CANDIDATE',      // all candidates failed validation
    'CONSTRAINT_VIOLATION',   // winner violated constraints
    'NO_VALID_CANDIDATES',    // no candidates passed checks
  ]),
}).passthrough();
export type MetaPlannerFallbackUsedData = z.infer<typeof zMetaPlannerFallbackUsedData>;

export const zMetaPlannerEvaluatedData = z.object({
  type:                 z.literal('META_PLANNER_EVALUATED').optional(),
  predicted_total_score:z.number().optional().nullable(),           // what planner predicted
  actual_reward_score:  z.number().optional().nullable(),           // actual reward from run
  actual_latency_ms:    z.number().optional().nullable(),           // actual run latency
  prediction_error:     z.number().optional().nullable(),           // total score error
}).passthrough();
export type MetaPlannerEvaluatedData = z.infer<typeof zMetaPlannerEvaluatedData>;

export const zMetaPlannerFailedData = z.object({
  type:    z.literal('META_PLANNER_FAILED').optional(),
  code:    z.string().min(1),                                       // machine-readable error code
  message: z.string().min(1),                                       // human-readable description
  where:   z.string().optional(),                                   // source location hint
}).passthrough();
export type MetaPlannerFailedData = z.infer<typeof zMetaPlannerFailedData>;
