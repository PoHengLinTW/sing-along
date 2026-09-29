/** A–B loop math (pure). The engine schedules loop passes ahead of time on the audio clock. */

export const MIN_LOOP_SEC = 0.5;

export interface LoopRegion {
  a: number;
  b: number;
}

/** A stretch of the project timeline scheduled to start playing at an AudioContext time. */
export interface Segment {
  ctxStart: number;
  from: number;
  to: number;
}

/** Region from two points (either order); null if it is shorter than 0.5 s or starts before 0. */
export function makeLoop(x: number, y: number): LoopRegion | null {
  const a = Math.min(x, y);
  const b = Math.max(x, y);
  if (a < 0 || b - a < MIN_LOOP_SEC) return null;
  return { a, b };
}

/** Move one edge while keeping B >= A + 0.5 s and both inside [0, duration]. */
export function adjustEdge(
  loop: LoopRegion,
  edge: 'a' | 'b',
  to: number,
  duration: number,
): LoopRegion {
  if (edge === 'a') {
    const a = Math.min(Math.max(0, to), loop.b - MIN_LOOP_SEC);
    return { a, b: loop.b };
  }
  const b = Math.max(Math.min(duration, to), loop.a + MIN_LOOP_SEC);
  return { a: loop.a, b };
}

/**
 * Where the first pass ends. The loop only applies when the playhead is before B; started at or
 * past B, the loop is ignored (playback runs on) until the playhead is seeked back in front of B.
 */
export function firstSegmentEnd(playhead: number, loop: LoopRegion | null): number {
  return loop && playhead < loop.b ? loop.b : Number.POSITIVE_INFINITY;
}

/** The next pass begins exactly when this one ends: no gap. */
export function nextSegmentStart(seg: Segment): number {
  return seg.ctxStart + (seg.to - seg.from);
}

/** Timeline position at an AudioContext time, given the passes scheduled so far. */
export function positionAt(segments: Segment[], now: number): number {
  const first = segments[0];
  if (!first) return 0;
  let current = first;
  for (const s of segments) {
    if (s.ctxStart <= now) current = s;
  }
  return current.from + Math.max(0, now - current.ctxStart);
}

/**
 * A 4 s window around the playhead for judging alignment by ear: centred where it can be, slid
 * to stay inside [0, duration], and never shorter than the 0.5 s loop minimum.
 */
export function previewWindow(position: number, duration: number, spanSec = 4): LoopRegion {
  const length = Math.min(spanSec, duration);
  const a = Math.max(0, Math.min(position - spanSec / 2, duration - length));
  return { a, b: Math.max(a + length, a + MIN_LOOP_SEC) };
}
