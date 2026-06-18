// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/contracts/src/index.ts
// Barrel export for the @cognitive-runtime/contracts package.
// Phase 4: adds reward.ts export. Phase 5: adds memory.ts export.
// Phase 6: adds meta-planner.ts export. Phase 7: adds phase7.ts export.
// All existing exports are unchanged.

export * from './common.js';        // shared primitives: UUID, ISODate, Layer, Role
export * from './envelope.js';      // GlobalEnvelope transport type
export { RUN_EVENT_TYPES, RUN_EVENT_TYPE_VALUES, RUN_EVENT_TYPE_SET } from './event-types.js'; // event type constants
export * from './events.js';        // RunEvent union, data schemas, createRunEvent helper
export * from './api-dtos.js';      // request/response DTOs for the Fastify API
export * from './dag.js';           // DAG spec, node kinds, run/node status enums
export * from './reward.js';        // Phase 4: RewardSignals, RoutingDecision, 4 event data types
export * from './memory.js';        // Phase 5: M1-M3 memory layers (+ M0 transient tier) schemas, memory DTOs, 6 event data types
export * from './meta-planner.js';  // Phase 6: Meta-Planner schemas, 8 event data types
export * from './phase7.js';        // Phase 7: Phase7Config, policy, code-change, 15 event data types
