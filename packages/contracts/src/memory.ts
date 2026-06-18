// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/contracts/src/memory.ts
// Phase 5: Memory Plane v1 — Zod schemas and DTOs for the M1–M3 memory layers
// (plus the transient M0 working-context/cache tier).
// All memory contracts live here; validated at every API and storage boundary.

import { z } from 'zod';                        // runtime schema validation
import { zUUID, zISODateString } from './common.js'; // shared primitives

// ── Shared enums and primitives ──────────────────────────────────────────────

// MemoryTier: which memory tier a record belongs to.
export const zMemoryTier = z.enum(['M0', 'M1', 'M2', 'M3']);
export type MemoryTier = z.infer<typeof zMemoryTier>;

// MemoryRecordId: unique identifier for a memory record (UUID format).
export const zMemoryRecordId = zUUID;
export type MemoryRecordId = z.infer<typeof zMemoryRecordId>;

// ProjectId: optional project scope for grouping memories.
export const zProjectId = z.string().min(1).max(255);
export type ProjectId = z.infer<typeof zProjectId>;

// ConfidenceScore: how reliable a memory record is, in [0, 1].
export const zConfidenceScore = z.number().min(0).max(1);
export type ConfidenceScore = z.infer<typeof zConfidenceScore>;

// SourceType: provenance of a memory record — where it came from.
export const zSourceType = z.enum([
  'user_message',       // derived from a user's message
  'assistant_message',  // derived from an assistant response
  'run_event',          // derived from run execution events
  'external_doc',       // from an external document or URL
  'research_note',      // from a research/investigation
  'system',             // system-generated
]);
export type SourceType = z.infer<typeof zSourceType>;

// ── M1 Episodic Memory Record ───────────────────────────────────────────────

// M1EpisodeKind: what kind of episode this record captures.
export const zM1EpisodeKind = z.enum([
  'task_episode',   // a complete task execution
  'run_summary',    // summary of a run's outcome
  'failure_case',   // notable failure for learning
  'success_case',   // notable success for learning
]);
export type M1EpisodeKind = z.infer<typeof zM1EpisodeKind>;

// M1EpisodeStatus: outcome status of the episode.
export const zM1EpisodeStatus = z.enum(['SUCCEEDED', 'FAILED', 'PARTIAL']);
export type M1EpisodeStatus = z.infer<typeof zM1EpisodeStatus>;

// M1EpisodicRecord: a structured episode from a prior run.
export const zM1EpisodicRecord = z.object({
  id:               zUUID,                                   // unique record ID
  tier:             z.literal('M1'),                         // always M1
  chat_id:          zUUID.optional(),                        // owning chat session
  run_id:           zUUID.optional(),                        // owning run
  project_id:       zProjectId.optional(),                   // optional project scope
  kind:             zM1EpisodeKind,                          // episode classification
  title:            z.string().min(1).max(500),              // short descriptive title
  summary:          z.string().min(1).max(5000),             // episode summary text
  tags:             z.array(z.string().min(1).max(100)),     // searchable tags
  status:           zM1EpisodeStatus.optional(),             // outcome status
  created_at:       zISODateString,                          // when the episode was created
  source_event_ids: z.array(z.string()).optional(),          // event IDs that sourced this episode
  metadata:         z.object({                               // optional extra metadata
    model:          z.string().optional(),                   // LLM model used
    provider:       z.string().optional(),                   // LLM provider used
    reward_score:   z.number().min(0).max(1).optional(),     // reward score if available
    dag_id:         zUUID.optional(),                        // DAG that produced this episode
  }).optional(),
});
export type M1EpisodicRecord = z.infer<typeof zM1EpisodicRecord>;

// ── M2 Semantic Memory Record ───────────────────────────────────────────────

// M2Provenance: where a semantic record came from.
export const zM2Provenance = z.object({
  label:   z.string().min(1).max(500),       // human-readable provenance label
  url:     z.string().max(2000).optional(),   // source URL if applicable
  run_id:  zUUID.optional(),                  // run that generated this knowledge
  chat_id: zUUID.optional(),                  // chat context
});
export type M2Provenance = z.infer<typeof zM2Provenance>;

// M2SemanticRecord: a reusable knowledge snippet indexed for semantic retrieval.
export const zM2SemanticRecord = z.object({
  id:              zUUID,                                    // unique record ID
  tier:            z.literal('M2'),                          // always M2
  text:            z.string().min(1).max(10000),             // the knowledge text
  embedding_model: z.string().min(1).max(100),               // which model produced the embedding
  source_type:     zSourceType,                              // provenance category
  source_ref:      z.string().max(2000).optional(),          // reference identifier
  provenance:      zM2Provenance,                            // detailed provenance
  tags:            z.array(z.string().min(1).max(100)),      // searchable tags
  confidence:      zConfidenceScore,                         // reliability score
  created_at:      zISODateString,                           // creation timestamp
  metadata:        z.object({                                // optional extra metadata
    chunk_index:   z.number().int().min(0).optional(),       // position in a chunked document
    domain:        z.string().max(200).optional(),           // knowledge domain
    project_id:    zProjectId.optional(),                    // project scope
  }).optional(),
});
export type M2SemanticRecord = z.infer<typeof zM2SemanticRecord>;

// ── M3 Procedural Memory Record ─────────────────────────────────────────────

// M3ProcedureType: what kind of procedure this record stores.
export const zM3ProcedureType = z.enum([
  'dag_template',      // reusable DAG structure
  'workflow_pattern',  // workflow automation pattern
  'policy_pattern',    // policy or governance pattern
]);
export type M3ProcedureType = z.infer<typeof zM3ProcedureType>;

// M3ProcedureStatus: lifecycle status of a procedure.
export const zM3ProcedureStatus = z.enum(['ACTIVE', 'DEPRECATED', 'DRAFT']);
export type M3ProcedureStatus = z.infer<typeof zM3ProcedureStatus>;

// M3ProceduralRecord: a reusable procedure, template, or pattern.
export const zM3ProceduralRecord = z.object({
  id:              zUUID,                                    // unique record ID
  tier:            z.literal('M3'),                          // always M3
  procedure_type:  zM3ProcedureType,                         // classification
  name:            z.string().min(1).max(500),               // procedure name
  description:     z.string().min(1).max(5000),              // what this procedure does
  version:         z.string().min(1).max(50),                // semver or label
  tags:            z.array(z.string().min(1).max(100)),      // searchable tags
  dag_template:    z.unknown().optional(),                   // stored DAG spec if applicable
  constraints:     z.array(z.string()).optional(),            // policy constraints
  created_at:      zISODateString,                           // creation timestamp
  updated_at:      zISODateString.optional(),                // last update timestamp
  status:          zM3ProcedureStatus,                       // lifecycle status
});
export type M3ProceduralRecord = z.infer<typeof zM3ProceduralRecord>;

// ── Retrieval / Write DTOs ──────────────────────────────────────────────────

// MemorySearchRequest: unified search across memory tiers.
export const zMemorySearchRequest = z.object({
  tier:       zMemoryTier.exclude(['M0']).optional(),        // which tier to search (omit for multi-tier)
  query:      z.string().min(1).max(2000),                   // search query text
  chat_id:    zUUID.optional(),                              // scope to chat
  run_id:     zUUID.optional(),                              // scope to run
  project_id: zProjectId.optional(),                         // scope to project
  top_k:      z.number().int().min(1).max(50).optional(),    // max results (default varies by tier)
  tags:       z.array(z.string().min(1).max(100)).optional(),// filter by tags
});
export type MemorySearchRequest = z.infer<typeof zMemorySearchRequest>;

// MemorySearchResponse: unified response with results from one or more tiers.
export const zMemorySearchResponse = z.object({
  m1: z.array(zM1EpisodicRecord).optional(),   // M1 results if queried
  m2: z.array(zM2SemanticRecord).optional(),    // M2 results if queried
  m3: z.array(zM3ProceduralRecord).optional(),  // M3 results if queried
  total: z.number().int().nonnegative(),         // total results across all tiers
});
export type MemorySearchResponse = z.infer<typeof zMemorySearchResponse>;

// MemoryWriteRequest: write a record to a specific tier.
export const zMemoryWriteRequest = z.object({
  tier: zMemoryTier.exclude(['M0']),                         // M0 is transient, not writable
  record: z.union([zM1EpisodicRecord, zM2SemanticRecord, zM3ProceduralRecord]),
});
export type MemoryWriteRequest = z.infer<typeof zMemoryWriteRequest>;

// MemoryWriteResponse: acknowledgement of a write.
export const zMemoryWriteResponse = z.object({
  tier:      zMemoryTier,                                    // which tier was written to
  record_id: zUUID,                                          // ID of the written record
  ok:        z.boolean(),                                    // whether the write succeeded
});
export type MemoryWriteResponse = z.infer<typeof zMemoryWriteResponse>;

// SaveProcedureFromDagRequest: save a DAG as an M3 procedural record.
export const zSaveProcedureFromDagRequest = z.object({
  run_id:      zUUID,                                        // run whose DAG to save
  dag_id:      zUUID.optional(),                             // explicit dag_id (defaults to run_id)
  name:        z.string().min(1).max(500),                   // procedure name
  description: z.string().min(1).max(5000),                  // what this procedure does
  tags:        z.array(z.string().min(1).max(100)).optional(),// optional tags
  version:     z.string().min(1).max(50).optional(),         // optional version string
});
export type SaveProcedureFromDagRequest = z.infer<typeof zSaveProcedureFromDagRequest>;

// SaveProcedureFromDagResponse: acknowledgement of procedure save.
export const zSaveProcedureFromDagResponse = z.object({
  procedure_id: zUUID,                                       // ID of the saved M3 record
  ok:           z.boolean(),                                 // whether the save succeeded
});
export type SaveProcedureFromDagResponse = z.infer<typeof zSaveProcedureFromDagResponse>;

// ── MEMORY_* Event Data Schemas ─────────────────────────────────────────────
// These are the data payloads for the 6 new MEMORY_* events in the RunEvent union.
// Each follows the same pattern as existing event data schemas in events.ts.

export const zMemoryWriteRequestedData = z
  .object({
    type:        z.literal('MEMORY_WRITE_REQUESTED').optional(), // optional discriminator echo
    tier:        zMemoryTier.exclude(['M0']),                    // which tier is being written
    record_kind: z.string().optional(),                          // e.g. 'run_summary', 'dag_template'
    reason:      z.string().min(1),                              // why this write was triggered
  })
  .passthrough();
export type MemoryWriteRequestedData = z.infer<typeof zMemoryWriteRequestedData>;

export const zMemoryWrittenData = z
  .object({
    type:      z.literal('MEMORY_WRITTEN').optional(),  // optional discriminator echo
    tier:      zMemoryTier.exclude(['M0']),              // which tier was written
    record_id: zUUID,                                    // ID of the written record
    summary:   z.string().optional(),                    // brief summary of what was written
  })
  .passthrough();
export type MemoryWrittenData = z.infer<typeof zMemoryWrittenData>;

export const zMemoryIndexedData = z
  .object({
    type:       z.literal('MEMORY_INDEXED').optional(), // optional discriminator echo
    tier:       z.literal('M2'),                        // only M2 records are vector-indexed
    record_id:  zUUID,                                  // ID of the indexed record
    collection: z.string().min(1),                      // Qdrant collection name
  })
  .passthrough();
export type MemoryIndexedData = z.infer<typeof zMemoryIndexedData>;

export const zMemoryRetrievedData = z
  .object({
    type:         z.literal('MEMORY_RETRIEVED').optional(), // optional discriminator echo
    tier:         zMemoryTier.exclude(['M0']),              // which tier was queried
    query:        z.string(),                               // the search query
    top_k:        z.number().int().min(1),                  // requested max results
    result_count: z.number().int().min(0),                  // actual results returned
    record_ids:   z.array(z.string()),                      // IDs of returned records
  })
  .passthrough();
export type MemoryRetrievedData = z.infer<typeof zMemoryRetrievedData>;

export const zMemorySkippedData = z
  .object({
    type:   z.literal('MEMORY_SKIPPED').optional(), // optional discriminator echo
    tier:   zMemoryTier.exclude(['M0']),            // which tier was skipped
    reason: z.string().min(1),                      // why the write was not justified
  })
  .passthrough();
export type MemorySkippedData = z.infer<typeof zMemorySkippedData>;

export const zRunContextPreparedData = z
  .object({
    type:     z.literal('RUN_CONTEXT_PREPARED').optional(), // optional discriminator echo
    m1_count: z.number().int().min(0),                      // M1 episodes retrieved
    m2_count: z.number().int().min(0),                      // M2 semantic records retrieved
    m3_count: z.number().int().min(0),                      // M3 procedures retrieved
  })
  .passthrough();
export type RunContextPreparedData = z.infer<typeof zRunContextPreparedData>;
