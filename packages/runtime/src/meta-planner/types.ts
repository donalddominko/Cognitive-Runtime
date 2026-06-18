// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/runtime/src/meta-planner/types.ts
// Phase 6: Internal types for Meta-Planner v1.
// Phase 7: Added ReplanContext for bounded replanning loops.
// Config, input shape, and event-log interface used by the planner.

import type {
  DagSpec,                  // the concrete DAG spec
  PlannerConstraintSet,     // constraint bounds
  RunEvent,                 // event union
} from '@cognitive-runtime/contracts';

// ── MetaPlannerConfig ───────────────────────────────────────────────────────
// All settings are locked at startup via env vars. Immutable during a run.
export interface MetaPlannerConfig {
  enabled: boolean;                   // META_PLANNER_ENABLED — master switch
  allowSynthesis: boolean;            // META_PLANNER_ALLOW_SYNTHESIS — permit SYNTHESIZE mode
  minPatternReward: number;           // META_PLANNER_MIN_PATTERN_REWARD — threshold for M3 reuse
  weights: {                          // scoring dimension weights (must sum to ~1.0)
    quality: number;                  // META_PLANNER_WEIGHTS_QUALITY
    latency: number;                  // META_PLANNER_WEIGHTS_LATENCY
    cost: number;                     // META_PLANNER_WEIGHTS_COST
    risk: number;                     // META_PLANNER_WEIGHTS_RISK
  };
  plannerVersion: string;             // version label for audit events
}

// ── MetaPlannerInput ────────────────────────────────────────────────────────
// Input passed to MetaPlanner.plan() by the worker before DAG execution.
export interface MetaPlannerInput {
  runId: string;                      // current run UUID
  chatId: string;                     // current chat UUID
  userMessage: string;                // the user's message text
  defaultDag: DagSpec;                // the baseline DAG from planDagForRun()
  constraints?: PlannerConstraintSet; // optional explicit constraints
}

// ── PlannerEventLogLike ─────────────────────────────────────────────────────
// Minimal event log interface needed by the planner (append-only).
export interface PlannerEventLogLike {
  append(event: RunEvent): Promise<void>;           // append one event
  listByRunId(runId: string): Promise<RunEvent[]>;  // read events for a run
}

// ── ReplanContext (Phase 7) ─────────────────────────────────────────────────
// Tracks the state of a bounded replanning loop.
export interface ReplanContext {
  loopIndex: number;                  // current loop iteration (0-based)
  maxLoops: number;                   // configured maximum loop count
  priorDagOk: boolean;               // did the prior DAG execution succeed
  priorReward: number | null;         // reward from the prior run (null if first loop)
  triggerReason: string;              // why replan was triggered
}

// ── Default config factory ──────────────────────────────────────────────────
// Reads env vars and returns a frozen config object.
export function createMetaPlannerConfig(env: Record<string, string | undefined>): MetaPlannerConfig {
  return Object.freeze({
    enabled:          env.META_PLANNER_ENABLED !== 'false',                          // default true
    allowSynthesis:   env.META_PLANNER_ALLOW_SYNTHESIS === 'true',                   // default false
    minPatternReward: parseFloat(env.META_PLANNER_MIN_PATTERN_REWARD || '0.6'),      // default 0.6
    weights: Object.freeze({
      quality: parseFloat(env.META_PLANNER_WEIGHTS_QUALITY || '0.4'),                // default 0.4
      latency: parseFloat(env.META_PLANNER_WEIGHTS_LATENCY || '0.25'),               // default 0.25
      cost:    parseFloat(env.META_PLANNER_WEIGHTS_COST    || '0.15'),               // default 0.15
      risk:    parseFloat(env.META_PLANNER_WEIGHTS_RISK    || '0.2'),                // default 0.2
    }),
    plannerVersion: '1.1.0',                                                         // Phase 7 v1.1
  });
}
