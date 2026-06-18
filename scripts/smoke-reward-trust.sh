#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Cognitive Runtime © 2026 Donald Dominko
# Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

# scripts/smoke-reward-trust.sh
# Phase 4 smoke test: verifies reward computation + trust EMA end-to-end.
# Requires: running Docker stack (api:3001, worker consuming 'runs' queue).

set -euo pipefail

API="http://localhost:3001"

log() { echo "$*"; }

# ── Step 0: Health check ──────────────────────────────────────────────────────
log "=== smoke-reward-trust.sh ==="
log "--- Checking API health ---"
HEALTH=$(curl -sS "$API/health")
log "health=$HEALTH"

# ── Step 1: Create chat (required by foreign key on run_logs.chat_id) ─────────
log "--- Creating chat ---"
CHAT_JSON=$(curl -sS -X POST "$API/chats" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"smoke-reward-trust-$(date +%s)\"}")
log "chat_json=$CHAT_JSON"

CHAT_ID=$(echo "$CHAT_JSON" | python3 -c '
import sys, json
j = json.load(sys.stdin)
print(j.get("id") or j.get("chat_id") or j.get("chatId") or "")
')

if [ -z "$CHAT_ID" ]; then
  log "FAIL: could not extract chat_id from response"
  exit 1
fi
log "chat_id=$CHAT_ID"

# ── Step 2: Create and execute a run ─────────────────────────────────────────
log "--- Creating and executing a run ---"
RUN_JSON=$(curl -sS -X POST "$API/runs" \
  -H "Content-Type: application/json" \
  -d "{\"chat_id\":\"$CHAT_ID\",\"message\":\"Reply with OK\",\"execute\":true}")
log "run_json=$RUN_JSON"

RUN_ID=$(echo "$RUN_JSON" | python3 -c '
import sys, json
j = json.load(sys.stdin)
print(j.get("run_id") or j.get("runId") or "")
')

if [ -z "$RUN_ID" ]; then
  log "FAIL: could not extract run_id from response"
  exit 1
fi
log "run_id=$RUN_ID"

# ── Step 3: Poll for run completion ──────────────────────────────────────────
log "--- Polling for run completion ---"
STATUS="CREATED"
for i in $(seq 1 30); do
  STATUS=$(curl -sS "$API/runs/$RUN_ID/status" | python3 -c '
import sys, json
j = json.load(sys.stdin)
print(j.get("status") or "")
')
  log "  poll attempt=$i status=$STATUS"
  if [ "$STATUS" = "SUCCEEDED" ] || [ "$STATUS" = "FAILED" ]; then
    break
  fi
  sleep 2
done

[ "$STATUS" = "SUCCEEDED" ] || {
  log "FAIL: run did not succeed — status=$STATUS"
  exit 1
}
log "  ✓ run succeeded"

# ── Step 4: Poll for REWARD_COMPUTED via GET /runs/:runId/reward ──────────────
log "--- Polling for reward data ---"
REWARD_JSON=""
for i in $(seq 1 10); do
  HTTP_CODE=$(curl -sS -o /tmp/smoke_reward_resp.json -w "%{http_code}" \
    "$API/runs/$RUN_ID/reward")
  if [ "$HTTP_CODE" = "200" ]; then
    REWARD_JSON=$(cat /tmp/smoke_reward_resp.json)
    break
  fi
  log "  poll attempt=$i http_code=$HTTP_CODE (waiting...)"
  sleep 1
done

[ -n "$REWARD_JSON" ] || {
  log "FAIL: GET /runs/$RUN_ID/reward never returned 200"
  exit 1
}
log "  ✓ reward endpoint returned 200"
log "  reward=$REWARD_JSON"

# ── Step 5: Assert reward fields ─────────────────────────────────────────────
log "--- Asserting reward fields ---"

REWARD_JSON="$REWARD_JSON" python3 -c '
import sys, json, os

data = json.loads(os.environ["REWARD_JSON"])

def must(cond, msg):
    if not cond:
        raise AssertionError("FAIL: " + msg)

routing   = data.get("routing")
score     = data.get("artifact_score")
hard_gate = data.get("hard_gate_triggered")
signals   = data.get("signals") or {}
syn_val   = signals.get("SYN")
agent_id  = data.get("agent_id")

print(f"  routing={routing} artifact_score={score} hard_gate_triggered={hard_gate}")
print(f"  signals.SYN={syn_val} agent_id={agent_id}")

must(routing  is not None and routing != "", "routing is null or empty")
must(score    is not None,                   "artifact_score is null")
must(syn_val  is not None,                   "signals.SYN is null")
must(agent_id == "qwen-local",               f"agent_id={agent_id!r} expected qwen-local")
must(hard_gate is False,                     f"hard_gate_triggered={hard_gate!r} expected False")
must(0.0 <= float(score) <= 1.0,             f"artifact_score={score} out of [0,1]")

print("  all reward fields valid")
'

# ── Step 6: Check GET /agents/qwen-local/trust ────────────────────────────────
log "--- Checking agent trust ---"
TRUST_RESP=$(curl -sS "$API/agents/qwen-local/trust")
log "  trust_response=$TRUST_RESP"

TRUST_RESP="$TRUST_RESP" python3 -c '
import sys, json, os

data = json.loads(os.environ["TRUST_RESP"])

def must(cond, msg):
    if not cond:
        raise AssertionError("FAIL: " + msg)

agent_id  = data.get("agent_id")
trust     = data.get("trust")
ema_alpha = data.get("ema_alpha")

print(f"  agent_id={agent_id} trust={trust} ema_alpha={ema_alpha}")

must(agent_id == "qwen-local",   f"agent_id={agent_id!r} expected qwen-local")
must(trust is not None,           "trust is null")
must(0.1 <= float(trust) <= 0.95, f"trust={trust} out of [0.1, 0.95]")
must(str(ema_alpha) == "0.15",    f"ema_alpha={ema_alpha!r} expected 0.15")

print("  all trust fields valid")
'

# ── Summary ───────────────────────────────────────────────────────────────────
SCORE=$(echo "$REWARD_JSON"  | python3 -c 'import sys,json; print(json.load(sys.stdin).get("artifact_score","?"))')
ROUTING=$(echo "$REWARD_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("routing","?"))')
TRUST=$(echo "$TRUST_RESP"   | python3 -c 'import sys,json; print(json.load(sys.stdin).get("trust","?"))')

log ""
log "✅ smoke-reward-trust.sh PASSED"
log "   run_id=$RUN_ID"
log "   artifact_score=$SCORE routing=$ROUTING"
log "   trust=$TRUST"
