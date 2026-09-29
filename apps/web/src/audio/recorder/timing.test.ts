import { describe, expect, it } from 'vitest';
import type { Segment } from '../loop';
import { takePlacement, timelineSecAt } from './timing';

const seg = (ctxStart: number, from: number, to = Number.POSITIVE_INFINITY): Segment => ({
  ctxStart,
  from,
  to,
});

describe('timelineSecAt', () => {
  it('maps a context time inside the pass onto the timeline', () => {
    expect(timelineSecAt([seg(10, 5)], 10.5)).toBeCloseTo(5.5);
  });

  it('extrapolates backwards for a frame captured before playback started', () => {
    expect(timelineSecAt([seg(10, 5)], 9.9)).toBeCloseTo(4.9);
    expect(timelineSecAt([seg(10, 0)], 9.9)).toBeCloseTo(-0.1);
  });

  it('uses the latest pass that had started', () => {
    const segs = [seg(10, 5, 7), seg(12, 5, 7)];
    expect(timelineSecAt(segs, 12.5)).toBeCloseTo(5.5);
  });

  it('is null with no scheduled pass (not playing)', () => {
    expect(timelineSecAt([], 1)).toBeNull();
  });
});

describe('takePlacement', () => {
  it('rounds the start to whole milliseconds', () => {
    expect(takePlacement(5.5004, 48000)).toEqual({ startOffsetMs: 5500, trimSamples: 0 });
    expect(takePlacement(5.5006, 48000)).toEqual({ startOffsetMs: 5501, trimSamples: 0 });
  });

  it('clamps to timeline 0 and reports the samples that fall before it', () => {
    expect(takePlacement(-0.1, 48000)).toEqual({ startOffsetMs: 0, trimSamples: 4800 });
    expect(takePlacement(-0.25, 44100)).toEqual({ startOffsetMs: 0, trimSamples: 11025 });
  });
});
