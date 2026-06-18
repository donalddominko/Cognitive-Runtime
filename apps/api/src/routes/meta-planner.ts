// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// apps/api/src/routes/meta-planner.ts
// Phase 6: Meta-Planner developer-facing API routes.
// Minimal, Zod-validated, dev-focused endpoints.

import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { validate } from '../lib/validation.js';
import type { EventLog } from '../lib/event-log.js';
import type { ErrorResponse } from '@cognitive-runtime/contracts';

// ── Route context ───────────────────────────────────────────────────────────
interface RouteContext {
  eventLog: EventLog;
}

// ── Param schemas ───────────────────────────────────────────────────────────
const zRunIdParams = z.object({ runId: z.string().uuid() });

// ── Route plugin ────────────────────────────────────────────────────────────
export const metaPlannerRoutes: FastifyPluginAsync<RouteContext> = async (fastify, { eventLog }) => {

  // GET /runs/:runId/meta-plan — return derived planner decision/evaluation for a run.
  fastify.get<{ Params: unknown }>('/runs/:runId/meta-plan', async (request, reply) => {
    const params = validate(zRunIdParams, request.params);
    const events = await eventLog.listByRunId(params.runId);

    if (events.length === 0) {
      const err: ErrorResponse = { error: 'NOT_FOUND', message: 'Run not found (no events for run_id).' };
      return reply.status(404).send(err);
    }

    // Extract META_PLANNER_* events from the run.
    const plannerEvents = events.filter(e => (e.type as string).startsWith('META_PLANNER_'));

    if (plannerEvents.length === 0) {
      const err: ErrorResponse = { error: 'NOT_FOUND', message: 'No meta-planner events found for this run.' };
      return reply.status(404).send(err);
    }

    // Build structured response from planner events.
    let started: any = null;
    let contextRetrieved: any = null;
    const candidatesBuilt: any[] = [];
    let decisionMade: any = null;
    let skipped: any = null;
    let fallbackUsed: any = null;
    let evaluated: any = null;
    let failed: any = null;

    for (const e of plannerEvents) {
      const d = (e as any).data;
      switch (e.type) {
        case 'META_PLANNER_STARTED':           started = d; break;
        case 'META_PLANNER_CONTEXT_RETRIEVED': contextRetrieved = d; break;
        case 'META_PLANNER_CANDIDATE_BUILT':   candidatesBuilt.push(d); break;
        case 'META_PLANNER_DECISION_MADE':     decisionMade = d; break;
        case 'META_PLANNER_SKIPPED':           skipped = d; break;
        case 'META_PLANNER_FALLBACK_USED':     fallbackUsed = d; break;
        case 'META_PLANNER_EVALUATED':         evaluated = d; break;
        case 'META_PLANNER_FAILED':            failed = d; break;
      }
    }

    return reply.send({
      run_id: params.runId,
      planner_event_count: plannerEvents.length,
      started,
      context_retrieved: contextRetrieved,
      candidates_built: candidatesBuilt,
      decision_made: decisionMade,
      skipped,
      fallback_used: fallbackUsed,
      evaluated,
      failed,
    });
  });

  // GET /meta-planner/config — return sanitized effective config for debugging.
  fastify.get('/meta-planner/config', async (_request, reply) => {
    const enabled = process.env.META_PLANNER_ENABLED !== 'false';
    return reply.send({
      enabled,
      allow_synthesis: process.env.META_PLANNER_ALLOW_SYNTHESIS === 'true',
      min_pattern_reward: parseFloat(process.env.META_PLANNER_MIN_PATTERN_REWARD || '0.6'),
      weights: {
        quality: parseFloat(process.env.META_PLANNER_WEIGHTS_QUALITY || '0.4'),
        latency: parseFloat(process.env.META_PLANNER_WEIGHTS_LATENCY || '0.25'),
        cost:    parseFloat(process.env.META_PLANNER_WEIGHTS_COST || '0.15'),
        risk:    parseFloat(process.env.META_PLANNER_WEIGHTS_RISK || '0.2'),
      },
      planner_version: '1.0.0',
    });
  });
};
