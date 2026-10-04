import { describe, expect, it, vi } from 'vitest';
import { LiveWave, liveColumns, tailColumns } from './liveWave';

describe('liveColumns', () => {
  const wave = (blocks: [number, number][]) => ({
    min: blocks.map((b) => b[0]),
    max: blocks.map((b) => b[1]),
  });

  it('is empty without blocks', () => {
    expect(liveColumns(wave([]), 0.5, 0, 10, 0, 100)).toEqual([]);
  });

  it('gives each block the pixel columns it spans, from the take start', () => {
    // 0.5 s blocks at 10 px/s = 5 px each; the take starts at 2 s = x 20
    const cols = liveColumns(wave([[-0.5, 0.5]]), 0.5, 2, 10, 0, 100);
    expect(cols.map((c) => c.x)).toEqual([20, 21, 22, 23, 24]);
    expect(cols[0]).toEqual({ x: 20, min: -0.5, max: 0.5 });
  });

  it('merges blocks that share a pixel column (zoomed out)', () => {
    // 0.05 s blocks at 10 px/s = 0.5 px: two blocks per column
    const cols = liveColumns(
      wave([
        [-0.2, 0.1],
        [-0.1, 0.4],
        [-0.3, 0.2],
        [0, 0],
      ]),
      0.05,
      0,
      10,
      0,
      100,
    );
    expect(cols).toEqual([
      { x: 0, min: -0.2, max: 0.4 },
      { x: 1, min: -0.3, max: 0.2 },
    ]);
  });

  it('is relative to the scroll position and clipped to the viewport', () => {
    const blocks = wave(Array.from({ length: 20 }, () => [-1, 1] as [number, number]));
    // 20 blocks * 5 px = 100 px of audio; view is x 40..60
    const cols = liveColumns(blocks, 0.5, 0, 10, 40, 20);
    expect(cols[0]?.x).toBe(0);
    expect(cols.at(-1)?.x).toBe(19);
    expect(cols).toHaveLength(20);
  });

  it('draws frames before timeline 0 off-screen to the left (negative start)', () => {
    const cols = liveColumns(
      wave([
        [-1, 1],
        [-1, 1],
      ]),
      0.5,
      -0.5,
      10,
      0,
      100,
    );
    expect(cols.map((c) => c.x)).toEqual([0, 1, 2, 3, 4]); // only the second block is visible
  });
});

describe('LiveWave', () => {
  it('accumulates blocks, exposes the take end and notifies subscribers', () => {
    const w = new LiveWave();
    const fn = vi.fn();
    w.subscribe(fn);
    w.setTiming(2, 1000, 500); // start 2 s, 1000 Hz, 500-frame blocks = 0.5 s
    w.push(-0.1, 0.2);
    w.push(-0.3, 0.4);
    expect(w.count).toBe(2);
    expect(w.blockSec).toBe(0.5);
    expect(w.endSec).toBe(3);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('reset clears everything', () => {
    const w = new LiveWave();
    w.setTiming(1, 1000, 500);
    w.push(0, 1);
    w.reset();
    expect(w.count).toBe(0);
    expect(w.timed).toBe(false);
  });

  it('keeps blocks that arrive before the timing is known', () => {
    const w = new LiveWave();
    w.push(-1, 1);
    w.setTiming(0, 1000, 500);
    expect(w.count).toBe(1);
  });
});

describe('tailColumns', () => {
  const wave = (n: number) => ({
    min: Array.from({ length: n }, (_, i) => -(i + 1) / 100),
    max: Array.from({ length: n }, (_, i) => (i + 1) / 100),
  });

  it('is empty without blocks', () => {
    expect(tailColumns(wave(0), 10, 100)).toEqual([]);
  });

  it('grows from the left while the take is shorter than the window', () => {
    // 10-block window over 100 px: 10 px per block
    const cols = tailColumns(wave(2), 10, 100);
    expect(cols[0]?.x).toBe(0);
    expect(cols.at(-1)?.x).toBe(19);
    expect(cols).toHaveLength(20);
  });

  it('scrolls once the window is full: the newest block ends at the right edge', () => {
    const cols = tailColumns(wave(25), 10, 100);
    expect(cols).toHaveLength(100);
    expect(cols.at(-1)).toEqual({ x: 99, min: -0.25, max: 0.25 });
    expect(cols[0]).toEqual({ x: 0, min: -0.16, max: 0.16 });
  });
});
