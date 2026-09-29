import { describe, expect, it } from 'vitest';
import {
  audibleGain,
  planStart,
  projectDuration,
  type ScheduleTrack,
  trackStartSec,
} from './schedule';

const t = (over: Partial<ScheduleTrack> = {}): ScheduleTrack => ({
  id: 1,
  durationSec: 10,
  startOffsetMs: 0,
  latencyOffsetMs: 0,
  ...over,
});

describe('trackStartSec', () => {
  it('is start offset + latency offset, in seconds', () => {
    expect(trackStartSec(t({ startOffsetMs: 2000, latencyOffsetMs: -250 }))).toBe(1.75);
  });
});

describe('projectDuration', () => {
  it('is the max over tracks of (offset + duration)', () => {
    expect(
      projectDuration([
        t({ id: 1, durationSec: 10 }),
        t({ id: 2, durationSec: 5, startOffsetMs: 8000 }),
        t({ id: 3, durationSec: 20, latencyOffsetMs: -5000 }),
      ]),
    ).toBe(15);
  });
  it('is 0 with no tracks', () => {
    expect(projectDuration([])).toBe(0);
  });
});

describe('planStart', () => {
  it('starts every track from the top at playhead 0', () => {
    expect(planStart(0, [t({ id: 1 }), t({ id: 2 })])).toEqual([
      { id: 1, delaySec: 0, bufferOffsetSec: 0 },
      { id: 2, delaySec: 0, bufferOffsetSec: 0 },
    ]);
  });
  it('starts mid-buffer when the playhead is inside a track', () => {
    expect(planStart(4, [t({ startOffsetMs: 1000 })])).toEqual([
      { id: 1, delaySec: 0, bufferOffsetSec: 3 },
    ]);
  });
  it('delays a track that starts after the playhead', () => {
    expect(planStart(2, [t({ startOffsetMs: 5000 })])).toEqual([
      { id: 1, delaySec: 3, bufferOffsetSec: 0 },
    ]);
  });
  it('skips a track the playhead is already past', () => {
    expect(
      planStart(20, [t({ id: 1, startOffsetMs: 5000 }), t({ id: 2, durationSec: 60 })]),
    ).toEqual([{ id: 2, delaySec: 0, bufferOffsetSec: 20 }]);
  });
  it('handles negative offsets by cutting into the buffer', () => {
    expect(planStart(0, [t({ latencyOffsetMs: -200 })])).toEqual([
      { id: 1, delaySec: 0, bufferOffsetSec: 0.2 },
    ]);
    expect(planStart(1, [t({ startOffsetMs: -3000 })])).toEqual([
      { id: 1, delaySec: 0, bufferOffsetSec: 4 },
    ]);
  });
  it('treats a playhead exactly at the end as past the track', () => {
    expect(planStart(10, [t()])).toEqual([]);
  });
});

describe('audibleGain (solo and mute)', () => {
  const s = (over = {}) => ({ volume: 1, muted: false, solo: false, ...over });
  it('is the volume when nothing is muted or soloed', () => {
    expect(audibleGain(s({ volume: 0.8 }), false)).toBe(0.8);
    expect(audibleGain(s({ volume: 1.5 }), false)).toBe(1.5);
  });
  it('is 0 when muted', () => {
    expect(audibleGain(s({ muted: true }), false)).toBe(0);
  });
  it('if any track is soloed, only soloed tracks are audible', () => {
    expect(audibleGain(s(), true)).toBe(0);
    expect(audibleGain(s({ solo: true }), true)).toBe(1);
  });
  it('mute always wins, even over solo', () => {
    expect(audibleGain(s({ muted: true, solo: true }), true)).toBe(0);
  });
});
