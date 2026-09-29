import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from 'zustand';
import { AudioController } from './controller';
import { AudioEngine } from './engine';
import { FakeBuffer, FakeContext } from './fake';
import { createTransportStore } from './transportStore';

let ctx: FakeContext;
let engine: AudioEngine;
let store: ReturnType<typeof createTransportStore>;
let controller: AudioController;
let frames: (() => void)[];
const runFrame = () => {
  const f = frames.shift();
  f?.();
};

beforeEach(() => {
  ctx = new FakeContext();
  engine = new AudioEngine(() => ctx as never);
  store = createTransportStore();
  frames = [];
  controller = new AudioController(engine, store, {
    requestFrame: (cb) => {
      frames.push(cb);
      return frames.length;
    },
    cancelFrame: () => {
      frames = [];
    },
  });
});

const add = (id: number, dur = 10, start = 0, lat = 0) =>
  controller.addTrack({
    id,
    buffer: new FakeBuffer(dur) as never,
    startOffsetMs: start,
    latencyOffsetMs: lat,
  });

describe('duration', () => {
  it('follows the tracks: max of offset + length, updated as tracks change', () => {
    add(1, 10);
    expect(store.getState().duration).toBe(10);
    add(2, 5, 8000);
    expect(store.getState().duration).toBe(13);
    controller.setOffsets(2, { latencyOffsetMs: -8000 });
    expect(store.getState().duration).toBe(10);
    controller.removeTrack(1);
    expect(store.getState().duration).toBe(5); // only track 2 left, starting at 0
  });
});

describe('transport', () => {
  it('play sets playing and starts a frame loop that publishes the position every frame', async () => {
    add(1, 10);
    await controller.play();
    expect(store.getState().playing).toBe(true);
    ctx.currentTime = 0.1 + 1;
    runFrame();
    expect(store.getState().position).toBeCloseTo(1);
    ctx.currentTime = 0.1 + 2;
    runFrame();
    expect(store.getState().position).toBeCloseTo(2);
  });

  it('publishes at least 30 updates per second (once per animation frame at 60 Hz)', async () => {
    add(1, 10);
    await controller.play();
    let updates = 0;
    store.subscribe((s, prev) => {
      if (s.position !== prev.position) updates++;
    });
    for (let i = 1; i <= 60; i++) {
      ctx.currentTime = 0.1 + i / 60;
      runFrame();
    }
    expect(updates).toBeGreaterThanOrEqual(30);
  });

  it('pause stops the loop and keeps the position', async () => {
    add(1, 10);
    await controller.play();
    ctx.currentTime = 0.1 + 3;
    controller.pause();
    expect(store.getState().playing).toBe(false);
    expect(store.getState().position).toBeCloseTo(3);
    expect(frames).toHaveLength(0);
  });

  it('seek updates the position immediately, playing or not', async () => {
    add(1, 10);
    controller.seek(4);
    expect(store.getState().position).toBe(4);
    await controller.play();
    controller.seek(7);
    expect(store.getState().position).toBe(7);
  });

  it('stops at the end of the project', async () => {
    add(1, 2);
    await controller.play();
    ctx.currentTime = 0.1 + 5; // well past the end
    runFrame();
    expect(store.getState().playing).toBe(false);
    expect(store.getState().position).toBe(2);
    expect(frames).toHaveLength(0);
  });

  it('toggle plays then pauses', async () => {
    add(1, 10);
    await controller.toggle();
    expect(store.getState().playing).toBe(true);
    await controller.toggle();
    expect(store.getState().playing).toBe(false);
  });
});

describe('React subscriptions', () => {
  it('a component selecting `playing` does not re-render on position updates', async () => {
    add(1, 10);
    let playingRenders = 0;
    let positionRenders = 0;
    function Playing() {
      playingRenders++;
      return <span>{String(useStore(store, (s) => s.playing))}</span>;
    }
    function Position() {
      positionRenders++;
      return <span>{useStore(store, (s) => s.position).toFixed(2)}</span>;
    }
    render(
      <>
        <Playing />
        <Position />
      </>,
    );
    await act(async () => {
      await controller.play();
    });
    const playingAfterPlay = playingRenders;
    const positionAfterPlay = positionRenders;
    for (let i = 1; i <= 10; i++) {
      ctx.currentTime = 0.1 + i / 10;
      act(() => runFrame());
    }
    expect(playingRenders).toBe(playingAfterPlay);
    expect(positionRenders).toBeGreaterThan(positionAfterPlay);
  });
});
