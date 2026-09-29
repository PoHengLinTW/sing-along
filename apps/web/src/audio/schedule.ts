/** Pure scheduling and mixing math for the audio engine (no Web Audio here, so it is easy to test). */

export interface ScheduleTrack {
  id: number;
  durationSec: number;
  startOffsetMs: number;
  latencyOffsetMs: number;
}

/** Where a track begins on the project timeline: start offset + latency offset (either may be negative). */
export function trackStartSec(t: Pick<ScheduleTrack, 'startOffsetMs' | 'latencyOffsetMs'>): number {
  return (t.startOffsetMs + t.latencyOffsetMs) / 1000;
}

export function projectDuration(tracks: ScheduleTrack[]): number {
  return tracks.reduce((max, t) => Math.max(max, trackStartSec(t) + t.durationSec), 0);
}

export interface StartPlan {
  id: number;
  /** Seconds after "now" at which the source should start. */
  delaySec: number;
  /** Offset into the track's buffer to start from. */
  bufferOffsetSec: number;
}

/** For a playhead, which tracks start when and from where. Tracks already finished are omitted. */
export function planStart(playheadSec: number, tracks: ScheduleTrack[]): StartPlan[] {
  const plans: StartPlan[] = [];
  for (const t of tracks) {
    const local = playheadSec - trackStartSec(t);
    if (local >= t.durationSec) continue;
    plans.push(
      local < 0
        ? { id: t.id, delaySec: -local, bufferOffsetSec: 0 }
        : { id: t.id, delaySec: 0, bufferOffsetSec: local },
    );
  }
  return plans;
}

export interface MixState {
  volume: number;
  muted: boolean;
  solo: boolean;
}

/** Mute always wins; if any track is soloed, only soloed tracks are audible. */
export function audibleGain(t: MixState, anySolo: boolean): number {
  if (t.muted) return 0;
  if (anySolo && !t.solo) return 0;
  return t.volume;
}
