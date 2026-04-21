// Cognitive Runtime © 2026 by Donald Dominko
// Licensed under CC BY-NC-SA 4.0
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

// packages/storage/src/validate.ts
// Thin Zod validation wrapper used at all storage read/write boundaries.
// Throws a typed ValidationError with Zod issue details rather than a raw ZodError.
// Invariant: all EventLog reads and writes go through validate() to enforce the contract.
// Exports: ValidationError, validate

import { z } from 'zod';

/** Structured error thrown when a Zod schema parse fails at a storage boundary. */
export class ValidationError extends Error {
  issues?: z.ZodIssue[];
  constructor(message: string, issues?: z.ZodIssue[]) {
    super(message);
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

export function validate<T>(schema: z.ZodType<T>, data: unknown): T {
  const res = schema.safeParse(data);
  if (!res.success) {
    throw new ValidationError('Schema validation failed', res.error.issues);
  }
  return res.data;
}
