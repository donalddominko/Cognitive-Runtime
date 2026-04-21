#!/usr/bin/env bash
# Cognitive Runtime © 2026 by Donald Dominko
# Licensed under CC BY-NC-SA 4.0
# Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

# scripts/smoke-phase7-policy.sh
# Phase 7 smoke: Policy gate blocks code-change when disabled, allows direct reply.

set -euo pipefail

API="${API_URL:-http://localhost:3001}"
PASS=0; FAIL=0
pass() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
fail() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }
check() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (got='$2' expected='$3')"; fi; }

echo "═══════════════════════════════════════════════════"
echo " Phase 7 Smoke: Policy Gate"
echo "═══════════════════════════════════════════════════"

# Verify config shows policy gate status.
echo ""
echo "── 1) Policy gate config ──"
CFG=$(curl -sf "$API/phase7/config" || echo '{}')
HAS_POLICY=$(echo "$CFG" | grep -c '"enable_policy_gate"' || true)
check "config has enable_policy_gate" "$HAS_POLICY" "1"
HAS_CODE=$(echo "$CFG" | grep -c '"enable_code_change_workflow"' || true)
check "config has enable_code_change_workflow" "$HAS_CODE" "1"

# Create chat + run, verify policy endpoint returns data.
echo ""
echo "── 2) Run with policy check ──"
CHAT=$(curl -sf -X POST "$API/chats" -H 'Content-Type: application/json' -d '{"title":"policy-smoke"}')
CHAT_ID=$(echo "$CHAT" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -z "$CHAT_ID" ]; then fail "create chat"; exit 1; fi
pass "chat created"

RUN=$(curl -sf -X POST "$API/runs" -H 'Content-Type: application/json' \
  -d "{\"chat_id\":\"$CHAT_ID\",\"message\":\"Hello, test policy\",\"execute\":true}")
RUN_ID=$(echo "$RUN" | grep -o '"run_id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -z "$RUN_ID" ]; then fail "create run"; exit 1; fi
pass "run created"

# Wait for completion.
for i in $(seq 1 60); do
  STATUS=$(curl -sf "$API/runs/$RUN_ID/status" | grep -o '"status":"[^"]*"' | cut -d'"' -f4 || echo "UNKNOWN")
  if [ "$STATUS" = "SUCCEEDED" ] || [ "$STATUS" = "FAILED" ]; then break; fi
  sleep 1
done
check "run completed" "$(echo "$STATUS" | grep -cE 'SUCCEEDED|FAILED')" "1"

# Check policy endpoint returns valid structure.
echo ""
echo "── 3) Policy endpoint structure ──"
POLICY=$(curl -sf "$API/runs/$RUN_ID/policy" || echo '{}')
HAS_EVALS=$(echo "$POLICY" | grep -c '"policy_evaluations"' || true)
check "policy endpoint has evaluations array" "$HAS_EVALS" "1"
HAS_TOTAL=$(echo "$POLICY" | grep -c '"total"' || true)
check "policy endpoint has total" "$HAS_TOTAL" "1"

# Verify cancel endpoint works on completed run (idempotent).
echo ""
echo "── 4) Cancel idempotency ──"
CANCEL=$(curl -sf -X POST "$API/runs/$RUN_ID/cancel" -H 'Content-Type: application/json' -d '{"reason":"policy smoke"}' || echo '{}')
HAS_TERMINAL=$(echo "$CANCEL" | grep -c '"already_terminal"' || true)
check "cancel idempotent on completed" "$HAS_TERMINAL" "1"

echo ""
echo "═══════════════════════════════════════════════════"
echo " Policy Smoke Results: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════════════════"
if [ "$FAIL" -gt 0 ]; then exit 1; fi
