import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ChunkWriter, TakeStore } from './store';

const chunk = (n: number, v: number) => new Float32Array(n).fill(v);

let store: TakeStore;
beforeEach(async () => {
  indexedDB = new IDBFactory(); // fresh DB per test
  store = await TakeStore.open();
});

describe('TakeStore', () => {
  it('persists chunks and recovers an unfinished take in order', async () => {
    const id = await store.createTake({ sampleRate: 48000, startSec: 12.5 });
    await store.appendChunks(id, 0, [chunk(3, 1), chunk(3, 2)]);
    await store.appendChunks(id, 2, [chunk(2, 3)]);
    const unfinished = await store.listUnfinished();
    expect(unfinished.map((t) => t.id)).toEqual([id]);
    const rec = await store.loadTake(id);
    expect(rec.sampleRate).toBe(48000);
    expect(rec.startSec).toBe(12.5);
    expect(Array.from(rec.samples)).toEqual([1, 1, 1, 2, 2, 2, 3, 3]);
  });

  it('does not list finished takes as unfinished', async () => {
    const id = await store.createTake({ sampleRate: 48000, startSec: 0 });
    await store.appendChunks(id, 0, [chunk(1, 1)]);
    await store.finishTake(id);
    expect(await store.listUnfinished()).toEqual([]);
  });

  it('deletes a take and its chunks', async () => {
    const id = await store.createTake({ sampleRate: 48000, startSec: 0 });
    await store.appendChunks(id, 0, [chunk(1, 1)]);
    await store.deleteTake(id);
    expect(await store.listUnfinished()).toEqual([]);
    await expect(store.loadTake(id)).rejects.toThrow();
  });
});

describe('ChunkWriter', () => {
  it('batches chunks and writes them on flush', async () => {
    const id = await store.createTake({ sampleRate: 10, startSec: 0 });
    const w = new ChunkWriter(store, id, { flushEveryMs: 0 }); // timer off: flush manually
    w.push(chunk(2, 1));
    w.push(chunk(2, 2));
    expect((await store.loadTake(id)).samples.length).toBe(0); // nothing written yet
    await w.flush();
    expect(Array.from((await store.loadTake(id)).samples)).toEqual([1, 1, 2, 2]);
    w.push(chunk(1, 3));
    await w.flush();
    expect(Array.from((await store.loadTake(id)).samples)).toEqual([1, 1, 2, 2, 3]);
  });

  it('loses at most the unflushed tail when the tab dies', async () => {
    const id = await store.createTake({ sampleRate: 10, startSec: 0 });
    const w = new ChunkWriter(store, id, { flushEveryMs: 0 });
    w.push(chunk(5, 1));
    await w.flush();
    w.push(chunk(5, 2)); // never flushed: simulated crash
    expect((await store.loadTake(id)).samples.length).toBe(5);
  });
});
