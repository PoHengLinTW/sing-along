// @vitest-environment node
import 'fake-indexeddb/auto';
import { Blob } from 'node:buffer';
import type { TrackDto } from '@sing-along/shared';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DraftStore } from '../draftStore';
import { checkOutTrack } from './checkout';

const track = (over: Partial<TrackDto> = {}): TrackDto => ({
  id: 42,
  projectId: 7,
  name: 'Alto',
  performer: 'Sam',
  labels: [{ id: 3, name: 'Alto', color: '#abc', isPreset: true }],
  startOffsetMs: 1000,
  latencyOffsetMs: 250,
  durationMs: 8000,
  mimeType: 'audio/mpeg',
  sizeBytes: 123,
  source: 'upload',
  sortOrder: 2,
  peaks: [0.1, 0.8],
  createdAt: '',
  ...over,
});

let store: DraftStore;
const audio = () => new Blob([new Uint8Array(123)]) as unknown as globalThis.Blob;
const download = vi.fn(async (_id: number) => audio());
const copyMix = vi.fn();

const checkOut = (t = track()) =>
  checkOutTrack({ getStore: async () => store, download, sampleRate: 48000, copyMix }, t);

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  store = await DraftStore.open();
  download.mockClear();
  copyMix.mockClear();
});

describe('checkOutTrack', () => {
  it('makes a ready local take from the saved track, linked to it', async () => {
    const draft = await checkOut();
    expect(draft).toMatchObject({
      projectId: 7,
      name: 'Alto',
      performer: 'Sam',
      status: 'ready',
      startOffsetMs: 1000,
      latencyOffsetMs: 250,
      durationMs: 8000,
      mimeType: 'audio/mpeg',
      peaks: [0.1, 0.8],
      labelIds: [3],
      sampleRate: 48000,
      replacesTrackId: 42,
    });
    expect(draft.blob).toBeDefined();
    expect(await store.listDrafts(7)).toHaveLength(1);
    expect(download).toHaveBeenCalledWith(42);
  });

  it('a track without a performer gives an empty one', async () => {
    expect((await checkOut(track({ performer: null }))).performer).toBe('');
  });

  it('the take starts with the same volume, mute and solo as the track', async () => {
    const draft = await checkOut();
    expect(copyMix).toHaveBeenCalledWith(42, expect.any(Number));
    expect(copyMix.mock.calls[0]?.[1]).toBeLessThan(0); // a draft's engine id is negative
    expect(draft.id).toBeTruthy();
  });

  it('checking out the same track twice does not make a second copy or download again', async () => {
    const first = await checkOut();
    const second = await checkOut();
    expect(second.id).toBe(first.id);
    expect(await store.listDrafts(7)).toHaveLength(1);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('a track in another project is a different checkout', async () => {
    await checkOut();
    await checkOut(track({ id: 43, projectId: 8 }));
    expect(await store.listDrafts(7)).toHaveLength(1);
    expect(await store.listDrafts(8)).toHaveLength(1);
  });

  it('leaves nothing behind when the audio cannot be downloaded', async () => {
    download.mockRejectedValueOnce(new Error('Audio download failed (500)'));
    await expect(checkOut()).rejects.toThrow('Audio download failed');
    expect(await store.listDrafts(7)).toEqual([]);
    expect(copyMix).not.toHaveBeenCalled();
  });

  it('puts the take right after the others in the list', async () => {
    const other = await store.createDraft({
      projectId: 7,
      startOffsetMs: 0,
      sampleRate: 48000,
      name: 'Take 1',
      performer: '',
    });
    const draft = await checkOut();
    const rows = await store.listDrafts(7);
    expect(rows.map((r) => r.id)).toEqual([other.id, draft.id]);
  });
});
