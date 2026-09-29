import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChunkWriter, DraftStore } from './draftStore';

const chunk = (n: number, v: number) => new Float32Array(n).fill(v);
const base = {
  projectId: 1,
  startOffsetMs: 12500,
  sampleRate: 48000,
  name: 'Take 1',
  performer: 'Ann',
};

let store: DraftStore;
beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory(); // fresh database per test
  store = await DraftStore.open();
});
afterEach(() => vi.useRealTimers());

describe('DraftStore', () => {
  it('creates a draft in status recording with the required fields', async () => {
    const d = await store.createDraft(base);
    expect(d).toMatchObject({ ...base, status: 'recording', latencyOffsetMs: 0 });
    expect(typeof d.id).toBe('string');
    expect(d.createdAt).toBeGreaterThan(0);
    expect(await store.getDraft(d.id)).toEqual(d);
  });

  it('persists chunks and loads them back in order', async () => {
    const d = await store.createDraft(base);
    await store.appendChunks(d.id, 0, [chunk(3, 1), chunk(3, 2)]);
    await store.appendChunks(d.id, 2, [chunk(2, 3)]);
    const { samples } = await store.loadSamples(d.id);
    expect(Array.from(samples)).toEqual([1, 1, 1, 2, 2, 2, 3, 3]);
  });

  it('lists drafts only for their own project, oldest first', async () => {
    const a = await store.createDraft(base);
    await store.createDraft({ ...base, projectId: 2 });
    const c = await store.createDraft({ ...base, name: 'Take 2' });
    expect((await store.listDrafts(1)).map((d) => d.id)).toEqual([a.id, c.id]);
    expect(await store.listDrafts(3)).toEqual([]);
  });

  it('updates fields on a draft', async () => {
    const d = await store.createDraft(base);
    await store.updateDraft(d.id, { name: 'Alto', status: 'encoding' });
    expect(await store.getDraft(d.id)).toMatchObject({
      name: 'Alto',
      status: 'encoding',
      projectId: 1,
    });
  });

  it('rejects updating a draft that does not exist', async () => {
    await expect(store.updateDraft('nope', { name: 'x' })).rejects.toThrow(/not found/);
  });

  it('deletes a draft with its chunks', async () => {
    const d = await store.createDraft(base);
    await store.appendChunks(d.id, 0, [chunk(3, 1)]);
    await store.deleteDraft(d.id);
    expect(await store.getDraft(d.id)).toBeUndefined();
    expect((await store.loadSamples(d.id)).samples.length).toBe(0);
  });

  it('deleteChunks frees the raw audio but keeps the draft', async () => {
    const d = await store.createDraft(base);
    await store.appendChunks(d.id, 0, [chunk(3, 1)]);
    await store.deleteChunks(d.id);
    expect(await store.getDraft(d.id)).toBeDefined();
    expect((await store.loadSamples(d.id)).samples.length).toBe(0);
  });

  it('recovers an interrupted recording as an encoding draft, leaving others alone', async () => {
    const crashed = await store.createDraft(base);
    await store.appendChunks(crashed.id, 0, [chunk(4, 1)]);
    const ready = await store.createDraft({ ...base, name: 'Take 2' });
    await store.updateDraft(ready.id, { status: 'ready' });
    const other = await store.createDraft({ ...base, projectId: 9 });

    const recovered = await store.recoverInterrupted(1);
    expect(recovered.map((d) => d.id)).toEqual([crashed.id]);
    expect((await store.getDraft(crashed.id))?.status).toBe('encoding');
    expect((await store.getDraft(ready.id))?.status).toBe('ready');
    expect((await store.getDraft(other.id))?.status).toBe('recording');
    expect((await store.loadSamples(crashed.id)).samples.length).toBe(4);
  });

  it('keeps drafts across a reopen (reload)', async () => {
    const d = await store.createDraft(base);
    await store.appendChunks(d.id, 0, [chunk(5, 1)]);
    const again = await DraftStore.open();
    expect((await again.listDrafts(1)).map((x) => x.id)).toEqual([d.id]);
    expect((await again.loadSamples(d.id)).samples.length).toBe(5);
  });
});

describe('DraftStore change notifications', () => {
  it('notifies on create, update, delete and recovery, but not on chunk appends', async () => {
    const fn = vi.fn();
    const stop = store.subscribe(fn);
    const d = await store.createDraft(base);
    expect(fn).toHaveBeenCalledTimes(1);
    await store.appendChunks(d.id, 0, [chunk(2, 1)]);
    expect(fn).toHaveBeenCalledTimes(1);
    await store.updateDraft(d.id, { name: 'x' });
    expect(fn).toHaveBeenCalledTimes(2);
    await store.recoverInterrupted(1);
    expect(fn).toHaveBeenCalledTimes(3); // the recovered draft was updated
    await store.deleteDraft(d.id);
    expect(fn).toHaveBeenCalledTimes(4);
    stop();
    await store.createDraft(base);
    expect(fn).toHaveBeenCalledTimes(4);
  });
});

describe('ChunkWriter', () => {
  it('flushes buffered chunks to the store about once a second, in order', async () => {
    // Only the interval: fake-indexeddb schedules its own work with other timers.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const d = await store.createDraft(base);
    const w = new ChunkWriter(store, d.id);
    w.push(chunk(2, 1));
    w.push(chunk(2, 2));
    await vi.advanceTimersByTimeAsync(1000);
    w.push(chunk(2, 3));
    await w.close();
    expect(Array.from((await store.loadSamples(d.id)).samples)).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it('close with nothing pending is a no-op', async () => {
    const d = await store.createDraft(base);
    const w = new ChunkWriter(store, d.id, { flushEveryMs: 0 });
    await w.close();
    expect((await store.loadSamples(d.id)).samples.length).toBe(0);
  });
});
