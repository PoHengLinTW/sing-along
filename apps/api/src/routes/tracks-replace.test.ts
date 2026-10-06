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
let trackId: number;
const OLD_KEY = () => `projects/${projectId}/tracks/${trackId}.flac`;
const newKey = () => `projects/${projectId}/tracks/${trackId}-abc123.flac`;

const caps = (over: Record<string, number> = {}) => ({
  maxFileBytes: 60_000,
  maxTrackMs: 600_000,
  maxTracksPerProject: 10,
  maxProjects: 100,
  maxStorageBytes: 100_000,
  ...over,
});

async function boot(c = caps()) {
  app = buildApp({ db: t.db, storage, presignTtlSec: 900, caps: c });
}

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
  await boot();
  const [p] = await t.db
    .insert(projects)
    .values({ title: 'P', updatedAt: new Date('2020-01-01') })
    .returning();
  projectId = p?.id as number;
  const [tr] = await t.db
    .insert(tracks)
    .values({
      projectId,
      name: 'Alto',
      performer: 'Sam',
      startOffsetMs: 1000,
      latencyOffsetMs: 20,
      durationMs: 8000,
      mimeType: 'audio/flac',
      sizeBytes: 40_000,
      storageKey: 'pending/x',
      peaks: [0.5, 0.5],
      source: 'recording',
      status: 'active',
    })
    .returning();
  trackId = tr?.id as number;
  await t.db.update(tracks).set({ storageKey: OLD_KEY() }).where(eq(tracks.id, trackId));
  storage.objects.set(OLD_KEY(), { sizeBytes: 40_000 });
});

const urlReq = (over: Record<string, unknown> = {}, id = trackId) =>
  app.inject({
    method: 'POST',
    url: `/api/tracks/${id}/replace-url`,
    payload: { mimeType: 'audio/flac', sizeBytes: 20_000, durationMs: 4000, ...over },
  });
const replace = (over: Record<string, unknown> = {}, id = trackId) =>
  app.inject({
    method: 'POST',
    url: `/api/tracks/${id}/replace`,
    payload: {
      key: newKey(),
      mimeType: 'audio/flac',
      sizeBytes: 20_000,
      durationMs: 4000,
      peaks: [0.1, 0.9, 0.3],
      ...over,
    },
  });
const row = async () => (await t.db.select().from(tracks).where(eq(tracks.id, trackId)))[0];

describe('POST /api/tracks/:id/replace-url', () => {
  it('returns a presigned PUT for a new object next to the track, and changes nothing yet', async () => {
    const res = await urlReq();
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.key).toMatch(
      new RegExp(`^projects/${projectId}/tracks/${trackId}-[0-9a-f-]+\\.flac$`),
    );
    expect(json.uploadUrl).toContain(`https://storage.test/put/${json.key}`);
    expect(json.headers['Content-Type']).toBe('audio/flac');
    expect(storage.presignedPuts.at(-1)).toMatchObject({
      key: json.key,
      contentType: 'audio/flac',
      sizeBytes: 20_000,
    });
    expect((await row())?.storageKey).toBe(OLD_KEY());
    expect((await row())?.sizeBytes).toBe(40_000);
  });

  it('uses a fresh key each time, so an old signed URL cannot overwrite a newer upload', async () => {
    const a = (await urlReq()).json().key;
    const b = (await urlReq()).json().key;
    expect(a).not.toBe(b);
  });

  it('404 for a track that does not exist or is still pending', async () => {
    expect((await urlReq({}, 999_999)).statusCode).toBe(404);
    await t.db.update(tracks).set({ status: 'pending' }).where(eq(tracks.id, trackId));
    expect((await urlReq()).statusCode).toBe(404);
  });

  it('415 for an unsupported format', async () => {
    expect((await urlReq({ mimeType: 'video/mp4' })).statusCode).toBe(415);
  });

  it('413 over the file cap and 422 over the length cap', async () => {
    expect((await urlReq({ sizeBytes: 60_001 })).json().code).toBe('FILE_TOO_LARGE');
    expect((await urlReq({ durationMs: 600_001 })).json().code).toBe('TRACK_TOO_LONG');
  });

  it('counts only the growth: with 30 kB elsewhere, 40 kB becoming 55 kB fits in 100 kB', async () => {
    await t.db.insert(tracks).values({
      projectId,
      name: 'Other',
      durationMs: 1000,
      mimeType: 'audio/flac',
      sizeBytes: 30_000,
      storageKey: 'projects/other.flac',
      peaks: [0],
      source: 'upload',
      status: 'active',
    });
    // 30k + 55k = 85k. Counting the old file too (70k + 55k = 125k) would wrongly refuse it.
    expect((await urlReq({ sizeBytes: 55_000 })).statusCode).toBe(200);
  });

  it('507 when the growth does not fit', async () => {
    await t.db.insert(tracks).values({
      projectId,
      name: 'Other',
      durationMs: 1000,
      mimeType: 'audio/flac',
      sizeBytes: 50_000,
      storageKey: 'projects/other.flac',
      peaks: [0],
      source: 'upload',
      status: 'active',
    });
    // other 50k + replacement 55k = 105k > 100k
    expect((await urlReq({ sizeBytes: 55_000 })).json().code).toBe('STORAGE_FULL');
  });
});

describe('POST /api/tracks/:id/replace', () => {
  const uploaded = (key = newKey(), sizeBytes = 20_000) => storage.objects.set(key, { sizeBytes });

  it('points the track at the new file and takes its size, length, format and peaks', async () => {
    uploaded();
    const res = await replace({ mimeType: 'audio/flac' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: trackId,
      durationMs: 4000,
      sizeBytes: 20_000,
      peaks: [0.1, 0.9, 0.3],
    });
    expect(await row()).toMatchObject({
      storageKey: newKey(),
      sizeBytes: 20_000,
      durationMs: 4000,
      status: 'active',
      name: 'Alto',
      performer: 'Sam',
    });
  });

  it('deletes the old file afterwards', async () => {
    uploaded();
    await replace();
    expect(storage.deleted).toContain(OLD_KEY());
    expect(storage.objects.has(OLD_KEY())).toBe(false);
    expect(storage.objects.has(newKey())).toBe(true);
  });

  it('sets the placement, name, performer and labels in the same step when given', async () => {
    uploaded();
    const [label] = await t.db.select().from(labels).limit(1);
    const res = await replace({
      startOffsetMs: 1000,
      latencyOffsetMs: 2500,
      name: 'Alto (edited)',
      performer: 'Bo',
      labels: [label?.id],
    });
    expect(res.statusCode).toBe(200);
    expect(await row()).toMatchObject({
      startOffsetMs: 1000,
      latencyOffsetMs: 2500,
      name: 'Alto (edited)',
      performer: 'Bo',
    });
    expect(
      await t.db.select().from(trackLabels).where(eq(trackLabels.trackId, trackId)),
    ).toHaveLength(1);
  });

  it('leaves what was not given as it was', async () => {
    uploaded();
    await replace();
    expect(await row()).toMatchObject({ startOffsetMs: 1000, latencyOffsetMs: 20 });
  });

  it('marks the project as changed', async () => {
    uploaded();
    await replace();
    const [p] = await t.db.select().from(projects).where(eq(projects.id, projectId));
    expect(p?.updatedAt.getTime()).toBeGreaterThan(new Date('2020-01-02').getTime());
  });

  it('serves the new file from audio-url', async () => {
    uploaded();
    await replace();
    const res = await app.inject({ method: 'GET', url: `/api/tracks/${trackId}/audio-url` });
    expect(res.json().url).toContain(newKey());
  });

  it('is safe to repeat after a lost response: the same key again just returns the track', async () => {
    uploaded();
    await replace();
    storage.deleted.length = 0;
    const again = await replace();
    expect(again.statusCode).toBe(200);
    expect(again.json().durationMs).toBe(4000);
    expect(storage.deleted).toEqual([]);
  });

  it('refuses a key that does not belong to this track and changes nothing', async () => {
    const other = `projects/${projectId}/tracks/${trackId + 1}-zzz.flac`;
    uploaded(other);
    expect((await replace({ key: other })).statusCode).toBe(400);
    expect((await replace({ key: 'projects/9/tracks/1.flac' })).statusCode).toBe(400);
    expect((await row())?.storageKey).toBe(OLD_KEY());
    expect(storage.deleted).toEqual([]);
  });

  it('400 when nothing was uploaded to that key, and the track is unchanged', async () => {
    const res = await replace();
    expect(res.statusCode).toBe(400);
    expect((await row())?.storageKey).toBe(OLD_KEY());
    expect(storage.objects.has(OLD_KEY())).toBe(true);
  });

  it('400 when the uploaded size differs from what was announced; the bad object goes, the track stays', async () => {
    uploaded(newKey(), 19_999);
    const res = await replace();
    expect(res.statusCode).toBe(400);
    expect(storage.deleted).toContain(newKey());
    expect((await row())?.storageKey).toBe(OLD_KEY());
    expect(storage.objects.has(OLD_KEY())).toBe(true);
  });

  it('507 at confirm when other uploads used the room meanwhile; the new object goes, the track stays', async () => {
    uploaded();
    await t.db.insert(tracks).values({
      projectId,
      name: 'Other',
      durationMs: 1000,
      mimeType: 'audio/flac',
      sizeBytes: 90_000, // 90k elsewhere + 20k new = 110k > 100k
      storageKey: 'projects/other.flac',
      peaks: [0],
      source: 'upload',
      status: 'active',
    });
    const res = await replace();
    expect(res.json().code).toBe('STORAGE_FULL');
    expect(storage.deleted).toContain(newKey());
    expect((await row())?.storageKey).toBe(OLD_KEY());
  });

  it("two people saving: the last save wins and the first one's file is removed", async () => {
    const first = `projects/${projectId}/tracks/${trackId}-first.flac`;
    const second = `projects/${projectId}/tracks/${trackId}-second.flac`;
    storage.objects.set(first, { sizeBytes: 20_000 });
    storage.objects.set(second, { sizeBytes: 21_000 });
    expect((await replace({ key: first })).statusCode).toBe(200);
    expect((await replace({ key: second, sizeBytes: 21_000, durationMs: 4500 })).statusCode).toBe(
      200,
    );
    expect(await row()).toMatchObject({ storageKey: second, sizeBytes: 21_000, durationMs: 4500 });
    expect(storage.deleted).toContain(first);
    expect(storage.objects.has(second)).toBe(true);
  });

  it('a save for a track that someone deleted meanwhile is a 404, and nothing is changed', async () => {
    storage.objects.set(newKey(), { sizeBytes: 20_000 });
    await app.inject({ method: 'DELETE', url: `/api/tracks/${trackId}` });
    const res = await replace();
    expect(res.statusCode).toBe(404);
    expect(res.json().message).toMatch(/track/i);
  });

  it('a failed delete of the old file does not fail the replace', async () => {
    uploaded();
    storage.failDelete = true;
    const res = await replace();
    expect(res.statusCode).toBe(200);
    expect((await row())?.storageKey).toBe(newKey());
  });

  it('404 for a missing track, and validates the body', async () => {
    expect((await replace({}, 999_999)).statusCode).toBe(404);
    expect((await replace({ peaks: 'no' })).statusCode).toBe(400);
    expect((await replace({ latencyOffsetMs: 600_001 })).statusCode).toBe(400);
  });
});
