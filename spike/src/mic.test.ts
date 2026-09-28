import { describe, expect, it } from 'vitest';
import { checkMicSupport, describeMicError } from './mic';

describe('checkMicSupport', () => {
  it('rejects insecure contexts (http on the LAN)', () => {
    expect(checkMicSupport({ isSecureContext: false, hasGetUserMedia: true })).toEqual({
      ok: false,
      reason: 'insecure-context',
    });
  });
  it('rejects browsers without getUserMedia', () => {
    expect(checkMicSupport({ isSecureContext: true, hasGetUserMedia: false })).toEqual({
      ok: false,
      reason: 'no-getusermedia',
    });
  });
  it('accepts secure contexts with getUserMedia', () => {
    expect(checkMicSupport({ isSecureContext: true, hasGetUserMedia: true })).toEqual({ ok: true });
  });
});

describe('describeMicError', () => {
  it('maps NotAllowedError to a permission message', () => {
    expect(describeMicError({ name: 'NotAllowedError' })).toMatch(/denied/i);
  });
  it('maps NotFoundError to a no-device message', () => {
    expect(describeMicError({ name: 'NotFoundError' })).toMatch(/no microphone/i);
  });
  it('falls back to the error name', () => {
    expect(describeMicError({ name: 'WeirdError' })).toContain('WeirdError');
  });
});
