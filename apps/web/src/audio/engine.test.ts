import { beforeEach, describe, expect, it } from 'vitest';
import { AudioEngine } from './engine';
import { FakeBuffer, FakeContext } from './fake';

let ctx: FakeContext;
let engine: AudioEngine;
const LEAD = 0.1; // start lead used by the engine

const load = (id: number, durationSec = 10, startOffsetMs = 0, latencyOffsetMs = 0) =>
  engine.addTrack({
    id,
    buffer: new FakeBuffer(durationSec) as never,
    startOffsetMs,
    latencyOffsetMs,
  });

/** Sources created for a track, oldest first. */
const sourcesOf = (id: number) =>
  ctx.sources.filter((s) => engine.debugTrackOfSource(s as never) === id);

beforeEach(() => {
  ctx = new FakeContext();
  engine = new AudioEngine(() => ctx as never);
});

describe('context lifecycle', () => {
  it('does not create the AudioContext until it is needed, and only once', () => {
    let created = 0;
    const e = new AudioEngine(() => {
      created++;
      return ctx as never;
    });
    expect(created).toBe(0);
    e.ensureContext();
    e.ensureContext();
    expect(created).toBe(1);
  });

  it('play() resumes a suspended context (first user gesture)', async () => {
    load(1);
    await engine.play();
    expect(ctx.resumeCalls).toBe(1);
    expect(ctx.state).toBe('running');
  });
});

describe('play / pause / seek', () => {
  it('starts every track at the same context time with the right buffer offsets', async () => {
    load(1, 10, 0);
    load(2, 10, 1000);
    await engine.play();
    const a = sourcesOf(1)[0]?.starts[0];
    const b = sourcesOf(2)[0]?.starts[0];
    expect(a).toEqual({ when: LEAD, offset: 0 });
    expect(b).toEqual({ when: LEAD + 1, offset: 0 }); // delayed by its 1 s offset
  });

  it('pause freezes the position and stops the sources', async () => {
    load(1);
    await engine.play();
    ctx.currentTime = LEAD + 3;
    engine.pause();
    expect(engine.position).toBeCloseTo(3);
    expect(sourcesOf(1)[0]?.stopped).toBe(true);
    ctx.currentTime = 100;
    expect(engine.position).toBeCloseTo(3);
  });

  it('resume continues from where it paused', async () => {
    load(1);
    await engine.play();
    ctx.currentTime = LEAD + 3;
    engine.pause();
    await engine.play();
    expect(sourcesOf(1)[1]?.starts[0]).toEqual({ when: ctx.currentTime + LEAD, offset: 3 });
  });

  it('position does not run backwards during the start lead', async () => {
    load(1);
    engine.seek(4);
    await engine.play();
    expect(engine.position).toBe(4);
    ctx.currentTime = LEAD / 2;
    expect(engine.position).toBe(4);
  });

  it('seeking while paused only moves the playhead', () => {
    load(1);
    engine.seek(5);
    expect(engine.position).toBe(5);
    expect(ctx.sources).toHaveLength(0);
  });

  it('seeking while playing restarts all tracks from the new position', async () => {
    load(1);
    load(2);
    await engine.play();
    engine.seek(6);
    expect(sourcesOf(1)[0]?.stopped).toBe(true);
    expect(sourcesOf(1)[1]?.starts[0]?.offset).toBe(6);
    expect(sourcesOf(2)[1]?.starts[0]?.offset).toBe(6);
  });

  it('clamps seeks to [0, duration]', () => {
    load(1, 10);
    engine.seek(-5);
    expect(engine.position).toBe(0);
    engine.seek(99);
    expect(engine.position).toBe(10);
  });
});

describe('mixing (gain)', () => {
  it('sets gain immediately with a short smoothing constant (no clicks, well under 50 ms)', async () => {
    load(1);
    const gain = ctx.gains[0];
    await engine.play();
    const before = ctx.sources.length;
    engine.setVolume(1, 0.5);
    const last = gain?.gain.targets.at(-1);
    expect(last?.value).toBe(0.5);
    // 5 time constants reach 99%: must be <= 50 ms
    expect((last?.timeConstant ?? 1) * 5).toBeLessThanOrEqual(0.05);
    expect(ctx.sources).toHaveLength(before); // no restart
  });

  it('mute and solo follow the solo rules without restarting playback', async () => {
    load(1);
    load(2);
    const [g1, g2] = ctx.gains;
    await engine.play();
    const before = ctx.sources.length;
    engine.setSolo(1, true);
    expect(g1?.gain.value).toBe(1);
    expect(g2?.gain.value).toBe(0);
    engine.setMuted(1, true); // mute wins over solo
    expect(g1?.gain.value).toBe(0);
    expect(g2?.gain.value).toBe(0);
    engine.setMuted(1, false);
    engine.setSolo(1, false);
    expect(g2?.gain.value).toBe(1);
    expect(ctx.sources).toHaveLength(before);
  });

  it('a track added while others are soloed starts silent', () => {
    load(1);
    engine.setSolo(1, true);
    load(2);
    expect(ctx.gains[1]?.gain.value).toBe(0);
  });
});

describe('offsets', () => {
  it('changing an offset during playback reschedules only that track', async () => {
    load(1);
    load(2);
    await engine.play();
    ctx.currentTime = LEAD + 2; // playhead = 2
    const untouched = sourcesOf(1)[0];
    engine.setOffsets(2, { latencyOffsetMs: 500 });
    expect(sourcesOf(1)).toHaveLength(1);
    expect(sourcesOf(1)[0]).toBe(untouched);
    expect(untouched?.stopped).toBe(false);
    expect(sourcesOf(2)[0]?.stopped).toBe(true);
    const re = sourcesOf(2)[1]?.starts[0];
    // The new source starts on the same clock, at now + lead. By then the playhead is 2 + lead,
    // and the track (now starting at 0.5 s) is 1.6 s into its buffer.
    expect(re?.when).toBeCloseTo(ctx.currentTime + LEAD);
    expect(re?.offset).toBeCloseTo(2 + LEAD - 0.5);
  });

  it('while paused, an offset change only updates the plan used on the next play', async () => {
    load(1, 10, 0);
    engine.setOffsets(1, { startOffsetMs: 2000 });
    expect(ctx.sources).toHaveLength(0);
    await engine.play();
    expect(sourcesOf(1)[0]?.starts[0]).toEqual({ when: LEAD + 2, offset: 0 });
  });
});

describe('duration and track set', () => {
  it('duration is the max of (offset + latency + length)', () => {
    load(1, 10);
    load(2, 5, 8000);
    expect(engine.duration).toBe(13);
    engine.setOffsets(2, { latencyOffsetMs: -8000 });
    expect(engine.duration).toBe(10);
  });

  it('removing a track stops it and drops it from the duration', async () => {
    load(1, 10);
    load(2, 30);
    await engine.play();
    engine.removeTrack(2);
    expect(sourcesOf(2)[0]?.stopped).toBe(true);
    expect(engine.duration).toBe(10);
  });

  it('a track added during playback joins in sync', async () => {
    load(1);
    await engine.play();
    ctx.currentTime = LEAD + 4;
    load(2, 10, 0);
    const s = sourcesOf(2)[0]?.starts[0];
    expect(s?.when).toBeCloseTo(ctx.currentTime + LEAD);
    expect(s?.offset).toBeCloseTo(4 + LEAD);
  });
});
