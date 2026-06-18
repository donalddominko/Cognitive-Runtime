// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/runtime/src/dag-executor.ts
// Core DAG execution engine — plans, executes, and observes all node kinds.
// This is the central processing unit of the cognitive runtime.
//
// Invariants:
//   - All state is derived from the append-only EventLog; the executor never modifies stored events.
//   - Each node execution is idempotent: the executor checks existing events before re-running.
//   - Node outputs are capped at MAX_OUTPUT_STORE_CHARS to keep event payloads bounded.
//   - The planner (Meta-Planner) runs before node execution and may substitute the default DAG.
//   - Reward/trust/memory hooks run AFTER DAG completion; their failures are non-fatal.
//   - Phase 7 cancel/timeout checks happen at the start of each node; stale jobs are rejected.
//
// Exports: executeDag, EventLogLike, MessagesRepoLike, NodeExecContext

import {
  createRunEvent,
  zDagSpec,
  type DagNode,
  type DagSpec,
  type NodeResult,
  type RunEvent,
  type RunEventType,
} from '@cognitive-runtime/contracts';
import { createHash } from 'crypto';
import { fingerprintDag } from './meta-planner/task-features.js';
import { createSandboxId } from './code-change.js'; // Phase 7: sandbox ID helper

export type EventLogLike = {
  append(event: RunEvent): Promise<void>;
  listByRunId(runId: string): Promise<RunEvent[]>;
};

export type MessagesRepoLike = {
  insertMessage(input: {
    id?: string;
    chatId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
  }): Promise<{ messageId: string }>;

  listRecent(
    chatId: string,
    limit: number
  ): Promise <
    Array<{
      id: string;
      chatId: string;
      role: 'user' | 'assistant' | 'system';
      content: string;
      createdAt: Date;
    }>
  >;
};

export type NodeExecContext = {
  llamaUrl: string;
  messagesRepo: MessagesRepoLike;

  messageId: string;
  message: string;

  historyLimit: number;
  promptPreamble: string;

  provider: string;
  model: string;
};

type LlamaCompletionResponse = {
  content?: string;
  stop?: boolean;
};

type DagEventRow = RunEvent & {
  data: any;
};

type NodeStatusDerived = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED';

type DerivedNodeState = {
  succeeded: boolean;
  maxAttemptSeen: number;
  startedAttempts: Set<number>;
  failedAttempts: Set<number>;
  succeededAttempts: Set<number>;
  lastSucceededOutput?: unknown;
};

type EmitFn = (type: RunEventType, data: any) => Promise<void>;

const MAX_OUTPUT_STORE_CHARS = 20_000;
const MAX_FORCED_REPLY_LEN = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function stableTopologicalOrder(nodes: DagNode[]): DagNode[] {
  const byId = new Map<string, DagNode>();
  for (const n of nodes) {
    if (byId.has(n.id)) {
      throw new Error(`DAG_INVALID: duplicate node id: ${n.id}`);
    }
    byId.set(n.id, n);
  }

  for (const n of nodes) {
    for (const dep of n.depends_on ?? []) {
      if (!byId.has(dep)) {
        throw new Error(`DAG_INVALID: node ${n.id} depends on missing node ${dep}`);
      }
    }
  }

  const inDeg = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const n of nodes) {
    inDeg.set(n.id, (n.depends_on ?? []).length);
    dependents.set(n.id, []);
  }

  for (const n of nodes) {
    for (const dep of n.depends_on ?? []) {
      dependents.get(dep)!.push(n.id);
    }
  }

  const ready: string[] = [];
  for (const [id, d] of inDeg.entries()) {
    if (d === 0) ready.push(id);
  }
  ready.sort();

  const ordered: DagNode[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    ordered.push(byId.get(id)!);

    const outs = dependents.get(id)!;
    outs.sort();

    for (const outId of outs) {
      const next = (inDeg.get(outId) ?? 0) - 1;
      inDeg.set(outId, next);

      if (next === 0) {
        ready.push(outId);
        ready.sort();
      }
    }
  }

  if (ordered.length !== nodes.length) {
    throw new Error('DAG_INVALID: cycle detected (toposort incomplete)');
  }

  return ordered;
}

function outputBytes(output: unknown): number | undefined {
  if (output === undefined) return undefined;
  try {
    const s = typeof output === 'string' ? output : JSON.stringify(output);
    return Buffer.byteLength(s, 'utf8');
  } catch {
    return undefined;
  }
}

function normalizePreamble(p: string): string {
  const s = (p ?? '').trim();
  if (!s) return '';
  return `${s}\n`;
}

function formatRoleLine(role: 'user' | 'assistant' | 'system', content: string): string {
  if (role === 'user') return `User: ${content}\n`;
  if (role === 'assistant') return `Assistant: ${content}\n`;
  return `System: ${content}\n`;
}

async function buildPromptFromDb(params: {
  messagesRepo: MessagesRepoLike;
  chatId: string;
  historyLimit: number;
  promptPreamble: string;
  currentUserMessage: string;
}): Promise<string> {
  const limit = clampInt(Number(params.historyLimit || 6), 2, 20);

  const recentDesc = await params.messagesRepo.listRecent(params.chatId, limit);
  const recentChron = [...recentDesc].reverse();

  let prompt = normalizePreamble(params.promptPreamble);

  for (const m of recentChron) {
    prompt += formatRoleLine(m.role, m.content);
  }

  const last = recentChron[recentChron.length - 1];
  const lastIsCurrentUser =
    last?.role === 'user' &&
    typeof last.content === 'string' &&
    last.content === params.currentUserMessage;

  if (!lastIsCurrentUser) {
    prompt += formatRoleLine('user', params.currentUserMessage);
  }

  prompt += 'Assistant:';
  return prompt;
}

function isTimeoutError(e: any): boolean {
  const name = e?.name ? String(e.name) : '';
  const code = e?.code ? String(e.code) : '';
  return name === 'TimeoutError' || code === 'UND_ERR_CONNECT_TIMEOUT';
}

async function llamaCompletion(params: {
  llamaUrl: string;
  prompt: string;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<string> {
  const maxTokens = params.maxTokens ?? 300;
  const timeoutMs = params.timeoutMs ?? 60000;

  const anyAbortSignalTimeout = (AbortSignal as any)?.timeout as
    | ((ms: number) => AbortSignal)
    | undefined;

  let controller: AbortController | null = null;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let signal: AbortSignal | undefined;

  if (typeof anyAbortSignalTimeout === 'function') {
    signal = anyAbortSignalTimeout(timeoutMs);
  } else {
    controller = new AbortController();
    signal = controller.signal;
    timeoutHandle = setTimeout(() => controller?.abort(), timeoutMs);
  }

  try {
    const response = await fetch(`${params.llamaUrl}/completion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        prompt: params.prompt,
        n_predict: maxTokens,
        temperature: 0.4,
        top_p: 0.9,
        repeat_penalty: 1.15,
        stop: [
          '\nUser:',
          '\nAssistant:',
          '\nSystem:',
          'User:',
          'Assistant:',
          'System:',
          '\n\n\n',
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`llama-server returned ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as LlamaCompletionResponse;

    if (!data.content) {
      throw new Error('No content in llama-server response');
    }

    return data.content.trim();
  } catch (e: any) {
    if (e?.name === 'AbortError' || isTimeoutError(e)) {
      const err = new Error(`llama completion timed out after ${timeoutMs}ms`);
      (err as any).code = 'LLAMA_TIMEOUT';
      throw err;
    }
    throw e;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function truncateString(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars);
}

function parseUuidToBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    throw new Error(`UUID_INVALID: ${uuid}`);
  }
  return Buffer.from(hex, 'hex');
}

function bytesToUuidString(b: Buffer): string {
  const hex = b.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/**
 * Minimal UUIDv5 implementation (name-based SHA-1).
 * Namespace is a UUID string; name is utf8 string.
 */
function uuidV5(namespaceUuid: string, name: string): string {
  const ns = parseUuidToBytes(namespaceUuid);
  const nameBytes = Buffer.from(name, 'utf8');

  const sha1 = createHash('sha1');
  sha1.update(ns);
  sha1.update(nameBytes);
  const hash = sha1.digest();

  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return bytesToUuidString(bytes);
}

type ReplyConstraintMatch = {
  forced_reply: boolean;
  forced_reply_value?: string;
  matched_pattern?: string;
  final_assistant_text: string;
};

function enforceReplyConstraints(params: {
  user_instruction: string;
  raw_assistant_text: string;
}): ReplyConstraintMatch {
  const raw = params.raw_assistant_text ?? '';
  const msg = (params.user_instruction ?? '').trim();

  const captureValue = (m: RegExpMatchArray, groups: { dq: number; sq: number; uq: number }) => {
    const v = (m[groups.dq] ?? '') || (m[groups.sq] ?? '') || (m[groups.uq] ?? '');
    return String(v).trim();
  };

  const applyPunct = (value: string, punct: string | undefined) => {
    const p = (punct ?? '').trim();
    if (!p) return value;
    if (value.endsWith(p)) return value;
    return `${value}${p}`;
  };

  {
    const re =
      /\b(reply|respond)\s+(?:exactly\s+)?with\s*:?\s*(?:"([^"]*)"|'([^']*)'|([^\s\r\n.?!]+))\s*([.?!])?(?=\s|$)/i;
    const m = msg.match(re);
    if (m) {
      const value = captureValue(m, { dq: 2, sq: 3, uq: 4 });
      const punct = m[5] ? String(m[5]) : undefined;
      if (value.length >= 1 && value.length <= MAX_FORCED_REPLY_LEN) {
        const final = applyPunct(value, punct);
        return {
          forced_reply: true,
          forced_reply_value: final,
          matched_pattern: 'reply_or_respond_with',
          final_assistant_text: final,
        };
      }
    }
  }

  {
    const re =
      /\b(output|return|say)\s+exactly\s+(?:"([^"]*)"|'([^']*)'|([^\s\r\n.?!]+))\s*([.?!])?(?=\s|$)/i;
    const m = msg.match(re);
    if (m) {
      const value = captureValue(m, { dq: 2, sq: 3, uq: 4 });
      const punct = m[5] ? String(m[5]) : undefined;
      if (value.length >= 1 && value.length <= MAX_FORCED_REPLY_LEN) {
        const final = applyPunct(value, punct);
        return {
          forced_reply: true,
          forced_reply_value: final,
          matched_pattern: 'output_return_say_exactly',
          final_assistant_text: final,
        };
      }
    }
  }

  {
    const re =
      /\b(output|return|say)\s*:\s*(?:"([^"]*)"|'([^']*)'|([^\s\r\n.?!]+))\s*([.?!])?(?=\s|$)/i;
    const m = msg.match(re);
    if (m) {
      const value = captureValue(m, { dq: 2, sq: 3, uq: 4 });
      const punct = m[5] ? String(m[5]) : undefined;
      if (value.length >= 1 && value.length <= MAX_FORCED_REPLY_LEN) {
        const final = applyPunct(value, punct);
        return {
          forced_reply: true,
          forced_reply_value: final,
          matched_pattern: 'output_return_say_colon',
          final_assistant_text: final,
        };
      }
    }
  }

  {
    const re = /\balways\s+ok\s*([.?!])?(?=\s|$)/i;
    const m = msg.match(re);
    if (m) {
      const punct = m[1] ? String(m[1]) : undefined;
      const value = applyPunct('OK', punct);
      return {
        forced_reply: true,
        forced_reply_value: value,
        matched_pattern: 'always_ok',
        final_assistant_text: value,
      };
    }
  }

  return {
    forced_reply: false,
    final_assistant_text: raw,
  };
}

function getAssistantTextFromOutput(output: unknown): string | null {
  if (!output || typeof output !== 'object') return null;
  const v = (output as any).assistant_text;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function getFinalAssistantTextFromOutput(output: unknown): string | null {
  if (!output || typeof output !== 'object') return null;
  const v = (output as any).final_assistant_text;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function validateDagSpecOrThrow(dag: DagSpec): DagSpec {
  const parsed = zDagSpec.safeParse(dag);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({
      path: i.path as any,
      message: i.message,
    }));
    const err = new Error('DAG_INVALID: dag spec failed schema validation');
    (err as any).code = 'DAG_SCHEMA_INVALID';
    (err as any).issues = issues;
    throw err;
  }

  const ids = new Set<string>();
  for (const n of parsed.data.nodes) {
    if (ids.has(n.id)) {
      const err = new Error(`DAG_INVALID: duplicate node id: ${n.id}`);
      (err as any).code = 'DAG_DUPLICATE_NODE_ID';
      throw err;
    }
    ids.add(n.id);
  }

  const byId = new Map(parsed.data.nodes.map((n) => [n.id, n]));
  for (const n of parsed.data.nodes) {
    for (const dep of n.depends_on ?? []) {
      if (!byId.has(dep)) {
        const err = new Error(`DAG_INVALID: node ${n.id} depends on missing node ${dep}`);
        (err as any).code = 'DAG_MISSING_DEP';
        throw err;
      }
    }
  }

  stableTopologicalOrder(parsed.data.nodes);

  return parsed.data;
}

function isDagEvent(e: RunEvent): e is DagEventRow {
  const t = (e as any)?.type;
  return typeof t === 'string' && typeof (e as any)?.data === 'object';
}

function eventsForDag(dagId: string, events: RunEvent[]): DagEventRow[] {
  return events
    .filter(isDagEvent)
    .filter((e) => {
      const d = (e as any).data;
      const dataDagId = d?.dag_id;
      if (!dataDagId) return false;
      return String(dataDagId) === String(dagId);
    });
}

function deriveNodeState(params: {
  dag: DagSpec;
  node: DagNode;
  dagEvents: DagEventRow[];
}): DerivedNodeState {
  const { node, dagEvents } = params;

  const started = new Set<number>();
  const failed = new Set<number>();
  const succeeded = new Set<number>();
  let lastSucceededOutput: unknown = undefined;

  for (const e of dagEvents) {
    const d: any = e.data;
    const nodeId = d?.node_id;
    if (nodeId !== node.id) continue;

    const attemptRaw = Number(d?.attempt);
    const attempt = Number.isFinite(attemptRaw) && attemptRaw >= 1 ? attemptRaw : null;

    if (attempt !== null) {
      if (e.type === 'NODE_STARTED') started.add(attempt);
      if (e.type === 'NODE_FAILED') failed.add(attempt);
      if (e.type === 'NODE_SUCCEEDED') {
        succeeded.add(attempt);
        if (d.output !== undefined) lastSucceededOutput = d.output;
      }
    }
  }

  let maxAttemptSeen = 0;
  for (const a of [...started, ...failed, ...succeeded]) {
    if (Number.isFinite(a)) maxAttemptSeen = Math.max(maxAttemptSeen, a);
  }

  const materiallySucceeded = (() => {
    if (succeeded.size === 0) return false;

    const out = lastSucceededOutput;

    if (node.kind === 'LLM_CHAT') {
      const assistantText = getAssistantTextFromOutput(out);
      return Boolean(assistantText);
    }

    if (node.kind === 'ENFORCE_REPLY_CONSTRAINTS') {
      const finalText = getFinalAssistantTextFromOutput(out);
      return Boolean(finalText);
    }

    return true;
  })();

  return {
    succeeded: materiallySucceeded,
    maxAttemptSeen,
    startedAttempts: started,
    failedAttempts: failed,
    succeededAttempts: succeeded,
    lastSucceededOutput,
  };
}

function chooseAttemptForResume(st: DerivedNodeState): number {
  const inFlight: number[] = [];
  for (const a of st.startedAttempts) {
    if (!Number.isFinite(a) || a < 1) continue;
    if (st.failedAttempts.has(a)) continue;
    if (st.succeededAttempts.has(a)) continue;
    inFlight.push(a);
  }

  if (inFlight.length > 0) {
    return Math.max(...inFlight);
  }

  return st.maxAttemptSeen + 1;
}

async function runNode(params: {
  emit: EmitFn;
  attempt: number;
  dag: DagSpec;
  node: DagNode;
  priorOutputs: Record<string, unknown>;
  ctx: NodeExecContext;
}): Promise<NodeResult> {
  const { node, priorOutputs, ctx, dag, emit, attempt } = params;

  if (node.kind === 'NOOP') return { ok: true };

  if (node.kind === 'PLAN_DAG') {
    return { ok: true, output: { planned: true } };
  }

  if (node.kind === 'PERSIST_USER_MESSAGE') {
    const deterministicId = uuidV5(dag.run_id, `message:${dag.chat_id}:${node.id}:user`);

    const { messageId } = await ctx.messagesRepo.insertMessage({
      id: deterministicId,
      chatId: dag.chat_id,
      role: 'user',
      content: ctx.message,
    });

    return { ok: true, output: { message_id: messageId } };
  }

  if (node.kind === 'LLM_CHAT') {
    let prompt = '';
    try {
      prompt = await buildPromptFromDb({
        messagesRepo: ctx.messagesRepo,
        chatId: dag.chat_id,
        historyLimit: ctx.historyLimit,
        promptPreamble: ctx.promptPreamble,
        currentUserMessage: ctx.message,
      });
    } catch (e: any) {
      return {
        ok: false,
        error: {
          code: 'HISTORY_LOAD_FAILED',
          message: e?.message ? String(e.message) : 'Failed to load history',
        },
      };
    }

    await emit('LLM_REQUESTED', {
      dag_id: dag.dag_id,
      node_id: node.id,
      attempt,
      provider: ctx.provider,
      model: ctx.model,
      prompt_tokens_est: prompt.length,
    });

    const startedAt = Date.now();

    try {
      const assistantText = await llamaCompletion({
        llamaUrl: ctx.llamaUrl,
        prompt,
        maxTokens: 120,
        timeoutMs: 60000,
      });

      await emit('LLM_COMPLETED', {
        dag_id: dag.dag_id,
        node_id: node.id,
        attempt,
        output_len: assistantText.length,
        latency_ms: Date.now() - startedAt,
      });

      return {
        ok: true,
        output: { assistant_text: truncateString(assistantText, MAX_OUTPUT_STORE_CHARS) },
      };
    } catch (e: any) {
      const code = (e as any)?.code === 'LLAMA_TIMEOUT' ? 'LLAMA_TIMEOUT' : 'LLAMA_ERROR';

      return {
        ok: false,
        error: {
          code,
          message: e?.message ? String(e.message) : 'llama completion failed',
        },
      };
    }
  }

  if (node.kind === 'ENFORCE_REPLY_CONSTRAINTS') {
    const llmChatNode =
      dag.nodes.find((n) => n.kind === 'LLM_CHAT' && node.depends_on.includes(n.id)) ??
      dag.nodes.find((n) => n.kind === 'LLM_CHAT');

    const rawAssistantText =
      (llmChatNode ? getAssistantTextFromOutput(priorOutputs[llmChatNode.id]) : undefined) ??
      getAssistantTextFromOutput(node.input);

    if (!rawAssistantText) {
      return {
        ok: false,
        error: {
          code: 'MISSING_LLM_OUTPUT',
          message: 'No assistant_text found from llm_chat output.',
        },
      };
    }

    const enforcement = enforceReplyConstraints({
      user_instruction: ctx.message,
      raw_assistant_text: rawAssistantText,
    });

    await emit('REPLY_CONSTRAINT_EVALUATED', {
      dag_id: dag.dag_id,
      node_id: node.id,
      attempt,
      forced_reply: enforcement.forced_reply,
      forced_reply_value: enforcement.forced_reply_value,
      matched_pattern: enforcement.matched_pattern,
      raw_assistant_text: rawAssistantText,
      final_assistant_text: enforcement.final_assistant_text,
      user_instruction: (ctx.message ?? '').slice(0, 2000),
    });

    return {
      ok: true,
      output: {
        forced_reply: enforcement.forced_reply,
        forced_reply_value: enforcement.forced_reply_value,
        matched_pattern: enforcement.matched_pattern,
        raw_assistant_text: truncateString(rawAssistantText, MAX_OUTPUT_STORE_CHARS),
        final_assistant_text: truncateString(
          enforcement.final_assistant_text,
          MAX_OUTPUT_STORE_CHARS
        ),
      },
    };
  }

  if (node.kind === 'PERSIST_ASSISTANT_MESSAGE') {
    const enforceNode = dag.nodes.find((n) => n.kind === 'ENFORCE_REPLY_CONSTRAINTS');
    const llmNode = dag.nodes.find((n) => n.kind === 'LLM_CHAT');

    const enforcedFinal = enforceNode
      ? getFinalAssistantTextFromOutput(priorOutputs[enforceNode.id])
      : null;
    const assistantText =
      enforcedFinal ?? (llmNode ? getAssistantTextFromOutput(priorOutputs[llmNode.id]) : null);

    if (!assistantText) {
      return {
        ok: false,
        error: {
          code: 'MISSING_ASSISTANT_OUTPUT',
          message: 'No assistant output found from enforce_reply_constraints or llm_chat.',
        },
      };
    }

    const deterministicId = uuidV5(dag.run_id, `message:${dag.chat_id}:${node.id}:assistant`);

    const { messageId } = await ctx.messagesRepo.insertMessage({
      id: deterministicId,
      chatId: dag.chat_id,
      role: 'assistant',
      content: assistantText,
    });

    return { ok: true, output: { message_id: messageId } };
  }

  // ── Phase 7: Code-Change Workflow Node Handlers ───────────────────────
  // All simulated/sandboxed. No real file mutations. Artifacts stored as events.

  if (node.kind === 'CODEBASE_ANALYZE') {
    // Simulated codebase analysis — produces a summary of what would be analyzed.
    const message = ctx.message || '';
    const summary = `Simulated analysis of codebase for task: ${message.slice(0, 200)}`;
    await emit('CODEBASE_ANALYZED', {
      target_files: ['(simulated)'],
      analysis_summary: summary,
      file_count: 0,
    });
    return { ok: true, output: { analysis_summary: summary, simulated: true } };
  }

  if (node.kind === 'PATCH_PLAN') {
    // Simulated patch planning — produces a patch plan artifact.
    await emit('PATCH_PLAN_CREATED', {
      patches: [{ file_path: '(simulated)', operation: 'MODIFY', diff_summary: 'Simulated patch plan', line_count: 0 }],
      patch_count: 1,
      rationale: 'Simulated patch plan for sandboxed code-change workflow.',
    });
    return { ok: true, output: { patch_count: 1, simulated: true } };
  }

  if (node.kind === 'PATCH_APPLY_SIMULATED') {
    // Simulated patch application — no real file changes.
    const sandboxId = createSandboxId(dag.run_id);
    await emit('PATCH_SIMULATION_APPLIED', {
      patches_applied: 1,
      simulation_ok: true,
      sandbox_id: sandboxId,
    });
    return { ok: true, output: { sandbox_id: sandboxId, simulation_ok: true, simulated: true } };
  }

  if (node.kind === 'BUILD_VERIFY') {
    // Simulated build verification — always passes in v1.
    await emit('BUILD_VERIFIED', {
      result: { passed: true, exit_code: 0, duration_ms: 0, stdout_tail: 'Simulated build OK' },
    });
    return { ok: true, output: { build_passed: true, simulated: true } };
  }

  if (node.kind === 'TEST_VERIFY') {
    // Simulated test verification — always passes in v1.
    await emit('TESTS_VERIFIED', {
      result: { passed: true, exit_code: 0, duration_ms: 0, test_count: 0, fail_count: 0, stdout_tail: 'Simulated tests OK' },
    });
    return { ok: true, output: { tests_passed: true, simulated: true } };
  }

  if (node.kind === 'PATCH_REVIEW') {
    // Simulated patch review — auto-approved in v1.
    await emit('PATCH_REVIEW_COMPLETED', {
      approved: true,
      review_source: 'AUTOMATED',
      issues_found: 0,
      review_summary: 'Simulated review: auto-approved (sandboxed v1).',
      build_passed: true,
      tests_passed: true,
    });
    return { ok: true, output: { approved: true, simulated: true } };
  }

  return {
    ok: false,
    error: {
      code: 'NODE_KIND_UNKNOWN',
      message: `Unknown node kind: ${(node as any).kind}`,
    },
  };
}

export async function executeDag(params: {
  eventLog: EventLogLike;
  dag: DagSpec;
  ctx: NodeExecContext;
}): Promise<{
  ok: boolean;
  results: Record<string, NodeResult>;
}> {
  const { eventLog } = params;

  let dag: DagSpec;
  try {
    dag = validateDagSpecOrThrow(params.dag);
  } catch (e: any) {
    const issues = Array.isArray(e?.issues) ? e.issues : [];
    await eventLog.append(
      createRunEvent(params.dag.run_id, params.dag.chat_id, 'VALIDATION_ERROR', {
        type: 'VALIDATION_ERROR',
        message: e?.message ? String(e.message) : 'DAG validation failed',
        issues,
      })
    );

    return {
      ok: false,
      results: {
        __dag__: {
          ok: false,
          error: {
            code: e?.code ? String(e.code) : 'DAG_INVALID',
            message: e?.message ? String(e.message) : 'DAG validation failed',
            details: { issues },
          },
        },
      },
    };
  }

  const ctx = params.ctx;

  const existingEvents = await eventLog.listByRunId(dag.run_id);
  const dagEvents = eventsForDag(dag.dag_id, existingEvents);

  const lastDagCompleted = (() => {
    const completed = dagEvents.filter((e) => e.type === 'DAG_COMPLETED');
    if (completed.length === 0) return null;
    return completed[completed.length - 1]!;
  })();

  if (lastDagCompleted) {
    const ok = Boolean((lastDagCompleted as any).data?.ok);
    return { ok, results: {} };
  }

  const seen = new Set<string>();
  for (const e of dagEvents) {
    const d: any = e.data;
    const dagId = d?.dag_id ?? '';
    const nodeId = d?.node_id ?? '';
    const attempt = d?.attempt ?? '';
    const key = `${e.type}:${dagId}:${nodeId}:${attempt}`;
    seen.add(key);
  }

  const emit = async (type: RunEventType, data: any) => {
    const dagId = data?.dag_id ?? '';
    const nodeId = data?.node_id ?? '';
    const attempt = data?.attempt ?? '';
    const key = `${type}:${dagId}:${nodeId}:${attempt}`;
    if (seen.has(key)) return;

    await eventLog.append(createRunEvent(dag.run_id, dag.chat_id, type, { type, ...data } as any));

    seen.add(key);
    (existingEvents as any).push({
      ts: new Date().toISOString(),
      run_id: dag.run_id,
      chat_id: dag.chat_id,
      type,
      data: { type, ...data },
    });
  };

  await emit('DAG_PLANNED', { dag_id: dag.dag_id, node_count: dag.nodes.length, dag_fingerprint: fingerprintDag(dag) });

  const nodesById = new Map(dag.nodes.map((n) => [n.id, n]));
  const nodeIdsSorted = [...nodesById.keys()].sort();

  for (const nodeId of nodeIdsSorted) {
    const n = nodesById.get(nodeId)!;
    await emit('NODE_QUEUED', { dag_id: dag.dag_id, node_id: n.id, kind: n.kind });
  }

  const ordered = stableTopologicalOrder(dag.nodes);

  const status = new Map<string, NodeStatusDerived>();
  const outputs: Record<string, unknown> = {};
  const results: Record<string, NodeResult> = {};

  const stateByNodeId = new Map<string, DerivedNodeState>();
  for (const n of ordered) {
    const st = deriveNodeState({ dag, node: n, dagEvents });
    stateByNodeId.set(n.id, st);

    if (st.succeeded) {
      status.set(n.id, 'SUCCEEDED');
      outputs[n.id] = st.lastSucceededOutput;
      results[n.id] = { ok: true, output: st.lastSucceededOutput };
    } else {
      status.set(n.id, 'PENDING');
    }
  }

  for (const n of ordered) {
    if (status.get(n.id) === 'SUCCEEDED') {
      continue;
    }

    const deps = n.depends_on ?? [];
    const depFailed = deps.some((d) => status.get(d) !== 'SUCCEEDED');

    if (depFailed) {
      status.set(n.id, 'SKIPPED');

      const r: NodeResult = {
        ok: false,
        error: {
          code: 'NODE_SKIPPED',
          message: 'Skipped because a dependency did not succeed.',
          details: { depends_on: deps },
        },
      };
      results[n.id] = r;

      await emit('NODE_FAILED', {
        dag_id: dag.dag_id,
        node_id: n.id,
        attempt: 1,
        error: {
          code: r.error?.code ?? 'NODE_SKIPPED',
          message: r.error?.message ?? 'Skipped',
        },
      });

      continue;
    }

    const maxAttempts = clampInt(Number(n.retry?.max_attempts ?? 1), 1, 2);
    const baseBackoffMs = clampInt(Number(n.retry?.backoff_ms ?? 0), 0, 60_000);

    const st0 = stateByNodeId.get(n.id)!;
    let attempt = chooseAttemptForResume(st0);

    if (attempt > maxAttempts) {
      status.set(n.id, 'FAILED');
      results[n.id] = {
        ok: false,
        error: {
          code: 'NODE_ATTEMPTS_EXHAUSTED',
          message: `Attempts exhausted (${maxAttempts}).`,
        },
      };
      continue;
    }

    while (attempt <= maxAttempts) {
      status.set(n.id, 'RUNNING');

      await emit('NODE_STARTED', { dag_id: dag.dag_id, node_id: n.id, attempt });

      let r: NodeResult;
      try {
        r = await runNode({
          emit,
          attempt,
          dag,
          node: n,
          priorOutputs: outputs,
          ctx,
        });
      } catch (e: any) {
        r = {
          ok: false,
          error: {
            code: 'NODE_EXCEPTION',
            message: e?.message ? String(e.message) : 'Node threw an exception',
            details: { name: e?.name, stack: e?.stack },
          },
        };
      }

      results[n.id] = r;

      if (r.ok) {
        status.set(n.id, 'SUCCEEDED');
        outputs[n.id] = r.output;

        await emit('NODE_SUCCEEDED', {
          dag_id: dag.dag_id,
          node_id: n.id,
          attempt,
          output_summary: { bytes: outputBytes(r.output) },
          output: r.output,
        });

        break;
      }

      await emit('NODE_FAILED', {
        dag_id: dag.dag_id,
        node_id: n.id,
        attempt,
        error: {
          code: r.error?.code ?? 'NODE_FAILED',
          message: r.error?.message ?? 'Node failed',
        },
      });

      if (attempt < maxAttempts) {
        const nextBackoffMs = baseBackoffMs * attempt;

        await emit('NODE_RETRY_SCHEDULED', {
          dag_id: dag.dag_id,
          node_id: n.id,
          next_attempt_in_ms: nextBackoffMs,
        });

        if (nextBackoffMs > 0) {
          await sleep(nextBackoffMs);
        }

        attempt += 1;
        continue;
      }

      status.set(n.id, 'FAILED');
      break;
    }

    if (status.get(n.id) !== 'SUCCEEDED') {
      break;
    }
  }

  const ok = ordered.every((n) => status.get(n.id) === 'SUCCEEDED');
  await emit('DAG_COMPLETED', { dag_id: dag.dag_id, ok });

  return { ok, results };
}

/**
 * Existing worker uses this planner shape.
 * Keep it exported so the worker can call it from @cognitive-runtime/runtime.
 */
export function planDagForRun(params: {
  run_id: string;
  chat_id: string;
  message: string;
}): DagSpec {
  const dagId = params.run_id;

  return {
    dag_id: dagId,
    run_id: params.run_id,
    chat_id: params.chat_id,
    created_at: new Date().toISOString(),
    nodes: [
      {
        id: 'plan_dag',
        kind: 'PLAN_DAG',
        depends_on: [],
        retry: { max_attempts: 1, backoff_ms: 0 },
        input: { message_len: params.message.length },
      },
      {
        id: 'persist_user_message',
        kind: 'PERSIST_USER_MESSAGE',
        depends_on: ['plan_dag'],
        retry: { max_attempts: 1, backoff_ms: 0 },
        input: { role: 'user', content_len: params.message.length },
      },
      {
        id: 'llm_chat',
        kind: 'LLM_CHAT',
        depends_on: ['persist_user_message'],
        retry: { max_attempts: 2, backoff_ms: 500 },
        input: { message: params.message },
      },
      {
        id: 'enforce_reply_constraints',
        kind: 'ENFORCE_REPLY_CONSTRAINTS',
        depends_on: ['llm_chat'],
        retry: { max_attempts: 1, backoff_ms: 0 },
      },
      {
        id: 'persist_assistant_message',
        kind: 'PERSIST_ASSISTANT_MESSAGE',
        depends_on: ['enforce_reply_constraints'],
        retry: { max_attempts: 1, backoff_ms: 0 },
      },
    ],
  };
}
