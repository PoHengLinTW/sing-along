export interface PlaceInput {
  playheadSec: number;
  /** Where the track begins on the timeline: start_offset + latency_offset. */
  trackStartSec: number;
  durationSec: number;
}

export interface Placement {
  /** Seconds from "now" until the source should start. */
  delaySec: number;
  /** Offset into the AudioBuffer to start from. */
  bufferOffsetSec: number;
}

export function placeTrack({ playheadSec, trackStartSec, durationSec }: PlaceInput): Placement | null {
  const local = playheadSec - trackStartSec;
  if (local >= durationSec) return null;
  if (local < 0) return { delaySec: -local, bufferOffsetSec: 0 };
  return { delaySec: 0, bufferOffsetSec: local };
}

export interface MixState {
  volume: number;
  muted: boolean;
  solo: boolean;
}

export function effectiveGain(t: MixState, anySolo: boolean): number {
  if (t.muted) return 0;
  if (anySolo && !t.solo) return 0;
  return t.volume;
}

export function playheadAt(a: { ctxTime: number; anchorCtxTime: number; anchorPlayhead: number }): number {
  return a.anchorPlayhead + Math.max(0, a.ctxTime - a.anchorCtxTime);
}

/** Like playheadAt but unclamped: frames captured before the play anchor map to earlier timeline time. */
export function timelineAt(a: { ctxTime: number; anchorCtxTime: number; anchorPlayhead: number }): number {
  return a.anchorPlayhead + (a.ctxTime - a.anchorCtxTime);
}

export const LATENCY_MAX_MS = 500;

export function clampLatencyMs(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  return Math.max(-LATENCY_MAX_MS, Math.min(LATENCY_MAX_MS, Math.round(ms)));
}
