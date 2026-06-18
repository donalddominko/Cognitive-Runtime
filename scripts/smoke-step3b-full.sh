#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Cognitive Runtime © 2026 Donald Dominko
# Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

set -euo pipefail

cd "$(dirname "$0")/.."

APIURL="${APIURL:-http://localhost:3001}"
MESSAGE="${MESSAGE:-Reply with OK}"
PROVIDER="${PROVIDER:-qwen}"
MODEL="${MODEL:-qwen-2.5-coder-3b}"

TIMEOUT_API_SECONDS="${TIMEOUT_API_SECONDS:-60}"
TIMEOUT_RUN_SECONDS="${TIMEOUT_RUN_SECONDS:-180}"

log() { echo "[$(date -Is)] $*"; }

deadline_epoch() {
  local seconds="$1"
  date -d "+${seconds} seconds" +%s 2>/dev/null || date -v+"${seconds}S" +%s
}

wait_for_api() {
  log "wait_for_api: ${APIURL}/health"
  local deadline now
  deadline="$(deadline_epoch "${TIMEOUT_API_SECONDS}")"
  while true; do
    if curl -sS "${APIURL}/health" >/dev/null 2>&1; then
      log "OK: API is ready"
      return 0
    fi
    now="$(date +%s)"
    if test "${now}" -ge "${deadline}"; then
      log "ERROR: API did not become ready in time"
      docker compose ps || true
      log "api logs (tail 200)"
      docker compose logs --no-color --tail 200 api || true
      log "worker logs (tail 200)"
      docker compose logs --no-color --tail 200 worker || true
      return 1
    fi
    sleep 1
  done
}

create_chat() {
  local chat_json chat_id
  chat_json="$(
    curl -sS -X POST "${APIURL}/chats" \
      -H "content-type: application/json" \
      -d "{\"title\":\"smoke-step3b-full-$(date +%s)\"}"
  )"

  chat_id="$(
    echo "${chat_json}" | python3 -c 'import sys,json
j=json.load(sys.stdin)
print(j.get("id") or j.get("chat_id") or j.get("chatId") or j.get("chatid") or "")'
  )"

  if test -z "${chat_id}"; then
    log "ERROR: create_chat: missing chat id"
    echo "${chat_json}" | python3 -m json.tool || true
    return 1
  fi

  echo "${chat_id}"
}

create_run_execute_false() {
  local chat_id="$1"
  local run_json run_id

  run_json="$(
    curl -sS -X POST "${APIURL}/runs" \
      -H "content-type: application/json" \
      -d "{\"chat_id\":\"${chat_id}\",\"message\":\"${MESSAGE}\",\"execute\":false,\"provider\":\"${PROVIDER}\",\"model\":\"${MODEL}\"}"
  )"

  run_id="$(
    echo "${run_json}" | python3 -c 'import sys,json
j=json.load(sys.stdin)
print(j.get("run_id") or j.get("runid") or j.get("runId") or "")'
  )"

  if test -z "${run_id}"; then
    log "ERROR: create_run_execute_false: missing run id"
    echo "${run_json}" | python3 -m json.tool || true
    return 1
  fi

  echo "${run_id}"
}

get_run_status() {
  local run_id="$1"
  curl -sS "${APIURL}/runs/${run_id}/status" | python3 -c 'import sys,json
j=json.load(sys.stdin)
print(j.get("status") or "")'
}

post_run_execute() {
  local run_id="$1"
  curl -sS -X POST "${APIURL}/runs/${run_id}/execute" >/dev/null
}

fetch_run_events_json() {
  local run_id="$1"
  curl -sS "${APIURL}/runs/${run_id}/events" || true
}

wait_for_run_completed() {
  local run_id="$1"
  log "wait_for_run_completed: run_id=${run_id}"
  local deadline now events_json

  deadline="$(deadline_epoch "${TIMEOUT_RUN_SECONDS}")"
  while true; do
    events_json="$(fetch_run_events_json "${run_id}")"

    if test -n "${events_json}"; then
      if EVENTS_JSON="${events_json}" python3 -c $'import os,json\n\ndoc=json.loads(os.environ["EVENTS_JSON"])\nevents=doc.get("events") or []\n\ndef norm(t):\n  return str(t).replace("_","").upper()\n\nok = any(norm(e.get("type")) == norm("RUN_COMPLETED") for e in events)\nprint("DONE" if ok else "WAIT")' | grep -q "DONE"; then
        log "OK: RUN_COMPLETED seen"
        return 0
      fi
    fi

    now="$(date +%s)"
    if test "${now}" -ge "${deadline}"; then
      log "ERROR: timeout waiting for RUN_COMPLETED"
      log "events:"
      echo "${events_json}" | python3 -m json.tool || true
      log "api logs (tail 200)"
      docker compose logs --no-color --tail 200 api || true
      log "worker logs (tail 200)"
      docker compose logs --no-color --tail 200 worker || true
      return 1
    fi

    sleep 2
  done
}

assert_step3b_full_events() {
  local run_id="$1"
  log "assert_step3b_full_events: run_id=${run_id}"

  local events_json
  events_json="$(curl -sS "${APIURL}/runs/${run_id}/events")"

  EVENTS_JSON="${events_json}" MESSAGE="${MESSAGE}" python3 -c $'import os,json\n\ndoc=json.loads(os.environ["EVENTS_JSON"])\nevents=doc.get("events") or []\nmsg=os.environ.get("MESSAGE") or ""\n\n\ndef norm(t):\n  return str(t).replace("_","").upper()\n\ndef get_any(d, *keys):\n  if not isinstance(d, dict):\n    return None\n  for k in keys:\n    if k in d:\n      return d.get(k)\n  return None\n\ndef must(cond, message):\n  if not cond:\n    raise AssertionError(message)\n\ntypes=[norm(e.get("type")) for e in events]\n\nmust(norm("RUN_CREATED") in types, "missing RUN_CREATED")\nmust(norm("USER_MESSAGE_RECORDED") in types, "missing USER_MESSAGE_RECORDED")\nmust(norm("RUN_STATUS_CHANGED") in types, "missing RUN_STATUS_CHANGED")\nmust(norm("RUN_ENQUEUED") in types, "missing RUN_ENQUEUED")\nmust(norm("WORKER_STARTED") in types, "missing WORKER_STARTED")\nmust(norm("DAG_PLANNED") in types, "missing DAG_PLANNED")\nmust(norm("DAG_COMPLETED") in types, "missing DAG_COMPLETED")\nmust(norm("RUN_COMPLETED") in types, "missing RUN_COMPLETED")\nmust(norm("REPLY_CONSTRAINT_EVALUATED") in types, "missing REPLY_CONSTRAINT_EVALUATED")\n\n# Status transitions: CREATED->QUEUED->RUNNING->SUCCEEDED\ntrans=[]\nfor idx,e in enumerate(events):\n  if norm(e.get("type")) != norm("RUN_STATUS_CHANGED"):\n    continue\n  d=e.get("data") or {}\n  frm=get_any(d, "from","from_status","fromStatus")\n  to=get_any(d, "to","to_status","toStatus")\n  trans.append((idx, str(frm), str(to)))\n\ndef find_transition(frm,to, after=-1):\n  for idx,f,t in trans:\n    if idx<=after:\n      continue\n    if f==frm and t==to:\n      return idx\n  raise AssertionError(f"missing RUN_STATUS_CHANGED {frm}->{to} after index {after}; got {trans!r}")\n\ni1=find_transition("CREATED","QUEUED",-1)\ni2=find_transition("QUEUED","RUNNING",i1)\ni3=find_transition("RUNNING","SUCCEEDED",i2)\n\n# DAG_PLANNED node_count=5\nidx_dag=None\nfor i,e in enumerate(events):\n  if norm(e.get("type"))==norm("DAG_PLANNED"):\n    idx_dag=i\n    break\nmust(idx_dag is not None, "DAG_PLANNED not found")\ndag_data=events[idx_dag].get("data") or {}\nnode_count=get_any(dag_data, "nodecount","node_count","nodeCount")\nmust(int(node_count)==5, f"expected DAG_PLANNED.node_count==5, got {node_count!r}")\n\n# Canonical planner node ids (underscore form)\nchain_nodes=[\n  "plan_dag",\n  "persist_user_message",\n  "llm_chat",\n  "enforce_reply_constraints",\n  "persist_assistant_message",\n]\n\n# NODE_QUEUED must be exactly 5, emitted in deterministic sorted order by node_id,\n# and kind must match each node_id (normalized underscore-insensitive).\nkind_by_node = {\n  "plan_dag": "PLAN_DAG",\n  "persist_user_message": "PERSIST_USER_MESSAGE",\n  "llm_chat": "LLM_CHAT",\n  "enforce_reply_constraints": "ENFORCE_REPLY_CONSTRAINTS",\n  "persist_assistant_message": "PERSIST_ASSISTANT_MESSAGE",\n}\n\ndef norm_kind(k):\n  return str(k).replace("_","").upper()\n\nexpected_sorted=sorted(chain_nodes)\n\nnode_queued=[e for e in events if norm(e.get("type"))==norm("NODE_QUEUED")]\nmust(len(node_queued)==5, f"expected 5 NODE_QUEUED, got {len(node_queued)}")\n\nqueued_ids=[]\nbad_kinds=[]\nfor e in node_queued:\n  d=e.get("data") or {}\n  nid=str(get_any(d,"nodeid","node_id","nodeId"))\n  k=get_any(d,"kind")\n  queued_ids.append(nid)\n  want = kind_by_node.get(nid)\n  if want is not None:\n    if norm_kind(k) != norm_kind(want):\n      bad_kinds.append((nid, k, want))\n\nmust(sorted(queued_ids)==expected_sorted, f"NODE_QUEUED node_ids mismatch: {queued_ids!r}")\nmust(queued_ids==expected_sorted, f"NODE_QUEUED not deterministic sorted order: {queued_ids!r} expected {expected_sorted!r}")\nmust(len(bad_kinds)==0, f"NODE_QUEUED.kind mismatch: {bad_kinds!r}")\n\n# NODE_STARTED attempt=1: ensure we saw attempt=1 for each node, in dependency chain order\nnode_started_attempt1=[]\nfor i,e in enumerate(events):\n  if norm(e.get("type"))!=norm("NODE_STARTED"):\n    continue\n  d=e.get("data") or {}\n  attempt=get_any(d,"attempt")\n  if attempt is None:\n    continue\n  if int(attempt)==1:\n    node_started_attempt1.append((i, str(get_any(d,"nodeid","node_id","nodeId"))))\n\nmust(len(node_started_attempt1)>=5, f"expected at least 5 NODE_STARTED(attempt=1), got {len(node_started_attempt1)}")\nfirst_start_idx={}\nfor i,nid in node_started_attempt1:\n  if nid and nid not in first_start_idx:\n    first_start_idx[nid]=i\n\nfor nid in chain_nodes:\n  must(nid in first_start_idx, f"missing NODE_STARTED(attempt=1) for node_id={nid}")\n\nfor a,b in zip(chain_nodes, chain_nodes[1:]):\n  must(first_start_idx[a] < first_start_idx[b], f"NODE_STARTED order wrong: {a}@{first_start_idx[a]} should be before {b}@{first_start_idx[b]}")\n\n# NODE_SUCCEEDED: at least one per node\nnode_succeeded=[e for e in events if norm(e.get("type"))==norm("NODE_SUCCEEDED")]\nsucc_ids=set(str(get_any((e.get("data") or {}),"nodeid","node_id","nodeId")) for e in node_succeeded)\nfor nid in chain_nodes:\n  must(nid in succ_ids, f"missing NODE_SUCCEEDED for node_id={nid}")\n\n# DAG_COMPLETED.ok == true, RUN_COMPLETED.ok == true\nlast_dag=None\nlast_run=None\nfor e in events:\n  if norm(e.get("type"))==norm("DAG_COMPLETED"):\n    last_dag=e\n  if norm(e.get("type"))==norm("RUN_COMPLETED"):\n    last_run=e\n\nmust(last_dag is not None, "missing DAG_COMPLETED")\nmust(last_run is not None, "missing RUN_COMPLETED")\n\ndag_ok=get_any(last_dag.get("data") or {}, "ok")\nrun_ok=get_any(last_run.get("data") or {}, "ok")\nmust(dag_ok is True, f"DAG_COMPLETED.ok not true: {dag_ok!r}")\nmust(run_ok is True, f"RUN_COMPLETED.ok not true: {run_ok!r}")\n\n# Reply constraint audit for exact message \"Reply with OK\"\nif msg.strip() == "Reply with OK":\n  matches=[]\n  for e in events:\n    if norm(e.get("type")) != norm("REPLY_CONSTRAINT_EVALUATED"):\n      continue\n    d=e.get("data") or {}\n    forced=get_any(d, "forcedreply","forced_reply","forcedReply")\n    final=get_any(d, "finalassistanttext","final_assistant_text","finalAssistantText")\n    matches.append((forced, final))\n  must(any((fr is True and fa == "OK") for fr,fa in matches), f"expected forced_reply=true and final_assistant_text==\\\"OK\\\"; got {matches!r}")\n\nprint("OK: Step 3B full run trace assertions passed")'
}

main() {
  wait_for_api

  local chat_id run_id status_before
  chat_id="$(create_chat)"
  log "chat_id=${chat_id}"

  run_id="$(create_run_execute_false "${chat_id}")"
  log "run_id=${run_id}"

  status_before="$(get_run_status "${run_id}")"
  log "status_before_execute=${status_before}"
  if test "${status_before}" != "CREATED"; then
    log "ERROR: expected status CREATED before execute, got ${status_before}"
    exit 1
  fi

  log "POST /runs/${run_id}/execute"
  post_run_execute "${run_id}"

  wait_for_run_completed "${run_id}"
  assert_step3b_full_events "${run_id}"

  log "DONE: smoke-step3b-full passed"
}

main "$@"
