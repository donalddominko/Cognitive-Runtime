#!/usr/bin/env bash
# Cognitive Runtime © 2026 by Donald Dominko
# Licensed under CC BY-NC-SA 4.0
# Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

# scripts/smoke-memory.sh
# Phase 5 smoke test: verifies Memory Plane v1 (M1/M2/M3) end-to-end.
# Prereqs: API, worker, Postgres, Redis, Qdrant, and llama must be running.

set -euo pipefail

API="${API_URL:-http://localhost:3001}"
PASS=0
FAIL=0
TOTAL=0

pass() { PASS=$((PASS + 1)); TOTAL=$((TOTAL + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); TOTAL=$((TOTAL + 1)); echo "  ❌ $1"; }

echo "═══════════════════════════════════════════════"
echo "  Phase 5 — Memory Plane v1 Smoke Test"
echo "═══════════════════════════════════════════════"

# ── Step 1: Create a chat ───────────────────────────────────────────────────
echo ""
echo "── Step 1: Create chat ──"
CHAT=$(curl -sf -X POST "$API/chats" \
  -H 'Content-Type: application/json' \
  -d '{"title":"smoke-memory-test"}')
CHAT_ID=$(echo "$CHAT" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$CHAT_ID" ]; then
  fail "Failed to create chat"
  echo "Response: $CHAT"
  echo "═══════════════════════════════════════════════"
  echo "  RESULT: $PASS/$TOTAL passed, $FAIL failed"
  exit 1
fi
pass "Chat created: $CHAT_ID"

# ── Step 2: Create and execute a run ─────────────────────────────────────────
echo ""
echo "── Step 2: Create and execute run ──"
RUN=$(curl -sf -X POST "$API/runs" \
  -H 'Content-Type: application/json' \
  -d "{\"chat_id\":\"$CHAT_ID\",\"message\":\"What is memory in cognitive systems?\",\"execute\":true}")
RUN_ID=$(echo "$RUN" | grep -o '"run_id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$RUN_ID" ]; then
  fail "Failed to create run"
  echo "Response: $RUN"
  echo "═══════════════════════════════════════════════"
  echo "  RESULT: $PASS/$TOTAL passed, $FAIL failed"
  exit 1
fi
pass "Run created: $RUN_ID"

# ── Step 3: Wait for completion ──────────────────────────────────────────────
echo ""
echo "── Step 3: Wait for run completion ──"
MAX_WAIT=120
WAITED=0
STATUS="QUEUED"

while [ "$STATUS" != "SUCCEEDED" ] && [ "$STATUS" != "FAILED" ] && [ "$WAITED" -lt "$MAX_WAIT" ]; do
  sleep 3
  WAITED=$((WAITED + 3))
  STATUS_RESP=$(curl -sf "$API/runs/$RUN_ID/status" || echo '{}')
  STATUS=$(echo "$STATUS_RESP" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "UNKNOWN")
  echo "    ... status=$STATUS (${WAITED}s)"
done

if [ "$STATUS" = "SUCCEEDED" ] || [ "$STATUS" = "FAILED" ]; then
  pass "Run completed: status=$STATUS (${WAITED}s)"
else
  fail "Run did not complete within ${MAX_WAIT}s (status=$STATUS)"
  echo "═══════════════════════════════════════════════"
  echo "  RESULT: $PASS/$TOTAL passed, $FAIL failed"
  exit 1
fi

# ── Step 4: Verify M1 summary episode exists ────────────────────────────────
echo ""
echo "── Step 4: Check M1 summary episode ──"
sleep 2
EPISODES=$(curl -sf "$API/memory/episodes?runId=$RUN_ID" || echo '{}')
EP_COUNT=$(echo "$EPISODES" | grep -o '"total":[0-9]*' | head -1 | cut -d: -f2 || echo "0")

if [ -n "$EP_COUNT" ] && [ "$EP_COUNT" -ge 1 ] 2>/dev/null; then
  pass "M1 episode found for run (count=$EP_COUNT)"
else
  fail "No M1 episode found for run_id=$RUN_ID"
  echo "Response: $EPISODES"
fi

# ── Step 5: Call /memory/episodes and confirm M1 record ──────────────────────
echo ""
echo "── Step 5: Verify /memory/episodes endpoint ──"
ALL_EPISODES=$(curl -sf "$API/memory/episodes?chatId=$CHAT_ID" || echo '{}')
ALL_EP_COUNT=$(echo "$ALL_EPISODES" | grep -o '"total":[0-9]*' | head -1 | cut -d: -f2 || echo "0")

if [ -n "$ALL_EP_COUNT" ] && [ "$ALL_EP_COUNT" -ge 1 ] 2>/dev/null; then
  pass "/memory/episodes returns M1 records (count=$ALL_EP_COUNT)"
else
  fail "/memory/episodes returned no records for chat_id=$CHAT_ID"
fi

# ── Step 6: Save DAG as M3 procedure ────────────────────────────────────────
echo ""
echo "── Step 6: Save DAG as M3 procedure ──"
SAVE_RESP=$(curl -sf -X POST "$API/memory/procedures/save-dag" \
  -H 'Content-Type: application/json' \
  -d "{\"run_id\":\"$RUN_ID\",\"name\":\"smoke-test-procedure\",\"description\":\"Procedure saved from smoke test run\",\"tags\":[\"smoke\",\"test\"]}" || echo '{}')
PROC_ID=$(echo "$SAVE_RESP" | grep -o '"procedure_id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
SAVE_OK=$(echo "$SAVE_RESP" | grep -o '"ok":true' || echo "")

if [ -n "$PROC_ID" ] && [ -n "$SAVE_OK" ]; then
  pass "DAG saved as M3 procedure: $PROC_ID"
else
  fail "Failed to save DAG as M3 procedure"
  echo "Response: $SAVE_RESP"
fi

# ── Step 7: Query /memory/procedures and confirm ────────────────────────────
echo ""
echo "── Step 7: Verify /memory/procedures endpoint ──"
PROCS=$(curl -sf "$API/memory/procedures?query=smoke" || echo '{}')
PROC_COUNT=$(echo "$PROCS" | grep -o '"total":[0-9]*' | head -1 | cut -d: -f2 || echo "0")

if [ -n "$PROC_COUNT" ] && [ "$PROC_COUNT" -ge 1 ] 2>/dev/null; then
  pass "/memory/procedures returns saved procedure (count=$PROC_COUNT)"
else
  fail "/memory/procedures returned no results for query=smoke"
fi

# ── Step 8: Trigger second run, check MEMORY_RETRIEVED ──────────────────────
echo ""
echo "── Step 8: Second run — verify MEMORY_RETRIEVED ──"
RUN2=$(curl -sf -X POST "$API/runs" \
  -H 'Content-Type: application/json' \
  -d "{\"chat_id\":\"$CHAT_ID\",\"message\":\"Tell me about cognitive memory systems\",\"execute\":true}" || echo '{}')
RUN2_ID=$(echo "$RUN2" | grep -o '"run_id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")

if [ -z "$RUN2_ID" ]; then
  fail "Failed to create second run"
else
  # Wait for second run to complete.
  WAITED2=0
  STATUS2="QUEUED"
  while [ "$STATUS2" != "SUCCEEDED" ] && [ "$STATUS2" != "FAILED" ] && [ "$WAITED2" -lt "$MAX_WAIT" ]; do
    sleep 3
    WAITED2=$((WAITED2 + 3))
    STATUS2_RESP=$(curl -sf "$API/runs/$RUN2_ID/status" || echo '{}')
    STATUS2=$(echo "$STATUS2_RESP" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "UNKNOWN")
    echo "    ... status=$STATUS2 (${WAITED2}s)"
  done

  # Check for MEMORY_RETRIEVED events.
  sleep 2
  EVENTS2=$(curl -sf "$API/runs/$RUN2_ID/events" || echo '{}')
  MEM_RETRIEVED=$(echo "$EVENTS2" | grep -o '"MEMORY_RETRIEVED"' | wc -l || echo "0")

  if [ "$MEM_RETRIEVED" -ge 1 ] 2>/dev/null; then
    pass "MEMORY_RETRIEVED events found in second run (count=$MEM_RETRIEVED)"
  else
    fail "No MEMORY_RETRIEVED events in second run"
  fi

  # Check for RUN_CONTEXT_PREPARED event.
  CTX_PREPARED=$(echo "$EVENTS2" | grep -o '"RUN_CONTEXT_PREPARED"' | wc -l || echo "0")
  if [ "$CTX_PREPARED" -ge 1 ] 2>/dev/null; then
    pass "RUN_CONTEXT_PREPARED event found in second run"
  else
    fail "No RUN_CONTEXT_PREPARED event in second run"
  fi
fi

# ── Step 9: M2 semantic write and search ─────────────────────────────────────
echo ""
echo "── Step 9: M2 semantic write + search ──"
M2_ID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || python3 -c 'import uuid; print(uuid.uuid4())' || echo "00000000-0000-4000-8000-000000000001")
M2_WRITE=$(curl -sf -X POST "$API/memory/write" \
  -H 'Content-Type: application/json' \
  -d "{\"tier\":\"M2\",\"record\":{\"id\":\"$M2_ID\",\"tier\":\"M2\",\"text\":\"Cognitive memory systems use episodic, semantic, and procedural memory tiers\",\"embedding_model\":\"dev-hash-384\",\"source_type\":\"research_note\",\"provenance\":{\"label\":\"smoke-test\"},\"tags\":[\"memory\",\"cognitive\"],\"confidence\":0.9,\"created_at\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\"}}" || echo '{}')
M2_OK=$(echo "$M2_WRITE" | grep -o '"ok":true' || echo "")

if [ -n "$M2_OK" ]; then
  pass "M2 semantic record written: $M2_ID"

  # Search for it.
  sleep 1
  M2_SEARCH=$(curl -sf "$API/memory/search?tier=M2&query=cognitive+memory+tiers" || echo '{}')
  M2_FOUND=$(echo "$M2_SEARCH" | grep -o "$M2_ID" | wc -l || echo "0")

  if [ "$M2_FOUND" -ge 1 ] 2>/dev/null; then
    pass "M2 semantic search returned the written record"
  else
    fail "M2 semantic search did not return the written record"
    echo "Response: $M2_SEARCH"
  fi
else
  fail "M2 semantic write failed (Qdrant may be unavailable)"
  echo "Response: $M2_WRITE"
fi

# ── Step 10: Idempotency — no duplicate M1 on retry ─────────────────────────
echo ""
echo "── Step 10: Idempotency check ──"
EPISODES_BEFORE=$(curl -sf "$API/memory/episodes?runId=$RUN_ID" || echo '{}')
BEFORE_COUNT=$(echo "$EPISODES_BEFORE" | grep -o '"total":[0-9]*' | head -1 | cut -d: -f2 || echo "0")

if [ -n "$BEFORE_COUNT" ] && [ "$BEFORE_COUNT" -eq 1 ] 2>/dev/null; then
  pass "No duplicate M1 episodes for first run (count=$BEFORE_COUNT)"
elif [ -n "$BEFORE_COUNT" ] && [ "$BEFORE_COUNT" -gt 1 ] 2>/dev/null; then
  fail "Duplicate M1 episodes detected for run_id=$RUN_ID (count=$BEFORE_COUNT)"
else
  pass "M1 episode count for first run: ${BEFORE_COUNT:-unknown}"
fi

# ── Step 11: GET /runs/:runId/context ────────────────────────────────────────
echo ""
echo "── Step 11: Check /runs/:runId/context ──"
if [ -n "${RUN2_ID:-}" ]; then
  CTX_RESP=$(curl -sf "$API/runs/$RUN2_ID/context" || echo '{}')
  CTX_M1=$(echo "$CTX_RESP" | grep -o '"m1_count":[0-9]*' | head -1 | cut -d: -f2 || echo "")

  if [ -n "$CTX_M1" ]; then
    pass "/runs/:runId/context returns memory counts (m1_count=$CTX_M1)"
  else
    fail "/runs/:runId/context did not return expected data"
    echo "Response: $CTX_RESP"
  fi
else
  fail "Skipped — no second run ID available"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════"
echo "  RESULT: $PASS/$TOTAL passed, $FAIL failed"
echo "═══════════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
