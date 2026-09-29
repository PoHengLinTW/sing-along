import { beforeEach, describe, expect, it } from 'vitest';
import { AudioController } from './controller';
import { AudioEngine } from './engine';
import { FakeBuffer, FakeContext } from './fake';
import { createMixerStore } from './mixerStore';
import { createTransportStore } from './transportStore';

let ctx: FakeContext;
let store: ReturnType<typeof createTransportStore>;
let controller: AudioController;
let frames: (() => void)[];

beforeEach(() => {
  ctx = new FakeContext();
  store = createTransportStore();
  frames = [];
  controller = new AudioController(
    new AudioEngine(() => ctx as never),
    store,
    {
      requestFrame: (cb) => {
        frames.push(cb);
        return frames.length;
      },
      cancelFrame: () => {
        frames = [];
      },
    },
    createMixerStore(),
  );
  controller.addTrack({
    id: 1,
    buffer: new FakeBuffer(100) as never,
    startOffsetMs: 0,
    latencyOffsetMs: 0,
  });
});

describe('restart', () => {
  it('seeks to 0 and stays stopped if it was stopped', () => {
    controller.seek(40);
    controller.restart();
    expect(store.getState().position).toBe(0);
    expect(store.getState().playing).toBe(false);
  });

  it('seeks to 0 and keeps playing if it was playing', async () => {
    await controller.play();
    controller.seek(40);
    controller.restart();
    expect(store.getState().position).toBe(0);
    expect(store.getState().playing).toBe(true);
    const restarted = ctx.sources.at(-1);
    expect(restarted?.starts[0]?.offset).toBe(0);
  });
});

describe('skip', () => {
  it('goes back 10 s but stops at 0', () => {
    controller.seek(25);
    controller.skip(-10);
    expect(store.getState().position).toBe(15);
    controller.skip(-10);
    controller.skip(-10);
    expect(store.getState().position).toBe(0);
  });

  it('goes forward 10 s but stops at the end', () => {
    controller.seek(85);
    controller.skip(10);
    expect(store.getState().position).toBe(95);
    controller.skip(10);
    expect(store.getState().position).toBe(100);
  });

  it('reaching the end while playing stops playback on the next frame', async () => {
    await controller.play();
    controller.seek(95);
    controller.skip(10);
    ctx.currentTime += 0.5;
    frames.shift()?.();
    expect(store.getState().playing).toBe(false);
    expect(store.getState().position).toBe(100);
  });

  it('keeps playing when skipping within the project', async () => {
    await controller.play();
    controller.skip(10);
    expect(store.getState().playing).toBe(true);
    expect(ctx.sources.at(-1)?.starts[0]?.offset).toBeCloseTo(10, 0);
  });
});
