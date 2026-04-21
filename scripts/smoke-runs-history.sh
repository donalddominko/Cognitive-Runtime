#!/usr/bin/env bash
# Cognitive Runtime © 2026 by Donald Dominko
# Licensed under CC BY-NC-SA 4.0
# Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

set -euo pipefail

cd "$HOME/cognitive-runtime"

API_URL="${API_URL:-http://localhost:3001}"

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

echo "== rebuild+restart api + worker =="
docker compose up -d --build api worker

wait_for_api

echo
echo "== create chat (retry up to 10x) =="
CHAT_JSON=""
for i in 1 2 3 4 5 6 7 8 9 10; do
  if CHAT_JSON="$(curl -sS -f -X POST "$API_URL/chats" -H "content-type: application/json" -d '{"title":"runs history smoke"}')"; then
    break
  fi
  echo "create chat failed, retry $i/10"
  sleep 1
done

if test -z "$CHAT_JSON"; then
  echo "ERROR: create chat failed"
  exit 1
fi

echo "$CHAT_JSON"
CHAT_ID="$(echo "$CHAT_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')"
echo "CHAT_ID=$CHAT_ID"

echo
echo "== run #1 (introduce a referent) =="
RUN1_JSON="$(curl -sS -f -X POST "$API_URL/runs" \
  -H "content-type: application/json" \
  -d "{\"chat_id\":\"$CHAT_ID\",\"message\":\"Remember this number for later: 12345. Reply with OK.\",\"execute\":true,\"provider\":\"qwen\",\"model\":\"qwen-2.5-coder-3b\"}")"
echo "$RUN1_JSON"
RUN1_ID="$(echo "$RUN1_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["run_id"])')"
echo "RUN1_ID=$RUN1_ID"

wait_for_run_completed "$RUN1_ID"

echo
echo "== chat messages after run #1 (should include user + assistant) =="
curl -sS "$API_URL/chats/$CHAT_ID/messages" | python3 -m json.tool

echo
echo "== run #2 (follow-up that requires history) =="
RUN2_JSON="$(curl -sS -f -X POST "$API_URL/runs" \
  -H "content-type: application/json" \
  -d "{\"chat_id\":\"$CHAT_ID\",\"message\":\"What was that number I asked you to remember?\",\"execute\":true,\"provider\":\"qwen\",\"model\":\"qwen-2.5-coder-3b\"}")"
echo "$RUN2_JSON"
RUN2_ID="$(echo "$RUN2_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["run_id"])')"
echo "RUN2_ID=$RUN2_ID"

wait_for_run_completed "$RUN2_ID"

echo
echo "== run #2 events (inspect) =="
curl -sS "$API_URL/runs/$RUN2_ID/events" | python3 -m json.tool

echo
echo "== chat messages after run #2 (assistant should say 12345) =="
curl -sS "$API_URL/chats/$CHAT_ID/messages" | python3 -m json.tool

echo
echo "DONE"
