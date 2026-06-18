#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Cognitive Runtime © 2026 Donald Dominko
# Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

set -euo pipefail

cd "$HOME/cognitive-runtime"

API_URL="${API_URL:-http://localhost:3001}"
PROVIDER="${PROVIDER:-qwen}"
MODEL="${MODEL:-qwen-2.5-coder-3b}"
MESSAGE="${MESSAGE:-Reply with OK.}"

DUPLICATE_ENQUEUE="${DUPLICATE_ENQUEUE:-0}"
REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
QUEUE_NAME="${QUEUE_NAME:-runs}"

wait_for_api() {
  echo "== wait for api /health =="
  local deadline now
  deadline="$(date -d "+60 seconds" +%s 2>/dev/null || date -v+60S +%s)"

  while true; do
    if curl -sS -f "$API_URL/health" >/dev/null 2>&1; then
      echo "API is ready"
      return 0
    fi

    now="$(date +%s)"
    if test "$now" -ge "$deadline"; then
      echo "ERROR: API did not become ready in time"
      echo "== docker compose ps =="
      docker compose ps || true
      echo
      echo "== api logs (tail 200) =="
      docker compose logs --no-color --tail 200 api || true
      echo
      echo "== worker logs (tail 200) =="
      docker compose logs --no-color --tail 200 worker || true
      return 1
    fi

    sleep 1
  done
}

wait_for_run_completed() {
  local run_id="$1"
  echo "== wait for RUN_COMPLETED: $run_id =="

  local deadline now
  deadline="$(date -d "+180 seconds" +%s 2>/dev/null || date -v+180S +%s)"

  while true; do
    local events_json
    events_json="$(curl -sS "$API_URL/runs/$run_id/events")"

    if echo "$events_json" | python3 -c '
import sys,json
doc=json.load(sys.stdin)
ev=doc.get("events",[])
def norm(t): return str(t).replace("_","").upper()
want = norm("RUN_COMPLETED")
print("DONE" if any(norm(e.get("type")) == want for e in ev) else "WAIT")
' | grep -q "DONE"; then
      echo "RUN_COMPLETED seen"
      return 0
    fi

    now="$(date +%s)"
    if test "$now" -ge "$deadline"; then
      echo "ERROR: timeout waiting for RUN_COMPLETED"
      echo "$events_json" | python3 -m json.tool || true
      echo
      echo "== worker logs (tail 200) =="
      docker compose logs --no-color --tail 200 worker || true
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

assert_run_events_basics() {
  local run_id="$1"

  echo "== assert run events (WORKER_STARTED + RUN_COMPLETED + status transitions) for run: $run_id =="
  local events_json
  events_json="$(curl -sS "$API_URL/runs/$run_id/events")"

  EVENTS_JSON="$events_json" python3 - <<'PY'
import os, json

doc = json.loads(os.environ["EVENTS_JSON"])
events = doc.get("events", [])

def norm(t):
    return str(t).replace("_","").upper()

def is_type(e, want):
    return norm(e.get("type")) == norm(want)

def count_type(want):
    return sum(1 for e in events if is_type(e, want))

def any_type(want):
    return any(is_type(e, want) for e in events)

def last_event_of(want):
    for e in reversed(events):
        if is_type(e, want):
            return e
    return None

def status_transitions():
    out = []
    for i, e in enumerate(events):
        if not is_type(e, "RUN_STATUS_CHANGED"):
            continue
        data = e.get("data", {}) or {}
        frm = data.get("from") or data.get("from_status") or data.get("fromStatus")
        to = data.get("to") or data.get("to_status") or data.get("toStatus")
        out.append((i, frm, to, e))
    return out

def assert_transition_in_order(transitions, required_pairs):
    cursor = -1
    for want_from, want_to in required_pairs:
        found = None
        for (idx, frm, to, ev) in transitions:
            if idx <= cursor:
                continue
            if frm == want_from and to == want_to:
                found = (idx, ev)
                break
        if not found:
            raise AssertionError(f"missing RUN_STATUS_CHANGED transition {want_from}->{want_to} after index {cursor}")
        cursor = found[0]
    return True

if not any_type("RUN_ENQUEUED"):
    raise AssertionError("missing RUN_ENQUEUED")

ws = count_type("WORKER_STARTED")
if ws != 1:
    raise AssertionError(f"expected WORKER_STARTED exactly once, got {ws}")

rc = count_type("RUN_COMPLETED")
if rc != 1:
    raise AssertionError(f"expected RUN_COMPLETED exactly once, got {rc}")

rc_ev = last_event_of("RUN_COMPLETED")
ok_val = (rc_ev or {}).get("data", {}).get("ok")
if ok_val is not True:
    raise AssertionError(f"expected RUN_COMPLETED.data.ok True, got {ok_val!r}")

if not any_type("DAG_COMPLETED"):
    raise AssertionError("missing DAG_COMPLETED")

dag_ev = last_event_of("DAG_COMPLETED")
dag_ok = (dag_ev or {}).get("data", {}).get("ok")
if dag_ok is not True:
    raise AssertionError(f"expected DAG_COMPLETED.data.ok True, got {dag_ok!r}")

if not any_type("NODE_STARTED"):
    raise AssertionError("expected at least one NODE_STARTED")

if not any_type("NODE_SUCCEEDED"):
    raise AssertionError("expected at least one NODE_SUCCEEDED")

trans = status_transitions()
if not trans:
    raise AssertionError("missing RUN_STATUS_CHANGED events entirely")

required = [("CREATED", "QUEUED"), ("QUEUED", "RUNNING")]
required.append(("RUNNING", "SUCCEEDED" if ok_val else "FAILED"))
assert_transition_in_order(trans, required)

print("OK: run trace contains WORKER_STARTED + RUN_COMPLETED, DAG/node success, and expected RUN_STATUS_CHANGED transitions")
PY
}

enqueue_duplicate_job_same_run() {
  local run_id="$1"
  local chat_id="$2"
  local message="$3"

  local trace_id message_id
  trace_id="$(python3 -c 'import uuid; print(uuid.uuid4())')"
  message_id="$(python3 -c 'import uuid; print(uuid.uuid4())')"

  echo "== enqueue duplicate job with same run_id (different job id) =="

  RUN_ID="$run_id" CHAT_ID="$chat_id" TRACE_ID="$trace_id" MESSAGE_ID="$message_id" MESSAGE="$message" \
  REDIS_URL="$REDIS_URL" QUEUE_NAME="$QUEUE_NAME" \
  node --input-type=module -e "
import { Queue } from 'bullmq';

const runId = process.env.RUN_ID;
const chatId = process.env.CHAT_ID;
const traceId = process.env.TRACE_ID;
const messageId = process.env.MESSAGE_ID;
const message = process.env.MESSAGE;

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
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

const jobId = runId + ':dup:' + traceId;

await q.add(
  'execute_run',
  { runid: runId, traceid: traceId, chatid: chatId, messageid: messageId, message },
  { jobId }
);

await q.close();
console.log('enqueued duplicate jobId=' + jobId);
"
}

assert_no_duplicate_run_level_events() {
  local run_id="$1"

  echo "== assert no duplicate WORKER_STARTED/RUN_COMPLETED after dup enqueue =="
  local events_json
  events_json="$(curl -sS "$API_URL/runs/$run_id/events")"

  EVENTS_JSON="$events_json" python3 - <<'PY'
import os, json
j = json.loads(os.environ["EVENTS_JSON"])
ev = j.get("events", [])

def norm(t): return str(t).replace("_","").upper()

def count(want):
    w = norm(want)
    return sum(1 for e in ev if norm(e.get("type")) == w)

ws = count("WORKER_STARTED")
rc = count("RUN_COMPLETED")

if ws != 1:
    raise AssertionError(f"WORKER_STARTED duplicated: {ws}")
if rc != 1:
    raise AssertionError(f"RUN_COMPLETED duplicated: {rc}")

print("OK: run-level events not duplicated")
PY
}

echo "== rebuild+restart api + worker =="
docker compose up -d --build api worker

wait_for_api

echo
echo "== create chat =="
CHAT_JSON="$(curl -sS -f -X POST "$API_URL/chats" \
  -H "content-type: application/json" \
  -d '{"title":"worker_started smoke"}')"
echo "$CHAT_JSON"
CHAT_ID="$(echo "$CHAT_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')"
echo "CHAT_ID=$CHAT_ID"

echo
echo "== create run =="
RUN_JSON="$(curl -sS -f -X POST "$API_URL/runs" \
  -H "content-type: application/json" \
  -d "{\"chat_id\":\"$CHAT_ID\",\"message\":\"$MESSAGE\",\"execute\":true,\"provider\":\"$PROVIDER\",\"model\":\"$MODEL\"}")"
echo "$RUN_JSON"
RUN_ID="$(echo "$RUN_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["run_id"])')"
echo "RUN_ID=$RUN_ID"

wait_for_run_completed "$RUN_ID"
assert_run_events_basics "$RUN_ID"

echo
echo "== baseline assistant message count =="
BASE_ASSISTANT_COUNT="$(assistant_count_for_chat "$CHAT_ID")"
echo "BASE_ASSISTANT_COUNT=$BASE_ASSISTANT_COUNT"

if test "$DUPLICATE_ENQUEUE" = "1"; then
  echo
  enqueue_duplicate_job_same_run "$RUN_ID" "$CHAT_ID" "$MESSAGE"
  echo "== wait briefly for worker to process dup job =="
  sleep 5

  echo
  assert_no_duplicate_run_level_events "$RUN_ID"

  echo
  echo "== assert no extra assistant messages =="
  AFTER_ASSISTANT_COUNT="$(assistant_count_for_chat "$CHAT_ID")"
  echo "AFTER_ASSISTANT_COUNT=$AFTER_ASSISTANT_COUNT"

  if test "$AFTER_ASSISTANT_COUNT" -ne "$BASE_ASSISTANT_COUNT"; then
    echo "ERROR: assistant message count changed after duplicate enqueue"
    exit 1
  fi

  echo "OK: assistant message count unchanged after duplicate enqueue"
fi

echo
echo "DONE"
