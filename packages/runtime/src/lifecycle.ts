// Cognitive Runtime © 2026 by Donald Dominko
// Licensed under CC BY-NC-SA 4.0
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/runtime/src/lifecycle.ts
// Phase 7: Production hardening helpers — timeout, cancel, stale detection, failure classification.
// Pure functions with no I/O. All state derived from events.

import type { RunEvent } from '@cognitive-runtime/contracts';
import type { Phase7Config, FailedRunClass } from '@cognitive-runtime/contracts';

// ── Phase7 Config factory ───────────────────────────────────────────────────
// Reads env vars and returns a Phase7Config with safe defaults.
export function createPhase7Config(env: Record<string, string | undefined>): Phase7Config {
  return {
    enable_code_change_workflow: env.ENABLE_CODE_CHANGE_WORKFLOW === 'true',     // default false
    enable_replanning:           env.ENABLE_REPLANNING === 'true',               // default false
    enable_policy_gate:          env.ENABLE_POLICY_GATE === 'true',              // default false
    enable_run_cancellation:     env.ENABLE_RUN_CANCELLATION !== 'false',        // default true
    max_planner_loops:           Math.min(10, Math.max(1, parseInt(env.MAX_PLANNER_LOOPS || '3', 10) || 3)), // default 3
    run_timeout_ms:              Math.max(0, parseInt(env.RUN_TIMEOUT_MS || '300000', 10) || 300000),        // default 5min
    stale_heartbeat_ms:          Math.max(0, parseInt(env.STALE_HEARTBEAT_MS || '60000', 10) || 60000),     // default 60s
  };
}

// ── isRunCancelled ──────────────────────────────────────────────────────────
// Returns true if the event log contains a RUN_CANCEL_REQUESTED event.
export function isRunCancelled(events: RunEvent[]): boolean {
  return events.some(e => e.type === 'RUN_CANCEL_REQUESTED');   // scan for cancel request
}

// ── isRunTimedOut ───────────────────────────────────────────────────────────
// Returns true if elapsed time since first WORKER_STARTED exceeds timeout.
export function isRunTimedOut(events: RunEvent[], timeoutMs: number, nowMs?: number): boolean {
  if (timeoutMs <= 0) return false;                              // timeout disabled
  const now = nowMs ?? Date.now();                               // injectable clock
  for (const e of events) {                                      // find first WORKER_STARTED
    if (e.type === 'WORKER_STARTED') {
      const startMs = new Date(e.ts).getTime();                  // parse timestamp
      if (Number.isFinite(startMs) && (now - startMs) > timeoutMs) {
        return true;                                              // timeout exceeded
      }
      return false;                                               // within timeout
    }
  }
  return false;                                                   // no WORKER_STARTED found
}

// ── getElapsedSinceStart ────────────────────────────────────────────────────
// Returns milliseconds elapsed since first WORKER_STARTED, or null if not started.
export function getElapsedSinceStart(events: RunEvent[], nowMs?: number): number | null {
  const now = nowMs ?? Date.now();                               // injectable clock
  for (const e of events) {                                      // find first WORKER_STARTED
    if (e.type === 'WORKER_STARTED') {
      const startMs = new Date(e.ts).getTime();                  // parse timestamp
      if (Number.isFinite(startMs)) return now - startMs;        // return elapsed
      return null;                                                // unparseable timestamp
    }
  }
  return null;                                                    // not started
}

// ── isHeartbeatStale ────────────────────────────────────────────────────────
// Returns true if time since last WORKER_HEARTBEAT exceeds threshold.
// Also returns the last heartbeat timestamp for audit.
export function isHeartbeatStale(
  events: RunEvent[],
  staleThresholdMs: number,
  nowMs?: number,
): { stale: boolean; lastHeartbeatTs: string | null; elapsedSinceHbMs: number | null } {
  if (staleThresholdMs <= 0) return { stale: false, lastHeartbeatTs: null, elapsedSinceHbMs: null }; // disabled
  const now = nowMs ?? Date.now();                               // injectable clock

  // Find last heartbeat or worker_started (in reverse for efficiency).
  let lastTs: string | null = null;
  for (let i = events.length - 1; i >= 0; i--) {                // reverse scan
    const e = events[i]!;
    if (e.type === 'WORKER_HEARTBEAT' || e.type === 'WORKER_STARTED') {
      lastTs = e.ts;                                              // found most recent pulse
      break;
    }
  }

  if (lastTs === null) return { stale: false, lastHeartbeatTs: null, elapsedSinceHbMs: null }; // no pulse found

  const lastMs = new Date(lastTs).getTime();                     // parse timestamp
  if (!Number.isFinite(lastMs)) return { stale: false, lastHeartbeatTs: lastTs, elapsedSinceHbMs: null }; // unparseable

  const elapsed = now - lastMs;                                  // time since last pulse
  return {
    stale: elapsed > staleThresholdMs,                           // stale if exceeded
    lastHeartbeatTs: lastTs,                                     // audit: when was the last pulse
    elapsedSinceHbMs: elapsed,                                   // audit: how long ago
  };
}

// ── hasTerminalEvent ────────────────────────────────────────────────────────
// Returns true if the run already has a terminal event (RUN_COMPLETED or RUN_CANCELLED).
// Used for duplicate-event prevention.
export function hasTerminalEvent(events: RunEvent[]): boolean {
  return events.some(e => e.type === 'RUN_COMPLETED' || e.type === 'RUN_CANCELLED'); // terminal check
}

// ── classifyFailedRun ───────────────────────────────────────────────────────
// Deterministic classification of a failed run based on its events.
// Returns classification + reason + whether it's retriable.
export function classifyFailedRun(events: RunEvent[]): {
  classification: FailedRunClass;
  reason: string;
  retriable: boolean;
} {
  // Check for cancellation first.
  if (events.some(e => e.type === 'RUN_CANCELLED' || e.type === 'RUN_CANCEL_REQUESTED')) {
    return { classification: 'CANCELLED', reason: 'Run was cancelled by user or system.', retriable: false };
  }

  // Check for stale detection.
  if (events.some(e => e.type === 'RUN_STALE_DETECTED')) {
    return { classification: 'STALE', reason: 'Worker heartbeat expired; worker may have died.', retriable: true };
  }

  // Check for timeout.
  if (events.some(e => e.type === 'RUN_TIMEOUT_REACHED')) {
    return { classification: 'TRANSIENT', reason: 'Run exceeded configured timeout.', retriable: true };
  }

  // Check for policy block.
  const policyBlock = events.find(e => e.type === 'POLICY_EVALUATED' && (e as any).data?.verdict === 'BLOCKED');
  if (policyBlock) {
    return { classification: 'PERMANENT', reason: 'Run blocked by policy gate.', retriable: false };
  }

  // Check for validation errors (permanent).
  if (events.some(e => e.type === 'VALIDATION_ERROR')) {
    return { classification: 'PERMANENT', reason: 'Schema validation failed.', retriable: false };
  }

  // Check retry exhaustion — count NODE_FAILED events per node.
  const nodeFailCounts = new Map<string, number>();              // node_id -> fail count
  for (const e of events) {
    if (e.type === 'NODE_FAILED') {
      const nodeId = (e as any).data?.node_id ?? '';
      nodeFailCounts.set(nodeId, (nodeFailCounts.get(nodeId) ?? 0) + 1);
    }
  }
  const maxFails = Math.max(0, ...nodeFailCounts.values());
  if (maxFails >= 2) {
    return { classification: 'DEAD_LETTER', reason: `Node retries exhausted (max ${maxFails} failures on single node).`, retriable: false };
  }

  // Check for runtime errors (transient by default).
  if (events.some(e => e.type === 'RUNTIME_ERROR')) {
    const errEvent = events.find(e => e.type === 'RUNTIME_ERROR');
    const code = (errEvent as any)?.data?.code ?? 'UNKNOWN';
    return { classification: 'TRANSIENT', reason: `Runtime error: ${code}`, retriable: true };
  }

  // Default: transient with unknown reason.
  return { classification: 'TRANSIENT', reason: 'Run failed for unknown reason.', retriable: true };
}

// ── getActiveNodeId ─────────────────────────────────────────────────────────
// Returns the node_id of the currently running node, or null if none.
export function getActiveNodeId(events: RunEvent[]): string | null {
  const started = new Set<string>();                             // nodes that started
  const finished = new Set<string>();                            // nodes that succeeded or failed

  for (const e of events) {
    const nodeId = (e as any).data?.node_id;
    if (typeof nodeId !== 'string' || nodeId.length === 0) continue;

    if (e.type === 'NODE_STARTED') started.add(nodeId);          // track started
    if (e.type === 'NODE_SUCCEEDED' || e.type === 'NODE_FAILED') finished.add(nodeId); // track finished
  }

  // Find a node that started but never finished.
  for (const nodeId of started) {
    if (!finished.has(nodeId)) return nodeId;                    // still active
  }
  return null;                                                    // no active node
}
