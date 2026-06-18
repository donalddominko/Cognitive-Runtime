// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/runtime/src/index.ts
// Barrel export for the @cognitive-runtime/runtime package.
// Phase 4: adds 3 new exports for the reward agent subsystem.
// Phase 5: adds memory module export.
// Phase 6: adds meta-planner module export.
// Phase 7: adds lifecycle, policy-gate, code-change exports.

export * from './engine.js';               // execution engine utilities
export * from './eventBus.js';             // in-process event bus
export * from './dag-executor.js';         // executeDag, planDagForRun, EventLogLike
export * from './derive-dag-run-state.js'; // deriveDagRunState
// Phase 4 additions
export * from './agent-registry.js';       // AGENT_REGISTRY, AgentEntry
export * from './reward-agent.js';         // computeReward, RewardInput, RewardOutput
export * from './derive-agent-trust.js';   // deriveAgentTrust, TrustUpdateResult, ExistingTrust
// Phase 5 addition
export * from './memory/index.js';         // Memory services, types, embedding provider
// Phase 6 addition
export * from './meta-planner/index.js';   // MetaPlanner, config, scoring, evaluation
// Phase 7 additions
export * from './lifecycle.js';            // createPhase7Config, isRunCancelled, isRunTimedOut, etc.
export * from './policy-gate.js';          // evaluatePolicy, classifyDagType, PolicyEvalResult
export * from './code-change.js';          // planCodeChangeDag, isCodeChangeTask, createSandboxId
