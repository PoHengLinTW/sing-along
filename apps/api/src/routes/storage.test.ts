import { DEFAULT_CAPS } from '@sing-along/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { projects, tracks } from '../db/schema';
import { createTestDb } from '../test/db';
import { FakeStorage } from '../test/helpers';

let t: Awaited<ReturnType<typeof createTestDb>>;
let app: FastifyInstance;

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await app?.close();
  await t.drop();
});
beforeEach(async () => {
  await t.db.delete(projects);
  app = buildApp({
    db: t.db,
    storage: new FakeStorage(),
    caps: { ...DEFAULT_CAPS, maxProjects: 5 },
  });
});

const track = (projectId: number, sizeBytes: number, status: 'active' | 'pending') => ({
  projectId,
  name: 't',
  durationMs: 1000,
  mimeType: 'audio/flac',
  sizeBytes,
  storageKey: `k/${crypto.randomUUID()}`,
  peaks: [0],
  source: 'upload' as const,
  status,
});

describe('GET /api/storage', () => {
  it('reports zero usage and the limits on an empty install', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/storage' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      usedBytes: 0,
      limitBytes: DEFAULT_CAPS.maxStorageBytes,
      projectCount: 0,
      projectLimit: 5,
      maxFileBytes: DEFAULT_CAPS.maxFileBytes,
      maxTrackMs: DEFAULT_CAPS.maxTrackMs,
      maxTracksPerProject: DEFAULT_CAPS.maxTracksPerProject,
    });
  });

  it('counts active tracks only in usedBytes, and all projects', async () => {
    const [a, b] = await t.db
      .insert(projects)
      .values([{ title: 'A' }, { title: 'B' }])
      .returning();
    await t.db
      .insert(tracks)
      .values([
        track(a!.id, 1000, 'active'),
        track(b!.id, 2000, 'active'),
        track(b!.id, 999_999, 'pending'),
      ]);
    const json = (await app.inject({ method: 'GET', url: '/api/storage' })).json();
    expect(json.usedBytes).toBe(3000);
    expect(json.projectCount).toBe(2);
  });

  it('sums past 2^31 bytes', async () => {
    const [a] = await t.db.insert(projects).values({ title: 'A' }).returning();
    await t.db
      .insert(tracks)
      .values([2_000_000_000, 2_000_000_000].map((n) => track(a!.id, n, 'active')));
    expect((await app.inject({ method: 'GET', url: '/api/storage' })).json().usedBytes).toBe(
      4_000_000_000,
    );
  });
});
