import { describe, expect, it } from 'vitest';
import { effectiveGain, placeTrack } from './timing';

describe('placeTrack', () => {
  it('starts immediately from the buffer start when playhead is at track start', () => {
    expect(placeTrack({ playheadSec: 0, trackStartSec: 0, durationSec: 10 })).toEqual({ delaySec: 0, bufferOffsetSec: 0 });
  });
  it('starts mid-buffer when the playhead is inside the track', () => {
    expect(placeTrack({ playheadSec: 4, trackStartSec: 1, durationSec: 10 })).toEqual({ delaySec: 0, bufferOffsetSec: 3 });
  });
  it('delays start when the track begins after the playhead', () => {
    expect(placeTrack({ playheadSec: 2, trackStartSec: 5, durationSec: 10 })).toEqual({ delaySec: 3, bufferOffsetSec: 0 });
  });
  it('returns null when the playhead is past the track end', () => {
    expect(placeTrack({ playheadSec: 20, trackStartSec: 5, durationSec: 10 })).toBeNull();
  });
  it('supports a negative track start (latency offset earlier than 0)', () => {
    expect(placeTrack({ playheadSec: 0, trackStartSec: -0.2, durationSec: 10 })).toEqual({ delaySec: 0, bufferOffsetSec: 0.2 });
  });
});

describe('effectiveGain', () => {
  it('is the volume when nothing is muted or soloed', () => {
    expect(effectiveGain({ volume: 0.8, muted: false, solo: false }, false)).toBe(0.8);
  });
  it('is 0 when muted', () => {
    expect(effectiveGain({ volume: 0.8, muted: true, solo: false }, false)).toBe(0);
  });
  it('silences non-soloed tracks when any track is soloed', () => {
    expect(effectiveGain({ volume: 1, muted: false, solo: false }, true)).toBe(0);
    expect(effectiveGain({ volume: 1, muted: false, solo: true }, true)).toBe(1);
  });
  it('mute wins over solo', () => {
    expect(effectiveGain({ volume: 1, muted: true, solo: true }, true)).toBe(0);
  });
});

import { playheadAt } from './timing';

describe('playheadAt', () => {
  it('maps an AudioContext time to a playhead using the play anchor', () => {
    expect(playheadAt({ ctxTime: 12.5, anchorCtxTime: 10, anchorPlayhead: 30 })).toBeCloseTo(32.5);
  });
  it('clamps to the anchor playhead before the start lead has elapsed', () => {
    expect(playheadAt({ ctxTime: 9.95, anchorCtxTime: 10, anchorPlayhead: 30 })).toBe(30);
  });
});

import { timelineAt } from './timing';

describe('timelineAt', () => {
  it('is unclamped: a frame captured before the play anchor maps to an earlier timeline position', () => {
    expect(timelineAt({ ctxTime: 9.9, anchorCtxTime: 10, anchorPlayhead: 30 })).toBeCloseTo(29.9);
  });
});

import { clampLatencyMs, LATENCY_MAX_MS } from './timing';

describe('clampLatencyMs', () => {
  it('rounds to whole milliseconds', () => {
    expect(clampLatencyMs(12.4)).toBe(12);
  });
  it('clamps to ±500 ms', () => {
    expect(clampLatencyMs(900)).toBe(LATENCY_MAX_MS);
    expect(clampLatencyMs(-900)).toBe(-LATENCY_MAX_MS);
  });
  it('treats NaN as 0', () => {
    expect(clampLatencyMs(NaN)).toBe(0);
  });
});

describe('placeTrack with latency', () => {
  it('a +100 ms latency offset delays a take that starts at the playhead', () => {
    const start = (0 + 100) / 1000;
    expect(placeTrack({ playheadSec: 0, trackStartSec: start, durationSec: 5 })).toEqual({ delaySec: 0.1, bufferOffsetSec: 0 });
  });
});
