import { describe, expect, it } from 'vitest';
import {
  blockPeak,
  CLIP_HOLD_MS,
  CLIP_LEVEL,
  isClipping,
  LevelTracker,
  levelFraction,
  toDb,
  updateLevel,
} from './level';

const quantum = (fn: (i: number) => number) => Float32Array.from({ length: 128 }, (_, i) => fn(i));

describe('LevelTracker', () => {
  it('emits one min/max block per blockFrames frames', () => {
    const t = new LevelTracker(1024);
    const blocks = [];
    for (let i = 0; i < 16; i++) blocks.push(...t.push(quantum(() => 0.25)));
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ min: 0.25, max: 0.25, frames: 1024 });
  });

  it('tracks the extremes inside a block, across quanta', () => {
    const t = new LevelTracker(256);
    t.push(quantum((i) => (i === 3 ? -0.8 : 0.1)));
    const [b] = t.push(quantum((i) => (i === 9 ? 0.6 : 0)));
    expect(b?.min).toBeCloseTo(-0.8, 5); // samples are float32
    expect(b?.max).toBeCloseTo(0.6, 5);
    expect(b?.frames).toBe(256);
  });

  it('blocks at 48 kHz come at least 30 times a second', () => {
    expect(48000 / 1024).toBeGreaterThanOrEqual(30);
    expect(44100 / 1024).toBeGreaterThanOrEqual(30);
  });
});

describe('levels', () => {
  it('blockPeak is the larger absolute extreme', () => {
    expect(blockPeak({ min: -0.7, max: 0.3, frames: 1 })).toBe(0.7);
  });

  it('toDb: full scale is 0 dB, half is about -6 dB, silence is -Infinity', () => {
    expect(toDb(1)).toBeCloseTo(0);
    expect(toDb(0.5)).toBeCloseTo(-6.02, 1);
    expect(toDb(0)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('the clip threshold is -0.1 dBFS', () => {
    expect(toDb(CLIP_LEVEL)).toBeCloseTo(-0.1, 5);
  });

  it('levelFraction maps -60..0 dB onto 0..1 and clamps', () => {
    expect(levelFraction(1)).toBe(1);
    expect(levelFraction(0)).toBe(0);
    expect(levelFraction(0.001)).toBeCloseTo(0.0, 1);
    expect(levelFraction(0.5)).toBeCloseTo(0.9, 1);
    expect(levelFraction(2)).toBe(1);
  });
});

describe('updateLevel / isClipping', () => {
  const idle = { level: 0, clipUntil: 0 };

  it('rises at once to a louder peak and decays slowly after', () => {
    const up = updateLevel(idle, 0.8, 1000);
    expect(up.level).toBe(0.8);
    const down = updateLevel(up, 0.1, 1020);
    expect(down.level).toBeLessThan(0.8);
    expect(down.level).toBeGreaterThan(0.5);
  });

  it('a peak at -0.1 dBFS or above lights the clip warning for 2 s, then it clears', () => {
    const s = updateLevel(idle, CLIP_LEVEL, 5000);
    expect(isClipping(s, 5000)).toBe(true);
    expect(isClipping(s, 5000 + CLIP_HOLD_MS - 1)).toBe(true);
    expect(isClipping(s, 5000 + CLIP_HOLD_MS)).toBe(false);
  });

  it('a peak just below the threshold does not clip', () => {
    expect(isClipping(updateLevel(idle, CLIP_LEVEL - 0.001, 0), 0)).toBe(false);
  });

  it('a later clip extends the warning; quiet input does not shorten it', () => {
    let s = updateLevel(idle, 1, 1000);
    s = updateLevel(s, 0.05, 2000);
    expect(isClipping(s, 2500)).toBe(true);
    s = updateLevel(s, 1, 2500);
    expect(isClipping(s, 4400)).toBe(true);
  });
});
