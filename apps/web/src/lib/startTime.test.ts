import { describe, expect, it } from 'vitest';
import {
  formatStartTime,
  latencyForStart,
  NUDGE_COARSE_MS,
  NUDGE_FINE_MS,
  parseStartTime,
  startTimeOf,
} from './startTime';

describe('formatStartTime', () => {
  it('shows mm:ss.mmm', () => {
    expect(formatStartTime(0)).toBe('00:00.000');
    expect(formatStartTime(12_350)).toBe('00:12.350');
    expect(formatStartTime(125_007)).toBe('02:05.007');
  });
  it('shows a negative start with a sign', () => {
    expect(formatStartTime(-150)).toBe('-00:00.150');
  });
  it('rounds to whole milliseconds', () => {
    expect(formatStartTime(1000.6)).toBe('00:01.001');
  });
});

describe('parseStartTime', () => {
  it.each([
    ['00:12.350', 12_350],
    ['0:12.35', 12_350],
    ['12.5', 12_500],
    ['12', 12_000],
    ['1:05', 65_000],
    ['-0:00.150', -150],
    ['  00:01.000 ', 1000],
    ['10:00.000', 600_000],
  ])('reads %s', (text, ms) => {
    expect(parseStartTime(text)).toBe(ms);
  });
  it.each(['', '-', 'abc', '1:2:3', '1:60', '1.2345', '00:12,350', ':', '1:'])(
    'rejects %j',
    (text) => {
      expect(parseStartTime(text)).toBeNull();
    },
  );
});

describe('start time and the stored offsets', () => {
  it('is the song offset plus the latency offset (migration keeps the audible placement)', () => {
    expect(startTimeOf({ startOffsetMs: 12_000, latencyOffsetMs: 350 })).toBe(12_350);
    expect(startTimeOf({ startOffsetMs: 0, latencyOffsetMs: -85 })).toBe(-85);
  });
  it('moving the start earlier by 150 ms changes only the latency offset', () => {
    const track = { startOffsetMs: 12_000, latencyOffsetMs: 350 };
    const next = latencyForStart(track, 12_200);
    expect(next).toBe(200);
    expect(startTimeOf({ ...track, latencyOffsetMs: next })).toBe(12_200);
  });
  it('keeps the stored latency inside the API range', () => {
    expect(latencyForStart({ startOffsetMs: 0, latencyOffsetMs: 0 }, 9_999_999)).toBe(600_000);
    expect(latencyForStart({ startOffsetMs: 0, latencyOffsetMs: 0 }, -9_999_999)).toBe(-600_000);
    expect(latencyForStart({ startOffsetMs: 1000, latencyOffsetMs: 0 }, 2500.4)).toBe(1500);
  });
  it('has a fine and a coarse nudge', () => {
    expect([NUDGE_FINE_MS, NUDGE_COARSE_MS]).toEqual([10, 100]);
  });
});
