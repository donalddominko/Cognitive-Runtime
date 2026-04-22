// Cognitive Runtime © 2026 by Donald Dominko
// Licensed under CC BY-NC-SA 4.0
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/runtime/src/meta-planner/meta-planner.ts
// Phase 6: MetaPlanner service — deterministic, auditable, disableable planning layer.
// Selects among concrete DAGs. Does NOT execute tasks. Does NOT generate artifacts.

import {
  createRunEvent,
  type DagSpec,
  type MetaPlannerDecision,
  type PlannerConstraintSet,
  type RunEventType,
} from '@cognitive-runtime/contracts';
import type { MemoryOrchestrator } from '../memory/memory-orchestrator.js';
import type { MetaPlannerConfig, MetaPlannerInput, PlannerEventLogLike } from './types.js';
import { extractTaskFeatures, fingerprintFeatures, fingerprintConstraints, fingerprintDag } from './task-features.js';
import { buildCandidates } from './candidate-builder.js';
import { selectWinner, getRunnerUpScore } from './scoring.js';

// ── MetaPlanner class ───────────────────────────────────────────────────────

export class MetaPlanner {
  constructor(
    private readonly config: MetaPlannerConfig,                      // frozen config from env
    private readonly memoryOrchestrator: MemoryOrchestrator,         // planner memory gateway
    private readonly eventLog: PlannerEventLogLike,                  // append-only event log
  ) {}

  // ── plan: main entry point ────────────────────────────────────────────
  // Returns a MetaPlannerDecision with the selected DAG.
  // On any failure, returns a safe default decision.
  async plan(input: MetaPlannerInput): Promise<MetaPlannerDecision> {
    const { runId, chatId, userMessage, defaultDag, constraints } = input;
    const safeConstraints: PlannerConstraintSet = constraints ?? {};

    // 1) Emit META_PLANNER_STARTED.
    await this.emit(runId, chatId, 'META_PLANNER_STARTED', {
      enabled: this.config.enabled,
      planner_version: this.config.plannerVersion,
    });

    // 2) If disabled, skip immediately.
    if (!this.config.enabled) {
      await this.emit(runId, chatId, 'META_PLANNER_SKIPPED', { reason: 'DISABLED' });
      return this.buildDefaultDecision(runId, defaultDag);
    }

    try {
      // 3) Extract task features deterministically.
      const features = extractTaskFeatures(userMessage, safeConstraints);

      // 4) Retrieve planner context from MemoryOrchestrator.
      const context = await this.memoryOrchestrator.retrievePlannerContext({
        runId, chatId, features, constraints: safeConstraints, userMessage,
      });

      // 5) Emit META_PLANNER_CONTEXT_RETRIEVED.
      await this.emit(runId, chatId, 'META_PLANNER_CONTEXT_RETRIEVED', {
        m1_count: context.evidence.m1_episodes.length,
        m3_count: context.evidence.m3_patterns.length,
        has_m2_summary: context.evidence.m2_summary != null,
        features_fingerprint: fingerprintFeatures(features),
        constraints_fingerprint: fingerprintConstraints(safeConstraints),
      });

      // 6) Build candidate DAGs.
      const candidates = buildCandidates(defaultDag, context, this.config);

      // 7) Emit META_PLANNER_CANDIDATE_BUILT for each candidate.
      for (const c of candidates) {
        await this.emit(runId, chatId, 'META_PLANNER_CANDIDATE_BUILT', {
          candidate_id: c.candidate_id,
          source: c.source,
          mode: c.mode,
          based_on_pattern_id: c.based_on_pattern_id,
          predicted_total_score: c.predicted.total_score,
        });
      }

      // 8) Select deterministic winner.
      const winner = selectWinner(candidates, this.config);

      // 9) If no valid candidate, fallback.
      if (!winner) {
        await this.emit(runId, chatId, 'META_PLANNER_FALLBACK_USED', { reason: 'NO_VALID_CANDIDATES' });
        return this.buildDefaultDecision(runId, defaultDag);
      }

      // 10) Build decision object.
      const runnerUpScore = getRunnerUpScore(candidates, winner.candidate_id);
      const decision: MetaPlannerDecision = {
        run_id: runId,
        selected_dag: winner.source === 'DEFAULT' ? 'new' : (winner.source === 'M3_REUSE' ? 'reuse' : 'new'),
        selected_candidate_id: winner.candidate_id,
        mode: winner.mode,
        dag: winner.dag,
        rationale: {
          signals_used: ['m1_episodes', 'm3_patterns', 'task_features', 'constraints'],
          tradeoffs: this.describeTradeoffs(winner, candidates),
          evidence_refs: {
            pattern_ids: winner.based_on_pattern_id ? [winner.based_on_pattern_id] : [],
            episode_ids: winner.based_on_episode_ids ?? [],
          },
        },
        scoring: {
          weights: { ...this.config.weights },
          selected_total_score: winner.predicted.total_score,
          runner_up_total_score: runnerUpScore,
        },
        fallback_used: false,
      };

      // 11) Emit META_PLANNER_DECISION_MADE.
      await this.emit(runId, chatId, 'META_PLANNER_DECISION_MADE', {
        candidate_id: winner.candidate_id,
        mode: winner.mode,
        selected_dag: decision.selected_dag,
        fallback_used: false,
        predicted_total_score: winner.predicted.total_score,
        runner_up_total_score: runnerUpScore,
        dag_fingerprint: fingerprintDag(winner.dag),
      });

      return decision;

    } catch (err: any) {
      // 12) On any failure, emit error + fallback and return default.
      await this.emit(runId, chatId, 'META_PLANNER_FAILED', {
        code: 'PLANNER_ERROR',
        message: err?.message ? String(err.message) : 'Unknown planner error',
        where: 'meta-planner.ts:plan()',
      });
      await this.emit(runId, chatId, 'META_PLANNER_FALLBACK_USED', { reason: 'PLANNER_ERROR' });
      return this.buildDefaultDecision(runId, defaultDag);
    }
  }

  // ── buildDefaultDecision ──────────────────────────────────────────────
  // Construct a safe fallback decision using the default DAG.
  private buildDefaultDecision(runId: string, defaultDag: DagSpec): MetaPlannerDecision {
    return {
      run_id: runId,
      selected_dag: 'new',
      selected_candidate_id: 'default-fallback',
      mode: 'BYPASS',
      dag: defaultDag,
      rationale: {
        signals_used: [],
        tradeoffs: ['Planner disabled or failed; using default DAG.'],
        evidence_refs: { pattern_ids: [], episode_ids: [] },
      },
      scoring: {
        weights: { ...this.config.weights },
        selected_total_score: 0,
        runner_up_total_score: null,
      },
      fallback_used: true,
    };
  }

  // ── describeTradeoffs ─────────────────────────────────────────────────
  // Deterministic tradeoff description based on winner vs alternatives.
  private describeTradeoffs(winner: any, candidates: any[]): string[] {
    const tradeoffs: string[] = [];
    if (winner.source === 'DEFAULT') tradeoffs.push('Default DAG selected — no better pattern found.');
    if (winner.source === 'M3_REUSE') tradeoffs.push('Reused M3 pattern — proven structure with known reward.');
    if (winner.source === 'M3_MODIFIED') tradeoffs.push('Modified M3 pattern — adjusted for improved performance.');
    if (winner.source === 'SYNTHESIZED') tradeoffs.push('Synthesized DAG — novel task, no matching pattern.');
    if (candidates.length > 1) tradeoffs.push(`Selected from ${candidates.length} candidates.`);
    return tradeoffs;
  }

  // ── emit helper ───────────────────────────────────────────────────────
  // Safe event emission — failures are logged but never propagated.
  private async emit(runId: string, chatId: string, type: RunEventType, data: any): Promise<void> {
    try {
      await this.eventLog.append(
        createRunEvent(runId, chatId, type, { type, ...data } as any)
      );
    } catch (err: any) {
      console.error(`[meta-planner] failed to emit ${type}: ${err?.message}`);
    }
  }
}
