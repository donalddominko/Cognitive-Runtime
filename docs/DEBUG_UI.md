<!-- Cognitive Runtime © 2026 by Donald Dominko | CC BY-NC-SA 4.0 -->

# Debug UI

Five developer-only debug panels embedded in the Vite dev server UI (`http://localhost:5173`) for observing run execution, DAG state, memory retrieval, meta-planning, and Phase 7 production hardening.

---

## Overview

The debug panels are rendered only when `DEV_MODE` is true:

```typescript
// apps/web/src/App.tsx
const DEV_MODE = import.meta.env.DEV;
```

`import.meta.env.DEV` is a **Vite compile-time constant** — it is `true` only when the Vite dev server is running and is tree-shaken to `false` (and the wrapped JSX is entirely removed) in the production build output. The production Docker service (`cognitive-web`, port `:3000`) serves the production bundle. The debug panels do not exist in that bundle and cannot be re-enabled via environment variables after the build.

To access the panels, run the Vite dev server:

```bash
# Local (without Docker):
cd apps/web && pnpm dev
# Visit http://localhost:5173

# Via Docker:
docker compose up -d   # web-dev service starts automatically on port 5173
```

All five panels are stacked vertically below the ChatPanel in the main content area. Each can be independently shown or hidden via its own toggle button.

---

## Panel Order

Panels appear in this top-to-bottom order in the UI:

| # | Panel name | Source file |
|---|---|---|
| 1 | Memory Debug | `apps/web/src/components/MemoryDebugPanel.tsx` |
| 2 | Meta-Planner Debug | `apps/web/src/components/MetaPlannerPanel.tsx` |
| 3 | Phase 7 Debug | `apps/web/src/components/Phase7DebugPanel.tsx` |
| 4 | AI Debug: DAG State | `apps/web/src/App.tsx` (inline) |
| 5 | Event Trace Viewer | `apps/web/src/App.tsx` + `apps/web/src/components/RunTraceViewer.tsx` |

Panels 1–3 are self-contained components. Panels 4 and 5 are rendered inline in `App.tsx` and share a single piece of state (`currentRunId`) — the only cross-panel state coupling in the debug UI.

---

## Recommended Workflow

The panels are designed to be used together. The fastest path to a complete picture of a run's execution:

### Step 1 — Select a chat

Use the sidebar to select an existing chat or create a new one. The "Create Test Run" button in the Event Trace Viewer is disabled until a chat is selected.

### Step 2 — Create a test run

In the **Event Trace Viewer** (bottom panel, orange border), click **Create Test Run**.

This fires `POST /runs` with the following hardcoded payload:

```json
{
  "chat_id": "<selected_chat_id>",
  "message": "Test message for Step 2",
  "model": "qwen-2.5-coder-3b",
  "provider": "qwen"
}
```

On success:
- The returned `run_id` is stored in `App.tsx` state as `currentRunId`
- The DAG State panel's run ID input is **automatically pre-filled** with the new run ID
- The DAG State panel is **automatically expanded** (`showDagPanel` is set to `true`)
- A browser `alert()` confirms the run ID

The model and message are hardcoded and cannot be changed from the UI. To test other models or messages, use the API directly (`POST /runs`) or run the smoke test scripts in `scripts/`.

### Step 3 — Watch execution in DAG State

With the run ID pre-filled, click **Start polling** (green button) in the **AI Debug: DAG State** panel. The panel polls `GET /runs/{runId}/dag-state` every 1000 ms and updates the summary grid and nodes table in place.

Watch the node `status` column change from `PENDING` → `RUNNING` → `SUCCEEDED` (or `FAILED` / `SKIPPED`) as the worker processes each DAG node. Click **Stop polling** (red) when done.

### Step 4 — Inspect the full event trace

In the **Event Trace Viewer**, click **View Run Trace**. The component fetches `GET /runs/{runId}/events` on the first open and displays every event in the run log as a collapsible row. Expand any event to see its full JSON payload.

The trace is fetched once and cached. Opening, closing, and re-opening the viewer shows the same snapshot. To fetch a fresh trace for the same run, reload the page and re-open the panel.

### Step 5 — Deeper inspection with run ID

Copy the run ID using the **📋 Copy** button in the Event Trace Viewer, then paste it into any of the following:

| Panel | Subsection | What you get |
|---|---|---|
| Phase 7 Debug | Run Lifecycle Inspector | Status transitions, heartbeat count, cancel/timeout/stale timestamps, `fail_classification` |
| Phase 7 Debug | Policy Decisions | `POLICY_VERDICT` evaluations — only populated if `ENABLE_POLICY_GATE=true` |
| Meta-Planner Debug | Plan Inspector | Planner event chain and candidate scoring — only populated if `ENABLE_REPLANNING=true` |
| Memory Debug | Run Context Inspector | M1/M2/M3 retrieval record counts and IDs for this run |

---

## Panel Reference

---

### 1. Memory Debug

**Source:** `apps/web/src/components/MemoryDebugPanel.tsx`
**Purpose:** Inspect the three-tier memory system — embeddings, cache, retrieval context, search, and saved procedures.

The panel has a **Show / Hide** toggle. When opened for the first time, the **System Debug** subsection auto-loads immediately (two API calls fire in parallel). The other three subsections require explicit user action.

#### Subsections

| Subsection | Trigger | API endpoint(s) |
|---|---|---|
| System Debug | Auto-loads on first open | `GET /debug/embeddings/health`, `GET /debug/cache/health` |
| Run Context Inspector | "Fetch" button | `GET /runs/{runId}/context` |
| Memory Search | "Search" button or Enter key | `GET /memory/search?query={q}&top_k=5` |
| Saved Procedures | "Load" / "Refresh" button | `GET /memory/procedures?limit=10` |

#### System Debug

Fires `Promise.all([GET /debug/embeddings/health, GET /debug/cache/health])` when the panel body first renders. A **Refresh** button re-fires both calls.

Displays:

```
Embedding: {provider_type} ({model_name})
  Dim: {dimension} | Reachable: ✅/❌ | Dev fallback: yes/no

Cache: Redis ✅/❌
  Embeddings: ✅/❌ | Retrieval: ✅/❌ | WorkCtx: ✅/❌
```

If the embedding provider is unreachable and `EMBEDDING_ALLOW_DEV_FALLBACK=true`, the system uses random vectors as a fallback — runs will complete but memory retrieval results will be meaningless.

#### Run Context Inspector

| Control | Description |
|---|---|
| `run_id (UUID)` text input | UUID of the run to inspect |
| **Fetch** button | Disabled if the input is empty; calls `GET /runs/{runId}/context` |

Displays the M1/M2/M3 retrieval summary for that run — counts and the IDs of records retrieved at each tier:

```
M1: {n}   M2: {n}   M3: {n}

{tier}  top_k={n}  results={n}  ids: {id1}, {id2}, ...
```

#### Memory Search

| Control | Description |
|---|---|
| Free text input (`Search memory...`) | Search query; pressing **Enter** triggers the search |
| **Search** button | Disabled if the input is empty; calls `GET /memory/search?query={q}&top_k=5` |

This is the **only input in the entire debug UI** that accepts an Enter-key submission.

Enter any natural language phrase describing what you want to find — the search runs across all three memory tiers simultaneously. Examples:

| Query | What it finds |
|---|---|
| `authentication error` | Episodes and procedures related to auth failures |
| `how to handle retries` | Procedural memory about retry logic |
| `qwen response timeout` | Episodes where the LLM call timed out |
| `code change workflow` | Anything related to the code-change DAG path |
| `reward score low` | Episodes where the reward agent returned a poor score |

The search returns the top 5 results per tier (`top_k=5`). If all three tiers return zero results, the system has not yet accumulated enough run history — run more tasks through the chat and try again.

Results are grouped by tier and truncated to 60 characters:

```
Total: {n}

M1 Episodes ({n}):
  {id}  {title…}

M2 Semantic ({n}):
  {id}  {text…}

M3 Procedures ({n}):
  {id}  {name…}
```

#### Saved Procedures

| Control | Description |
|---|---|
| **Load** (first time) / **Refresh** (subsequent) button | Calls `GET /memory/procedures?limit=10` |

Shows up to 10 saved M3 procedural memory records:

```
{id (8 chars)}  {name}  v{version}  [{status}]
```

---

### 2. Meta-Planner Debug

**Source:** `apps/web/src/components/MetaPlannerPanel.tsx`
**Purpose:** Observe the Phase 6 Meta-Planner pipeline — configuration flags, candidate DAGs, scoring, and the final planning decision for a specific run.

The panel has a **Show / Hide** toggle. When opened, the **Planner Config** subsection auto-loads.

#### Subsections

| Subsection | Trigger | API endpoint |
|---|---|---|
| Planner Config | Auto-loads on first open | `GET /meta-planner/config` |
| Plan Inspector | "Fetch" button | `GET /runs/{runId}/meta-plan` |

#### Planner Config

Displays the current Meta-Planner configuration:

```
Enabled: ✅/❌ | Synthesis: ✅/❌ | Min Reward: {value}
Weights: Q={quality} L={latency} C={cost} R={risk}
```

If `Enabled: ❌`, the planner is skipped for every run and the Plan Inspector will show empty or minimal data. See [DEVELOPMENT.md](DEVELOPMENT.md) for how to enable `ENABLE_REPLANNING`.

The four weights (Q/L/C/R) are the scoring factors used to rank candidate DAGs. Their meaning is described in [META_PLANNER.md](META_PLANNER.md).

#### Plan Inspector

| Control | Description |
|---|---|
| `run_id (UUID)` text input | UUID of the run to inspect |
| **Fetch** button | Disabled if the input is empty; calls `GET /runs/{runId}/meta-plan` |

The response contains a sequence of planner events. Each field is only rendered if present in the response:

| Field | Display | Style |
|---|---|---|
| Event count | `Events: {n}` | — |
| `started` | `Enabled: ✅/❌  v{version}` | — |
| `skipped` | `Skipped: {reason}` | — |
| `context_retrieved` | `Context: M1={n}  M3={n}  M2: ✅/❌` | — |
| `candidates_built` | List: `{id (8 chars)} [{source}] mode={mode} score={score}` | — |
| `decision_made` | `Decision: {id (8 chars)} mode={mode} score={score}` + `(FALLBACK)` tag if applicable | — |
| `fallback_used` | `Fallback: {reason}` | Orange |
| `evaluated` | `Evaluation: predicted={n} actual={n} error={n}` | — |
| `failed` | `Failed: [{code}] {message}` | Red |

A `fallback_used` event means the planner encountered an error and fell back to the hardcoded default DAG. The run still completed normally — the fallback is non-fatal.

---

### 3. Phase 7 Debug

**Source:** `apps/web/src/components/Phase7DebugPanel.tsx`
**Purpose:** Inspect Phase 7 production hardening — feature flag state, run lifecycle timestamps, policy gate verdicts, and system-wide stale/failed run status.

The panel has a **Show / Hide** toggle. When opened, the **Phase 7 Config** subsection auto-loads. The **Stale & Failed Runs** subsection does **not** auto-load despite being in the same panel — it requires a manual Refresh click.

#### Subsections

| Subsection | Trigger | API endpoint(s) |
|---|---|---|
| Phase 7 Config | Auto-loads on first open | `GET /phase7/config` |
| Run Lifecycle Inspector | "Fetch" button | `GET /runs/{runId}/lifecycle` |
| Policy Decisions | "Fetch" button | `GET /runs/{runId}/policy` |
| Stale & Failed Runs | "Refresh" button (manual) | `GET /runs/stale`, `GET /runs/failed` |

#### Phase 7 Config

Displays the current Phase 7 feature flag state and timeout settings:

```
Code Change: ✅/❌ | Replanning: ✅/❌ | Policy Gate: ✅/❌
Cancel: ✅/❌ | Max Loops: {n} | Timeout: {n}ms | Stale HB: {n}ms
```

These correspond to the `ENABLE_CODE_CHANGE_WORKFLOW`, `ENABLE_REPLANNING`, `ENABLE_POLICY_GATE`, `RUN_TIMEOUT_MS`, and `STALE_HEARTBEAT_MS` environment variables. See [DEVELOPMENT.md](DEVELOPMENT.md) for the recommended order to enable them.

#### Run Lifecycle Inspector

| Control | Description |
|---|---|
| `run_id (UUID)` text input | UUID of the run to inspect |
| **Fetch** button | Disabled if the input is empty; calls `GET /runs/{runId}/lifecycle` |

Displays the complete lifecycle timeline for a run:

```
Status: {status} | OK: true/false/- | Events: {n} | Heartbeats: {n}
Created: {timestamp}
Worker: {timestamp} | Completed: {timestamp}
```

Additional fields appear only if set, with colour coding for abnormal states:

| Field | Colour | Meaning |
|---|---|---|
| `cancel_requested_at` | Orange | Cancellation was requested |
| `cancelled_at` | Red | Run was cancelled |
| `timeout_at` | Red | Run exceeded `RUN_TIMEOUT_MS` |
| `stale_at` | Red | No heartbeat for `STALE_HEARTBEAT_MS` |
| `fail_classification` | — | Failure category string |
| Status transitions | — | `{from} → {to} @ {timestamp}` list |

#### Policy Decisions

| Control | Description |
|---|---|
| `run_id` text input | UUID of the run to inspect |
| **Fetch** button | Disabled if the input is empty; calls `GET /runs/{runId}/policy` |

Shows every policy gate evaluation for that run:

```
Total: {n}

Verdict: {verdict} | Risk: {risk_level} | DAG: {dag_type} | Rules: {rule1, rule2}
{rationale text}
```

This subsection will always show `Total: 0` if `ENABLE_POLICY_GATE=false`. The policy gate is described in [DEVELOPMENT.md](DEVELOPMENT.md).

#### Stale & Failed Runs

| Control | Description |
|---|---|
| **Refresh** button | Calls `GET /runs/stale` and `GET /runs/failed` in parallel |

Unlike the Phase 7 Config subsection, this does **not** load automatically when the panel is opened. Click Refresh explicitly.

```
Stale: {n} runs
  {id (8 chars)}…  ({elapsed_ms}ms ago)

Failed: {n} runs
  {id (8 chars)}…  [{classification}]  (retriable / — )
```

---

### 4. AI Debug: DAG State

**Source:** `apps/web/src/App.tsx` (inline, not a separate component)
**Purpose:** Real-time monitoring of DAG execution state for a specific run — node statuses, attempt timings, and overall run health.

The panel has a **Show / Hide** toggle and a subtitle: `Polls /runs/:runId/dag-state every 1s`. It does **not** auto-load on open. The panel auto-expands automatically when a test run is created via the Event Trace Viewer.

#### Controls

| Control | Behaviour |
|---|---|
| `runId (UUID)` text input | Run ID to inspect; free text with UUID format hint |
| **Use current** button | Copies `currentRunId` from the last "Create Test Run" result; **disabled** if no test run has been created in this session |
| **Fetch once** button | One-shot `GET /runs/{runId}/dag-state`; **disabled** if the input is empty |
| **Start polling** (green) | Polls every 1000 ms; clears existing state when started |
| **Stop polling** (red) | Halts the interval; **preserves** the last fetched state in the display |

#### UUID hint

If the run ID input is non-empty but does not match the UUID pattern (`/^[0-9a-f]{8}-…-[0-9a-f]{12}$/i`), the following hint is shown inline:

```
Looks non-UUID; API will likely return 422.
```

No hint is shown for empty input or valid UUIDs.

#### Error states

| HTTP status | Message shown |
|---|---|
| 404 | `Run not found.` |
| 422 | `Validation error: {message}` |
| Other HTTP error | `API error (HTTP {status}): {message}` |
| Network / client error | `Network/client error: {message}` |

#### Summary grid

After a successful fetch or during polling, a 2-column grid shows run-level metadata:

| Field | Description |
|---|---|
| `status` | Current run status string |
| `ok` | `true` / `false` / `-` (boolean outcome if completed) |
| `created_at` | ISO timestamp |
| `planned_at` | ISO timestamp — when the DAG was selected |
| `started_at` | ISO timestamp — when the worker began execution |
| `completed_at` | ISO timestamp |
| `node_count` | Total number of nodes in the DAG |
| `run_id` | UUID echoed back from the response |

#### Nodes table

One row per DAG node, sorted by `node_order` from the API response:

| Column | Description |
|---|---|
| `node_id` | Node identifier |
| `kind` | Node type (e.g., `GENERATE_RESPONSE`, `REWARD_AGENT`) |
| `status` | `PENDING` / `RUNNING` / `SUCCEEDED` / `FAILED` / `SKIPPED` |
| `last_attempt` | Attempt number of the most recent attempt, or `-` |
| `attempt timings / bytes` | `#1 succeeded (2.345 s, bytes=1024)` — multiple attempts joined with ` \| ` |

#### Polling behaviour

- Interval: 1000 ms
- A `useRef` boolean guard (`inFlightRef`) prevents concurrent requests — if a response is still pending when the next tick fires, that tick is skipped silently
- Starting polling clears `dagState` and `dagLastUpdated` immediately
- Stopping polling preserves the last successfully fetched state
- The interval is cleaned up on component unmount

---

### 5. Event Trace Viewer

**Source:** `apps/web/src/App.tsx` (outer shell) + `apps/web/src/components/RunTraceViewer.tsx` (inner component)
**Purpose:** Create test runs and inspect their full ordered event log.

The panel has an orange top border (`#ff9800`) and a **DEV** badge to distinguish it visually. The `RunTraceViewer` component is only mounted after a successful "Create Test Run" — it does not appear until then.

#### Create Test Run button

| State | Behaviour |
|---|---|
| No chat selected | Button is **disabled** |
| Chat selected | `POST /runs` with hardcoded payload (see below) |

Hardcoded payload:

```json
{
  "chat_id": "<selected_chat_id>",
  "message": "Test message for Step 2",
  "model": "qwen-2.5-coder-3b",
  "provider": "qwen"
}
```

On success:
- `currentRunId` is set in `App.tsx` state
- The DAG State panel's run ID input is pre-filled
- The DAG State panel is auto-expanded
- `alert()` fires with the new run ID

On failure:
- `alert()` fires with the error message

#### RunTraceViewer

Once `currentRunId` is set, the `RunTraceViewer` component renders.

| Control | Behaviour |
|---|---|
| **View Run Trace** / **Hide Run Trace** toggle (blue) | Opens or closes the trace panel |
| **📋 Copy** button | Copies `runId` to clipboard; label changes to **✓ Copied** for 2 seconds |

**Fetch behaviour:** `GET /runs/{runId}/events` fires **only on the first open** (`!isOpen && !events`). Subsequent open/close cycles show the cached snapshot. To fetch a fresh trace for the same run, reload the page.

**Event list display:**

```
Total Events: {n}

▶  {EVENT_TYPE}                         {locale time}
   {full JSON when expanded}
```

Each event is a native `<details>` element. The summary shows the event `type` in blue and the emission time (locale-formatted). Expanding a row shows the full event JSON in a dark monospace block.

All event type names are defined in [EVENT_MODEL.md](EVENT_MODEL.md).

---

## API Endpoint Reference

All endpoints are relative to `VITE_API_URL` (default: `http://localhost:3001`).

| Panel | Method | Endpoint | Description |
|---|---|---|---|
| Event Trace Viewer | `POST` | `/runs` | Create a new run |
| Event Trace Viewer | `GET` | `/runs/{runId}/events` | All events for a run, ordered by `(ts ASC, id ASC)` |
| DAG State | `GET` | `/runs/{runId}/dag-state` | Current DAG execution state derived from the event log |
| Phase 7 Debug | `GET` | `/phase7/config` | Phase 7 feature flag and timeout configuration |
| Phase 7 Debug | `GET` | `/runs/{runId}/lifecycle` | Full run lifecycle: timestamps, heartbeat count, transitions |
| Phase 7 Debug | `GET` | `/runs/{runId}/policy` | Policy gate evaluations for a run |
| Phase 7 Debug | `GET` | `/runs/stale` | All runs with no heartbeat for longer than `STALE_HEARTBEAT_MS` |
| Phase 7 Debug | `GET` | `/runs/failed` | All failed runs with classification |
| Meta-Planner Debug | `GET` | `/meta-planner/config` | Meta-Planner feature flag and scoring weight configuration |
| Meta-Planner Debug | `GET` | `/runs/{runId}/meta-plan` | Planner events chain for a run |
| Memory Debug | `GET` | `/runs/{runId}/context` | M1/M2/M3 retrieval context for a run |
| Memory Debug | `GET` | `/memory/search?query={q}&top_k=5` | Cross-tier memory search |
| Memory Debug | `GET` | `/memory/procedures?limit=10` | Saved M3 procedural memory records |
| Memory Debug | `GET` | `/debug/embeddings/health` | Embedding provider type, model, and reachability |
| Memory Debug | `GET` | `/debug/cache/health` | Redis cache status and per-type flag state |

---

## Behaviour Reference

Common gotchas and non-obvious behaviours:

| Behaviour | Detail |
|---|---|
| "Create Test Run" payload is hardcoded | Model (`qwen-2.5-coder-3b`), provider (`qwen`), and message are fixed in source and cannot be changed from the UI |
| Event Trace does not re-fetch on re-open | Fetch only happens when `!isOpen && !events`; reload the page to get a fresh snapshot |
| DAG State polling skips overlapping ticks | `inFlightRef` prevents concurrent requests — slow API responses are handled gracefully |
| "Use current" and "Create Test Run" share state | `currentRunId` in `App.tsx` is the only cross-panel state coupling; "Use current" is disabled until a test run is created |
| Panel toggle states reset on page reload | All Show/Hide states are React `useState`; the exception is the DAG State panel, which is auto-expanded by "Create Test Run" |
| Auto-loading subsections fire on panel open | `useEffect(() => { … }, [])` inside each sub-component fires when the parent panel's body first renders — not on page load |
| No UUID hint in Phase 7 or Memory panels | Only the DAG State panel shows the "Looks non-UUID" hint; the other panels return an HTTP 422 from the API on invalid input |
| Stale & Failed Runs does not auto-load | This subsection is in the same `Phase7DebugPanel` component as Phase 7 Config (which does auto-load) but has no `useEffect` of its own |
| Memory Search accepts Enter key | `onKeyDown` for `e.key === "Enter"` on the search input — the only keyboard shortcut in the debug UI |

---

## Source Files

| File | Role |
|---|---|
| `apps/web/src/App.tsx` | `DEV_MODE` guard, DAG State panel (inline), Event Trace outer panel, `currentRunId` shared state |
| `apps/web/src/components/RunTraceViewer.tsx` | Event Trace inner component — fetch, toggle, copy, event list |
| `apps/web/src/components/MemoryDebugPanel.tsx` | Memory Debug panel — all four subsections |
| `apps/web/src/components/MetaPlannerPanel.tsx` | Meta-Planner Debug panel — config and plan inspector |
| `apps/web/src/components/Phase7DebugPanel.tsx` | Phase 7 Debug panel — all four subsections |
| `apps/web/src/api/client.ts` | `fetchDagState()` and `ApiError` class used by DAG State panel |

---

## Related Documentation

| Document | Relevance |
|---|---|
| [EVENT_MODEL.md](EVENT_MODEL.md) | All event `type` values shown in the Event Trace Viewer are defined here |
| [MEMORY_MODEL.md](MEMORY_MODEL.md) | M1/M2/M3 tier structure surfaced by the Memory Debug panel |
| [META_PLANNER.md](META_PLANNER.md) | Planning pipeline, scoring factors, and modes observed via Meta-Planner Debug |
| [DEVELOPMENT.md](DEVELOPMENT.md) | How to enable `ENABLE_REPLANNING`, `ENABLE_POLICY_GATE`, `ENABLE_CODE_CHANGE_WORKFLOW` — required for Phase 6/7 panels to show meaningful data |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Service map and data flow that the panels collectively expose |
