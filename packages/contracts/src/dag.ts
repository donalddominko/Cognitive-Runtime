// Cognitive Runtime © 2026 by Donald Dominko
// Licensed under CC BY-NC-SA 4.0
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/contracts/src/dag.ts
// Zod schemas and TypeScript types for DAG specifications, node definitions, run state, and
// legacy input normalization.
//
// Invariants:
//   - DagSpec is the canonical, validated form used by the executor; normalizeDagSpecInput
//     converts any legacy aliases to canonical form before execution.
//   - DAGRunState is DERIVED from append-only events; it is never stored directly.
//   - depends_on is always string[]; legacy 'dependson' is normalised at boundary.
//   - Node statuses ('PENDING'|'RUNNING'|'SUCCEEDED'|'FAILED'|'SKIPPED') are derived, not stored.
//
// Exports: zNodeStatus, zRunStatus, zNodeKind, zDagNodeRetry, zDagNode, zDagSpec, zNodeResult,
//          zDagDerivedStatus, zDagNodeAttemptStatus, zDagNodeAttemptState, zDagNodeState,
//          zDagRunState, normalizeDagNodeInput, normalizeDagSpecInput, and their TypeScript types.

import { z } from 'zod';
import { zISODateString, zUUID } from './common.js';

export const zNodeStatus = z.enum([
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'SKIPPED',
]);
export type NodeStatus = z.infer<typeof zNodeStatus>;

export const zRunStatus = z.enum([
  'CREATED',
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
]);
export type RunStatus = z.infer<typeof zRunStatus>;

export const zNodeKind = z.enum([
  'NOOP',
  'PLAN_DAG',
  'PERSIST_USER_MESSAGE',
  'LLM_CHAT',

  // Step 3B+: deterministic, audited enforcement between LLM and persistence
  'ENFORCE_REPLY_CONSTRAINTS',

  'PERSIST_ASSISTANT_MESSAGE',

  'CODEBASE_ANALYZE',
  'PATCH_PLAN',
  'PATCH_APPLY_SIMULATED',
  'BUILD_VERIFY',
  'TEST_VERIFY',
  'PATCH_REVIEW',
]);
export type NodeKind = z.infer<typeof zNodeKind>;

export const zDagNodeRetry = z.object({
  max_attempts: z.number().int().min(1).max(2).default(1),
  backoff_ms: z.number().int().min(0).default(0),
});
export type DagNodeRetry = z.infer<typeof zDagNodeRetry>;

export const zDagNode = z.object({
  id: z.string().min(1),
  kind: zNodeKind,
  depends_on: z.array(z.string().min(1)).default([]),
  retry: zDagNodeRetry.default({ max_attempts: 1, backoff_ms: 0 }),
  input: z.unknown().optional(),
});
export type DagNode = z.infer<typeof zDagNode>;

export const zDagSpec = z.object({
  dag_id: zUUID,
  run_id: zUUID,
  chat_id: zUUID,
  created_at: zISODateString,
  nodes: z.array(zDagNode).min(1),
});
export type DagSpec = z.infer<typeof zDagSpec>;

export const zNodeResult = z.object({
  ok: z.boolean(),
  output: z.unknown().optional(),
  error: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1),
      details: z.unknown().optional(),
    })
    .optional(),
});
export type NodeResult = z.infer<typeof zNodeResult>;

/**
 * Step 3 alignment (Strategy A):
 * - Canonical contracts + normalization at boundaries
 * - Derived state computed from append-only events (events are the truth)
 */

export const zDagDerivedStatus = z.enum([
  'CREATED',
  'PLANNED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
]);
export type DagDerivedStatus = z.infer<typeof zDagDerivedStatus>;

export const zDagNodeAttemptStatus = z.enum(['RUNNING', 'SUCCEEDED', 'FAILED']);
export type DagNodeAttemptStatus = z.infer<typeof zDagNodeAttemptStatus>;

export const zDagNodeAttemptState = z.object({
  attempt: z.number().int().min(1),
  status: zDagNodeAttemptStatus,
  started_at: zISODateString.optional(),
  finished_at: zISODateString.optional(),
  error: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1),
      details: z.unknown().optional(),
    })
    .optional(),
  output_summary: z
    .object({
      bytes: z.number().int().min(0).optional(),
    })
    .optional(),
});
export type DagNodeAttemptState = z.infer<typeof zDagNodeAttemptState>;

export const zDagNodeState = z.object({
  node_id: z.string().min(1),
  kind: zNodeKind.optional(),
  status: zNodeStatus,
  last_attempt: z.number().int().min(0).default(0),
  attempts: z.array(zDagNodeAttemptState).default([]),
});
export type DagNodeState = z.infer<typeof zDagNodeState>;

export const zDagRunState = z.object({
  run_id: zUUID,
  chat_id: zUUID,

  // Some older/edge runs might not have DAG events; keep optional for safety.
  dag_id: zUUID.optional(),

  status: zDagDerivedStatus,

  created_at: zISODateString.optional(),
  planned_at: zISODateString.optional(),
  started_at: zISODateString.optional(),
  completed_at: zISODateString.optional(),

  ok: z.boolean().optional(),
  node_count: z.number().int().min(0).optional(),

  // Deterministic order: the deriver must sort (e.g., node_id asc).
  node_order: z.array(z.string().min(1)).default([]),

  // Node states must correspond to node_order (same ids).
  nodes: z.array(zDagNodeState).default([]),
});
export type DAGRunState = z.infer<typeof zDagRunState>;

/**
 * Legacy-compatible DAG spec input normalization.
 *
 * Canonical internal shape (already used by executor):
 * - depends_on: string[]
 * - input: unknown
 * - retry: { max_attempts, backoff_ms }
 *
 * Accepted legacy aliases:
 * - dependson -> depends_on
 * - inputs -> input
 * - retry.maxattempts -> retry.max_attempts
 * - retry.backoffms -> retry.backoff_ms
 * - dagid/runid/chatid/createdat -> dag_id/run_id/chat_id/created_at
 */

const zDagNodeRetryLegacy = z
  .object({
    maxattempts: z.number().int().min(1).max(2).optional(),
    backoffms: z.number().int().min(0).optional(),
  })
  .passthrough();

const zDagNodeInput = z
  .object({
    id: z.string().min(1),
    kind: zNodeKind,

    // canonical
    depends_on: z.array(z.string().min(1)).optional(),
    retry: z.union([zDagNodeRetry, zDagNodeRetry.partial(), zDagNodeRetryLegacy]).optional(),
    input: z.unknown().optional(),

    // legacy
    dependson: z.array(z.string().min(1)).optional(),
    inputs: z.unknown().optional(),
  })
  .passthrough();

const zDagSpecInput = z
  .object({
    // canonical
    dag_id: zUUID.optional(),
    run_id: zUUID.optional(),
    chat_id: zUUID.optional(),
    created_at: zISODateString.optional(),

    // legacy
    dagid: zUUID.optional(),
    runid: zUUID.optional(),
    chatid: zUUID.optional(),
    createdat: zISODateString.optional(),

    nodes: z.array(zDagNodeInput).min(1),
  })
  .passthrough();

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

export function normalizeDagNodeInput(input: unknown): DagNode {
  const n = zDagNodeInput.parse(input);

  const depends_on = (n.depends_on ?? n.dependson ?? []).filter(
    (x): x is string => typeof x === 'string' && x.trim().length > 0
  );

  const retryRaw: any = n.retry ?? {};
  const max_attempts = clampInt(
    retryRaw.max_attempts ?? retryRaw.maxattempts,
    1,
    2,
    1
  );
  const backoff_ms = clampInt(
    retryRaw.backoff_ms ?? retryRaw.backoffms,
    0,
    60_000,
    0
  );

  const node: DagNode = {
    id: n.id,
    kind: n.kind,
    depends_on,
    retry: { max_attempts, backoff_ms },
    input: n.input !== undefined ? n.input : n.inputs,
  };

  return zDagNode.parse(node);
}

export function normalizeDagSpecInput(input: unknown): DagSpec {
  const s = zDagSpecInput.parse(input);

  const dag_id = s.dag_id ?? s.dagid;
  const run_id = s.run_id ?? s.runid;
  const chat_id = s.chat_id ?? s.chatid;
  const created_at = s.created_at ?? s.createdat;

  if (!dag_id || !run_id || !chat_id || !created_at) {
    throw new Error(
      'DAG_SPEC_INVALID: missing dag_id/run_id/chat_id/created_at (canonical or legacy aliases)'
    );
  }

  const nodes = s.nodes.map((n) => normalizeDagNodeInput(n));

  const spec: DagSpec = {
    dag_id,
    run_id,
    chat_id,
    created_at,
    nodes,
  };

  return zDagSpec.parse(spec);
}
