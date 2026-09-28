import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './index';

describe('healthResponseSchema', () => {
  it('accepts a valid health response', () => {
    expect(healthResponseSchema.parse({ status: 'ok' })).toEqual({ status: 'ok' });
  });
  it('rejects anything else', () => {
    expect(() => healthResponseSchema.parse({ status: 'nope' })).toThrow();
  });
});
