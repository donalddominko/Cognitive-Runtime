#!/usr/bin/env bash
# Cognitive Runtime © 2026 by Donald Dominko
# Licensed under CC BY-NC-SA 4.0
# Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:3001}"

echo "API_BASE_URL=$API_BASE_URL"

TITLE="smoke-dag-state-$(date +%s)"
echo "Creating chat: $TITLE"

CHAT_JSON="$(curl -sS -X POST "$API_BASE_URL/chats" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"$TITLE\"}")"

CHAT_ID="$(printf '%s' "$CHAT_JSON" | node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync(0,"utf8")); console.log(j.id || j.chat_id || "");')"

if [ -z "$CHAT_ID" ]; then
  echo "Failed to parse chat id. Response:"
  echo "$CHAT_JSON"
  exit 1
fi

echo "CHAT_ID=$CHAT_ID"

echo "Creating run (execute=true)..."
RUN_JSON="$(curl -sS -X POST "$API_BASE_URL/runs" \
  -H "Content-Type: application/json" \
  -d "{\"chat_id\":\"$CHAT_ID\",\"message\":\"Reply with OK\",\"model\":\"qwen-2.5-coder-3b\",\"provider\":\"qwen\",\"execute\":true}")"

RUN_ID="$(printf '%s' "$RUN_JSON" | node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync(0,"utf8")); console.log(j.run_id || "");')"

if [ -z "$RUN_ID" ]; then
  echo "Failed to parse run_id. Response:"
  echo "$RUN_JSON"
  exit 1
fi

echo "RUN_ID=$RUN_ID"
echo "Waiting for DAG completion (max 20s)..."

STATUS=""
for i in $(seq 1 20); do
  DAG_JSON="$(curl -sS "$API_BASE_URL/runs/$RUN_ID/dag-state" || true)"
  STATUS="$(printf '%s' "$DAG_JSON" | node -e 'const fs=require("fs"); try { const j=JSON.parse(fs.readFileSync(0,"utf8")); console.log(j?.dag_state?.status || ""); } catch { console.log(""); }')"

  if [ "$STATUS" = "SUCCEEDED" ] || [ "$STATUS" = "FAILED" ]; then
    break
  fi

  sleep 1
done

echo
echo "DAG status: ${STATUS:-UNKNOWN}"
echo

echo "Node list:"
printf '%s' "$DAG_JSON" | node -e '
const fs=require("fs");
const j=JSON.parse(fs.readFileSync(0,"utf8"));
const s=j.dag_state;
if (!s) { console.log("No dag_state in response"); process.exit(0); }
const nodes=Array.isArray(s.nodes) ? s.nodes : [];
for (const n of nodes) {
  const id=n.node_id ?? "";
  const kind=n.kind ?? "";
  const status=n.status ?? "";
  const last=n.last_attempt ?? "";
  const bytes=(n.attempts && n.attempts[0] && n.attempts[0].output_summary && typeof n.attempts[0].output_summary.bytes==="number")
    ? n.attempts[0].output_summary.bytes
    : "";
  console.log(`${id}\t${kind}\t${status}\tlast_attempt=${last}\tbytes=${bytes}`);
}
'

echo
echo "Raw /dag-state JSON:"
echo "$DAG_JSON"
