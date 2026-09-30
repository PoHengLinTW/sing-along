import { describe, expect, it } from 'vitest';
import { evaluatePreflight, type PreflightResponse } from './cors-check';

const APP = 'https://sing.example.com';
const res = (headers: Record<string, string>, status = 200): PreflightResponse => ({
  status,
  headers: new Headers(headers),
});
const good = {
  'access-control-allow-origin': APP,
  'access-control-allow-methods': 'GET, PUT, HEAD',
  'access-control-allow-headers': 'Content-Type, Content-Length',
};

describe('evaluatePreflight: the app origin', () => {
  it('passes when the origin, the three methods and Content-Type are allowed', () => {
    expect(evaluatePreflight(APP, true, res(good))).toEqual({
      origin: APP,
      expectAllowed: true,
      problems: [],
    });
  });

  it('fails without an allow-origin header', () => {
    const { 'access-control-allow-origin': _o, ...rest } = good;
    expect(evaluatePreflight(APP, true, res(rest)).problems[0]).toMatch(
      /does not allow the origin/,
    );
  });

  it('fails when allow-origin names another origin', () => {
    const r = res({ ...good, 'access-control-allow-origin': 'https://other.example' });
    expect(evaluatePreflight(APP, true, r).problems).not.toEqual([]);
  });

  it.each(['GET', 'PUT', 'HEAD'])('fails when %s is not allowed', (method) => {
    const methods = ['GET', 'PUT', 'HEAD'].filter((m) => m !== method).join(', ');
    const r = res({ ...good, 'access-control-allow-methods': methods });
    expect(evaluatePreflight(APP, true, r).problems.join()).toContain(method);
  });

  it('fails when Content-Type is not an allowed header (the upload sends it)', () => {
    const r = res({ ...good, 'access-control-allow-headers': 'Authorization' });
    expect(evaluatePreflight(APP, true, r).problems.join()).toMatch(/Content-Type/);
  });

  it('accepts a wildcard for methods and headers', () => {
    const r = res({
      ...good,
      'access-control-allow-methods': '*',
      'access-control-allow-headers': '*',
    });
    expect(evaluatePreflight(APP, true, r).problems).toEqual([]);
  });

  it('fails on a non-2xx preflight', () => {
    expect(evaluatePreflight(APP, true, res(good, 403)).problems.join()).toMatch(/403/);
  });
});

describe('evaluatePreflight: a foreign origin', () => {
  const evil = 'https://evil.example';
  it('passes when storage refuses it (no allow-origin header)', () => {
    expect(evaluatePreflight(evil, false, res({}, 403)).problems).toEqual([]);
    expect(evaluatePreflight(evil, false, res({})).problems).toEqual([]);
  });
  it('fails when storage echoes the foreign origin', () => {
    const r = res({ 'access-control-allow-origin': evil });
    expect(evaluatePreflight(evil, false, r).problems.join()).toMatch(/must be rejected/);
  });
  it('fails when storage allows every origin with *', () => {
    const r = res({ 'access-control-allow-origin': '*' });
    expect(evaluatePreflight(evil, false, r).problems.join()).toMatch(/must be rejected/);
  });
});
