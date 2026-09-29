const QUANTUM = 128;

/**
 * Batches the worklet's 128-frame quanta into chunks of about one second (a whole number of
 * quanta), and zeroes samples while muted so a muted stretch keeps its length as digital silence.
 * Pure so it is unit-tested; the worklet only feeds it.
 */
export class ChunkBatcher {
  private readonly size: number;
  private buf: Float32Array;
  private filled = 0;
  private muted = false;

  constructor(sampleRate: number) {
    this.size = Math.max(1, Math.round(sampleRate / QUANTUM)) * QUANTUM;
    this.buf = new Float32Array(this.size);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  /** Adds samples; returns any chunks that filled up. */
  push(samples: Float32Array): Float32Array[] {
    const out: Float32Array[] = [];
    let i = 0;
    while (i < samples.length) {
      const n = Math.min(this.size - this.filled, samples.length - i);
      if (!this.muted) this.buf.set(samples.subarray(i, i + n), this.filled);
      else this.buf.fill(0, this.filled, this.filled + n);
      this.filled += n;
      i += n;
      if (this.filled === this.size) {
        out.push(this.buf);
        this.buf = new Float32Array(this.size);
        this.filled = 0;
      }
    }
    return out;
  }

  /** The partial chunk left over at Stop, or null. */
  flush(): Float32Array | null {
    if (this.filled === 0) return null;
    const out = this.buf.slice(0, this.filled);
    this.filled = 0;
    return out;
  }
}
