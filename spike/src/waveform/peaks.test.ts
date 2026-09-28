import { describe, expect, it } from 'vitest';
import { computePeaks, trackLeftPx } from './peaks';

describe('computePeaks', () => {
  it('takes the max absolute value in each bucket', () => {
    const p = computePeaks(new Float32Array([0.1, -0.5, 0.2, 0.3, -0.9, 0]), 3);
    expect(Array.from(p).map((v) => +v.toFixed(2))).toEqual([0.5, 0.3, 0.9]);
  });
  it('handles fewer samples than buckets', () => {
    const p = computePeaks(new Float32Array([0.4, -0.8]), 4);
    expect(p.length).toBe(4);
    expect(Math.max(...p)).toBeCloseTo(0.8);
  });
  it('returns zeros for silence', () => {
    expect(Array.from(computePeaks(new Float32Array(100), 5))).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('trackLeftPx', () => {
  it('positions a track by start offset + latency at the zoom level', () => {
    expect(trackLeftPx({ startOffsetMs: 2000, latencyOffsetMs: 100 }, 50)).toBe(105);
  });
  it('never goes left of the timeline origin', () => {
    expect(trackLeftPx({ startOffsetMs: 0, latencyOffsetMs: -300 }, 50)).toBe(0);
  });
});
