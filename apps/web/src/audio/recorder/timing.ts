import type { Segment } from '../loop';

/**
 * Timeline position (sec) at an AudioContext time, given the scheduled passes. Unlike
 * `positionAt` it is not clamped: a frame captured just before playback began maps to slightly
 * before the pass start (and to a negative time when recording from 0). Null if nothing is scheduled.
 */
export function timelineSecAt(segments: Segment[], ctxTime: number): number | null {
  const first = segments[0];
  if (!first) return null;
  let current = first;
  for (const s of segments) if (s.ctxStart <= ctxTime) current = s;
  return current.from + (ctxTime - current.ctxStart);
}

export interface TakePlacement {
  startOffsetMs: number;
  /** Leading samples that fall before timeline 0 and must be dropped when encoding. */
  trimSamples: number;
}

export function takePlacement(startSec: number, sampleRate: number): TakePlacement {
  if (startSec >= 0) return { startOffsetMs: Math.round(startSec * 1000), trimSamples: 0 };
  return { startOffsetMs: 0, trimSamples: Math.round(-startSec * sampleRate) };
}
