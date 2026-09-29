import { DEFAULT_CAPS } from '@sing-along/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { projects, tracks } from '../db/schema';
import { createTestDb } from '../test/db';
import { FakeStorage } from '../test/helpers';

let t: Awaited<ReturnType<typeof createTestDb>>;
let app: FastifyInstance;
let projectId: number;

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await app?.close();
  await t.drop();
});

const build = (caps: Partial<typeof DEFAULT_CAPS> = {}) => {
  app = buildApp({ db: t.db, storage: new FakeStorage(), caps: { ...DEFAULT_CAPS, ...caps } });
};

beforeEach(async () => {
  await t.db.delete(projects);
  const [p] = await t.db.insert(projects).values({ title: 'P' }).returning();
  projectId = p!.id;
  build();
});

const body = (over: Record<string, unknown> = {}) => ({
  name: 'Take',
  mimeType: 'audio/flac',
  sizeBytes: 5000,
  durationMs: 4000,
  source: 'upload',
  peaks: [0.5],
  ...over,
});
const upload = (over?: Record<string, unknown>, id = projectId) =>
  app.inject({ method: 'POST', url: `/api/projects/${id}/tracks/upload-url`, payload: body(over) });

async function seedTracks(
  n: number,
  over: Partial<typeof tracks.$inferInsert> = {},
  pid = projectId,
) {
  await t.db.insert(tracks).values(
    Array.from({ length: n }, (_, i) => ({
      projectId: pid,
      name: `t${i}`,
      durationMs: 1000,
      mimeType: 'audio/flac',
      sizeBytes: 100,
      storageKey: `k/${crypto.randomUUID()}`,
      peaks: [0],
      source: 'upload' as const,
      status: 'active' as const,
      ...over,
    })),
  );
}

describe('file size cap', () => {
  const max = DEFAULT_CAPS.maxFileBytes;
  it('accepts exactly the limit and one byte under', async () => {
    expect((await upload({ sizeBytes: max })).statusCode).toBe(201);
    expect((await upload({ sizeBytes: max - 1 })).statusCode).toBe(201);
  });
  it('rejects one byte over with 413 FILE_TOO_LARGE', async () => {
    const res = await upload({ sizeBytes: max + 1 });
    expect(res.statusCode).toBe(413);
    expect(res.json().code).toBe('FILE_TOO_LARGE');
    expect(res.json().message).toContain('60 MB');
  });
  it('creates no pending row when rejected', async () => {
    await upload({ sizeBytes: max + 1 });
    expect(await t.db.select().from(tracks)).toHaveLength(0);
  });
});

describe('duration cap', () => {
  const max = DEFAULT_CAPS.maxTrackMs;
  it('accepts exactly 10 minutes and just under', async () => {
    expect((await upload({ durationMs: max })).statusCode).toBe(201);
    expect((await upload({ durationMs: max - 1 })).statusCode).toBe(201);
  });
  it('rejects just over with 422 TRACK_TOO_LONG', async () => {
    const res = await upload({ durationMs: max + 1 });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('TRACK_TOO_LONG');
    expect(res.json().message).toContain('10 minutes');
  });
});

describe('tracks per project cap', () => {
  it('accepts the 10th track (9 present) and rejects the 11th with 409 TRACK_LIMIT', async () => {
    await seedTracks(9);
    expect((await upload()).statusCode).toBe(201);
    const res = await upload();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('TRACK_LIMIT');
    expect(res.json().message).toContain('10');
  });
  it('counts pending tracks too', async () => {
    await seedTracks(10, { status: 'pending' });
    expect((await upload()).statusCode).toBe(409);
  });
  it('counts per project, not globally', async () => {
    const [other] = await t.db.insert(projects).values({ title: 'Other' }).returning();
    await seedTracks(10, {}, other!.id);
    expect((await upload()).statusCode).toBe(201);
  });
});

describe('global storage cap', () => {
  beforeEach(() => build({ maxStorageBytes: 10_000 }));
  it('accepts a file that lands exactly on the budget', async () => {
    await seedTracks(1, { sizeBytes: 5000 });
    expect((await upload({ sizeBytes: 5000 })).statusCode).toBe(201);
  });
  it('rejects a file one byte over with 507 STORAGE_FULL', async () => {
    await seedTracks(1, { sizeBytes: 5000 });
    const res = await upload({ sizeBytes: 5001 });
    expect(res.statusCode).toBe(507);
    expect(res.json().code).toBe('STORAGE_FULL');
    expect(res.json().message).toBe('Storage full (10 KB) — delete old tracks or projects.');
  });
  it('counts pending sizes in the total', async () => {
    await seedTracks(1, { sizeBytes: 9000, status: 'pending' });
    expect((await upload({ sizeBytes: 1001 })).statusCode).toBe(507);
  });
  it('sums past the 32-bit range without overflowing', async () => {
    build({ maxStorageBytes: 8 * 1024 ** 3, maxFileBytes: 1_000_000_000 });
    const gb = 2_000_000_000; // fits an int column; four rows are ~7.45 GiB
    await seedTracks(4, { sizeBytes: gb });
    expect((await upload({ sizeBytes: 500_000_000 })).statusCode).toBe(201);
    expect((await upload({ sizeBytes: 100_000_000 })).statusCode).toBe(507);
  });
});

describe('project cap', () => {
  beforeEach(() => build({ maxProjects: 3 }));
  it('creates up to the limit, then 409 PROJECT_LIMIT', async () => {
    // one project exists already (beforeEach)
    const create = () =>
      app.inject({ method: 'POST', url: '/api/projects', payload: { title: 'New' } });
    expect((await create()).statusCode).toBe(201);
    expect((await create()).statusCode).toBe(201);
    const res = await create();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('PROJECT_LIMIT');
  });
});

describe('concurrency', () => {
  it('parallel uploads cannot both pass the track cap', async () => {
    build({ maxTracksPerProject: 1 });
    const results = await Promise.all(Array.from({ length: 6 }, () => upload()));
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([201, 409, 409, 409, 409, 409]);
    expect(await t.db.select().from(tracks)).toHaveLength(1);
  });
  it('parallel uploads cannot both pass the storage cap', async () => {
    build({ maxStorageBytes: 10_000 });
    const results = await Promise.all(Array.from({ length: 4 }, () => upload({ sizeBytes: 4000 })));
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(2);
    expect(results.filter((r) => r.statusCode === 507)).toHaveLength(2);
  });
  it('parallel project creates cannot both pass the project cap', async () => {
    build({ maxProjects: 3 });
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        app.inject({ method: 'POST', url: '/api/projects', payload: { title: 'N' } }),
      ),
    );
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(2);
  });
});
