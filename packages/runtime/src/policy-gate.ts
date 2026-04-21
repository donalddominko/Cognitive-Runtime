// Cognitive Runtime © 2026 by Donald Dominko
// Licensed under CC BY-NC-SA 4.0
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/runtime/src/policy-gate.ts
// Phase 7: Deterministic policy gate evaluator.
// Pure function — no LLM calls, no I/O, no side effects.
// Classifies action risk and decides allowed/blocked/require_review.

import type { ActionRisk, PolicyVerdict } from '@cognitive-runtime/contracts';

// ── PolicyRule: a single deterministic rule ─────────────────────────────────
export interface PolicyRule {
  id:          string;           // unique rule identifier
  description: string;           // human-readable description
  applies:     (ctx: PolicyEvalContext) => boolean;  // does this rule apply
  risk:        ActionRisk;       // risk level if rule applies
  verdict:     PolicyVerdict;    // verdict if rule applies
}

// ── PolicyEvalContext: input for policy evaluation ──────────────────────────
export interface PolicyEvalContext {
  dagType:         string;       // e.g. 'direct_reply', 'code_change', 'research'
  nodeKinds:       string[];     // all node kinds in the DAG
  riskLevel:       string;       // from task features: 'low' | 'medium' | 'high'
  requiresCode:    boolean;      // does the DAG include code generation
  regulatedDomain: boolean;      // is this a regulated domain
}

// ── PolicyEvalResult: output of policy evaluation ───────────────────────────
export interface PolicyEvalResult {
  action:        string;         // what was evaluated
  risk_level:    ActionRisk;     // classified risk
  verdict:       PolicyVerdict;  // final decision
  rules_checked: string[];       // which rules were evaluated
  rationale:     string;         // why this verdict
  dag_type:      string;         // which DAG type triggered this
}

// ── Built-in policy rules ───────────────────────────────────────────────────
// These are deterministic, auditable, and evented.
const BUILTIN_RULES: PolicyRule[] = [
  {
    id: 'BLOCK_CODE_CHANGE_IF_DISABLED',
    description: 'Block code-change DAGs when the feature is disabled.',
    applies: (ctx) => ctx.dagType === 'code_change',
    risk: 'CRITICAL',
    verdict: 'BLOCKED',
  },
  {
    id: 'REQUIRE_REVIEW_HIGH_RISK_CODE',
    description: 'Require review for code-change in high-risk or regulated domains.',
    applies: (ctx) => ctx.dagType === 'code_change' && (ctx.riskLevel === 'high' || ctx.regulatedDomain),
    risk: 'HIGH',
    verdict: 'REQUIRE_REVIEW',
  },
  {
    id: 'ALLOW_CODE_CHANGE_LOW_RISK',
    description: 'Allow code-change for low/medium risk non-regulated domains.',
    applies: (ctx) => ctx.dagType === 'code_change' && ctx.riskLevel !== 'high' && !ctx.regulatedDomain,
    risk: 'MEDIUM',
    verdict: 'ALLOWED',
  },
  {
    id: 'ALLOW_DIRECT_REPLY',
    description: 'Direct reply DAGs are always allowed.',
    applies: (ctx) => ctx.dagType === 'direct_reply' || ctx.dagType === 'chat',
    risk: 'LOW',
    verdict: 'ALLOWED',
  },
  {
    id: 'ALLOW_RESEARCH',
    description: 'Research DAGs are always allowed.',
    applies: (ctx) => ctx.dagType === 'research',
    risk: 'LOW',
    verdict: 'ALLOWED',
  },
];

// ── classifyDagType ─────────────────────────────────────────────────────────
// Determine DAG type from node kinds.
export function classifyDagType(nodeKinds: string[]): string {
  const kinds = new Set(nodeKinds);                               // set for O(1) lookup
  // Code-change DAG has any of the Phase 7 code-change node kinds.
  if (kinds.has('CODEBASE_ANALYZE') || kinds.has('PATCH_PLAN') || kinds.has('PATCH_APPLY_SIMULATED')) {
    return 'code_change';                                         // code-change workflow
  }
  // Default: direct reply.
  return 'direct_reply';                                          // standard chat DAG
}

// ── evaluatePolicy ──────────────────────────────────────────────────────────
// Main policy evaluation function. Deterministic, pure, auditable.
// If codeChangeEnabled is false, all code-change DAGs are blocked.
export function evaluatePolicy(
  ctx: PolicyEvalContext,
  codeChangeEnabled: boolean,
): PolicyEvalResult {
  const rulesChecked: string[] = [];                              // audit: which rules ran
  let finalRisk: ActionRisk = 'LOW';                              // default risk
  let finalVerdict: PolicyVerdict = 'ALLOWED';                    // default verdict
  let rationale = 'No policy rules matched; default ALLOWED.';   // default rationale

  // Special override: if code-change is disabled globally, block it.
  if (ctx.dagType === 'code_change' && !codeChangeEnabled) {
    return {
      action: `evaluate_dag_type:${ctx.dagType}`,
      risk_level: 'CRITICAL',
      verdict: 'BLOCKED',
      rules_checked: ['BLOCK_CODE_CHANGE_IF_DISABLED'],
      rationale: 'Code-change workflow is disabled by configuration (enable_code_change_workflow=false).',
      dag_type: ctx.dagType,
    };
  }

  // Evaluate all rules in order; last matching rule wins.
  for (const rule of BUILTIN_RULES) {
    rulesChecked.push(rule.id);                                   // track that we checked it
    if (rule.applies(ctx)) {                                      // does the rule match
      finalRisk = rule.risk;                                      // update risk
      finalVerdict = rule.verdict;                                // update verdict
      rationale = `Rule ${rule.id}: ${rule.description}`;         // update rationale
      // Don't break — later rules can override (deterministic priority by order).
    }
  }

  return {
    action: `evaluate_dag_type:${ctx.dagType}`,
    risk_level: finalRisk,
    verdict: finalVerdict,
    rules_checked: rulesChecked,
    rationale,
    dag_type: ctx.dagType,
  };
}
