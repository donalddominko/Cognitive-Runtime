// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// apps/worker/src/index.ts
// BullMQ worker process — consumes the 'runs' queue and executes DAG jobs.
// Phase 4: post-DAG reward block. Phase 5: memory hooks. Phase 5.1: embeddings + caching.
// Phase 6: Meta-Planner integration — selects DAG before execution.
// Phase 7: Production hardening — cancel, timeout, stale, policy gate, failure classification.
// All planner/memory/reward/cache/phase7 failures are NON-FATAL.

import { config as loadEnv } from 'dotenv';
import { Worker, type ConnectionOptions } from 'bullmq';
import { z } from 'zod';
import { eq, desc, and, ilike, or } from 'drizzle-orm';
import Redis from 'ioredis';
import { createDb, EventLog, MessagesRepo } from '@cognitive-runtime/storage';
import { createRunEvent, type RunEvent, type RunEventType } from '@cognitive-runtime/contracts';
import type { M1EpisodicRecord, M3ProceduralRecord } from '@cognitive-runtime/contracts';
import {
  executeDag,
  planDagForRun,
  computeReward,
  deriveAgentTrust,
  AGENT_REGISTRY,
  MemoryOrchestrator,
  M1EpisodicMemoryService,
  M2SemanticMemoryService,
  M3ProceduralMemoryService,
  SEMANTIC_MEMORY_COLLECTION,
  createEmbeddingProvider,
  type EmbeddingProvider,
  type EmbeddingCache,
  type WorkingContextCache,
  sha256Short,
  RedisEmbeddingCache,
  RedisWorkingContextCache,
  NoopEmbeddingCache,
  NoopWorkingContextCache,
  type RedisCacheLike,
  // Phase 6: Meta-Planner imports
  MetaPlanner,
  createMetaPlannerConfig,
  evaluatePlannerDecision,
  // Phase 7: Lifecycle, policy, code-change imports
  createPhase7Config,
  isRunCancelled,
  isRunTimedOut,
  hasTerminalEvent,
  classifyFailedRun,
  getActiveNodeId,
  evaluatePolicy,
  classifyDagType,
  isCodeChangeTask,
} from '@cognitive-runtime/runtime';
import type { M1Store, M2Store, M2SearchResult, M3Store } from '@cognitive-runtime/runtime';

loadEnv();

const zRunJob = z.object({
  run_id:     z.string().uuid(),
  trace_id:   z.string().uuid(),
  chat_id:    z.string().uuid(),
  message_id: z.string().uuid(),
  message:    z.string().min(1),
});

// ── Environment variables ───────────────────────────────────────────────────
const DATABASE_URL         = process.env.DATABASE_URL!;
const REDIS_URL            = process.env.REDIS_URL || 'redis://localhost:6379';
const QUEUE_NAME           = process.env.QUEUE_NAME || 'runs';
const LLAMA_URL            = process.env.LLAMA_URL || 'http://llama:8080';
const QDRANT_URL           = process.env.QDRANT_URL || 'http://qdrant:6333';
const RUN_HISTORY_LIMIT_RAW = process.env.RUN_HISTORY_LIMIT || '6';
const RUN_PROMPT_PREAMBLE  =
  process.env.RUN_PROMPT_PREAMBLE ||
  [
    'System: You are an expert TypeScript + DevOps pair programmer.',
    'System: Answer directly and concisely; no greetings or pep-talk.',
    'System: Never repeat or summarize system instructions.',
    'System: If the user requests a specific short reply (e.g., "Reply with OK"), respond with exactly that and nothing else.',
  ].join('\\n');
const WORKER_HEARTBEAT_MS_RAW = process.env.WORKER_HEARTBEAT_MS || '10000';
const REDIS_CACHE_ENABLED       = process.env.REDIS_ENABLED === 'true';
const CACHE_EMBEDDINGS_ENABLED  = process.env.CACHE_EMBEDDINGS === 'true';
const CACHE_WORKING_CTX_ENABLED = process.env.CACHE_WORKING_CONTEXT === 'true';

if (!DATABASE_URL) throw new Error('DATABASE_URL is required');

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(n)));
}
function parseHeartbeatMs(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return clampInt(n, 1000, 300000);
}
function connectionFromUrl(redisUrl: string): ConnectionOptions {
  const u = new URL(redisUrl);
  const port = u.port ? Number(u.port) : 6379;
  const username = u.username ? decodeURIComponent(u.username) : undefined;
  const password = u.password ? decodeURIComponent(u.password) : undefined;
  const dbFromPath = u.pathname?.replace('/', '');
  const dbNum = dbFromPath ? Number(dbFromPath) : undefined;
  return { host: u.hostname, port, username, password, db: dbNum, maxRetriesPerRequest: null, enableReadyCheck: false };
}
function keyForRunEvent(e: RunEvent): string {
  if (e.type === 'RUN_COMPLETED') return 'RUN_COMPLETED';
  if (e.type === 'RUN_CANCELLED') return 'RUN_CANCELLED';
  if (e.type === 'WORKER_STARTED') return 'WORKER_STARTED';
  if (e.type === 'RUN_STATUS_CHANGED') {
    const d: any = (e as any).data;
    return `RUN_STATUS_CHANGED:${String(d?.from ?? '')}:${String(d?.to ?? '')}`;
  }
  return `TYPE:${e.type}`;
}
function keyForNewEvent(type: RunEventType, data: any): string {
  if (type === 'RUN_COMPLETED') return 'RUN_COMPLETED';
  if (type === 'RUN_CANCELLED') return 'RUN_CANCELLED';
  if (type === 'WORKER_STARTED') return 'WORKER_STARTED';
  if (type === 'RUN_STATUS_CHANGED') {
    return `RUN_STATUS_CHANGED:${String(data?.from ?? '')}:${String(data?.to ?? '')}`;
  }
  return `TYPE:${type}`;
}
function getRunCompletedOk(events: RunEvent[]): boolean | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === 'RUN_COMPLETED') return Boolean((e as any).data?.ok);
    if (e.type === 'RUN_CANCELLED') return false;
  }
  return null;
}

const historyLimit = clampInt(Number(RUN_HISTORY_LIMIT_RAW || '6'), 2, 20);
const heartbeatMs  = parseHeartbeatMs(WORKER_HEARTBEAT_MS_RAW);
const { db }       = createDb(DATABASE_URL);
const eventLog     = new EventLog(db);
const messagesRepo = new MessagesRepo(db);
const connection   = connectionFromUrl(REDIS_URL);
const workerId     = `worker-${process.pid}`;

// Phase 7: Create Phase 7 config
const phase7Config = createPhase7Config(process.env as Record<string, string | undefined>);

// ── Phase 5: Concrete store implementations ──────────────────────────────────
// Each class adapts the abstract M1/M2/M3 store interfaces to their concrete backends:
//   WorkerM1Store  → PostgreSQL (episodic_memories table via Drizzle)
//   WorkerM2Store  → Qdrant    (vector similarity search for semantic memories)
//   WorkerM3Store  → PostgreSQL (procedural_memories table via Drizzle)
import { schema as storageSchema } from '@cognitive-runtime/storage';

/** PostgreSQL-backed M1 episodic memory store. Inserts are idempotent via ON CONFLICT DO NOTHING. */
class WorkerM1Store implements M1Store {
  async insert(record: M1EpisodicRecord): Promise<void> {
    await db.insert(storageSchema.episodicMemories).values({
      id: record.id, chatId: record.chat_id ?? null, runId: record.run_id ?? null,
      projectId: record.project_id ?? null, kind: record.kind, title: record.title,
      summary: record.summary, tags: record.tags, status: record.status ?? null,
      sourceEventIds: record.source_event_ids ?? null, metadata: record.metadata ?? null,
      createdAt: new Date(record.created_at),
    }).onConflictDoNothing({ target: storageSchema.episodicMemories.id });
  }
  async search(params: { query: string; chatId?: string; runId?: string; projectId?: string; topK: number; tags?: string[] }): Promise<M1EpisodicRecord[]> {
    const conditions: any[] = [];
    if (params.chatId) conditions.push(eq(storageSchema.episodicMemories.chatId, params.chatId));
    if (params.runId) conditions.push(eq(storageSchema.episodicMemories.runId, params.runId));
    if (params.projectId) conditions.push(eq(storageSchema.episodicMemories.projectId, params.projectId));
    conditions.push(or(ilike(storageSchema.episodicMemories.title, `%${params.query}%`), ilike(storageSchema.episodicMemories.summary, `%${params.query}%`)));
    const rows = await db.select().from(storageSchema.episodicMemories).where(and(...conditions)).orderBy(desc(storageSchema.episodicMemories.createdAt), storageSchema.episodicMemories.id).limit(params.topK);
    return rows.map(this.rowToRecord);
  }
  async getRecent(params: { chatId?: string; projectId?: string; limit: number }): Promise<M1EpisodicRecord[]> {
    const conditions: any[] = [];
    if (params.chatId) conditions.push(eq(storageSchema.episodicMemories.chatId, params.chatId));
    if (params.projectId) conditions.push(eq(storageSchema.episodicMemories.projectId, params.projectId));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = await db.select().from(storageSchema.episodicMemories).where(whereClause).orderBy(desc(storageSchema.episodicMemories.createdAt), storageSchema.episodicMemories.id).limit(params.limit);
    return rows.map(this.rowToRecord);
  }
  async existsForRun(runId: string): Promise<boolean> {
    const rows = await db.select({ id: storageSchema.episodicMemories.id }).from(storageSchema.episodicMemories).where(eq(storageSchema.episodicMemories.runId, runId)).limit(1);
    return rows.length > 0;
  }
  private rowToRecord(row: any): M1EpisodicRecord {
    return { id: row.id, tier: 'M1', chat_id: row.chatId ?? undefined, run_id: row.runId ?? undefined, project_id: row.projectId ?? undefined, kind: row.kind as any, title: row.title, summary: row.summary, tags: Array.isArray(row.tags) ? row.tags : [], status: row.status ?? undefined, source_event_ids: Array.isArray(row.sourceEventIds) ? row.sourceEventIds : undefined, metadata: row.metadata ?? undefined, created_at: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt) };
  }
}

/**
 * Qdrant-backed M2 semantic memory store.
 * Vectors are stored in the 'semantic_memory' collection.
 * ensureCollection() is called lazily before the first upsert.
 * search() returns [] on any Qdrant connectivity error (non-fatal by design).
 */
class WorkerM2Store implements M2Store {
  async ensureCollection(dimension: number): Promise<void> {
    try {
      const checkResp = await fetch(`${QDRANT_URL}/collections/${SEMANTIC_MEMORY_COLLECTION}`);
      if (checkResp.ok) return;
      await fetch(`${QDRANT_URL}/collections/${SEMANTIC_MEMORY_COLLECTION}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vectors: { size: dimension, distance: 'Cosine' } }) });
      console.log(`[m2-store] created Qdrant collection: ${SEMANTIC_MEMORY_COLLECTION} (dim=${dimension})`);
    } catch (err: any) { console.error(`[m2-store] ensureCollection failed: ${err?.message}`); }
  }
  async upsert(id: string, vector: number[], payload: Record<string, unknown>): Promise<void> {
    const resp = await fetch(`${QDRANT_URL}/collections/${SEMANTIC_MEMORY_COLLECTION}/points`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ points: [{ id, vector, payload }] }) });
    if (!resp.ok) throw new Error(`Qdrant upsert failed: ${resp.status} ${resp.statusText}`);
  }
  async search(vector: number[], topK: number, _filters?: Record<string, unknown>): Promise<M2SearchResult[]> {
    const resp = await fetch(`${QDRANT_URL}/collections/${SEMANTIC_MEMORY_COLLECTION}/points/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vector, limit: topK, with_payload: true }) });
    if (!resp.ok) return [];
    const data = await resp.json() as any;
    return (data?.result ?? []).map((p: any) => ({ id: typeof p.id === 'string' ? p.id : String(p.id), score: typeof p.score === 'number' ? p.score : 0, payload: p.payload ?? {} }));
  }
}

/** PostgreSQL-backed M3 procedural memory store for reusable DAG templates and patterns. */
class WorkerM3Store implements M3Store {
  async insert(record: M3ProceduralRecord): Promise<void> {
    await db.insert(storageSchema.proceduralMemories).values({
      id: record.id, procedureType: record.procedure_type, name: record.name, description: record.description, version: record.version, tags: record.tags, dagTemplate: record.dag_template ?? null, constraints: record.constraints ?? null, status: record.status, createdAt: new Date(record.created_at), updatedAt: record.updated_at ? new Date(record.updated_at) : null,
    }).onConflictDoNothing({ target: storageSchema.proceduralMemories.id });
  }
  async search(params: { query: string; topK: number; tags?: string[]; procedureType?: string }): Promise<M3ProceduralRecord[]> {
    const conditions: any[] = [];
    if (params.procedureType) conditions.push(eq(storageSchema.proceduralMemories.procedureType, params.procedureType));
    conditions.push(or(ilike(storageSchema.proceduralMemories.name, `%${params.query}%`), ilike(storageSchema.proceduralMemories.description, `%${params.query}%`)));
    const rows = await db.select().from(storageSchema.proceduralMemories).where(and(...conditions)).orderBy(desc(storageSchema.proceduralMemories.createdAt), storageSchema.proceduralMemories.id).limit(params.topK);
    return rows.map(this.rowToRecord);
  }
  async listActive(): Promise<M3ProceduralRecord[]> {
    const rows = await db.select().from(storageSchema.proceduralMemories).where(eq(storageSchema.proceduralMemories.status, 'ACTIVE')).orderBy(desc(storageSchema.proceduralMemories.createdAt), storageSchema.proceduralMemories.id);
    return rows.map(this.rowToRecord);
  }
  private rowToRecord(row: any): M3ProceduralRecord {
    return { id: row.id, tier: 'M3', procedure_type: row.procedureType as any, name: row.name, description: row.description, version: row.version, tags: Array.isArray(row.tags) ? row.tags : [], dag_template: row.dagTemplate ?? undefined, constraints: Array.isArray(row.constraints) ? row.constraints : undefined, created_at: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt), updated_at: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : (row.updatedAt ?? undefined), status: row.status as any };
  }
}

// Phase 5.1: CachedEmbeddingProvider (unchanged)
class CachedEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly inner: EmbeddingProvider, private readonly cache: EmbeddingCache) {}
  async embed(text: string): Promise<number[]> {
    const textHash = sha256Short(text);
    const cached = await this.cache.getEmbedding(textHash);
    if (cached !== null && cached.length === this.inner.dimension()) return cached;
    const vector = await this.inner.embed(text);
    await this.cache.setEmbedding(textHash, vector);
    return vector;
  }
  modelName(): string { return this.inner.modelName(); }
  dimension(): number { return this.inner.dimension(); }
}

// Phase 5.1: Qdrant dimension validation (unchanged)
async function validateQdrantDimension(expectedDim: number): Promise<void> {
  try {
    const resp = await fetch(`${QDRANT_URL}/collections/${SEMANTIC_MEMORY_COLLECTION}`);
    if (!resp.ok) return;
    const data = await resp.json() as any;
    const existingDim = data?.result?.config?.params?.vectors?.size;
    if (typeof existingDim === 'number' && existingDim !== expectedDim) {
      console.log(`[qdrant] dimension mismatch: existing=${existingDim} expected=${expectedDim}. Recreating collection.`);
      const delResp = await fetch(`${QDRANT_URL}/collections/${SEMANTIC_MEMORY_COLLECTION}`, { method: 'DELETE' });
      if (delResp.ok) console.log(`[qdrant] deleted old collection (dim=${existingDim})`);
      else console.warn(`[qdrant] failed to delete old collection: ${delResp.status}`);
    } else if (typeof existingDim === 'number') {
      console.log(`[qdrant] collection dimension OK: ${existingDim}`);
    }
  } catch (err: any) { console.warn(`[qdrant] dimension validation failed (non-fatal): ${err?.message}`); }
}

// ── Async startup ───────────────────────────────────────────────────────────
const { provider: baseEmbeddingProvider, isDevFallback: embeddingIsDevFallback } =
  await createEmbeddingProvider({
    EMBEDDING_PROVIDER: process.env.EMBEDDING_PROVIDER, LLAMA_EMBEDDINGS_URL: process.env.LLAMA_EMBEDDINGS_URL,
    LLAMA_SERVER_URL: process.env.LLAMA_SERVER_URL, LLAMA_URL: process.env.LLAMA_URL,
    EMBEDDING_TIMEOUT_MS: process.env.EMBEDDING_TIMEOUT_MS, EMBEDDING_ALLOW_DEV_FALLBACK: process.env.EMBEDDING_ALLOW_DEV_FALLBACK,
  });

let redisCacheClient: RedisCacheLike | null = null;
if (REDIS_CACHE_ENABLED) {
  try {
    const ioRedis = new Redis(REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: true, connectTimeout: 5000, keyPrefix: 'cr:' });
    await ioRedis.connect();
    redisCacheClient = {
      get: (key: string) => ioRedis.get(key),
      set: (key: string, value: string, options?: { EX?: number }) => options?.EX ? ioRedis.set(key, value, 'EX', options.EX) : ioRedis.set(key, value),
      del: (key: string) => ioRedis.del(key).then(() => undefined),
    };
    console.log('[cache] Redis cache client connected');
  } catch (err: any) { console.warn(`[cache] Redis cache client failed (non-fatal, using noop): ${err?.message}`); redisCacheClient = null; }
}

const embeddingCache: EmbeddingCache = (CACHE_EMBEDDINGS_ENABLED && redisCacheClient) ? new RedisEmbeddingCache(redisCacheClient, 'llama_cpp', baseEmbeddingProvider.modelName()) : new NoopEmbeddingCache();
const workingContextCache: WorkingContextCache = (CACHE_WORKING_CTX_ENABLED && redisCacheClient) ? new RedisWorkingContextCache(redisCacheClient) : new NoopWorkingContextCache();
const embeddingProvider: EmbeddingProvider = (CACHE_EMBEDDINGS_ENABLED && redisCacheClient) ? new CachedEmbeddingProvider(baseEmbeddingProvider, embeddingCache) : baseEmbeddingProvider;

const m1Store = new WorkerM1Store();
const m2Store = new WorkerM2Store();
const m3Store = new WorkerM3Store();
const m1Service = new M1EpisodicMemoryService(m1Store);
const m2Service = new M2SemanticMemoryService(m2Store, embeddingProvider);
const m3Service = new M3ProceduralMemoryService(m3Store);
const memoryOrchestrator = new MemoryOrchestrator(m1Service, m2Service, m3Service, eventLog as any);

// Phase 6: Create Meta-Planner instance
const metaPlannerConfig = createMetaPlannerConfig(process.env as Record<string, string | undefined>);
const metaPlanner = new MetaPlanner(metaPlannerConfig, memoryOrchestrator, eventLog as any);
console.log(`[phase6] meta-planner enabled=${metaPlannerConfig.enabled} synthesis=${metaPlannerConfig.allowSynthesis} min_reward=${metaPlannerConfig.minPatternReward} weights=Q${metaPlannerConfig.weights.quality}/L${metaPlannerConfig.weights.latency}/C${metaPlannerConfig.weights.cost}/R${metaPlannerConfig.weights.risk}`);

// Phase 7: Log config
console.log(`[phase7] code_change=${phase7Config.enable_code_change_workflow} replanning=${phase7Config.enable_replanning} policy_gate=${phase7Config.enable_policy_gate} cancel=${phase7Config.enable_run_cancellation} max_loops=${phase7Config.max_planner_loops} timeout_ms=${phase7Config.run_timeout_ms} stale_hb_ms=${phase7Config.stale_heartbeat_ms}`);

try {
  await validateQdrantDimension(embeddingProvider.dimension());
  await m2Service.ensureReady();
  console.log(`✅ Qdrant collection "${SEMANTIC_MEMORY_COLLECTION}" ready (dim=${embeddingProvider.dimension()})`);
} catch (err: any) { console.warn(`⚠️ Qdrant setup failed (non-fatal): ${err?.message}`); }

console.log(`[phase5.1] embedding_provider=${embeddingProvider.modelName()} dim=${embeddingProvider.dimension()} dev_fallback=${embeddingIsDevFallback}`);
console.log(`[phase5.1] redis_cache=${REDIS_CACHE_ENABLED} cache_embeddings=${CACHE_EMBEDDINGS_ENABLED} cache_working_ctx=${CACHE_WORKING_CTX_ENABLED}`);

// ── Heartbeat helpers (unchanged) ───────────────────────────────────────────
async function appendWorkerHeartbeat(runId: string, chatId: string): Promise<void> {
  await eventLog.append(createRunEvent(runId, chatId, 'WORKER_HEARTBEAT', { type: 'WORKER_HEARTBEAT', worker_id: workerId } as any));
}
function startRunHeartbeat(runId: string, chatId: string): () => void {
  if (heartbeatMs <= 0) return () => {};
  let stopped = false; let inFlight = false; let loggedError = false;
  const tick = async () => {
    if (stopped || inFlight) return; inFlight = true;
    try { await appendWorkerHeartbeat(runId, chatId); } catch (e) { if (!loggedError) { loggedError = true; console.error(`WORKER_HEARTBEAT append failed once:`, e); } } finally { inFlight = false; }
  };
  void tick();
  const timer = setInterval(() => void tick(), heartbeatMs);
  return () => { stopped = true; clearInterval(timer); };
}

// ── Phase 4: Post-DAG reward block (unchanged) ─────────────────────────────
async function runRewardBlock(params: { runId: string; chatId: string; dagId: string; dagOk: boolean; agentId: string; events: RunEvent[] }): Promise<{ rewardScore?: number }> {
  const { runId, chatId, dagId, dagOk, agentId, events } = params;
  const alreadyRewarded = events.some(e => e.type === 'REWARD_COMPUTED');
  if (alreadyRewarded) {
    const existingReward = events.find(e => e.type === 'REWARD_COMPUTED');
    const existingScore = (existingReward as any)?.data?.artifact_score;
    return { rewardScore: typeof existingScore === 'number' ? existingScore : undefined };
  }
  await eventLog.append(createRunEvent(runId, chatId, 'REWARD_AGENT_STARTED', { type: 'REWARD_AGENT_STARTED', agent_id: agentId, dag_id: dagId } as any));
  const reward = computeReward({ runId, agentId, dagId, dagOk, events });
  await eventLog.append(createRunEvent(runId, chatId, 'REWARD_COMPUTED', { type: 'REWARD_COMPUTED', agent_id: agentId, dag_id: dagId, signals: reward.signals, artifact_score: reward.artifact_score, routing: reward.routing, epsilon: reward.epsilon, hard_gate_triggered: reward.hard_gate_triggered } as any));
  const allTrustEvents = await eventLog.listByEventType('TRUST_UPDATED', 1000);
  const agentTrustEvents = allTrustEvents.filter((e: any) => e.data?.agent_id === agentId);
  const existingTrust = agentTrustEvents.length > 0 ? { trust: Number((agentTrustEvents[0] as any).data?.trust_after ?? 0.6), updatedAt: agentTrustEvents[0]!.ts } : null;
  const trustResult = deriveAgentTrust({ agentId, existing: existingTrust, artifactScore: reward.artifact_score });
  await eventLog.append(createRunEvent(runId, chatId, 'TRUST_UPDATED', { type: 'TRUST_UPDATED', agent_id: agentId, trust_before: trustResult.trust_before, trust_after: trustResult.trust, artifact_score: reward.artifact_score, ema_alpha: trustResult.ema_alpha } as any));
  await eventLog.append(createRunEvent(runId, chatId, 'REWARD_AGENT_COMPLETED', { type: 'REWARD_AGENT_COMPLETED', agent_id: agentId, dag_id: dagId, ok: true, routing: reward.routing } as any));
  console.log(`[reward-agent] done: run_id=${runId} agent_id=${agentId} score=${reward.artifact_score.toFixed(3)} routing=${reward.routing}`);
  return { rewardScore: reward.artifact_score };
}

// ── BullMQ Worker ───────────────────────────────────────────────────────────
const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const payload = zRunJob.parse(job.data);
    console.log(`🧩 job active: id=${job.id} name=${job.name} run_id=${payload.run_id} trace_id=${payload.trace_id}`);

    const existingEvents = await eventLog.listByRunId(payload.run_id);
    const alreadyCompletedOk = getRunCompletedOk(existingEvents);
    if (alreadyCompletedOk !== null) {
      console.log(`♻️ run already completed: run_id=${payload.run_id} ok=${alreadyCompletedOk} (skipping)`);
      return { ok: alreadyCompletedOk };
    }

    // Phase 7: Check if already cancelled before starting.
    if (isRunCancelled(existingEvents)) {
      console.log(`🚫 run already cancelled: run_id=${payload.run_id} (skipping)`);
      return { ok: false };
    }

    const seen = new Set<string>();
    for (const e of existingEvents) seen.add(keyForRunEvent(e));
    const appendOnce = async (type: RunEventType, data: any) => {
      const k = keyForNewEvent(type, data); if (seen.has(k)) return;
      await eventLog.append(createRunEvent(payload.run_id, payload.chat_id, type, data as any));
      seen.add(k);
    };

    await appendOnce('RUN_STATUS_CHANGED', { type: 'RUN_STATUS_CHANGED', from: 'QUEUED', to: 'RUNNING' });
    await appendOnce('WORKER_STARTED', { type: 'WORKER_STARTED', worker_id: workerId });
    const stopHeartbeat = startRunHeartbeat(payload.run_id, payload.chat_id);

    let ok = false;
    let plannerDecision: any = null;

    try {
      // ── Phase 5: Pre-run memory retrieval (non-fatal) ─────────────────
      try {
        const memoryContext = await memoryOrchestrator.retrieveContext({ runId: payload.run_id, chatId: payload.chat_id, userMessage: payload.message });
        console.log(`[memory] pre-run context: M1=${memoryContext.m1.length} M2=${memoryContext.m2.length} M3=${memoryContext.m3.length}`);
        try {
          await workingContextCache.setContext(payload.run_id, { m1: memoryContext.m1, m2: memoryContext.m2, m3: memoryContext.m3, m1_count: memoryContext.m1.length, m2_count: memoryContext.m2.length, m3_count: memoryContext.m3.length, createdAt: new Date().toISOString() }, 600);
        } catch (cacheErr: any) { console.warn(`[cache] working context cache write failed (non-fatal): ${cacheErr?.message}`); }
      } catch (memErr: any) { console.warn(`[memory] pre-run retrieval failed (non-fatal): ${memErr?.message}`); }

      // Build the default 5-node DAG spec.
      const defaultDag = planDagForRun({ run_id: payload.run_id, chat_id: payload.chat_id, message: payload.message });

      // ── Phase 6: Meta-Planner selects final DAG (non-fatal) ───────────
      let finalDag = defaultDag;
      try {
        const decision = await metaPlanner.plan({
          runId: payload.run_id, chatId: payload.chat_id, userMessage: payload.message, defaultDag, constraints: {},
        });
        plannerDecision = decision;
        finalDag = decision.dag;
        console.log(`[meta-planner] mode=${decision.mode} candidate=${decision.selected_candidate_id} fallback=${decision.fallback_used} score=${decision.scoring.selected_total_score.toFixed(3)}`);
      } catch (planErr: any) {
        console.warn(`[meta-planner] failed (non-fatal, using default DAG): ${planErr?.message}`);
        finalDag = defaultDag;
      }

      // ── Phase 7: Policy gate check before execution (non-fatal) ───────
      if (phase7Config.enable_policy_gate) {
        try {
          const nodeKinds = finalDag.nodes.map(n => n.kind);
          const dagType = classifyDagType(nodeKinds);
          const policyResult = evaluatePolicy(
            { dagType, nodeKinds, riskLevel: 'medium', requiresCode: isCodeChangeTask(payload.message), regulatedDomain: false },
            phase7Config.enable_code_change_workflow,
          );
          await eventLog.append(createRunEvent(payload.run_id, payload.chat_id, 'POLICY_EVALUATED', {
            type: 'POLICY_EVALUATED', ...policyResult,
          } as any));
          console.log(`[policy] verdict=${policyResult.verdict} risk=${policyResult.risk_level} dag_type=${policyResult.dag_type}`);

          if (policyResult.verdict === 'BLOCKED') {
            console.log(`[policy] BLOCKED: ${policyResult.rationale}`);
            ok = false;
            // Emit cancel + classified failed.
            await eventLog.append(createRunEvent(payload.run_id, payload.chat_id, 'RUN_CANCEL_REQUESTED', {
              type: 'RUN_CANCEL_REQUESTED', reason: `Policy blocked: ${policyResult.rationale}`, source: 'POLICY',
            } as any));
            throw new Error(`POLICY_BLOCKED: ${policyResult.rationale}`);
          }
        } catch (policyErr: any) {
          if (policyErr?.message?.startsWith('POLICY_BLOCKED')) throw policyErr;
          console.warn(`[policy] evaluation failed (non-fatal): ${policyErr?.message}`);
        }
      }

      // ── Phase 7: Timeout check before execution ───────────────────────
      if (phase7Config.run_timeout_ms > 0) {
        const freshEventsForTimeout = await eventLog.listByRunId(payload.run_id);
        if (isRunTimedOut(freshEventsForTimeout, phase7Config.run_timeout_ms)) {
          console.log(`[phase7] run timed out before execution: run_id=${payload.run_id}`);
          await eventLog.append(createRunEvent(payload.run_id, payload.chat_id, 'RUN_TIMEOUT_REACHED', {
            type: 'RUN_TIMEOUT_REACHED', timeout_ms: phase7Config.run_timeout_ms, elapsed_ms: phase7Config.run_timeout_ms, active_node: null,
          } as any));
          throw new Error('RUN_TIMEOUT');
        }
      }

      // ── Phase 7: Check cancel before execution ────────────────────────
      const preExecEvents = await eventLog.listByRunId(payload.run_id);
      if (isRunCancelled(preExecEvents)) {
        console.log(`[phase7] run cancelled before execution: run_id=${payload.run_id}`);
        throw new Error('RUN_CANCELLED');
      }

      // Execute the selected DAG.
      const result = await executeDag({
        eventLog, dag: finalDag,
        ctx: { llamaUrl: LLAMA_URL, messagesRepo, messageId: payload.message_id, message: payload.message, historyLimit, promptPreamble: RUN_PROMPT_PREAMBLE, provider: 'qwen', model: 'qwen-2.5-coder-3b' },
      });
      ok = result.ok;

      // ── Phase 4: Post-DAG reward block ──────────────────────────────────
      const freshEvents = await eventLog.listByRunId(payload.run_id);
      const agentEntry = AGENT_REGISTRY['qwen-local'];
      const agentId = agentEntry?.agentId ?? 'qwen-local';
      let rewardScore: number | undefined;
      try {
        const rewardResult = await runRewardBlock({ runId: payload.run_id, chatId: payload.chat_id, dagId: payload.run_id, dagOk: result.ok, agentId, events: freshEvents });
        rewardScore = rewardResult.rewardScore;
      } catch (rewardErr: any) { console.error(`[reward-agent] block failed (non-fatal): run_id=${payload.run_id} error=${rewardErr?.message}`); }

      // ── Phase 6: Post-run planner evaluation (non-fatal) ───────────────
      if (plannerDecision && !plannerDecision.fallback_used) {
        try {
          const evalEvents = await eventLog.listByRunId(payload.run_id);
          const evaluation = evaluatePlannerDecision({ runId: payload.run_id, decision: plannerDecision, events: evalEvents });
          await eventLog.append(createRunEvent(payload.run_id, payload.chat_id, 'META_PLANNER_EVALUATED', {
            type: 'META_PLANNER_EVALUATED',
            predicted_total_score: evaluation.predicted.total_score,
            actual_reward_score: evaluation.actual.reward_score,
            actual_latency_ms: evaluation.actual.latency_ms,
            prediction_error: evaluation.prediction_error.total_score_error,
          } as any));
          console.log(`[meta-planner] evaluation: predicted=${evaluation.predicted.total_score?.toFixed(3)} actual_reward=${evaluation.actual.reward_score?.toFixed(3)} error=${evaluation.prediction_error.total_score_error?.toFixed(3)}`);
        } catch (evalErr: any) { console.warn(`[meta-planner] evaluation failed (non-fatal): ${evalErr?.message}`); }
      }

      // ── Phase 5: Post-run memory write (non-fatal) ─────────────────────
      try {
        const postRunEvents = await eventLog.listByRunId(payload.run_id);
        await memoryOrchestrator.maybeWriteFromRun({ runId: payload.run_id, chatId: payload.chat_id, events: postRunEvents, dagOk: result.ok, rewardScore });
        console.log(`[memory] post-run write completed for run_id=${payload.run_id}`);
      } catch (memErr: any) { console.warn(`[memory] post-run write failed (non-fatal): ${memErr?.message}`); }

    } catch (error: any) {
      ok = false;
      const errMsg = error?.message ? String(error.message) : 'Worker execution failed';

      // Phase 7: Don't emit RUNTIME_ERROR if it's a controlled cancellation/timeout/policy block.
      if (!errMsg.startsWith('RUN_CANCELLED') && !errMsg.startsWith('RUN_TIMEOUT') && !errMsg.startsWith('POLICY_BLOCKED')) {
        await eventLog.append(createRunEvent(payload.run_id, payload.chat_id, 'RUNTIME_ERROR', { type: 'RUNTIME_ERROR', code: 'WORKER_EXECUTION_FAILED', message: errMsg, where: 'apps/worker', details: { name: error?.name, stack: error?.stack } }));
      }
    } finally { stopHeartbeat(); }

    // ── Phase 7: Duplicate-event prevention for terminal events ──────────
    const terminalEvents = await eventLog.listByRunId(payload.run_id);
    if (hasTerminalEvent(terminalEvents)) {
      console.log(`[phase7] terminal event already exists for run_id=${payload.run_id}, skipping final emit`);
      return { ok };
    }

    // ── Phase 7: Classify failed runs ───────────────────────────────────
    if (!ok) {
      try {
        const classifyEvents = await eventLog.listByRunId(payload.run_id);
        const classification = classifyFailedRun(classifyEvents);
        await eventLog.append(createRunEvent(payload.run_id, payload.chat_id, 'RUN_CLASSIFIED_FAILED', {
          type: 'RUN_CLASSIFIED_FAILED',
          classification: classification.classification,
          reason: classification.reason,
          retriable: classification.retriable,
        } as any));
        console.log(`[phase7] classified: run_id=${payload.run_id} class=${classification.classification} retriable=${classification.retriable}`);
      } catch (classErr: any) { console.warn(`[phase7] classification failed (non-fatal): ${classErr?.message}`); }
    }

    // Check one more time if cancel was requested during execution.
    const finalEvents = await eventLog.listByRunId(payload.run_id);
    if (isRunCancelled(finalEvents) && !finalEvents.some(e => e.type === 'RUN_CANCELLED')) {
      await eventLog.append(createRunEvent(payload.run_id, payload.chat_id, 'RUN_CANCELLED', {
        type: 'RUN_CANCELLED', reason: 'Cancellation processed after execution.', cancelled_at_node: getActiveNodeId(finalEvents),
      } as any));
      await appendOnce('RUN_STATUS_CHANGED', { type: 'RUN_STATUS_CHANGED', from: 'RUNNING', to: 'FAILED' });
      await appendOnce('RUN_COMPLETED', { type: 'RUN_COMPLETED', ok: false });
      return { ok: false };
    }

    await appendOnce('RUN_STATUS_CHANGED', { type: 'RUN_STATUS_CHANGED', from: 'RUNNING', to: ok ? 'SUCCEEDED' : 'FAILED' });
    await appendOnce('RUN_COMPLETED', { type: 'RUN_COMPLETED', ok });
    return { ok };
  },
  { connection, concurrency: 1 }
);

async function shutdown(signal: string): Promise<void> {
  console.log(`🛑 ${signal}: closing worker...`);
  try { await worker.close(); } catch (e) { console.error('Error while closing worker:', e); } finally { process.exit(0); }
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
console.log(`✅ worker up: queue=${QUEUE_NAME} worker_id=${workerId} llama_url=${LLAMA_URL} qdrant_url=${QDRANT_URL} history_limit=${historyLimit} heartbeat_ms=${heartbeatMs}`);
