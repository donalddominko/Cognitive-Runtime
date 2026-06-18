#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Cognitive Runtime © 2026 Donald Dominko
# Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

set -euo pipefail

cd "$HOME/cognitive-runtime"

API_URL="${API_URL:-http://localhost:3001}"
PROVIDER="${PROVIDER:-qwen}"
MODEL="${MODEL:-qwen-2.5-coder-3b}"
REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
QUEUE_NAME="${QUEUE_NAME:-runs}"

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
      docker compose ps || true
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
    local events_json
    events_json="$(curl -sS "$API_URL/runs/$run_id/events")"

    if echo "$events_json" | python3 -c 'import sys,json; ev=json.load(sys.stdin).get("events",[]); print("DONE" if any(e.get("type")=="RUN_COMPLETED" for e in ev) else "WAIT")' | grep -q "DONE"; then
      echo "RUN_COMPLETED seen"
      return 0
    fi

    local now
    now="$(date +%s)"
    if test "$now" -ge "$deadline"; then
      echo "ERROR: timeout waiting for RUN_COMPLETED"
      echo "$events_json" | python3 -m json.tool || true
      return 1
    fi

    sleep 2
  done
}

assistant_count_for_chat() {
  local chat_id="$1"
  curl -sS "$API_URL/chats/$chat_id/messages" | python3 -c '
import sys, json
j=json.load(sys.stdin)
msgs=j.get("messages",[])
print(sum(1 for m in msgs if m.get("role")=="assistant"))
'
}

run_completed_count() {
  local run_id="$1"
  curl -sS "$API_URL/runs/$run_id/events" | python3 -c '
import sys, json
j=json.load(sys.stdin)
ev=j.get("events",[])
print(sum(1 for e in ev if e.get("type")=="RUN_COMPLETED"))
'
}

enqueue_duplicate_job() {
  local run_id="$1"
  local chat_id="$2"
  local message="$3"

  local trace_id
  trace_id="$(python3 -c 'import uuid; print(uuid.uuid4())')"
  local message_id
  message_id="$(python3 -c 'import uuid; print(uuid.uuid4())')"

  local dup_job_id
  dup_job_id="${run_id}-dup-$(python3 -c 'import uuid; print(uuid.uuid4())')"

  local message_b64
  message_b64="$(python3 -c 'import base64,sys; print(base64.b64encode(sys.argv[1].encode("utf-8")).decode("ascii"))' "$message")"

  echo "== enqueue duplicate BullMQ job (same run_id, different jobId) =="
  echo "DUP_JOB_ID=$dup_job_id"

  docker compose exec -T \
    -w /app/apps/worker \
    -e RUN_ID="$run_id" \
    -e CHAT_ID="$chat_id" \
    -e TRACE_ID="$trace_id" \
    -e MESSAGE_ID="$message_id" \
    -e MESSAGE_B64="$message_b64" \
    -e REDIS_URL="redis://redis:6379" \
    -e QUEUE_NAME="$QUEUE_NAME" \
    -e DUP_JOB_ID="$dup_job_id" \
    worker node --input-type=module -e "
import { Queue } from 'bullmq';

const runId = process.env.RUN_ID;
const chatId = process.env.CHAT_ID;
const traceId = process.env.TRACE_ID;
const messageId = process.env.MESSAGE_ID;
const dupJobId = process.env.DUP_JOB_ID;

const message = Buffer.from(process.env.MESSAGE_B64 || '', 'base64').toString('utf8');

const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';
const queueName = process.env.QUEUE_NAME || 'runs';

const u = new URL(redisUrl);
const port = u.port ? Number(u.port) : 6379;
const username = u.username ? decodeURIComponent(u.username) : undefined;
const password = u.password ? decodeURIComponent(u.password) : undefined;
const dbFromPath = u.pathname?.replace('/', '');
const db = dbFromPath ? Number(dbFromPath) : undefined;

const q = new Queue(queueName, {
  connection: {
    host: u.hostname,
    port,
    username,
    password,
    db,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  }
});

await q.add(
  'execute_run',
  { run_id: runId, trace_id: traceId, chat_id: chatId, message_id: messageId, message },
  { jobId: dupJobId }
);

await q.close();
console.log('enqueued duplicate jobId=' + dupJobId + ' (run_id=' + runId + ')');
"
}

echo "== rebuild+restart api + worker =="
docker compose up -d --build api worker

wait_for_api

echo
echo "== create chat =="
CHAT_JSON="$(curl -sS -f -X POST "$API_URL/chats" -H "content-type: application/json" -d '{"title":"idempotent run smoke"}')"
echo "$CHAT_JSON"
CHAT_ID="$(echo "$CHAT_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')"
echo "CHAT_ID=$CHAT_ID"

echo
echo "== create run =="
MESSAGE="Reply with OK."
RUN_JSON="$(curl -sS -f -X POST "$API_URL/runs" \
  -H "content-type: application/json" \
  -d "{\"chat_id\":\"$CHAT_ID\",\"message\":\"$MESSAGE\",\"execute\":true,\"provider\":\"$PROVIDER\",\"model\":\"$MODEL\"}")"
echo "$RUN_JSON"
RUN_ID="$(echo "$RUN_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["run_id"])')"
echo "RUN_ID=$RUN_ID"

wait_for_run_completed "$RUN_ID"

echo
echo "== record baseline counts =="
BASE_ASSISTANT_COUNT="$(assistant_count_for_chat "$CHAT_ID")"
BASE_RUN_COMPLETED_COUNT="$(run_completed_count "$RUN_ID")"
echo "BASE_ASSISTANT_COUNT=$BASE_ASSISTANT_COUNT"
echo "BASE_RUN_COMPLETED_COUNT=$BASE_RUN_COMPLETED_COUNT"

if test "$BASE_RUN_COMPLETED_COUNT" -ne 1; then
  echo "ERROR: expected exactly 1 RUN_COMPLETED, got $BASE_RUN_COMPLETED_COUNT"
  curl -sS "$API_URL/runs/$RUN_ID/events" | python3 -m json.tool || true
  exit 1
fi

echo
enqueue_duplicate_job "$RUN_ID" "$CHAT_ID" "$MESSAGE"

echo
echo "== wait briefly for worker to process duplicate job =="
sleep 5

echo
echo "== assert counts unchanged =="
AFTER_ASSISTANT_COUNT="$(assistant_count_for_chat "$CHAT_ID")"
AFTER_RUN_COMPLETED_COUNT="$(run_completed_count "$RUN_ID")"
echo "AFTER_ASSISTANT_COUNT=$AFTER_ASSISTANT_COUNT"
echo "AFTER_RUN_COMPLETED_COUNT=$AFTER_RUN_COMPLETED_COUNT"

if test "$AFTER_ASSISTANT_COUNT" -ne "$BASE_ASSISTANT_COUNT"; then
  echo "ERROR: assistant message count changed (duplicate side effect)"
  exit 1
fi

if test "$AFTER_RUN_COMPLETED_COUNT" -ne 1; then
  echo "ERROR: RUN_COMPLETED count changed (duplicate run-level events)"
  curl -sS "$API_URL/runs/$RUN_ID/events" | python3 -m json.tool || true
  exit 1
fi

echo
echo "OK: duplicate run enqueue did not create duplicate messages or completion events"
