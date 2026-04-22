// Cognitive Runtime © 2026 by Donald Dominko
// Licensed under CC BY-NC-SA 4.0
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/runtime/src/code-change.ts
// Phase 7: Code-change workflow DAG builder and sandboxed execution helpers.
// No real git operations. No destructive mutations. All simulated.
// Artifacts are represented as events in the append-only log.

import type { DagSpec, DagNode } from '@cognitive-runtime/contracts';

// ── planCodeChangeDag ───────────────────────────────────────────────────────
// Builds a sandboxed code-change DAG with the 6 new node kinds.
// This DAG is an alternative path the Meta-Planner may select.
// The standard 5-node chat DAG is NOT included — this is a separate workflow.
export function planCodeChangeDag(params: {
  run_id: string;
  chat_id: string;
  message: string;
}): DagSpec {
  const dagId = params.run_id;                                    // dag_id = run_id per convention

  const nodes: DagNode[] = [
    {
      id: 'plan_dag',                                             // required entry node
      kind: 'PLAN_DAG',
      depends_on: [],
      retry: { max_attempts: 1, backoff_ms: 0 },
      input: { message_len: params.message.length },
    },
    {
      id: 'persist_user_message',                                 // required: save user message
      kind: 'PERSIST_USER_MESSAGE',
      depends_on: ['plan_dag'],
      retry: { max_attempts: 1, backoff_ms: 0 },
      input: { role: 'user', content_len: params.message.length },
    },
    {
      id: 'codebase_analyze',                                     // Phase 7: analyze codebase
      kind: 'CODEBASE_ANALYZE',
      depends_on: ['persist_user_message'],
      retry: { max_attempts: 1, backoff_ms: 0 },
      input: { message: params.message },
    },
    {
      id: 'patch_plan',                                           // Phase 7: create patch plan
      kind: 'PATCH_PLAN',
      depends_on: ['codebase_analyze'],
      retry: { max_attempts: 1, backoff_ms: 0 },
    },
    {
      id: 'patch_apply_simulated',                                // Phase 7: apply patches in sandbox
      kind: 'PATCH_APPLY_SIMULATED',
      depends_on: ['patch_plan'],
      retry: { max_attempts: 1, backoff_ms: 0 },
    },
    {
      id: 'build_verify',                                         // Phase 7: verify build passes
      kind: 'BUILD_VERIFY',
      depends_on: ['patch_apply_simulated'],
      retry: { max_attempts: 1, backoff_ms: 0 },
    },
    {
      id: 'test_verify',                                          // Phase 7: verify tests pass
      kind: 'TEST_VERIFY',
      depends_on: ['build_verify'],
      retry: { max_attempts: 1, backoff_ms: 0 },
    },
    {
      id: 'patch_review',                                         // Phase 7: final review
      kind: 'PATCH_REVIEW',
      depends_on: ['test_verify'],
      retry: { max_attempts: 1, backoff_ms: 0 },
    },
    {
      id: 'llm_chat',                                             // required: produce assistant reply
      kind: 'LLM_CHAT',
      depends_on: ['patch_review'],
      retry: { max_attempts: 2, backoff_ms: 500 },
      input: { message: params.message },
    },
    {
      id: 'enforce_reply_constraints',                            // required: enforce reply
      kind: 'ENFORCE_REPLY_CONSTRAINTS',
      depends_on: ['llm_chat'],
      retry: { max_attempts: 1, backoff_ms: 0 },
    },
    {
      id: 'persist_assistant_message',                            // required: save assistant message
      kind: 'PERSIST_ASSISTANT_MESSAGE',
      depends_on: ['enforce_reply_constraints'],
      retry: { max_attempts: 1, backoff_ms: 0 },
    },
  ];

  return {
    dag_id: dagId,
    run_id: params.run_id,
    chat_id: params.chat_id,
    created_at: new Date().toISOString(),
    nodes,
  };
}

// ── isCodeChangeTask ────────────────────────────────────────────────────────
// Deterministic classifier: does this user message warrant a code-change workflow?
// Based on keyword matching only — no LLM involved.
const CODE_CHANGE_KEYWORDS = [
  'refactor', 'fix bug', 'fix the bug', 'patch', 'code change',
  'modify file', 'update code', 'change implementation',
  'add function', 'remove function', 'rename', 'restructure',
  'apply fix', 'code fix', 'implement feature',
];

export function isCodeChangeTask(userMessage: string): boolean {
  const lower = (userMessage || '').toLowerCase();                // normalize
  return CODE_CHANGE_KEYWORDS.some(kw => lower.includes(kw));   // check each keyword
}

// ── createSandboxId ─────────────────────────────────────────────────────────
// Deterministic sandbox identifier based on run_id.
export function createSandboxId(runId: string): string {
  return `sandbox-${runId.slice(0, 8)}`;                          // short prefix for readability
}
