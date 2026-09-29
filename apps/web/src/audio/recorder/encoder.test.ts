import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DraftStore } from './draftStore';
import type { EncodedTake } from './encode/encode';
import { DraftEncoder } from './encoder';
import { createEncodeStore } from './encodeStore';

const done: EncodedTake = {
  bytes: Uint8Array.of(1),
  mimeType: 'audio/flac',
  peaks: [0.1],
  durationMs: 100,
  fellBack: false,
};

let store: DraftStore;
let encodeStore: ReturnType<typeof createEncodeStore>;
let id: string;
beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  store = await DraftStore.open();
  encodeStore = createEncodeStore();
  const d = await store.createDraft({
    projectId: 1,
    startOffsetMs: 0,
    sampleRate: 48000,
    name: 'Take 1',
    performer: '',
  });
  id = d.id;
  await store.appendChunks(id, 0, [new Float32Array(4).fill(0.1)]);
  await store.updateDraft(id, { status: 'encoding' });
});

const make = (encode: ConstructorParameters<typeof DraftEncoder>[0]['encode']) =>
  new DraftEncoder({ getStore: async () => store, encode, state: encodeStore });

describe('DraftEncoder', () => {
  it('tracks progress while encoding and clears it when done', async () => {
    const seen: (number | undefined)[] = [];
    const enc = make(async (_i, onProgress) => {
      onProgress?.(0.5);
      seen.push(encodeStore.getState().byId[id]?.fraction);
      return done;
    });
    await enc.encode(id);
    expect(seen).toEqual([0.5]);
    expect(encodeStore.getState().byId[id]).toBeUndefined();
    expect((await store.getDraft(id))?.status).toBe('ready');
  });

  it('says so when the WAV fallback was used', async () => {
    await make(async () => ({ ...done, mimeType: 'audio/wav', fellBack: true })).encode(id);
    expect(encodeStore.getState().notice).toMatch(/wav/i);
  });

  it('records a failure so the UI can offer a retry, and a retry can succeed', async () => {
    let fail = true;
    const enc = make(async () => {
      if (fail) throw new Error('boom');
      return done;
    });
    await enc.encode(id);
    expect(encodeStore.getState().byId[id]?.error).toMatch(/boom/);
    fail = false;
    await enc.encode(id);
    expect(encodeStore.getState().byId[id]).toBeUndefined();
    expect((await store.getDraft(id))?.status).toBe('ready');
  });

  it('runs one encode per draft at a time', async () => {
    const encode = vi.fn(async () => done);
    const enc = make(encode);
    await Promise.all([enc.encode(id), enc.encode(id)]);
    expect(encode).toHaveBeenCalledTimes(1);
  });

  it('notifies when a draft became ready', async () => {
    const onReady = vi.fn();
    const enc = new DraftEncoder({
      getStore: async () => store,
      encode: async () => done,
      state: encodeStore,
      onReady,
    });
    await enc.encode(id);
    expect(onReady).toHaveBeenCalledWith(expect.objectContaining({ id, status: 'ready' }));
  });
});
