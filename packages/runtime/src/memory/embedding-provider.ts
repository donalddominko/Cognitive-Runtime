// Cognitive Runtime © 2026 by Donald Dominko
// Licensed under CC BY-NC-SA 4.0
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/runtime/src/memory/embedding-provider.ts
// Phase 5.1: Embedding provider interface, dev deterministic provider, and llama.cpp real provider.
// The dev provider uses SHA-256 hash to generate deterministic 384-dim vectors.
// The llama.cpp provider calls the /v1/embeddings endpoint for real 2048-dim vectors.

import { createHash } from 'crypto'; // Node built-in for deterministic hashing

// ── Embedding Provider Interface ────────────────────────────────────────────
// All M2 semantic memory operations use this interface for vector generation.
// Swap implementations by changing what gets injected into M2SemanticMemoryService.

export interface EmbeddingProvider {
  // embed: convert text to a dense vector representation.
  embed(text: string): Promise<number[]>;

  // modelName: return a stable identifier for the embedding model (stored in records).
  modelName(): string;

  // dimension: the vector dimensionality (must match Qdrant collection config).
  dimension(): number;
}

// ── Dev Embedding Provider ──────────────────────────────────────────────────
// Deterministic, no-external-dependency embedding provider for development.
// Generates 384-dimensional vectors from SHA-256 hashes of the input text.
//
// Properties:
// - Same text always produces same vector (deterministic)
// - Different texts produce different vectors (hash collision probability negligible)
// - NOT semantically meaningful — purely for testing retrieval pipeline
//
// How to replace:
// 1. Implement EmbeddingProvider with OpenAI/llama.cpp /embedding calls
// 2. Set EMBEDDING_PROVIDER=openai or EMBEDDING_PROVIDER=llama in .env
// 3. Inject the new provider into M2SemanticMemoryService
//
// Required env vars for future providers:
// - OPENAI_API_KEY: for OpenAI embeddings (text-embedding-3-small)
// - LLAMA_URL: for llama.cpp /embedding endpoint (already in env)

const DEV_EMBEDDING_DIMENSION = 384; // matches common small embedding models

export class DevEmbeddingProvider implements EmbeddingProvider {
  // embed: generate a deterministic 384-dim vector from text via SHA-256.
  // Process: hash text 12 times with different salts → each hash yields 32 floats → 384 total.
  async embed(text: string): Promise<number[]> {
    const vector: number[] = []; // accumulate float values
    const normalizedText = text.trim().toLowerCase(); // normalize for consistency

    // We need 384 floats. Each SHA-256 produces 32 bytes → 32 floats.
    // 384 / 32 = 12 hash rounds needed.
    for (let round = 0; round < 12; round++) {
      // Hash with a unique salt per round to produce different bytes.
      const input = `${round}:${normalizedText}`; // deterministic salt
      const digest = createHash('sha256').update(input, 'utf8').digest(); // 32-byte hash

      // Convert each byte to a float in [-1, 1] for unit-norm-ish vectors.
      for (let i = 0; i < 32; i++) {
        const byteVal = digest[i]!;          // unsigned byte [0, 255]
        const floatVal = (byteVal / 127.5) - 1.0; // map to [-1, 1]
        vector.push(floatVal);
      }
    }

    // L2-normalize the vector so cosine similarity works correctly.
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)); // L2 norm
    if (magnitude > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] = vector[i]! / magnitude; // normalize each component
      }
    }

    return vector; // 384-dimensional unit vector
  }

  // modelName: identifies this as the dev provider in M2 records.
  modelName(): string {
    return 'dev-hash-384'; // clearly marked as development-only
  }

  // dimension: vector dimensionality for Qdrant collection configuration.
  dimension(): number {
    return DEV_EMBEDDING_DIMENSION; // 384
  }
}

// ── LlamaCpp Embedding Provider ─────────────────────────────────────────────
// Production embedding provider that calls llama.cpp's /v1/embeddings endpoint.
// Uses the OpenAI-compatible API format.
//
// The model served by llama.cpp determines the vector dimension.
// Qwen2.5-Coder-3B produces 2048-dimensional embeddings with --pooling mean.
//
// Required env vars:
// - LLAMA_EMBEDDINGS_URL: full URL to the embeddings endpoint (highest priority)
//   OR derive from LLAMA_SERVER_URL / LLAMA_URL by appending /v1/embeddings
// - EMBEDDING_TIMEOUT_MS: request timeout in milliseconds (default 30000)

// LlamaCppEmbeddingProviderOptions: configuration for the llama.cpp provider.
export interface LlamaCppEmbeddingProviderOptions {
  embeddingsUrl: string;   // full URL to the /v1/embeddings endpoint
  timeoutMs?: number;      // request timeout in ms (default 30000)
}

export class LlamaCppEmbeddingProvider implements EmbeddingProvider {
  // The URL to POST embedding requests to.
  private readonly url: string;
  // Request timeout in milliseconds.
  private readonly timeoutMs: number;
  // Cached dimension discovered during capability probe.
  private cachedDimension: number | null = null;
  // Cached model name from the server response.
  private cachedModelName: string | null = null;

  constructor(options: LlamaCppEmbeddingProviderOptions) {
    this.url = options.embeddingsUrl;                   // e.g. http://llama:8080/v1/embeddings
    this.timeoutMs = options.timeoutMs ?? 30000;        // default 30s timeout
  }

  // probeCapability: test the embeddings endpoint and discover dimension + model.
  // Must be called once at startup. Throws on failure.
  async probeCapability(): Promise<{ dimension: number; model: string }> {
    console.log(`[llama-embeddings] probing capability at ${this.url} ...`);

    // Send a short test string to discover the embedding dimension.
    const controller = new AbortController();                          // for timeout
    const timer = setTimeout(() => controller.abort(), this.timeoutMs); // enforce timeout

    try {
      const response = await fetch(this.url, {
        method: 'POST',                                                // POST request
        headers: { 'Content-Type': 'application/json' },              // JSON body
        body: JSON.stringify({ input: 'dimension probe', model: 'default' }), // test input
        signal: controller.signal,                                      // abort on timeout
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');         // read error body
        throw new Error(`HTTP ${response.status}: ${errBody.slice(0, 200)}`); // include status
      }

      const data = await response.json() as any;                       // parse JSON response

      // Extract embedding from OpenAI-compatible response format.
      // Shape: { data: [{ embedding: number[], index: 0 }], model: "..." }
      const embedding = data?.data?.[0]?.embedding;                    // first embedding vector
      if (!Array.isArray(embedding) || embedding.length === 0) {
        throw new Error('Probe response missing data[0].embedding array'); // bad response shape
      }

      // Validate all elements are numbers.
      const firstNonNumber = embedding.findIndex((v: any) => typeof v !== 'number');
      if (firstNonNumber !== -1) {
        throw new Error(`Non-number at index ${firstNonNumber} in embedding`); // bad element
      }

      // Cache the discovered dimension and model name.
      this.cachedDimension = embedding.length;                          // e.g. 2048
      this.cachedModelName = typeof data?.model === 'string'
        ? data.model                                                    // use server-reported model
        : 'llama-cpp-unknown';                                         // fallback name

      console.log(`[llama-embeddings] probe OK: dimension=${this.cachedDimension} model=${this.cachedModelName}`);

      return { dimension: this.cachedDimension, model: this.cachedModelName ?? 'llama-cpp-unknown' };      
    } finally {
      clearTimeout(timer);                                              // clean up timeout
    }
  }

  // embed: convert text to a dense vector via llama.cpp /v1/embeddings.
  async embed(text: string): Promise<number[]> {
    const controller = new AbortController();                          // for timeout
    const timer = setTimeout(() => controller.abort(), this.timeoutMs); // enforce timeout

    try {
      const response = await fetch(this.url, {
        method: 'POST',                                                // POST request
        headers: { 'Content-Type': 'application/json' },              // JSON body
        body: JSON.stringify({ input: text, model: 'default' }),       // embed this text
        signal: controller.signal,                                      // abort on timeout
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');         // read error body
        throw new Error(`Embedding request failed: HTTP ${response.status} ${errBody.slice(0, 200)}`);
      }

      const data = await response.json() as any;                       // parse JSON response

      // Extract the embedding vector.
      const embedding = data?.data?.[0]?.embedding;                    // first embedding
      if (!Array.isArray(embedding) || embedding.length === 0) {
        throw new Error('Response missing data[0].embedding array');    // bad response
      }

      // Validate dimension matches what probe discovered.
      if (this.cachedDimension !== null && embedding.length !== this.cachedDimension) {
        throw new Error(
          `Dimension mismatch: expected ${this.cachedDimension}, got ${embedding.length}` // mismatch
        );
      }

      // L2-normalize the vector for cosine similarity.
      const magnitude = Math.sqrt(embedding.reduce((sum: number, v: number) => sum + v * v, 0));
      if (magnitude > 0) {
        for (let i = 0; i < embedding.length; i++) {
          embedding[i] = embedding[i] / magnitude;                     // normalize each component
        }
      }

      return embedding as number[];                                     // return normalized vector
    } finally {
      clearTimeout(timer);                                              // clean up timeout
    }
  }

  // modelName: return the model identifier discovered during probe.
  modelName(): string {
    return this.cachedModelName ?? 'llama-cpp-unknown';                 // fallback if probe not called
  }

  // dimension: return the vector dimension discovered during probe.
  dimension(): number {
    if (this.cachedDimension === null) {
      throw new Error('LlamaCppEmbeddingProvider.dimension() called before probeCapability()');
    }
    return this.cachedDimension;                                        // e.g. 2048
  }
}

// ── Provider factory ────────────────────────────────────────────────────────
// createEmbeddingProvider: build the correct provider based on env config.
// Used by both worker and API to create the embedding provider at startup.
//
// Env vars:
//   EMBEDDING_PROVIDER=llama_cpp|dev              — which provider to use
//   LLAMA_EMBEDDINGS_URL=http://llama:8080/v1/embeddings — explicit URL (highest priority)
//   LLAMA_SERVER_URL=http://llama:8080            — base URL (derives /v1/embeddings)
//   LLAMA_URL=http://llama:8080                   — legacy base URL (lowest priority)
//   EMBEDDING_TIMEOUT_MS=30000                    — request timeout
//   EMBEDDING_ALLOW_DEV_FALLBACK=true|false       — allow fallback to dev if llama unavailable

export interface CreateEmbeddingProviderResult {
  provider: EmbeddingProvider;   // the provider instance
  isDevFallback: boolean;        // true if fell back to dev due to llama failure
}

export async function createEmbeddingProvider(env: {
  EMBEDDING_PROVIDER?: string;
  LLAMA_EMBEDDINGS_URL?: string;
  LLAMA_SERVER_URL?: string;
  LLAMA_URL?: string;
  EMBEDDING_TIMEOUT_MS?: string;
  EMBEDDING_ALLOW_DEV_FALLBACK?: string;
}): Promise<CreateEmbeddingProviderResult> {
  const providerType = (env.EMBEDDING_PROVIDER || 'dev').toLowerCase(); // default to dev

  // If explicitly set to dev, return DevEmbeddingProvider immediately.
  if (providerType === 'dev') {
    console.log('[embedding] using DevEmbeddingProvider (EMBEDDING_PROVIDER=dev)');
    return { provider: new DevEmbeddingProvider(), isDevFallback: false };
  }

  // For llama_cpp, resolve the embeddings URL.
  if (providerType === 'llama_cpp' || providerType === 'llama') {
    // URL resolution priority: LLAMA_EMBEDDINGS_URL > LLAMA_SERVER_URL > LLAMA_URL
    let embeddingsUrl = env.LLAMA_EMBEDDINGS_URL || '';               // explicit URL wins
    if (!embeddingsUrl) {
      const baseUrl = env.LLAMA_SERVER_URL || env.LLAMA_URL || '';    // derive from base
      if (baseUrl) {
        // Strip trailing slash and append /v1/embeddings.
        embeddingsUrl = baseUrl.replace(/\/+$/, '') + '/v1/embeddings';
      }
    }

    if (!embeddingsUrl) {
      const msg = 'EMBEDDING_PROVIDER=llama_cpp but no LLAMA_EMBEDDINGS_URL, LLAMA_SERVER_URL, or LLAMA_URL set';
      throw new Error(msg);                                            // fail fast
    }

    const timeoutMs = parseInt(env.EMBEDDING_TIMEOUT_MS || '30000', 10) || 30000;
    const allowDevFallback = env.EMBEDDING_ALLOW_DEV_FALLBACK === 'true';

    const llamaProvider = new LlamaCppEmbeddingProvider({ embeddingsUrl, timeoutMs });

    // Attempt capability probe.
    try {
      await llamaProvider.probeCapability();                           // test the endpoint
      console.log('[embedding] using LlamaCppEmbeddingProvider');
      return { provider: llamaProvider, isDevFallback: false };
    } catch (probeErr: any) {
      console.error(`[embedding] llama.cpp probe failed: ${probeErr?.message}`);

      // Only fall back to dev if explicitly allowed.
      if (allowDevFallback) {
        console.warn('[embedding] falling back to DevEmbeddingProvider (EMBEDDING_ALLOW_DEV_FALLBACK=true)');
        return { provider: new DevEmbeddingProvider(), isDevFallback: true };
      }

      // Otherwise fail clearly.
      throw new Error(
        `EMBEDDING_PROVIDER=llama_cpp but embeddings endpoint unreachable at ${embeddingsUrl}. ` +
        `Set EMBEDDING_ALLOW_DEV_FALLBACK=true to allow dev fallback. ` +
        `Probe error: ${probeErr?.message}`
      );
    }
  }

  // Unknown provider type.
  throw new Error(`Unknown EMBEDDING_PROVIDER: "${providerType}". Valid values: llama_cpp, dev`);
}
