#!/usr/bin/env bash
# Cognitive Runtime © 2026 by Donald Dominko
# Licensed under CC BY-NC-SA 4.0
# Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

set -euo pipefail

cd "$HOME/cognitive-runtime"

API_URL="${API_URL:-http://localhost:3001}"
PROVIDER="${PROVIDER:-qwen}"
MODEL="${MODEL:-qwen-2.5-coder-3b}"

wait_for_api() {
  echo "== wait for api /health =="
  local deadline
  deadline="$(date -d "+60 seconds" +%s 2>/dev/null || date -v+60S +%s)"
  while true; do
    if curl -sS -f "$API_URL/health" >/dev/null 2>&1; then
      echo "API is ready"
      return 0
    fi

    local now
    now="$(date +%s)"
    if test "$now" -ge "$deadline"; then
      echo "ERROR: API did not become ready in time"
      echo "== docker compose ps =="
      docker compose ps || true
      echo
      echo "== api logs (tail 200) =="
      docker compose logs --no-color --tail 200 api || true
      return 1
    fi

    sleep 1
  done
}

wait_for_run_completed() {
  local run_id="$1"
  echo "== wait for RUN_COMPLETED: $run_id =="

  local deadline
  deadline="$(date -d "+180 seconds" +%s 2>/dev/null || date -v+180S +%s)"

  while true; do
    EVENTS_JSON="$(curl -sS "$API_URL/runs/$run_id/events")"

    if echo "$EVENTS_JSON" | python3 -c 'import sys,json; ev=json.load(sys.stdin).get("events",[]); print("RUN_COMPLETED" if any(e.get("type")=="RUN_COMPLETED" for e in ev) else "WAIT")' | grep -q "RUN_COMPLETED"; then
      echo "RUN_COMPLETED seen"
      return 0
    fi

    local now
    now="$(date +%s)"
    if test "$now" -ge "$deadline"; then
      echo "ERROR: timeout waiting for RUN_COMPLETED"
      echo "$EVENTS_JSON" | python3 -m json.tool || true
      return 1
    fi

    sleep 2
  done
}

assert_run_enforced_reply() {
  local run_id="$1"
  local expected_final="$2"

  echo "== assert enforcement events for run: $run_id =="
  local events_json
  events_json="$(curl -sS "$API_URL/runs/$run_id/events")"

  EXPECTED_FINAL="$expected_final" python3 -c '
import os, sys, json
expected = os.environ["EXPECTED_FINAL"]
j = json.load(sys.stdin)
ev = j.get("events", [])

def find(t):
  for e in ev:
    if e.get("type") == t:
      return e
  return None

rc = find("RUN_COMPLETED")
assert rc is not None, "missing RUN_COMPLETED"
assert rc.get("data", {}).get("ok") is True, "RUN_COMPLETED ok != true"

dc = find("DAG_COMPLETED")
assert dc is not None, "missing DAG_COMPLETED"
assert dc.get("data", {}).get("ok") is True, "DAG_COMPLETED ok != true"

re = find("REPLY_CONSTRAINT_EVALUATED")
assert re is not None, "missing REPLY_CONSTRAINT_EVALUATED"
d = re.get("data", {})

assert d.get("forced_reply") is True, "forced_reply != true"
assert d.get("final_assistant_text") == expected, f"final_assistant_text mismatch: got={d.get('final_assistant_text')!r} expected={expected!r}"

raw = d.get("raw_assistant_text")
final = d.get("final_assistant_text")
assert isinstance(raw, str) and len(raw) > 0, "raw_assistant_text missing/empty"
assert isinstance(final, str) and len(final) > 0, "final_assistant_text missing/empty"

print("OK: enforcement event present; final text matches expected")
' <<<"$events_json"

  echo
  echo "== enforcement event (for debugging) =="
  echo "$events_json" | python3 -c '
import sys, json
j=json.load(sys.stdin)
ev=j.get("events",[])
m=[e for e in ev if e.get("type")=="REPLY_CONSTRAINT_EVALUATED"]
print(json.dumps(m[-1] if m else None, indent=2))
'
}

assert_chat_last_assistant_message() {
  local chat_id="$1"
  local expected="$2"

  echo "== assert last assistant message in chat: $chat_id =="

  local messages_json
  messages_json="$(curl -sS "$API_URL/chats/$chat_id/messages")"

  EXPECTED="$expected" python3 -c '
import os, sys, json
expected = os.environ["EXPECTED"]
j = json.load(sys.stdin)
msgs = j.get("messages", [])
assert len(msgs) >= 2, f"expected at least 2 messages, got {len(msgs)}"
last = msgs[-1]
assert last.get("role") == "assistant", f"last message role != assistant: {last.get('role')}"
assert last.get("content") == expected, f"assistant content mismatch: got={last.get('content')!r} expected={expected!r}"
print("OK: persisted assistant message matches expected")
' <<<"$messages_json"
}

echo "== rebuild+restart api + worker =="
docker compose up -d --build api worker

wait_for_api

echo
echo "== create chat =="
CHAT_JSON="$(curl -sS -f -X POST "$API_URL/chats" -H "content-type: application/json" -d '{"title":"reply constraints smoke"}')"
echo "$CHAT_JSON"
CHAT_ID="$(echo "$CHAT_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')"
echo "CHAT_ID=$CHAT_ID"

echo
echo "== run #1 (Reply with OK.) =="
RUN1_JSON="$(curl -sS -f -X POST "$API_URL/runs" \
  -H "content-type: application/json" \
  -d "{\"chat_id\":\"$CHAT_ID\",\"message\":\"Reply with OK.\",\"execute\":true,\"provider\":\"$PROVIDER\",\"model\":\"$MODEL\"}")"
echo "$RUN1_JSON"
RUN1_ID="$(echo "$RUN1_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["run_id"])')"
echo "RUN1_ID=$RUN1_ID"
wait_for_run_completed "$RUN1_ID"
assert_run_enforced_reply "$RUN1_ID" "OK."
assert_chat_last_assistant_message "$CHAT_ID" "OK."

echo
echo "== run #2 (Reply with \"HI\") =="
RUN2_JSON="$(curl -sS -f -X POST "$API_URL/runs" \
  -H "content-type: application/json" \
  -d "{\"chat_id\":\"$CHAT_ID\",\"message\":\"Reply with \\\"HI\\\"\",\"execute\":true,\"provider\":\"$PROVIDER\",\"model\":\"$MODEL\"}")"
echo "$RUN2_JSON"
RUN2_ID="$(echo "$RUN2_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["run_id"])')"
echo "RUN2_ID=$RUN2_ID"
wait_for_run_completed "$RUN2_ID"
assert_run_enforced_reply "$RUN2_ID" "HI"
assert_chat_last_assistant_message "$CHAT_ID" "HI"

echo
echo "== run #3 (Loosened: extra text + Reply with OK.) =="
RUN3_MESSAGE="Remember this number for later: 12345. Reply with OK. Thanks."
RUN3_JSON="$(curl -sS -f -X POST "$API_URL/runs" \
  -H "content-type: application/json" \
  -d "{\"chat_id\":\"$CHAT_ID\",\"message\":\"$RUN3_MESSAGE\",\"execute\":true,\"provider\":\"$PROVIDER\",\"model\":\"$MODEL\"}")"
echo "$RUN3_JSON"
RUN3_ID="$(echo "$RUN3_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["run_id"])')"
echo "RUN3_ID=$RUN3_ID"
wait_for_run_completed "$RUN3_ID"
assert_run_enforced_reply "$RUN3_ID" "OK."
assert_chat_last_assistant_message "$CHAT_ID" "OK."

echo
echo "DONE"
