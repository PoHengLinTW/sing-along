import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@sing-along/shared';
import { buildApp } from './app';

describe('GET /api/health', () => {
  it('returns ok, matching the shared schema', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(healthResponseSchema.parse(res.json())).toEqual({ status: 'ok' });
  });
});
