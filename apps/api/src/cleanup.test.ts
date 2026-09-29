import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runCleanup } from './cleanup';
import { projects, tracks } from './db/schema';
import { createTestDb } from './test/db';
import { FakeStorage } from './test/helpers';

let t: Awaited<ReturnType<typeof createTestDb>>;
let storage: FakeStorage;
let projectId: number;
let logs: string[];

const NOW = new Date('2026-06-10T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);
const log = { info: (m: string) => void logs.push(m) };

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.drop();
});
beforeEach(async () => {
  await t.db.delete(projects);
  storage = new FakeStorage();
  logs = [];
  const [p] = await t.db.insert(projects).values({ title: 'P' }).returning();
  projectId = p!.id;
});

async function addTrack(key: string, status: 'active' | 'pending', createdAt: Date, size = 100) {
  const [row] = await t.db
    .insert(tracks)
    .values({
      projectId,
      name: key,
      durationMs: 1000,
      mimeType: 'audio/flac',
      sizeBytes: size,
      storageKey: key,
      peaks: [0],
      source: 'upload',
      status,
      createdAt,
    })
    .returning();
  return row!;
}
const putObject = (key: string, sizeBytes: number, lastModified: Date) =>
  storage.objects.set(key, { sizeBytes, lastModified });
const run = (over: { dryRun?: boolean } = {}) =>
  runCleanup({ db: t.db, storage, log, now: NOW, ...over });
const rowKeys = async () => (await t.db.select().from(tracks)).map((r) => r.storageKey).sort();

describe('pending tracks', () => {
  it('removes a pending track older than 24 h together with its object', async () => {
    await addTrack('projects/1/tracks/1.flac', 'pending', hoursAgo(25));
    putObject('projects/1/tracks/1.flac', 700, hoursAgo(25));
    const res = await run();
    expect(res).toMatchObject({ pendingRemoved: 1, orphansRemoved: 0, bytesFreed: 700 });
    expect(await rowKeys()).toEqual([]);
    expect(storage.deleted).toEqual(['projects/1/tracks/1.flac']);
  });

  it('removes the row when the upload never happened (no object)', async () => {
    await addTrack('projects/1/tracks/2.flac', 'pending', hoursAgo(30));
    const res = await run();
    expect(res).toMatchObject({ pendingRemoved: 1, bytesFreed: 0 });
    expect(await rowKeys()).toEqual([]);
  });

  it('keeps a pending track younger than 24 h and its object', async () => {
    await addTrack('projects/1/tracks/3.flac', 'pending', hoursAgo(23));
    putObject('projects/1/tracks/3.flac', 100, hoursAgo(23));
    const res = await run();
    expect(res).toMatchObject({ pendingRemoved: 0, orphansRemoved: 0 });
    expect(await rowKeys()).toEqual(['projects/1/tracks/3.flac']);
    expect(storage.deleted).toEqual([]);
  });

  it('never touches active tracks, however old', async () => {
    await addTrack('projects/1/tracks/4.flac', 'active', hoursAgo(24 * 400));
    putObject('projects/1/tracks/4.flac', 100, hoursAgo(24 * 400));
    const res = await run();
    expect(res).toMatchObject({ pendingRemoved: 0, orphansRemoved: 0 });
    expect(await rowKeys()).toEqual(['projects/1/tracks/4.flac']);
  });
});

describe('orphaned objects', () => {
  it('deletes an object with no DB row that is older than 24 h', async () => {
    putObject('projects/9/tracks/9.flac', 300, hoursAgo(48));
    const res = await run();
    expect(res).toMatchObject({ pendingRemoved: 0, orphansRemoved: 1, bytesFreed: 300 });
    expect(storage.deleted).toEqual(['projects/9/tracks/9.flac']);
  });

  it('keeps an unmatched object younger than 24 h (its upload may still be confirming)', async () => {
    putObject('projects/9/tracks/8.flac', 300, hoursAgo(2));
    expect((await run()).orphansRemoved).toBe(0);
    expect(storage.deleted).toEqual([]);
  });

  it('keeps an old object that has a row', async () => {
    await addTrack('projects/1/tracks/5.flac', 'active', hoursAgo(100));
    putObject('projects/1/tracks/5.flac', 100, hoursAgo(100));
    expect((await run()).orphansRemoved).toBe(0);
  });

  it('only looks under projects/', async () => {
    putObject('other/x.flac', 300, hoursAgo(500));
    expect((await run()).orphansRemoved).toBe(0);
    expect(storage.deleted).toEqual([]);
  });

  it('does not count a stale pending track twice (row and object)', async () => {
    await addTrack('projects/1/tracks/6.flac', 'pending', hoursAgo(26));
    putObject('projects/1/tracks/6.flac', 50, hoursAgo(26));
    putObject('projects/1/tracks/7.flac', 60, hoursAgo(26));
    const res = await run();
    expect(res).toMatchObject({ pendingRemoved: 1, orphansRemoved: 1, bytesFreed: 110 });
    expect(storage.deleted.sort()).toEqual([
      'projects/1/tracks/6.flac',
      'projects/1/tracks/7.flac',
    ]);
  });
});

describe('dry run', () => {
  it('reports what would be removed but deletes nothing', async () => {
    await addTrack('projects/1/tracks/1.flac', 'pending', hoursAgo(25));
    putObject('projects/1/tracks/1.flac', 700, hoursAgo(25));
    putObject('projects/2/tracks/2.flac', 300, hoursAgo(48));
    const res = await run({ dryRun: true });
    expect(res).toMatchObject({
      pendingRemoved: 1,
      orphansRemoved: 1,
      bytesFreed: 1000,
      dryRun: true,
    });
    expect(storage.deleted).toEqual([]);
    expect(await rowKeys()).toEqual(['projects/1/tracks/1.flac']);
    expect(logs.join('\n')).toMatch(/dry run/i);
  });
});

describe('logging and failures', () => {
  it('logs the counts of every run', async () => {
    await addTrack('projects/1/tracks/1.flac', 'pending', hoursAgo(25));
    putObject('projects/1/tracks/1.flac', 2048, hoursAgo(25));
    await run();
    const line = logs.join('\n');
    expect(line).toContain('pending removed: 1');
    expect(line).toContain('orphans removed: 0');
    expect(line).toContain('freed: 2 KB');
  });

  it('keeps the pending rows when storage refuses the delete, so the next run retries', async () => {
    const tr = await addTrack('projects/1/tracks/1.flac', 'pending', hoursAgo(25));
    putObject('projects/1/tracks/1.flac', 100, hoursAgo(25));
    storage.failDelete = true;
    await expect(run()).rejects.toThrow('storage down');
    const [still] = await t.db.select().from(tracks).where(eq(tracks.id, tr.id));
    expect(still).toBeTruthy();
  });
});
