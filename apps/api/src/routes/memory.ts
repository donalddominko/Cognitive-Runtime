// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// apps/api/src/routes/memory.ts
// Phase 5: Fastify route plugin for memory endpoints.
// Phase 5.1: Uses configured embedding provider instead of hardcoded DevEmbeddingProvider.
// All routes validate input/output with Zod DTOs from @cognitive-runtime/contracts.

import type { FastifyPluginAsync } from 'fastify';                 // Fastify plugin typing
import { randomUUID } from 'crypto';                               // UUID generation
import { eq, desc, and, ilike, or } from 'drizzle-orm';      // drizzle query helpers
import { db, schema } from '../db/index.js';                      // module-level DB instance
import {
  zMemorySearchRequest,                                            // search query DTO
  zSaveProcedureFromDagRequest,                                    // save-dag body DTO
  zM1EpisodicRecord,                                               // M1 record schema
  zM2SemanticRecord,                                               // M2 record schema
  zM3ProceduralRecord,                                             // M3 record schema
  createRunEvent,                                                   // event builder
  type MemorySearchResponse,                                        // search response type
  type M1EpisodicRecord,                                            // M1 record type
  type M2SemanticRecord,                                            // M2 record type
  type M3ProceduralRecord,                                          // M3 record type
  type ErrorResponse,                                               // error DTO
} from '@cognitive-runtime/contracts';
import { validate } from '../lib/validation.js';                    // request validator
import type { EventLog } from '../lib/event-log.js';                // EventLog interface
// Phase 5.1: import the provider factory instead of hardcoding DevEmbeddingProvider.
import { createEmbeddingProvider, type EmbeddingProvider } from '@cognitive-runtime/runtime';

// RouteContext: injected dependencies passed to this plugin at registration time.
interface RouteContext {
  eventLog: EventLog; // shared EventLog instance
}

// ── Qdrant HTTP helpers ─────────────────────────────────────────────────────
// Direct HTTP calls to Qdrant REST API. No SDK dependency.

const QDRANT_URL = process.env.QDRANT_URL || 'http://qdrant:6333';
const SEMANTIC_COLLECTION = 'semantic_memory';

// ── Module-level embedding provider (initialized once) ──────────────────────
// Lazily created on first use via getEmbedder().

let _embedder: EmbeddingProvider | null = null;

async function getEmbedder(): Promise<EmbeddingProvider> {
  if (_embedder) return _embedder;
  // Create with dev fallback allowed so the API always starts.
  const { provider } = await createEmbeddingProvider({
    EMBEDDING_PROVIDER:           process.env.EMBEDDING_PROVIDER,
    LLAMA_EMBEDDINGS_URL:         process.env.LLAMA_EMBEDDINGS_URL,
    LLAMA_SERVER_URL:             process.env.LLAMA_SERVER_URL,
    LLAMA_URL:                    process.env.LLAMA_URL,
    EMBEDDING_TIMEOUT_MS:         process.env.EMBEDDING_TIMEOUT_MS,
    EMBEDDING_ALLOW_DEV_FALLBACK: 'true', // API search is non-critical — always allow fallback
  });
  _embedder = provider;
  return _embedder;
}

// ── Postgres helpers for M1/M3 ──────────────────────────────────────────────

function rowToM1Record(row: any): M1EpisodicRecord {
  return {
    id:               row.id,
    tier:             'M1',
    chat_id:          row.chatId ?? undefined,
    run_id:           row.runId ?? undefined,
    project_id:       row.projectId ?? undefined,
    kind:             row.kind as any,
    title:            row.title,
    summary:          row.summary,
    tags:             Array.isArray(row.tags) ? row.tags : [],
    status:           row.status ?? undefined,
    source_event_ids: Array.isArray(row.sourceEventIds) ? row.sourceEventIds : undefined,
    metadata:         row.metadata ?? undefined,
    created_at:       row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

function rowToM3Record(row: any): M3ProceduralRecord {
  return {
    id:              row.id,
    tier:            'M3',
    procedure_type:  row.procedureType as any,
    name:            row.name,
    description:     row.description,
    version:         row.version,
    tags:            Array.isArray(row.tags) ? row.tags : [],
    dag_template:    row.dagTemplate ?? undefined,
    constraints:     Array.isArray(row.constraints) ? row.constraints : undefined,
    created_at:      row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updated_at:      row.updatedAt instanceof Date ? row.updatedAt.toISOString() : (row.updatedAt ?? undefined),
    status:          row.status as any,
  };
}

// ── Route plugin ────────────────────────────────────────────────────────────

export const memoryRoutes: FastifyPluginAsync<RouteContext> = async (fastify, { eventLog }) => {

  // GET /memory/search — unified memory search across tiers.
  fastify.get<{ Querystring: unknown }>('/memory/search', async (request, reply) => {
    const params = validate(zMemorySearchRequest, request.query);
    const topK = params.top_k ?? 5;

    const response: MemorySearchResponse = { total: 0 };

    // Search M1 if no tier filter or tier=M1.
    if (!params.tier || params.tier === 'M1') {
      const conditions: any[] = [];
      if (params.chat_id) conditions.push(eq(schema.episodicMemories.chatId, params.chat_id));
      if (params.run_id) conditions.push(eq(schema.episodicMemories.runId, params.run_id));
      if (params.project_id) conditions.push(eq(schema.episodicMemories.projectId, params.project_id));
      // Text search on title and summary.
      conditions.push(
        or(
          ilike(schema.episodicMemories.title, `%${params.query}%`),
          ilike(schema.episodicMemories.summary, `%${params.query}%`),
        )
      );

      const rows = await db
        .select()
        .from(schema.episodicMemories)
        .where(and(...conditions))
        .orderBy(desc(schema.episodicMemories.createdAt), schema.episodicMemories.id)
        .limit(topK);

      response.m1 = rows.map(rowToM1Record);
      response.total += response.m1.length;
    }

    // Search M2 if no tier filter or tier=M2.
    if (!params.tier || params.tier === 'M2') {
      try {
        // Phase 5.1: use configured embedding provider for query vector.
        const embedder = await getEmbedder();
        const queryVector = await embedder.embed(params.query);

        const qdrantResponse = await fetch(`${QDRANT_URL}/collections/${SEMANTIC_COLLECTION}/points/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vector: queryVector,
            limit: topK,
            with_payload: true,
          }),
        });

        if (qdrantResponse.ok) {
          const qdrantData = await qdrantResponse.json() as any;
          const points = qdrantData?.result ?? [];

          response.m2 = points.map((p: any) => {
            const payload = p.payload ?? {};
            return {
              id:              typeof p.id === 'string' ? p.id : String(p.id),
              tier:            'M2',
              text:            payload.text ?? '',
              embedding_model: payload.embedding_model ?? 'unknown',
              source_type:     payload.source_type ?? 'system',
              source_ref:      payload.source_ref ?? undefined,
              provenance:      payload.provenance ?? { label: 'unknown' },
              tags:            Array.isArray(payload.tags) ? payload.tags : [],
              confidence:      typeof payload.confidence === 'number' ? payload.confidence : 0.5,
              created_at:      payload.created_at ?? new Date().toISOString(),
              metadata:        payload.metadata ?? undefined,
            } as M2SemanticRecord;
          });
          response.total += (response.m2 ?? []).length;
        }
      } catch (err: any) {
        // M2 search failure is non-fatal; return empty results.
        console.error(`[memory-routes] M2 search failed: ${err?.message}`);
        response.m2 = [];
      }
    }

    // Search M3 if no tier filter or tier=M3.
    if (!params.tier || params.tier === 'M3') {
      const conditions: any[] = [];
      conditions.push(
        or(
          ilike(schema.proceduralMemories.name, `%${params.query}%`),
          ilike(schema.proceduralMemories.description, `%${params.query}%`),
        )
      );

      const rows = await db
        .select()
        .from(schema.proceduralMemories)
        .where(and(...conditions))
        .orderBy(desc(schema.proceduralMemories.createdAt), schema.proceduralMemories.id)
        .limit(topK);

      response.m3 = rows.map(rowToM3Record);
      response.total += response.m3.length;
    }

    return reply.send(response);
  });

  // POST /memory/write — generic debug/internal write endpoint.
  fastify.post<{ Body: unknown }>('/memory/write', async (request, reply) => {
    const body = request.body as any;
    const tier = body?.tier;

    if (tier === 'M1') {
      const record = validate(zM1EpisodicRecord, body.record);
      await db.insert(schema.episodicMemories).values({
        id:             record.id,
        chatId:         record.chat_id ?? null,
        runId:          record.run_id ?? null,
        projectId:      record.project_id ?? null,
        kind:           record.kind,
        title:          record.title,
        summary:        record.summary,
        tags:           record.tags,
        status:         record.status ?? null,
        sourceEventIds: record.source_event_ids ?? null,
        metadata:       record.metadata ?? null,
        createdAt:      new Date(record.created_at),
      }).onConflictDoNothing({ target: schema.episodicMemories.id });

      return reply.status(201).send({ tier: 'M1', record_id: record.id, ok: true });
    }

    if (tier === 'M2') {
      const record = validate(zM2SemanticRecord, body.record);

      // Phase 5.1: embed with configured provider and store in Qdrant.
      try {
        const embedder = await getEmbedder();
        const vector = await embedder.embed(record.text);

        const payload: Record<string, unknown> = {
          text:            record.text,
          embedding_model: embedder.modelName(), // use actual model name
          source_type:     record.source_type,
          source_ref:      record.source_ref ?? null,
          provenance:      record.provenance,
          tags:            record.tags,
          confidence:      record.confidence,
          created_at:      record.created_at,
          metadata:        record.metadata ?? null,
          tier:            'M2',
        };

        const qdrantResp = await fetch(`${QDRANT_URL}/collections/${SEMANTIC_COLLECTION}/points`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            points: [{ id: record.id, vector, payload }],
          }),
        });

        // Phase 5.1: check Qdrant response for errors.
        if (!qdrantResp.ok) {
          const errText = await qdrantResp.text().catch(() => '');
          throw new Error(`Qdrant upsert failed: ${qdrantResp.status} ${errText.slice(0, 200)}`);
        }

        return reply.status(201).send({ tier: 'M2', record_id: record.id, ok: true });
      } catch (err: any) {
        const errResp: ErrorResponse = {
          error:   'M2_WRITE_FAILED',
          message: err?.message ?? 'Failed to write M2 record to Qdrant',
        };
        return reply.status(500).send(errResp);
      }
    }

    if (tier === 'M3') {
      const record = validate(zM3ProceduralRecord, body.record);
      await db.insert(schema.proceduralMemories).values({
        id:             record.id,
        procedureType:  record.procedure_type,
        name:           record.name,
        description:     record.description,
        version:        record.version,
        tags:           record.tags,
        dagTemplate:    record.dag_template ?? null,
        constraints:    record.constraints ?? null,
        status:         record.status,
        createdAt:      new Date(record.created_at),
        updatedAt:      record.updated_at ? new Date(record.updated_at) : null,
      }).onConflictDoNothing({ target: schema.proceduralMemories.id });

      return reply.status(201).send({ tier: 'M3', record_id: record.id, ok: true });
    }

    const errResp: ErrorResponse = {
      error:   'VALIDATION_ERROR',
      message: `Invalid tier: ${tier}. Must be M1, M2, or M3.`,
    };
    return reply.status(422).send(errResp);
  });

  // GET /memory/episodes — list/filter M1 records.
  fastify.get<{ Querystring: { chatId?: string; projectId?: string; runId?: string; limit?: string } }>(
    '/memory/episodes',
    async (request, reply) => {
      const { chatId, projectId, runId, limit: limitStr } = request.query;
      const limit = Math.min(Math.max(parseInt(limitStr || '20', 10) || 20, 1), 100);

      const conditions: any[] = [];
      if (chatId) conditions.push(eq(schema.episodicMemories.chatId, chatId));
      if (projectId) conditions.push(eq(schema.episodicMemories.projectId, projectId));
      if (runId) conditions.push(eq(schema.episodicMemories.runId, runId));

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const rows = await db
        .select()
        .from(schema.episodicMemories)
        .where(whereClause)
        .orderBy(desc(schema.episodicMemories.createdAt), schema.episodicMemories.id)
        .limit(limit);

      return reply.send({
        episodes: rows.map(rowToM1Record),
        total:    rows.length,
      });
    }
  );

  // GET /memory/procedures — list/search M3 records.
  fastify.get<{ Querystring: { query?: string; procedureType?: string; limit?: string } }>(
    '/memory/procedures',
    async (request, reply) => {
      const { query, procedureType, limit: limitStr } = request.query;
      const limit = Math.min(Math.max(parseInt(limitStr || '20', 10) || 20, 1), 100);

      const conditions: any[] = [];
      if (procedureType) conditions.push(eq(schema.proceduralMemories.procedureType, procedureType));
      if (query) {
        conditions.push(
          or(
            ilike(schema.proceduralMemories.name, `%${query}%`),
            ilike(schema.proceduralMemories.description, `%${query}%`),
          )
        );
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const rows = await db
        .select()
        .from(schema.proceduralMemories)
        .where(whereClause)
        .orderBy(desc(schema.proceduralMemories.createdAt), schema.proceduralMemories.id)
        .limit(limit);

      return reply.send({
        procedures: rows.map(rowToM3Record),
        total:      rows.length,
      });
    }
  );

  // POST /memory/procedures/save-dag — save a DAG as an M3 procedural record.
  fastify.post<{ Body: unknown }>('/memory/procedures/save-dag', async (request, reply) => {
    const body = validate(zSaveProcedureFromDagRequest, request.body);

    // Load events for the run to extract DAG spec.
    const events = await eventLog.listByRunId(body.run_id);
    if (events.length === 0) {
      const errResp: ErrorResponse = {
        error:   'NOT_FOUND',
        message: `Run not found: ${body.run_id}`,
      };
      return reply.status(404).send(errResp);
    }

    const chatId = events[0]!.chat_id;

    // Extract DAG spec from DAG_PLANNED event.
    const dagPlannedEvent = events.find(e => e.type === 'DAG_PLANNED');
    const dagId = body.dag_id ?? (dagPlannedEvent as any)?.data?.dag_id ?? body.run_id;

    // Extract node specs from NODE_QUEUED events.
    const nodeEvents = events.filter(e => e.type === 'NODE_QUEUED');
    const dagTemplate = {
      dag_id:    dagId,
      run_id:    body.run_id,
      node_count: nodeEvents.length,
      nodes:     nodeEvents.map((e: any) => ({
        node_id: e.data?.node_id,
        kind:    e.data?.kind,
      })),
    };

    const procedureId = randomUUID();

    // Emit MEMORY_WRITE_REQUESTED event.
    await eventLog.append(
      createRunEvent(body.run_id, chatId, 'MEMORY_WRITE_REQUESTED', {
        type:        'MEMORY_WRITE_REQUESTED',
        tier:        'M3',
        record_kind: 'dag_template',
        reason:      `Explicit save of DAG from run ${body.run_id} as procedure "${body.name}".`,
      } as any)
    );

    // Insert M3 record.
    await db.insert(schema.proceduralMemories).values({
      id:             procedureId,
      procedureType:  'dag_template',
      name:           body.name,
      description:    body.description,
      version:        body.version ?? '1.0.0',
      tags:           body.tags ?? [],
      dagTemplate,
      constraints:    null,
      status:         'ACTIVE',
      createdAt:      new Date(),
      updatedAt:      null,
    });

    // Emit MEMORY_WRITTEN event.
    await eventLog.append(
      createRunEvent(body.run_id, chatId, 'MEMORY_WRITTEN', {
        type:      'MEMORY_WRITTEN',
        tier:      'M3',
        record_id: procedureId,
        summary:   `Procedure "${body.name}" saved from run ${body.run_id}.`,
      } as any)
    );

    return reply.status(201).send({
      procedure_id: procedureId,
      ok:           true,
    });
  });

  // GET /runs/:runId/context — return retrieved M1/M2/M3 context for a run.
  fastify.get<{ Params: { runId: string } }>('/runs/:runId/context', async (request, reply) => {
    const { runId } = request.params;

    // Find MEMORY_RETRIEVED events for this run.
    const events = await eventLog.listByRunId(runId);
    const retrievedEvents = events.filter(e => e.type === 'MEMORY_RETRIEVED');

    // Find RUN_CONTEXT_PREPARED event.
    const contextEvent = events.find(e => e.type === 'RUN_CONTEXT_PREPARED');

    const context: any = {
      run_id:   runId,
      m1_count: 0,
      m2_count: 0,
      m3_count: 0,
      retrievals: [] as any[],
    };

    if (contextEvent) {
      const d = (contextEvent as any).data;
      context.m1_count = d?.m1_count ?? 0;
      context.m2_count = d?.m2_count ?? 0;
      context.m3_count = d?.m3_count ?? 0;
    }

    for (const e of retrievedEvents) {
      const d = (e as any).data;
      context.retrievals.push({
        tier:         d?.tier,
        query:        d?.query,
        top_k:        d?.top_k,
        result_count: d?.result_count,
        record_ids:   d?.record_ids ?? [],
      });
    }

    return reply.send(context);
  });
};
