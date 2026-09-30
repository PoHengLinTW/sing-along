import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { FakeStorage } from './test/helpers';

function appWithLogSink() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  const app = buildApp({
    db: {} as never,
    storage: new FakeStorage(),
    logger: { level: 'error', stream },
  });
  return { app, lines };
}

describe('global error handler', () => {
  it('logs the details on the server and returns a generic 500 without a stack trace', async () => {
    const { app, lines } = appWithLogSink();
    app.get('/api/boom', async () => {
      throw new Error('relation "secret_table" does not exist');
    });
    const res = await app.inject({ method: 'GET', url: '/api/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ message: 'Something went wrong on the server.' });
    expect(res.body).not.toContain('secret_table');
    expect(res.body).not.toContain('at ');
    const log = lines.join('');
    expect(log).toContain('secret_table');
    expect(log).toContain('/api/boom');
    await app.close();
  });

  it('keeps client errors (bad JSON) as 4xx with a message, not 500', async () => {
    const { app } = appWithLogSink();
    app.post('/api/echo', async (req) => req.body);
    const res = await app.inject({
      method: 'POST',
      url: '/api/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{nope',
    });
    expect(res.statusCode).toBe(400);
    expect(typeof res.json().message).toBe('string');
    await app.close();
  });

  it('never leaks an unknown route as an HTML page', async () => {
    const { app } = appWithLogSink();
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ message: 'Not found' });
    await app.close();
  });
});
