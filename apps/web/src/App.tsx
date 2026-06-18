// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

import { useEffect, useMemo, useRef, useState } from 'react';
import Sidebar from './components/Sidebar';
import ChatPanel from './components/ChatPanel';
import { RunTraceViewer } from './components/RunTraceViewer';
import { fetchChats, createChat, fetchDagState, ApiError } from './api/client';
import type { Chat } from './types';
import type { DagState, DagStateNode, DagStateAttempt } from './api/client';
import MemoryDebugPanel from './components/MemoryDebugPanel';
import MetaPlannerPanel from './components/MetaPlannerPanel';
import Phase7DebugPanel from './components/Phase7DebugPanel';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const DEV_MODE = import.meta.env.DEV;

function isLikelyUuid(value: string): boolean {
  const v = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function formatIso(value?: string | null): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString();
}

function msBetween(start?: string, end?: string): number | null {
  if (!start || !end) return null;
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const ms = b - a;
  return Number.isFinite(ms) ? ms : null;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '-';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(3)} s`;
}

function sortNodes(state: DagState): DagStateNode[] {
  const nodes = Array.isArray(state.nodes) ? state.nodes : [];
  const order = Array.isArray(state.node_order) ? state.node_order : null;

  if (!order || order.length === 0) return nodes;

  const byId = new Map(nodes.map((n) => [n.node_id, n]));
  const sorted: DagStateNode[] = [];
  for (const id of order) {
    const n = byId.get(id);
    if (n) sorted.push(n);
  }
  for (const n of nodes) {
    if (!order.includes(n.node_id)) sorted.push(n);
  }
  return sorted;
}

function renderAttempts(attempts: DagStateAttempt[] | undefined): string {
  if (!attempts || attempts.length === 0) return '-';

  return attempts
    .map((a) => {
      const dur = formatDuration(msBetween(a.started_at, a.finished_at));
      const bytes =
        typeof a.output_summary?.bytes === 'number' ? String(a.output_summary.bytes) : '-';
      return `#${a.attempt} ${a.status} (${dur}, bytes=${bytes})`;
    })
    .join(' | ');
}

function App() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);

  const [showDagPanel, setShowDagPanel] = useState(false);
  const [dagRunId, setDagRunId] = useState('');
  const [dagPolling, setDagPolling] = useState(false);
  const [dagState, setDagState] = useState<DagState | null>(null);
  const [dagError, setDagError] = useState<string | null>(null);
  const [dagLastUpdated, setDagLastUpdated] = useState<string | null>(null);

  const inFlightRef = useRef(false);
  const intervalRef = useRef<number | null>(null);

  const sortedDagNodes = useMemo(() => {
    if (!dagState) return [];
    return sortNodes(dagState);
  }, [dagState]);

  useEffect(() => {
    loadChats();
  }, []);

  useEffect(() => {
    if (!dagPolling) {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    const runId = dagRunId.trim();
    if (!runId) {
      setDagError('Enter a runId to start polling.');
      setDagPolling(false);
      return;
    }

    const tick = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      try {
        const data = await fetchDagState(runId);
        setDagState(data);
        setDagError(null);
        setDagLastUpdated(new Date().toISOString());
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.status === 404) setDagError('Run not found.');
          else if (err.status === 422) setDagError(`Validation error: ${err.message}`);
          else setDagError(`API error (HTTP ${err.status}): ${err.message}`);
        } else {
          const msg = (err as any)?.message || String(err);
          setDagError(`Network/client error: ${msg}`);
        }
      } finally {
        inFlightRef.current = false;
      }
    };

    tick();
    intervalRef.current = window.setInterval(tick, 1000);

    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [dagPolling, dagRunId]);

  const loadChats = async () => {
    try {
      setLoading(true);
      const data = await fetchChats();
      setChats(data);
    } catch (error) {
      console.error('Failed to load chats:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleNewChat = async () => {
    try {
      const newChat = await createChat('New Chat');
      setChats([newChat, ...chats]);
      setSelectedChatId(newChat.id);
    } catch (error) {
      console.error('Failed to create chat:', error);
    }
  };

  const handleTestRun = async () => {
    if (!selectedChatId) {
      alert('Please select a chat first');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: selectedChatId,
          message: 'Test message for Step 2',
          model: 'qwen-2.5-coder-3b',
          provider: 'qwen',
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      setCurrentRunId(data.run_id);

      if (typeof data.run_id === 'string' && data.run_id.length > 0) {
        setDagRunId(data.run_id);
        setShowDagPanel(true);
      }

      alert(`Run created: ${data.run_id}`);
    } catch (error) {
      console.error('Failed to create run:', error);
      alert(`Error: ${error}`);
    }
  };

  const handleDagFetchOnce = async () => {
    const runId = dagRunId.trim();
    setDagState(null);
    setDagLastUpdated(null);

    if (!runId) {
      setDagError('Enter a runId.');
      return;
    }

    try {
      inFlightRef.current = true;
      const data = await fetchDagState(runId);
      setDagState(data);
      setDagError(null);
      setDagLastUpdated(new Date().toISOString());
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 404) setDagError('Run not found.');
        else if (err.status === 422) setDagError(`Validation error: ${err.message}`);
        else setDagError(`API error (HTTP ${err.status}): ${err.message}`);
      } else {
        const msg = (err as any)?.message || String(err);
        setDagError(`Network/client error: ${msg}`);
      }
    } finally {
      inFlightRef.current = false;
    }
  };

  const handleDagStartStop = () => {
    if (dagPolling) {
      setDagPolling(false);
      return;
    }

    const runId = dagRunId.trim();
    setDagState(null);
    setDagLastUpdated(null);

    if (!runId) {
      setDagError('Enter a runId to start polling.');
      return;
    }

    setDagError(null);
    setDagPolling(true);
  };

  const dagRunIdHint = useMemo(() => {
    const v = dagRunId.trim();
    if (!v) return null;
    if (isLikelyUuid(v)) return null;
    return 'Looks non-UUID; API will likely return 422.';
  }, [dagRunId]);

  return (
    <div style={styles.container}>
      <Sidebar
        chats={chats}
        selectedChatId={selectedChatId}
        onSelectChat={setSelectedChatId}
        onNewChat={handleNewChat}
        loading={loading}
      />
      <div style={styles.mainPanel}>
        <ChatPanel chatId={selectedChatId} onNewChat={handleNewChat} />

	{DEV_MODE && <MemoryDebugPanel />}
	{DEV_MODE && <MetaPlannerPanel />}
	{DEV_MODE && <Phase7DebugPanel />}

        {DEV_MODE && (
          <div style={styles.aiDebugWrapper}>
            <div style={styles.aiDebugHeader}>
              <div style={styles.aiDebugTitleRow}>
                <span style={styles.aiDebugTitle}>AI Debug: DAG State</span>
                <button
                  onClick={() => setShowDagPanel((v) => !v)}
                  style={styles.aiDebugToggle}
                  type="button"
                >
                  {showDagPanel ? 'Hide' : 'Show'}
                </button>
              </div>
              <div style={styles.aiDebugSub}>
                Polls <code>{`${API_BASE_URL}/runs/:runId/dag-state`}</code> every 1s.
              </div>
            </div>

            {showDagPanel && (
              <div style={styles.aiDebugBody}>
                <div style={styles.dagControlsRow}>
                  <input
                    value={dagRunId}
                    onChange={(e) => setDagRunId(e.target.value)}
                    placeholder="runId (UUID)"
                    style={styles.dagRunIdInput}
                  />
                  <button
                    onClick={() => {
                      if (currentRunId) setDagRunId(currentRunId);
                    }}
                    style={styles.dagSmallButton}
                    disabled={!currentRunId}
                    type="button"
                    title="Copy current runId from Step 2 test run button"
                  >
                    Use current
                  </button>
                  <button
                    onClick={handleDagFetchOnce}
                    style={styles.dagSmallButton}
                    disabled={!dagRunId.trim()}
                    type="button"
                  >
                    Fetch once
                  </button>
                  <button
                    onClick={handleDagStartStop}
                    style={dagPolling ? styles.dagStopButton : styles.dagStartButton}
                    type="button"
                  >
                    {dagPolling ? 'Stop polling' : 'Start polling'}
                  </button>
                </div>

                {dagRunIdHint && <div style={styles.dagHint}>{dagRunIdHint}</div>}

                {dagError && (
                  <div style={styles.dagErrorBox}>
                    <strong style={{ marginRight: 8 }}>Error:</strong>
                    <span>{dagError}</span>
                  </div>
                )}

                {dagLastUpdated && (
                  <div style={styles.dagMetaRow}>
                    <span>
                      Last updated: <code>{formatIso(dagLastUpdated)}</code>
                    </span>
                  </div>
                )}

                {dagState && (
                  <>
                    <div style={styles.dagSummaryGrid}>
                      <div>
                        <div style={styles.dagLabel}>Status</div>
                        <div style={styles.dagValue}>
                          <code>{dagState.status}</code>
                        </div>
                      </div>
                      <div>
                        <div style={styles.dagLabel}>ok</div>
                        <div style={styles.dagValue}>
                          <code>
                            {typeof dagState.ok === 'boolean' ? String(dagState.ok) : '-'}
                          </code>
                        </div>
                      </div>
                      <div>
                        <div style={styles.dagLabel}>created_at</div>
                        <div style={styles.dagValue}>
                          <code>{formatIso(dagState.created_at)}</code>
                        </div>
                      </div>
                      <div>
                        <div style={styles.dagLabel}>planned_at</div>
                        <div style={styles.dagValue}>
                          <code>{formatIso(dagState.planned_at)}</code>
                        </div>
                      </div>
                      <div>
                        <div style={styles.dagLabel}>started_at</div>
                        <div style={styles.dagValue}>
                          <code>{formatIso(dagState.started_at)}</code>
                        </div>
                      </div>
                      <div>
                        <div style={styles.dagLabel}>completed_at</div>
                        <div style={styles.dagValue}>
                          <code>{formatIso(dagState.completed_at)}</code>
                        </div>
                      </div>
                      <div>
                        <div style={styles.dagLabel}>node_count</div>
                        <div style={styles.dagValue}>
                          <code>
                            {typeof dagState.node_count === 'number' ? dagState.node_count : '-'}
                          </code>
                        </div>
                      </div>
                      <div>
                        <div style={styles.dagLabel}>run_id</div>
                        <div style={styles.dagValue}>
                          <code>{dagState.run_id}</code>
                        </div>
                      </div>
                    </div>

                    <div style={styles.dagTableWrapper}>
                      <table style={styles.dagTable}>
                        <thead>
                          <tr>
                            <th style={styles.th}>node_id</th>
                            <th style={styles.th}>kind</th>
                            <th style={styles.th}>status</th>
                            <th style={styles.th}>last_attempt</th>
                            <th style={styles.th}>attempt timings / bytes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedDagNodes.length === 0 ? (
                            <tr>
                              <td style={styles.td} colSpan={5}>
                                No nodes yet.
                              </td>
                            </tr>
                          ) : (
                            sortedDagNodes.map((n) => (
                              <tr key={n.node_id}>
                                <td style={styles.td}>
                                  <code>{n.node_id}</code>
                                </td>
                                <td style={styles.td}>
                                  <code>{n.kind}</code>
                                </td>
                                <td style={styles.td}>
                                  <code>{n.status}</code>
                                </td>
                                <td style={styles.td}>
                                  <code>
                                    {typeof n.last_attempt === 'number' ? n.last_attempt : '-'}
                                  </code>
                                </td>
                                <td style={styles.td}>
                                  <code>{renderAttempts(n.attempts)}</code>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {DEV_MODE && (
          <div style={styles.devPanel}>
            <div style={styles.devHeader}>
              <span style={styles.devBadge}>DEV</span>
              <span style={styles.devTitle}>Step 2: Event Trace Viewer</span>
            </div>
            <button onClick={handleTestRun} style={styles.testButton} disabled={!selectedChatId}>
              Create Test Run
            </button>
            {currentRunId && <RunTraceViewer runId={currentRunId} apiBaseUrl={API_BASE_URL} />}
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    height: '100vh',
    width: '100vw',
    overflow: 'hidden',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  mainPanel: {
    display: 'flex',
    flexDirection: 'column' as const,
    flex: 1,
    overflow: 'hidden',
  },

  aiDebugWrapper: {
    borderTop: '1px solid #2f3542',
    background: '#141823',
    color: '#e6e6e6',
    padding: '0.75rem 1rem',
    maxHeight: '45vh',
    overflow: 'auto' as const,
  },
  aiDebugHeader: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.25rem',
    marginBottom: '0.5rem',
  },
  aiDebugTitleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.75rem',
  },
  aiDebugTitle: {
    fontSize: '14px',
    fontWeight: 700,
  },
  aiDebugToggle: {
    padding: '0.35rem 0.6rem',
    background: '#2d3445',
    color: '#e6e6e6',
    border: '1px solid #3b4257',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
  },
  aiDebugSub: {
    fontSize: 12,
    opacity: 0.9,
  },
  aiDebugBody: {
    paddingTop: '0.5rem',
  },

  dagControlsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    flexWrap: 'wrap' as const,
    marginBottom: '0.5rem',
  },
  dagRunIdInput: {
    flex: 1,
    minWidth: 320,
    padding: '0.45rem 0.6rem',
    borderRadius: 6,
    border: '1px solid #3b4257',
    background: '#0f1320',
    color: '#e6e6e6',
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    fontSize: 12,
  },
  dagSmallButton: {
    padding: '0.45rem 0.6rem',
    background: '#2d3445',
    color: '#e6e6e6',
    border: '1px solid #3b4257',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
  },
  dagStartButton: {
    padding: '0.45rem 0.75rem',
    background: '#1f8a4c',
    color: '#ffffff',
    border: '1px solid #1f8a4c',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 700,
  },
  dagStopButton: {
    padding: '0.45rem 0.75rem',
    background: '#b23b3b',
    color: '#ffffff',
    border: '1px solid #b23b3b',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 700,
  },
  dagHint: {
    fontSize: 12,
    opacity: 0.85,
    marginBottom: '0.5rem',
  },
  dagErrorBox: {
    background: '#2a0f14',
    border: '1px solid #6e1c2a',
    color: '#ffd7de',
    padding: '0.5rem 0.6rem',
    borderRadius: 6,
    fontSize: 12,
    marginBottom: '0.5rem',
  },
  dagMetaRow: {
    fontSize: 12,
    opacity: 0.9,
    marginBottom: '0.5rem',
  },
  dagSummaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '0.5rem 1rem',
    background: '#0f1320',
    border: '1px solid #3b4257',
    borderRadius: 8,
    padding: '0.6rem',
    marginBottom: '0.75rem',
  },
  dagLabel: {
    fontSize: 11,
    opacity: 0.8,
    marginBottom: 4,
  },
  dagValue: {
    fontSize: 12,
  },
  dagTableWrapper: {
    border: '1px solid #3b4257',
    borderRadius: 8,
    overflow: 'hidden',
  },
  dagTable: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: 12,
  },
  th: {
    textAlign: 'left' as const,
    padding: '0.5rem 0.6rem',
    borderBottom: '1px solid #3b4257',
    background: '#0f1320',
    color: '#e6e6e6',
    fontWeight: 700,
  },
  td: {
    padding: '0.5rem 0.6rem',
    borderBottom: '1px solid #2a3144',
    verticalAlign: 'top' as const,
  },

  devPanel: {
    borderTop: '2px solid #ff9800',
    background: '#fff3e0',
    padding: '1rem',
    maxHeight: '50vh',
    overflow: 'auto' as const,
  },
  devHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    marginBottom: '1rem',
  },
  devBadge: {
    background: '#ff9800',
    color: 'white',
    padding: '0.25rem 0.5rem',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: 'bold',
  },
  devTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#333',
  },
  testButton: {
    padding: '0.5rem 1rem',
    background: '#4caf50',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
    marginBottom: '1rem',
  },
};

export default App;
