import type { HealthResponse } from '@sing-along/shared';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import Fastify from 'fastify';
import { registerErrorHandler } from './errors';
import { registerLabelRoutes } from './routes/labels';
import { registerProjectRoutes } from './routes/projects';
import { registerTrackRoutes } from './routes/tracks';
import type { Storage } from './storage/types';

export interface Deps {
  db: NodePgDatabase;
  storage: Storage;
  /** Lifetime of presigned URLs; defaults to 900 s. */
  presignTtlSec?: number;
}

export function buildApp(deps: Deps) {
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 }); // peaks JSON can reach ~500 KB;
  registerErrorHandler(app);
  app.get('/api/health', async (): Promise<HealthResponse> => ({ status: 'ok' }));
  registerProjectRoutes(app, deps);
  registerTrackRoutes(app, deps);
  registerLabelRoutes(app, deps);
  return app;
}
