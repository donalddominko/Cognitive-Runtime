// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// apps/api/src/config.ts
// Centralised environment configuration for the Fastify API process.
// All process.env reads happen here; downstream modules import `config` instead.
// Invariant: loadEnv() is called once at module load time; callers must not call it again.
// Exports: config

import { config as loadEnv } from 'dotenv'

loadEnv()

/** Resolved runtime configuration derived from environment variables. */
export const config = {
  /** PostgreSQL connection settings. */
  database: {
    /** Full postgres connection string; required for Drizzle and the worker. */
    url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/cognitive_runtime',
  },
  /** Fastify HTTP server binding. */
  api: {
    /** TCP port the API listens on (default 3001). */
    port: parseInt(process.env.API_PORT || '3001', 10),
    /** Bind address; 0.0.0.0 is required inside Docker containers. */
    host: process.env.API_HOST || '0.0.0.0',
  },
  /** NODE_ENV string; affects logging verbosity and error detail. */
  nodeEnv: process.env.NODE_ENV || 'development',
  /** Qwen/llama.cpp model parameters (used by QwenService). */
  qwen: {
    /** Absolute path to the GGUF model file (dev/host only; empty in Docker). */
    modelPath: process.env.QWEN_MODEL_PATH || '',
    /** KV-cache context window size in tokens. */
    contextSize: parseInt(process.env.QWEN_CONTEXT_SIZE || '8192', 10),
    /** Maximum tokens to generate per completion request. */
    maxTokens: parseInt(process.env.QWEN_MAX_TOKENS || '2048', 10),
  },
}
