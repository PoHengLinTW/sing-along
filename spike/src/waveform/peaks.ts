/** Max-abs peaks per bucket. Precomputed once per track; wavesurfer renders these without decoding. */
export function computePeaks(samples: Float32Array, buckets: number): Float32Array {
  const out = new Float32Array(buckets);
  const per = samples.length / buckets;
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor(b * per);
    const to = Math.max(from + 1, Math.floor((b + 1) * per));
    let max = 0;
    for (let i = from; i < to && i < samples.length; i++) {
      const v = Math.abs(samples[i]);
      if (v > max) max = v;
    }
    out[b] = max;
  }
  return out;
}

export function trackLeftPx(t: { startOffsetMs: number; latencyOffsetMs: number }, pxPerSec: number): number {
  return Math.max(0, ((t.startOffsetMs + t.latencyOffsetMs) / 1000) * pxPerSec);
}
