// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// apps/api/src/routes/phase7.ts
// Phase 7: Production hardening + observability API routes.
// All endpoints are Zod-validated, read-only (except cancel), event-derived.

import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { validate } from '../lib/validation.js';
import { createRunEvent } from '@cognitive-runtime/contracts';
import type { EventLog } from '../lib/event-log.js';
import type { ErrorResponse } from '@cognitive-runtime/contracts';

// ── Route context ───────────────────────────────────────────────────────────
interface RouteContext {
  eventLog: EventLog;
}

// ── Param schemas ───────────────────────────────────────────────────────────
const zRunIdParams = z.object({ runId: z.string().uuid() });

// ── Route plugin ────────────────────────────────────────────────────────────
export const phase7Routes: FastifyPluginAsync<RouteContext> = async (fastify, { eventLog }) => {

  // ── POST /runs/:runId/cancel ──────────────────────────────────────────
  // Request cancellation of a running run.
  // Idempotent: if already cancelled/completed, returns current state.
  fastify.post<{ Params: unknown; Body: unknown }>('/runs/:runId/cancel', async (request, reply) => {
    const params = validate(zRunIdParams, request.params);
    const body = z.object({
      reason: z.string().min(1).max(1000).default('Cancelled via API'),
    }).parse(request.body ?? {});

    const events = await eventLog.listByRunId(params.runId);

    // 404 if run doesn't exist.
    if (events.length === 0) {
      const err: ErrorResponse = { error: 'NOT_FOUND', message: 'Run not found.' };
      return reply.status(404).send(err);
    }

    // Check if already terminal.
    const hasTerminal = events.some(e => e.type === 'RUN_COMPLETED' || e.type === 'RUN_CANCELLED');
    if (hasTerminal) {
      return reply.send({
        run_id: params.runId,
        already_terminal: true,
        message: 'Run already has a terminal event.',
      });
    }

    // Check if cancel already requested.
    const alreadyRequested = events.some(e => e.type === 'RUN_CANCEL_REQUESTED');
    if (alreadyRequested) {
      return reply.send({
        run_id: params.runId,
        already_requested: true,
        message: 'Cancellation already requested.',
      });
    }

    // Emit RUN_CANCEL_REQUESTED event.
    const chatId = events[0]!.chat_id;
    await eventLog.append(
      createRunEvent(params.runId, chatId, 'RUN_CANCEL_REQUESTED', {
        type: 'RUN_CANCEL_REQUESTED',
        reason: body.reason,
        source: 'API',
      } as any)
    );

    return reply.status(202).send({
      run_id: params.runId,
      cancel_requested: true,
      reason: body.reason,
    });
  });

  // ── GET /runs/:runId/lifecycle ────────────────────────────────────────
  // Derived lifecycle summary from events.
  fastify.get<{ Params: unknown }>('/runs/:runId/lifecycle', async (request, reply) => {
    const params = validate(zRunIdParams, request.params);
    const events = await eventLog.listByRunId(params.runId);

    if (events.length === 0) {
      const err: ErrorResponse = { error: 'NOT_FOUND', message: 'Run not found.' };
      return reply.status(404).send(err);
    }

    // Derive lifecycle data from events.
    let createdAt: string | null = null;
    let enqueuedAt: string | null = null;
    let workerStartedAt: string | null = null;
    let completedAt: string | null = null;
    let cancelRequestedAt: string | null = null;
    let cancelledAt: string | null = null;
    let timeoutAt: string | null = null;
    let staleAt: string | null = null;
    let failClassification: string | null = null;
    let finalOk: boolean | null = null;
    let heartbeatCount = 0;
    let currentStatus = 'CREATED';
    const statusTransitions: Array<{ from: string; to: string; ts: string }> = [];

    for (const e of events) {
      switch (e.type) {
        case 'RUN_CREATED':
          createdAt = e.ts;
          break;
        case 'RUN_ENQUEUED':
          enqueuedAt = e.ts;
          break;
        case 'WORKER_STARTED':
          workerStartedAt = e.ts;
          break;
        case 'WORKER_HEARTBEAT':
          heartbeatCount++;
          break;
        case 'RUN_STATUS_CHANGED': {
          const d = (e as any).data;
          if (d?.to) currentStatus = d.to;
          statusTransitions.push({ from: d?.from ?? '', to: d?.to ?? '', ts: e.ts });
          break;
        }
        case 'RUN_COMPLETED':
          completedAt = e.ts;
          finalOk = (e as any).data?.ok ?? null;
          break;
        case 'RUN_CANCEL_REQUESTED':
          cancelRequestedAt = e.ts;
          break;
        case 'RUN_CANCELLED':
          cancelledAt = e.ts;
          break;
        case 'RUN_TIMEOUT_REACHED':
          timeoutAt = e.ts;
          break;
        case 'RUN_STALE_DETECTED':
          staleAt = e.ts;
          break;
        case 'RUN_CLASSIFIED_FAILED':
          failClassification = (e as any).data?.classification ?? null;
          break;
      }
    }

    return reply.send({
      run_id: params.runId,
      chat_id: events[0]!.chat_id,
      event_count: events.length,
      status: currentStatus,
      ok: finalOk,
      created_at: createdAt,
      enqueued_at: enqueuedAt,
      worker_started_at: workerStartedAt,
      completed_at: completedAt,
      cancel_requested_at: cancelRequestedAt,
      cancelled_at: cancelledAt,
      timeout_at: timeoutAt,
      stale_at: staleAt,
      fail_classification: failClassification,
      heartbeat_count: heartbeatCount,
      status_transitions: statusTransitions,
    });
  });

  // ── GET /runs/:runId/planner-loops ────────────────────────────────────
  // Planner loop history: replan requests, decisions, exhaustion.
  fastify.get<{ Params: unknown }>('/runs/:runId/planner-loops', async (request, reply) => {
    const params = validate(zRunIdParams, request.params);
    const events = await eventLog.listByRunId(params.runId);

    if (events.length === 0) {
      const err: ErrorResponse = { error: 'NOT_FOUND', message: 'Run not found.' };
      return reply.status(404).send(err);
    }

    const replanRequests: any[] = [];
    const replanDecisions: any[] = [];
    let exhausted: any = null;
    const plannerDecisions: any[] = [];

    for (const e of events) {
      const d = (e as any).data;
      switch (e.type) {
        case 'META_PLANNER_REPLAN_REQUESTED':
          replanRequests.push({ ts: e.ts, ...d });
          break;
        case 'META_PLANNER_REPLAN_DECIDED':
          replanDecisions.push({ ts: e.ts, ...d });
          break;
        case 'META_PLANNER_REPLAN_EXHAUSTED':
          exhausted = { ts: e.ts, ...d };
          break;
        case 'META_PLANNER_DECISION_MADE':
          plannerDecisions.push({ ts: e.ts, ...d });
          break;
      }
    }

    return reply.send({
      run_id: params.runId,
      total_planner_decisions: plannerDecisions.length,
      replan_requests: replanRequests,
      replan_decisions: replanDecisions,
      replan_exhausted: exhausted,
      planner_decisions: plannerDecisions,
    });
  });

  // ── GET /runs/:runId/policy ───────────────────────────────────────────
  // Policy decisions for a run.
  fastify.get<{ Params: unknown }>('/runs/:runId/policy', async (request, reply) => {
    const params = validate(zRunIdParams, request.params);
    const events = await eventLog.listByRunId(params.runId);

    if (events.length === 0) {
      const err: ErrorResponse = { error: 'NOT_FOUND', message: 'Run not found.' };
      return reply.status(404).send(err);
    }

    const policyEvents = events
      .filter(e => e.type === 'POLICY_EVALUATED')
      .map(e => ({ ts: e.ts, ...(e as any).data }));

    return reply.send({
      run_id: params.runId,
      policy_evaluations: policyEvents,
      total: policyEvents.length,
    });
  });

  // ── GET /runs/:runId/code-artifacts ───────────────────────────────────
  // Code-change workflow artifacts for a run.
  fastify.get<{ Params: unknown }>('/runs/:runId/code-artifacts', async (request, reply) => {
    const params = validate(zRunIdParams, request.params);
    const events = await eventLog.listByRunId(params.runId);

    if (events.length === 0) {
      const err: ErrorResponse = { error: 'NOT_FOUND', message: 'Run not found.' };
      return reply.status(404).send(err);
    }

    const codeChangeTypes = new Set([
      'CODEBASE_ANALYZED', 'PATCH_PLAN_CREATED', 'PATCH_SIMULATION_APPLIED',
      'BUILD_VERIFIED', 'TESTS_VERIFIED', 'PATCH_REVIEW_COMPLETED',
    ]);

    const artifacts = events
      .filter(e => codeChangeTypes.has(e.type))
      .map(e => ({ type: e.type, ts: e.ts, ...(e as any).data }));

    return reply.send({
      run_id: params.runId,
      code_artifacts: artifacts,
      total: artifacts.length,
    });
  });

  // ── GET /runs/stale ───────────────────────────────────────────────────
  // List runs that have RUN_STALE_DETECTED events.
  fastify.get('/runs/stale', async (_request, reply) => {
    const staleEvents = await eventLog.listByEventType('RUN_STALE_DETECTED', 100);

    const runs = staleEvents.map(e => ({
      run_id: e.run_id,
      chat_id: e.chat_id,
      ts: e.ts,
      last_heartbeat_ts: (e as any).data?.last_heartbeat_ts ?? null,
      stale_threshold_ms: (e as any).data?.stale_threshold_ms ?? null,
      elapsed_since_hb_ms: (e as any).data?.elapsed_since_hb_ms ?? null,
    }));

    return reply.send({ stale_runs: runs, total: runs.length });
  });

  // ── GET /runs/failed ──────────────────────────────────────────────────
  // List runs that have RUN_CLASSIFIED_FAILED events.
  fastify.get('/runs/failed', async (_request, reply) => {
    const failedEvents = await eventLog.listByEventType('RUN_CLASSIFIED_FAILED', 100);

    const runs = failedEvents.map(e => ({
      run_id: e.run_id,
      chat_id: e.chat_id,
      ts: e.ts,
      classification: (e as any).data?.classification ?? null,
      reason: (e as any).data?.reason ?? null,
      retriable: (e as any).data?.retriable ?? null,
    }));

    return reply.send({ failed_runs: runs, total: runs.length });
  });

  // ── GET /phase7/config ────────────────────────────────────────────────
  // Return effective Phase 7 configuration for debugging.
  fastify.get('/phase7/config', async (_request, reply) => {
    return reply.send({
      enable_code_change_workflow: process.env.ENABLE_CODE_CHANGE_WORKFLOW === 'true',
      enable_replanning: process.env.ENABLE_REPLANNING === 'true',
      enable_policy_gate: process.env.ENABLE_POLICY_GATE === 'true',
      enable_run_cancellation: process.env.ENABLE_RUN_CANCELLATION !== 'false',
      max_planner_loops: parseInt(process.env.MAX_PLANNER_LOOPS || '3', 10),
      run_timeout_ms: parseInt(process.env.RUN_TIMEOUT_MS || '300000', 10),
      stale_heartbeat_ms: parseInt(process.env.STALE_HEARTBEAT_MS || '60000', 10),
    });
  });
};
