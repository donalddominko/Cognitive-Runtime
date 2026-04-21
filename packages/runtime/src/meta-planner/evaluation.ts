// Cognitive Runtime © 2026 by Donald Dominko
// Licensed under CC BY-NC-SA 4.0
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/runtime/src/meta-planner/evaluation.ts
// Phase 6: Post-run evaluation — compares planner predictions vs actual outcomes.
// Additive only — never mutates historical execution truth.

import type {
  RunEvent,
  MetaPlannerEvaluation,
  MetaPlannerDecision,
} from '@cognitive-runtime/contracts';

// ── evaluatePlannerDecision ─────────────────────────────────────────────────
// Called after a run completes. Derives actual metrics from events and computes error.
export function evaluatePlannerDecision(params: {
  runId: string;
  decision: MetaPlannerDecision;
  events: RunEvent[];
}): MetaPlannerEvaluation {
  const { runId, decision, events } = params;

  // Extract actual reward score from REWARD_COMPUTED event.
  let actualReward: number | null = null;
  for (const e of events) {
    if (e.type === 'REWARD_COMPUTED') {
      const d = (e as any).data;
      if (typeof d?.artifact_score === 'number') actualReward = d.artifact_score;
    }
  }

  // Extract actual latency from first NODE_STARTED to last DAG_COMPLETED.
  let firstStartTs: number | null = null;
  let lastCompleteTs: number | null = null;
  for (const e of events) {
    if (e.type === 'NODE_STARTED' && firstStartTs === null) {
      firstStartTs = new Date(e.ts).getTime();                      // first node start
    }
    if (e.type === 'DAG_COMPLETED') {
      lastCompleteTs = new Date(e.ts).getTime();                    // last DAG completion
    }
  }
  const actualLatencyMs = (firstStartTs !== null && lastCompleteTs !== null)
    ? lastCompleteTs - firstStartTs                                  // total execution time
    : null;

  // Extract run status from RUN_COMPLETED.
  let runStatus: string | null = null;
  let failedNodeCount = 0;
  for (const e of events) {
    if (e.type === 'RUN_COMPLETED') {
      const ok = (e as any).data?.ok;
      runStatus = ok ? 'SUCCEEDED' : 'FAILED';
    }
    if (e.type === 'NODE_FAILED') failedNodeCount++;                 // count failed nodes
  }

  // Compute prediction errors.
  const predicted = decision.scoring.selected_total_score;
  const totalScoreError = actualReward != null
    ? predicted - actualReward                                       // predicted total vs actual reward
    : null;

  return {
    run_id: runId,
    planner_decision_id: decision.selected_candidate_id,
    predicted: {
      quality_score: null,                                           // v1: individual scores not stored on decision
      latency_score: null,
      cost_score: null,
      risk_score: null,
      total_score: predicted,
    },
    actual: {
      reward_score: actualReward,
      latency_ms: actualLatencyMs,
      run_status: runStatus,
      failed_node_count: failedNodeCount,
    },
    prediction_error: {
      quality_error: null,                                           // v1: not enough data
      latency_error: null,                                           // v1: not enough data
      total_score_error: totalScoreError,
    },
  };
}
