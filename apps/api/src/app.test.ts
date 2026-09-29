import { healthResponseSchema } from '@sing-along/shared';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app';

describe('GET /api/health', () => {
  it('returns 200 ok when the database answers, matching the shared schema', async () => {
    const app = buildApp({ db: { execute: async () => ({ rows: [{ ok: 1 }] }) } } as never);
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(healthResponseSchema.parse(res.json())).toEqual({ status: 'ok' });
  });

  it('returns 503 when the database is unreachable, without leaking why', async () => {
    const app = buildApp({
      db: {
        execute: async () => {
          throw new Error('connect ECONNREFUSED 10.0.0.5:5432');
        },
      },
    } as never);
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'unavailable' });
    expect(res.body).not.toContain('ECONNREFUSED');
  });

  it('does not wait forever for a hung database', async () => {
    const app = buildApp({
      db: { execute: () => new Promise(() => {}) },
      healthTimeoutMs: 30,
    } as never);
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(503);
  });
});
