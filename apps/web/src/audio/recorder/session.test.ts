import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { type Draft, DraftStore } from './draftStore';
import { LiveWave } from './liveWave';
import type { LevelMessage } from './recorder';
import { createRecordingStore } from './recordingStore';
import { RecordingSession } from './session';

class FakeRecorder {
  sampleCount = 0;
  sampleRate = 48000;
  muted = false;
  stopped = false;
  start = vi.fn(async (_deviceId: string | null) => ({ ctxTime: 9.9, sampleRate: 48000 }));
  setMuted = vi.fn((m: boolean) => {
    this.muted = m;
  });
  stop = vi.fn(async () => {
    this.stopped = true;
    return { sampleCount: this.sampleCount, sampleRate: this.sampleRate };
  });
  constructor(
    public onChunk: (s: Float32Array, i: number) => void,
    public onLevel: (l: LevelMessage) => void = () => {},
  ) {}
  level(min: number, max: number, capturing: boolean) {
    this.onLevel({ min, max, frames: 1024, capturing });
  }
  emit(n: number, v = 0.5) {
    this.sampleCount += n;
    this.onChunk(new Float32Array(n).fill(v), 0);
  }
}

let store: DraftStore;
let recorder: FakeRecorder;
let recording: ReturnType<typeof createRecordingStore>;
let calls: string[];
let timelineAt: (t: number) => number | null;
let onAutoStop: Mock<(d: Draft) => void>;
let playing: boolean;
let live: LiveWave;
let meter: LevelMessage[];

const controller = () => ({
  engine: {
    get playing() {
      return playing;
    },
    ensureContext: () => ({ resume: async () => {} }) as never,
    timelineAt: (t: number) => timelineAt(t),
  },
  play: async () => {
    calls.push('play');
    playing = true;
  },
  beginRecording: () => calls.push('begin'),
  endRecording: () => {
    calls.push('end');
    playing = false;
  },
});

function makeSession(maxSec = 600) {
  return new RecordingSession({
    controller: controller() as never,
    getStore: async () => store,
    createRecorder: (onChunk, onLevel) => {
      recorder = new FakeRecorder(onChunk, onLevel);
      return recorder as never;
    },
    recording,
    live,
    onLevel: (l) => meter.push(l),
    beforeStart: () => calls.push('before'),
    maxSec,
    onAutoStop,
  });
}

const input = { projectId: 1, deviceId: null, name: 'Take 1', performer: 'Ann' };
const { name: _name, ...unnamed } = input;

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  store = await DraftStore.open();
  recording = createRecordingStore();
  calls = [];
  meter = [];
  live = new LiveWave();
  playing = false;
  timelineAt = vi.fn(() => 4.9);
  onAutoStop = vi.fn<(d: Draft) => void>();
});

describe('RecordingSession.start', () => {
  it('opens the mic first, then starts playback, and stores the take at the playhead', async () => {
    const s = makeSession();
    await s.start(input);
    expect(recorder.start).toHaveBeenCalledWith(null);
    expect(calls).toEqual(['before', 'begin', 'play']);
    expect(timelineAt).toHaveBeenCalledWith(9.9);
    const [d] = await store.listDrafts(1);
    expect(d).toMatchObject({
      status: 'recording',
      startOffsetMs: 4900,
      trimSamples: 0,
      sampleRate: 48000,
      name: 'Take 1',
      performer: 'Ann',
    });
    expect(recording.getState()).toMatchObject({
      status: 'recording',
      draftId: d?.id,
      muted: false,
    });
  });

  it('keeps playing when already playing instead of restarting', async () => {
    playing = true;
    await makeSession().start(input);
    expect(calls).toEqual(['before', 'begin']);
  });

  it('trims the part that falls before timeline 0', async () => {
    timelineAt = vi.fn(() => -0.1);
    await makeSession().start(input);
    const [d] = await store.listDrafts(1);
    expect(d).toMatchObject({ startOffsetMs: 0, trimSamples: 4800 });
  });

  it('changes nothing if the mic cannot be opened', async () => {
    const fail = new Error('denied');
    const sess = new RecordingSession({
      controller: controller() as never,
      getStore: async () => store,
      createRecorder: () => ({ start: async () => Promise.reject(fail) }) as never,
      recording,
      beforeStart: () => calls.push('before'),
      onAutoStop,
    });
    await expect(sess.start(input)).rejects.toBe(fail);
    expect(calls).toEqual(['before']);
    expect(recording.getState().status).toBe('idle');
    expect(await store.listDrafts(1)).toEqual([]);
  });

  it('refuses a second start while recording', async () => {
    const s = makeSession();
    await s.start(input);
    await expect(s.start(input)).rejects.toThrow(/already/i);
  });

  it('creates a new draft each time and leaves earlier ones untouched', async () => {
    const s = makeSession();
    await s.start(input);
    const first = await s.stop();
    await s.start({ ...input, name: 'Take 2' });
    await s.stop();
    const drafts = await store.listDrafts(1);
    expect(drafts.map((d) => d.name)).toEqual(['Take 1', 'Take 2']);
    expect(drafts[0]).toEqual(await store.getDraft(first.id));
  });
});

describe('RecordingSession default name', () => {
  it('numbers takes per project: Take 1, Take 2', async () => {
    const s = makeSession();
    await s.start(unnamed);
    await s.stop();
    await s.start(unnamed);
    await s.stop();
    expect((await store.listDrafts(1)).map((d) => d.name)).toEqual(['Take 1', 'Take 2']);
  });
});

describe('RecordingSession chunks and stop', () => {
  it('persists chunks that arrive, including any that beat the draft record', async () => {
    const s = makeSession();
    const started = s.start(input);
    await Promise.resolve();
    recorder.emit(3, 1); // before start() has finished creating the draft
    await started;
    recorder.emit(2, 2);
    const d = await s.stop();
    const { samples } = await store.loadSamples(d.id);
    expect(Array.from(samples)).toEqual([1, 1, 1, 2, 2]);
  });

  it('stop ends the take, pauses playback and marks the draft encoding', async () => {
    const s = makeSession();
    await s.start(input);
    recorder.emit(4);
    const d = await s.stop();
    expect(recorder.stopped).toBe(true);
    expect(calls.at(-1)).toBe('end');
    expect((await store.getDraft(d.id))?.status).toBe('encoding');
    expect(recording.getState().status).toBe('idle');
  });

  it('mute is forwarded to the recorder and shown in the store', async () => {
    const s = makeSession();
    await s.start(input);
    s.setMuted(true);
    expect(recorder.setMuted).toHaveBeenCalledWith(true);
    expect(recording.getState().muted).toBe(true);
  });
});

describe('RecordingSession levels', () => {
  it('feeds every level to the meter, but only captured blocks to the live waveform', async () => {
    const s = makeSession();
    await s.start(input);
    recorder.level(-0.1, 0.1, false);
    recorder.level(-0.5, 0.6, true);
    expect(meter).toHaveLength(2);
    expect(live.count).toBe(1);
    expect(live.max[0]).toBe(0.6);
  });

  it('places the live waveform at the take start, aligned with the timeline', async () => {
    timelineAt = vi.fn(() => 4.9);
    const s = makeSession();
    const started = s.start(input);
    await Promise.resolve();
    recorder.level(-1, 1, true); // arrives before the placement is known
    await started;
    expect(live.timed).toBe(true);
    expect(live.startSec).toBeCloseTo(4.9);
    expect(live.blockSec).toBeCloseTo(1024 / 48000);
    expect(live.count).toBe(1);
  });

  it('clears the live waveform when a new take starts', async () => {
    const s = makeSession();
    await s.start(input);
    recorder.level(-1, 1, true);
    await s.stop();
    expect(live.count).toBe(0);
  });
});

describe('10 minute cap', () => {
  it('stops by itself at the limit and reports the draft', async () => {
    const s = makeSession(2); // 2 s cap
    await s.start(input);
    recorder.emit(48000);
    expect(onAutoStop).not.toHaveBeenCalled();
    recorder.emit(48000);
    await vi.waitFor(() => expect(onAutoStop).toHaveBeenCalledTimes(1));
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(onAutoStop.mock.calls[0]?.[0]).toMatchObject({ status: 'encoding' });
    expect(recording.getState().status).toBe('idle');
  });
});
