// Cognitive Runtime © 2026 by Donald Dominko
// Licensed under CC BY-NC-SA 4.0
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/runtime/src/memory/m3-procedural-service.ts
// Phase 5: M3 procedural memory service — reusable procedures, DAG templates, patterns.
// Uses injected M3Store interface; no direct DB dependency.

import type { M3ProceduralRecord } from '@cognitive-runtime/contracts'; // record type
import type { M3Store } from './types.js'; // storage interface

// ── M3 Procedural Memory Service ────────────────────────────────────────────

export class M3ProceduralMemoryService {
  constructor(private readonly store: M3Store) {} // inject concrete store implementation

  // writeProcedure: persist an M3 procedural record.
  async writeProcedure(record: M3ProceduralRecord): Promise<void> {
    await this.store.insert(record); // delegate to concrete store
  }

  // searchProcedures: text search with optional filters.
  // Results ordered by: match quality desc, created_at desc, id asc (deterministic).
  async searchProcedures(params: {
    query: string;               // search text
    topK?: number;               // max results (default 5)
    tags?: string[];             // optional tag filter
    procedureType?: string;      // optional procedure type filter
  }): Promise<M3ProceduralRecord[]> {
    const topK = params.topK ?? 5; // default to 5 results
    return this.store.search({
      query:         params.query,
      topK,
      tags:          params.tags,
      procedureType: params.procedureType,
    });
  }

  // listActiveProcedures: return all procedures with status = 'ACTIVE'.
  async listActiveProcedures(): Promise<M3ProceduralRecord[]> {
    return this.store.listActive(); // delegate to concrete store
  }
}
