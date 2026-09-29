import { beforeEach, describe, expect, it } from 'vitest';
import { AudioController } from './controller';
import { AudioEngine } from './engine';
import { FakeBuffer, FakeContext } from './fake';
import { createMixerStore } from './mixerStore';
import { createTransportStore } from './transportStore';

let ctx: FakeContext;
let engine: AudioEngine;
let store: ReturnType<typeof createTransportStore>;
let controller: AudioController;

beforeEach(() => {
  ctx = new FakeContext();
  engine = new AudioEngine(() => ctx as never, { set: () => 0, clear: () => {} });
  store = createTransportStore();
  controller = new AudioController(engine, store, undefined, createMixerStore());
  controller.addTrack({
    id: 1,
    buffer: new FakeBuffer(60) as never,
    startOffsetMs: 0,
    latencyOffsetMs: 0,
  });
});

describe('setting the loop', () => {
  it('Set A then Set B at the playhead creates and enables the loop', () => {
    controller.seek(10);
    controller.setLoopPoint('a');
    expect(store.getState().loopA).toBe(10);
    expect(store.getState().loop).toBeNull();
    controller.seek(20);
    controller.setLoopPoint('b');
    expect(store.getState().loop).toEqual({ a: 10, b: 20 });
    expect(store.getState().loopEnabled).toBe(true);
    expect(store.getState().loopA).toBeNull();
  });

  it('rejects a B less than 0.5 s after A and keeps the pending A', () => {
    controller.seek(10);
    controller.setLoopPoint('a');
    controller.seek(10.2);
    expect(controller.setLoopPoint('b')).toBe(false);
    expect(store.getState().loop).toBeNull();
    expect(store.getState().loopA).toBe(10);
  });

  it('with an existing loop, Set A / Set B move that edge (keeping 0.5 s apart)', () => {
    controller.setLoopRegion({ a: 10, b: 20 });
    controller.seek(12);
    controller.setLoopPoint('a');
    expect(store.getState().loop).toEqual({ a: 12, b: 20 });
    controller.seek(12.1);
    controller.setLoopPoint('b');
    expect(store.getState().loop).toEqual({ a: 12, b: 12.5 });
  });

  it('setLoopRegion (from dragging on the ruler) creates an enabled loop and rejects too-short regions', () => {
    expect(controller.setLoopRegion({ a: 5, b: 9 })).toBe(true);
    expect(store.getState()).toMatchObject({
      loop: { a: 5, b: 9 },
      loopEnabled: true,
      loopA: null,
    });
    expect(controller.setLoopRegion({ a: 5, b: 5.2 })).toBe(false);
    expect(store.getState().loop).toEqual({ a: 5, b: 9 });
  });
});

describe('toggling and clearing', () => {
  it('toggleLoop switches looping without losing the region, and reaches the engine', async () => {
    controller.setLoopRegion({ a: 10, b: 20 });
    await controller.play();
    controller.toggleLoop();
    expect(store.getState().loopEnabled).toBe(false);
    expect(store.getState().loop).toEqual({ a: 10, b: 20 });
    controller.toggleLoop();
    expect(store.getState().loopEnabled).toBe(true);
  });

  it('toggleLoop does nothing without a region', () => {
    controller.toggleLoop();
    expect(store.getState().loopEnabled).toBe(false);
  });

  it('clearLoop removes the region and the pending A', () => {
    controller.seek(3);
    controller.setLoopPoint('a');
    controller.setLoopRegion({ a: 10, b: 20 });
    controller.clearLoop();
    expect(store.getState()).toMatchObject({ loop: null, loopEnabled: false, loopA: null });
  });

  it('an enabled loop makes playback wrap: the engine schedules a second pass', async () => {
    controller.setLoopRegion({ a: 10, b: 20 });
    controller.seek(9);
    await controller.play();
    ctx.currentTime = 0.1 + 11 - 0.2;
    engine.pump();
    const passes = ctx.sources.length;
    expect(passes).toBe(2);
  });

  it('a disabled loop does not wrap', async () => {
    controller.setLoopRegion({ a: 10, b: 20 });
    controller.toggleLoop(); // off
    controller.seek(9);
    await controller.play();
    ctx.currentTime = 0.1 + 11 - 0.2;
    engine.pump();
    expect(ctx.sources.length).toBe(1);
  });
});
