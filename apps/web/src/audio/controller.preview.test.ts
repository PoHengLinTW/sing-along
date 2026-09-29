import { beforeEach, describe, expect, it } from 'vitest';
import { AudioController } from './controller';
import { AudioEngine } from './engine';
import { FakeBuffer, FakeContext } from './fake';
import { createTransportStore } from './transportStore';

let engine: AudioEngine;
let store: ReturnType<typeof createTransportStore>;
let controller: AudioController;

beforeEach(() => {
  engine = new AudioEngine(() => new FakeContext() as never);
  store = createTransportStore();
  controller = new AudioController(engine, store, {
    requestFrame: () => 1,
    cancelFrame: () => {},
  });
  controller.addTrack({
    id: 1,
    buffer: new FakeBuffer(60) as never,
    startOffsetMs: 0,
    latencyOffsetMs: 0,
  });
});

describe('previewAround', () => {
  it('loops the 4 s around the playhead and starts playing at the start of that window', async () => {
    controller.seek(10);
    await controller.previewAround();
    expect(store.getState().loop).toEqual({ a: 8, b: 12 });
    expect(store.getState().loopEnabled).toBe(true);
    expect(store.getState().playing).toBe(true);
    expect(engine.position).toBeCloseTo(8);
  });

  it('works while already playing: moves to the new window', async () => {
    await controller.play();
    controller.seek(30);
    await controller.previewAround();
    expect(store.getState().loop).toEqual({ a: 28, b: 32 });
    expect(engine.position).toBeCloseTo(28);
  });

  it('does nothing while recording', async () => {
    await controller.play();
    controller.beginRecording();
    await controller.previewAround();
    expect(store.getState().loop).toBeNull();
  });
});
