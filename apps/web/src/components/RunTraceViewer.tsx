// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

import { useState } from 'react';

interface RunEvent {
  ts: string;
  run_id: string;
  chat_id: string;
  type: string;
  data: Record<string, unknown>;
}

interface ListRunEventsResponse {
  run_id: string;
  events: RunEvent[];
  total: number;
}

interface RunTraceViewerProps {
  runId: string;
  apiBaseUrl: string;
}

export function RunTraceViewer({ runId, apiBaseUrl }: RunTraceViewerProps) {
  const [events, setEvents] = useState<ListRunEventsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadEvents = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/runs/${runId}/events`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data: ListRunEventsResponse = await response.json();
      setEvents(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = () => {
    if (!isOpen && !events) {
      loadEvents();
    }
    setIsOpen(!isOpen);
  };

  const copyRunId = () => {
    navigator.clipboard.writeText(runId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={styles.container}>
      <button onClick={handleToggle} style={styles.button}>
        {isOpen ? 'Hide Run Trace' : 'View Run Trace'}
      </button>

      {isOpen && (
        <div style={styles.panel}>
          <div style={styles.header}>
            <h3 style={styles.heading}>Run Trace</h3>
            <div style={styles.runIdContainer}>
              <code style={styles.runId}>{runId}</code>
              <button onClick={copyRunId} style={styles.copyButton} title="Copy Run ID">
                {copied ? '✓ Copied' : '📋 Copy'}
              </button>
            </div>
          </div>

          {loading && <p style={styles.loadingText}>Loading events...</p>}
          {error && <p style={styles.error}>Error: {error}</p>}

          {events && (
            <div>
              <p style={styles.total}>
                <strong>Total Events:</strong> {events.total}
              </p>
              <div style={styles.eventList}>
                {events.events.map((event, idx) => (
                  <details key={idx} style={styles.eventItem}>
                    <summary style={styles.summary}>
                      <span style={styles.eventType}>{event.type}</span>
                      <span style={styles.timestamp}>
                        {new Date(event.ts).toLocaleTimeString()}
                      </span>
                    </summary>
                    <pre style={styles.eventData}>
                      {JSON.stringify(event, null, 2)}
                    </pre>
                  </details>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    marginTop: '1rem',
  },
  button: {
    padding: '0.5rem 1rem',
    background: '#0066cc',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
  },
  panel: {
    marginTop: '1rem',
    padding: '1rem',
    background: '#f5f5f5',
    borderRadius: '4px',
    maxHeight: '400px',
    overflow: 'auto',
    border: '1px solid #ddd',
  },
  header: {
    marginBottom: '1rem',
    borderBottom: '2px solid #ddd',
    paddingBottom: '0.75rem',
  },
  heading: {
    marginTop: 0,
    marginBottom: '0.5rem',
    fontSize: '16px',
    fontWeight: 600,
    color: '#1a1a1a',
  },
  runIdContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    flexWrap: 'wrap' as const,
  },
  runId: {
    background: '#e8e8e8',
    padding: '0.25rem 0.5rem',
    borderRadius: '3px',
    fontSize: '11px',
    fontFamily: 'monospace',
    color: '#333',
    border: '1px solid #ccc',
    wordBreak: 'break-all' as const,
    flex: '1 1 auto',
  },
  copyButton: {
    padding: '0.25rem 0.5rem',
    background: '#fff',
    border: '1px solid #ccc',
    borderRadius: '3px',
    cursor: 'pointer',
    fontSize: '11px',
    color: '#555',
    whiteSpace: 'nowrap' as const,
  },
  loadingText: {
    color: '#333',
    fontSize: '14px',
  },
  error: {
    color: '#d32f2f',
    fontWeight: 500,
  },
  total: {
    marginBottom: '1rem',
    fontSize: '14px',
    color: '#333',
  },
  eventList: {
    fontFamily: 'monospace',
    fontSize: '12px',
  },
  eventItem: {
    marginBottom: '0.5rem',
    background: 'white',
    padding: '0.5rem',
    borderRadius: '4px',
    border: '1px solid #e0e0e0',
  },
  summary: {
    cursor: 'pointer',
    fontWeight: 'bold',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    color: '#1a1a1a',
  },
  eventType: {
    color: '#0066cc',
    fontWeight: 600,
  },
  timestamp: {
    color: '#666',
    fontSize: '11px',
    fontWeight: 'normal',
  },
  eventData: {
    background: '#1e1e1e',
    color: '#d4d4d4',
    padding: '0.75rem',
    borderRadius: '4px',
    marginTop: '0.5rem',
    overflow: 'auto',
    fontSize: '12px',
    lineHeight: '1.5',
    border: '1px solid #333',
  } as React.CSSProperties,
};
