// Cognitive Runtime © 2026 by Donald Dominko
// Licensed under CC BY-NC-SA 4.0
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/runtime/src/derive-agent-trust.ts
// Pure function for EMA-based agent trust recalculation.
// No I/O, no LLM calls. All trust state is derived from stored TRUST_UPDATED events.

// EMA smoothing factor: how quickly new observations shift trust.
const EMA_ALPHA = 0.15; // spec: 15% weight on new observation

// Cold-start trust: assigned to agents with no prior trust history.
const COLD_START_TRUST = 0.6; // spec: 0.6 for first run

// Daily decay: trust degrades by this amount per calendar day of inactivity.
const DECAY_PER_DAY = 0.01; // spec: δ = 0.01/day

// Trust floor: trust can never drop below this value.
const TRUST_MIN = 0.1; // spec: clamp lower bound

// Trust ceiling: trust can never exceed this value.
const TRUST_MAX = 0.95; // spec: clamp upper bound

// clamp: constrain n to [min, max] inclusive.
function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n)); // standard min/max clamp
}

// applyDecay: reduce trust proportionally to days elapsed since last update.
// Called on read to simulate passive decay without requiring scheduled jobs.
function applyDecay(trust: number, updatedAt: string, nowMs: number): number {
  const updatedMs   = new Date(updatedAt).getTime(); // parse ISO date to ms
  const daysSince   = (nowMs - updatedMs) / (1000 * 60 * 60 * 24); // elapsed days (float)
  if (daysSince <= 0) return trust;                  // clock skew guard: never increase via decay
  const decayed = trust - DECAY_PER_DAY * daysSince; // linear decay
  return clamp(decayed, TRUST_MIN, TRUST_MAX);        // enforce floor/ceiling after decay
}

// ExistingTrust: the prior trust record for an agent, read from TRUST_UPDATED events.
export type ExistingTrust = {
  trust:     number; // trust_after value from the most recent TRUST_UPDATED event
  updatedAt: string; // ts of that event (ISO-8601) — used to compute decay
};

// TrustUpdateResult: returned by deriveAgentTrust; fields map 1:1 to TRUST_UPDATED event data.
export type TrustUpdateResult = {
  agentId:     string; // agent whose trust was updated
  trust:       number; // new trust_after value (clamped)
  updatedAt:   string; // ISO timestamp of this update
  trust_before:number; // trust after decay, before this run's EMA step
  ema_alpha:   number; // the EMA alpha used (always 0.15 in v0)
};

// deriveAgentTrust: compute the new trust for an agent given its prior state and latest score.
// Formula: T_new = clamp((1 - 0.15) * T_old_decayed + 0.15 * artifact_score, 0.1, 0.95)
export function deriveAgentTrust(params: {
  agentId:       string;               // which agent to update
  existing:      ExistingTrust | null; // null triggers cold-start trust
  artifactScore: number;               // artifact_score from REWARD_COMPUTED
  nowMs?:        number;               // injectable clock for testing (defaults to Date.now())
}): TrustUpdateResult {
  const nowMs  = params.nowMs ?? Date.now(); // use injected clock or real clock
  const nowIso = new Date(nowMs).toISOString(); // ISO timestamp for the event

  // Step 1: determine baseline trust (with decay applied if prior record exists).
  let trustBefore: number;
  if (params.existing === null) {
    trustBefore = COLD_START_TRUST; // first time this agent has been evaluated
  } else {
    // Apply passive decay since last update before the EMA step.
    trustBefore = applyDecay(params.existing.trust, params.existing.updatedAt, nowMs);
  }

  // Step 2: EMA update — blend decayed prior trust with new artifact_score.
  const trustAfter = clamp(
    (1 - EMA_ALPHA) * trustBefore + EMA_ALPHA * params.artifactScore, // weighted average
    TRUST_MIN, // floor
    TRUST_MAX  // ceiling
  );

  return {
    agentId:      params.agentId, // pass through for TRUST_UPDATED event
    trust:        trustAfter,     // new trust value to store
    updatedAt:    nowIso,         // timestamp for decay baseline on next read
    trust_before: trustBefore,    // for audit trail in TRUST_UPDATED event
    ema_alpha:    EMA_ALPHA,      // for audit trail in TRUST_UPDATED event
  };
}
