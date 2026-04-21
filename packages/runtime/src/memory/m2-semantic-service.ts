// Cognitive Runtime © 2026 by Donald Dominko
// Licensed under CC BY-NC-SA 4.0
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/runtime/src/memory/m2-semantic-service.ts
// Phase 5: M2 semantic memory service — vector-based retrieval with deterministic reranking.
// Uses injected M2Store and EmbeddingProvider interfaces; no direct Qdrant dependency.

import type { M2SemanticRecord, SourceType } from '@cognitive-runtime/contracts'; // record + types
import type { M2Store, M2SearchResult } from './types.js';    // storage interface
import type { EmbeddingProvider } from './embedding-provider.js'; // embedding interface

// ── Qdrant collection name ──────────────────────────────────────────────────
export const SEMANTIC_MEMORY_COLLECTION = 'semantic_memory'; // single collection for all M2 records

// ── Deterministic reranking formula ─────────────────────────────────────────
// final_score = 0.80 * vector_score + 0.10 * confidence + 0.10 * provenance_bonus
//
// provenance_bonus mapping (deterministic):
//   1.0 if source_type is research_note or external_doc
//   0.7 if source_type is run_event
//   0.5 otherwise (user_message, assistant_message, system)
//
// Tie-breaking: created_at desc, then id asc.

function computeProvenanceBonus(sourceType: string): number {
  if (sourceType === 'research_note' || sourceType === 'external_doc') return 1.0; // highest provenance
  if (sourceType === 'run_event') return 0.7; // moderate provenance
  return 0.5; // default provenance for other sources
}

function computeFinalScore(vectorScore: number, confidence: number, sourceType: string): number {
  const provenanceBonus = computeProvenanceBonus(sourceType); // deterministic bonus
  return 0.80 * vectorScore + 0.10 * confidence + 0.10 * provenanceBonus; // weighted sum
}

// ── Reranked result type ────────────────────────────────────────────────────

interface RankedM2Result {
  record: M2SemanticRecord;  // the full record
  finalScore: number;        // computed rerank score
}

// ── M2 Semantic Memory Service ──────────────────────────────────────────────

export class M2SemanticMemoryService {
  constructor(
    private readonly store: M2Store,             // Qdrant adapter
    private readonly embedder: EmbeddingProvider, // embedding generator
  ) {}

  // ensureReady: create the Qdrant collection if it doesn't exist.
  // Call once at startup.
  async ensureReady(): Promise<void> {
    await this.store.ensureCollection(this.embedder.dimension()); // create collection with correct dim
  }

  // writeSemantic: embed text and store in Qdrant with full metadata payload.
  async writeSemantic(record: M2SemanticRecord): Promise<void> {
    const vector = await this.embedder.embed(record.text); // generate embedding vector

    // Build the Qdrant payload from the record fields.
    const payload: Record<string, unknown> = {
      text:            record.text,                // the knowledge text
      embedding_model: record.embedding_model,     // which model produced the embedding
      source_type:     record.source_type,         // provenance category
      source_ref:      record.source_ref ?? null,  // reference identifier
      provenance:      record.provenance,          // detailed provenance object
      tags:            record.tags,                // searchable tags
      confidence:      record.confidence,          // reliability score
      created_at:      record.created_at,          // ISO timestamp
      metadata:        record.metadata ?? null,    // extra metadata
      tier:            'M2',                       // tier marker for filtering
    };

    await this.store.upsert(record.id, vector, payload); // store in Qdrant
  }

  // searchSemantic: embed query, search Qdrant, apply deterministic reranking.
  async searchSemantic(params: {
    query: string;            // search text to embed
    topK?: number;            // max results after reranking (default 5)
    tags?: string[];          // optional tag filter
    chatId?: string;          // optional chat scope (passed in filters)
    runId?: string;           // optional run scope (passed in filters)
    projectId?: string;       // optional project scope (passed in filters)
  }): Promise<M2SemanticRecord[]> {
    const topK = params.topK ?? 5; // default to 5 results

    // Embed the query text using the same model as stored records.
    const queryVector = await this.embedder.embed(params.query);

    // Build optional Qdrant filters from params.
    const filters: Record<string, unknown> = {};
    if (params.tags && params.tags.length > 0) {
      filters.tags = params.tags; // Qdrant can filter on array fields
    }

    // Fetch more candidates than needed for reranking (2x topK, min 10).
    const candidateCount = Math.max(topK * 2, 10);
    const rawResults = await this.store.search(queryVector, candidateCount, filters);

    // Convert raw Qdrant results to RankedM2Results with rerank scores.
    const ranked: RankedM2Result[] = rawResults
      .map((r: M2SearchResult) => {
        const p = r.payload;                    // extract payload
        const confidence = typeof p.confidence === 'number' ? p.confidence : 0.5; // default confidence
        const sourceType = typeof p.source_type === 'string' ? p.source_type : 'system'; // default source
        const finalScore = computeFinalScore(r.score, confidence, sourceType); // deterministic rerank

        // Reconstruct M2SemanticRecord from Qdrant payload.
        const record: M2SemanticRecord = {
          id:              r.id,
          tier:            'M2',
          text:            typeof p.text === 'string' ? p.text : '',
          embedding_model: typeof p.embedding_model === 'string' ? p.embedding_model : 'unknown',
          source_type:     sourceType as SourceType,
          source_ref:      typeof p.source_ref === 'string' ? p.source_ref : undefined,
          provenance:      (p.provenance as any) ?? { label: 'unknown' },
          tags:            Array.isArray(p.tags) ? (p.tags as string[]) : [],
          confidence,
          created_at:      typeof p.created_at === 'string' ? p.created_at : new Date().toISOString(),
          metadata:        (p.metadata as any) ?? undefined,
        };

        return { record, finalScore };
      });

    // Sort by: final_score desc, created_at desc, id asc (deterministic).
    ranked.sort((a, b) => {
      if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore; // higher score first
      // Tie-break by created_at desc.
      const aTime = new Date(a.record.created_at).getTime();
      const bTime = new Date(b.record.created_at).getTime();
      if (bTime !== aTime) return bTime - aTime; // newer first
      // Final tie-break by id asc (lexicographic).
      return a.record.id.localeCompare(b.record.id); // stable alphabetical
    });

    // Return top-k after reranking.
    return ranked.slice(0, topK).map(r => r.record);
  }
}
