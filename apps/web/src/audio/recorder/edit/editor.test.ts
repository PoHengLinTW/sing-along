// @vitest-environment node
import 'fake-indexeddb/auto';
import { Blob } from 'node:buffer';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { latencyStore } from '../../latency';
import { type Draft, DraftStore } from '../draftStore';
import { draftEngineId } from '../draftView';
import { DraftEditor } from './editor';
import { EditHistory } from './history';

const SR = 1000;
const ramp = (n: number, from = 0) => Float32Array.from({ length: n }, (_, i) => (from + i) / 1000);

/** The "encoded" file is the raw samples: enough to follow the audio through every edit. */
const fakeEncode = async (input: { samples: Float32Array; sampleRate: number }) => ({
  bytes: new Uint8Array(input.samples.slice().buffer),
  mimeType: 'audio/flac' as const,
  peaks: [input.samples.length],
  durationMs: Math.round((input.samples.length / input.sampleRate) * 1000),
  fellBack: false,
});
const fakeDecode = async (blob: Blob) => ({
  samples: new Float32Array(await blob.arrayBuffer()),
  sampleRate: SR,
});

let store: DraftStore;
let history: EditHistory;
let editor: DraftEditor;

async function readyDraft(
  name: string,
  startMs: number,
  samples: Float32Array,
  over: Partial<Draft> = {},
): Promise<Draft> {
  const d = await store.createDraft({
    projectId: 1,
    startOffsetMs: 0,
    sampleRate: SR,
    name,
    performer: 'Ann',
  });
  const enc = await fakeEncode({ samples, sampleRate: SR });
  return store.updateDraft(d.id, {
    status: 'ready',
    latencyOffsetMs: startMs,
    blob: new Blob([enc.bytes]) as unknown as globalThis.Blob,
    mimeType: enc.mimeType,
    peaks: enc.peaks,
    durationMs: enc.durationMs,
    labelIds: [3],
    ...over,
  });
}
const pcm = async (d: Draft) => (await fakeDecode(d.blob as never)).samples;
const names = async () => (await store.listDrafts(1)).map((d) => d.name);

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  store = await DraftStore.open();
  history = new EditHistory();
  editor = new DraftEditor({
    getStore: async () => store,
    history,
    decode: fakeDecode as never,
    encode: fakeEncode as never,
  });
});

describe('split', () => {
  it('turns one take into two adjacent takes with the same audio and timing', async () => {
    const d = await readyDraft('Verse', 5000, ramp(1000));
    expect(await editor.split(d.id, 5400)).toEqual({ ok: true });
    const [a, b] = await store.listDrafts(1);
    expect([a?.name, b?.name]).toEqual(['Verse', 'Verse (2)']);
    expect(a?.id).toBe(d.id);
    expect((await pcm(a as Draft)).length + (await pcm(b as Draft)).length).toBe(1000);
    expect((a?.latencyOffsetMs ?? 0) + (a?.startOffsetMs ?? 0)).toBe(5000);
    expect((b?.latencyOffsetMs ?? 0) + (b?.startOffsetMs ?? 0)).toBe(5400);
    expect(b).toMatchObject({ performer: 'Ann', status: 'ready', labelIds: [3], durationMs: 600 });
    expect(a?.durationMs).toBe(400);
  });

  it('a cut outside the take changes nothing', async () => {
    const d = await readyDraft('Verse', 5000, ramp(1000));
    expect(await editor.split(d.id, 7000)).toEqual({ ok: false, reason: 'outside' });
    expect(await names()).toEqual(['Verse']);
    expect(history.canUndo).toBe(false);
  });
});

describe('trim', () => {
  it('trim start keeps the rest where it was', async () => {
    const d = await readyDraft('Verse', 5000, ramp(1000));
    expect(await editor.trimBefore(d.id, 5250)).toEqual({ ok: true });
    const t = (await store.getDraft(d.id)) as Draft;
    expect(t.latencyOffsetMs + t.startOffsetMs).toBe(5250);
    expect(t.durationMs).toBe(750);
    expect((await pcm(t))[0]).toBeCloseTo(0.25);
  });

  it('trim end shortens the take and leaves the start', async () => {
    const d = await readyDraft('Verse', 5000, ramp(1000));
    expect(await editor.trimAfter(d.id, 5250)).toEqual({ ok: true });
    const t = (await store.getDraft(d.id)) as Draft;
    expect(t.latencyOffsetMs).toBe(5000);
    expect(t.durationMs).toBe(250);
  });

  it('refuses a cut outside the take', async () => {
    const d = await readyDraft('Verse', 5000, ramp(1000));
    expect(await editor.trimBefore(d.id, 100)).toEqual({ ok: false, reason: 'outside' });
    expect(await editor.trimAfter(d.id, 9000)).toEqual({ ok: false, reason: 'outside' });
  });
});

describe('combine', () => {
  it('merges takes into the earliest one, with silence in the gap, and removes the rest', async () => {
    const chorus = await readyDraft('Chorus', 1300, ramp(100, 2000));
    const verse = await readyDraft('Verse', 1000, ramp(100, 1000));
    expect(await editor.combine([chorus.id, verse.id])).toEqual({ ok: true });
    const rows = await store.listDrafts(1);
    expect(rows.map((r) => r.name)).toEqual(['Verse']);
    const merged = rows[0] as Draft;
    expect(merged.id).toBe(verse.id);
    expect(merged.latencyOffsetMs + merged.startOffsetMs).toBe(1000);
    expect(merged.durationMs).toBe(400);
    const samples = await pcm(merged);
    expect(samples[99]).toBeCloseTo(1.099);
    expect(samples[150]).toBe(0);
    expect(samples[300]).toBeCloseTo(2);
  });

  it('refuses overlapping takes and says by how much', async () => {
    const a = await readyDraft('A', 0, ramp(1000));
    const b = await readyDraft('B', 800, ramp(500));
    expect(await editor.combine([a.id, b.id])).toEqual({
      ok: false,
      reason: 'overlap',
      overlapMs: 200,
    });
    expect(await names()).toEqual(['A', 'B']);
  });

  it('needs two takes', async () => {
    const a = await readyDraft('A', 0, ramp(10));
    expect(await editor.combine([a.id])).toEqual({ ok: false, reason: 'too-few' });
  });
});

describe('undo and redo', () => {
  it('undoes a split: the original take comes back, the second one goes', async () => {
    const d = await readyDraft('Verse', 5000, ramp(1000));
    await editor.split(d.id, 5400);
    expect(await editor.undo()).toBe(true);
    const rows = await store.listDrafts(1);
    expect(rows.map((r) => r.name)).toEqual(['Verse']);
    expect(rows[0]?.durationMs).toBe(1000);
    expect((await pcm(rows[0] as Draft)).length).toBe(1000);
    expect(await editor.redo()).toBe(true);
    expect(await names()).toEqual(['Verse', 'Verse (2)']);
  });

  it('undoes a combine: both takes come back with their own audio', async () => {
    const a = await readyDraft('A', 1000, ramp(100, 1000));
    const b = await readyDraft('B', 1300, ramp(100, 2000));
    await editor.combine([a.id, b.id]);
    await editor.undo();
    expect(await names()).toEqual(['A', 'B']);
    const [ra, rb] = await store.listDrafts(1);
    expect(ra?.durationMs).toBe(100);
    expect((await pcm(rb as Draft))[0]).toBeCloseTo(2);
    await editor.redo();
    expect(await names()).toEqual(['A']);
  });

  it('undoes a trim', async () => {
    const d = await readyDraft('Verse', 5000, ramp(1000));
    await editor.trimBefore(d.id, 5250);
    await editor.undo();
    const t = (await store.getDraft(d.id)) as Draft;
    expect(t.durationMs).toBe(1000);
    expect(t.latencyOffsetMs).toBe(5000);
  });

  it('does nothing when there is nothing to undo or redo', async () => {
    expect(await editor.undo()).toBe(false);
    expect(await editor.redo()).toBe(false);
  });

  it('a new edit after an undo ends the redo trail', async () => {
    const d = await readyDraft('Verse', 5000, ramp(1000));
    await editor.split(d.id, 5400);
    await editor.undo();
    await editor.trimAfter(d.id, 5500);
    expect(history.canRedo).toBe(false);
  });
});

describe('failures and busy', () => {
  it('a failed encode leaves every take as it was and records no edit', async () => {
    const failing = new DraftEditor({
      getStore: async () => store,
      history,
      decode: fakeDecode as never,
      encode: (async () => {
        throw new Error('encoder down');
      }) as never,
    });
    const d = await readyDraft('Verse', 5000, ramp(1000));
    expect(await failing.split(d.id, 5400)).toEqual({ ok: false, reason: 'failed' });
    expect(await names()).toEqual(['Verse']);
    expect((await store.getDraft(d.id))?.durationMs).toBe(1000);
    expect(history.canUndo).toBe(false);
  });

  it('runs one edit at a time: a second one while the first is working is turned away', async () => {
    const d = await readyDraft('Verse', 5000, ramp(1000));
    const first = editor.split(d.id, 5400);
    const second = await editor.trimAfter(d.id, 5100);
    expect(second).toEqual({ ok: false, reason: 'busy' });
    expect(await first).toEqual({ ok: true });
  });

  it('a take that is not ready cannot be edited', async () => {
    const d = await store.createDraft({
      projectId: 1,
      startOffsetMs: 0,
      sampleRate: SR,
      name: 'Live',
      performer: '',
    });
    expect(await editor.split(d.id, 100)).toEqual({ ok: false, reason: 'not-ready' });
  });
});

describe('a start time that is still being saved', () => {
  beforeEach(() => latencyStore.setState({ byId: {} }));

  it('is used by the edit, as the user sees it, not the older stored value', async () => {
    const a = await readyDraft('A', 0, ramp(1000));
    const b = await readyDraft('B', 0, ramp(500)); // stored at 0: would overlap A
    latencyStore.getState().set(draftEngineId(b.id), 20_000); // moved on screen, save pending
    expect(await editor.combine([a.id, b.id])).toEqual({ ok: true });
    const merged = (await store.listDrafts(1))[0] as Draft;
    expect(merged.durationMs).toBe(20_500);
  });

  it('is dropped once the edit has written its result, so it cannot be applied twice', async () => {
    const a = await readyDraft('A', 0, ramp(1000));
    const b = await readyDraft('B', 0, ramp(500));
    latencyStore.getState().set(draftEngineId(b.id), 20_000);
    await editor.combine([a.id, b.id]);
    expect(latencyStore.getState().byId[draftEngineId(b.id)]).toBeUndefined();
    expect(latencyStore.getState().byId[draftEngineId(a.id)]).toBeUndefined();
  });

  it('is undone with the edit: the take comes back where it was on screen', async () => {
    const a = await readyDraft('A', 0, ramp(1000));
    latencyStore.getState().set(draftEngineId(a.id), 4000);
    await editor.trimAfter(a.id, 4500);
    await editor.undo();
    const back = (await store.getDraft(a.id)) as Draft;
    expect(back.latencyOffsetMs).toBe(4000);
    expect(back.durationMs).toBe(1000);
  });
});

describe('edits of tracks that were checked out for editing', () => {
  it('a split keeps the link to the saved track on the first part; the second part is a new track', async () => {
    const d = await readyDraft('Alto', 5000, ramp(1000), {
      replacesTrackId: 5,
      deletesTrackIds: [9],
    });
    await editor.split(d.id, 5400);
    const [a, b] = await store.listDrafts(1);
    expect(a).toMatchObject({ replacesTrackId: 5, deletesTrackIds: [9] });
    expect(b?.replacesTrackId).toBeUndefined();
    expect(b?.deletesTrackIds).toBeUndefined();
  });

  it('a trim keeps the link', async () => {
    const d = await readyDraft('Alto', 5000, ramp(1000), { replacesTrackId: 5 });
    await editor.trimBefore(d.id, 5250);
    expect((await store.getDraft(d.id))?.replacesTrackId).toBe(5);
  });

  it('combining takes overwrites the earliest saved track and removes the other saved tracks', async () => {
    const early = await readyDraft('A', 1000, ramp(100, 1000), { replacesTrackId: 1 });
    const late = await readyDraft('B', 1300, ramp(100, 2000), {
      replacesTrackId: 2,
      deletesTrackIds: [3],
    });
    await editor.combine([late.id, early.id]);
    const [merged] = await store.listDrafts(1);
    expect(merged?.replacesTrackId).toBe(1);
    expect([...(merged?.deletesTrackIds ?? [])].sort()).toEqual([2, 3]);
  });

  it('combining a new take with a saved one: the result is new and the saved track goes', async () => {
    const early = await readyDraft('New', 1000, ramp(100, 1000));
    const late = await readyDraft('Saved', 1300, ramp(100, 2000), { replacesTrackId: 2 });
    await editor.combine([early.id, late.id]);
    const [merged] = await store.listDrafts(1);
    expect(merged?.replacesTrackId).toBeUndefined();
    expect(merged?.deletesTrackIds).toEqual([2]);
  });

  it('combining plain takes adds no links', async () => {
    const a = await readyDraft('A', 1000, ramp(100));
    const b = await readyDraft('B', 1300, ramp(100));
    await editor.combine([a.id, b.id]);
    const [merged] = await store.listDrafts(1);
    expect(merged?.deletesTrackIds).toBeUndefined();
  });

  it('undoing a combine brings back both takes with their own links', async () => {
    const early = await readyDraft('A', 1000, ramp(100, 1000), { replacesTrackId: 1 });
    const late = await readyDraft('B', 1300, ramp(100, 2000), { replacesTrackId: 2 });
    await editor.combine([early.id, late.id]);
    await editor.undo();
    const rows = await store.listDrafts(1);
    expect(rows.map((r) => r.replacesTrackId)).toEqual([1, 2]);
    expect(rows.every((r) => r.deletesTrackIds === undefined)).toBe(true);
  });
});
