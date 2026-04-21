// Cognitive Runtime © 2026 by Donald Dominko
// Licensed under CC BY-NC-SA 4.0
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/contracts/src/reward.ts
// Phase 4: Zod schemas for reward signals, routing decisions, and the 4 new event data shapes.
// This file is contract-first: all reward data written to the DB is validated here before storage.

import { z } from 'zod';          // Zod for runtime schema validation
import { zUUID } from './common.js'; // shared UUID validator from the project contracts

// ── Reward signal scores ────────────────────────────────────────────────────
// Each signal is a float in [0, 1]. The emitter clamps before storing.

export const zRewardSignals = z.object({
  SYN:  z.number().min(0).max(1), // syntactic/semantic correctness (0 or 1 in v0)
  SEC:  z.number().min(0).max(1), // security (1 = clean, 0 = security event detected)
  RES:  z.number().min(0).max(1), // resource usage (0.5 default in v0)
  PERF: z.number().min(0).max(1), // latency-derived performance signal
  MAINT:z.number().min(0).max(1), // maintainability (0.5 default in v0)
  RWK:  z.number().min(0).max(1), // rework penalty fraction (driven by retry count)
  HUM:  z.number().min(0).max(1), // human-override penalty (0 default in v0)
});
export type RewardSignals = z.infer<typeof zRewardSignals>; // TypeScript type derived from schema

// ── Routing decision ────────────────────────────────────────────────────────
// Outcome derived from artifact_score and hard gates; drives downstream scheduling.

export const zRoutingDecision = z.enum([
  'proceed',              // artifact_score >= 0.85
  'proceed_with_warning', // artifact_score >= 0.70
  'retry_layer',          // artifact_score >= 0.50
  'escalate',             // artifact_score < 0.50
  'hard_stop',            // SYN == 0 OR SEC == 0 (hard gate overrides score)
]);
export type RoutingDecision = z.infer<typeof zRoutingDecision>; // union string type

// ── Event data schemas ──────────────────────────────────────────────────────
// Each schema matches one entry in the zRunEvent discriminated union (events.ts).
// The `type` literal is optional because some emitters include it in data, some don't.
// `.passthrough()` allows future extra fields without breaking old readers.

// REWARD_AGENT_STARTED: emitted at the beginning of the post-DAG reward block.
export const zRewardAgentStartedData = z
  .object({
    type:     z.literal('REWARD_AGENT_STARTED').optional(), // optional discriminator echo in data
    agent_id: z.string().min(1),  // e.g. 'qwen-local' — the agent being evaluated
    dag_id:   zUUID,              // the run's dag_id (equals run_id per Option B spec)
  })
  .passthrough();
export type RewardAgentStartedData = z.infer<typeof zRewardAgentStartedData>;

// REWARD_COMPUTED: primary reward event carrying all signals, composite score, and routing.
export const zRewardComputedData = z
  .object({
    type:               z.literal('REWARD_COMPUTED').optional(), // optional discriminator echo
    agent_id:           z.string().min(1),          // agent that produced the reward
    dag_id:             zUUID,                       // DAG that was evaluated
    signals:            zRewardSignals,              // all 7 individual signal values
    artifact_score:     z.number().min(0).max(1),   // weighted composite after clamping
    routing:            zRoutingDecision,            // scheduling routing outcome
    epsilon:            z.number(),                  // deterministic noise in [-0.05, +0.05]
    hard_gate_triggered:z.boolean(),                 // true if SYN==0 or SEC==0 triggered
  })
  .passthrough();
export type RewardComputedData = z.infer<typeof zRewardComputedData>;

// TRUST_UPDATED: emitted once per run after the EMA trust recalculation for the agent.
export const zTrustUpdatedData = z
  .object({
    type:          z.literal('TRUST_UPDATED').optional(), // optional discriminator echo
    agent_id:      z.string().min(1),           // agent whose trust was recalculated
    trust_before:  z.number().min(0).max(1),    // trust after decay, before this run
    trust_after:   z.number().min(0).max(1),    // new trust after EMA update
    artifact_score:z.number().min(0).max(1),    // the score that drove the update
    ema_alpha:     z.number().min(0).max(1),    // EMA smoothing factor used (0.15)
  })
  .passthrough();
export type TrustUpdatedData = z.infer<typeof zTrustUpdatedData>;

// REWARD_AGENT_COMPLETED: emitted at the end of the reward block (success or skip).
export const zRewardAgentCompletedData = z
  .object({
    type:     z.literal('REWARD_AGENT_COMPLETED').optional(), // optional discriminator echo
    agent_id: z.string().min(1), // agent that completed the reward block
    dag_id:   zUUID,             // DAG that was evaluated
    ok:       z.boolean(),       // true = reward block ran successfully
    routing:  zRoutingDecision,  // final routing decision produced
  })
  .passthrough();
export type RewardAgentCompletedData = z.infer<typeof zRewardAgentCompletedData>;
