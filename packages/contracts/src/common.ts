// Cognitive Runtime © 2026 by Donald Dominko
// Licensed under CC BY-NC-SA 4.0
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/contracts/src/common.ts
// Shared primitive Zod schemas and TypeScript types used throughout all contracts.
// This file is the foundation of the contract system — every other contract file imports from here.
// Invariant: no business logic lives here; only reusable schema primitives.
// Exports: SCHEMA_VERSION, zSchemaVersion, zISODateString, ISODateString, zUUID, UUID, zLayer, Layer, zRole, Role

import { z } from 'zod';

/**
 * Schema version for the contract system.
 * Increment when making breaking changes to event structures.
 */
export const SCHEMA_VERSION = '0.1.0' as const;

export const zSchemaVersion = z.literal(SCHEMA_VERSION);

/**
 * ISO 8601 datetime string with timezone
 */
export const zISODateString = z.string().datetime();
export type ISODateString = z.infer<typeof zISODateString>;

/**
 * UUID v4 format for run_id and trace_id
 */
export const zUUID = z.string().uuid();
export type UUID = z.infer<typeof zUUID>;

/**
 * Layer enum for the cognitive runtime hierarchy
 */
export const zLayer = z.enum(['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7']);
export type Layer = z.infer<typeof zLayer>;

/**
 * Chat role enum
 */
export const zRole = z.enum(['user', 'assistant', 'system']);
export type Role = z.infer<typeof zRole>;
