// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/runtime/src/meta-planner/candidate-builder.ts
// Phase 6: Builds candidate DAGs for the Meta-Planner to score and select.
// Exactly 4 candidate classes: DEFAULT, REUSE, MODIFY, SYNTHESIZE.
// No other types. No unlimited search. No recursive loops.

import { createHash } from 'crypto';
import type {
  DagSpec,
  PlannerContext,
  PlannerCandidateDag,
  PlannerCandidateSource,
  PlannerPatternEvidence,
} from '@cognitive-runtime/contracts';
import { validateCandidate } from './constraints.js';
import type { MetaPlannerConfig } from './types.js';

// ── Deterministic candidate ID ──────────────────────────────────────────────
function makeCandidateId(source: string, runId: string, patternId?: string): string {
  const input = `${source}:${runId}:${patternId ?? 'none'}`;       // deterministic input
  return createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 16); // 16-char hex
}

// ── Predict scores for a candidate ──────────────────────────────────────────
// Deterministic prediction based on source type and available evidence.
function predictScores(
  source: PlannerCandidateSource,
  pattern?: PlannerPatternEvidence,
  config?: MetaPlannerConfig,
): { quality_score: number; latency_score: number; cost_score: number; risk_score: number; total_score: number } {
  const w = config?.weights ?? { quality: 0.4, latency: 0.25, cost: 0.15, risk: 0.2 };

  let quality = 0.5;   // default: unknown quality
  let latency = 0.5;   // default: unknown latency
  let cost = 0.5;      // default: unknown cost
  let risk = 0.5;      // default: unknown risk

  if (source === 'DEFAULT') {
    quality = 0.5;      // baseline quality
    latency = 0.6;      // known fast path
    cost = 0.7;         // known low cost
    risk = 0.8;         // known safe
  } else if (source === 'M3_REUSE' && pattern) {
    quality = Math.min(1, pattern.avg_reward * 1.1);              // slightly optimistic on proven pattern
    latency = pattern.typical_latency_ms != null ? 0.6 : 0.5;    // known latency = bonus
    cost = pattern.typical_cost_score != null ? 0.6 : 0.5;       // known cost = bonus
    risk = pattern.success_rate != null ? pattern.success_rate : 0.5; // use success rate as risk proxy
  } else if (source === 'M3_MODIFIED') {
    quality = 0.45;     // modified = slightly uncertain
    latency = 0.5;      // unknown change to latency
    cost = 0.5;         // unknown change to cost
    risk = 0.4;         // modification introduces risk
  } else if (source === 'SYNTHESIZED') {
    quality = 0.4;      // novel = lower confidence
    latency = 0.5;      // unknown
    cost = 0.5;         // unknown
    risk = 0.3;         // novel = higher risk
  }

  // Compute weighted total score.
  const total = w.quality * quality + w.latency * latency + w.cost * cost + w.risk * risk;

  return { quality_score: quality, latency_score: latency, cost_score: cost, risk_score: risk, total_score: total };
}

// ── adaptTemplate: replace identifiers in an M3 template for current run ────
function adaptTemplate(template: DagSpec, runId: string, chatId: string): DagSpec {
  return {
    dag_id:     runId,                                              // use run_id as dag_id
    run_id:     runId,                                              // current run
    chat_id:    chatId,                                             // current chat
    created_at: new Date().toISOString(),                           // now
    nodes:      template.nodes.map(n => ({ ...n })),                // shallow copy nodes
  };
}

// ── buildCandidates ─────────────────────────────────────────────────────────
// Generates up to 4 candidate classes. Always includes DEFAULT.
export function buildCandidates(
  defaultDag: DagSpec,
  context: PlannerContext,
  config: MetaPlannerConfig,
): PlannerCandidateDag[] {
  const candidates: PlannerCandidateDag[] = [];
  const constraints = context.constraints;
  const runId = context.run_id;
  const chatId = context.chat_id;

  // ── 1) DEFAULT — always available ──────────────────────────────────────
  const defaultId = makeCandidateId('DEFAULT', runId);
  const defaultPredicted = predictScores('DEFAULT', undefined, config);
  const defaultChecks = validateCandidate(defaultDag, constraints);
  candidates.push({
    candidate_id: defaultId,
    source: 'DEFAULT',
    mode: 'BYPASS',
    dag: defaultDag,
    predicted: defaultPredicted,
    checks: defaultChecks,
  });

  // ── 2) REUSE from M3 — if compatible pattern exists ────────────────────
  if (constraints.allow_pattern_reuse !== false) {                  // allowed by default
    for (const pattern of context.evidence.m3_patterns) {
      if (pattern.avg_reward < config.minPatternReward) continue;   // below reward threshold
      const adaptedDag = adaptTemplate(pattern.dag_template, runId, chatId);
      const reuseId = makeCandidateId('M3_REUSE', runId, pattern.pattern_id);
      const reusePredicted = predictScores('M3_REUSE', pattern, config);
      const reuseChecks = validateCandidate(adaptedDag, constraints);
      candidates.push({
        candidate_id: reuseId,
        source: 'M3_REUSE',
        mode: 'REUSE',
        dag: adaptedDag,
        based_on_pattern_id: pattern.pattern_id,
        predicted: reusePredicted,
        checks: reuseChecks,
      });
    }
  }

  // ── 3) MODIFY from M3 — if partial match with suboptimal performance ───
  if (constraints.allow_pattern_modification !== false) {            // allowed by default
    for (const pattern of context.evidence.m3_patterns) {
      // Only modify patterns below reuse threshold but above minimum.
      if (pattern.avg_reward >= config.minPatternReward) continue;  // already reusable as-is
      if (pattern.avg_reward < 0.3) continue;                       // too low to salvage
      const adaptedDag = adaptTemplate(pattern.dag_template, runId, chatId);
      // v1 modification: increase LLM retry count to compensate for lower quality.
      for (const node of adaptedDag.nodes) {
        if (node.kind === 'LLM_CHAT' && node.retry.max_attempts < 2) {
          node.retry = { max_attempts: 2, backoff_ms: 500 };       // boost retry
        }
      }
      const modifyId = makeCandidateId('M3_MODIFIED', runId, pattern.pattern_id);
      const modifyPredicted = predictScores('M3_MODIFIED', pattern, config);
      const modifyChecks = validateCandidate(adaptedDag, constraints);
      candidates.push({
        candidate_id: modifyId,
        source: 'M3_MODIFIED',
        mode: 'MODIFY',
        dag: adaptedDag,
        based_on_pattern_id: pattern.pattern_id,
        predicted: modifyPredicted,
        checks: modifyChecks,
      });
    }
  }

  // ── 4) SYNTHESIZE — only if allowed and no compatible patterns ─────────
  if (config.allowSynthesis && constraints.allow_dag_synthesis !== false) {
    const hasReuse = candidates.some(c => c.source === 'M3_REUSE');
    if (!hasReuse) {                                                 // no reusable pattern found
      // v1: synthesize = default DAG (placeholder for future template library)
      const synthDag: DagSpec = {
        dag_id: runId, run_id: runId, chat_id: chatId,
        created_at: new Date().toISOString(),
        nodes: defaultDag.nodes.map(n => ({ ...n })),               // copy default nodes
      };
      const synthId = makeCandidateId('SYNTHESIZED', runId);
      const synthPredicted = predictScores('SYNTHESIZED', undefined, config);
      const synthChecks = validateCandidate(synthDag, constraints);
      candidates.push({
        candidate_id: synthId,
        source: 'SYNTHESIZED',
        mode: 'SYNTHESIZE',
        dag: synthDag,
        predicted: synthPredicted,
        checks: synthChecks,
      });
    }
  }

  return candidates;                                                 // return all candidates
}
