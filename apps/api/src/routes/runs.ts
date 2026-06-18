// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// apps/api/src/routes/runs.ts
// Fastify route plugin for all /runs/* endpoints.
// Phase 4: adds GET /runs/:runId/reward — reads the REWARD_COMPUTED event for a run.

import { FastifyPluginAsync } from 'fastify'; // Fastify plugin typing
import { randomUUID, createHash } from 'crypto'; // UUID generation and hashing
import { runsQueue } from '../queue/runs-queue.js'; // BullMQ queue client
import {
  zCreateRunRequest,            // schema: POST /runs body
  zListRunEventsParams,         // schema: GET /runs/:runId/events path params
  zListRunEventsQuery,          // schema: GET /runs/:runId/events query params
  zGetRunStatusParams,          // schema: GET /runs/:runId/status path params — REUSED for reward
  zGetDagStateParams,           // schema: GET /runs/:runId/dag-state path params
  createRunEvent,               // helper to build typed RunEvent
  type CreateRunResponse,       // DTO: POST /runs response
  type ListRunEventsResponse,   // DTO: GET /runs/:runId/events response
  type GetRunStatusResponse,    // DTO: GET /runs/:runId/status response
  type GetDagStateResponse,     // DTO: GET /runs/:runId/dag-state response
  type RunEvent,                // union of all event types
  type RunStatus,               // run lifecycle status enum type
  type ErrorResponse,           // standard error shape
} from '@cognitive-runtime/contracts';
import { deriveDagRunState } from '@cognitive-runtime/runtime'; // DAG state projector
import { validate } from '../lib/validation.js';                 // request validator
import type { EventLog } from '../lib/event-log.js';             // EventLog interface

// RouteContext: injected dependencies passed to this plugin at registration time.
interface RouteContext {
  eventLog: EventLog; // shared EventLog instance
}

// ── Helpers (unchanged from Phase 3) ─────────────────────────────────────────

function parseUuidToBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, '').toLowerCase(); // strip dashes, lowercase
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    throw new Error(`UUID_INVALID: ${uuid}`); // reject malformed UUIDs
  }
  return Buffer.from(hex, 'hex'); // 16-byte buffer
}

function bytesToUuidString(b: Buffer): string {
  const hex = b.toString('hex'); // 32-char hex string
  return [
    hex.slice(0,  8),  // time-low
    hex.slice(8,  12), // time-mid
    hex.slice(12, 16), // time-hi-and-version
    hex.slice(16, 20), // clock-seq
    hex.slice(20, 32), // node
  ].join('-'); // standard UUID hyphenated format
}

// uuidV5: deterministic UUID based on SHA-1 of namespace + name (RFC 4122 v5).
function uuidV5(namespaceUuid: string, name: string): string {
  const ns        = parseUuidToBytes(namespaceUuid); // namespace as bytes
  const nameBytes = Buffer.from(name, 'utf8');        // name as UTF-8 bytes

  const sha1 = createHash('sha1');
  sha1.update(ns);        // hash namespace first
  sha1.update(nameBytes); // then hash name
  const hash = sha1.digest(); // 20-byte digest

  const bytes = Buffer.from(hash.subarray(0, 16)); // take first 16 bytes
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;            // set version bits to 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;            // set variant bits to RFC 4122

  return bytesToUuidString(bytes); // format as UUID string
}

function isRunStatus(value: unknown): value is RunStatus {
  return (
    value === 'CREATED'   ||
    value === 'QUEUED'    ||
    value === 'RUNNING'   ||
    value === 'SUCCEEDED' ||
    value === 'FAILED'
  ); // exhaustive guard against unknown status strings
}

function deriveRunStatusFromEvents(events: RunEvent[]): RunStatus {
  let status: RunStatus = 'CREATED'; // default if no transitions seen

  for (const e of events) {
    if (e.type === 'RUN_STATUS_CHANGED') {
      const to = (e as any)?.data?.to;
      if (isRunStatus(to)) status = to; // track last known status transition
    }
  }

  // If status never moved but run was enqueued, treat as QUEUED.
  if (status === 'CREATED') {
    if (events.some((e) => e.type === 'RUN_ENQUEUED')) return 'QUEUED';
  }

  // If status never moved but run completed, derive final status from completion event.
  if (status === 'CREATED') {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]!;
      if (e.type === 'RUN_COMPLETED') {
        const ok = Boolean((e as any)?.data?.ok);
        return ok ? 'SUCCEEDED' : 'FAILED'; // completion wins over status if status stuck
      }
    }
  }

  return status; // return last tracked status
}

function getRunCreatedMessage(events: RunEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) { // scan backwards for most recent
    const e = events[i]!;
    if (e.type === 'RUN_CREATED') {
      const msg = (e as any)?.data?.message;
      if (typeof msg === 'string' && msg.trim().length > 0) return msg; // return if present
    }
  }
  return null; // message not stored in events
}

function getRunCreatedTraceId(events: RunEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) { // scan backwards
    const e = events[i]!;
    if (e.type === 'RUN_CREATED') {
      const tid = (e as any)?.data?.trace_id;
      if (typeof tid === 'string' && tid.length > 0) return tid; // return trace ID
    }
  }
  return null; // trace ID not found
}

function getUserMessageId(events: RunEvent[]): string | null {
  for (const e of events) {                          // scan forwards for first USER_MESSAGE_RECORDED
    if (e.type === 'USER_MESSAGE_RECORDED') {
      const role      = (e as any)?.data?.role;
      const messageId = (e as any)?.data?.message_id;
      if (role === 'user' && typeof messageId === 'string' && messageId.length > 0) {
        return messageId; // return the deterministic message UUID
      }
    }
  }
  return null; // message ID not found
}

// ── Route plugin ──────────────────────────────────────────────────────────────

export const runRoutes: FastifyPluginAsync<RouteContext> = async (fastify, { eventLog }) => {

  // POST /runs — create a new run and optionally enqueue it for execution.
  fastify.post<{ Body: unknown }>('/runs', async (request, reply) => {
    const body = validate(zCreateRunRequest, request.body); // validate request body

    const runId   = randomUUID(); // new run identifier
    const traceId = randomUUID(); // distributed trace ID for this request

    // Append RUN_CREATED event — stores message + trace for later replay.
    const runCreatedEvent = createRunEvent(runId, body.chat_id, 'RUN_CREATED', {
      type:     'RUN_CREATED',
      model:    body.model,
      provider: body.provider,
      trace_id: traceId,
      message:  body.message, // stored for /runs/:id/execute replay without client re-send
    });
    await eventLog.append(runCreatedEvent);

    // Deterministic message UUID (matches the UUID computed by the PERSIST_USER_MESSAGE node).
    const messageId = uuidV5(runId, `message:${body.chat_id}:persist_user_message:user`);

    // Append USER_MESSAGE_RECORDED event.
    const userMessageEvent = createRunEvent(runId, body.chat_id, 'USER_MESSAGE_RECORDED', {
      type:        'USER_MESSAGE_RECORDED',
      message_id:  messageId,       // deterministic UUID
      role:        'user',          // always user for this event
      content_len: body.message.length, // byte length for monitoring
    });
    await eventLog.append(userMessageEvent);

    if (body.execute) {
      // Transition to QUEUED and enqueue the job.
      await eventLog.append(
        createRunEvent(runId, body.chat_id, 'RUN_STATUS_CHANGED', {
          type: 'RUN_STATUS_CHANGED',
          from: 'CREATED',
          to:   'QUEUED',
        })
      );

      const job = await runsQueue.add(
        'execute_run',
        {
          run_id:     runId,
          trace_id:   traceId,
          chat_id:    body.chat_id,
          message_id: messageId,
          message:    body.message,
        },
        { jobId: runId } // use runId as jobId for deduplication
      );

      await eventLog.append(
        createRunEvent(runId, body.chat_id, 'RUN_ENQUEUED', {
          type:   'RUN_ENQUEUED',
          queue:  'runs',
          job_id: String(job.id), // BullMQ assigned job ID
        })
      );
    }

    const response: CreateRunResponse = {
      run_id:   runId,
      trace_id: traceId,
      chat_id:  body.chat_id,
    };

    return reply.status(201).send(response); // 201 Created
  });

  // POST /runs/:runId/execute — enqueue an existing run that was created without execute:true.
  fastify.post<{ Params: unknown }>('/runs/:runId/execute', async (request, reply) => {
    const params        = validate(zGetRunStatusParams, request.params);
    const events        = await eventLog.listByRunId(params.runId); // load current events
    const currentStatus = deriveRunStatusFromEvents(events);          // derive from events

    // Idempotent: if already enqueued/running/done, return current status with no side effects.
    if (currentStatus !== 'CREATED') {
      const response: GetRunStatusResponse = {
        run_id: params.runId,
        status: currentStatus,
      };
      return reply.send(response);
    }

    if (events.length === 0) {
      const err: ErrorResponse = {
        error:   'VALIDATION_ERROR',
        message: 'Run not found (no events for run_id).',
      };
      return reply.status(404).send(err);
    }

    const chatId    = events[0]!.chat_id;
    const message   = getRunCreatedMessage(events);   // recover message from RUN_CREATED event
    const messageId = getUserMessageId(events);        // recover message_id from USER_MESSAGE_RECORDED

    if (!message || !messageId) {
      const err: ErrorResponse = {
        error:   'RUNTIME_ERROR',
        message: 'Cannot enqueue run: missing message or message_id in events.',
      };
      return reply.status(409).send(err);
    }

    const traceId = getRunCreatedTraceId(events) ?? randomUUID(); // use stored trace or new one

    await eventLog.append(
      createRunEvent(params.runId, chatId, 'RUN_STATUS_CHANGED', {
        type: 'RUN_STATUS_CHANGED',
        from: 'CREATED',
        to:   'QUEUED',
      })
    );

    const job = await runsQueue.add(
      'execute_run',
      {
        run_id:     params.runId,
        trace_id:   traceId,
        chat_id:    chatId,
        message_id: messageId,
        message,
      },
      { jobId: params.runId } // dedup by run_id
    );

    await eventLog.append(
      createRunEvent(params.runId, chatId, 'RUN_ENQUEUED', {
        type:   'RUN_ENQUEUED',
        queue:  'runs',
        job_id: String(job.id),
      })
    );

    const response: GetRunStatusResponse = {
      run_id: params.runId,
      status: 'QUEUED',
    };
    return reply.send(response);
  });

  // GET /runs/:runId/status — derive and return current run lifecycle status.
  fastify.get<{ Params: unknown }>('/runs/:runId/status', async (request, reply) => {
    const params = validate(zGetRunStatusParams, request.params);
    const events = await eventLog.listByRunId(params.runId);
    const status = deriveRunStatusFromEvents(events); // project status from events

    const response: GetRunStatusResponse = {
      run_id: params.runId,
      status,
    };

    return reply.send(response);
  });

  // GET /runs/:runId/dag-state — derive and return the full DAG execution state.
  fastify.get<{ Params: unknown }>('/runs/:runId/dag-state', async (request, reply) => {
    const params = validate(zGetDagStateParams, request.params);
    const events = await eventLog.listByRunId(params.runId);

    if (events.length === 0) {
      const err: ErrorResponse = {
        error:   'VALIDATION_ERROR',
        message: 'Run not found (no events for run_id).',
      };
      return reply.status(404).send(err);
    }

    const dag_state = deriveDagRunState(events); // project DAG state from events

    const response: GetDagStateResponse = { dag_state };
    return reply.send(response);
  });

  // GET /runs/:runId/events — return the raw event log for a run.
  fastify.get<{
    Params: unknown;
    Querystring: unknown;
  }>('/runs/:runId/events', async (request, reply) => {
    const params = validate(zListRunEventsParams, request.params);
    const query  = validate(zListRunEventsQuery,  request.query);

    let events    = await eventLog.listByRunId(params.runId);
    const total   = events.length; // count before slicing for pagination metadata

    if (query.limit) {
      events = events.slice(0, query.limit); // apply client-requested limit
    }

    const response: ListRunEventsResponse = {
      run_id: params.runId,
      events,
      total,
    };

    return reply.send(response);
  });

  // GET /chats/:chatId/runs — return all events for a chat (debug/inspect endpoint).
  fastify.get<{ Params: { chatId: string } }>('/chats/:chatId/runs', async (request) => {
    const { chatId } = request.params;
    const events = await eventLog.listByChatId(chatId, 100); // last 100 events for chat
    return { runs: events };
  });

  // ── Phase 4 ───────────────────────────────────────────────────────────────

  // GET /runs/:runId/reward — return the REWARD_COMPUTED event data for a completed run.
  // Returns 404 if the run exists but the reward block has not yet completed.
  // Returns 404 if the run does not exist at all.
  fastify.get<{ Params: unknown }>('/runs/:runId/reward', async (request, reply) => {
    const params = validate(zGetRunStatusParams, request.params); // reuse existing params schema

    const events = await eventLog.listByRunId(params.runId); // load all events for this run

    // 404 if no events at all — run doesn't exist.
    if (events.length === 0) {
      const err: ErrorResponse = {
        error:   'NOT_FOUND',
        message: 'Run not found (no events for run_id).',
      };
      return reply.status(404).send(err);
    }

    // Find the REWARD_COMPUTED event — scan forward for the first (and only expected) one.
    const rewardEvent = events.find(e => e.type === 'REWARD_COMPUTED');

    // 404 if reward block hasn't run yet (run may still be in progress).
    if (!rewardEvent) {
      const err: ErrorResponse = {
        error:   'NOT_FOUND',
        message: 'Reward not yet computed for this run (REWARD_COMPUTED event not found).',
      };
      return reply.status(404).send(err);
    }

    // Extract the data payload from the REWARD_COMPUTED event.
    const d: any = (rewardEvent as any).data; // runtime cast — schema validated on read

    // Return a flattened response with all reward fields plus event metadata.
    return reply.send({
      run_id:              params.runId,              // echo the run ID
      ts:                  rewardEvent.ts,            // ISO timestamp of the reward event
      agent_id:            d?.agent_id   ?? null,    // agent that computed the reward
      dag_id:              d?.dag_id     ?? null,     // DAG that was evaluated
      signals:             d?.signals    ?? null,     // all 7 raw signal values
      artifact_score:      d?.artifact_score ?? null, // composite score in [0, 1]
      routing:             d?.routing    ?? null,     // routing decision
      epsilon:             d?.epsilon    ?? null,     // deterministic noise
      hard_gate_triggered: d?.hard_gate_triggered ?? null, // whether a hard gate fired
    });
  });
};
