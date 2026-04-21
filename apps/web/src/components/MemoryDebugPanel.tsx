// Cognitive Runtime © 2026 by Donald Dominko
// Licensed under CC BY-NC-SA 4.0
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// apps/web/src/components/MemoryDebugPanel.tsx
// Phase 5.1: Minimal debug panel for memory system, embeddings, and cache status.
// Shows: Run Context, Memory Search, Saved Procedures, System Debug.

import { useState, useEffect } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Minimal fetch helper.
async function fetchJson<T>(url: string): Promise<T> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json() as Promise<T>;
}

// ── Sub-components ──────────────────────────────────────────────────────────

function RunContextSection() {
  const [runId, setRunId] = useState('');
  const [ctx, setCtx] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchCtx = async () => {
    if (!runId.trim()) return;
    setLoading(true);
    setErr(null);
    try {
      const data = await fetchJson<any>(`${API_URL}/runs/${runId.trim()}/context`);
      setCtx(data);
    } catch (e: any) {
      setErr(e?.message || 'Failed');
      setCtx(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={sectionStyle}>
      <div style={sectionTitle}>Run Context</div>
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem' }}>
        <input
          value={runId}
          onChange={(e) => setRunId(e.target.value)}
          placeholder="run_id (UUID)"
          style={inputStyle}
        />
        <button onClick={fetchCtx} disabled={!runId.trim() || loading} style={btnStyle}>
          {loading ? '...' : 'Fetch'}
        </button>
      </div>
      {err && <div style={errStyle}>{err}</div>}
      {ctx && (
        <div style={resultBox}>
          <div><b>M1:</b> {ctx.m1_count ?? 0} &nbsp; <b>M2:</b> {ctx.m2_count ?? 0} &nbsp; <b>M3:</b> {ctx.m3_count ?? 0}</div>
          {Array.isArray(ctx.retrievals) && ctx.retrievals.length > 0 && (
            <div style={{ marginTop: '0.3rem', fontSize: 11 }}>
              {ctx.retrievals.map((r: any, i: number) => (
                <div key={i} style={{ marginBottom: 2 }}>
                  <code>[{r.tier}]</code> top_k={r.top_k} results={r.result_count}
                  {r.record_ids?.length > 0 && <span> ids: {r.record_ids.slice(0, 3).map((id: string) => id.slice(0, 8)).join(', ')}{r.record_ids.length > 3 ? '...' : ''}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MemorySearchSection() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const doSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setErr(null);
    try {
      const data = await fetchJson<any>(`${API_URL}/memory/search?query=${encodeURIComponent(query.trim())}&top_k=5`);
      setResults(data);
    } catch (e: any) {
      setErr(e?.message || 'Failed');
      setResults(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={sectionStyle}>
      <div style={sectionTitle}>Memory Search</div>
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem' }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search memory..."
          style={inputStyle}
          onKeyDown={(e) => e.key === 'Enter' && doSearch()}
        />
        <button onClick={doSearch} disabled={!query.trim() || loading} style={btnStyle}>
          {loading ? '...' : 'Search'}
        </button>
      </div>
      {err && <div style={errStyle}>{err}</div>}
      {results && (
        <div style={resultBox}>
          <div style={{ marginBottom: '0.3rem' }}><b>Total:</b> {results.total ?? 0}</div>
          {results.m1?.length > 0 && (
            <div style={{ marginBottom: '0.3rem' }}>
              <div style={tierLabel}>M1 Episodes ({results.m1.length})</div>
              {results.m1.slice(0, 3).map((r: any) => (
                <div key={r.id} style={itemStyle}>
                  <code>{r.id?.slice(0, 8)}</code> {r.title?.slice(0, 60)}
                </div>
              ))}
            </div>
          )}
          {results.m2?.length > 0 && (
            <div style={{ marginBottom: '0.3rem' }}>
              <div style={tierLabel}>M2 Semantic ({results.m2.length})</div>
              {results.m2.slice(0, 3).map((r: any) => (
                <div key={r.id} style={itemStyle}>
                  <code>{r.id?.slice(0, 8)}</code> {r.text?.slice(0, 60)}
                </div>
              ))}
            </div>
          )}
          {results.m3?.length > 0 && (
            <div style={{ marginBottom: '0.3rem' }}>
              <div style={tierLabel}>M3 Procedures ({results.m3.length})</div>
              {results.m3.slice(0, 3).map((r: any) => (
                <div key={r.id} style={itemStyle}>
                  <code>{r.id?.slice(0, 8)}</code> {r.name?.slice(0, 60)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProceduresSection() {
  const [procs, setProcs] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    try {
      const data = await fetchJson<any>(`${API_URL}/memory/procedures?limit=10`);
      setProcs(data?.procedures ?? []);
      setLoaded(true);
    } catch {
      setProcs([]);
      setLoaded(true);
    }
  };

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={sectionTitle}>Saved Procedures</div>
        <button onClick={load} style={btnStyle}>{loaded ? 'Refresh' : 'Load'}</button>
      </div>
      {loaded && procs.length === 0 && <div style={{ fontSize: 11, opacity: 0.7 }}>No procedures saved yet.</div>}
      {procs.map((p: any) => (
        <div key={p.id} style={itemStyle}>
          <code>{p.id?.slice(0, 8)}</code> <b>{p.name}</b> <span style={{ opacity: 0.7 }}>v{p.version} [{p.status}]</span>
        </div>
      ))}
    </div>
  );
}

function SystemDebugSection() {
  const [embInfo, setEmbInfo] = useState<any>(null);
  const [cacheInfo, setCacheInfo] = useState<any>(null);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    try {
      const [emb, cache] = await Promise.all([
        fetchJson<any>(`${API_URL}/debug/embeddings/health`).catch(() => null),
        fetchJson<any>(`${API_URL}/debug/cache/health`).catch(() => null),
      ]);
      setEmbInfo(emb);
      setCacheInfo(cache);
      setLoaded(true);
    } catch {
      setLoaded(true);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={sectionTitle}>System Debug</div>
        <button onClick={load} style={btnStyle}>Refresh</button>
      </div>
      {embInfo && (
        <div style={resultBox}>
          <div><b>Embedding:</b> {embInfo.provider_type} ({embInfo.model_name})</div>
          <div>Dim: {embInfo.dimension} | Reachable: {embInfo.reachable ? '✅' : '❌'} | Dev fallback: {embInfo.is_dev_fallback ? 'yes' : 'no'}</div>
        </div>
      )}
      {cacheInfo && (
        <div style={{ ...resultBox, marginTop: '0.3rem' }}>
          <div><b>Cache:</b> Redis {cacheInfo.redis_enabled ? '✅' : '❌'}</div>
          <div>Embeddings: {cacheInfo.cache_embeddings ? '✅' : '❌'} | Retrieval: {cacheInfo.cache_retrieval ? '✅' : '❌'} | WorkCtx: {cacheInfo.cache_working_context ? '✅' : '❌'}</div>
        </div>
      )}
      {loaded && !embInfo && !cacheInfo && <div style={{ fontSize: 11, opacity: 0.7 }}>Debug endpoints unavailable.</div>}
    </div>
  );
}

// ── Main export ─────────────────────────────────────────────────────────────

export default function MemoryDebugPanel() {
  const [open, setOpen] = useState(false);

  return (
    <div style={wrapperStyle}>
      <div style={headerStyle}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>Memory Debug</span>
        <button onClick={() => setOpen((v) => !v)} style={toggleBtn}>
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open && (
        <div style={bodyStyle}>
          <SystemDebugSection />
          <RunContextSection />
          <MemorySearchSection />
          <ProceduresSection />
        </div>
      )}
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const wrapperStyle: React.CSSProperties = {
  borderTop: '1px solid #2f3542',
  background: '#0d1117',
  color: '#e6e6e6',
  padding: '0.5rem 1rem',
  maxHeight: '40vh',
  overflow: 'auto',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '0.25rem',
};

const toggleBtn: React.CSSProperties = {
  padding: '0.3rem 0.5rem',
  background: '#2d3445',
  color: '#e6e6e6',
  border: '1px solid #3b4257',
  borderRadius: 5,
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
};

const bodyStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  paddingTop: '0.4rem',
};

const sectionStyle: React.CSSProperties = {
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: 6,
  padding: '0.5rem',
};

const sectionTitle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  marginBottom: '0.3rem',
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: '0.35rem 0.5rem',
  borderRadius: 5,
  border: '1px solid #30363d',
  background: '#0d1117',
  color: '#e6e6e6',
  fontFamily: 'monospace',
  fontSize: 11,
};

const btnStyle: React.CSSProperties = {
  padding: '0.35rem 0.6rem',
  background: '#2d3445',
  color: '#e6e6e6',
  border: '1px solid #3b4257',
  borderRadius: 5,
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
};

const errStyle: React.CSSProperties = {
  background: '#2a0f14',
  border: '1px solid #6e1c2a',
  color: '#ffd7de',
  padding: '0.3rem 0.4rem',
  borderRadius: 5,
  fontSize: 11,
  marginBottom: '0.3rem',
};

const resultBox: React.CSSProperties = {
  background: '#0d1117',
  border: '1px solid #30363d',
  borderRadius: 5,
  padding: '0.4rem',
  fontSize: 11,
};

const tierLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  opacity: 0.9,
  marginBottom: 2,
};

const itemStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '2px 0',
  borderBottom: '1px solid #21262d',
};
