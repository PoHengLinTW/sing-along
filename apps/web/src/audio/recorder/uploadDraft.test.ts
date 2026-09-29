import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreparedUpload } from '../../api/upload';
import { DraftStore } from './draftStore';
import { type DraftView, toDraftView } from './draftView';
import { uploadDraft } from './uploadDraft';

let store: DraftStore;
let view: DraftView;
const track = { id: 42, name: 'Take 1' } as never;

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  store = await DraftStore.open();
  const d = await store.createDraft({
    projectId: 5,
    startOffsetMs: 1500,
    sampleRate: 48000,
    name: 'Take 1',
    performer: 'Ann',
  });
  const ready = await store.updateDraft(d.id, {
    status: 'ready',
    blob: new Blob([new Uint8Array(10)], { type: 'audio/flac' }),
    mimeType: 'audio/flac',
    peaks: [0.5],
    durationMs: 4000,
    labelIds: [3],
  });
  view = { ...(toDraftView(ready) as DraftView), latencyOffsetMs: -85 };
});

describe('uploadDraft', () => {
  it('uploads with source recording and everything the take carries, using the offset on screen', async () => {
    const upload = vi.fn(async (_p: PreparedUpload) => track);
    await uploadDraft({ upload, store }, view);
    expect(upload.mock.calls[0]?.[0]).toMatchObject({
      projectId: 5,
      mimeType: 'audio/flac',
      durationMs: 4000,
      peaks: [0.5],
      startOffsetMs: 1500,
      latencyOffsetMs: -85,
      source: 'recording',
      form: { name: 'Take 1', performer: 'Ann', labelIds: [3] },
    });
    expect(upload.mock.calls[0]?.[0].blob.size).toBe(10);
  });

  it('removes the draft only after the upload succeeded, and returns the new track', async () => {
    let draftDuringUpload: unknown;
    const upload = vi.fn(async () => {
      draftDuringUpload = await store.getDraft(view.id);
      return track;
    });
    expect(await uploadDraft({ upload, store }, view)).toBe(track);
    expect(draftDuringUpload).toBeDefined();
    expect(await store.getDraft(view.id)).toBeUndefined();
  });

  it('lets the UI swap in the new track before the local draft is removed', async () => {
    const order: string[] = [];
    const deleting = {
      deleteDraft: async () => void order.push('deleted'),
    } as unknown as DraftStore;
    await uploadDraft(
      { upload: async () => track, store: deleting, onUploaded: () => order.push('swapped') },
      view,
    );
    expect(order).toEqual(['swapped', 'deleted']);
  });

  it('keeps the draft when the upload fails, so it can be retried', async () => {
    const upload = vi.fn(async () => Promise.reject(new Error('Upload failed (500)')));
    await expect(uploadDraft({ upload, store }, view)).rejects.toThrow('Upload failed (500)');
    expect((await store.getDraft(view.id))?.status).toBe('ready');
  });

  it('passes progress and cancellation through', async () => {
    const onProgress = vi.fn();
    const signal = new AbortController().signal;
    const upload = vi.fn(async (p: PreparedUpload) => {
      p.onProgress?.(0.3);
      return track;
    });
    await uploadDraft({ upload, store }, view, { onProgress, signal });
    expect(onProgress).toHaveBeenCalledWith(0.3);
    expect(upload.mock.calls[0]?.[0].signal).toBe(signal);
  });

  it('still returns the track if removing the local draft fails afterwards', async () => {
    const broken = {
      deleteDraft: async () => Promise.reject(new Error('idb')),
    } as unknown as DraftStore;
    const upload = vi.fn(async () => track);
    expect(await uploadDraft({ upload, store: broken }, view)).toBe(track);
  });
});
