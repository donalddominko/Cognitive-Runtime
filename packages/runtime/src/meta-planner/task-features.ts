// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/runtime/src/meta-planner/task-features.ts
// Phase 6: Deterministic task feature extraction from user message + constraints.
// No LLM calls. No free-form parsing. Only typed, bounded features.

import { createHash } from 'crypto';
import type { PlannerTaskFeatures, PlannerConstraintSet } from '@cognitive-runtime/contracts';

// ── Keyword lists for deterministic classification ──────────────────────────
const CODE_KEYWORDS = ['code', 'function', 'class', 'implement', 'refactor', 'debug', 'fix', 'bug', 'script', 'typescript', 'javascript', 'python', 'sql', 'api'];
const RESEARCH_KEYWORDS = ['research', 'explain', 'compare', 'analyze', 'best practice', 'recommend', 'pros and cons', 'differences'];
const INFRA_KEYWORDS = ['docker', 'nginx', 'deploy', 'kubernetes', 'ci/cd', 'pipeline', 'server', 'infrastructure'];
const DB_KEYWORDS = ['database', 'schema', 'migration', 'query', 'postgres', 'sql', 'table', 'index'];
const FRONTEND_KEYWORDS = ['react', 'css', 'html', 'component', 'ui', 'frontend', 'vite', 'tailwind'];

// hasAnyKeyword: check if message contains any keyword from list (case-insensitive).
function hasAnyKeyword(message: string, keywords: string[]): boolean {
  const lower = message.toLowerCase();                 // normalize to lowercase
  return keywords.some(kw => lower.includes(kw));      // check each keyword
}

// determineDomain: classify domain from message content.
function determineDomain(message: string): string | undefined {
  if (hasAnyKeyword(message, INFRA_KEYWORDS)) return 'infra';       // infrastructure domain
  if (hasAnyKeyword(message, DB_KEYWORDS)) return 'database';       // database domain
  if (hasAnyKeyword(message, FRONTEND_KEYWORDS)) return 'frontend'; // frontend domain
  if (hasAnyKeyword(message, CODE_KEYWORDS)) return 'backend';      // backend domain
  return undefined;                                                   // unclassified
}

// extractSkillTags: deterministic skill tag extraction from message.
function extractSkillTags(message: string): string[] {
  const tags: string[] = [];                                          // accumulate tags
  const lower = message.toLowerCase();                                // normalize
  if (hasAnyKeyword(lower, CODE_KEYWORDS)) tags.push('code');        // code skill
  if (hasAnyKeyword(lower, RESEARCH_KEYWORDS)) tags.push('research');// research skill
  if (hasAnyKeyword(lower, INFRA_KEYWORDS)) tags.push('infra');      // infra skill
  if (hasAnyKeyword(lower, DB_KEYWORDS)) tags.push('data');          // data skill
  if (hasAnyKeyword(lower, FRONTEND_KEYWORDS)) tags.push('frontend');// frontend skill
  if (tags.length === 0) tags.push('general');                        // fallback tag
  return tags.sort();                                                  // deterministic order
}

// determineRiskLevel: classify risk from constraints and message.
function determineRiskLevel(message: string, constraints?: PlannerConstraintSet): 'low' | 'medium' | 'high' {
  if (constraints?.regulated_domain) return 'high';                   // regulated = high risk
  if (constraints?.require_security_review) return 'high';            // security review = high risk
  const lower = message.toLowerCase();                                // normalize
  if (lower.includes('production') || lower.includes('security') || lower.includes('secret')) return 'high';
  if (lower.includes('test') || lower.includes('draft')) return 'low';// test/draft = low
  return 'medium';                                                     // default medium
}

// ── Main export ─────────────────────────────────────────────────────────────
// extractTaskFeatures: pure, deterministic feature extraction.
// Same message + constraints always produce the same features.
export function extractTaskFeatures(
  userMessage: string,
  constraints?: PlannerConstraintSet,
): PlannerTaskFeatures {
  const message = (userMessage || '').trim();                         // normalize whitespace
  return {
    task_type:            'chat',                                     // v1: always chat
    domain:               determineDomain(message),                   // classify domain
    skill_tags:           extractSkillTags(message),                  // extract skill tags
    risk_level:           determineRiskLevel(message, constraints),   // classify risk
    requires_tools:       false,                                      // v1: no tool use
    requires_research:    hasAnyKeyword(message, RESEARCH_KEYWORDS) || constraints?.require_research === true,
    requires_code:        hasAnyKeyword(message, CODE_KEYWORDS),     // code generation needed
    requires_persistence: true,                                       // always persist messages
    conversation_turn_index: undefined,                               // not tracked in v1
  };
}

// fingerprintFeatures: deterministic hash of features for dedup/audit.
export function fingerprintFeatures(features: PlannerTaskFeatures): string {
  const canonical = JSON.stringify(features, Object.keys(features).sort()); // stable key order
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 16); // 16-char hex
}

// fingerprintConstraints: deterministic hash of constraints for audit.
export function fingerprintConstraints(constraints: PlannerConstraintSet): string {
  const canonical = JSON.stringify(constraints, Object.keys(constraints).sort()); // stable key order
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 16); // 16-char hex
}

// fingerprintDag: deterministic hash of DAG structure + key parameters.
// Captures node IDs, kinds, and dependency edges for replay/audit comparison.
// Same DAG structure always produces the same fingerprint.
export function fingerprintDag(dag: { nodes: Array<{ id: string; kind: string; depends_on?: string[] }> }): string {
  // Build a canonical representation: sorted nodes with sorted dependencies.
  const canonical = dag.nodes
    .map(n => `${n.id}:${n.kind}:[${(n.depends_on ?? []).slice().sort().join(',')}]`) // node descriptor
    .sort()                                                                              // deterministic node order
    .join('|');                                                                           // join all nodes
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 16);     // 16-char hex fingerprint
}
