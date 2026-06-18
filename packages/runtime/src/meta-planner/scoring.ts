// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/runtime/src/meta-planner/scoring.ts
// Phase 6: Candidate scoring and deterministic selection.
// score = w1*quality + w2*latency + w3*cost + w4*risk
// No LLM scoring. No hidden heuristics. No ML training.

import type { PlannerCandidateDag } from '@cognitive-runtime/contracts';
import { isValidCandidate } from './constraints.js';
import type { MetaPlannerConfig } from './types.js';

// ── selectWinner ────────────────────────────────────────────────────────────
// From a list of candidates, select the deterministic winner.
// Only valid candidates (all checks pass) are eligible.
// Tie-break order: total_score desc, risk desc, latency desc, depth asc, id asc.
export function selectWinner(
  candidates: PlannerCandidateDag[],
  _config: MetaPlannerConfig,
): PlannerCandidateDag | null {
  // Filter to valid candidates only.
  const valid = candidates.filter(c => isValidCandidate(c.checks));

  if (valid.length === 0) return null;                               // no valid candidates

  // Sort by deterministic criteria (descending score, then tie-breakers).
  valid.sort((a, b) => {
    // 1) Higher total_score wins.
    if (b.predicted.total_score !== a.predicted.total_score) {
      return b.predicted.total_score - a.predicted.total_score;
    }
    // 2) Lower predicted risk wins (higher risk_score = safer, so higher wins).
    if (b.predicted.risk_score !== a.predicted.risk_score) {
      return b.predicted.risk_score - a.predicted.risk_score;
    }
    // 3) Lower predicted latency wins (higher latency_score = faster, so higher wins).
    if (b.predicted.latency_score !== a.predicted.latency_score) {
      return b.predicted.latency_score - a.predicted.latency_score;
    }
    // 4) Lower DAG depth wins (fewer nodes = simpler).
    if (a.dag.nodes.length !== b.dag.nodes.length) {
      return a.dag.nodes.length - b.dag.nodes.length;
    }
    // 5) Lexicographically smaller candidate_id wins (deterministic final tiebreak).
    return a.candidate_id.localeCompare(b.candidate_id);
  });

  return valid[0]!;                                                   // return top candidate
}

// ── getRunnerUpScore ────────────────────────────────────────────────────────
// Return the score of the second-best valid candidate, or null if none.
export function getRunnerUpScore(
  candidates: PlannerCandidateDag[],
  winnerId: string,
): number | null {
  const others = candidates.filter(c => isValidCandidate(c.checks) && c.candidate_id !== winnerId);
  if (others.length === 0) return null;                              // no runner-up
  // Sort descending by total_score.
  others.sort((a, b) => b.predicted.total_score - a.predicted.total_score);
  return others[0]!.predicted.total_score;                           // return runner-up score
}
