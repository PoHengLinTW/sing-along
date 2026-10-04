import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreparedUpload, ReplaceParams } from '../../api/upload';
import { DraftStore } from './draftStore';
import { type DraftView, toDraftView } from './draftView';
import { editHistory } from './edit/history';
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

  it('uploads the edited audio, and an uploaded take can no longer be brought back by undo', async () => {
    editHistory.clear();
    editHistory.push({ label: 'Split', before: [{ id: view.id } as never], after: [] });
    const upload = vi.fn(async () => track);
    await uploadDraft({ upload, store }, view);
    expect(editHistory.canUndo).toBe(false);
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

describe('uploadDraft for a track that was checked out for editing', () => {
  const editing = (over: Partial<DraftView> = {}): DraftView => ({
    ...view,
    replacesTrackId: 42,
    ...over,
  });
  const saved = { id: 42, name: 'Alto (saved)' } as never;

  it('overwrites that track instead of creating a new one', async () => {
    const upload = vi.fn(async () => track);
    const replace = vi.fn(async (_p: ReplaceParams) => saved);
    const result = await uploadDraft({ upload, replace, store }, editing());
    expect(result).toBe(saved);
    expect(upload).not.toHaveBeenCalled();
    expect(replace.mock.calls[0]?.[0]).toMatchObject({
      trackId: 42,
      mimeType: 'audio/flac',
      durationMs: 4000,
      peaks: [0.5],
      startOffsetMs: 1500,
      latencyOffsetMs: -85,
      form: { name: 'Take 1', performer: 'Ann', labelIds: [3] },
    });
    expect(replace.mock.calls[0]?.[0].blob.size).toBe(10);
    expect(await store.getDraft(view.id)).toBeUndefined();
  });

  it('keeps the draft, and deletes nothing, when the overwrite fails', async () => {
    const replace = vi.fn(async () => Promise.reject(new Error('Track not found')));
    const deleteTrack = vi.fn(async () => {});
    await expect(
      uploadDraft(
        { upload: vi.fn(), replace, deleteTrack, store },
        editing({ deletesTrackIds: [7] }),
      ),
    ).rejects.toThrow('Track not found');
    expect(deleteTrack).not.toHaveBeenCalled();
    expect((await store.getDraft(view.id))?.status).toBe('ready');
  });

  it('removes the tracks that were merged into it, after the save, and tells the page', async () => {
    const order: string[] = [];
    const replace = vi.fn(async () => {
      order.push('saved');
      return saved;
    });
    const deleteTrack = vi.fn(async (id: number) => void order.push(`delete ${id}`));
    const onTracksDeleted = vi.fn(() => order.push('page told'));
    await uploadDraft(
      { upload: vi.fn(), replace, deleteTrack, onTracksDeleted, store },
      editing({ deletesTrackIds: [7, 8] }),
    );
    expect(order).toEqual(['saved', 'delete 7', 'delete 8', 'page told']);
    expect(onTracksDeleted).toHaveBeenCalledWith([7, 8]);
  });

  it('a new take that merged saved tracks uploads as new, then removes those tracks', async () => {
    const upload = vi.fn(async () => track);
    const deleteTrack = vi.fn(async () => {});
    await uploadDraft(
      { upload, deleteTrack, store },
      editing({ replacesTrackId: undefined, deletesTrackIds: [7] }),
    );
    expect(upload).toHaveBeenCalled();
    expect(deleteTrack).toHaveBeenCalledWith(7);
  });

  it('reports the tracks it could not remove, and still finishes the save', async () => {
    const replace = vi.fn(async () => saved);
    const deleteTrack = vi.fn(async (id: number) => {
      if (id === 8) throw new Error('500');
    });
    const onDeleteFailed = vi.fn();
    const onTracksDeleted = vi.fn();
    const result = await uploadDraft(
      { upload: vi.fn(), replace, deleteTrack, onDeleteFailed, onTracksDeleted, store },
      editing({ deletesTrackIds: [7, 8] }),
    );
    expect(result).toBe(saved);
    expect(onTracksDeleted).toHaveBeenCalledWith([7]);
    expect(onDeleteFailed).toHaveBeenCalledWith([8]);
    expect(await store.getDraft(view.id)).toBeUndefined();
  });

  it('forgets its edit history like any uploaded take', async () => {
    editHistory.clear();
    editHistory.push({ label: 'Trim', before: [{ id: view.id } as never], after: [] });
    await uploadDraft({ upload: vi.fn(), replace: async () => saved, store }, editing());
    expect(editHistory.canUndo).toBe(false);
  });
});
