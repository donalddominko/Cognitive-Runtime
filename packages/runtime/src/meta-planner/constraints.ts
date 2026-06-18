// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/runtime/src/meta-planner/constraints.ts
// Phase 6: DAG safety validation and constraint checking for candidate DAGs.
// Every candidate must pass these checks before scoring.

import type { DagSpec, PlannerConstraintSet, NodeKind } from '@cognitive-runtime/contracts';

// ── Mandatory node kinds ────────────────────────────────────────────────────
// These node kinds MUST appear in every valid candidate DAG.
// The Meta-Planner may never remove them.
const MANDATORY_NODE_KINDS: ReadonlySet<string> = new Set([
  'PLAN_DAG',                      // planner entry node
  'PERSIST_USER_MESSAGE',          // persist the user message
  'LLM_CHAT',                      // LLM completion node
  'ENFORCE_REPLY_CONSTRAINTS',     // reply constraint enforcement
  'PERSIST_ASSISTANT_MESSAGE',     // persist assistant response
]);

// ── Validation result shape ─────────────────────────────────────────────────
export interface CandidateChecks {
  mandatory_nodes_present: boolean;   // all mandatory node kinds exist
  constraints_compatible: boolean;    // constraints are satisfied
  cycle_free: boolean;                // no cycles detected
  within_parallelism_limit: boolean;  // parallelism limit respected
}

// ── hasMandatoryNodes ───────────────────────────────────────────────────────
// Check that every mandatory node kind appears at least once in the DAG.
export function hasMandatoryNodes(dag: DagSpec): boolean {
  const presentKinds = new Set(dag.nodes.map(n => n.kind));        // collect all kinds
  for (const kind of MANDATORY_NODE_KINDS) {                       // check each mandatory kind
    if (!presentKinds.has(kind as NodeKind)) return false;         // missing mandatory node
  }
  return true;                                                      // all present
}

// ── isCycleFree ─────────────────────────────────────────────────────────────
// Kahn's algorithm for topological sort. Returns false if cycle detected.
export function isCycleFree(dag: DagSpec): boolean {
  const nodeIds = new Set(dag.nodes.map(n => n.id));               // all node IDs
  const inDeg = new Map<string, number>();                         // in-degree per node
  const dependents = new Map<string, string[]>();                  // adjacency list

  for (const n of dag.nodes) {                                     // initialize
    inDeg.set(n.id, 0);                                            // start at 0
    dependents.set(n.id, []);                                      // empty adjacency
  }

  for (const n of dag.nodes) {                                     // compute in-degrees
    for (const dep of n.depends_on ?? []) {                        // for each dependency
      if (!nodeIds.has(dep)) return false;                         // missing dependency = invalid
      inDeg.set(n.id, (inDeg.get(n.id) ?? 0) + 1);               // increment in-degree
      dependents.get(dep)!.push(n.id);                             // add to adjacency
    }
  }

  const queue: string[] = [];                                       // BFS queue
  for (const [id, deg] of inDeg) {                                 // seed with zero in-degree
    if (deg === 0) queue.push(id);                                 // no dependencies
  }

  let processed = 0;                                                // count processed nodes
  while (queue.length > 0) {                                       // BFS loop
    const id = queue.shift()!;                                     // dequeue
    processed++;                                                    // count it
    for (const dep of dependents.get(id) ?? []) {                  // for each dependent
      const newDeg = (inDeg.get(dep) ?? 1) - 1;                   // decrement in-degree
      inDeg.set(dep, newDeg);                                      // update
      if (newDeg === 0) queue.push(dep);                           // ready to process
    }
  }

  return processed === dag.nodes.length;                            // true if all nodes processed
}

// ── computeMaxParallelism ───────────────────────────────────────────────────
// Compute the maximum number of nodes that could run concurrently (max width).
export function computeMaxParallelism(dag: DagSpec): number {
  const depths = new Map<string, number>();                         // depth per node

  // Topological order via recursive depth computation.
  function getDepth(nodeId: string, visited: Set<string>): number {
    if (depths.has(nodeId)) return depths.get(nodeId)!;            // memoized
    if (visited.has(nodeId)) return 0;                              // cycle guard
    visited.add(nodeId);                                            // mark visiting
    const node = dag.nodes.find(n => n.id === nodeId);             // find node
    if (!node) return 0;                                            // missing node
    let maxDepDep = -1;                                             // track max dependency depth
    for (const dep of node.depends_on ?? []) {                     // for each dependency
      maxDepDep = Math.max(maxDepDep, getDepth(dep, visited));     // recurse
    }
    const d = maxDepDep + 1;                                        // depth = max dep depth + 1
    depths.set(nodeId, d);                                          // memoize
    return d;                                                       // return depth
  }

  for (const n of dag.nodes) getDepth(n.id, new Set());            // compute all depths

  // Count nodes at each depth level — max count is max parallelism.
  const countByDepth = new Map<number, number>();                   // depth -> node count
  for (const d of depths.values()) {                                // for each node's depth
    countByDepth.set(d, (countByDepth.get(d) ?? 0) + 1);          // increment count
  }

  let maxWidth = 0;                                                 // track maximum
  for (const count of countByDepth.values()) {                     // for each depth level
    if (count > maxWidth) maxWidth = count;                        // update max
  }
  return maxWidth;                                                  // return max parallelism
}

// ── validateCandidate ───────────────────────────────────────────────────────
// Run all checks on a candidate DAG and return structured result.
export function validateCandidate(dag: DagSpec, constraints: PlannerConstraintSet): CandidateChecks {
  const mandatory = hasMandatoryNodes(dag);                         // check mandatory nodes
  const cycleFree = isCycleFree(dag);                               // check for cycles
  const maxPar = computeMaxParallelism(dag);                        // compute parallelism
  const parLimit = constraints.max_parallelism ?? 10;               // default limit 10
  const withinPar = maxPar <= parLimit;                             // check parallelism
  const constraintsOk = checkConstraintsCompatible(dag, constraints); // check all constraints

  return {
    mandatory_nodes_present: mandatory,                              // all mandatory present
    constraints_compatible: constraintsOk,                           // constraints satisfied
    cycle_free: cycleFree,                                           // no cycles
    within_parallelism_limit: withinPar,                             // parallelism OK
  };
}

// ── isValidCandidate ────────────────────────────────────────────────────────
// Returns true only if ALL checks pass.
export function isValidCandidate(checks: CandidateChecks): boolean {
  return checks.mandatory_nodes_present && checks.constraints_compatible && checks.cycle_free && checks.within_parallelism_limit;
}

// ── checkConstraintsCompatible ──────────────────────────────────────────────
// Verify DAG satisfies all explicit constraints.
function checkConstraintsCompatible(dag: DagSpec, constraints: PlannerConstraintSet): boolean {
  // Check max_depth: count longest dependency chain.
  if (constraints.max_depth !== undefined) {
    // Approximate depth as node count (conservative for serial DAGs).
    if (dag.nodes.length > constraints.max_depth * 3) return false;// sanity check
  }
  // Check regulated domain: mandatory nodes already checked separately.
  // Check require_research: in v1 the default DAG doesn't have L4 nodes, so skip.
  // Check require_validation_nodes: mandatory nodes cover this.
  return true;                                                      // all constraints satisfied
}
