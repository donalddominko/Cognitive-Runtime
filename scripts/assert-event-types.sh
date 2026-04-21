#!/usr/bin/env bash
# Cognitive Runtime © 2026 by Donald Dominko
# Licensed under CC BY-NC-SA 4.0
# Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CANON_FILE="${ROOT}/packages/contracts/src/event-types.ts"

if [ ! -f "${CANON_FILE}" ]; then
  echo "Missing ${CANON_FILE}"
  exit 2
fi

bad_tokens="$(
python3 - "${CANON_FILE}" <<'PY'
import re, sys

p = sys.argv[1]
s = open(p, "r", encoding="utf-8").read()

# Pull quoted ALLCAPS tokens (event types) out of event-types.ts.
tokens = sorted(set(re.findall(r"'([A-Z0-9_]+)'", s)))
tokens = [t for t in tokens if "_" in t and t == t.upper()]
canon = set(tokens)

def variants(t: str):
  parts = t.split("_")
  n = len(parts) - 1
  # For each underscore boundary, choose keep "_" or drop it -> generates partial-underscore variants too.
  for mask in range(1 << n):
    out = parts[0]
    for i in range(n):
      if mask & (1 << i):
        out += "_"
      out += parts[i + 1]
    if out != t and out not in canon:
      yield out

bad = set()
for t in tokens:
  bad.add(t.replace("_", ""))   # fully collapsed
  bad.update(variants(t))       # partial collapsed

bad = sorted(bad - canon)
print("\n".join(bad))
PY
)"

if [ -z "${bad_tokens}" ]; then
  echo "No legacy variants generated (unexpected)."
  exit 3
fi

pattern="$(
printf '%s\n' "${bad_tokens}" | python3 - <<'PY'
import re, sys
ts = [line.strip() for line in sys.stdin if line.strip()]
ts.sort(key=len, reverse=True)
print(r"\b(" + "|".join(re.escape(t) for t in ts) + r")\b")
PY
)"

cd "${ROOT}"

hits=""
if command -v rg >/dev/null 2>&1; then
  hits="$(rg -n --no-messages -S -e "${pattern}" \
    -g '!**/node_modules/**' \
    -g '!**/dist/**' \
    -g '!**/*.bak*' \
    -g '!**/*.bak.*' \
    . || true)"
else
  hits="$(grep -RInE "${pattern}" . 2>/dev/null || true)"
fi

if [ -n "${hits}" ]; then
  echo "Found legacy (non-canonical) run event type token variants in source:"
  echo "${hits}"
  if [ "${ALLOW_LEGACY:-0}" = "1" ]; then
    echo "ALLOW_LEGACY=1 set, not failing (transition mode)."
    exit 0
  fi
  exit 1
fi

echo "OK: no legacy run event type token variants found."
