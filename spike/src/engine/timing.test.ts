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
