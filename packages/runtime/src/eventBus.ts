// Cognitive Runtime © 2026 by Donald Dominko
// Licensed under CC BY-NC-SA 4.0
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/runtime/src/eventBus.ts
// In-process, in-memory implementation of the EventBus interface.
// Used in development and tests when no external message broker is needed.
// Invariant: all registered handlers are called concurrently via Promise.all;
//   a handler failure will propagate to the publish() caller.
// Exports: InMemoryEventBus

import type { RunEvent } from '@cognitive-runtime/contracts'

/**
 * Simple fan-out event bus that holds handler references in memory.
 * Not persistent — events are not stored, only dispatched to current subscribers.
 */
export class InMemoryEventBus {
  private handlers: Array<(event: RunEvent) => Promise<void>> = []

  /** Register a handler that will be called for every published event. */
  subscribe(handler: (event: RunEvent) => Promise<void>): void {
    this.handlers.push(handler)
  }

  /** Fan out the event to all registered handlers concurrently. */
  async publish(event: RunEvent): Promise<void> {
    await Promise.all(this.handlers.map((h) => h(event)))
  }
}
