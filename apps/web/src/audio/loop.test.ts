import { describe, expect, it } from 'vitest';
import {
  adjustEdge,
  firstSegmentEnd,
  MIN_LOOP_SEC,
  makeLoop,
  nextSegmentStart,
  positionAt,
  previewWindow,
} from './loop';

describe('makeLoop', () => {
  it('creates a region when B is at least 0.5 s after A', () => {
    expect(makeLoop(2, 5)).toEqual({ a: 2, b: 5 });
    expect(makeLoop(2, 2.5)).toEqual({ a: 2, b: 2.5 });
  });
  it('orders the edges, so dragging right-to-left works too', () => {
    expect(makeLoop(5, 2)).toEqual({ a: 2, b: 5 });
  });
  it('rejects regions shorter than 0.5 s', () => {
    expect(makeLoop(2, 2.4)).toBeNull();
    expect(makeLoop(3, 3)).toBeNull();
    expect(MIN_LOOP_SEC).toBe(0.5);
  });
  it('rejects negative times', () => {
    expect(makeLoop(-1, 3)).toBeNull();
  });
});

describe('adjustEdge (dragging a region edge)', () => {
  const loop = { a: 2, b: 5 };
  it('moves A or B', () => {
    expect(adjustEdge(loop, 'a', 3, 60)).toEqual({ a: 3, b: 5 });
    expect(adjustEdge(loop, 'b', 8, 60)).toEqual({ a: 2, b: 8 });
  });
  it('keeps B at least 0.5 s after A', () => {
    expect(adjustEdge(loop, 'a', 4.9, 60)).toEqual({ a: 4.5, b: 5 });
    expect(adjustEdge(loop, 'b', 2.1, 60)).toEqual({ a: 2, b: 2.5 });
  });
  it('stays within [0, duration]', () => {
    expect(adjustEdge(loop, 'a', -3, 60)).toEqual({ a: 0, b: 5 });
    expect(adjustEdge(loop, 'b', 99, 60)).toEqual({ a: 2, b: 60 });
  });
});

describe('firstSegmentEnd', () => {
  it('plays on to B when the playhead is before B (including before A)', () => {
    expect(firstSegmentEnd(0, { a: 2, b: 5 })).toBe(5);
    expect(firstSegmentEnd(3, { a: 2, b: 5 })).toBe(5);
  });
  it('ignores the loop when the playhead is at or past B', () => {
    expect(firstSegmentEnd(5, { a: 2, b: 5 })).toBe(Number.POSITIVE_INFINITY);
    expect(firstSegmentEnd(9, { a: 2, b: 5 })).toBe(Number.POSITIVE_INFINITY);
  });
  it('is unbounded without a loop', () => {
    expect(firstSegmentEnd(1, null)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('nextSegmentStart', () => {
  it('is the context time at which the previous segment ends (no gap)', () => {
    expect(nextSegmentStart({ ctxStart: 10, from: 2, to: 5 })).toBe(13);
    expect(nextSegmentStart({ ctxStart: 10, from: 0, to: 5 })).toBe(15);
  });
});

describe('positionAt', () => {
  const segs = [
    { ctxStart: 10, from: 0, to: 5 },
    { ctxStart: 15, from: 2, to: 5 },
    { ctxStart: 18, from: 2, to: 5 },
  ];
  it('follows the segment that has started', () => {
    expect(positionAt(segs, 12)).toBe(2);
    expect(positionAt(segs, 16)).toBe(3); // second pass: back at A + 1 s
    expect(positionAt(segs, 18.5)).toBe(2.5);
  });
  it('holds at the first segment start before it begins (start lead)', () => {
    expect(positionAt(segs, 9.9)).toBe(0);
  });
  it('is 0 without segments', () => {
    expect(positionAt([], 5)).toBe(0);
  });
});

describe('previewWindow', () => {
  it('is 4 s centred on the playhead', () => {
    expect(previewWindow(10, 60)).toEqual({ a: 8, b: 12 });
  });

  it('keeps 4 s when the playhead is near the start', () => {
    expect(previewWindow(1, 60)).toEqual({ a: 0, b: 4 });
    expect(previewWindow(0, 60)).toEqual({ a: 0, b: 4 });
  });

  it('keeps 4 s when the playhead is near the end', () => {
    expect(previewWindow(59, 60)).toEqual({ a: 56, b: 60 });
  });

  it('uses the whole project when it is shorter than 4 s', () => {
    expect(previewWindow(1, 3)).toEqual({ a: 0, b: 3 });
  });

  it('never returns a region under the 0.5 s loop minimum', () => {
    const w = previewWindow(0, 0.2);
    expect(w.b - w.a).toBeGreaterThanOrEqual(0.5);
  });
});
