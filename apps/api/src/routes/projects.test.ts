import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { labels, projects, trackLabels, tracks } from '../db/schema';
import { seedLabels } from '../db/seed';
import { createTestDb } from '../test/db';
import { FakeStorage } from '../test/helpers';

let t: Awaited<ReturnType<typeof createTestDb>>;
let app: FastifyInstance;
let storage: FakeStorage;

beforeAll(async () => {
  t = await createTestDb();
  await seedLabels(t.db);
});
afterAll(async () => {
  await app?.close();
  await t.drop();
});
beforeEach(async () => {
  await t.db.delete(projects);
  storage = new FakeStorage();
  app = buildApp({ db: t.db, storage });
});

const track = (projectId: number, over: Partial<typeof tracks.$inferInsert> = {}) => ({
  projectId,
  name: 'T',
  durationMs: 1000,
  mimeType: 'audio/flac',
  sizeBytes: 10,
  storageKey: `k/${Math.random()}`,
  peaks: [0.5],
  source: 'upload' as const,
  status: 'active' as const,
  ...over,
});

describe('POST /api/projects', () => {
  it('creates a project and returns it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { title: '  Song ', artist: 'Band' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ title: 'Song', artist: 'Band', notes: null, tracks: [] });
  });

  it('rejects an empty title with 400 and a field-level error', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/projects', payload: { title: '' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().fields.title).toBeTruthy();
    expect(res.json().message).toBeTruthy();
  });

  it('rejects a title over 200 characters', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { title: 'a'.repeat(201) },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().fields.title).toMatch(/200/);
  });
});

describe('GET /api/projects', () => {
  it('lists newest-updated first with the ACTIVE track count only', async () => {
    const [a] = await t.db
      .insert(projects)
      .values({ title: 'Old', updatedAt: new Date('2020-01-01') })
      .returning();
    const [b] = await t.db
      .insert(projects)
      .values({ title: 'New', updatedAt: new Date('2024-01-01') })
      .returning();
    await t.db
      .insert(tracks)
      .values([track(b!.id), track(b!.id), track(b!.id, { status: 'pending' }), track(a!.id)]);
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list.map((p: { title: string }) => p.title)).toEqual(['New', 'Old']);
    expect(list[0]).toMatchObject({ id: b!.id, artist: null, trackCount: 2 });
    expect(list[1].trackCount).toBe(1);
    expect(list[0].updatedAt).toBeTruthy();
  });

  it('returns an empty list when there are no projects', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(res.json()).toEqual([]);
  });
});

describe('GET /api/projects/:id', () => {
  it('returns active tracks ordered by sort_order, with labels in position order', async () => {
    const [p] = await t.db.insert(projects).values({ title: 'P' }).returning();
    const [second, first, pending] = await t.db
      .insert(tracks)
      .values([
        track(p!.id, { name: 'second', sortOrder: 2 }),
        track(p!.id, { name: 'first', sortOrder: 1 }),
        track(p!.id, { name: 'pending', sortOrder: 0, status: 'pending' }),
      ])
      .returning();
    const [alto, bass] = await t.db
      .select()
      .from(labels)
      .where(eq(labels.name, 'Alto'))
      .then(async (a) => [
        a[0]!,
        (await t.db.select().from(labels).where(eq(labels.name, 'Bass')))[0]!,
      ]);
    await t.db.insert(trackLabels).values([
      { trackId: first!.id, labelId: bass!.id, position: 1 },
      { trackId: first!.id, labelId: alto!.id, position: 0 },
    ]);
    const res = await app.inject({ method: 'GET', url: `/api/projects/${p!.id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tracks.map((x: { name: string }) => x.name)).toEqual(['first', 'second']);
    expect(body.tracks[0].labels.map((l: { name: string }) => l.name)).toEqual(['Alto', 'Bass']);
    expect(body.tracks[1].labels).toEqual([]);
    expect(body.tracks[0].peaks).toEqual([0.5]);
    expect(second && pending).toBeTruthy();
  });

  it('returns 404 for an unknown or malformed id', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/projects/999999' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/projects/abc' })).statusCode).toBe(404);
  });
});

describe('PATCH /api/projects/:id', () => {
  it('updates fields and bumps updated_at', async () => {
    const [p] = await t.db
      .insert(projects)
      .values({ title: 'Before', updatedAt: new Date('2020-01-01') })
      .returning();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${p!.id}`,
      payload: { title: 'After', notes: 'hello' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ title: 'After', notes: 'hello' });
    expect(new Date(res.json().updatedAt).getTime()).toBeGreaterThan(
      new Date('2020-01-01').getTime(),
    );
  });

  it('clears an optional field with an empty string', async () => {
    const [p] = await t.db.insert(projects).values({ title: 'P', artist: 'Old' }).returning();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${p!.id}`,
      payload: { artist: '' },
    });
    expect(res.json().artist).toBeNull();
  });

  it('rejects an empty title with 400 and does not change the project', async () => {
    const [p] = await t.db.insert(projects).values({ title: 'Keep' }).returning();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${p!.id}`,
      payload: { title: '' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().fields.title).toBeTruthy();
    expect((await t.db.select().from(projects).where(eq(projects.id, p!.id)))[0]?.title).toBe(
      'Keep',
    );
  });

  it('returns 404 for an unknown id', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/projects/999999',
      payload: { title: 'x' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/projects/:id', () => {
  it('removes the project, its tracks and ALL storage objects (including pending)', async () => {
    const [p] = await t.db.insert(projects).values({ title: 'Doomed' }).returning();
    await t.db
      .insert(tracks)
      .values([
        track(p!.id, { storageKey: 'k/a' }),
        track(p!.id, { storageKey: 'k/b', status: 'pending' }),
      ]);
    const res = await app.inject({ method: 'DELETE', url: `/api/projects/${p!.id}` });
    expect(res.statusCode).toBe(204);
    expect(await t.db.select().from(projects).where(eq(projects.id, p!.id))).toHaveLength(0);
    expect(await t.db.select().from(tracks).where(eq(tracks.projectId, p!.id))).toHaveLength(0);
    expect(storage.deleted.sort()).toEqual(['k/a', 'k/b']);
  });

  it('still succeeds (204) if storage deletion fails: the DB is the source of truth', async () => {
    const [p] = await t.db.insert(projects).values({ title: 'Doomed' }).returning();
    await t.db.insert(tracks).values(track(p!.id));
    storage.failDelete = true;
    const res = await app.inject({ method: 'DELETE', url: `/api/projects/${p!.id}` });
    expect(res.statusCode).toBe(204);
    expect(await t.db.select().from(projects).where(eq(projects.id, p!.id))).toHaveLength(0);
  });

  it('returns 404 for an unknown id and does not touch storage', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/projects/999999' });
    expect(res.statusCode).toBe(404);
    expect(storage.deleted).toEqual([]);
  });
});
