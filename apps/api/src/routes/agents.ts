// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// apps/api/src/routes/agents.ts
// Fastify route plugin for agent-related endpoints.
// Phase 4: GET /agents/:agentId/trust — reads the most recent TRUST_UPDATED event for an agent.

import type { FastifyPluginAsync } from 'fastify'; // Fastify plugin typing
import type { EventLog } from '../lib/event-log.js'; // API-layer EventLog (has listByEventType)

// RouteContext: injected dependencies for this plugin (matches the pattern used in runs.ts).
interface RouteContext {
  eventLog: EventLog; // shared EventLog instance injected at plugin registration
}

// AgentTrustResponse: shape returned by GET /agents/:agentId/trust.
interface AgentTrustResponse {
  agent_id:     string; // agent identifier (echoed from the event)
  trust:        number; // most recent trust_after value in [0.1, 0.95]
  trust_before: number; // trust_before value from the same event (for inspection)
  ema_alpha:    number; // EMA alpha used (0.15 in v0)
  updated_at:   string; // ISO timestamp of the most recent TRUST_UPDATED event
  run_id:       string; // run_id that triggered this trust update
}

// agentRoutes: Fastify plugin that registers all /agents/* routes.
export const agentRoutes: FastifyPluginAsync<RouteContext> = async (fastify, { eventLog }) => {

  // GET /agents/:agentId/trust
  // Returns the most recent trust record for the specified agent.
  // Derives trust from stored TRUST_UPDATED events (append-only, no mutable trust table).
  // Returns 404 if no trust data exists yet for the agent (first run hasn't completed).
  fastify.get<{ Params: { agentId: string } }>(
    '/agents/:agentId/trust',
    async (request, reply) => {
      const { agentId } = request.params; // extract agent identifier from URL

      // Fetch all TRUST_UPDATED events across all runs (newest first, capped at 1000).
      // listByEventType uses JSONB @> filter — only fetches events of this type.
      const allTrustEvents = await eventLog.listByEventType('TRUST_UPDATED', 1000);

      // Filter in memory for the specific agent (agentId is in data, not a DB column).
      const agentTrustEvents = allTrustEvents.filter(
        (e: any) => e.data?.agent_id === agentId // keep only events for this agent
      );

      // 404 if no trust history exists for this agent.
      if (agentTrustEvents.length === 0) {
        return reply.status(404).send({
          error:   'NOT_FOUND',
          message: `No trust data found for agent: ${agentId}`, // descriptive 404 message
        });
      }

      // Events are ordered newest-first from listByEventType — [0] is the most recent.
      const latest = agentTrustEvents[0]!;          // most recent TRUST_UPDATED event
      const data: any = (latest as any).data;        // extract the event data payload

      // Build and return the trust response.
      const response: AgentTrustResponse = {
        agent_id:     agentId,                        // echo the requested agent ID
        trust:        Number(data?.trust_after ?? 0), // most recent trust value
        trust_before: Number(data?.trust_before ?? 0), // prior trust for audit
        ema_alpha:    Number(data?.ema_alpha ?? 0.15), // EMA factor used
        updated_at:   latest.ts,                      // ISO timestamp of last update
        run_id:       latest.run_id,                  // which run produced this update
      };

      return reply.send(response); // 200 OK with trust data
    }
  );
};
