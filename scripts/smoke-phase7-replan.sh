#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Cognitive Runtime © 2026 Donald Dominko
# Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

# scripts/smoke-phase7-replan.sh
# Phase 7 smoke: Replanning contracts and planner-loops endpoint.

set -euo pipefail

API="${API_URL:-http://localhost:3001}"
PASS=0; FAIL=0
pass() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
fail() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }
check() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (got='$2' expected='$3')"; fi; }

echo "═══════════════════════════════════════════════════"
echo " Phase 7 Smoke: Replanning Loops"
echo "═══════════════════════════════════════════════════"

# Verify replanning disabled by default.
echo ""
echo "── 1) Config check ──"
CFG=$(curl -sf "$API/phase7/config" || echo '{}')
REPLAN_ENABLED=$(echo "$CFG" | python3 -c "import sys,json; print(json.load(sys.stdin).get('enable_replanning', 'MISSING'))" 2>/dev/null || echo "ERROR")
check "replanning disabled by default" "$REPLAN_ENABLED" "False"
MAX_LOOPS=$(echo "$CFG" | python3 -c "import sys,json; print(json.load(sys.stdin).get('max_planner_loops', -1))" 2>/dev/null || echo "-1")
check "max_planner_loops defaults to 3" "$MAX_LOOPS" "3"

# Create a run and verify planner-loops endpoint.
echo ""
echo "── 2) Planner-loops endpoint ──"
CHAT=$(curl -sf -X POST "$API/chats" -H 'Content-Type: application/json' -d '{"title":"replan-smoke"}')
CHAT_ID=$(echo "$CHAT" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -z "$CHAT_ID" ]; then fail "create chat"; exit 1; fi

RUN=$(curl -sf -X POST "$API/runs" -H 'Content-Type: application/json' \
  -d "{\"chat_id\":\"$CHAT_ID\",\"message\":\"Test replanning\",\"execute\":true}")
RUN_ID=$(echo "$RUN" | grep -o '"run_id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -z "$RUN_ID" ]; then fail "create run"; exit 1; fi
pass "run created"

for i in $(seq 1 60); do
  STATUS=$(curl -sf "$API/runs/$RUN_ID/status" | grep -o '"status":"[^"]*"' | cut -d'"' -f4 || echo "UNKNOWN")
  if [ "$STATUS" = "SUCCEEDED" ] || [ "$STATUS" = "FAILED" ]; then break; fi
  sleep 1
done
check "run completed" "$(echo "$STATUS" | grep -cE 'SUCCEEDED|FAILED')" "1"

LOOPS=$(curl -sf "$API/runs/$RUN_ID/planner-loops" || echo '{}')
HAS_DECISIONS=$(echo "$LOOPS" | grep -c '"total_planner_decisions"' || true)
check "planner-loops has total_planner_decisions" "$HAS_DECISIONS" "1"
HAS_REPLAN_REQ=$(echo "$LOOPS" | grep -c '"replan_requests"' || true)
check "planner-loops has replan_requests array" "$HAS_REPLAN_REQ" "1"
HAS_REPLAN_DEC=$(echo "$LOOPS" | grep -c '"replan_decisions"' || true)
check "planner-loops has replan_decisions array" "$HAS_REPLAN_DEC" "1"

# With replanning disabled, replan arrays should be empty.
REPLAN_COUNT=$(echo "$LOOPS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('replan_requests',[])))" 2>/dev/null || echo "-1")
check "no replan events when disabled" "$REPLAN_COUNT" "0"

# Regression: meta-planner endpoint still works.
echo ""
echo "── 3) Regression: meta-plan endpoint ──"
META=$(curl -sf "$API/runs/$RUN_ID/meta-plan" || echo '{}')
HAS_STARTED=$(echo "$META" | grep -c '"started"' || true)
check "meta-plan still returns started" "$HAS_STARTED" "1"

echo ""
echo "═══════════════════════════════════════════════════"
echo " Replan Smoke Results: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════════════════"
if [ "$FAIL" -gt 0 ]; then exit 1; fi
