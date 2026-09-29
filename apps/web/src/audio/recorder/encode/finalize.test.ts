import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DraftStore } from '../draftStore';
import type { EncodedTake } from './encode';
import { type EncodeFn, finalizeDraft } from './finalize';

const result: EncodedTake = {
  bytes: Uint8Array.of(1, 2, 3),
  mimeType: 'audio/flac',
  peaks: [0.1, 0.2],
  durationMs: 1900,
  fellBack: false,
};

let store: DraftStore;
let id: string;
beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  store = await DraftStore.open();
  const d = await store.createDraft({
    projectId: 1,
    startOffsetMs: 0,
    sampleRate: 48000,
    name: 'Take 1',
    performer: 'Ann',
    trimSamples: 4800,
  });
  id = d.id;
  await store.appendChunks(id, 0, [new Float32Array(10).fill(0.5)]);
  await store.updateDraft(id, { status: 'encoding' });
});

describe('finalizeDraft', () => {
  it('encodes the stored audio, saves the file on the draft as ready, and frees the raw chunks', async () => {
    const encode = vi.fn<EncodeFn>(async () => result);
    const { draft, fellBack } = await finalizeDraft(store, id, encode);
    expect(encode).toHaveBeenCalledWith(
      expect.objectContaining({ sampleRate: 48000, trimSamples: 4800 }),
      undefined,
    );
    expect(encode.mock.calls[0]?.[0].samples.length).toBe(10);
    expect(fellBack).toBe(false);
    expect(draft).toMatchObject({
      status: 'ready',
      mimeType: 'audio/flac',
      peaks: [0.1, 0.2],
      durationMs: 1900,
    });
    expect(draft.blob?.size).toBe(3);
    expect(draft.blob?.type).toBe('audio/flac');
    expect((await store.getDraft(id))?.status).toBe('ready');
    expect((await store.loadSamples(id)).chunkCount).toBe(0);
  });

  it('keeps the raw chunks and the encoding status when encoding fails, so it can be retried', async () => {
    await expect(
      finalizeDraft(store, id, async () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    expect((await store.getDraft(id))?.status).toBe('encoding');
    expect((await store.loadSamples(id)).chunkCount).toBe(1);
  });

  it('does nothing for a draft that is already ready', async () => {
    await finalizeDraft(store, id, async () => result);
    const encode = vi.fn(async () => result);
    const again = await finalizeDraft(store, id, encode);
    expect(encode).not.toHaveBeenCalled();
    expect(again.draft.status).toBe('ready');
  });

  it('rejects an unknown draft', async () => {
    await expect(finalizeDraft(store, 'nope', async () => result)).rejects.toThrow(/not found/i);
  });

  it('forwards progress', async () => {
    const onProgress = vi.fn();
    await finalizeDraft(
      store,
      id,
      async (_i, p) => {
        p?.(0.4);
        return result;
      },
      onProgress,
    );
    expect(onProgress).toHaveBeenCalledWith(0.4);
  });
});
