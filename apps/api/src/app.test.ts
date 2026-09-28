import { healthResponseSchema } from '@sing-along/shared';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app';

describe('GET /api/health', () => {
  it('returns ok, matching the shared schema', async () => {
    const app = buildApp({} as never); // health touches neither db nor storage
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(healthResponseSchema.parse(res.json())).toEqual({ status: 'ok' });
  });
});
