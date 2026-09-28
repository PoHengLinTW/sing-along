import type { HealthResponse } from '@sing-along/shared';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import Fastify from 'fastify';
import { registerErrorHandler } from './errors';
import { registerProjectRoutes } from './routes/projects';
import type { Storage } from './storage/types';

export interface Deps {
  db: NodePgDatabase;
  storage: Storage;
}

export function buildApp(deps: Deps) {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  app.get('/api/health', async (): Promise<HealthResponse> => ({ status: 'ok' }));
  registerProjectRoutes(app, deps);
  return app;
}
