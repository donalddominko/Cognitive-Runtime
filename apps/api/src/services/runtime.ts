// Cognitive Runtime © 2026 by Donald Dominko
// Licensed under CC BY-NC-SA 4.0
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// apps/api/src/services/runtime.ts
// Stub runtime service used by the /ai/chat route before the BullMQ worker pipeline.
// Emits a minimal LLM_REQUESTED → LLM_COMPLETED → RUN_COMPLETED event sequence directly
// into the EventLog (bypass of the queue) for simple synchronous completions.
// Invariant: this service does NOT invoke the real LLM; it is a placeholder event emitter.
// Exports: RuntimeService

import { createRunEvent } from '@cognitive-runtime/contracts';
import type { EventLog } from '../lib/event-log.js';

/** Stub service that emits run lifecycle events without dispatching to the worker queue. */
export class RuntimeService {
  constructor(private eventLog: EventLog) {}

  /**
   * Emit a synthetic LLM_REQUESTED → LLM_COMPLETED → RUN_COMPLETED event sequence.
   * Used by the direct /ai/chat route (non-queued path) to keep event log consistent.
   * On failure, emits RUNTIME_ERROR and re-throws.
   */
  async execute(
    runId: string,
    _traceId: string,
    chatId: string,
    message: string
  ): Promise<void> {
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));

      const llmRequestedEvent = createRunEvent(runId, chatId, 'LLM_REQUESTED', {
        type: 'LLM_REQUESTED',
        provider: 'qwen',
        model: 'qwen-2.5-coder-3b',
        prompt_tokens_est: message.length,
      });
      await this.eventLog.append(llmRequestedEvent);

      await new Promise((resolve) => setTimeout(resolve, 200));

      const llmCompletedEvent = createRunEvent(runId, chatId, 'LLM_COMPLETED', {
        type: 'LLM_COMPLETED',
        output_len: 150,
        latency_ms: 300,
      });
      await this.eventLog.append(llmCompletedEvent);

      const runCompletedEvent = createRunEvent(runId, chatId, 'RUN_COMPLETED', {
        type: 'RUN_COMPLETED',
        ok: true,
      });
      await this.eventLog.append(runCompletedEvent);
    } catch (error) {
      const errorEvent = createRunEvent(runId, chatId, 'RUNTIME_ERROR', {
        type: 'RUNTIME_ERROR',
        code: 'EXECUTION_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
        where: 'runtime.execute',
      });
      await this.eventLog.append(errorEvent);
      throw error;
    }
  }
}
