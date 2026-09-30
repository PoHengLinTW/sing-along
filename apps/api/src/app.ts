import type { Caps, HealthResponse } from '@sing-along/shared';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { registerErrorHandler } from './errors';
import { registerLabelRoutes } from './routes/labels';
import { registerProjectRoutes } from './routes/projects';
import { registerStorageRoutes } from './routes/storage';
import { registerTrackRoutes } from './routes/tracks';
import type { Storage } from './storage/types';
import { registerWebApp } from './web-static';

export interface Deps {
  db: NodePgDatabase;
  storage: Storage;
  /** Lifetime of presigned URLs; defaults to 900 s. */
  presignTtlSec?: number;
  /** Storage caps (PRD §5.9); defaults to `DEFAULT_CAPS`. */
  caps?: Caps;
  /** Fastify logger options; off by default so tests stay quiet. The server logs errors. */
  logger?: FastifyServerOptions['logger'];
  /** Built web app to serve (production). Unset in dev, where Vite serves it. */
  webDir?: string;
  /** How long /api/health waits for the database; defaults to 2000 ms. */
  healthTimeoutMs?: number;
}

export function buildApp(deps: Deps) {
  const app = Fastify({ logger: deps.logger ?? false, bodyLimit: 2 * 1024 * 1024 }); // peaks JSON can reach ~500 KB;
  registerErrorHandler(app, { spaFallback: !!deps.webDir });
  app.get('/api/health', async (_req, reply): Promise<HealthResponse> => {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        deps.db.execute(sql`select 1`),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('database timeout')),
            deps.healthTimeoutMs ?? 2000,
          );
        }),
      ]);
      return { status: 'ok' };
    } catch {
      return reply.status(503).send({ status: 'unavailable' });
    } finally {
      clearTimeout(timer);
    }
  });
  registerProjectRoutes(app, deps);
  registerTrackRoutes(app, deps);
  registerLabelRoutes(app, deps);
  registerStorageRoutes(app, deps);
  if (deps.webDir) void registerWebApp(app, deps.webDir);
  return app;
}
