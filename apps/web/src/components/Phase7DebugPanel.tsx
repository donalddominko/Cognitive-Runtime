// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// apps/web/src/components/Phase7DebugPanel.tsx
// Phase 7: Minimal debug panel for production hardening observability.

import { useState, useEffect } from 'react';
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

async function fetchJson<T>(url: string): Promise<T> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json() as Promise<T>;
}

function Phase7Config() {
  const [cfg, setCfg] = useState<any>(null);
  useEffect(() => { fetchJson<any>(`${API_URL}/phase7/config`).then(setCfg).catch(() => {}); }, []);
  if (!cfg) return <div style={s.muted}>Loading config...</div>;
  return (
    <div style={s.section}>
      <div style={s.title}>Phase 7 Config</div>
      <div style={s.box}>
        <div><b>Code Change:</b> {cfg.enable_code_change_workflow ? '✅' : '❌'} | <b>Replanning:</b> {cfg.enable_replanning ? '✅' : '❌'} | <b>Policy Gate:</b> {cfg.enable_policy_gate ? '✅' : '❌'}</div>
        <div><b>Cancel:</b> {cfg.enable_run_cancellation ? '✅' : '❌'} | <b>Max Loops:</b> {cfg.max_planner_loops} | <b>Timeout:</b> {cfg.run_timeout_ms}ms | <b>Stale HB:</b> {cfg.stale_heartbeat_ms}ms</div>
      </div>
    </div>
  );
}

function LifecycleInspector() {
  const [runId, setRunId] = useState('');
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetch_ = async () => {
    if (!runId.trim()) return;
    setLoading(true); setErr(null);
    try { setData(await fetchJson<any>(`${API_URL}/runs/${runId.trim()}/lifecycle`)); }
    catch (e: any) { setErr(e?.message || 'Failed'); setData(null); }
    finally { setLoading(false); }
  };

  return (
    <div style={s.section}>
      <div style={s.title}>Run Lifecycle</div>
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem' }}>
        <input value={runId} onChange={e => setRunId(e.target.value)} placeholder="run_id (UUID)" style={s.input} />
        <button onClick={fetch_} disabled={!runId.trim() || loading} style={s.btn}>{loading ? '...' : 'Fetch'}</button>
      </div>
      {err && <div style={s.err}>{err}</div>}
      {data && (
        <div style={s.box}>
          <div><b>Status:</b> {data.status} | <b>OK:</b> {data.ok === null ? '-' : String(data.ok)} | <b>Events:</b> {data.event_count} | <b>Heartbeats:</b> {data.heartbeat_count}</div>
          <div><b>Created:</b> {data.created_at || '-'}</div>
          <div><b>Worker:</b> {data.worker_started_at || '-'} | <b>Completed:</b> {data.completed_at || '-'}</div>
          {data.cancel_requested_at && <div style={{ color: '#f0ad4e' }}><b>Cancel Requested:</b> {data.cancel_requested_at}</div>}
          {data.cancelled_at && <div style={{ color: '#d9534f' }}><b>Cancelled:</b> {data.cancelled_at}</div>}
          {data.timeout_at && <div style={{ color: '#d9534f' }}><b>Timeout:</b> {data.timeout_at}</div>}
          {data.stale_at && <div style={{ color: '#d9534f' }}><b>Stale:</b> {data.stale_at}</div>}
          {data.fail_classification && <div><b>Fail Class:</b> {data.fail_classification}</div>}
          {data.status_transitions?.length > 0 && (
            <div style={{ marginTop: '0.3rem' }}>
              <b>Transitions:</b>
              {data.status_transitions.map((t: any, i: number) => (
                <div key={i} style={{ fontSize: 10, padding: '1px 0' }}>{t.from} → {t.to} @ {t.ts}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PolicyInspector() {
  const [runId, setRunId] = useState('');
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const fetch_ = async () => {
    if (!runId.trim()) return;
    setErr(null);
    try { setData(await fetchJson<any>(`${API_URL}/runs/${runId.trim()}/policy`)); }
    catch (e: any) { setErr(e?.message || 'Failed'); setData(null); }
  };

  return (
    <div style={s.section}>
      <div style={s.title}>Policy Decisions</div>
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem' }}>
        <input value={runId} onChange={e => setRunId(e.target.value)} placeholder="run_id" style={s.input} />
        <button onClick={fetch_} disabled={!runId.trim()} style={s.btn}>Fetch</button>
      </div>
      {err && <div style={s.err}>{err}</div>}
      {data && (
        <div style={s.box}>
          <div><b>Total:</b> {data.total}</div>
          {data.policy_evaluations?.map((p: any, i: number) => (
            <div key={i} style={{ fontSize: 10, padding: '2px 0', borderTop: '1px solid #30363d', marginTop: '0.2rem' }}>
              <b>Verdict:</b> {p.verdict} | <b>Risk:</b> {p.risk_level} | <b>DAG:</b> {p.dag_type} | <b>Rules:</b> {p.rules_checked?.join(', ')}
              <div>{p.rationale}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StaleAndFailed() {
  const [stale, setStale] = useState<any>(null);
  const [failed, setFailed] = useState<any>(null);

  const fetchBoth = async () => {
    try { setStale(await fetchJson<any>(`${API_URL}/runs/stale`)); } catch { setStale({ stale_runs: [], total: 0 }); }
    try { setFailed(await fetchJson<any>(`${API_URL}/runs/failed`)); } catch { setFailed({ failed_runs: [], total: 0 }); }
  };

  return (
    <div style={s.section}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={s.title}>Stale & Failed Runs</div>
        <button onClick={fetchBoth} style={s.btn}>Refresh</button>
      </div>
      {stale && <div style={s.box}><b>Stale:</b> {stale.total} runs {stale.stale_runs?.slice(0, 5).map((r: any, i: number) => <div key={i} style={{ fontSize: 10 }}>{r.run_id?.slice(0, 8)}... ({r.elapsed_since_hb_ms}ms ago)</div>)}</div>}
      {failed && <div style={{ ...s.box, marginTop: '0.3rem' }}><b>Failed:</b> {failed.total} runs {failed.failed_runs?.slice(0, 5).map((r: any, i: number) => <div key={i} style={{ fontSize: 10 }}>{r.run_id?.slice(0, 8)}... [{r.classification}] {r.retriable ? '(retriable)' : ''}</div>)}</div>}
    </div>
  );
}

export default function Phase7DebugPanel() {
  const [open, setOpen] = useState(false);
  return (
    <div style={s.wrapper}>
      <div style={s.header}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>Phase 7 Debug</span>
        <button onClick={() => setOpen(v => !v)} style={s.toggle}>{open ? 'Hide' : 'Show'}</button>
      </div>
      {open && (
        <div style={s.body}>
          <Phase7Config />
          <LifecycleInspector />
          <PolicyInspector />
          <StaleAndFailed />
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrapper: { borderTop: '1px solid #2f3542', background: '#0d1117', color: '#e6e6e6', padding: '0.5rem 1rem', maxHeight: '40vh', overflow: 'auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' },
  toggle: { padding: '0.3rem 0.5rem', background: '#2d3445', color: '#e6e6e6', border: '1px solid #3b4257', borderRadius: 5, cursor: 'pointer', fontSize: 11, fontWeight: 600 },
  body: { display: 'flex', flexDirection: 'column', gap: '0.5rem', paddingTop: '0.4rem' },
  section: { background: '#161b22', border: '1px solid #30363d', borderRadius: 6, padding: '0.5rem' },
  title: { fontSize: 12, fontWeight: 700, marginBottom: '0.3rem' },
  input: { flex: 1, padding: '0.35rem 0.5rem', borderRadius: 5, border: '1px solid #30363d', background: '#0d1117', color: '#e6e6e6', fontFamily: 'monospace', fontSize: 11 },
  btn: { padding: '0.35rem 0.6rem', background: '#2d3445', color: '#e6e6e6', border: '1px solid #3b4257', borderRadius: 5, cursor: 'pointer', fontSize: 11, fontWeight: 600 },
  err: { background: '#2a0f14', border: '1px solid #6e1c2a', color: '#ffd7de', padding: '0.3rem 0.4rem', borderRadius: 5, fontSize: 11, marginBottom: '0.3rem' },
  box: { background: '#0d1117', border: '1px solid #30363d', borderRadius: 5, padding: '0.4rem', fontSize: 11 },
  muted: { fontSize: 11, opacity: 0.7 },
};
