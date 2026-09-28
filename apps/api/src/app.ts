import type { HealthResponse } from '@sing-along/shared';
import Fastify from 'fastify';

export function buildApp() {
  const app = Fastify({ logger: false });
  app.get('/api/health', async (): Promise<HealthResponse> => ({ status: 'ok' }));
  return app;
}
