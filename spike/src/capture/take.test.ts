import { describe, expect, it } from 'vitest';
import { concatChunks, sampleCountMatches, takeDurationMs } from './take';

describe('concatChunks', () => {
  it('joins chunks in order', () => {
    const out = concatChunks([new Float32Array([1, 2]), new Float32Array([3]), new Float32Array([4, 5])]);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });
  it('returns an empty array for no chunks', () => {
    expect(concatChunks([]).length).toBe(0);
  });
});

describe('takeDurationMs', () => {
  it('derives duration from sample count and sample rate', () => {
    expect(takeDurationMs(48000 * 60, 48000)).toBe(60000);
  });
});

describe('sampleCountMatches', () => {
  it('accepts a 60 s take within ±50 ms', () => {
    expect(sampleCountMatches(48000 * 60 + 2000, 60, 48000, 50)).toBe(true); // +41.7 ms
  });
  it('rejects a take that is 100 ms off', () => {
    expect(sampleCountMatches(48000 * 60 - 4800, 60, 48000, 50)).toBe(false);
  });
});

import { trimBeforeZero } from './take';

describe('trimBeforeZero', () => {
  it('drops samples that fall before timeline 0 and clamps the start to 0', () => {
    const r = trimBeforeZero(new Float32Array([1, 2, 3, 4, 5]), 10, -0.2); // 2 samples before 0
    expect(Array.from(r.samples)).toEqual([3, 4, 5]);
    expect(r.startSec).toBe(0);
  });
  it('leaves a take that starts at or after 0 untouched', () => {
    const r = trimBeforeZero(new Float32Array([1, 2]), 10, 1.5);
    expect(Array.from(r.samples)).toEqual([1, 2]);
    expect(r.startSec).toBe(1.5);
  });
});
