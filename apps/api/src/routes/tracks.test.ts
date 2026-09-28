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
  app = buildApp({ db: t.db, storage, presignTtlSec: 900 });
  const [p] = await t.db
    .insert(projects)
    .values({ title: 'P', updatedAt: new Date('2020-01-01') })
    .returning();
  projectId = p!.id;
});

const body = (over: Record<string, unknown> = {}) => ({
  name: 'Lead take',
  performer: 'Sam',
  labels: [] as number[],
  mimeType: 'audio/flac',
  sizeBytes: 5000,
  durationMs: 4000,
  startOffsetMs: 250,
  source: 'upload',
  peaks: [0.1, 0.9],
  ...over,
});
const upload = (over?: Record<string, unknown>, id = projectId) =>
  app.inject({ method: 'POST', url: `/api/projects/${id}/tracks/upload-url`, payload: body(over) });

describe('POST /api/projects/:id/tracks/upload-url', () => {
  it('creates a pending track and returns a presigned PUT bound to type and size', async () => {
    const res = await upload();
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.uploadUrl).toContain('https://storage.test/put/');
    expect(json.headers['Content-Type']).toBe('audio/flac');
    expect(new Date(json.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const [tr] = await t.db.select().from(tracks).where(eq(tracks.id, json.trackId));
    expect(tr).toMatchObject({
      projectId,
      status: 'pending',
      name: 'Lead take',
      performer: 'Sam',
      sizeBytes: 5000,
      durationMs: 4000,
      startOffsetMs: 250,
      mimeType: 'audio/flac',
      source: 'upload',
    });
    expect(tr?.peaks).toEqual([0.1, 0.9]);
    expect(storage.presignedPuts[0]).toMatchObject({
      contentType: 'audio/flac',
      sizeBytes: 5000,
      expiresInSec: 900,
    });
  });

  it('uses the key format projects/<projectId>/tracks/<trackId>.<ext>', async () => {
    const json = (await upload({ mimeType: 'audio/mpeg' })).json();
    const [tr] = await t.db.select().from(tracks).where(eq(tracks.id, json.trackId));
    expect(tr?.storageKey).toBe(`projects/${projectId}/tracks/${json.trackId}.mp3`);
    expect(storage.presignedPuts[0]?.key).toBe(tr?.storageKey);
  });

  it('rejects disallowed MIME types with 415 and creates nothing', async () => {
    const res = await upload({ mimeType: 'video/mp4' });
    expect(res.statusCode).toBe(415);
    expect(await t.db.select().from(tracks)).toHaveLength(0);
  });

  it('stores labels in the given order', async () => {
    const [alto, bass] = await Promise.all([
      t.db.select().from(labels).where(eq(labels.name, 'Alto')),
      t.db.select().from(labels).where(eq(labels.name, 'Bass')),
    ]);
    const json = (await upload({ labels: [bass[0]!.id, alto[0]!.id] })).json();
    const rows = await t.db.select().from(trackLabels).where(eq(trackLabels.trackId, json.trackId));
    expect(rows.sort((a, b) => a.position - b.position).map((r) => r.labelId)).toEqual([
      bass[0]!.id,
      alto[0]!.id,
    ]);
  });

  it('rejects unknown label ids with 400', async () => {
    const res = await upload({ labels: [999999] });
    expect(res.statusCode).toBe(400);
    expect(res.json().fields.labels).toBeTruthy();
  });

  it('validates the body (400) and the project (404)', async () => {
    expect((await upload({ name: '' })).statusCode).toBe(400);
    expect((await upload({ sizeBytes: 0 })).statusCode).toBe(400);
    expect((await upload({}, 999999)).statusCode).toBe(404);
  });
});

describe('POST /api/tracks/:id/confirm', () => {
  const pending = async (over?: Record<string, unknown>) => {
    const json = (await upload(over)).json();
    const [tr] = await t.db.select().from(tracks).where(eq(tracks.id, json.trackId));
    return tr!;
  };
  const confirm = (id: number) => app.inject({ method: 'POST', url: `/api/tracks/${id}/confirm` });

  it('activates the track when the object exists with the declared size', async () => {
    const tr = await pending();
    storage.objects.set(tr.storageKey, { sizeBytes: 5000 });
    const res = await confirm(tr.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: tr.id, name: 'Lead take' });
    const [after] = await t.db.select().from(tracks).where(eq(tracks.id, tr.id));
    expect(after?.status).toBe('active');
  });

  it('appends new tracks at the end of the project order and bumps updated_at', async () => {
    const a = await pending();
    const b = await pending();
    for (const x of [a, b]) storage.objects.set(x.storageKey, { sizeBytes: 5000 });
    await confirm(a.id);
    await confirm(b.id);
    const rows = await t.db.select().from(tracks).where(eq(tracks.projectId, projectId));
    const order = Object.fromEntries(rows.map((r) => [r.id, r.sortOrder]));
    expect(order[b.id]).toBeGreaterThan(order[a.id]!);
    const [p] = await t.db.select().from(projects).where(eq(projects.id, projectId));
    expect(p!.updatedAt.getTime()).toBeGreaterThan(new Date('2020-01-01').getTime());
  });

  it('is idempotent for an already active track', async () => {
    const tr = await pending();
    storage.objects.set(tr.storageKey, { sizeBytes: 5000 });
    await confirm(tr.id);
    expect((await confirm(tr.id)).statusCode).toBe(200);
  });

  it('returns 400 and removes the track if the object is missing', async () => {
    const tr = await pending();
    const res = await confirm(tr.id);
    expect(res.statusCode).toBe(400);
    expect(await t.db.select().from(tracks).where(eq(tracks.id, tr.id))).toHaveLength(0);
  });

  it('returns 400, deletes the object and the track if the size differs', async () => {
    const tr = await pending();
    storage.objects.set(tr.storageKey, { sizeBytes: 4999 });
    const res = await confirm(tr.id);
    expect(res.statusCode).toBe(400);
    expect(storage.deleted).toContain(tr.storageKey);
    expect(await t.db.select().from(tracks).where(eq(tracks.id, tr.id))).toHaveLength(0);
  });

  it('returns 404 for an unknown track', async () => {
    expect((await confirm(999999)).statusCode).toBe(404);
  });
});

describe('GET /api/tracks/:id/audio-url', () => {
  it('returns a presigned GET for an active track', async () => {
    const [tr] = await t.db
      .insert(tracks)
      .values({
        projectId,
        name: 'A',
        durationMs: 1,
        mimeType: 'audio/flac',
        sizeBytes: 1,
        storageKey: 'k/x.flac',
        peaks: [],
        source: 'upload',
        status: 'active',
      })
      .returning();
    const res = await app.inject({ method: 'GET', url: `/api/tracks/${tr!.id}/audio-url` });
    expect(res.statusCode).toBe(200);
    expect(res.json().url).toBe('https://storage.test/get/k/x.flac?sig=y');
    expect(new Date(res.json().expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('is 404 for pending or unknown tracks', async () => {
    const [tr] = await t.db
      .insert(tracks)
      .values({
        projectId,
        name: 'A',
        durationMs: 1,
        mimeType: 'audio/flac',
        sizeBytes: 1,
        storageKey: 'k/y.flac',
        peaks: [],
        source: 'upload',
      })
      .returning();
    expect(
      (await app.inject({ method: 'GET', url: `/api/tracks/${tr!.id}/audio-url` })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: '/api/tracks/999999/audio-url' })).statusCode,
    ).toBe(404);
  });
});
