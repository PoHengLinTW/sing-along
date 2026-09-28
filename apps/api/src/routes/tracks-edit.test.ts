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
let projectId: number;
const OLD = new Date('2020-01-01');

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
  const [p] = await t.db.insert(projects).values({ title: 'P', updatedAt: OLD }).returning();
  projectId = p!.id;
});

const mk = async (over: Partial<typeof tracks.$inferInsert> = {}, pid = projectId) => {
  const [tr] = await t.db
    .insert(tracks)
    .values({
      projectId: pid,
      name: 'T',
      durationMs: 1000,
      mimeType: 'audio/flac',
      sizeBytes: 10,
      storageKey: `k/${Math.random()}`,
      peaks: [],
      source: 'upload',
      status: 'active',
      ...over,
    })
    .returning();
  return tr!;
};
const label = async (name: string) =>
  (await t.db.select().from(labels).where(eq(labels.name, name)))[0]!;
const projectUpdatedAt = async () =>
  (await t.db.select().from(projects).where(eq(projects.id, projectId)))[0]!.updatedAt;

describe('PATCH /api/tracks/:id', () => {
  it('applies a partial update and leaves other fields alone', async () => {
    const tr = await mk({ name: 'Old', performer: 'Sam', startOffsetMs: 5 });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tracks/${tr.id}`,
      payload: { name: 'New' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'New', performer: 'Sam', startOffsetMs: 5 });
  });

  it('updates offsets and validates the ±600000 ms range', async () => {
    const tr = await mk();
    const ok = await app.inject({
      method: 'PATCH',
      url: `/api/tracks/${tr.id}`,
      payload: { latencyOffsetMs: -120, startOffsetMs: 3000 },
    });
    expect(ok.json()).toMatchObject({ latencyOffsetMs: -120, startOffsetMs: 3000 });
    const bad = await app.inject({
      method: 'PATCH',
      url: `/api/tracks/${tr.id}`,
      payload: { latencyOffsetMs: 600001 },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().fields.latencyOffsetMs).toBeTruthy();
    const frac = await app.inject({
      method: 'PATCH',
      url: `/api/tracks/${tr.id}`,
      payload: { startOffsetMs: 1.5 },
    });
    expect(frac.statusCode).toBe(400);
  });

  it('replaces labels as a set, keeping the given order', async () => {
    const tr = await mk();
    const [alto, bass, tenor] = await Promise.all([label('Alto'), label('Bass'), label('Tenor')]);
    await t.db.insert(trackLabels).values({ trackId: tr.id, labelId: alto.id, position: 0 });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tracks/${tr.id}`,
      payload: { labels: [tenor.id, bass.id] },
    });
    expect(res.json().labels.map((l: { name: string }) => l.name)).toEqual(['Tenor', 'Bass']);
    const cleared = await app.inject({
      method: 'PATCH',
      url: `/api/tracks/${tr.id}`,
      payload: { labels: [] },
    });
    expect(cleared.json().labels).toEqual([]);
  });

  it('rejects unknown labels with 400 and changes nothing', async () => {
    const tr = await mk({ name: 'Keep' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tracks/${tr.id}`,
      payload: { name: 'Changed', labels: [999999] },
    });
    expect(res.statusCode).toBe(400);
    expect((await t.db.select().from(tracks).where(eq(tracks.id, tr.id)))[0]?.name).toBe('Keep');
  });

  it('rejects an empty name, 404s unknown or pending tracks, and bumps project updated_at', async () => {
    const tr = await mk();
    expect(
      (await app.inject({ method: 'PATCH', url: `/api/tracks/${tr.id}`, payload: { name: '' } }))
        .statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: 'PATCH', url: '/api/tracks/999999', payload: { name: 'x' } }))
        .statusCode,
    ).toBe(404);
    const pending = await mk({ status: 'pending' });
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/tracks/${pending.id}`,
          payload: { name: 'x' },
        })
      ).statusCode,
    ).toBe(404);
    await app.inject({ method: 'PATCH', url: `/api/tracks/${tr.id}`, payload: { name: 'ok' } });
    expect((await projectUpdatedAt()).getTime()).toBeGreaterThan(OLD.getTime());
  });
});

describe('DELETE /api/tracks/:id', () => {
  it('removes the row and the storage object, and bumps the project', async () => {
    const tr = await mk({ storageKey: 'k/gone' });
    const res = await app.inject({ method: 'DELETE', url: `/api/tracks/${tr.id}` });
    expect(res.statusCode).toBe(204);
    expect(await t.db.select().from(tracks).where(eq(tracks.id, tr.id))).toHaveLength(0);
    expect(storage.deleted).toEqual(['k/gone']);
    expect((await projectUpdatedAt()).getTime()).toBeGreaterThan(OLD.getTime());
  });

  it('is idempotent: a second delete is 404, never 500', async () => {
    const tr = await mk();
    expect((await app.inject({ method: 'DELETE', url: `/api/tracks/${tr.id}` })).statusCode).toBe(
      204,
    );
    expect((await app.inject({ method: 'DELETE', url: `/api/tracks/${tr.id}` })).statusCode).toBe(
      404,
    );
  });

  it('still returns 204 when storage deletion fails', async () => {
    const tr = await mk();
    storage.failDelete = true;
    expect((await app.inject({ method: 'DELETE', url: `/api/tracks/${tr.id}` })).statusCode).toBe(
      204,
    );
    expect(await t.db.select().from(tracks).where(eq(tracks.id, tr.id))).toHaveLength(0);
  });
});

describe('PUT /api/projects/:id/track-order', () => {
  const put = (id: number, trackIds: number[]) =>
    app.inject({ method: 'PUT', url: `/api/projects/${id}/track-order`, payload: { trackIds } });
  const orderOf = async () =>
    (await t.db.select().from(tracks).where(eq(tracks.projectId, projectId)))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((r) => r.id);

  it('saves sort_order from the full list', async () => {
    const [a, b, c] = [
      await mk({ sortOrder: 0 }),
      await mk({ sortOrder: 1 }),
      await mk({ sortOrder: 2 }),
    ];
    const res = await put(projectId, [c.id, a.id, b.id]);
    expect(res.statusCode).toBe(200);
    expect(await orderOf()).toEqual([c.id, a.id, b.id]);
    expect(res.json().tracks.map((x: { id: number }) => x.id)).toEqual([c.id, a.id, b.id]);
  });

  it('rejects a partial list, duplicates, and ids from another project', async () => {
    const a = await mk({ sortOrder: 0 });
    const b = await mk({ sortOrder: 1 });
    const [other] = await t.db.insert(projects).values({ title: 'Other' }).returning();
    const foreign = await mk({}, other!.id);
    expect((await put(projectId, [a.id])).statusCode).toBe(400);
    expect((await put(projectId, [a.id, a.id])).statusCode).toBe(400);
    expect((await put(projectId, [a.id, foreign.id])).statusCode).toBe(400);
    expect((await put(projectId, [a.id, b.id, foreign.id])).statusCode).toBe(400);
    expect(await orderOf()).toEqual([a.id, b.id]); // unchanged
  });

  it('404s for an unknown project', async () => {
    expect((await put(999999, [])).statusCode).toBe(404);
  });
});

describe('labels', () => {
  it('GET /api/labels lists presets first, then custom labels', async () => {
    await app.inject({ method: 'POST', url: '/api/labels', payload: { name: 'Kazoo' } });
    const res = await app.inject({ method: 'GET', url: '/api/labels' });
    const list = res.json();
    expect(list).toHaveLength(13);
    expect(list.slice(0, 12).every((l: { isPreset: boolean }) => l.isPreset)).toBe(true);
    expect(list[12]).toMatchObject({ name: 'Kazoo', isPreset: false });
  });

  it('POST creates a custom label with a color (trimmed)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/labels',
      payload: { name: '  Ukulele ' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'Ukulele', isPreset: false });
    expect(res.json().color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('POST returns the existing label (case-insensitive) instead of a duplicate', async () => {
    const first = (
      await app.inject({ method: 'POST', url: '/api/labels', payload: { name: 'Banjo' } })
    ).json();
    const again = await app.inject({
      method: 'POST',
      url: '/api/labels',
      payload: { name: ' BANJO ' },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(first.id);
    const preset = await app.inject({
      method: 'POST',
      url: '/api/labels',
      payload: { name: 'alto' },
    });
    expect(preset.json()).toMatchObject({ name: 'Alto', isPreset: true });
  });

  it('POST validates length 1-30', async () => {
    expect(
      (await app.inject({ method: 'POST', url: '/api/labels', payload: { name: '  ' } }))
        .statusCode,
    ).toBe(400);
    const long = await app.inject({
      method: 'POST',
      url: '/api/labels',
      payload: { name: 'a'.repeat(31) },
    });
    expect(long.statusCode).toBe(400);
    expect(long.json().fields.name).toMatch(/30/);
  });
});
