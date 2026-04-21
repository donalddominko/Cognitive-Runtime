// Cognitive Runtime © 2026 by Donald Dominko
// Licensed under CC BY-NC-SA 4.0
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/runtime/src/agent-registry.ts
// Static registry of known agents. Phase 4 v0: single entry for the local Qwen model.
// Future phases can add remote agents, scoring overrides, or capability tags here.

// Describes a single registered agent entry.
export type AgentEntry = {
  agentId:  string; // stable identifier used in reward events (e.g. 'qwen-local')
  provider: string; // LLM provider slug (matches ctx.provider in dag-executor)
  model:    string; // LLM model slug (matches ctx.model in dag-executor)
};

// AGENT_REGISTRY maps agentId → entry. Keyed by agentId for O(1) lookup.
// This is the single source of truth for agent metadata used by the reward agent.
export const AGENT_REGISTRY: Record<string, AgentEntry> = {
  // 'qwen-local': the llama.cpp Qwen 2.5 Coder 3B instance running at LLAMA_URL.
  'qwen-local': {
    agentId:  'qwen-local',          // stable ID referenced in REWARD_COMPUTED + TRUST_UPDATED events
    provider: 'qwen',                // provider slug used in DAG context
    model:    'qwen-2.5-coder-3b',   // model slug used in DAG context
  },
};
