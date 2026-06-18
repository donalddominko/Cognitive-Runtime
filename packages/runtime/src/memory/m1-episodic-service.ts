// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/runtime/src/memory/m1-episodic-service.ts
// Phase 5: M1 episodic memory service — business logic for structured episode records.
// Uses injected M1Store interface; no direct DB dependency.

import type { M1EpisodicRecord } from '@cognitive-runtime/contracts'; // record type
import type { M1Store } from './types.js'; // storage interface

// ── M1 Episodic Memory Service ──────────────────────────────────────────────

export class M1EpisodicMemoryService {
  constructor(private readonly store: M1Store) {} // inject concrete store implementation

  // writeEpisode: persist an M1 record. Checks idempotency via run_id if present.
  async writeEpisode(record: M1EpisodicRecord): Promise<void> {
    // Idempotency: skip if an episode for this run already exists.
    if (record.run_id) {
      const exists = await this.store.existsForRun(record.run_id); // check for duplicates
      if (exists) return; // no-op — episode already recorded for this run
    }
    await this.store.insert(record); // delegate to concrete store
  }

  // searchEpisodes: text search with optional scope filters.
  // Results are ordered by: match quality desc, created_at desc, id asc (deterministic).
  async searchEpisodes(params: {
    query: string;           // search text
    chatId?: string;         // optional chat scope
    runId?: string;          // optional run scope
    projectId?: string;      // optional project scope
    topK?: number;           // max results (default 5)
    tags?: string[];         // optional tag filter
  }): Promise<M1EpisodicRecord[]> {
    const topK = params.topK ?? 5; // default to 5 results
    return this.store.search({
      query:     params.query,
      chatId:    params.chatId,
      runId:     params.runId,
      projectId: params.projectId,
      topK,
      tags:      params.tags,
    });
  }

  // getRecentEpisodes: fetch most recent episodes for a chat or project.
  // Results ordered by created_at desc, id asc (deterministic).
  async getRecentEpisodes(params: {
    chatId?: string;         // optional chat scope
    projectId?: string;      // optional project scope
    limit?: number;          // max results (default 5)
  }): Promise<M1EpisodicRecord[]> {
    const limit = params.limit ?? 5; // default to 5
    return this.store.getRecent({
      chatId:    params.chatId,
      projectId: params.projectId,
      limit,
    });
  }
}
