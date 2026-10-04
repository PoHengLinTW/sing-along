export interface Column {
  x: number;
  min: number;
  max: number;
}

/**
 * The pixel columns to draw for the live waveform. Blocks are `blockSec` long, the take starts at
 * `startSec` on the timeline, and the view shows [viewLeftPx, viewLeftPx + viewWidthPx). Blocks
 * narrower than a pixel merge into one column. Pure, so alignment with the ruler is unit-tested.
 */
export function liveColumns(
  wave: { min: ArrayLike<number>; max: ArrayLike<number> },
  blockSec: number,
  startSec: number,
  pxPerSec: number,
  viewLeftPx: number,
  viewWidthPx: number,
): Column[] {
  const blockPx = blockSec * pxPerSec;
  const originPx = startSec * pxPerSec - viewLeftPx;
  const count = wave.min.length;
  const first = Math.max(0, Math.floor(-originPx / blockPx));
  const cols: Column[] = [];
  for (let i = first; i < count; i++) {
    const x0 = originPx + i * blockPx;
    if (x0 >= viewWidthPx) break;
    const from = Math.max(0, Math.floor(x0));
    const to = Math.min(viewWidthPx, Math.max(Math.floor(x0) + 1, Math.ceil(x0 + blockPx)));
    for (let x = from; x < to; x++) {
      const last = cols.at(-1);
      const lo = wave.min[i] as number;
      const hi = wave.max[i] as number;
      if (last && last.x === x) {
        last.min = Math.min(last.min, lo);
        last.max = Math.max(last.max, hi);
      } else cols.push({ x, min: lo, max: hi });
    }
  }
  return cols;
}

/**
 * Columns for a fixed-width strip showing the last `windowBlocks` blocks: it fills from the left,
 * then scrolls so the newest block sits at the right edge. For the recording sheet's waveform.
 */
export function tailColumns(
  wave: { min: ArrayLike<number>; max: ArrayLike<number> },
  windowBlocks: number,
  widthPx: number,
): Column[] {
  const pxPerBlock = widthPx / windowBlocks;
  const hidden = Math.max(0, wave.min.length - windowBlocks);
  return liveColumns(wave, 1, 0, pxPerBlock, hidden * pxPerBlock, widthPx);
}

/** Min/max blocks of the take being recorded. Not React state: it changes ~45 times a second. */
export class LiveWave {
  min: number[] = [];
  max: number[] = [];
  startSec = 0;
  blockSec = 0;
  private listeners = new Set<() => void>();

  get count(): number {
    return this.min.length;
  }

  /** False until the take's position on the timeline is known (blocks may arrive earlier). */
  get timed(): boolean {
    return this.blockSec > 0;
  }

  /** Timeline second where the captured audio ends so far. */
  get endSec(): number {
    return this.startSec + this.count * this.blockSec;
  }

  reset(): void {
    this.min = [];
    this.max = [];
    this.startSec = 0;
    this.blockSec = 0;
    this.notify();
  }

  setTiming(startSec: number, sampleRate: number, blockFrames: number): void {
    this.startSec = startSec;
    this.blockSec = blockFrames / sampleRate;
    this.notify();
  }

  push(min: number, max: number): void {
    this.min.push(min);
    this.max.push(max);
    this.notify();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}

export const liveWave = new LiveWave();
