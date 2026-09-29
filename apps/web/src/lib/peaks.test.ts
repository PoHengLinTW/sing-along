import { describe, expect, it } from 'vitest';
import { computePeaks } from './peaks';

describe('computePeaks', () => {
  it('yields peaksPerSec values per second, taking max |sample| per bucket', () => {
    // 10 Hz sample rate, 10 peaks/s -> 1 sample per bucket
    const p = computePeaks([new Float32Array([0.1, -0.5, 0.25, 1])], 10, 10);
    expect(p).toEqual([0.1, 0.5, 0.25, 1]);
  });

  it('takes the max over a bucket of several samples', () => {
    const p = computePeaks([new Float32Array([0.1, -0.5, 0.2, 0.3])], 4, 2); // 2 samples per bucket
    expect(p).toEqual([0.5, 0.3]);
  });

  it('combines channels by max |sample|', () => {
    const p = computePeaks([new Float32Array([0.2, 0]), new Float32Array([-0.6, 0.1])], 2, 2);
    expect(p).toEqual([0.6, 0.1]);
  });

  it('rounds to 2 decimals and clamps to 0..1', () => {
    const p = computePeaks([new Float32Array([0.123456, 1.7])], 2, 2);
    expect(p).toEqual([0.12, 1]);
  });

  it('counts a trailing partial bucket', () => {
    const p = computePeaks([new Float32Array([0.5, 0.5, 0.9])], 2, 1); // 2 samples per bucket
    expect(p).toEqual([0.5, 0.9]);
  });

  it('keeps the peaks JSON of a 10-minute track under 500 KB (100 peaks per second)', () => {
    const sampleRate = 8000; // cheap to build; bucket math is what matters
    const samples = new Float32Array(sampleRate * 600);
    for (let i = 0; i < samples.length; i += 37) samples[i] = 0.999 * Math.sin(i);
    const peaks = computePeaks([samples], sampleRate, 100);
    expect(peaks).toHaveLength(60000);
    expect(JSON.stringify(peaks).length).toBeLessThanOrEqual(500_000);
  });

  it('returns [] for empty input', () => {
    expect(computePeaks([new Float32Array(0)], 44100, 100)).toEqual([]);
  });
});
