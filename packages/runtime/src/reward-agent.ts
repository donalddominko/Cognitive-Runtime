// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/runtime/src/reward-agent.ts
// Pure computation module — NO LLM calls, NO I/O, NO side effects.
// Derives the 7 reward signals from run events and computes the composite artifact_score.
// All randomness is replaced by deterministic epsilon via SHA-256 hash.

import { createHash } from 'crypto'; // Node built-in — deterministic SHA-256
import type { RunEvent }        from '@cognitive-runtime/contracts'; // event union type
import type { RewardSignals, RoutingDecision } from '@cognitive-runtime/contracts'; // reward types

// ── Helpers ──────────────────────────────────────────────────────────────────

// clamp: constrain n to [min, max] inclusive.
function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n)); // standard clamping — used for all signal computations
}

// computeEpsilon: deterministic noise in [-0.05, +0.05] derived from SHA-256.
// Input string: "runId:agentId:kind" — unique per (run, agent, evaluation kind).
// Process: hash → first 4 bytes → unsigned uint32 → linear map to [-0.05, +0.05].
function computeEpsilon(runId: string, agentId: string, kind: string): number {
  const input  = `${runId}:${agentId}:${kind}`; // deterministic input string
  const digest = createHash('sha256').update(input, 'utf8').digest(); // 32-byte SHA-256 digest
  // Read first 4 bytes as big-endian unsigned 32-bit integer.
  // The >>> 0 coerces the bitwise OR result to an unsigned 32-bit integer.
  const uint32 = (
    ((digest[0]! & 0xff) * 0x1000000) + // byte 0: shift left 24 bits (avoid signed overflow)
    ((digest[1]! & 0xff) << 16)        + // byte 1: shift left 16 bits
    ((digest[2]! & 0xff) << 8)         + // byte 2: shift left 8 bits
    ((digest[3]! & 0xff))               // byte 3: no shift
  ) >>> 0;                               // coerce to unsigned 32-bit integer
  // Map [0, 0xffffffff] linearly to [-0.05, +0.05].
  return (uint32 / 0xffffffff) * 0.1 - 0.05; // result is deterministic for same inputs
}

// deriveRouting: maps artifact_score to a RoutingDecision.
// Hard gate takes priority over all score-based thresholds.
function deriveRouting(score: number, hardGate: boolean): RoutingDecision {
  if (hardGate)    return 'hard_stop';            // SYN==0 or SEC==0 → hard stop regardless of score
  if (score >= 0.85) return 'proceed';            // high confidence
  if (score >= 0.70) return 'proceed_with_warning'; // acceptable but flagged
  if (score >= 0.50) return 'retry_layer';        // marginal — retry recommended
  return 'escalate';                              // low confidence — needs human review
}

// ── Public API ───────────────────────────────────────────────────────────────

// Input parameters for a reward computation.
export type RewardInput = {
  runId:   string;      // UUID of the run being evaluated
  agentId: string;      // agent identifier (e.g. 'qwen-local')
  dagId:   string;      // UUID of the DAG that ran (equals runId in this system)
  dagOk:   boolean;     // whether executeDag() returned ok === true
  events:  RunEvent[];  // full ordered event log for the run
};

// Output of a reward computation — all fields stored in REWARD_COMPUTED event.
export type RewardOutput = {
  signals:              RewardSignals;   // the 7 individual signal values
  artifact_score:       number;          // weighted composite in [0, 1]
  routing:              RoutingDecision; // scheduling routing outcome
  epsilon:              number;          // deterministic noise applied to score
  hard_gate_triggered:  boolean;         // true if SYN==0 or SEC==0
};

// computeReward: pure function — given events and context, returns all reward data.
// This is the only export that the worker needs to call.
export function computeReward(input: RewardInput): RewardOutput {
  const { runId, agentId, events, dagOk } = input; // destructure for readability

  // ── Signal: SYN ──────────────────────────────────────────────────────────
  // SYN = 1 if: no VALIDATION_ERROR event exists AND the DAG completed ok.
  // SYN = 0 if: any VALIDATION_ERROR event OR dagOk === false.
  const hasValidationError = events.some(e => e.type === 'VALIDATION_ERROR'); // scan all events
  const SYN: number = (!hasValidationError && dagOk) ? 1 : 0;

  // ── Signal: SEC ──────────────────────────────────────────────────────────
  // SEC = 1 (default): no security scanner events in v0. Future: check SEC_VIOLATION events.
  const SEC: number = 1;

  // ── Signal: RES ──────────────────────────────────────────────────────────
  // RES = 0.5 (default): no resource metering in v0. Future: check resource events.
  const RES = 0.5;

  // ── Signal: PERF ─────────────────────────────────────────────────────────
  // PERF derived from LLM_COMPLETED.latency_ms if present; defaults to 0.5.
  // Formula: clamp(1 - latency_ms / 8000, 0, 1) — 8000ms maps to PERF=0, 0ms maps to PERF=1.
  let PERF = 0.5; // default when no latency data is available
  for (const e of events) {                                 // scan events in order
    if (e.type === 'LLM_COMPLETED') {                       // only LLM_COMPLETED has latency_ms
      const latency = (e as any).data?.latency_ms;          // extract latency_ms from data
      if (typeof latency === 'number' && latency >= 0) {    // only use if present and non-negative
        PERF = clamp(1 - latency / 8000, 0, 1);            // linear degradation with latency
        break;                                              // use first LLM_COMPLETED (primary call)
      }
    }
  }

  // ── Signal: MAINT ────────────────────────────────────────────────────────
  // MAINT = 0.5 (default): no static analysis in v0. Future: check linting events.
  const MAINT = 0.5;

  // ── Penalty: RWK ─────────────────────────────────────────────────────────
  // RWK = min((maxAttempts - 1) / 3, 1): penalises retries across the DAG.
  // maxAttempts is the highest attempt number seen for any single node.
  const attemptsByNode = new Map<string, number>(); // track max attempt per node_id
  for (const e of events) {                         // scan all events
    if (e.type === 'NODE_STARTED') {                // only NODE_STARTED carries attempt
      const nodeId  = (e as any).data?.node_id;    // which node
      const attempt = Number((e as any).data?.attempt ?? 1); // attempt number
      if (typeof nodeId === 'string' && nodeId.length > 0) {  // guard against missing node_id
        const prev = attemptsByNode.get(nodeId) ?? 0; // previous max for this node
        if (attempt > prev) attemptsByNode.set(nodeId, attempt); // keep the maximum
      }
    }
  }
  let maxAttempts = 1; // baseline: 1 attempt = no rework
  for (const v of attemptsByNode.values()) {        // find global max across all nodes
    if (v > maxAttempts) maxAttempts = v;
  }
  const RWK = Math.min((maxAttempts - 1) / 3, 1); // 1 extra attempt = 0.33 penalty, 3+ = full penalty

  // ── Penalty: HUM ─────────────────────────────────────────────────────────
  // HUM = 0 (default): no human-override events in v0.
  const HUM = 0;

  // ── Hard gates ───────────────────────────────────────────────────────────
  // If SYN == 0 OR SEC == 0, score is forced to 0 regardless of other signals.
  const hardGate = (SYN === 0) || (SEC === 0); // either gate trips hard stop

  // ── Composite score ───────────────────────────────────────────────────────
  // Formula from spec: 0.35*SYN + 0.35*SEC + 0.20*RES + 0.05*PERF + 0.05*MAINT - 0.10*RWK - 0.15*HUM
  const rawScore = hardGate
    ? 0 // hard gate overrides all positive contributions
    : 0.35 * SYN +   // syntactic correctness (heaviest weight)
      0.35 * SEC +   // security (equal weight to SYN)
      0.20 * RES +   // resource usage
      0.05 * PERF +  // performance
      0.05 * MAINT - // maintainability
      0.10 * RWK -   // rework penalty subtractor
      0.15 * HUM;    // human-override penalty subtractor

  const artifact_score = clamp(rawScore, 0, 1); // ensure output stays in [0, 1]

  // ── Epsilon & routing ─────────────────────────────────────────────────────
  const epsilon = computeEpsilon(runId, agentId, 'reward'); // deterministic noise
  const routing = deriveRouting(artifact_score, hardGate);  // threshold-based decision

  // ── Assemble signals record ───────────────────────────────────────────────
  const signals: RewardSignals = {
    SYN,   // binary correctness
    SEC,   // security (always 1 in v0)
    RES,   // resource (0.5 in v0)
    PERF,  // latency-derived
    MAINT, // maintainability (0.5 in v0)
    RWK,   // rework penalty
    HUM,   // human override (0 in v0)
  };

  return {
    signals,            // all 7 raw signal values
    artifact_score,     // final clamped composite score
    routing,            // routing decision for scheduler
    epsilon,            // deterministic noise for audit trail
    hard_gate_triggered: hardGate, // whether a hard gate fired
  };
}
