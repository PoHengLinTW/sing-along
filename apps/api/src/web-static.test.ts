import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';

let dir: string;
let app: ReturnType<typeof buildApp>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'web-dist-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Sing-along</title>');
  writeFileSync(join(dir, 'assets', 'index-Bx3k9dQ2.js'), 'console.log(1)');
  writeFileSync(join(dir, 'assets', 'index-Cd41xYz7.css'), 'body{}');
  writeFileSync(join(dir, 'sw.js'), '// service worker');
  writeFileSync(join(dir, 'manifest.webmanifest'), '{}');
  writeFileSync(join(dir, 'favicon.svg'), '<svg/>');
  app = buildApp({ db: {} as never, storage: {} as never, webDir: dir });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const get = (url: string) => app.inject({ method: 'GET', url });

describe('static web app', () => {
  it('serves index.html at / and never lets it be cached', async () => {
    const res = await get('/');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Sing-along');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it.each(['/assets/index-Bx3k9dQ2.js', '/assets/index-Cd41xYz7.css'])(
    'serves hashed asset %s as immutable for a year',
    async (url) => {
      const res = await get(url);
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    },
  );

  it.each(['/sw.js', '/manifest.webmanifest', '/favicon.svg'])(
    'serves %s with no-cache (not content-hashed)',
    async (url) => {
      const res = await get(url);
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('no-cache');
    },
  );

  it('falls back to index.html for a client-side route (deep link), with no-cache', async () => {
    const res = await get('/project/42');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Sing-along');
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('answers a missing file (has an extension) with 404, not index.html', async () => {
    const res = await get('/assets/index-Missing99.js');
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('Sing-along');
  });

  it('keeps /api/* on the API: known routes work and unknown ones are a JSON 404', async () => {
    expect((await get('/api/nope')).json()).toEqual({ message: 'Not found' });
    expect((await get('/api/nope')).statusCode).toBe(404);
  });

  it('does not serve index.html for non-GET methods', async () => {
    const res = await app.inject({ method: 'POST', url: '/project/42' });
    expect(res.statusCode).toBe(404);
  });

  it('refuses path traversal out of the web directory', async () => {
    const secret = join(dir, '..', `secret-${Date.now()}.txt`);
    writeFileSync(secret, 'top secret');
    try {
      for (const url of [`/..%2f${secret.split('/').pop()}`, `/../${secret.split('/').pop()}`]) {
        const res = await get(url);
        expect(res.body).not.toContain('top secret');
      }
    } finally {
      rmSync(secret, { force: true });
    }
  });
});

describe('without a web directory (dev)', () => {
  it('serves no pages, only the API', async () => {
    const api = buildApp({ db: {} as never, storage: {} as never });
    expect((await api.inject({ method: 'GET', url: '/' })).statusCode).toBe(404);
    await api.close();
  });
});
