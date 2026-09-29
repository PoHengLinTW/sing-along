import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { DraftStore } from './draftStore';
import { createRecordingStore } from './recordingStore';
import { useDrafts } from './useDrafts';

let store: DraftStore;
let encode: Mock<(draftId: string) => Promise<void>>;
let recording: ReturnType<typeof createRecordingStore>;
const base = { projectId: 1, startOffsetMs: 0, sampleRate: 48000, name: 'Take 1', performer: '' };

const ready = async (over = {}) => {
  const d = await store.createDraft({ ...base, ...over });
  return store.updateDraft(d.id, {
    status: 'ready',
    blob: new Blob([new Uint8Array(1)]),
    mimeType: 'audio/flac',
    peaks: [0.5],
    durationMs: 1000,
  });
};

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  store = await DraftStore.open();
  encode = vi.fn<(draftId: string) => Promise<void>>(async () => {});
  recording = createRecordingStore();
});

const render = (projectId = 1) =>
  renderHook(() => useDrafts(projectId, { getStore: async () => store, encode, recording }));

describe('useDrafts', () => {
  it("lists only this project's ready drafts, and reports when loading is done", async () => {
    const mine = await ready();
    await ready({ projectId: 2 });
    const { result } = render();
    expect(result.current.loaded).toBe(false);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.drafts.map((d) => d.id)).toEqual([mine.id]);
  });

  it('follows changes: a draft that becomes ready appears, a discarded one goes', async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.drafts).toEqual([]);
    const d = await ready();
    await waitFor(() => expect(result.current.drafts).toHaveLength(1));
    await act(async () => store.deleteDraft(d.id));
    await waitFor(() => expect(result.current.drafts).toEqual([]));
  });

  it('recovers a take cut short by a crash: marks it encoding and starts the encoder', async () => {
    const crashed = await store.createDraft(base); // still 'recording' after a "reload"
    render();
    await waitFor(() => expect(encode).toHaveBeenCalledWith(crashed.id));
    expect((await store.getDraft(crashed.id))?.status).toBe('encoding');
  });

  it('also resumes a draft that was mid-encode', async () => {
    const d = await store.createDraft(base);
    await store.updateDraft(d.id, { status: 'encoding' });
    render();
    await waitFor(() => expect(encode).toHaveBeenCalledWith(d.id));
  });

  it('does not touch a take that is being recorded right now', async () => {
    const live = await store.createDraft(base);
    recording.setState({ status: 'recording', draftId: live.id });
    const { result } = render();
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(encode).not.toHaveBeenCalled();
    expect((await store.getDraft(live.id))?.status).toBe('recording');
  });

  it('degrades to no drafts when IndexedDB is unavailable', async () => {
    const { result } = renderHook(() =>
      useDrafts(1, {
        getStore: async () => {
          throw new Error('blocked');
        },
        encode,
        recording,
      }),
    );
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.drafts).toEqual([]);
  });
});
