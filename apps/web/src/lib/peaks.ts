/**
 * Waveform peaks: the max |sample| per bucket (channels combined), at `peaksPerSec` buckets per
 * second, rounded to 2 decimals so the JSON stays small (~300 KB for 10 minutes at 100/s).
 */
export function computePeaks(
  channels: Float32Array[],
  sampleRate: number,
  peaksPerSec: number,
): number[] {
  const length = channels[0]?.length ?? 0;
  if (length === 0) return [];
  const samplesPerBucket = sampleRate / peaksPerSec;
  const buckets = Math.ceil(length / samplesPerBucket);
  const peaks: number[] = new Array(buckets);
  for (let b = 0; b < buckets; b++) {
    const from = Math.min(Math.floor(b * samplesPerBucket), length - 1);
    const to = Math.min(Math.max(from + 1, Math.floor((b + 1) * samplesPerBucket)), length);
    let max = 0;
    for (const ch of channels) {
      for (let i = from; i < to; i++) {
        const v = Math.abs(ch[i] ?? 0);
        if (v > max) max = v;
      }
    }
    peaks[b] = Math.round(Math.min(max, 1) * 100) / 100;
  }
  return peaks;
}
