// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/contracts/src/api-dtos.ts
// Zod schemas and TypeScript types for all API request/response shapes.
// These DTOs are the contract between the Fastify API and its clients (web app, smoke tests).
// Invariant: DAG state and run status responses are derived from events, never stored directly.
// Exports: zCreateChatRequest/Response, zCreateMessageRequest/Response, zCreateRunRequest/Response,
//          zListRunEventsParams/Query/Response, zGetRunStatusParams/Response,
//          zGetDagStateParams/Response, zErrorResponse, and their TypeScript types.

import { z } from 'zod';
import { zUUID, zRole } from './common.js';
import { zRunEvent } from './events.js';
import { zDagRunState, zRunStatus } from './dag.js';

/**
 * Chat endpoints
 */
export const zCreateChatRequest = z.object({
  title: z.string().min(1).max(255).optional(),
});

export const zCreateChatResponse = z.object({
  chat_id: zUUID,
  created_at: z.string(),
});

export type CreateChatRequest = z.infer<typeof zCreateChatRequest>;
export type CreateChatResponse = z.infer<typeof zCreateChatResponse>;

/**
 * Message endpoints
 */
export const zCreateMessageRequest = z.object({
  chat_id: zUUID,
  role: zRole,
  content: z.string().min(1),
});

export const zCreateMessageResponse = z.object({
  message_id: zUUID,
  chat_id: zUUID,
  role: zRole,
  content: z.string(),
  created_at: z.string(),
});

export type CreateMessageRequest = z.infer<typeof zCreateMessageRequest>;
export type CreateMessageResponse = z.infer<typeof zCreateMessageResponse>;

/**
 * Run endpoints
 */
export const zCreateRunRequest = z.object({
  chat_id: zUUID,
  message: z.string().min(1),
  model: z.string().optional(),
  provider: z.string().optional(),
  execute: z.boolean().optional().default(true),
});

export const zCreateRunResponse = z.object({
  run_id: zUUID,
  trace_id: zUUID,
  chat_id: zUUID,
});

export type CreateRunRequest = z.infer<typeof zCreateRunRequest>;
export type CreateRunResponse = z.infer<typeof zCreateRunResponse>;

/**
 * Run events endpoint
 */
export const zListRunEventsParams = z.object({
  runId: zUUID,
});

export const zListRunEventsQuery = z.object({
  limit: z.coerce.number().int().positive().max(1000).optional(),
});

export const zListRunEventsResponse = z.object({
  run_id: zUUID,
  events: z.array(zRunEvent),
  total: z.number().int().nonnegative(),
});

export type ListRunEventsParams = z.infer<typeof zListRunEventsParams>;
export type ListRunEventsQuery = z.infer<typeof zListRunEventsQuery>;
export type ListRunEventsResponse = z.infer<typeof zListRunEventsResponse>;

/**
 * Run status endpoint (derived from events)
 */
export const zGetRunStatusParams = z.object({
  runId: zUUID,
});

export const zGetRunStatusResponse = z.object({
  run_id: zUUID,
  status: zRunStatus,
});

export type GetRunStatusParams = z.infer<typeof zGetRunStatusParams>;
export type GetRunStatusResponse = z.infer<typeof zGetRunStatusResponse>;

/**
 * DAG state endpoint (derived from events)
 */
export const zGetDagStateParams = z.object({
  runId: zUUID,
});

export const zGetDagStateResponse = z.object({
  dag_state: zDagRunState,
});

export type GetDagStateParams = z.infer<typeof zGetDagStateParams>;
export type GetDagStateResponse = z.infer<typeof zGetDagStateResponse>;

/**
 * Error response
 */
export const zErrorResponse = z.object({
  error: z.string(),
  message: z.string(),
  issues:
    z
      .array(
        z.object({
          path: z.array(z.union([z.string(), z.number()])),
          message: z.string(),
        })
      )
      .optional(),
});

export type ErrorResponse = z.infer<typeof zErrorResponse>;
