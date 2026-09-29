import { beforeEach, describe, expect, it } from 'vitest';
import { AudioController } from './controller';
import { AudioEngine } from './engine';
import { FakeBuffer, FakeContext } from './fake';
import { createTransportStore } from './transportStore';

let ctx: FakeContext;
let engine: AudioEngine;
let store: ReturnType<typeof createTransportStore>;
let controller: AudioController;
let frames: (() => void)[];

beforeEach(() => {
  ctx = new FakeContext();
  engine = new AudioEngine(() => ctx as never);
  store = createTransportStore();
  frames = [];
  controller = new AudioController(engine, store, {
    requestFrame: (cb) => frames.push(cb),
    cancelFrame: () => {
      frames = [];
    },
  });
  controller.addTrack({
    id: 1,
    buffer: new FakeBuffer(10) as never,
    startOffsetMs: 0,
    latencyOffsetMs: 0,
  });
});

describe('while recording', () => {
  it('seeking, skipping and restarting do nothing', async () => {
    await controller.play();
    controller.beginRecording();
    ctx.currentTime = 0.1 + 2;
    controller.seek(7);
    controller.skip(1);
    controller.restart();
    expect(engine.position).toBeCloseTo(2);
  });

  it('loop controls do nothing and playback ignores an existing loop', async () => {
    controller.setLoopRegion({ a: 1, b: 2 });
    await controller.play();
    controller.beginRecording();
    controller.setLoopRegion({ a: 3, b: 4 });
    controller.setLoopPoint('a');
    controller.toggleLoop();
    controller.clearLoop();
    expect(store.getState().loop).toEqual({ a: 1, b: 2 });
    ctx.currentTime = 0.1 + 5; // well past B: a live loop would have wrapped
    expect(engine.position).toBeCloseTo(5);
  });

  it('toggle (the play button) does not pause the take', async () => {
    await controller.play();
    controller.beginRecording();
    await controller.toggle();
    expect(store.getState().playing).toBe(true);
  });

  it('keeps playing past the end of the last track', async () => {
    await controller.play();
    controller.beginRecording();
    ctx.currentTime = 0.1 + 15;
    frames.shift()?.();
    expect(store.getState().playing).toBe(true);
    expect(store.getState().position).toBeCloseTo(15);
  });

  it('endRecording pauses, restores normal clamping and re-applies the loop', async () => {
    controller.setLoopRegion({ a: 1, b: 2 });
    await controller.play();
    controller.beginRecording();
    ctx.currentTime = 0.1 + 15;
    controller.endRecording();
    expect(store.getState().playing).toBe(false);
    expect(controller.recording).toBe(false);
    controller.seek(1.5);
    await controller.play();
    ctx.currentTime += 5; // the loop wraps again, so the position stays inside A-B
    engine.pump();
    expect(engine.position).toBeLessThan(2.1);
  });
});
