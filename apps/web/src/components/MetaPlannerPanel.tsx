// Cognitive Runtime © 2026 by Donald Dominko
// Licensed under CC BY-NC-SA 4.0
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// apps/web/src/components/MetaPlannerPanel.tsx
// Phase 6: Minimal Meta-Planner debug panel for AI Debug in the web UI.

import { useState, useEffect } from 'react';
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

async function fetchJson<T>(url: string): Promise<T> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json() as Promise<T>;
}

function ConfigSection() {
  const [cfg, setCfg] = useState<any>(null);
  useEffect(() => { fetchJson<any>(`${API_URL}/meta-planner/config`).then(setCfg).catch(() => {}); }, []);
  if (!cfg) return <div style={s.muted}>Loading config...</div>;
  return (
    <div style={s.section}>
      <div style={s.title}>Planner Config</div>
      <div style={s.box}>
        <div><b>Enabled:</b> {cfg.enabled ? '✅' : '❌'} | <b>Synthesis:</b> {cfg.allow_synthesis ? '✅' : '❌'} | <b>Min Reward:</b> {cfg.min_pattern_reward}</div>
        <div><b>Weights:</b> Q={cfg.weights?.quality} L={cfg.weights?.latency} C={cfg.weights?.cost} R={cfg.weights?.risk}</div>
      </div>
    </div>
  );
}

function PlanInspector() {
  const [runId, setRunId] = useState('');
  const [plan, setPlan] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetch_ = async () => {
    if (!runId.trim()) return;
    setLoading(true); setErr(null);
    try { setPlan(await fetchJson<any>(`${API_URL}/runs/${runId.trim()}/meta-plan`)); }
    catch (e: any) { setErr(e?.message || 'Failed'); setPlan(null); }
    finally { setLoading(false); }
  };

  return (
    <div style={s.section}>
      <div style={s.title}>Plan Inspector</div>
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem' }}>
        <input value={runId} onChange={e => setRunId(e.target.value)} placeholder="run_id (UUID)" style={s.input} />
        <button onClick={fetch_} disabled={!runId.trim() || loading} style={s.btn}>{loading ? '...' : 'Fetch'}</button>
      </div>
      {err && <div style={s.err}>{err}</div>}
      {plan && (
        <div style={s.box}>
          <div><b>Events:</b> {plan.planner_event_count}</div>
          {plan.started && <div><b>Enabled:</b> {plan.started.enabled ? '✅' : '❌'} v{plan.started.planner_version}</div>}
          {plan.skipped && <div><b>Skipped:</b> {plan.skipped.reason}</div>}
          {plan.context_retrieved && <div><b>Context:</b> M1={plan.context_retrieved.m1_count} M3={plan.context_retrieved.m3_count} M2={plan.context_retrieved.has_m2_summary ? '✅' : '❌'}</div>}
          {plan.candidates_built?.length > 0 && (
            <div style={{ marginTop: '0.3rem' }}>
              <b>Candidates ({plan.candidates_built.length}):</b>
              {plan.candidates_built.map((c: any, i: number) => (
                <div key={i} style={{ fontSize: 11, padding: '1px 0' }}>
                  <code>{c.candidate_id?.slice(0,8)}</code> [{c.source}] mode={c.mode} score={c.predicted_total_score?.toFixed(3)}
                </div>
              ))}
            </div>
          )}
          {plan.decision_made && (
            <div style={{ marginTop: '0.3rem' }}>
              <b>Decision:</b> <code>{plan.decision_made.candidate_id?.slice(0,8)}</code> mode={plan.decision_made.mode} score={plan.decision_made.predicted_total_score?.toFixed(3)}
              {plan.decision_made.fallback_used && <span style={{ color: '#f0ad4e' }}> (FALLBACK)</span>}
            </div>
          )}
          {plan.fallback_used && <div style={{ color: '#f0ad4e' }}><b>Fallback:</b> {plan.fallback_used.reason}</div>}
          {plan.evaluated && (
            <div style={{ marginTop: '0.3rem' }}>
              <b>Evaluation:</b> predicted={plan.evaluated.predicted_total_score?.toFixed(3)} actual={plan.evaluated.actual_reward_score?.toFixed(3)} error={plan.evaluated.prediction_error?.toFixed(3)}
            </div>
          )}
          {plan.failed && <div style={{ color: '#d9534f' }}><b>Failed:</b> [{plan.failed.code}] {plan.failed.message}</div>}
        </div>
      )}
    </div>
  );
}

export default function MetaPlannerPanel() {
  const [open, setOpen] = useState(false);
  return (
    <div style={s.wrapper}>
      <div style={s.header}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>Meta-Planner Debug</span>
        <button onClick={() => setOpen(v => !v)} style={s.toggle}>{open ? 'Hide' : 'Show'}</button>
      </div>
      {open && (
        <div style={s.body}>
          <ConfigSection />
          <PlanInspector />
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
