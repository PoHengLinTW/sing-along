export interface TrackShape {
  durationSec: number;
  sampleRate: number;
  channels: number;
}

/** Decoded AudioBuffers are Float32 PCM held in memory regardless of the source format. */
export function decodedBytes(t: TrackShape): number {
  return Math.round(t.durationSec * t.sampleRate * t.channels * 4);
}

export function maxTracksWithin(t: TrackShape, budgetBytes: number): number {
  return Math.floor(budgetBytes / decodedBytes(t));
}
