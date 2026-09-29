import { describe, expect, it } from 'vitest';
import {
  clampZoom,
  followScrollLeft,
  formatClock,
  formatTransportTime,
  MAX_PX_PER_SEC,
  MIN_PX_PER_SEC,
  pxToSec,
  rulerTicks,
  secToPx,
  zoomBy,
} from './math';

describe('secToPx / pxToSec', () => {
  it('convert both ways at a zoom level', () => {
    expect(secToPx(2.5, 40)).toBe(100);
    expect(pxToSec(100, 40)).toBe(2.5);
  });
  it('pxToSec never returns a negative time', () => {
    expect(pxToSec(-30, 40)).toBe(0);
  });
});

describe('formatClock', () => {
  it('formats mm:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(600)).toBe('10:00');
    expect(formatClock(3725)).toBe('62:05');
  });
  it('floors fractional seconds', () => {
    expect(formatClock(59.99)).toBe('0:59');
  });
});

describe('formatTransportTime (mm:ss.s / mm:ss)', () => {
  it('shows tenths for the position and whole seconds for the total', () => {
    expect(formatTransportTime(65.34, 200)).toBe('01:05.3 / 03:20');
    expect(formatTransportTime(0, 0)).toBe('00:00.0 / 00:00');
  });
});

describe('clampZoom / zoomBy', () => {
  it('keeps zoom within limits', () => {
    expect(clampZoom(0.0001)).toBe(MIN_PX_PER_SEC);
    expect(clampZoom(1e9)).toBe(MAX_PX_PER_SEC);
    expect(clampZoom(50)).toBe(50);
  });
  it('zooms multiplicatively', () => {
    expect(zoomBy(50, 2)).toBe(100);
    expect(zoomBy(50, 0.5)).toBe(25);
    expect(zoomBy(MAX_PX_PER_SEC, 2)).toBe(MAX_PX_PER_SEC);
  });
});

describe('rulerTicks', () => {
  it('picks a step that keeps labels at least 80 px apart', () => {
    const t = rulerTicks({ pxPerSec: 100, fromSec: 0, toSec: 10 });
    expect(t.stepSec).toBe(1); // 100 px between 1 s marks
    expect(t.ticks.map((x) => x.sec)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(t.ticks[3]).toEqual({ sec: 3, px: 300, label: '0:03' });
  });
  it('uses coarser steps when zoomed out', () => {
    expect(rulerTicks({ pxPerSec: 10, fromSec: 0, toSec: 100 }).stepSec).toBe(10); // 100 px
    expect(rulerTicks({ pxPerSec: 1, fromSec: 0, toSec: 600 }).stepSec).toBe(120);
  });
  it('uses finer steps when zoomed in', () => {
    expect(rulerTicks({ pxPerSec: 400, fromSec: 0, toSec: 2 }).stepSec).toBe(0.5); // 200 px
  });
  it('only returns ticks in the visible range, aligned to the step', () => {
    const t = rulerTicks({ pxPerSec: 100, fromSec: 3.5, toSec: 6.2 });
    expect(t.ticks.map((x) => x.sec)).toEqual([4, 5, 6]);
  });
  it('labels sub-second steps with tenths', () => {
    const t = rulerTicks({ pxPerSec: 400, fromSec: 0, toSec: 1 });
    expect(t.ticks[1]?.label).toBe('0:00.5');
  });
});

describe('followScrollLeft', () => {
  const base = { viewportWidth: 1000, contentWidth: 10000 };
  it('leaves the scroll alone while the playhead is comfortably inside the view', () => {
    expect(followScrollLeft({ ...base, scrollLeft: 0, playheadPx: 500 })).toBe(0);
  });
  it('pages forward when the playhead nears the right edge', () => {
    // playhead at 950 of a 1000px view (beyond the 90% mark): move it to 10% from the left
    expect(followScrollLeft({ ...base, scrollLeft: 0, playheadPx: 950 })).toBe(850);
  });
  it('jumps back when the playhead is left of the view', () => {
    expect(followScrollLeft({ ...base, scrollLeft: 2000, playheadPx: 500 })).toBe(400);
  });
  it('never scrolls past the content or below zero', () => {
    expect(followScrollLeft({ ...base, scrollLeft: 8900, playheadPx: 9990 })).toBe(9000);
    expect(followScrollLeft({ ...base, scrollLeft: 100, playheadPx: 20 })).toBe(0);
  });
});
