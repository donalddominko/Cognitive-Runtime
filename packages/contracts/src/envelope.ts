// Cognitive Runtime © 2026 by Donald Dominko
// Licensed under CC BY-NC-SA 4.0
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/contracts/src/envelope.ts
// GlobalEnvelope schema — wraps all runtime events and outputs with tracing metadata.
// Every cross-layer message carries a run_id, trace_id, layer, schema_version, and timestamp.
// Exports: zGlobalEnvelope, GlobalEnvelope, GlobalEnvelopeSchema (legacy alias), createEnvelope

import { z } from 'zod';
import { zSchemaVersion, zUUID, zLayer, zISODateString, SCHEMA_VERSION } from './common.js';

/**
 * GlobalEnvelope wraps all runtime events and outputs
 * Provides traceability across layers
 */
export const zGlobalEnvelope = z.object({
  run_id: zUUID,
  trace_id: zUUID,
  layer: zLayer,
  schema_version: zSchemaVersion,
  created_at: zISODateString,
  payload: z.unknown(),
});

export type GlobalEnvelope = z.infer<typeof zGlobalEnvelope>;

// Legacy export for backwards compatibility
export const GlobalEnvelopeSchema = zGlobalEnvelope;

/**
 * Helper to create a GlobalEnvelope
 */
export function createEnvelope(
  runId: string,
  traceId: string,
  layer: z.infer<typeof zLayer>,
  payload: unknown
): GlobalEnvelope {
  return {
    run_id: runId,
    trace_id: traceId,
    layer,
    schema_version: SCHEMA_VERSION,
    created_at: new Date().toISOString(),
    payload,
  };
}
