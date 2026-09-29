import { relative, sep } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

// Vite names build output assets/<name>-<hash>.<ext>: the name changes with the content.
const HASHED_ASSET = /^\/assets\/.+-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/;
const IMMUTABLE = 'public, max-age=31536000, immutable';

/** Serves the built SPA from `dir`. Hashed assets are cached for a year; everything else must revalidate. */
export async function registerWebApp(app: FastifyInstance, dir: string) {
  await app.register(fastifyStatic, {
    root: dir,
    cacheControl: false, // set per file below
    setHeaders(reply, filePath) {
      const url = `/${relative(dir, filePath).split(sep).join('/')}`;
      reply.header('cache-control', HASHED_ASSET.test(url) ? IMMUTABLE : 'no-cache');
    },
  });
}

/** A page navigation (not an API call, not a missing file) that should get the SPA shell. */
export function wantsSpaShell(method: string, url: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  const path = url.split('?')[0] ?? '/';
  if (path === '/api' || path.startsWith('/api/')) return false;
  const last = path.split('/').pop() ?? '';
  return !last.includes('.'); // /assets/x.js that does not exist must stay a 404
}
