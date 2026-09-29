import { beforeEach, describe, expect, it } from 'vitest';
import { AudioEngine } from './engine';
import { FakeBuffer, FakeContext } from './fake';

let ctx: FakeContext;
let engine: AudioEngine;
beforeEach(() => {
  ctx = new FakeContext();
  engine = new AudioEngine(() => ctx as never);
  engine.addTrack({
    id: 1,
    buffer: new FakeBuffer(10) as never,
    startOffsetMs: 0,
    latencyOffsetMs: 0,
  });
});

describe('timelineAt', () => {
  it('is null while paused', () => {
    expect(engine.timelineAt(1)).toBeNull();
  });

  it('maps context time to the timeline while playing, even before the start lead', async () => {
    engine.seek(3);
    await engine.play(); // pass starts at ctx 0.1, from 3
    expect(engine.timelineAt(0.6)).toBeCloseTo(3.5);
    expect(engine.timelineAt(0)).toBeCloseTo(2.9);
  });
});

describe('open-ended playback (recording past the last track)', () => {
  it('clamps the position to the project duration by default', async () => {
    await engine.play();
    ctx.currentTime = 0.1 + 15;
    expect(engine.position).toBe(10);
  });

  it('lets the position run past the end when open-ended', async () => {
    engine.setOpenEnded(true);
    await engine.play();
    ctx.currentTime = 0.1 + 15;
    expect(engine.position).toBeCloseTo(15);
  });
});
