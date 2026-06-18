// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

import { ZodError, ZodSchema } from 'zod';
import type { ErrorResponse } from '@cognitive-runtime/contracts';

/**
 * Custom validation error
 * - statusCode=422 so Fastify can return Unprocessable Entity
 * - issues shape matches ErrorResponse['issues']
 */
export class ValidationError extends Error {
  public readonly statusCode = 422;
  public readonly code = 'VALIDATION_ERROR' as const;

  constructor(
    public readonly issues: ErrorResponse['issues'],
    message = 'Invalid request data'
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validate data against a Zod schema
 * @throws ValidationError if validation fails
 */
export function validate<T>(schema: ZodSchema<T>, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof ZodError) {
      const issues = error.errors.map((err) => ({
        path: err.path.map(String),
        message: err.message,
      }));
      throw new ValidationError(issues, 'Invalid request data');
    }
    throw error;
  }
}

/**
 * Safe validation that returns result object
 */
export function validateSafe<T>(
  schema: ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; error: ValidationError } {
  try {
    const result = schema.parse(data);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof ZodError) {
      const issues = error.errors.map((err) => ({
        path: err.path.map(String),
        message: err.message,
      }));
      return {
        success: false,
        error: new ValidationError(issues, 'Invalid request data'),
      };
    }
    throw error;
  }
}
