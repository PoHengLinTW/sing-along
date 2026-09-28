import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from '../test/db';
import { labels, projects, trackLabels, tracks } from './schema';
import { PRESET_LABELS, seedLabels } from './seed';

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.drop();
});

const newTrack = (projectId: number, over: Partial<typeof tracks.$inferInsert> = {}) => ({
  projectId,
  name: 'Take',
  durationMs: 1000,
  mimeType: 'audio/flac',
  sizeBytes: 1234,
  storageKey: `projects/${projectId}/tracks/${Math.random()}`,
  peaks: [0.1, 0.2],
  source: 'upload' as const,
  ...over,
});

describe('schema', () => {
  it('projects require a title and stamp created/updated', async () => {
    const [p] = await t.db.insert(projects).values({ title: 'Song' }).returning();
    expect(p?.id).toBeGreaterThan(0);
    expect(p?.artist).toBeNull();
    expect(p?.createdAt).toBeInstanceOf(Date);
    expect(p?.updatedAt).toBeInstanceOf(Date);
    await expect(
      t.db.insert(projects).values({ title: null as unknown as string }),
    ).rejects.toThrow();
  });

  it('tracks hold every PRD T2 field plus status, with sane defaults', async () => {
    const [p] = await t.db.insert(projects).values({ title: 'P' }).returning();
    const [tr] = await t.db.insert(tracks).values(newTrack(p!.id)).returning();
    expect(tr).toMatchObject({
      name: 'Take',
      performer: null,
      startOffsetMs: 0,
      latencyOffsetMs: 0,
      durationMs: 1000,
      mimeType: 'audio/flac',
      sizeBytes: 1234,
      source: 'upload',
      sortOrder: 0,
      status: 'pending',
    });
    expect(tr?.peaks).toEqual([0.1, 0.2]); // jsonb round-trips
    expect(tr?.createdAt).toBeInstanceOf(Date);
  });

  it('rejects an unknown track status or source', async () => {
    const [p] = await t.db.insert(projects).values({ title: 'P' }).returning();
    await expect(
      t.db.insert(tracks).values(newTrack(p!.id, { status: 'weird' as never })),
    ).rejects.toThrow();
    await expect(
      t.db.insert(tracks).values(newTrack(p!.id, { source: 'weird' as never })),
    ).rejects.toThrow();
  });

  it('label names are unique case-insensitively', async () => {
    await t.db.insert(labels).values({ name: 'Kazoo', color: '#111111' });
    await expect(t.db.insert(labels).values({ name: 'kazoo', color: '#222222' })).rejects.toThrow();
  });

  it('deleting a project cascades to tracks and track_labels; labels survive', async () => {
    const [p] = await t.db.insert(projects).values({ title: 'Cascade' }).returning();
    const [tr] = await t.db.insert(tracks).values(newTrack(p!.id)).returning();
    const [l] = await t.db
      .insert(labels)
      .values({ name: 'CascadeLabel', color: '#333333' })
      .returning();
    await t.db.insert(trackLabels).values({ trackId: tr!.id, labelId: l!.id, position: 0 });

    await t.db.delete(projects).where(eq(projects.id, p!.id));

    expect(await t.db.select().from(tracks).where(eq(tracks.id, tr!.id))).toHaveLength(0);
    expect(
      await t.db.select().from(trackLabels).where(eq(trackLabels.trackId, tr!.id)),
    ).toHaveLength(0);
    expect(await t.db.select().from(labels).where(eq(labels.id, l!.id))).toHaveLength(1);
  });

  it('deleting a track cascades to its track_labels only', async () => {
    const [p] = await t.db.insert(projects).values({ title: 'T' }).returning();
    const [a, b] = await t.db
      .insert(tracks)
      .values([newTrack(p!.id), newTrack(p!.id)])
      .returning();
    const [l] = await t.db
      .insert(labels)
      .values({ name: 'TrackDelLabel', color: '#444444' })
      .returning();
    await t.db.insert(trackLabels).values([
      { trackId: a!.id, labelId: l!.id, position: 0 },
      { trackId: b!.id, labelId: l!.id, position: 0 },
    ]);
    await t.db.delete(tracks).where(eq(tracks.id, a!.id));
    const left = await t.db.select().from(trackLabels).where(eq(trackLabels.labelId, l!.id));
    expect(left.map((r) => r.trackId)).toEqual([b!.id]);
  });
});

describe('seedLabels', () => {
  it('inserts the 12 PRD presets', async () => {
    await seedLabels(t.db);
    const presets = await t.db.select().from(labels).where(eq(labels.isPreset, true));
    expect(presets.map((l) => l.name).sort()).toEqual([...PRESET_LABELS.map((l) => l.name)].sort());
    expect(presets).toHaveLength(12);
    expect(presets.every((l) => /^#[0-9a-f]{6}$/i.test(l.color))).toBe(true);
  });

  it('is idempotent: running twice creates no duplicates', async () => {
    await seedLabels(t.db);
    await seedLabels(t.db);
    const [row] = await t.db
      .select({ n: sql<number>`count(*)::int` })
      .from(labels)
      .where(eq(labels.isPreset, true));
    expect(row?.n).toBe(12);
  });

  it('does not overwrite a custom label that shares a preset name', async () => {
    const [before] = await t.db.select().from(labels).where(eq(labels.name, 'Harmony'));
    await seedLabels(t.db);
    const again = await t.db.select().from(labels).where(eq(labels.id, before!.id));
    expect(again[0]?.name).toBe('Harmony');
  });
});
