// Cognitive Runtime © 2026 by Donald Dominko
// Licensed under CC BY-NC-SA 4.0
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

import {
  zDagRunState,
  type DAGRunState,
  type NodeStatus,
  type RunEvent,
  type NodeKind,
} from '@cognitive-runtime/contracts';

type AttemptDraft = {
  attempt: number;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  started_at?: string;
  finished_at?: string;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  output_summary?: {
    bytes?: number;
  };
};

type NodeDraft = {
  node_id: string;
  kind?: NodeKind;
  status: NodeStatus;
  last_attempt: number;
  attempts: Map<number, AttemptDraft>;
};

function getIsoTs(e: RunEvent): string {
  return e.ts;
}

function ensureNode(nodes: Map<string, NodeDraft>, node_id: string): NodeDraft {
  const existing = nodes.get(node_id);
  if (existing) return existing;

  const created: NodeDraft = {
    node_id,
    status: 'PENDING',
    last_attempt: 0,
    attempts: new Map(),
  };
  nodes.set(node_id, created);
  return created;
}

function ensureAttempt(node: NodeDraft, attempt: number): AttemptDraft {
  const existing = node.attempts.get(attempt);
  if (existing) return existing;

  const created: AttemptDraft = {
    attempt,
    status: 'RUNNING',
  };
  node.attempts.set(attempt, created);
  return created;
}

function compareNodeId(a: string, b: string): number {
  return a.localeCompare(b);
}

/**
 * Derive DAGRunState from append-only events.
 *
 * Compat aliasing:
 * - DAG_PLANNED => planned marker
 * - First NODE_STARTED => started marker
 */
export function deriveDagRunState(events: RunEvent[]): DAGRunState {
  if (events.length === 0) {
    throw new Error('DAG_STATE_INVALID: no events');
  }

  const run_id = events[0]!.run_id;
  const chat_id = events[0]!.chat_id;

  let dag_id: string | undefined;
  let created_at: string | undefined;
  let planned_at: string | undefined;
  let started_at: string | undefined;
  let completed_at: string | undefined;

  let node_count: number | undefined;
  let ok: boolean | undefined;

  let status: 'CREATED' | 'PLANNED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' =
    'CREATED';

  const nodes = new Map<string, NodeDraft>();
  const knownNodeIds = new Set<string>();

  for (const e of events) {
    const ts = getIsoTs(e);

    if (!created_at) created_at = ts;
    if (e.type === 'RUN_CREATED') created_at = ts;

    if (e.type === 'DAG_PLANNED') {
      const d: any = (e as any).data;
      if (typeof d?.dag_id === 'string') dag_id = d.dag_id;
      planned_at = ts;
      if (typeof d?.node_count === 'number') node_count = d.node_count;
      if (status === 'CREATED') status = 'PLANNED';
      continue;
    }

    if (e.type === 'NODE_QUEUED') {
      const d: any = (e as any).data;
      const node_id = String(d?.node_id ?? '');
      if (!node_id) continue;

      const node = ensureNode(nodes, node_id);
      knownNodeIds.add(node_id);

      const kind = d?.kind;
      if (kind) node.kind = kind;

      continue;
    }

    if (e.type === 'NODE_STARTED') {
      const d: any = (e as any).data;
      const node_id = String(d?.node_id ?? '');
      const attempt = Number(d?.attempt ?? 0);
      if (!node_id || !Number.isFinite(attempt) || attempt < 1) continue;

      const node = ensureNode(nodes, node_id);
      knownNodeIds.add(node_id);

      node.status = 'RUNNING';
      node.last_attempt = Math.max(node.last_attempt, attempt);

      const a = ensureAttempt(node, attempt);
      a.status = 'RUNNING';
      a.started_at = a.started_at ?? ts;

      if (!started_at) started_at = ts;
      if (status === 'CREATED' || status === 'PLANNED') status = 'RUNNING';
      continue;
    }

    if (e.type === 'NODE_SUCCEEDED') {
      const d: any = (e as any).data;
      const node_id = String(d?.node_id ?? '');
      const attempt = Number(d?.attempt ?? 0);
      if (!node_id || !Number.isFinite(attempt) || attempt < 1) continue;

      const node = ensureNode(nodes, node_id);
      knownNodeIds.add(node_id);

      node.status = 'SUCCEEDED';
      node.last_attempt = Math.max(node.last_attempt, attempt);

      const a = ensureAttempt(node, attempt);
      a.status = 'SUCCEEDED';
      a.started_at = a.started_at ?? ts;
      a.finished_at = ts;

      const bytes = d?.output_summary?.bytes;
      if (typeof bytes === 'number') a.output_summary = { bytes };

      continue;
    }

    if (e.type === 'NODE_FAILED') {
      const d: any = (e as any).data;
      const node_id = String(d?.node_id ?? '');
      const attempt = Number(d?.attempt ?? 0);
      if (!node_id || !Number.isFinite(attempt) || attempt < 1) continue;

      const node = ensureNode(nodes, node_id);
      knownNodeIds.add(node_id);

      node.status = 'FAILED';
      node.last_attempt = Math.max(node.last_attempt, attempt);

      const a = ensureAttempt(node, attempt);
      a.status = 'FAILED';
      a.started_at = a.started_at ?? ts;
      a.finished_at = ts;

      const err = d?.error;
      if (err && typeof err.code === 'string' && typeof err.message === 'string') {
        a.error = { code: err.code, message: err.message, details: err.details };
      }

      continue;
    }

    if (e.type === 'DAG_COMPLETED') {
      const d: any = (e as any).data;
      if (typeof d?.dag_id === 'string') dag_id = d.dag_id;

      ok = Boolean(d?.ok);
      completed_at = ts;
      status = ok ? 'SUCCEEDED' : 'FAILED';
      continue;
    }

    if (!dag_id) {
      const d: any = (e as any).data;
      if (typeof d?.dag_id === 'string') dag_id = d.dag_id;
    }
  }

  if (status === 'CREATED' || status === 'PLANNED') {
    const anyRunning = Array.from(nodes.values()).some((n) => n.status === 'RUNNING');
    if (anyRunning) status = 'RUNNING';
  }

  if (status === 'SUCCEEDED' && ok === true) {
    for (const n of nodes.values()) {
      if (n.status === 'PENDING') n.status = 'SKIPPED';
    }
  }

  const node_order = Array.from(knownNodeIds).sort(compareNodeId);

  const nodeStates = node_order.map((node_id) => {
    const n = nodes.get(node_id) ?? ensureNode(nodes, node_id);

    const attempts = Array.from(n.attempts.values())
      .sort((a, b) => a.attempt - b.attempt)
      .map((a) => ({
        attempt: a.attempt,
        status: a.status,
        started_at: a.started_at,
        finished_at: a.finished_at,
        error: a.error,
        output_summary: a.output_summary,
      }));

    return {
      node_id: n.node_id,
      kind: n.kind,
      status: n.status,
      last_attempt: n.last_attempt,
      attempts,
    };
  });

  const state: DAGRunState = {
    run_id,
    chat_id,
    dag_id,
    status,
    created_at,
    planned_at,
    started_at,
    completed_at,
    ok,
    node_count: node_count ?? node_order.length,
    node_order,
    nodes: nodeStates,
  };

  return zDagRunState.parse(state);
}
