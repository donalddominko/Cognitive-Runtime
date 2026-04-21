#!/usr/bin/env bash
# Cognitive Runtime © 2026 by Donald Dominko
# Licensed under CC BY-NC-SA 4.0
# Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

# scripts/smoke-phase7-lifecycle.sh
# Phase 7 smoke test: lifecycle, cancel, timeout, stale, policy, code-artifacts, failed runs.
# Tests Phase 7 API endpoints and verifies contract compliance.

set -euo pipefail

API="${API_URL:-http://localhost:3001}"
PASS=0
FAIL=0

pass() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
fail() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }
check() {
  local desc="$1" actual="$2" expected="$3"
  if [ "$actual" = "$expected" ]; then pass "$desc"; else fail "$desc (got='$actual' expected='$expected')"; fi
}

echo "═══════════════════════════════════════════════════"
echo " Phase 7 Smoke: Lifecycle + Hardening Endpoints"
echo "═══════════════════════════════════════════════════"

# ── 1) Phase 7 config endpoint ───────────────────────────────────────────
echo ""
echo "── 1) GET /phase7/config ──"
CFG=$(curl -sf "$API/phase7/config" || echo '{}')
HAS_TIMEOUT=$(echo "$CFG" | grep -c '"run_timeout_ms"' || true)
check "phase7/config returns run_timeout_ms" "$HAS_TIMEOUT" "1"
HAS_STALE=$(echo "$CFG" | grep -c '"stale_heartbeat_ms"' || true)
check "phase7/config returns stale_heartbeat_ms" "$HAS_STALE" "1"

# ── 2) Create a chat for testing ─────────────────────────────────────────
echo ""
echo "── 2) Create test chat ──"
CHAT=$(curl -sf -X POST "$API/chats" -H 'Content-Type: application/json' -d '{"title":"phase7-smoke"}')
CHAT_ID=$(echo "$CHAT" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -z "$CHAT_ID" ]; then fail "create chat"; echo "ABORT"; exit 1; fi
pass "chat created: $CHAT_ID"

# ── 3) Create and execute a run ──────────────────────────────────────────
echo ""
echo "── 3) Create + execute run ──"
RUN=$(curl -sf -X POST "$API/runs" -H 'Content-Type: application/json' \
  -d "{\"chat_id\":\"$CHAT_ID\",\"message\":\"Phase 7 lifecycle test\",\"execute\":true}")
RUN_ID=$(echo "$RUN" | grep -o '"run_id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -z "$RUN_ID" ]; then fail "create run"; echo "ABORT"; exit 1; fi
pass "run created: $RUN_ID"

# Wait for run to complete (max 90s).
echo "  ⏳ waiting for run to complete..."
for i in $(seq 1 90); do
  STATUS=$(curl -sf "$API/runs/$RUN_ID/status" | grep -o '"status":"[^"]*"' | cut -d'"' -f4 || echo "UNKNOWN")
  if [ "$STATUS" = "SUCCEEDED" ] || [ "$STATUS" = "FAILED" ]; then break; fi
  sleep 1
done
echo "  run status: $STATUS"
check "run reached terminal status" "$(echo "$STATUS" | grep -cE 'SUCCEEDED|FAILED')" "1"

# ── 4) GET /runs/:runId/lifecycle ────────────────────────────────────────
echo ""
echo "── 4) GET /runs/:runId/lifecycle ──"
LIFECYCLE=$(curl -sf "$API/runs/$RUN_ID/lifecycle" || echo '{}')
HAS_CREATED=$(echo "$LIFECYCLE" | grep -c '"created_at"' || true)
check "lifecycle has created_at" "$HAS_CREATED" "1"
HAS_STATUS=$(echo "$LIFECYCLE" | grep -c '"status"' || true)
check "lifecycle has status" "$HAS_STATUS" "1"
HAS_HB=$(echo "$LIFECYCLE" | grep -c '"heartbeat_count"' || true)
check "lifecycle has heartbeat_count" "$HAS_HB" "1"
HAS_TRANSITIONS=$(echo "$LIFECYCLE" | grep -c '"status_transitions"' || true)
check "lifecycle has status_transitions" "$HAS_TRANSITIONS" "1"

# ── 5) GET /runs/:runId/planner-loops ────────────────────────────────────
echo ""
echo "── 5) GET /runs/:runId/planner-loops ──"
LOOPS=$(curl -sf "$API/runs/$RUN_ID/planner-loops" || echo '{}')
HAS_DECISIONS=$(echo "$LOOPS" | grep -c '"total_planner_decisions"' || true)
check "planner-loops has total_planner_decisions" "$HAS_DECISIONS" "1"

# ── 6) GET /runs/:runId/policy ───────────────────────────────────────────
echo ""
echo "── 6) GET /runs/:runId/policy ──"
POLICY=$(curl -sf "$API/runs/$RUN_ID/policy" || echo '{}')
HAS_TOTAL=$(echo "$POLICY" | grep -c '"total"' || true)
check "policy has total field" "$HAS_TOTAL" "1"

# ── 7) GET /runs/:runId/code-artifacts ───────────────────────────────────
echo ""
echo "── 7) GET /runs/:runId/code-artifacts ──"
ARTIFACTS=$(curl -sf "$API/runs/$RUN_ID/code-artifacts" || echo '{}')
HAS_ARTIFACTS=$(echo "$ARTIFACTS" | grep -c '"code_artifacts"' || true)
check "code-artifacts has code_artifacts field" "$HAS_ARTIFACTS" "1"

# ── 8) GET /runs/stale ──────────────────────────────────────────────────
echo ""
echo "── 8) GET /runs/stale ──"
STALE=$(curl -sf "$API/runs/stale" || echo '{}')
HAS_STALE_RUNS=$(echo "$STALE" | grep -c '"stale_runs"' || true)
check "stale endpoint has stale_runs field" "$HAS_STALE_RUNS" "1"

# ── 9) GET /runs/failed ─────────────────────────────────────────────────
echo ""
echo "── 9) GET /runs/failed ──"
FAILED=$(curl -sf "$API/runs/failed" || echo '{}')
HAS_FAILED_RUNS=$(echo "$FAILED" | grep -c '"failed_runs"' || true)
check "failed endpoint has failed_runs field" "$HAS_FAILED_RUNS" "1"

# ── 10) POST /runs/:runId/cancel (idempotent on completed run) ──────────
echo ""
echo "── 10) POST /runs/:runId/cancel (already completed) ──"
CANCEL=$(curl -sf -X POST "$API/runs/$RUN_ID/cancel" -H 'Content-Type: application/json' -d '{"reason":"smoke test cancel"}' || echo '{}')
HAS_TERMINAL=$(echo "$CANCEL" | grep -c '"already_terminal"' || true)
check "cancel on completed run returns already_terminal" "$HAS_TERMINAL" "1"

# ── 11) Duplicate terminal event prevention ──────────────────────────────
echo ""
echo "── 11) Duplicate terminal event check ──"
EVENTS=$(curl -sf "$API/runs/$RUN_ID/events" || echo '{}')
RUN_COMPLETED_COUNT=$(echo "$EVENTS" | python3 -c "import sys,json; events=json.load(sys.stdin).get('events',[]); print(sum(1 for e in events if e.get('type')=='RUN_COMPLETED'))" 2>/dev/null || echo "0")
check "exactly 1 RUN_COMPLETED event" "$RUN_COMPLETED_COUNT" "1"

# ── 12) Previous phase regression: reward endpoint still works ───────────
echo ""
echo "── 12) Regression: GET /runs/:runId/reward ──"
REWARD=$(curl -sf "$API/runs/$RUN_ID/reward" || echo '{}')
HAS_SCORE=$(echo "$REWARD" | grep -c '"artifact_score"' || true)
check "reward endpoint still works" "$HAS_SCORE" "1"

# ── 13) Previous phase regression: dag-state still works ────────────────
echo ""
echo "── 13) Regression: GET /runs/:runId/dag-state ──"
DAG=$(curl -sf "$API/runs/$RUN_ID/dag-state" || echo '{}')
HAS_DAG=$(echo "$DAG" | grep -c '"dag_state"' || true)
check "dag-state endpoint still works" "$HAS_DAG" "1"

# ── Summary ──────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
echo " Phase 7 Smoke Results: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════════════════"
if [ "$FAIL" -gt 0 ]; then exit 1; fi
exit 0
