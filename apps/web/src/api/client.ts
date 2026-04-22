// Cognitive Runtime © 2026 by Donald Dominko
// Licensed under CC BY-NC-SA 4.0
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

import type { Chat, Message } from '../types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export type ApiIssue = {
  path?: string[];
  message: string;
};

export type ErrorResponse = {
  error: string;
  message: string;
  issues?: ApiIssue[];
};

export class ApiError extends Error {
  public readonly status: number;
  public readonly payload?: unknown;

  constructor(args: { status: number; message: string; payload?: unknown }) {
    super(args.message);
    this.name = 'ApiError';
    this.status = args.status;
    this.payload = args.payload;
  }
}

function tryParseErrorResponse(payload: unknown): ErrorResponse | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as any;
  if (typeof p.message !== 'string') return null;
  if (typeof p.error !== 'string') return null;

  const issues: ApiIssue[] | undefined = Array.isArray(p.issues)
    ? p.issues
        .map((x: any) => {
          const msg = typeof x?.message === 'string' ? x.message : null;
          if (!msg) return null;
          const path = Array.isArray(x?.path) ? x.path.map(String) : undefined;
          return { message: msg, path };
        })
        .filter(Boolean)
    : undefined;

  return { error: p.error, message: p.message, issues };
}

async function fetchAPI<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });

  if (!response.ok) {
    let payload: unknown = undefined;

    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }

    const errParsed = tryParseErrorResponse(payload);
    const msg =
      errParsed?.message ||
      `API error: HTTP ${response.status} ${response.statusText || ''}`.trim();

    throw new ApiError({ status: response.status, message: msg, payload });
  }

  return response.json();
}

export async function fetchChats(): Promise<Chat[]> {
  const data = await fetchAPI<{ chats: Chat[] }>('/chats');
  return data.chats;
}

export async function createChat(title: string): Promise<Chat> {
  return fetchAPI<Chat>('/chats', {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
}

export async function fetchMessages(chatId: string): Promise<Message[]> {
  const data = await fetchAPI<{ messages: Message[] }>(`/chats/${chatId}/messages`);
  return data.messages;
}

export async function sendMessage(
  chatId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<Message> {
  return fetchAPI<Message>(`/chats/${chatId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ role, content }),
  });
}

/**
 * NOTE: This function is currently not used by App.tsx.
 * It is kept for compatibility with older experiments.
 */
export async function createRun(chatId: string, userMessage: string): Promise<{ runId: string }> {
  const data = await fetchAPI<{ run_id: string }>('/runs', {
    method: 'POST',
    body: JSON.stringify({
      chat_id: chatId,
      message: userMessage,
      model: 'qwen-2.5-coder-3b',
      provider: 'qwen',
      execute: true,
    }),
  });

  return { runId: data.run_id };
}

export type DagStateAttempt = {
  attempt: number;
  status: string;
  started_at?: string;
  finished_at?: string;
  output_summary?: {
    bytes?: number;
  };
};

export type DagStateNode = {
  node_id: string;
  kind: string;
  status: string;
  last_attempt?: number;
  attempts?: DagStateAttempt[];
};

export type DagState = {
  run_id: string;
  chat_id: string;
  dag_id: string;
  status: string;
  created_at?: string;
  planned_at?: string;
  started_at?: string;
  completed_at?: string;
  ok?: boolean;
  node_count?: number;
  node_order?: string[];
  nodes?: DagStateNode[];
};

export async function fetchDagState(runId: string): Promise<DagState> {
  const data = await fetchAPI<{ dag_state: DagState }>(`/runs/${runId}/dag-state`);
  return data.dag_state;
}
