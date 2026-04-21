#!/usr/bin/env bash
# Cognitive Runtime © 2026 by Donald Dominko
# Licensed under CC BY-NC-SA 4.0
# Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

# scripts/smoke-phase7-codeflow.sh
# Phase 7 smoke: Code-change workflow contracts and artifact endpoints.
# Tests that code-artifacts endpoint is accessible and returns valid structure.

set -euo pipefail

API="${API_URL:-http://localhost:3001}"
PASS=0; FAIL=0
pass() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
fail() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }
check() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (got='$2' expected='$3')"; fi; }

echo "═══════════════════════════════════════════════════"
echo " Phase 7 Smoke: Code-Change Workflow"
echo "═══════════════════════════════════════════════════"

# Verify code-change is disabled by default.
echo ""
echo "── 1) Config check ──"
CFG=$(curl -sf "$API/phase7/config" || echo '{}')
CODE_ENABLED=$(echo "$CFG" | python3 -c "import sys,json; print(json.load(sys.stdin).get('enable_code_change_workflow', 'MISSING'))" 2>/dev/null || echo "ERROR")
check "code_change disabled by default" "$CODE_ENABLED" "False"

# Create a run and verify code-artifacts endpoint.
echo ""
echo "── 2) Code-artifacts endpoint on standard run ──"
CHAT=$(curl -sf -X POST "$API/chats" -H 'Content-Type: application/json' -d '{"title":"codeflow-smoke"}')
CHAT_ID=$(echo "$CHAT" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -z "$CHAT_ID" ]; then fail "create chat"; exit 1; fi

RUN=$(curl -sf -X POST "$API/runs" -H 'Content-Type: application/json' \
  -d "{\"chat_id\":\"$CHAT_ID\",\"message\":\"Hello standard run\",\"execute\":true}")
RUN_ID=$(echo "$RUN" | grep -o '"run_id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -z "$RUN_ID" ]; then fail "create run"; exit 1; fi
pass "run created"

for i in $(seq 1 60); do
  STATUS=$(curl -sf "$API/runs/$RUN_ID/status" | grep -o '"status":"[^"]*"' | cut -d'"' -f4 || echo "UNKNOWN")
  if [ "$STATUS" = "SUCCEEDED" ] || [ "$STATUS" = "FAILED" ]; then break; fi
  sleep 1
done
check "run completed" "$(echo "$STATUS" | grep -cE 'SUCCEEDED|FAILED')" "1"

ARTIFACTS=$(curl -sf "$API/runs/$RUN_ID/code-artifacts" || echo '{}')
HAS_ARTIFACTS=$(echo "$ARTIFACTS" | grep -c '"code_artifacts"' || true)
check "code-artifacts endpoint returns array" "$HAS_ARTIFACTS" "1"
ARTIFACT_COUNT=$(echo "$ARTIFACTS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('total', -1))" 2>/dev/null || echo "-1")
check "standard run has 0 code artifacts" "$ARTIFACT_COUNT" "0"

# Verify 6 new NodeKinds are in contracts (compile-time verified, but sanity check events endpoint).
echo ""
echo "── 3) Event schema accepts Phase 7 types ──"
EVENTS=$(curl -sf "$API/runs/$RUN_ID/events" || echo '{}')
EVENT_COUNT=$(echo "$EVENTS" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('events', [])))" 2>/dev/null || echo "0")
check "events endpoint returns valid data" "$([ "$EVENT_COUNT" -gt 0 ] && echo 'yes' || echo 'no')" "yes"

echo ""
echo "═══════════════════════════════════════════════════"
echo " Code-Flow Smoke Results: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════════════════"
if [ "$FAIL" -gt 0 ]; then exit 1; fi
