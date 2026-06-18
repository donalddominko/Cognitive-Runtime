// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/runtime/src/memory/memory-orchestrator.ts
// Phase 5: Memory Orchestrator — coordinates retrieval and write operations across M1/M2/M3.
// Phase 6: adds retrievePlannerContext() — planner-safe memory gateway.
// Emits MEMORY_* events into the append-only event log for full auditability.
// Does NOT call LLMs. All summaries are derived from existing events and DAG state.

import { randomUUID, createHash } from 'crypto';
import {
  createRunEvent,
  type RunEvent,
  type M1EpisodicRecord,
  type M2SemanticRecord,
  type M3ProceduralRecord,
  type PlannerContext,
  type PlannerTaskFeatures,
  type PlannerConstraintSet,
  type PlannerEpisodeEvidence,
  type PlannerPatternEvidence,
  type PlannerSemanticSummary,
  zDagSpec,
} from '@cognitive-runtime/contracts';

import type { MemoryEventLogLike } from './types.js';
import { M1EpisodicMemoryService } from './m1-episodic-service.js';
import { M2SemanticMemoryService } from './m2-semantic-service.js';
import { M3ProceduralMemoryService } from './m3-procedural-service.js';

// ── Retrieved context shape (unchanged from Phase 5) ────────────────────────
export interface RetrievedMemoryContext {
  m1: M1EpisodicRecord[];
  m2: M2SemanticRecord[];
  m3: M3ProceduralRecord[];
}

// ── Memory Orchestrator ─────────────────────────────────────────────────────

export class MemoryOrchestrator {
  constructor(
    private readonly m1: M1EpisodicMemoryService,
    private readonly m2: M2SemanticMemoryService,
    private readonly m3: M3ProceduralMemoryService,
    private readonly eventLog: MemoryEventLogLike,
  ) {}

  // ── Pre-run retrieval (Phase 5, unchanged) ────────────────────────────
  async retrieveContext(params: {
    runId: string;
    chatId: string;
    userMessage: string;
    projectId?: string;
  }): Promise<RetrievedMemoryContext> {
    const { runId, chatId, userMessage, projectId } = params;

    let m1Results: M1EpisodicRecord[] = [];
    try {
      m1Results = await this.m1.getRecentEpisodes({ chatId, projectId, limit: 3 });
      await this.eventLog.append(
        createRunEvent(runId, chatId, 'MEMORY_RETRIEVED', {
          type: 'MEMORY_RETRIEVED', tier: 'M1',
          query: userMessage.slice(0, 200), top_k: 3,
          result_count: m1Results.length,
          record_ids: m1Results.map(r => r.id),
        } as any)
      );
    } catch (err: any) {
      console.error(`[memory-orchestrator] M1 retrieval failed: ${err?.message}`);
    }

    let m2Results: M2SemanticRecord[] = [];
    try {
      m2Results = await this.m2.searchSemantic({ query: userMessage, topK: 5, chatId, projectId });
      await this.eventLog.append(
        createRunEvent(runId, chatId, 'MEMORY_RETRIEVED', {
          type: 'MEMORY_RETRIEVED', tier: 'M2',
          query: userMessage.slice(0, 200), top_k: 5,
          result_count: m2Results.length,
          record_ids: m2Results.map(r => r.id),
        } as any)
      );
    } catch (err: any) {
      console.error(`[memory-orchestrator] M2 retrieval failed: ${err?.message}`);
    }

    let m3Results: M3ProceduralRecord[] = [];
    try {
      m3Results = await this.m3.searchProcedures({ query: userMessage, topK: 3 });
      await this.eventLog.append(
        createRunEvent(runId, chatId, 'MEMORY_RETRIEVED', {
          type: 'MEMORY_RETRIEVED', tier: 'M3',
          query: userMessage.slice(0, 200), top_k: 3,
          result_count: m3Results.length,
          record_ids: m3Results.map(r => r.id),
        } as any)
      );
    } catch (err: any) {
      console.error(`[memory-orchestrator] M3 retrieval failed: ${err?.message}`);
    }

    await this.eventLog.append(
      createRunEvent(runId, chatId, 'RUN_CONTEXT_PREPARED', {
        type: 'RUN_CONTEXT_PREPARED',
        m1_count: m1Results.length, m2_count: m2Results.length, m3_count: m3Results.length,
      } as any)
    );

    return { m1: m1Results, m2: m2Results, m3: m3Results };
  }

  // ── Phase 6: Planner-safe retrieval ───────────────────────────────────
  // Returns PlannerContext with structured evidence from M1 + M3.
  // Does NOT emit MEMORY_* events (planner has its own META_PLANNER_* events).
  // M2 is indirect: only a summary if available, never raw semantic hits.
  async retrievePlannerContext(params: {
    runId: string;
    chatId: string;
    features: PlannerTaskFeatures;
    constraints: PlannerConstraintSet;
    userMessage: string;
  }): Promise<PlannerContext> {
    const { runId, chatId, features, constraints, userMessage } = params;

    // ── M1 episodic evidence ──────────────────────────────────────────
    let m1Episodes: PlannerEpisodeEvidence[] = [];
    try {
      const m1Records = await this.m1.getRecentEpisodes({ chatId, limit: 5 });
      m1Episodes = m1Records
        .map(r => this.toEpisodeEvidence(r))                        // map to planner shape
        .sort((a, b) => {                                            // deterministic order
          const tA = new Date(a.created_at).getTime();
          const tB = new Date(b.created_at).getTime();
          if (tB !== tA) return tB - tA;                             // newest first
          return a.episode_id.localeCompare(b.episode_id);           // stable tiebreak
        });
    } catch (err: any) {
      console.error(`[memory-orchestrator] planner M1 retrieval failed: ${err?.message}`);
    }

    // ── M3 pattern evidence ───────────────────────────────────────────
    const m3Patterns: PlannerPatternEvidence[] = [];
    try {
      const m3Records = await this.m3.searchProcedures({ query: userMessage, topK: 5 });
      for (const r of m3Records) {
        const evidence = this.toPatternEvidence(r);                  // attempt conversion
        if (evidence) m3Patterns.push(evidence);                     // only add if valid
      }
      m3Patterns.sort((a, b) => {                                    // deterministic order
        if (b.avg_reward !== a.avg_reward) return b.avg_reward - a.avg_reward; // best reward first
        return a.pattern_id.localeCompare(b.pattern_id);             // stable tiebreak
      });
    } catch (err: any) {
      console.error(`[memory-orchestrator] planner M3 retrieval failed: ${err?.message}`);
    }

    // ── M2 summary (indirect, advisory only) ─────────────────────────
    const m2Summary: PlannerSemanticSummary | null = null;
    // Phase 6 v1: no M2 summary yet. MemoryOrchestrator does not expose
    // a planner-safe aggregate view in the current architecture.
    // This field is reserved for future enhancement.

    return {
      run_id: runId,
      chat_id: chatId,
      features,
      constraints,
      evidence: {
        m1_episodes: m1Episodes,
        m3_patterns: m3Patterns,
        m2_summary: m2Summary,
      },
    };
  }

  // ── M1 -> PlannerEpisodeEvidence mapper ───────────────────────────────
  private toEpisodeEvidence(record: M1EpisodicRecord): PlannerEpisodeEvidence {
    const fingerprint = createHash('sha256')
      .update(record.title || '', 'utf8')
      .digest('hex').slice(0, 16);                                   // deterministic fingerprint

    let outcome: 'success' | 'partial' | 'fail' = 'partial';
    if (record.status === 'SUCCEEDED') outcome = 'success';
    else if (record.status === 'FAILED') outcome = 'fail';

    return {
      episode_id: record.id,
      task_fingerprint: fingerprint,
      outcome,
      reward_score: record.metadata?.reward_score ?? undefined,
      latency_ms: undefined,                                         // not stored in M1 v1
      cost_score: undefined,
      risk_score: undefined,
      dag_fingerprint: undefined,
      selected_agents: undefined,
      node_kinds: undefined,
      created_at: record.created_at,
    };
  }

  // ── M3 -> PlannerPatternEvidence mapper ───────────────────────────────
  // Returns null if dag_template is missing or invalid.
  private toPatternEvidence(record: M3ProceduralRecord): PlannerPatternEvidence | null {
    if (!record.dag_template) return null;                           // no template stored

    // Try to parse dag_template as a valid DagSpec.
    const parseResult = zDagSpec.safeParse(record.dag_template);
    if (!parseResult.success) return null;                           // invalid DagSpec

    return {
      pattern_id: record.id,
      dag_template: parseResult.data,                                // validated DagSpec
      avg_reward: 0.5,                                               // v1 default — no usage history
      usage_count: 0,                                                // v1 default
      success_rate: undefined,
      typical_latency_ms: undefined,
      typical_cost_score: undefined,
      domains: record.tags.filter(t => ['backend', 'frontend', 'infra', 'database'].includes(t)),
      skill_tags: record.tags,
      constraints_fingerprint: undefined,
      updated_at: record.updated_at ?? record.created_at,
    };
  }

  // ── Post-run write (Phase 5, unchanged) ───────────────────────────────
  async maybeWriteFromRun(params: {
    runId: string;
    chatId: string;
    events: RunEvent[];
    dagOk: boolean;
    rewardScore?: number;
    projectId?: string;
  }): Promise<void> {
    const { runId, chatId, events, dagOk, rewardScore, projectId } = params;

    await this.writeM1Summary({ runId, chatId, events, dagOk, rewardScore, projectId });

    await this.eventLog.append(
      createRunEvent(runId, chatId, 'MEMORY_SKIPPED', {
        type: 'MEMORY_SKIPPED', tier: 'M2',
        reason: 'Phase 5 v1: no automatic M2 extraction from runs; use POST /memory/write for explicit M2 writes.',
      } as any)
    );
  }

  // ── Private: derive M1 summary from events (Phase 5, unchanged) ───────
  private async writeM1Summary(params: {
    runId: string; chatId: string; events: RunEvent[];
    dagOk: boolean; rewardScore?: number; projectId?: string;
  }): Promise<void> {
    const { runId, chatId, events, dagOk, rewardScore, projectId } = params;

    await this.eventLog.append(
      createRunEvent(runId, chatId, 'MEMORY_WRITE_REQUESTED', {
        type: 'MEMORY_WRITE_REQUESTED', tier: 'M1', record_kind: 'run_summary',
        reason: `Run ${dagOk ? 'succeeded' : 'failed'} — writing M1 summary episode.`,
      } as any)
    );

    const userMessage = this.extractUserMessage(events);
    const nodeCount = this.extractNodeCount(events);
    const status = dagOk ? 'SUCCEEDED' : 'FAILED';
    const kind = dagOk ? 'success_case' : 'failure_case';

    const titleText = userMessage
      ? userMessage.slice(0, 80) + (userMessage.length > 80 ? '...' : '')
      : `Run ${runId.slice(0, 8)}`;
    const title = `[${status}] ${titleText}`;

    const summaryParts: string[] = [];
    summaryParts.push(`Run ${dagOk ? 'succeeded' : 'failed'}.`);
    if (nodeCount !== null) summaryParts.push(`DAG had ${nodeCount} nodes.`);
    if (rewardScore !== undefined) summaryParts.push(`Reward score: ${rewardScore.toFixed(3)}.`);
    if (userMessage) summaryParts.push(`User asked: "${userMessage.slice(0, 200)}"`);
    const summary = summaryParts.join(' ');

    const tags: string[] = [status.toLowerCase()];
    if (events.some(e => e.type === 'LLM_COMPLETED')) tags.push('llm');
    if (events.some(e => e.type === 'REPLY_CONSTRAINT_EVALUATED')) tags.push('constraint');

    const sourceEventIds = [runId];
    const recordId = randomUUID();

    const record: M1EpisodicRecord = {
      id: recordId, tier: 'M1', chat_id: chatId, run_id: runId,
      project_id: projectId, kind: kind as any, title, summary, tags,
      status: status as any, created_at: new Date().toISOString(),
      source_event_ids: sourceEventIds,
      metadata: { model: 'qwen-2.5-coder-3b', provider: 'qwen', reward_score: rewardScore, dag_id: runId },
    };

    await this.m1.writeEpisode(record);

    await this.eventLog.append(
      createRunEvent(runId, chatId, 'MEMORY_WRITTEN', {
        type: 'MEMORY_WRITTEN', tier: 'M1', record_id: recordId, summary: title,
      } as any)
    );
  }

  private extractUserMessage(events: RunEvent[]): string | null {
    for (const e of events) {
      if (e.type === 'RUN_CREATED') {
        const msg = (e as any).data?.message;
        if (typeof msg === 'string' && msg.length > 0) return msg;
      }
    }
    return null;
  }

  private extractNodeCount(events: RunEvent[]): number | null {
    for (const e of events) {
      if (e.type === 'DAG_PLANNED') {
        const count = (e as any).data?.node_count;
        if (typeof count === 'number') return count;
      }
    }
    return null;
  }
}
