// Cognitive Runtime © 2026 by Donald Dominko
// Licensed under CC BY-NC-SA 4.0
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

import type { FastifyPluginAsync } from 'fastify';

/**
 * RETIRED: Do not use this plugin.
 *
 * Step 3C hardening requirement: register ONE Fastify error handler via
 * fastify.setErrorHandler(...) in apps/api/src/index.ts.
 *
 * This stub exists to fail fast if someone accidentally re-registers it.
 */
export const errorHandlerPlugin: FastifyPluginAsync = async () => {
  throw new Error(
    'errorHandlerPlugin is retired. Use fastify.setErrorHandler in apps/api/src/index.ts'
  );
};
