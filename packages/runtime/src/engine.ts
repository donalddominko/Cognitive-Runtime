// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/runtime/src/engine.ts
// Core interface definitions for the runtime engine and event bus abstractions.
// These interfaces decouple the execution pipeline from concrete I/O implementations,
// enabling the DAG executor to be tested with in-memory stubs.
// Exports: RuntimeEngine, RuntimeConfig, EventBus

import type { RunEvent } from '@cognitive-runtime/contracts'

/** Top-level interface for a runtime that can execute a user message within a chat session. */
export interface RuntimeEngine {
  run(chatId: string, userMessage: string): Promise<string>
}

/** Configuration required to construct a RuntimeEngine instance. */
export interface RuntimeConfig {
  eventBus: EventBus
}

/**
 * Async event bus abstraction used by the executor to fan out RunEvents to subscribers.
 * The concrete implementation (InMemoryEventBus) is in eventBus.ts.
 */
export interface EventBus {
  publish(event: RunEvent): Promise<void>
}
