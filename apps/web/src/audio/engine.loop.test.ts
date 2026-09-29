import { beforeEach, describe, expect, it } from 'vitest';
import { AudioEngine } from './engine';
import { FakeBuffer, FakeContext, type FakeSource } from './fake';

const LEAD = 0.1;
const noTimers = { set: () => 0, clear: () => {} };

let ctx: FakeContext;
let engine: AudioEngine;

const load = (id: number, durationSec = 20, startOffsetMs = 0) =>
  engine.addTrack({
    id,
    buffer: new FakeBuffer(durationSec) as never,
    startOffsetMs,
    latencyOffsetMs: 0,
  });
const sourcesOf = (id: number): FakeSource[] =>
  ctx.sources.filter((s) => engine.debugTrackOfSource(s as never) === id);
const starts = (id: number) => sourcesOf(id).map((s) => s.starts[0]);

beforeEach(() => {
  ctx = new FakeContext();
  engine = new AudioEngine(() => ctx as never, noTimers);
});

describe('looping', () => {
  it('plays on to B first, bounded by a duration', async () => {
    load(1);
    engine.setLoop({ a: 2, b: 5 });
    await engine.play();
    expect(starts(1)).toEqual([{ when: LEAD, offset: 0, duration: 5 }]);
  });

  it('schedules the next pass back at A just before B, with no gap', async () => {
    load(1);
    engine.setLoop({ a: 2, b: 5 });
    await engine.play();
    ctx.currentTime = 0.1 + 5 - 0.2; // 200 ms before B
    engine.pump();
    const [first, second] = starts(1);
    expect(second).toEqual({ when: LEAD + 5, offset: 2, duration: 3 });
    expect((second?.when ?? 0) - ((first?.when ?? 0) + (first?.duration ?? 0))).toBeLessThanOrEqual(
      0.05,
    );
  });

  it('does not schedule ahead too early, and never twice for the same pass', async () => {
    load(1);
    engine.setLoop({ a: 2, b: 5 });
    await engine.play();
    engine.pump(); // long before B
    expect(sourcesOf(1)).toHaveLength(1);
    ctx.currentTime = 4.9;
    engine.pump();
    engine.pump();
    expect(sourcesOf(1)).toHaveLength(2);
  });

  it('keeps looping pass after pass', async () => {
    load(1);
    engine.setLoop({ a: 2, b: 5 });
    await engine.play();
    ctx.currentTime = 4.9;
    engine.pump();
    ctx.currentTime = 8.0; // near the end of the second pass (5.1 + 3 = 8.1)
    engine.pump();
    expect(starts(1)[2]).toEqual({ when: LEAD + 8, offset: 2, duration: 3 });
  });

  it('reports the position across the wrap', async () => {
    load(1);
    engine.setLoop({ a: 2, b: 5 });
    await engine.play();
    ctx.currentTime = 4.9;
    engine.pump();
    ctx.currentTime = 5.6; // 0.5 s into the second pass
    expect(engine.position).toBeCloseTo(2.5);
    ctx.currentTime = 4.0; // still in the first pass
    expect(engine.position).toBeCloseTo(3.9);
  });

  it('honours track offsets in every pass', async () => {
    load(1, 20, 0);
    load(2, 20, 1000); // starts at 1 s
    engine.setLoop({ a: 2, b: 5 });
    await engine.play();
    ctx.currentTime = 4.9;
    engine.pump();
    expect(starts(2)[1]).toEqual({ when: LEAD + 5, offset: 1, duration: 3 }); // A - 1 s into its buffer
  });

  it('delays a track that begins inside the loop, and cuts it at B', async () => {
    load(1, 20, 3000); // begins at 3 s: inside [2, 5)
    engine.setLoop({ a: 2, b: 5 });
    await engine.play();
    ctx.currentTime = 4.9;
    engine.pump();
    // second pass: the track joins 1 s after A, from the start of its buffer, for 2 s
    expect(starts(1)[1]).toEqual({ when: LEAD + 5 + 1, offset: 0, duration: 2 });
  });
});

describe('seeking with a loop', () => {
  it('seeking before B plays on to B and then loops (also from before A)', async () => {
    load(1);
    engine.setLoop({ a: 2, b: 5 });
    await engine.play();
    engine.seek(1);
    const last = starts(1).at(-1);
    expect(last).toMatchObject({ offset: 1, duration: 4 });
  });

  it('seeking at or past B ignores the loop: playback runs on, unbounded', async () => {
    load(1);
    engine.setLoop({ a: 2, b: 5 });
    await engine.play();
    engine.seek(7);
    const last = starts(1).at(-1);
    expect(last).toEqual({ when: ctx.currentTime + LEAD, offset: 7 });
    ctx.currentTime += 2;
    engine.pump();
    expect(sourcesOf(1)).toHaveLength(2); // nothing more scheduled
  });

  it('the loop is picked up again once the playhead is seeked back before B', async () => {
    load(1);
    engine.setLoop({ a: 2, b: 5 });
    await engine.play();
    engine.seek(7);
    engine.seek(3);
    expect(starts(1).at(-1)).toMatchObject({ offset: 3, duration: 2 });
  });
});

describe('changing the loop while playing', () => {
  it('turning the loop off lets playback continue past B', async () => {
    load(1);
    engine.setLoop({ a: 2, b: 5 });
    await engine.play();
    ctx.currentTime = LEAD + 3;
    engine.setLoop(null);
    const last = starts(1).at(-1);
    expect(last?.duration).toBeUndefined();
    expect(last?.offset).toBeCloseTo(3 + LEAD);
    ctx.currentTime = 10;
    engine.pump();
    expect(sourcesOf(1).length).toBe(2);
  });

  it('setting a loop while playing bounds the current pass at B', async () => {
    load(1);
    await engine.play();
    ctx.currentTime = LEAD + 1;
    engine.setLoop({ a: 2, b: 5 });
    const last = starts(1).at(-1);
    expect(last?.duration).toBeCloseTo(5 - (1 + LEAD));
    expect(sourcesOf(1)[0]?.stopped).toBe(true);
  });

  it('pausing stops every scheduled pass and freezes the position', async () => {
    load(1);
    engine.setLoop({ a: 2, b: 5 });
    await engine.play();
    ctx.currentTime = 4.9;
    engine.pump();
    ctx.currentTime = 5.6;
    engine.pause();
    expect(sourcesOf(1).every((s) => s.stopped)).toBe(true);
    expect(engine.position).toBeCloseTo(2.5);
  });
});

describe('scheduler timer', () => {
  it('runs only while playing with a loop', async () => {
    const started: number[] = [];
    const stopped: number[] = [];
    const e = new AudioEngine(() => ctx as never, {
      set: () => {
        started.push(1);
        return started.length;
      },
      clear: (id) => stopped.push(id),
    });
    e.addTrack({
      id: 1,
      buffer: new FakeBuffer(20) as never,
      startOffsetMs: 0,
      latencyOffsetMs: 0,
    });
    await e.play();
    expect(started).toHaveLength(0); // no loop, no timer
    e.setLoop({ a: 2, b: 5 });
    expect(started).toHaveLength(1);
    e.pause();
    expect(stopped).toEqual([1]);
  });
});
